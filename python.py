import requests
import json
import time
import random

# Supabase API Details
SUPABASE_URL = "https://ddmnemqyedyejabnjozy.supabase.co/rest/v1/sensor_data"  # Replace with your Supabase URL
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbW5lbXF5ZWR5ZWphYm5qb3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwMTYwMDksImV4cCI6MjA1NzU5MjAwOX0.goCpDILVqlzYk4dW6_jsU3H7wXw04AAw619Zp0lQIkg"  # Replace with your Supabase service role key

# HTTP Headers
HEADERS = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}"
}

# Function to send fake sensor data
def send_fake_data():
    for _ in range(10):  # Send data 10 times (adjust as needed)
        data = {
            "temperature": round(random.uniform(20, 35), 2),
            "humidity": round(random.uniform(50, 90), 2),
            "gas_level": random.randint(800, 1200)
        }

        response = requests.post(f"{SUPABASE_URL}", headers=HEADERS, data=json.dumps(data))

        if response.status_code == 201:
            print(f"✅ Data sent successfully: {data}")
        else:
            print(f"❌ Failed to send data: {response.text}")

        time.sleep(5)  # Send data every 5 seconds

# Run the simulation
send_fake_data()
