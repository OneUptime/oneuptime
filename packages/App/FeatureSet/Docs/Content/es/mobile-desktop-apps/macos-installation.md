# Guía de instalación en macOS

Instala OneUptime como una aplicación de escritorio nativa en macOS para un monitoreo y gestión de incidentes fluidos.

## Métodos de instalación

### Método 1: Safari (recomendado para macOS)

Safari proporciona una excelente integración de PWA con las características nativas de macOS.

1. **Abre OneUptime en Safari**

   - Inicia el navegador Safari
   - Navega a la URL de tu instancia de OneUptime
   - Inicia sesión en tu cuenta de OneUptime
   - Espera a que la página cargue completamente

2. **Instala la PWA**

   - Haz clic en **Archivo** en la barra de menú
   - Selecciona **"Agregar al Dock"** (macOS Sonoma+)
   - O busca el **ícono de instalación** en la barra de direcciones
   - Alternativamente: **Archivo** → **"Agregar a pantalla de inicio"** (macOS más antiguo)

3. **Personaliza la instalación**

   - **Nombre de la aplicación**: Modifica si lo deseas (predeterminado: OneUptime)
   - **Dock**: Elige agregar al Dock
   - **Launchpad**: Agrega a Launchpad para fácil acceso

4. **Inicia la aplicación**
   - Encuentra OneUptime en el Dock, Launchpad o la carpeta Aplicaciones
   - Haz clic para abrir en una ventana dedicada
   - La aplicación se ejecuta independientemente del navegador Safari

### Método 2: Google Chrome

Chrome ofrece un sólido soporte para PWA con excelente integración de escritorio.

1. **Abre OneUptime en Chrome**

   - Inicia Google Chrome
   - Ve a tu instancia de OneUptime
   - Asegúrate de haber iniciado sesión
   - Permite que la página cargue completamente

2. **Instala a través del menú**

   - Busca el **ícono de instalación** (⊞) en la barra de direcciones
   - Haz clic en **"Instalar OneUptime"**
   - O usa el **menú de Chrome** → **Más herramientas** → **Crear acceso directo**

3. **Opciones de instalación**

   - Marca **"Abrir como ventana"** para una experiencia de aplicación nativa
   - Personaliza el nombre de la aplicación si es necesario
   - Haz clic en **"Instalar"** o **"Crear"**

4. **Acceder a la aplicación**
   - Encuentra OneUptime en la carpeta Aplicaciones
   - O accede a través de la búsqueda de Spotlight
   - Ancla al Dock para un acceso rápido

### Método 3: Microsoft Edge

Edge proporciona un sólido soporte para PWA con buena integración en macOS.

1. **Abre OneUptime en Edge**

   - Inicia Microsoft Edge
   - Navega a la URL de OneUptime
   - Completa el proceso de inicio de sesión

2. **Instala la aplicación**
   - Haz clic en el **menú de tres puntos** → **Aplicaciones** → **Instalar este sitio como aplicación**
   - O busca la solicitud de instalación en la barra de direcciones
   - Personaliza el nombre de la aplicación si lo deseas
   - Haz clic en **"Instalar"**

### Opciones de personalización

### Dock y Launchpad

1. **Posición en el Dock**: Arrastra OneUptime a la posición preferida en el Dock
2. **Tamaño del Dock**: Cambia el tamaño del ícono en las preferencias del Dock
3. **Organización del Launchpad**: Crea una carpeta de aplicaciones de monitoreo
4. **Notificaciones de insignia**: Muestra el recuento de incidentes en el ícono del Dock

### Barra de menú y notificaciones

1. **Centro de notificaciones**

   - Preferencias del sistema → Notificaciones → OneUptime
   - Configura los estilos de alerta y la entrega
   - Establece niveles de prioridad para diferentes tipos de incidentes

2. **Integración con la barra de menú**
   - Barra de menú nativa para PWAs de Safari
   - Elementos de menú personalizados para acciones frecuentes
   - Atajos de teclado para tareas comunes

## Solución de problemas

### Problemas de instalación

**"Agregar al Dock" no está disponible en Safari:**

```
Soluciones:
1. Asegúrate de tener macOS Sonoma (14.0) o posterior
2. Actualiza Safari a la última versión
3. Prueba la alternativa: Archivo → Agregar a pantalla de inicio
4. Limpia el caché de Safari e intenta de nuevo
5. Usa Chrome o Edge como alternativa
```

**La PWA no se instala o se bloquea:**

```
Soluciones:
1. Comprueba la compatibilidad con la versión de macOS
2. Asegura suficiente espacio en disco (100 MB+)
3. Actualiza el navegador a la última versión
4. Limpia el caché y las cookies del navegador
5. Deshabilita temporalmente las extensiones del navegador
6. Reinicia el Mac e intenta la instalación de nuevo
```

**La aplicación no aparece en Aplicaciones:**

```
Soluciones:
1. Comprueba Launchpad para el ícono de OneUptime
2. Busca con Spotlight (⌘+Espacio)
3. Busca en la sección de gestión de PWA del navegador
4. Intenta reinstalar con un navegador diferente
5. Comprueba si se instaló con un nombre diferente
```

### Problemas de notificaciones

**Las notificaciones de macOS no funcionan:**

```
Soluciones:
1. Preferencias del sistema → Notificaciones → OneUptime
2. Habilita "Permitir notificaciones"
3. Establece el estilo de alerta apropiado (banners/alertas)
4. Comprueba la configuración de No molestar
5. Verifica la configuración de notificaciones de OneUptime
6. Concede permisos de notificación cuando se solicite
```

## Desinstalación

### Eliminación completa

1. **Método de la carpeta Aplicaciones**

   - Abre la carpeta Aplicaciones
   - Encuentra OneUptime
   - Arrastra a la Papelera o haz clic derecho → Mover a la Papelera

2. **Método del Dock**

   - Haz clic derecho en OneUptime en el Dock
   - Selecciona "Opciones" → "Eliminar del Dock"
   - Luego elimina de la carpeta Aplicaciones

3. **Gestión de PWA del navegador**
   - **Chrome**: chrome://apps/ → Encuentra OneUptime → Eliminar
   - **Edge**: edge://apps/ → Encuentra OneUptime → Desinstalar
   - **Safari**: No hay página de gestión dedicada

### Desinstalación limpia

Elimina todos los datos asociados:

```bash
# Limpia los datos de PWA de Safari (datos generales del sitio web)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Limpia los datos de PWA de Chrome
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Limpia los datos de PWA de Edge
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Actualizaciones y mantenimiento

### Actualizaciones automáticas

- La PWA de OneUptime se actualiza automáticamente cuando está en línea
- No se requieren actualizaciones de la App Store
- Las nuevas funciones están disponibles de inmediato
- Las actualizaciones críticas se aplican al instante

### Proceso de actualización manual

Fuerza la actualización de la aplicación:

1. **PWAs de Safari**: Actualiza dentro del navegador Safari
2. **PWAs de Chrome**: Haz clic derecho en la aplicación → Recargar o ⌘+R
3. **Actualización completa**: Cierra la aplicación, vuelve a abrir el navegador, visita OneUptime

### Programación de mantenimiento

Mantenimiento regular para un rendimiento óptimo:

**Semanal:**

- Reinicia la aplicación OneUptime
- Limpia el caché del navegador si tienes problemas
- Comprueba si hay actualizaciones de macOS

**Mensual:**

- Revisa el uso del almacenamiento y limpia si es necesario
- Actualiza los navegadores si no se actualizan automáticamente
- Verifica que la configuración de notificaciones siga funcionando

## Integración con las características de macOS

### Integración con la aplicación Atajos

Crea atajos personalizados para OneUptime:

1. Abre la aplicación **Atajos**
2. Crea un **Nuevo atajo**
3. Agrega la acción **"Abrir aplicación"**
4. Selecciona **OneUptime**
5. Agrega a Siri para activación por voz

### Integración con Automator

Automatiza las tareas de OneUptime:

1. Inicia **Automator**
2. Crea una **Aplicación** o **Flujo de trabajo**
3. Agrega la acción **"Iniciar aplicación"**
4. Selecciona la PWA de OneUptime
5. Agrega pasos de automatización adicionales

### Integración con Terminal

Gestiona OneUptime a través de Terminal:

```bash
# Crea un alias para abrir OneUptime rápidamente
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Función para comprobar si OneUptime está en ejecución
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Seguridad y privacidad

### Características de seguridad de macOS

1. **Gatekeeper**: Asegura que las instalaciones de PWA sean de fuentes confiables
2. **Protección de integridad del sistema**: Protege los archivos del sistema
3. **FileVault**: Cifra el disco para la protección de datos
4. **Llavero**: Almacenamiento seguro de credenciales

### Consideraciones de privacidad

1. **Servicios de ubicación**: Configura si es necesario para el monitoreo
2. **Cámara/Micrófono**: Concede permisos según sea necesario
3. **Grabación de pantalla**: Puede ser necesario para ciertas funciones de monitoreo
4. **Acceso a la red**: Asegura una configuración adecuada del firewall

### Buenas prácticas

1. **Actualizaciones regulares**: Mantén macOS y los navegadores actualizados
2. **Autenticación sólida**: Usa Touch ID/Face ID cuando estén disponibles
3. **Seguridad de red**: Usa VPN para acceso remoto de monitoreo
4. **Copia de seguridad de datos**: Las copias de seguridad regulares de Time Machine incluyen los datos de la PWA
5. **Revisión de permisos**: Revisa periódicamente los permisos concedidos
