import './style.css';
import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Food type thresholds
const foodThresholds = {
  citrus: { temperature: 25, humidity: 70, gas: 1000 },
  berries: { temperature: 25, humidity: 70, gas: 1000 },
  stone: { temperature: 25, humidity: 70, gas: 1000 },
  tropical: { temperature: 25, humidity: 70, gas: 1000 },
  temperate: { temperature: 25, humidity: 70, gas: 1000 },
  leafy: { temperature: 25, humidity: 70, gas: 1000 },
  root: { temperature: 25, humidity: 70, gas: 1000 }
};

let currentThresholds = null;
let isMonitoring = false;
let readings = [];
let monitoringTimeout = null;
let noReadingsTimeout = null;
let lastReadingTimestamp = null;

// Chart objects
let temperatureChart;
let humidityChart;
let moistureChart;

// Initialize the dashboard
function initDashboard() {
  setupFoodTypeSelector();
  setupStartButton();
  setupCharts();
  setupDatePicker();
}

// Set up food type selector
function setupFoodTypeSelector() {
  const selector = document.getElementById('food-type');
  const startButton = document.getElementById('start-monitoring');
  const customInputs = document.getElementById('custom-inputs');
  
  selector.addEventListener('change', async (e) => {
    const selectedType = e.target.value;
    
    if (selectedType) {
      if (selectedType === 'custom') {
        customInputs.classList.remove('hidden');
        document.getElementById('custom-temperature').value = foodThresholds.custom?.temperature || 25;
        document.getElementById('custom-humidity').value = foodThresholds.custom?.humidity || 70;
        document.getElementById('custom-gas').value = foodThresholds.custom?.gas || 1000;
      } else {
        customInputs.classList.add('hidden');
        currentThresholds = foodThresholds[selectedType];
        
        try {
          await supabase
            .from('thresholds')
            .delete()
            .neq('id', '0');
          
          const { error } = await supabase
            .from('thresholds')
            .insert([{
              temperature: currentThresholds.temperature,
              humidity: currentThresholds.humidity,
              gas_level: currentThresholds.gas,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }]);
          
          if (error) throw error;
          showNotification(`Thresholds updated for ${selectedType}`);
        } catch (error) {
          console.error('Error updating thresholds:', error);
          showNotification('Failed to update thresholds');
        }
        
        startButton.disabled = false;
      }
    } else {
      currentThresholds = null;
      startButton.disabled = true;
    }
  });

  document.getElementById('custom-submit').addEventListener('click', async () => {
    const temperature = parseFloat(document.getElementById('custom-temperature').value);
    const humidity = parseFloat(document.getElementById('custom-humidity').value);
    const gas = parseFloat(document.getElementById('custom-gas').value);
    
    foodThresholds.custom = { temperature, humidity, gas };
    
    try {
      await supabase
        .from('thresholds')
        .delete()
        .neq('id', '0');
      
      const { error } = await supabase
        .from('thresholds')
        .insert([{
          temperature,
          humidity,
          gas_level: gas,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      
      if (error) throw error;
      
      currentThresholds = { temperature, humidity, gas };
      customInputs.classList.add('hidden');
      selector.value = 'custom';
      showNotification('Custom thresholds updated and saved');
      startButton.disabled = false;
    } catch (error) {
      console.error('Error updating custom thresholds:', error);
      showNotification('Failed to update custom thresholds');
    }
  });
}

// Set up start monitoring button
function setupStartButton() {
  const startButton = document.getElementById('start-monitoring');
  
  startButton.addEventListener('click', () => {
    if (!isMonitoring) {
      isMonitoring = true;
      startButton.textContent = 'Stop Monitoring';
      startButton.classList.replace('bg-blue-500', 'bg-red-500');
      startButton.classList.replace('hover:bg-blue-600', 'hover:bg-red-600');
      startMonitoring();
    } else {
      isMonitoring = false;
      startButton.textContent = 'Start Monitoring';
      startButton.classList.replace('bg-red-500', 'bg-blue-500');
      startButton.classList.replace('hover:bg-red-600', 'hover:bg-blue-600');
      stopMonitoring();
    }
  });
}

// Start monitoring readings
function startMonitoring() {
  readings = [];
  lastReadingTimestamp = null;
  document.getElementById('readings-list').innerHTML = '';
  document.getElementById('waiting-message').classList.remove('hidden');
  
  // Initialize with zero values
  const initialReading = {
    temperature: 0,
    humidity: 0,
    gas_level: 0,
    created_at: new Date().toISOString()
  };
  
  // Update UI with initial zero values
  updateDashboard(initialReading);
  addReadingToList(initialReading);
  readings.push(initialReading);
  updateCharts();
  
  noReadingsTimeout = setTimeout(() => {
    if (readings.length === 1) { // Only initial reading
      document.getElementById('waiting-message').classList.add('hidden');
      document.getElementById('readings-list').innerHTML = 
        '<div class="text-gray-500">No readings updated on database</div>';
    }
  }, 120000); // 2 minutes
  
  fetchLatestData();
  monitoringTimeout = setInterval(fetchLatestData, 5000);
}

// Stop monitoring readings
function stopMonitoring() {
  clearInterval(monitoringTimeout);
  clearTimeout(noReadingsTimeout);
  document.getElementById('waiting-message').classList.add('hidden');
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
      const reading = data[0];
      const readingTimestamp = new Date(reading.created_at).getTime();
      
      if (!lastReadingTimestamp || readingTimestamp > lastReadingTimestamp) {
        clearTimeout(noReadingsTimeout);
        document.getElementById('waiting-message').classList.add('hidden');
        
        lastReadingTimestamp = readingTimestamp;
        readings.push(reading);
        updateDashboard(reading);
        addReadingToList(reading);
        updateCharts();
      }
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    showNotification('Error fetching sensor data');
  }
}

// Set up date picker for previous readings
function setupDatePicker() {
  const datePicker = document.getElementById('reading-date');
  datePicker.valueAsDate = new Date();
  
  datePicker.addEventListener('change', () => {
    fetchPreviousReadings(datePicker.value);
  });
  
  fetchPreviousReadings(datePicker.value);
}

// Fetch previous readings for a specific date
async function fetchPreviousReadings(date) {
  try {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    const previousReadingsList = document.getElementById('previous-readings-list');
    previousReadingsList.innerHTML = '';

    if (data && data.length > 0) {
      data.forEach(reading => {
        const readingElement = document.createElement('div');
        readingElement.className = 'p-4 bg-gray-50 rounded-lg';
        
        const time = new Date(reading.created_at).toLocaleTimeString();
        readingElement.innerHTML = `
          <div class="flex justify-between items-center">
            <span class="text-sm text-gray-500">${time}</span>
            <div class="space-x-4">
              <span class="text-blue-600">${reading.temperature}°C</span>
              <span class="text-green-600">${reading.humidity}%</span>
              <span class="text-purple-600">${reading.gas_level} PPM</span>
            </div>
          </div>
        `;
        
        previousReadingsList.appendChild(readingElement);
      });
    } else {
      previousReadingsList.innerHTML = '<div class="text-gray-500">No readings found for this date</div>';
    }
  } catch (error) {
    console.error('Error fetching previous readings:', error);
    showNotification('Error fetching previous readings');
  }
}

// Add a new reading to the list
function addReadingToList(reading) {
  const readingsList = document.getElementById('readings-list');
  const readingElement = document.createElement('div');
  readingElement.className = 'p-4 bg-gray-50 rounded-lg';
  
  const time = new Date(reading.created_at).toLocaleTimeString();
  readingElement.innerHTML = `
    <div class="flex justify-between items-center">
      <span class="text-sm text-gray-500">${time}</span>
      <div class="space-x-4">
        <span class="text-blue-600">${reading.temperature}°C</span>
        <span class="text-green-600">${reading.humidity}%</span>
        <span class="text-purple-600">${reading.gas_level} PPM</span>
      </div>
    </div>
  `;
  
  readingsList.insertBefore(readingElement, readingsList.firstChild);
  
  if (readingsList.children.length > 10) {
    readingsList.removeChild(readingsList.lastChild);
  }
}

// Update dashboard with new values
function updateDashboard(data) {
  const tempElement = document.getElementById('temperature-value');
  const tempStatus = document.getElementById('temperature-status');
  tempElement.textContent = `${data.temperature}°C`;
  updateStatus(tempStatus, data.temperature, currentThresholds.temperature, 'Temperature');

  const humidityElement = document.getElementById('humidity-value');
  const humidityStatus = document.getElementById('humidity-status');
  humidityElement.textContent = `${data.humidity}%`;
  updateStatus(humidityStatus, data.humidity, currentThresholds.humidity, 'Humidity');

  const gasElement = document.getElementById('gas-value');
  const gasStatus = document.getElementById('gas-status');
  gasElement.textContent = `${data.gas_level} PPM`;
  updateStatus(gasStatus, data.gas_level, currentThresholds.gas, 'Gas level');
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

// Set up charts
function setupCharts() {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
      }
    },
    plugins: {
      legend: {
        display: true,
      }
    }
  };

  temperatureChart = new Chart(document.getElementById('temperatureChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Temperature (°C)',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        tension: 0.1
      }]
    },
    options
  });

  humidityChart = new Chart(document.getElementById('humidityChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Humidity (%)',
        data: [],
        borderColor: 'rgb(34, 197, 94)',
        tension: 0.1
      }]
    },
    options
  });

  moistureChart = new Chart(document.getElementById('moistureChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Gas Levels (PPM)',
        data: [],
        borderColor: 'rgb(147, 51, 234)',
        tension: 0.1
      }]
    },
    options
  });
}

// Update charts with new data
function updateCharts() {
  const labels = readings.map(r => new Date(r.created_at).toLocaleTimeString());
  
  temperatureChart.data.labels = labels;
  temperatureChart.data.datasets[0].data = readings.map(r => r.temperature);
  temperatureChart.update();

  humidityChart.data.labels = labels;
  humidityChart.data.datasets[0].data = readings.map(r => r.humidity);
  humidityChart.update();

  moistureChart.data.labels = labels;
  moistureChart.data.datasets[0].data = readings.map(r => r.gas_level);
  moistureChart.update();
}

// Show notifications
function showNotification(message) {
  let notificationArea = document.getElementById('notification-area');
  if (!notificationArea) {
    notificationArea = document.createElement('div');
    notificationArea.id = 'notification-area';
    notificationArea.className = 'fixed bottom-4 right-4 z-50';
    document.body.appendChild(notificationArea);
  }

  const notification = document.createElement('div');
  notification.className = 'bg-blue-500 text-white px-4 py-2 rounded shadow-lg mb-2';
  notification.textContent = message;
  notificationArea.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Initialize the dashboard when the page loads
document.addEventListener('DOMContentLoaded', initDashboard);