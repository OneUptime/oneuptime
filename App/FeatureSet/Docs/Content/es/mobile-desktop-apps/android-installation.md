# Guía de instalación en Android

Instala OneUptime como una aplicación nativa en tu dispositivo Android para disfrutar de la mejor experiencia de monitoreo.

## Métodos de instalación

### Método 1: Navegador Chrome (recomendado)

1. **Abre OneUptime en Chrome**
   - Inicia Google Chrome en tu dispositivo Android
   - Navega a la URL de tu instancia de OneUptime
   - Espera a que la página cargue completamente

2. **Solicitud de instalación**
   - Busca el banner "Agregar a pantalla de inicio" en la parte inferior
   - Toca "Instalar" o "Agregar a pantalla de inicio"
   - Si no ves la solicitud, toca el menú de tres puntos (⋮) en la esquina superior derecha

3. **Instalación manual a través del menú**
   - Toca el menú de Chrome (tres puntos)
   - Selecciona "Agregar a pantalla de inicio" o "Instalar aplicación"
   - Personaliza el nombre de la aplicación si lo deseas
   - Toca "Agregar" para confirmar

4. **Inicia la aplicación**
   - Encuentra el ícono de OneUptime en tu pantalla de inicio o cajón de aplicaciones
   - Toca para abrir la aplicación en modo de pantalla completa

### Método 2: Samsung Internet

1. **Abre OneUptime**
   - Inicia el navegador Samsung Internet
   - Ve a tu instancia de OneUptime
   - Espera a que la página cargue completamente

2. **Agregar a la pantalla de inicio**
   - Toca el botón de menú (tres líneas)
   - Selecciona "Agregar página a" → "Pantalla de inicio"
   - Ingresa el nombre de la aplicación y toca "Agregar"

3. **Iniciar**
   - Encuentra el ícono de la aplicación en tu pantalla de inicio
   - Toca para abrir OneUptime en modo aplicación

### Método 3: Firefox

1. **Abre OneUptime**
   - Inicia el navegador Firefox
   - Navega a tu URL de OneUptime
   - Permite que la página cargue completamente

2. **Instalar**
   - Toca el menú de tres puntos
   - Selecciona "Instalar" (si está disponible)
   - O selecciona "Agregar a pantalla de inicio"
   - Confirma la instalación

### Opciones de personalización

### Nombre de la aplicación
- Durante la instalación, puedes personalizar el nombre de la aplicación
- Predeterminado: "OneUptime"
- Recomendado: Mantén "OneUptime" o agrega el nombre de tu empresa

### Configuración de notificaciones
1. **Conceder permisos**
   - Permite las notificaciones cuando se te solicite
   - Ve a Configuración → Aplicaciones → OneUptime → Notificaciones
   - Habilita todas las categorías de notificaciones para una mejor experiencia

2. **Personalizar alertas**
   - Configura qué incidentes activan notificaciones
   - Establece niveles de prioridad de notificaciones
   - Elige preferencias de sonido y vibración

## Solución de problemas

### Problemas de instalación

**"Agregar a pantalla de inicio" no aparece:**
```
1. Limpia el caché y las cookies del navegador
2. Asegúrate de estar en HTTPS (conexión segura)
3. Espera 2-3 minutos en la página antes de buscar la solicitud
4. Verifica si se cumplen los requisitos de PWA en tu instancia de OneUptime
```

**La instalación falla:**
```
1. Libera espacio de almacenamiento (necesitas al menos 50 MB)
2. Actualiza tu navegador a la última versión
3. Reinicia tu navegador e intenta de nuevo
4. Prueba con un navegador diferente (Chrome recomendado)
```

**El ícono de la aplicación no aparece:**
```
1. Verifica la pantalla de inicio y el cajón de aplicaciones
2. Busca en la sección "Agregadas recientemente"
3. Busca "OneUptime" en el cajón de aplicaciones
4. Reinstala si es necesario
```

### Problemas de notificaciones

**No recibes notificaciones:**
```
1. Comprueba los permisos de notificaciones:
   - Configuración → Aplicaciones → OneUptime → Permisos → Notificaciones
2. Asegúrate de que las notificaciones estén habilitadas en el panel de OneUptime
3. Comprueba la configuración de No molestar
4. Verifica que la optimización de batería no bloquee OneUptime
```

**Notificaciones retrasadas:**
```
1. Deshabilita la optimización de batería para OneUptime:
   - Configuración → Aplicaciones → OneUptime → Batería → Optimizar el uso de la batería
2. Permite la actividad en segundo plano
3. Comprueba la configuración del ahorro de datos
```

## Desinstalación

### Eliminar la aplicación
1. **Mantén pulsado** el ícono de OneUptime en la pantalla de inicio
2. Selecciona **"Desinstalar"** o arrastra a la papelera
3. Confirma la eliminación

### Método alternativo
1. Ve a **Configuración → Aplicaciones**
2. Busca **"OneUptime"**
3. Toca **"Desinstalar"**
4. Confirma la eliminación

## Actualizaciones y mantenimiento

### Actualizaciones automáticas
La PWA de OneUptime se actualiza automáticamente:
- **Actualizaciones automáticas**: La aplicación se actualiza cuando la visitas mientras estás en línea
- **Sin actualizaciones manuales**: A diferencia de las aplicaciones de la tienda, no se requiere acción del usuario
- **Actualizaciones instantáneas**: Las nuevas funciones están disponibles de inmediato
- **Actualizaciones reversibles**: Las actualizaciones defectuosas pueden revertirse rápidamente

## Configuración avanzada

### Opciones de desarrollador
Para usuarios avanzados que desean inspeccionar la PWA:
1. Habilita las opciones de desarrollador en Android
2. Conecta a la computadora con ADB
3. Usa Chrome DevTools para la depuración remota

### Configuración de red
- Configura VPN si accedes a una instancia interna de OneUptime
- Configura los ajustes de proxy si tu organización lo requiere
- Asegúrate de que el firewall permita los recursos de la PWA

## Actualizaciones

La PWA de OneUptime se actualiza automáticamente:
- **Actualizaciones automáticas**: La aplicación se actualiza cuando la visitas mientras estás en línea
- **Sin actualizaciones manuales**: A diferencia de las aplicaciones de la tienda, no se requiere acción del usuario
- **Actualizaciones instantáneas**: Las nuevas funciones están disponibles de inmediato
- **Actualizaciones reversibles**: Las actualizaciones defectuosas pueden revertirse rápidamente

## Buenas prácticas

### Para un rendimiento óptimo
1. **Primer inicio**: Siempre en línea para la configuración inicial
2. **Uso regular**: Abre la aplicación regularmente para mantener el caché actualizado
3. **Gestión del almacenamiento**: Mantén suficiente espacio libre
4. **Red**: Usa Wi-Fi para la instalación inicial y las actualizaciones importantes

### Recomendaciones de seguridad
1. **Solo HTTPS**: Solo instala desde instancias de OneUptime seguras
2. **URLs oficiales**: Verifica que estés instalando desde la URL oficial de OneUptime de tu organización
3. **Permisos**: Solo concede los permisos necesarios
4. **Actualizaciones**: Mantén actualizado tu sistema operativo Android y los navegadores
