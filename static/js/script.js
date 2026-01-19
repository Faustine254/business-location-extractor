document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    const map = L.map('map').setView([0, 0], 2);
    
    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Try to get user's location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(position) {
            map.setView([position.coords.latitude, position.coords.longitude], 10);
        }, function() {
            // Default view if location access denied
            map.setView([0, 0], 2);
        });
    }
    
    // Initialize drawing tools
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    
    const drawControl = new L.Control.Draw({
        draw: {
            polyline: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polygon: {
                allowIntersection: false,
                drawError: {
                    color: '#e1e100',
                    message: '<strong>Cannot draw that shape!</strong>'
                },
                shapeOptions: {
                    color: '#3388ff'
                }
            },
            rectangle: {
                shapeOptions: {
                    color: '#3388ff'
                }
            }
        },
        edit: {
            featureGroup: drawnItems
        }
    });
    map.addControl(drawControl);
    
    // Handle drawn shapes
    let currentDrawing = null;
    let useDrawnShape = false;
    let currentAreaBoundary = null;
    
    // Event when drawing is created
    map.on(L.Draw.Event.CREATED, function(event) {
        const layer = event.layer;
        
        // Remove existing drawing if any
        drawnItems.clearLayers();
        
        // Add new drawing
        drawnItems.addLayer(layer);
        currentDrawing = layer;
        useDrawnShape = true;
        
        // Enable search button
        document.getElementById('search-btn').removeAttribute('disabled');
        
        // Add message about using custom shape
        showNotification('Custom area selected. Ready to search for businesses.');
    });
    
    // Function to show notifications
    function showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            notification.style.display = 'none';
        }, 5000);
    }
    
    // Function to get coordinates from a drawing
    function getCoordinatesFromDrawing(layer) {
        const coordinates = [];
        
        if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
            layer.getLatLngs()[0].forEach(function(latLng) {
                coordinates.push({
                    lat: latLng.lat,
                    lng: latLng.lng
                });
            });
        }
        
        return coordinates;
    }
    
    // Function to search for businesses
    function searchBusinesses() {
        const category = document.getElementById('category-select').value;
        const value = document.getElementById('value-select').value;
        const resultsContainer = document.getElementById('results-list');
        const loadingSpinner = document.getElementById('loading-spinner');
        
        // Show loading spinner
        loadingSpinner.style.display = 'block';
        resultsContainer.innerHTML = '';
        
        // Prepare data for request
        let requestData = {
            category: category,
            value: value,
            useDrawnShape: useDrawnShape
        };
        
        if (useDrawnShape && currentDrawing) {
            // Get coordinates from drawing
            requestData.coordinates = getCoordinatesFromDrawing(currentDrawing);
        } else if (currentAreaBoundary) {
            // Use the boundary from area search
            requestData.boundary = currentAreaBoundary;
        } else {
            showNotification('Please select an area first by searching or drawing on the map.', 'error');
            loadingSpinner.style.display = 'none';
            return;
        }
        
        // Send request to backend
        fetch('/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        })
        .then(response => response.json())
        .then(data => {
            // Hide loading spinner
            loadingSpinner.style.display = 'none';
            
            if (data.error) {
                showNotification(data.error, 'error');
                return;
            }
            
            const results = data.results;
            
            if (results.length === 0) {
                resultsContainer.innerHTML = '<p class="no-results">No businesses found in this area.</p>';
                return;
            }
            
            // Process each result
            const markers = [];
            results.forEach(result => {
                // Create marker
                const marker = L.marker([result.lat, result.lon]).addTo(map);
                markers.push(marker);
                
                // Create popup content
                let popupContent = `<strong>${result.name}</strong><br>`;
                
                // Add additional info from tags
                if (result.tags) {
                    const tags = result.tags;
                    if (tags.phone) popupContent += `Phone: ${tags.phone}<br>`;
                    if (tags.website) popupContent += `Website: <a href="${tags.website}" target="_blank">Link</a><br>`;
                    if (tags.opening_hours) popupContent += `Hours: ${tags.opening_hours}<br>`;
                    if (tags.addr_street) popupContent += `Address: ${tags.addr_street}`;
                }
                
                // Bind popup to marker
                marker.bindPopup(popupContent);
                
                // Create result item
                const resultItem = document.createElement('div');
                resultItem.className = 'result-item';
                resultItem.innerHTML = `
                    <h3>${result.name}</h3>
                    <p class="location">Lat: ${result.lat.toFixed(5)}, Lon: ${result.lon.toFixed(5)}</p>
                `;
                
                // Add click event to zoom to marker
                resultItem.addEventListener('click', function() {
                    map.setView([result.lat, result.lon], 16);
                    marker.openPopup();
                });
                
                resultsContainer.appendChild(resultItem);
            });
            
            // Create a marker group to fit bounds
            const group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
            
            // Show export button
            document.getElementById('export-btn').style.display = 'block';
            document.getElementById('export-btn').onclick = function() {
                exportResults(results);
            };
            
            // Show notification
            showNotification(`Found ${results.length} businesses matching your criteria.`);
        })
        .catch(error => {
            loadingSpinner.style.display = 'none';
            showNotification('Error connecting to server. Please try again.', 'error');
            console.error('Error:', error);
        });
    }
    
    // Function to export results
    function exportResults(results) {
        fetch('/export', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ results: results })
        })
        .then(response => {
            if (response.ok) {
                return response.blob();
            }
            throw new Error('Network response was not ok.');
        })
        .then(blob => {
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'business_data.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        })
        .catch(error => {
            showNotification('Error exporting data. Please try again.', 'error');
            console.error('Error:', error);
        });
    }
    
    // Function to search for area by name
    function searchArea() {
        const areaInput = document.getElementById('area-input');
        const areaName = areaInput.value.trim();
        const originalSearchTerm = areaName; // Store the original search term
        
        if (!areaName) {
            showNotification('Please enter an area name to search.', 'error');
            return;
        }
        
        // Show loading spinner
        document.getElementById('loading-spinner').style.display = 'block';
        
        // Clear previous boundary highlight if any
        if (window.boundaryLayer) {
            map.removeLayer(window.boundaryLayer);
        }
        
        // Send request to backend
        fetch('/search_area', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ areaName: areaName })
        })
        .then(response => response.json())
        .then(data => {
            // Hide loading spinner
            document.getElementById('loading-spinner').style.display = 'none';
            
            if (data.error) {
                showNotification(data.error, 'error');
                return;
            }
            
            // Store the boundary for later use
            displayAreaBoundary(data, originalSearchTerm);
        })
        .catch(error => {
            document.getElementById('loading-spinner').style.display = 'none';
            showNotification('Error connecting to server. Please try again.', 'error');
            console.error('Error:', error);
        });
    }
    
    // Function to identify location when user clicks on map
    function identifyLocationByClick(lat, lng) {
        // Show loading spinner
        document.getElementById('loading-spinner').style.display = 'block';
        
        // Clear previous boundary highlight if any
        if (window.boundaryLayer) {
            map.removeLayer(window.boundaryLayer);
        }
        
        // Send request to backend
        fetch('/search_area', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ lat: lat, lon: lng })
        })
        .then(response => response.json())
        .then(data => {
            // Hide loading spinner
            document.getElementById('loading-spinner').style.display = 'none';
            
            if (data.error) {
                showNotification(data.error, 'error');
                return;
            }
            
            // Display the boundary - do NOT update the input field in this case
            displayAreaBoundary(data, null);
        })
        .catch(error => {
            document.getElementById('loading-spinner').style.display = 'none';
            showNotification('Error connecting to server. Please try again.', 'error');
            console.error('Error:', error);
        });
    }
    
    // Function to display area boundary
    function displayAreaBoundary(data, originalSearchTerm) {
        // Store boundary for business search
        currentAreaBoundary = data.boundary;
        useDrawnShape = false;
        
        // Clear any drawn items
        drawnItems.clearLayers();
        currentDrawing = null;
        
        // Create GeoJSON layer with the boundary
        const boundaryStyle = {
            color: "#ff7800",
            weight: 3,
            opacity: 0.65,
            fillOpacity: 0.2
        };
        
        // Remove existing boundary layer if any
        if (window.boundaryLayer) {
            map.removeLayer(window.boundaryLayer);
        }
        
        // Create new boundary layer
        window.boundaryLayer = L.geoJSON(data.boundary, {
            style: boundaryStyle
        }).addTo(map);
        
        // Add popup with area name and search button
        const center = data.center;
        const popup = L.popup()
            .setLatLng([center.lat, center.lon])
            .setContent(`
                <div class="area-popup">
                    <h3>${data.name}</h3>
                    <button class="popup-button" id="search-here-btn">Search businesses here</button>
                </div>
            `)
            .openOn(map);
        
        // Add event listener for the search button in popup
        setTimeout(() => {
            const searchHereBtn = document.getElementById('search-here-btn');
            if (searchHereBtn) {
                searchHereBtn.addEventListener('click', function() {
                    map.closePopup();
                    // Enable search button
                    document.getElementById('search-btn').removeAttribute('disabled');
                    showNotification('Area selected. Ready to search for businesses.');
                });
            }
        }, 100);
        
        // Fit map to boundary
        map.fitBounds(window.boundaryLayer.getBounds());
        
        // Update area input with the original search term if provided
        if (originalSearchTerm !== null) {
            // Keep the original search term instead of replacing with the full address
            document.getElementById('area-input').value = originalSearchTerm;
        }
        
        // Enable search button
        document.getElementById('search-btn').removeAttribute('disabled');
        
        showNotification(`Found area: ${data.name}`);
    }
    
    // Function to clear all drawings
    function clearDrawings() {
        drawnItems.clearLayers();
        // Only disable the search button if we're using drawn shapes
        if (useDrawnShape) {
            document.getElementById('search-btn').setAttribute('disabled', 'disabled');
        }
        currentDrawing = null;
        
        // Clear area boundary if any
        if (window.boundaryLayer) {
            map.removeLayer(window.boundaryLayer);
            window.boundaryLayer = null;
            currentAreaBoundary = null;
            document.getElementById('search-btn').setAttribute('disabled', 'disabled');
        }
        
        // Clear results
        document.getElementById('results-list').innerHTML = '';
        document.getElementById('export-btn').style.display = 'none';
        
        showNotification('Map cleared. Select a new area to search.');
    }
    
    // Event listener for area search button
    document.getElementById('area-search-btn').addEventListener('click', searchArea);
    
    // Event listener for area input (search on Enter key)
    document.getElementById('area-input').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            searchArea();
        }
    });
    
    // Search button
    document.getElementById('search-btn').addEventListener('click', function() {
        searchBusinesses();
    });
    
    // Clear button
    document.getElementById('clear-btn').addEventListener('click', clearDrawings);
    
    // Map click for identifying areas
    map.on('click', function(e) {
        identifyLocationByClick(e.latlng.lat, e.latlng.lng);
    });
    
    // Set up category-dependent values
    const categorySelect = document.getElementById('category-select');
    const valueSelect = document.getElementById('value-select');
    
    // Update values based on category
    categorySelect.addEventListener('change', function() {
        const category = this.value;
        valueSelect.innerHTML = '';
        
        // Default options for each category
        const options = {
            'amenity': ['restaurant', 'cafe', 'bar', 'hospital', 'school', 'bank', 'pharmacy', 'fuel', 'library', 'police'],
            'shop': ['supermarket', 'convenience', 'clothes', 'bakery', 'butcher', 'hardware', 'mobile_phone', 'electronics'],
            'tourism': ['hotel', 'guest_house', 'hostel', 'museum', 'gallery', 'attraction', 'viewpoint'],
            'leisure': ['park', 'garden', 'swimming_pool', 'sports_centre', 'stadium', 'playground'],
            'healthcare': ['doctor', 'dentist', 'clinic', 'hospital', 'pharmacy'],
            'office': ['company', 'government', 'insurance', 'lawyer', 'accountant', 'estate_agent']
        };
        
        // Add options to select
        (options[category] || []).forEach(function(value) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
            valueSelect.appendChild(option);
        });
    });
    
    // Initial trigger to populate value select
    categorySelect.dispatchEvent(new Event('change'));
    
    // Initialize with search button disabled
    document.getElementById('search-btn').setAttribute('disabled', 'disabled');
});