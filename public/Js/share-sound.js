// Audio para el botón de compartir
const audio = new Audio('./audio/share-click.mp3');
audio.volume = 1.0;

const playShareSound = () => {
    console.log('🔈 Intentando reproducir sonido...');
    
    // Reiniciar el audio si ya estaba reproduciéndose
    audio.currentTime = 0;
    
    try {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('✅ Sonido reproducido correctamente');
                })
                .catch(error => {
                    console.error('❌ Error al reproducir:', error);
                    console.log('🔍 Ruta del audio:', audio.src);
                });
        }
    } catch (error) {
        console.error('❌ Error general:', error);
    }
};

// Función para precargar el audio
function preloadShareSound() {
    shareButtonSound.load();
}
