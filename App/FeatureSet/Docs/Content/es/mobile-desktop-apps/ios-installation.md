# Guía de instalación en iOS

Instala OneUptime como una aplicación nativa en tu iPhone o iPad para un monitoreo fluido desde cualquier lugar.

## Métodos de instalación

### Método 1: Safari (recomendado)

Safari proporciona la mejor experiencia de PWA en dispositivos iOS.

1. **Abre OneUptime en Safari**
   - Inicia Safari en tu dispositivo iOS
   - Navega a la URL de tu instancia de OneUptime
   - Espera a que la página cargue completamente
   - Asegúrate de haber iniciado sesión en tu cuenta de OneUptime

2. **Acceder al menú compartir**
   - Toca el **botón Compartir** (cuadrado con flecha apuntando hacia arriba) en la barra de herramientas inferior
   - Desplázate por las opciones de compartir para encontrar "Agregar a pantalla de inicio"

3. **Agregar a la pantalla de inicio**
   - Toca **"Agregar a pantalla de inicio"**
   - Personaliza el nombre de la aplicación (predeterminado: "OneUptime")
   - Toca **"Agregar"** en la esquina superior derecha

4. **Inicia la aplicación**
   - Encuentra el ícono de OneUptime en tu pantalla de inicio
   - Toca para abrir en modo de aplicación a pantalla completa

### Método 2: Navegador Chrome

Aunque Chrome funciona, Safari es el recomendado para la mejor experiencia de PWA en iOS.

1. **Abre OneUptime en Chrome**
   - Inicia el navegador Chrome
   - Ve a tu instancia de OneUptime
   - Permite que la página cargue completamente

2. **Agregar a la pantalla de inicio**
   - Toca el **menú de tres puntos** (más opciones)
   - Selecciona **"Agregar a pantalla de inicio"**
   - Personaliza el nombre de la aplicación si lo deseas
   - Toca **"Agregar"**

### Método 3: Otros navegadores

Firefox, Edge y otros navegadores admiten la instalación básica de PWA:

1. **Abre OneUptime**
   - Inicia tu navegador preferido
   - Navega a la URL de OneUptime
   - Espera a que la página cargue completamente

2. **Busca la opción de instalación**
   - Comprueba el menú del navegador para "Agregar a pantalla de inicio" o "Instalar"
   - Sigue las instrucciones de instalación específicas del navegador

### Opciones de personalización

### Ícono y nombre de la aplicación
- **Nombre personalizado**: Cambia durante la instalación o posteriormente
- **Ubicación del ícono**: Organiza en carpetas o páginas específicas de la pantalla de inicio
- **Notificaciones de insignia**: Muestra el recuento de incidentes no leídos

### Configuración de notificaciones
1. **Habilitar notificaciones**
   - Cuando se solicite, toca **"Permitir"** para las notificaciones
   - O ve a Configuración → Notificaciones → OneUptime
   - Habilita todos los tipos de notificaciones para un monitoreo completo

2. **Personalizar estilos de alerta**
   - **Pantalla de bloqueo**: Muestra alertas de incidentes en el dispositivo bloqueado
   - **Estilo de banner**: Elige banners temporales o persistentes
   - **Sonidos**: Personaliza sonidos de notificación y vibración
   - **Alertas críticas**: Habilita para incidentes de alta prioridad (requiere permiso)

## Solución de problemas

### Problemas de instalación

**"Agregar a pantalla de inicio" no está visible:**
```
Soluciones:
1. Asegúrate de estar usando Safari (mejor compatibilidad)
2. Actualiza la página y espera 30 segundos
3. Verifica que estés en la URL correcta de OneUptime
4. Verifica la conexión HTTPS (busca el ícono del candado)
5. Limpia el caché de Safari: Configuración → Safari → Borrar historial y datos de sitios web
```

**La instalación completa pero no aparece ningún ícono:**
```
Soluciones:
1. Comprueba todas las páginas de la pantalla de inicio
2. Busca en la Biblioteca de aplicaciones (desliza hacia la izquierda más allá de la última página de la pantalla de inicio)
3. Usa la búsqueda de Spotlight para encontrar "OneUptime"
4. Reinicia el dispositivo y comprueba de nuevo
5. Reinstala si es necesario
```

**La aplicación se bloquea al iniciar:**
```
Soluciones:
1. Fuerza el cierre y vuelve a abrir la aplicación
2. Reinicia tu dispositivo iOS
3. Limpia el caché de Safari y reinstala
4. Asegúrate de que la versión de iOS sea 11.3 o superior
5. Libera espacio de almacenamiento del dispositivo
```

### Problemas de notificaciones

**No recibes notificaciones push:**
```
Comprueba estos ajustes:
1. Configuración → Notificaciones → OneUptime → Permitir notificaciones
2. Configuración → Tiempo de pantalla → Restricciones de contenido y privacidad → Aplicaciones permitidas
3. Configuración de No molestar
4. Comprueba la configuración de notificaciones en el panel de OneUptime
5. Cierra sesión y vuelve a iniciarla en OneUptime
```

**Notificaciones retrasadas o no recibidas:**
```
Soluciones:
1. Mantén la aplicación ejecutándose en segundo plano (no la cierres a la fuerza)
2. Deshabilita el modo de bajo consumo durante el monitoreo crítico
3. Comprueba la actualización de aplicaciones en segundo plano: Configuración → General → Actualización de aplicaciones en segundo plano
4. Asegúrate de que haya suficiente espacio de almacenamiento disponible
```

## Desinstalación

### Eliminar de la pantalla de inicio
1. **Mantén pulsado** el ícono de la aplicación OneUptime
2. Toca **"Eliminar aplicación"**
3. Selecciona **"Eliminar aplicación"**
4. Confirma la eliminación

### Método alternativo
1. Ve a **Configuración → General → Almacenamiento del iPhone**
2. Busca **OneUptime** en la lista de aplicaciones
3. Toca **"Eliminar aplicación"**
4. Confirma la eliminación

## Actualizaciones y mantenimiento

### Actualizaciones automáticas
- La PWA de OneUptime se actualiza automáticamente cuando está en línea
- No se requieren actualizaciones de la App Store
- Las nuevas funciones están disponibles de inmediato después del despliegue del servidor
- Las actualizaciones de seguridad críticas se aplican al instante

## Instalación específica para iPad

### Experiencia mejorada en iPad
1. **Interfaz más grande**: Diseños optimizados para el tamaño de pantalla del iPad
2. **Ventanas múltiples**: Ejecuta múltiples ventanas de OneUptime simultáneamente
3. **Atajos de teclado**: Compatibilidad total con teclados externos
4. **Arrastrar y soltar**: Mueve datos entre OneUptime y otras aplicaciones

### Pasos de instalación en iPad
Igual que en iPhone, pero con consideraciones adicionales:
- Usa el modo horizontal para ver el panel de manera óptima
- Considera configurar la vista dividida con otras aplicaciones de productividad
- Configura atajos de teclado para acciones comunes

## Integración con Apple Watch

Aunque OneUptime no tiene una aplicación watchOS dedicada, puedes:
- **Recibir notificaciones**: Las alertas de incidentes aparecen en el Apple Watch
- **Acciones rápidas**: Reconoce incidentes desde las notificaciones del reloj
- **Integración con Siri**: Pregunta a Siri sobre el estado del sistema (cuando está configurado)

## Configuración avanzada

### Integración con la aplicación Atajos
Crea atajos de Siri personalizados para OneUptime:
1. Abre la aplicación **Atajos**
2. Crea un **Nuevo atajo**
3. Agrega la acción **"Abrir aplicación"**
4. Selecciona **OneUptime**
5. Agrega una frase de voz como "Comprobar el estado del sistema"

### Modos de enfoque
Integra OneUptime con los modos de Enfoque de iOS:
1. **Configuración → Enfoque**
2. Selecciona o crea un modo de Enfoque
3. **Aplicaciones → Agregar aplicaciones → OneUptime**
4. Configura el comportamiento de notificación para diferentes estados de Enfoque

## Actualizaciones y mantenimiento

### Actualizaciones automáticas
- La PWA de OneUptime se actualiza automáticamente cuando está en línea
- No se requieren actualizaciones de la App Store
- Las nuevas funciones están disponibles de inmediato después del despliegue del servidor
- Las actualizaciones de seguridad críticas se aplican al instante

### Actualización manual
Fuerza la actualización de la aplicación:
1. Abre OneUptime en Safari
2. Desliza hacia abajo para actualizar
3. La aplicación descargará la última versión
4. Las nuevas funciones estarán disponibles de inmediato

### Gestión del caché
Mantén la aplicación funcionando de manera óptima:
- **Uso regular**: Abre la aplicación diariamente para mantener el caché actualizado
- **Monitoreo del almacenamiento**: Mantén al menos 1 GB de espacio libre
- **Acceso a la red**: Conéctate a WiFi regularmente para las actualizaciones

## Buenas prácticas

### Recomendaciones de seguridad
1. **Verifica la URL**: Solo instala desde la instancia oficial de OneUptime de tu organización
2. **Solo HTTPS**: Asegura una conexión segura (busca el ícono del candado)
3. **Actualizaciones regulares**: Mantén iOS actualizado con los parches de seguridad
4. **Permisos de la aplicación**: Solo concede los permisos necesarios

### Optimización del rendimiento
1. **Instalación con WiFi**: Usa WiFi para la instalación inicial y las actualizaciones importantes
2. **Actualización en segundo plano**: Habilita para recibir notificaciones oportunas
3. **Gestión del almacenamiento**: Mantén espacio libre adecuado
4. **Reinicio regular**: Reinicia la aplicación semanalmente para un rendimiento óptimo

### Buenas prácticas de monitoreo
1. **Notificaciones críticas**: Habilita solo para alertas de alta prioridad
2. **Múltiples dispositivos**: Instala tanto en iPhone como en iPad para redundancia
3. **Acceso del equipo**: Comparte la guía de instalación con los miembros del equipo
4. **Pruebas**: Prueba periódicamente la entrega de notificaciones y la funcionalidad sin conexión
