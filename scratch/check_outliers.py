import urllib.request
import json

url = "http://localhost:5000/api/datasets/20/clean/suggestions"
try:
    with urllib.request.urlopen(url) as response:
        html = response.read().decode('utf-8')
        data = json.loads(html)
        print("Suggestions API output:")
        print(json.dumps(data, indent=2))
except Exception as e:
    print("Error:", e)
