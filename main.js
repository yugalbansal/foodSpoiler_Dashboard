import './style.css';
import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Food type thresholds
const foodThresholds = {
  room: { temperature: 30, humidity: 70, gas: 250 },
  refrigerated: { temperature: 4, humidity: 40, gas: 100 },
  custom: null
};

// Default weights by storage type
const defaultWeights = {
  refrigerated: { temperature: 0.5, humidity: 0.3, gas: 0.2 },
  room: { temperature: 0.3, humidity: 0.4, gas: 0.3 },
  custom: { temperature: 0.33, humidity: 0.33, gas: 0.34 }
};

let currentThresholds = null;
let isMonitoring = false;
let readings = [];
let monitoringTimeout = null;
let noReadingsTimeout = null;
let lastReadingTimestamp = null;
let monitoringStartTime = null;
let currentWeights = defaultWeights.room;
let wsiHistory = [];

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
      if (selectedType === 'refrigerated') {
        showPopupMessage('We suggest you to keep your food items in room or normal conditions for better results.');
      }
      
      if (selectedType === 'custom') {
        customInputs.classList.remove('hidden');
        document.getElementById('custom-temperature').value = foodThresholds.custom?.temperature || 25;
        document.getElementById('custom-humidity').value = foodThresholds.custom?.humidity || 70;
        document.getElementById('custom-gas').value = foodThresholds.custom?.gas || 1000;
      } else {
        customInputs.classList.add('hidden');
        currentWeights = defaultWeights[selectedType];
        
        try {
          await updateThresholds(selectedType);
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
  
  startButton.addEventListener('click', async () => {
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
      // Calculate and display the spoilage status after stopping
      await calculateSpoilageStatus();
    }
  });
}

// Start monitoring readings
function startMonitoring() {
  readings = [];
  lastReadingTimestamp = null;
  monitoringStartTime = new Date().toISOString();
  
  // Clear any existing readings and status
  document.getElementById('readings-list').innerHTML = '';
  document.getElementById('waiting-message').classList.remove('hidden');
  document.getElementById('spoilage-status').classList.add('hidden');
  
  // Initialize with zero values in the UI but don't add to readings array
  const initialReading = {
    temperature: 0,
    humidity: 0,
    gas_level: 0,
    created_at: new Date().toISOString()
  };
  
  // Update UI with initial zero values
  updateDashboard(initialReading, false);
  
  // Reset the charts with empty data
  resetCharts();
  
  noReadingsTimeout = setTimeout(() => {
    document.getElementById('waiting-message').classList.add('hidden');
    document.getElementById('readings-list').innerHTML = 
      '<div class="text-gray-500">No new readings found</div>';
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
    console.log("Fetching latest data...");
    // Only fetch data that was created after monitoring started
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .gt('created_at', monitoringStartTime)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error("Supabase error:", error);
      throw error;
    }

    console.log("Fetched data:", data);

    if (data && data.length > 0) {
      const reading = data[0];
      const readingTimestamp = new Date(reading.created_at).getTime();
      
      console.log("Last reading timestamp:", lastReadingTimestamp);
      console.log("Current reading timestamp:", readingTimestamp);
      
      // Always process the first reading or if the new reading is more recent
      if (!lastReadingTimestamp || readingTimestamp > lastReadingTimestamp) {
        console.log("New reading detected");
        clearTimeout(noReadingsTimeout);
        
        // Safely find the waiting message element
        const waitingMessage = document.getElementById('waiting-message');
        if (waitingMessage) {
          waitingMessage.classList.add('hidden');
        } else {
          console.warn("Element 'waiting-message' not found");
        }
        
        lastReadingTimestamp = readingTimestamp;
        readings.push(reading);
        
        try {
          console.log("Updating dashboard with reading:", reading);
          updateDashboard(reading, true);
          console.log("Adding reading to list");
          addReadingToList(reading); // Make sure this function is properly defined
          console.log("Updating charts");
          updateCharts();
        } catch (innerError) {
          console.error("Error in update functions:", innerError);
          console.error(innerError.stack);
        }
      } else {
        console.log("Reading already processed or older than last reading");
      }
    } else {
      console.log("No new data found");
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    console.error(error.stack);
    showNotification('Error fetching sensor data');
  }
}

// Add a new reading to the list - THIS FUNCTION WAS COMMENTED OUT IN YOUR CODE
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
function updateDashboard(data, updateStatusIndicators = true) {
  const tempElement = document.getElementById('temperature-value');
  const tempStatus = document.getElementById('temperature-status');
  if (tempElement) tempElement.textContent = `${data.temperature}°C`;
  
  const humidityElement = document.getElementById('humidity-value');
  const humidityStatus = document.getElementById('humidity-status');
  if (humidityElement) humidityElement.textContent = `${data.humidity}%`;
  
  const gasElement = document.getElementById('gas-value');
  const gasStatus = document.getElementById('gas-status');
  if (gasElement) gasElement.textContent = `${data.gas_level} PPM`;
  
  if (updateStatusIndicators && currentThresholds) {
    // Call updateSensorStatus
    if (tempStatus) updateSensorStatus(tempStatus, data.temperature, currentThresholds.temperature, 'Temperature');
    if (humidityStatus) updateSensorStatus(humidityStatus, data.humidity, currentThresholds.humidity, 'Humidity');
    if (gasStatus) updateSensorStatus(gasStatus, data.gas_level, currentThresholds.gas, 'Gas level');
  } else {
    // Clear status indicators
    if (tempStatus) {
      tempStatus.textContent = '';
      tempStatus.className = 'mt-2 text-sm';
    }
    if (humidityStatus) {
      humidityStatus.textContent = '';
      humidityStatus.className = 'mt-2 text-sm';
    }
    if (gasStatus) {
      gasStatus.textContent = '';
      gasStatus.className = 'mt-2 text-sm';
    }
  }
}

// Update status indicators
function updateSensorStatus(element, value, threshold, sensorType) {
  if (value > threshold) {
    element.textContent = `⚠️ ${sensorType} above threshold!`;
    element.className = 'mt-2 text-sm text-red-600';
    showNotification(`Warning: ${sensorType} above threshold!`);
  } else {
    element.textContent = 'Normal';
    element.className = 'mt-2 text-sm text-green-600';
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

// Reset charts to empty state
function resetCharts() {
  temperatureChart.data.labels = [];
  temperatureChart.data.datasets[0].data = [];
  temperatureChart.update();

  humidityChart.data.labels = [];
  humidityChart.data.datasets[0].data = [];
  humidityChart.update();

  moistureChart.data.labels = [];
  moistureChart.data.datasets[0].data = [];
  moistureChart.update();
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

// Add updateThresholds function
async function updateThresholds(storageType) {
  const thresholds = foodThresholds[storageType];
  
  try {
    await supabase
      .from('thresholds')
      .delete()
      .neq('id', '0');
    
    const { error } = await supabase
      .from('thresholds')
      .insert([{
        temperature: thresholds.temperature,
        humidity: thresholds.humidity,
        gas_level: thresholds.gas,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);
    
    if (error) throw error;
    currentThresholds = thresholds;
  } catch (error) {
    console.error('Error updating thresholds:', error);
    throw error;
  }
}

// Update calculateSpoilageStatus function
async function calculateSpoilageStatus() {
  console.log('Calculating spoilage status...');
  console.log('Readings:', readings);
  
  if (readings.length === 0) {
    showNotification('No readings collected during monitoring');
    return;
  }
  
  try {
    // Validate readings data
    if (!readings.every(r => 
      typeof r.temperature === 'number' && 
      typeof r.humidity === 'number' && 
      typeof r.gas_level === 'number'
    )) {
      throw new Error('Invalid reading data format');
    }

    // Get active thresholds
    const thresholds = getActiveThresholds();
    if (!thresholds || !thresholds.temperature || !thresholds.humidity || !thresholds.gas) {
      throw new Error('Invalid thresholds configuration');
    }

    // Validate weights
    if (!currentWeights || 
        typeof currentWeights.temperature !== 'number' || 
        typeof currentWeights.humidity !== 'number' || 
        typeof currentWeights.gas !== 'number') {
      throw new Error('Invalid weights configuration');
    }

    // Calculate WSI
    const wsi = calculateWSI(readings);
    console.log('Calculated WSI:', wsi);
    
    if (typeof wsi !== 'number' || isNaN(wsi)) {
      throw new Error('Invalid WSI calculation result');
    }

    const statusInfo = getStatusInfo(wsi);
    console.log('Status info:', statusInfo);
    
    // Update the status display
    const spoilageStatus = document.getElementById('spoilage-status');
    if (!spoilageStatus) {
      throw new Error('Spoilage status element not found');
    }

    spoilageStatus.classList.remove('hidden');
    spoilageStatus.className = `p-4 mt-4 rounded-lg ${statusInfo.class}`;
    
    spoilageStatus.innerHTML = `
      <h3 class="font-bold mb-2">Analysis Results:</h3>
      <div>Weighted Spoilage Index: ${wsi.toFixed(2)}</div>
      <div class="mt-2 font-bold">${statusInfo.message}</div>
    `;
    
    // Calculate average values from readings
    const avgTemperature = readings.reduce((sum, r) => sum + r.temperature, 0) / readings.length;
    const avgHumidity = readings.reduce((sum, r) => sum + r.humidity, 0) / readings.length;
    const avgGasLevel = readings.reduce((sum, r) => sum + r.gas_level, 0) / readings.length;
    
    // Create the data object to be uploaded to Supabase with exact column names from schema
    const spoilageData = {
      avg_temperature: avgTemperature,
      avg_humidity: avgHumidity,
      avg_gas_level: avgGasLevel,
      temperature_threshold: thresholds.temperature,
      humidity_threshold: thresholds.humidity,
      gas_threshold: thresholds.gas,
      status_message: statusInfo.message
    };
    
    console.log('Saving spoilage data:', spoilageData);
    
    const { data, error } = await supabase
      .from('spoilage_status')
      .insert([spoilageData]);
    
    if (error) {
      console.error('Supabase error:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    showNotification('Spoilage status saved to database');
    
    // Update charts
    updateCharts();
    
  } catch (error) {
    console.error('Error calculating spoilage status:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      readings: readings,
      thresholds: getActiveThresholds(),
      weights: currentWeights
    });
    showNotification(`Failed to calculate spoilage status: ${error.message}`);
  }
}

// Update calculateWSI function
function calculateWSI(readings) {
  console.log('Calculating WSI with readings:', readings);
  
  const thresholds = getActiveThresholds();
  console.log('Active thresholds:', thresholds);
  
  if (!thresholds || !thresholds.temperature || !thresholds.humidity || !thresholds.gas) {
    throw new Error('Invalid thresholds configuration');
  }

  // Calculate average values
  const avgTemperature = readings.reduce((sum, r) => sum + (r.temperature || 0), 0) / readings.length;
  const avgHumidity = readings.reduce((sum, r) => sum + (r.humidity || 0), 0) / readings.length;
  const avgGasLevel = readings.reduce((sum, r) => sum + (r.gas_level || 0), 0) / readings.length;
  
  console.log('Average values:', {
    temperature: avgTemperature,
    humidity: avgHumidity,
    gas: avgGasLevel
  });
  
  // Calculate ratios (capped at 2)
  const tempRatio = Math.min(avgTemperature / thresholds.temperature, 2);
  const humidityRatio = Math.min(avgHumidity / thresholds.humidity, 2);
  const gasRatio = Math.min(avgGasLevel / thresholds.gas, 2);
  
  console.log('Ratios:', {
    temperature: tempRatio,
    humidity: humidityRatio,
    gas: gasRatio
  });
  
  // Calculate weighted components
  const tempComponent = tempRatio * (currentWeights.temperature || 0.33);
  const humidityComponent = humidityRatio * (currentWeights.humidity || 0.33);
  const gasComponent = gasRatio * (currentWeights.gas || 0.34);
  
  console.log('Weighted components:', {
    temperature: tempComponent,
    humidity: humidityComponent,
    gas: gasComponent
  });
  
  // Calculate final WSI (capped at 2)
  const wsi = Math.min(tempComponent + humidityComponent + gasComponent, 2);
  console.log('Final WSI:', wsi);
  
  if (isNaN(wsi)) {
    throw new Error('Invalid WSI calculation result');
  }
  
  return wsi;
}

// Update getActiveThresholds function
function getActiveThresholds() {
  try {
    const storageType = document.getElementById('food-type').value;
    console.log('Storage type:', storageType);
    
    if (storageType === 'custom') {
      const temp = parseFloat(document.getElementById('custom-temperature').value);
      const humidity = parseFloat(document.getElementById('custom-humidity').value);
      const gas = parseFloat(document.getElementById('custom-gas').value);
      
      if (isNaN(temp) || isNaN(humidity) || isNaN(gas)) {
        throw new Error('Invalid custom threshold values');
      }
      
      return { temperature: temp, humidity: humidity, gas: gas };
    } else {
      const thresholds = foodThresholds[storageType];
      if (!thresholds) {
        throw new Error(`No thresholds found for ${storageType}`);
      }
      return thresholds;
    }
  } catch (error) {
    console.error('Error getting active thresholds:', error);
    throw error;
  }
}

// Add getStatusInfo function
function getStatusInfo(wsi) {
  if (wsi <= 0.7) {
    return { 
      message: 'Optimal Storage Conditions', 
      class: 'bg-green-100 text-green-800',
      severity: 'low'
    };
  } else if (wsi <= 0.9) {
    return { 
      message: 'Good Conditions', 
      class: 'bg-green-50 text-green-600',
      severity: 'low'
    };
  } else if (wsi <= 1.0) {
    return { 
      message: 'Acceptable Conditions', 
      class: 'bg-yellow-50 text-yellow-600',
      severity: 'medium'
    };
  } else if (wsi <= 1.2) {
    return { 
      message: 'Caution: Spoiled', 
      class: 'bg-yellow-100 text-yellow-800',
      severity: 'medium'
    };
  } else if (wsi <= 1.5) {
    return { 
      message: 'Warning: Spoiled', 
      class: 'bg-orange-100 text-orange-800',
      severity: 'high'
    };
  } else {
    return { 
      message: 'Critical: Food Spoilage', 
      class: 'bg-red-100 text-red-800',
      severity: 'critical'
    };
  }
}

// Show notifications
function showNotification(message, type = 'info') {
  let notificationArea = document.getElementById('notification-area');
  if (!notificationArea) {
    notificationArea = document.createElement('div');
    notificationArea.id = 'notification-area';
    notificationArea.className = 'fixed bottom-4 right-4 z-50 space-y-2';
    document.body.appendChild(notificationArea);
  }

  // Remove any existing notifications
  const existingNotifications = notificationArea.querySelectorAll('.notification');
  existingNotifications.forEach(notification => notification.remove());

  const notification = document.createElement('div');
  notification.className = `notification bg-${type === 'error' ? 'red' : 'blue'}-500 text-white px-4 py-2 rounded shadow-lg mb-2 transition-opacity duration-300`;
  notification.textContent = message;
  notificationArea.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add showPopupMessage function
function showPopupMessage(message) {
  // Create popup container
  const popup = document.createElement('div');
  popup.className = 'fixed top-4 right-4 bg-white rounded-lg shadow-lg p-4 z-50 transform transition-all duration-300 ease-in-out';
  popup.style.maxWidth = '400px';
  
  // Create popup content
  popup.innerHTML = `
    <div class="flex justify-between items-start">
      <div class="flex-1">
        <p class="text-gray-800">${message}</p>
      </div>
      <button class="ml-4 text-gray-500 hover:text-gray-700 focus:outline-none">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  
  // Add to document
  document.body.appendChild(popup);
  
  // Add click handler for close button
  const closeButton = popup.querySelector('button');
  closeButton.addEventListener('click', () => {
    popup.remove();
  });
  
  // Auto close after 5 seconds
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-20px)';
    setTimeout(() => popup.remove(), 300);
  }, 5000);
}

// Initialize the dashboard when the page loads
document.addEventListener('DOMContentLoaded', function() {
  initDashboard();
  
  // Make sure we have a spoilage status element in the HTML
  if (!document.getElementById('spoilage-status')) {
    const containerDiv = document.querySelector('#readings-container') || document.body;
    const statusDiv = document.createElement('div');
    statusDiv.id = 'spoilage-status';
    statusDiv.className = 'hidden';
    containerDiv.appendChild(statusDiv);
  }
});
