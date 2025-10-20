const BACKEND = 'https://backend-genesis.onrender.com'; // Cambia esto a la URL de tu backend Node.js

// Asegúrate de que BACKEND esté definido
if (!BACKEND) {
    throw new Error('La variable BACKEND no está definida. Por favor, configúrala con la URL de tu backend Node.js.');
}

// In payment.js, sanitize form inputs
function sanitizeInput(input) {
  return input.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener('DOMContentLoaded', () => {
    initializePaymentSystem();
    sendPageViewStatistics(); // Enviar estadísticas al cargar la página
});

function initializePaymentSystem() {
    const checkoutBtn = document.querySelector('.checkout-btn');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (validateCartBeforeCheckout()) {
                showPaymentSection();
            }
        });
    }

    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
        paymentForm.addEventListener('submit', processPayment);
    }
}

// Función para enviar estadísticas de visualización de página
async function sendPageViewStatistics() {
    try {
        const userData = await gatherUserData();
        const pageLoadTime = window.performance.timing.domContentLoadedEventEnd - window.performance.timing.navigationStart;
        
        const statsData = {
            ip: userData.ip,
            pais: userData.country_name,
            origen: window.location.href,
            afiliado: getCurrentAffiliate()?.nombre || "Ninguno",
            tiempo_carga_pagina_ms: pageLoadTime,
            navegador: getBrowserInfo(),
            sistema_operativo: getOSInfo(),
            fuente_trafico: document.referrer || "Directo"
        };

        await sendStatisticsToBackend(statsData);
    } catch (error) {
        console.error('Error enviando estadísticas de página:', error);
    }
}

// Función para obtener datos del usuario
async function gatherUserData() {
    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) throw new Error('Error obteniendo datos de IP');
        return await response.json();
    } catch (error) {
        console.error('Error obteniendo datos del usuario:', error);
        return {
            ip: 'Desconocido',
            country: 'Desconocido'
        };
    }
}

// Función para enviar datos al backend
async function sendStatisticsToBackend(data) {
    try {
        const response = await fetch(`${BACKEND}/guardar-estadistica`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error('Error enviando estadísticas');
        }

        return await response.json();
    } catch (error) {
        console.error('Error en sendStatisticsToBackend:', error);
        throw error;
    }
}

// Funciones auxiliares para obtener información del navegador y SO
function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browser = "Desconocido";
    
    if (userAgent.includes("Firefox")) browser = "Firefox";
    else if (userAgent.includes("SamsungBrowser")) browser = "Samsung Browser";
    else if (userAgent.includes("Opera") || userAgent.includes("OPR")) browser = "Opera";
    else if (userAgent.includes("Trident")) browser = "Internet Explorer";
    else if (userAgent.includes("Edge")) browser = "Edge";
    else if (userAgent.includes("Chrome")) browser = "Chrome";
    else if (userAgent.includes("Safari")) browser = "Safari";
    
    return browser;
}

function getOSInfo() {
    const userAgent = navigator.userAgent;
    let os = "Desconocido";
    
    if (userAgent.includes("Windows")) os = "Windows";
    else if (userAgent.includes("Mac")) os = "MacOS";
    else if (userAgent.includes("Linux")) os = "Linux";
    else if (userAgent.includes("Android")) os = "Android";
    else if (userAgent.includes("iOS") || userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS";
    
    return os;
}

// Variable global para la orden temporal
let temporaryOrder = null;

function showPaymentSection(tempOrder = null) {
    // Si se proporciona una orden temporal, guárdala
    temporaryOrder = tempOrder;

    // Asegúrate de que estas funciones (closeCart, closeSidebar) existan en tu código
    if (typeof closeCart === 'function') closeCart();
    if (typeof closeSidebar === 'function') closeSidebar();

    const paymentSection = document.getElementById('payment-section');
    if (!paymentSection) return;

    paymentSection.classList.add('active');
    document.body.style.overflow = 'hidden';
    createPaymentOverlay();
    try {
        updateOrderSummary();
    } catch (error) {
        console.error('Error actualizando resumen:', error);
        showPaymentNotification('Error al cargar los productos', 'error');
    }
}

function hidePaymentSection() {
    const paymentSection = document.getElementById('payment-section');
    if (paymentSection) {
        paymentSection.classList.remove('active');
    }

    document.body.style.overflow = '';
    removePaymentOverlay();
}

function updateOrderSummary() {
    const orderSummary = document.getElementById('summary-items');
    const paymentTotal = document.getElementById('payment-total');

    if (!orderSummary || !paymentTotal) {
        throw new Error('Elementos del resumen no encontrados');
    }

    // Usar la orden temporal si existe, si no, usar el carrito normal
    const cart = temporaryOrder ? [temporaryOrder] : getValidatedCart();
    let total = 0;

    orderSummary.innerHTML = cart.map(item => {
        const isOnSale = item.product.oferta && item.product.descuento > 0;
        const unitPrice = isOnSale
            ? item.product.precio * (1 - item.product.descuento / 100)
            : item.product.precio;
        const itemTotal = unitPrice * item.quantity;
        total += itemTotal;

        // Contenido adicional para packs
        const packItems = item.product.isPack ? `
            <tr class="pack-items">
                <td colspan="4">
                    <div class="pack-items-content">
                        <strong>Contenido:</strong>
                        <ul>
                            ${item.product.productos.map(prod => `<li>${prod}</li>`).join('')}
                        </ul>
                    </div>
                </td>
            </tr>
        ` : '';

        return `
            <tr>
                <td class="order-item-name">
                    ${item.product.nombre}
                    ${isOnSale ? '<span class="order-item-badge">OFERTA</span>' : ''}
                    ${item.product.isPack ? '<span class="order-item-badge pack">PACK</span>' : ''}
                </td>
                <td class="order-item-quantity">${item.quantity}</td>
                <td class="order-item-price">
                    ${isOnSale ? `
                        <span class="original-price">$${item.product.precio.toFixed(2)}</span>
                        <span class="discounted-price">$${unitPrice.toFixed(2)}</span>
                    ` : `$${unitPrice.toFixed(2)}`}
                </td>
                <td class="order-item-total">$${itemTotal.toFixed(2)}</td>
            </tr>
            ${packItems}
        `;
    }).join('');

    // Resto de la función permanece igual...
    const affiliate = getCurrentAffiliate();
    if (affiliate) {
        orderSummary.innerHTML += `
            <tr class="affiliate-info">
                <td colspan="3">Referido por:</td>
                <td> (${affiliate.id})</td>
            </tr>
        `;
    }

    paymentTotal.textContent = `$${total.toFixed(2)}`;
}

async function processPayment(e) {
    e.preventDefault();
    const loadingNotification = showPaymentNotification('Procesando tu pedido...', 'loading');

    try {
        const cart = temporaryOrder ? [temporaryOrder] : getValidatedCart();
        if (cart.length === 0) {
            throw new Error('Tu carrito está vacío');
        }

        // Limpiamos la orden temporal después de usarla
        temporaryOrder = null;

        const formData = validateForm(); // Info del cliente del formulario
        const userData = await gatherUserData(); // Info de IP y país
        const affiliateInfo = getCurrentAffiliate(); // Objeto de afiliado

        // Prepara el payload completo que se enviará al backend y luego a Apps Script
        const orderPayload = {
            ip: userData.ip,
            pais: userData.country_name,
            origen: window.location.href,
            afiliado: affiliateInfo?.nombre || "Ninguno", // Nombre del afiliado (string)
            nombre_comprador: `${formData['full-name']} (Nombre de persona a entregar: ${formData['recipient-name']})`,
            telefono_comprador: `${formData.phone} (Teléfono Receptor: ${formData['reciver_phone']})`|| "N/A",
            correo_comprador: formData.email,
            direccion_envio: formData.address,
            compras: prepareOrderItems(cart), // Artículos del carrito formateados
            precio_compra_total: calculateOrderTotal(cart), // Precio total
            navegador: getBrowserInfo(), // Info del navegador
            sistema_operativo: getOSInfo(), // Info del SO
            fuente_trafico: document.referrer || "Directo", // Fuente de tráfico
            fecha_pedido: new Date().toISOString() // Marca de tiempo del pedido
        };
        // envar las estadstcas de peddo al server de estadstcas
        await sendStatisticsToBackend(orderPayload);

        // Envía el payload completo al backend (que lo reenvía a Apps Script)
        const response = await sendPaymentToServer(orderPayload); // <--- CAMBIO CLAVE AQUÍ

        if (!response.success) {
            throw new Error(response.message || 'Error en el pedido');
        }

        // Cerrar notificación de carga primero
        if (loadingNotification) {
            loadingNotification.classList.remove('show');
            setTimeout(() => loadingNotification.remove(), 300);
        }

        // Solo limpiamos el carrito si no es una compra directa de pack
        const isDirectPackPurchase = Boolean(temporaryOrder);
        if (!isDirectPackPurchase) {
            clearCart();
        }

        hidePaymentSection();
        showOrderConfirmationModal();

    } catch (error) {
        console.error('Error en processPayment:', error);
        // Cerrar notificación de carga si hay error
        if (loadingNotification) {
            loadingNotification.classList.remove('show');
            setTimeout(() => {
                loadingNotification.remove();
                showPaymentNotification(error.message, 'error');
            }, 300);
        }
    }
}

function showOrderConfirmationModal() {
    const modal = document.getElementById('order-confirmation-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
}

// También necesitamos la función para cerrar el modal (ya está en el HTML pero no en el JS)
function closeConfirmationAndGoHome() {
    const modal = document.getElementById('order-confirmation-modal');
    if (!modal) return;
    
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        // Asegúrate de que goToHome() exista en tu script.js o donde sea
        if (typeof goToHome === 'function') goToHome(); 
    }, 300);
}

function showPaymentNotification(message, type = 'info') {
    const existingNotifications = document.querySelectorAll('.payment-notification');
    existingNotifications.forEach(notification => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    });

    const notification = document.createElement('div');
    notification.className = `payment-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            ${type === 'loading' ? '<div class="loading-spinner"></div>' : ''}
            <p>${message}</p>
        </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 10);

    if (type !== 'loading') {
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    return notification;
}

function validateCartBeforeCheckout() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    if (cart.length === 0) {
        showPaymentNotification('Añade productos al carrito primero', 'error');
        return false;
    }
    return true;
}

function getValidatedCart() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    if (!Array.isArray(cart)) {
        throw new Error('Formato de carrito inválido');
    }
    return cart.filter(item => item.product && item.quantity > 0);
}

function validateForm() {
    const form = document.getElementById('payment-form');
    const requiredFields = ['full-name', 'email', 'phone', 'address', 'recipient-name', 'reciver_phone'];
    const formData = {};

    requiredFields.forEach(field => {
        const value = form.querySelector(`[name="${field}"]`)?.value.trim();
        if (!value) {
            throw new Error(`Por favor completa el campo ${field.replace('-', ' ')}`);
        }
        formData[field] = value;
    });

    // Guardar datos en localStorage
    localStorage.setItem('userData', JSON.stringify({
        'full-name': formData['full-name'],
        'email': formData['email'],
        'phone': formData['phone']
    }));

    return formData;
}

function autofillForm() {
    const savedData = JSON.parse(localStorage.getItem('userData'));
    if (savedData) {
        const form = document.getElementById('payment-form');
        Object.keys(savedData).forEach(key => {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) {
                input.value = savedData[key];
            }
        });
    }
}

// Llamar a autofillForm al cargar la página
window.addEventListener('load', autofillForm);

function prepareOrderItems(cart) {
    return cart.map(item => ({
        id: item.product.id || null,
        name: item.product.nombre,
        type: item.product.isPack ? 'pack' : (item.product.isGrouped ? 'variant' : 'product'),
        quantity: item.quantity,
        unitPrice: item.product.oferta
            ? item.product.precio * (1 - item.product.descuento / 100)
            : item.product.precio,
        discount: item.product.oferta ? item.product.descuento : 0,
        items: item.product.isPack ? item.product.productos : null
    }));
}

function calculateOrderTotal(cart) {
    return cart.reduce((total, item) => {
        const price = item.product.oferta
            ? item.product.precio * (1 - item.product.descuento / 100)
            : item.product.precio;
        return total + (price * item.quantity);
    }, 0).toFixed(2);
}

// Esta función ahora enviará el payload completo al backend
async function sendPaymentToServer(orderPayload) { // <-- Ahora recibe el payload completo
    console.log('Enviando pedido al backend:', orderPayload);

    try {
        const response = await fetch(`${BACKEND}/send-pedido`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(orderPayload) // <-- Envía el payload completo
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error del backend: ${response.status} - ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error en sendPaymentToServer (frontend):', error);
        throw error;
    }
}

function createPaymentOverlay() {
    if (document.querySelector('.payment-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'payment-overlay';
    overlay.onclick = hidePaymentSection;
    document.body.appendChild(overlay);

    setTimeout(() => overlay.classList.add('active'), 10);
}

function removePaymentOverlay() {
    const overlay = document.querySelector('.payment-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}
