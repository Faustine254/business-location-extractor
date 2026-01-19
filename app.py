from flask import Flask, render_template, request, jsonify, Response
import requests
import pandas as pd
import json
import os
import shapely.geometry as sg
from shapely.geometry import Point, Polygon
from functools import partial
import pyproj
from shapely.ops import transform

app = Flask(__name__)

# Create required directories
os.makedirs('static/css', exist_ok=True)
os.makedirs('static/js', exist_ok=True)
os.makedirs('templates', exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search_area', methods=['POST'])
def search_area():
    """Search for an area by name and return its boundary"""
    data = request.get_json()
    area_name = data.get('areaName', '')
    lat = data.get('lat')
    lon = data.get('lon')
    
    # If coordinates are provided, use reverse geocoding
    if lat is not None and lon is not None:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&polygon_geojson=1&addressdetails=1"
    # Otherwise search by name
    elif area_name:
        url = f"https://nominatim.openstreetmap.org/search?q={area_name}&format=json&polygon_geojson=1&addressdetails=1&limit=1"
    else:
        return jsonify({"error": "No search criteria provided"})
    
    headers = {
        'User-Agent': 'BusinessLocator/1.0'
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        return jsonify({"error": "Error connecting to geocoding service"})
    
    data = response.json()
    
    # Handle the different response formats
    if lat is not None and lon is not None:  # Reverse geocoding result
        if not data:
            return jsonify({"error": "No area found at this location"})
        
        area_data = data
        display_name = area_data.get('display_name', 'Unknown Area')
        
        # Get boundary if available
        if 'geojson' in area_data:
            boundary = area_data['geojson']
        else:
            # Create a small polygon around the point if no boundary available
            boundary = create_buffer_polygon(float(lat), float(lon), 0.01)  # ~1km buffer
            
    else:  # Search by name result
        if not data:
            return jsonify({"error": f"No area found with name: {area_name}"})
        
        area_data = data[0]
        display_name = area_data.get('display_name', 'Unknown Area')
        
        # Get boundary if available
        if 'geojson' in area_data:
            boundary = area_data['geojson']
        else:
            # Create a small polygon around the point if no boundary available
            lat = float(area_data.get('lat', 0))
            lon = float(area_data.get('lon', 0))
            boundary = create_buffer_polygon(lat, lon, 0.01)  # ~1km buffer
    
    # Return the area information with boundary
    return jsonify({
        "name": display_name,
        "boundary": boundary,
        "center": {
            "lat": float(area_data.get('lat', lat)),
            "lon": float(area_data.get('lon', lon))
        }
    })

def create_buffer_polygon(lat, lon, buffer_size):
    """Create a circular buffer polygon around a point"""
    # Create a geodetic transformer
    proj_wgs84 = pyproj.CRS('EPSG:4326')
    proj_utm = pyproj.CRS(f"+proj=utm +zone={int((lon + 180) / 6) + 1} +datum=WGS84 +units=m +no_defs")
    project = partial(
        pyproj.transform,
        pyproj.Transformer.from_crs(proj_wgs84, proj_utm, always_xy=True).transform,
    )
    project_back = partial(
        pyproj.transform,
        pyproj.Transformer.from_crs(proj_utm, proj_wgs84, always_xy=True).transform,
    )
    
    # Create point and buffer in meters (convert buffer_size from degrees to about 1km)
    point = Point(lon, lat)
    point_utm = transform(project, point)
    buffer_utm = point_utm.buffer(1000 * buffer_size)  # Buffer in meters
    buffer_wgs84 = transform(project_back, buffer_utm)
    
    # Convert to GeoJSON-compatible format
    coords = list(buffer_wgs84.exterior.coords)
    return {"type": "Polygon", "coordinates": [coords]}

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json()
    
    category = data.get('category', 'amenity')
    value = data.get('value', 'restaurant')
    
    # Check if we're using a drawn shape or a predefined boundary
    if data.get('useDrawnShape', True):
        # Get coordinates for drawn shape
        coordinates = data.get('coordinates', [])
        if not coordinates:
            return jsonify({"error": "No shape coordinates provided"})
            
        # Create the bounding box for the Overpass query
        coords = []
        for coord in coordinates:
            coords.append([coord['lat'], coord['lng']])
            
        # Create shapely polygon for filtering results
        boundary_polygon = Polygon(coords)
    else:
        # Use the boundary from the area search
        boundary = data.get('boundary')
        if not boundary or boundary.get('type') != 'Polygon':
            return jsonify({"error": "Invalid boundary data"})
            
        # Convert GeoJSON coordinates to shapely polygon
        coords = []
        for coord in boundary['coordinates'][0]:
            # GeoJSON is [lon, lat] but we need [lat, lon] for our polygon
            coords.append([coord[1], coord[0]])
            
        boundary_polygon = Polygon(coords)
    
    # Get the bounding box for the query
    minlat = min(coord[0] for coord in coords)
    maxlat = max(coord[0] for coord in coords)
    minlon = min(coord[1] for coord in coords)
    maxlon = max(coord[1] for coord in coords)
    
    # Build the Overpass query
    overpass_url = "https://overpass-api.de/api/interpreter"
    
    # Query that finds nodes of specified type inside the bounding box
    query = f"""
    [out:json];
    (
      node["{category}"="{value}"]({minlat},{minlon},{maxlat},{maxlon});
      way["{category}"="{value}"]({minlat},{minlon},{maxlat},{maxlon});
      relation["{category}"="{value}"]({minlat},{minlon},{maxlat},{maxlon});
    );
    out center;
    """
    
    response = requests.post(overpass_url, data={"data": query})
    
    if response.status_code != 200:
        return jsonify({"error": "Error connecting to Overpass API"})
    
    # Parse results
    results = []
    raw_data = response.json()
    
    for element in raw_data.get('elements', []):
        # Get coordinates based on element type
        if element['type'] == 'node':
            lat = element['lat']
            lon = element['lon']
        else:  # way or relation with center point
            if 'center' in element:
                lat = element['center']['lat']
                lon = element['center']['lon']
            else:
                continue  # Skip if we can't determine coordinates
        
        # Check if this point is actually inside our polygon
        point = Point(lat, lon)
        if not boundary_polygon.contains(point):
            continue  # Skip points outside our actual boundary
            
        # Extract relevant data
        name = element.get('tags', {}).get('name', 'Unnamed')
        
        results.append({
            'name': name,
            'lat': lat,
            'lon': lon,
            'tags': element.get('tags', {})
        })
    
    # Return the filtered results
    return jsonify({"results": results})

@app.route('/export', methods=['POST'])
def export():
    data = request.get_json()
    results = data.get('results', [])
    
    if not results:
        return jsonify({"error": "No data to export"})
    
    # Convert to DataFrame
    df = pd.DataFrame(results)
    
    # Expand the tags column into separate columns
    if 'tags' in df.columns:
        tags_df = pd.json_normalize(df['tags'])
        df = pd.concat([df.drop('tags', axis=1), tags_df], axis=1)
    
    # Convert to CSV
    csv_data = df.to_csv(index=False)
    
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-disposition": "attachment; filename=business_data.csv"}
    )

if __name__ == '__main__':
    app.run(debug=True)