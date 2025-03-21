import './style.css';
import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Threshold values and ID
let thresholds = {
  temperature: 25,
  humidity: 70,
  gas: 1000 // I'm assuming this is equivalent to "moisture" in your requirements
};
let thresholdId = null;

// Store readings collection
let readings = [];
const TOTAL_READINGS = 10;
const READING_INTERVAL = 5000; // 5 seconds

// Chart objects
let temperatureChart;
let humidityChart;
let moistureChart;

// Track if data collection is in progress
let isCollecting = false;

// Initialize the dashboard
async function initDashboard() {
  await fetchCurrentThresholds();
  setupThresholdListeners();
  setupRefreshButton();
  hideGraphs(); // Hide graphs initially
  startDataCollection();
}

// Fetch current threshold values from Supabase
async function fetchCurrentThresholds() {
  try {
    const { data, error } = await supabase
      .from('thresholds')
      .select('*')
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      thresholdId = data[0].id;
      thresholds = {
        temperature: data[0].temperature,
        humidity: data[0].humidity,
        gas: data[0].gas_level
      };
      
      // Update the input fields with current values
      document.getElementById('temp-threshold').value = thresholds.temperature;
      document.getElementById('humidity-threshold').value = thresholds.humidity;
      document.getElementById('gas-threshold').value = thresholds.gas;
    }
  } catch (error) {
    console.error('Error fetching thresholds:', error);
    showNotification('Failed to load threshold values.');
  }
}

// Update thresholds in Supabase
async function updateThresholds(newThresholds) {
  try {
    const { error } = await supabase
      .from('thresholds')
      .update({
        temperature: newThresholds.temperature,
        humidity: newThresholds.humidity,
        gas_level: newThresholds.gas,
        updated_at: new Date().toISOString()
      })
      .eq('id', thresholdId);

    if (error) throw error;
    
    return true;
  } catch (error) {
    console.error('Error updating thresholds:', error);
    showNotification('Failed to update thresholds in database.');
    return false;
  }
}

// Set up refresh button listener
function setupRefreshButton() {
  document.getElementById('refresh-button').addEventListener('click', () => {
    // Only allow refresh if we're not already collecting data
    if (!isCollecting) {
      // Reset the UI
      hideGraphs();
      
      // Start a new collection cycle
      startDataCollection();
    } else {
      showNotification('Data collection already in progress!');
    }
  });
}

// Hide graph containers until we have 10 readings
function hideGraphs() {
  const graphContainers = document.querySelectorAll('.chart-container');
  graphContainers.forEach(container => {
    container.style.display = 'none';
  });
  
  // Hide averages section
  document.getElementById('averages-container').style.display = 'none';
}

// Show graph containers after we have 10 readings
function showGraphs() {
  const graphContainers = document.querySelectorAll('.chart-container');
  graphContainers.forEach(container => {
    container.style.display = 'block';
  });
  
  // Show averages section
  document.getElementById('averages-container').style.display = 'block';
}

// Set up individual Charts
function setupCharts() {
  // Temperature Chart
  const tempCtx = document.getElementById('temperatureChart').getContext('2d');
  tempCtx.canvas.style.height = "50vh";
  
  // Humidity Chart
  const humidityCtx = document.getElementById('humidityChart').getContext('2d');
  humidityCtx.canvas.style.height = "50vh";
  
  // Moisture/Gas Chart
  const moistureCtx = document.getElementById('moistureChart').getContext('2d');
  moistureCtx.canvas.style.height = "50vh";
  
  const timeLabels = readings.map(d => formatTime(d.created_at));
  
  // Clean up old charts if they exist
  if (temperatureChart) temperatureChart.destroy();
  if (humidityChart) humidityChart.destroy();
  if (moistureChart) moistureChart.destroy();
  
  temperatureChart = new Chart(tempCtx, {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [{
        label: 'Temperature (°C)',
        borderColor: 'rgb(59, 130, 246)',
        data: readings.map(d => d.temperature)
      }]
    },
    options: createChartOptions('Temperature (°C)')
  });
  
  humidityChart = new Chart(humidityCtx, {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [{
        label: 'Humidity (%)',
        borderColor: 'rgb(34, 197, 94)',
        data: readings.map(d => d.humidity)
      }]
    },
    options: createChartOptions('Humidity (%)')
  });
  
  moistureChart = new Chart(moistureCtx, {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [{
        label: 'Moisture Levels (PPM)',
        borderColor: 'rgb(147, 51, 234)',
        data: readings.map(d => d.gas_level)
      }]
    },
    options: createChartOptions('Moisture Levels (PPM)')
  });
}

// Create chart options with auto scaling
function createChartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: true,
        text: title
      }
    },
    scales: {
      y: {
        beginAtZero: false, // Allow scale to adapt to data
        grid: {
          color: "rgba(0,0,0,0.1)",
          lineWidth: 1
        },
        ticks: {
          autoSkip: true
        }
      },
      x: {
        grid: {
          color: "rgba(0,0,0,0.1)",
          lineWidth: 1
        }
      }
    }
  };
}

// Start collecting data at 5-second intervals
function startDataCollection() {
  isCollecting = true;
  
  // Update refresh button state
  const refreshButton = document.getElementById('refresh-button');
  refreshButton.disabled = true;
  refreshButton.classList.add('opacity-50', 'cursor-not-allowed');
  
  const readingCounter = document.getElementById('reading-counter');
  readingCounter.textContent = `0/${TOTAL_READINGS}`;
  
  readings = []; // Reset readings array
  
  const dataTimer = setInterval(async () => {
    await fetchLatestData();
    
    // Update reading counter
    readingCounter.textContent = `${readings.length}/${TOTAL_READINGS}`;
    
    if (readings.length >= TOTAL_READINGS) {
      clearInterval(dataTimer);
      
      // Calculate and display averages
      calculateAverages();
      
      // Setup and show charts
      setupCharts();
      showGraphs();
      
      // Update collection status
      isCollecting = false;
      
      // Re-enable refresh button
      refreshButton.disabled = false;
      refreshButton.classList.remove('opacity-50', 'cursor-not-allowed');
      
      showNotification('Data collection complete! View results or click refresh to start again.');
    }
  }, READING_INTERVAL);
}

// Calculate averages of collected readings
function calculateAverages() {
  // Calculate averages
  const avgTemperature = readings.reduce((sum, reading) => sum + reading.temperature, 0) / readings.length;
  const avgHumidity = readings.reduce((sum, reading) => sum + reading.humidity, 0) / readings.length;
  const avgMoisture = readings.reduce((sum, reading) => sum + reading.gas_level, 0) / readings.length;
  
  // Update averages display
  document.getElementById('avg-temperature').textContent = `${avgTemperature.toFixed(2)}°C`;
  document.getElementById('avg-humidity').textContent = `${avgHumidity.toFixed(2)}%`;
  document.getElementById('avg-moisture').textContent = `${avgMoisture.toFixed(2)} PPM`;
  
  // Check against thresholds
  updateStatus(document.getElementById('avg-temp-status'), avgTemperature, thresholds.temperature, 'Average temperature');
  updateStatus(document.getElementById('avg-humidity-status'), avgHumidity, thresholds.humidity, 'Average humidity');
  updateStatus(document.getElementById('avg-moisture-status'), avgMoisture, thresholds.gas, 'Average moisture');
}

// Fetch latest sensor data
async function fetchLatestData() {
  try {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      readings.push(data[0]);
      updateDashboard(data[0]);
    }
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

// Update dashboard with new values
function updateDashboard(data) {
  // Update temperature
  const tempElement = document.getElementById('temperature-value');
  const tempStatus = document.getElementById('temperature-status');
  tempElement.textContent = `${data.temperature}°C`;
  updateStatus(tempStatus, data.temperature, thresholds.temperature, 'Temperature');

  // Update humidity
  const humidityElement = document.getElementById('humidity-value');
  const humidityStatus = document.getElementById('humidity-status');
  humidityElement.textContent = `${data.humidity}%`;
  updateStatus(humidityStatus, data.humidity, thresholds.humidity, 'Humidity');

  // Update moisture/gas levels
  const moistureElement = document.getElementById('gas-value');
  const moistureStatus = document.getElementById('gas-status');
  moistureElement.textContent = `${data.gas_level} PPM`;
  updateStatus(moistureStatus, data.gas_level, thresholds.gas, 'Moisture level');
}

// Update status indicators
function updateStatus(element, value, threshold, sensorType) {
  if (value > threshold) {
    element.textContent = `⚠️ ${sensorType} above threshold!`;
    element.className = 'mt-2 text-sm text-red-600';
    showNotification(`Warning: ${sensorType} above threshold!`);
  } else {
    element.textContent = 'Normal';
    element.className = 'mt-2 text-sm text-green-600';
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(); // Converts to a readable time string (HH:MM:SS)
}

// Set up threshold input listeners
function setupThresholdListeners() {
  document.getElementById('save-thresholds').addEventListener('click', async () => {
    const newThresholds = {
      temperature: parseFloat(document.getElementById('temp-threshold').value),
      humidity: parseFloat(document.getElementById('humidity-threshold').value),
      gas: parseFloat(document.getElementById('gas-threshold').value)
    };
    
    // Validate input values
    if (isNaN(newThresholds.temperature) || isNaN(newThresholds.humidity) || isNaN(newThresholds.gas)) {
      showNotification('Please enter valid numbers for all threshold values.');
      return;
    }
    
    // Update UI first (optimistic update)
    thresholds = newThresholds;
    showNotification('Updating thresholds...');
    
    // Update in database
    const success = await updateThresholds(newThresholds);
    
    if (success) {
      showNotification('Thresholds updated successfully in database!');
    }
  });
}

// Show browser notifications
function showNotification(message) {
  // Show in UI first (create a notification element if it doesn't exist)
  const notificationArea = document.getElementById('notification-area') || 
    (() => {
      const area = document.createElement('div');
      area.id = 'notification-area';
      area.className = 'fixed bottom-4 right-4 z-50';
      document.body.appendChild(area);
      return area;
    })();
  
  const notification = document.createElement('div');
  notification.className = 'bg-blue-500 text-white px-4 py-2 rounded shadow-lg mb-2';
  notification.textContent = message;
  notificationArea.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
  
  // Also try browser notifications if available
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(message);
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(message);
      }
    });
  }
}

// Initialize the dashboard when the page loads
document.addEventListener('DOMContentLoaded', initDashboard);