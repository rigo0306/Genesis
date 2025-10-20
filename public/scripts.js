let serverStartTime;

// Function to update the server uptime display
function updateUptime() {
    if (!serverStartTime) return;
    
    const now = new Date();
    const diffMs = now - serverStartTime;

    const seconds = Math.floor((diffMs / 1000) % 60);
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
    const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    document.getElementById('uptime').textContent =
        `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Function to fetch server status and update the dashboard
async function fetchServerStatus() {
    try {
        const response = await fetch('/api/server-status');
        const data = await response.json();
        
        // Update server start time if not already set
        if (!serverStartTime) {
            serverStartTime = new Date(data.startTime);
            document.getElementById('start-time').textContent = 
                new Date(data.startTime).toLocaleString('es-ES', { 
                    timeZone: 'America/Havana' 
                });
        }

        // Update logs
        const logOutput = document.getElementById('log-output');
        logOutput.innerHTML = ''; // Clear previous logs
        data.logs.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.classList.add('log-entry');
            logEntry.textContent = log;
            logOutput.appendChild(logEntry);
        });
        logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
    } catch (error) {
        console.error('Error fetching server status:', error);
    }
}

// Function to fetch and update statistics
async function updateStatistics() {
    try {
        const response = await fetch('/obtener-estadisticas');
        const stats = await response.json();

        document.getElementById('total-requests').textContent = stats.length;

        if (stats.length > 0) {
            const lastStat = stats[stats.length - 1];
            document.getElementById('last-request').textContent =
                `${lastStat.fecha_hora_entrada} desde ${lastStat.pais} (${lastStat.ip})`;

            const uniqueIPs = new Set(stats.map(s => s.ip));
            document.getElementById('unique-users').textContent = uniqueIPs.size;

            const recurringUsers = stats.filter(s => s.tipo_usuario === 'Recurrente').length;
            document.getElementById('recurring-users').textContent = recurringUsers;
        } else {
            document.getElementById('last-request').textContent = 'N/A';
            document.getElementById('unique-users').textContent = '0';
            document.getElementById('recurring-users').textContent = '0';
        }
    } catch (error) {
        console.error('Error fetching statistics:', error);
        document.getElementById('total-requests').textContent = 'Error';
        document.getElementById('last-request').textContent = 'Error';
        document.getElementById('unique-users').textContent = 'Error';
        document.getElementById('recurring-users').textContent = 'Error';
    }
}

// Function to clear the console (client-side only)
function clearConsole() {
    document.getElementById('log-output').innerHTML = '';
}

// Function to copy logs to clipboard
function copyLogsToClipboard() {
    const logOutput = document.getElementById('log-output');
    const logsText = logOutput.innerText;
    
    navigator.clipboard.writeText(logsText)
        .then(() => alert('Logs copiados al portapapeles!'))
        .catch(err => {
            console.error('Error al copiar los logs:', err);
            alert('Error al copiar los logs. Por favor, inténtalo de nuevo.');
        });
}

// Function to clear statistics with better error handling
async function clearStatistics() {
    if (!confirm('¿Estás seguro de que deseas eliminar todas las estadísticas?\nEsta acción no se puede deshacer.')) {
        return;
    }

    try {
        const response = await fetch('/api/clear-statistics', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification('Estadísticas limpiadas correctamente', 'success');
            // Actualizar la vista
            await updateStatistics();
            await fetchServerStatus();
        } else {
            throw new Error(data.error || 'Error desconocido al limpiar las estadísticas');
        }
    } catch (error) {
        console.error('Error al limpiar estadísticas:', error);
        showNotification(error.message || 'Error al limpiar las estadísticas', 'error');
    }
}



// Initialize dashboard
function initDashboard() {
    // Update uptime every second
    setInterval(updateUptime, 1000);

    // Update server status and statistics every 3 seconds
    setInterval(() => {
        fetchServerStatus();
        updateStatistics();
    }, 30000);

    // Initial update
    fetchServerStatus();
    updateStatistics();
}

// Start dashboard when page loads
window.addEventListener('load', initDashboard);
function showNotification(message, type = 'info') {
    const notificationPanel = document.getElementById('notification-panel');
    if (!notificationPanel) {
        console.error('No se encontró el elemento #notification-panel');
        return;
    }

    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notificationPanel.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 10000); // Mantener duración de 10 segundos
}

// Actualizar el saludo para incluir la hora actual
function updateGreetingAndBackground() {
    const greetingElement = document.getElementById('dynamic-greeting');
    const now = new Date();
    const hour = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');

    let greetingMessage = '';
    let backgroundClass = '';
    let welcomeMessage = 'Bienvenido al Panel de Control de Genesis Backend';

    if (hour >= 6 && hour < 12) {
        greetingMessage = `🌅 Buenos días | ${hour}:${minutes}`;
        backgroundClass = 'morning';
    } else if (hour >= 12 && hour < 18) {
        greetingMessage = `☀️ Buenas tardes | ${hour}:${minutes}`;
        backgroundClass = 'afternoon';
    } else {
        greetingMessage = `🌙 Buenas noches | ${hour}:${minutes}`;
        backgroundClass = 'night';
    }

    // Actualizar el mensaje de saludo con formato HTML
    greetingElement.innerHTML = `
        <strong>${greetingMessage}</strong>
        <span style="margin-left: 15px; font-weight: normal;">${welcomeMessage}</span>
    `;

    // Cambiar la clase del banner para el fondo dinámico
    greetingElement.className = `greeting ${backgroundClass}`;
}

// Llamar a la función al cargar la página y actualizar cada minuto
updateGreetingAndBackground();
setInterval(updateGreetingAndBackground, 60000);
