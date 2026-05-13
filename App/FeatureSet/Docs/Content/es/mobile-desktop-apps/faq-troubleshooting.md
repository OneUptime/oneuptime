# Preguntas frecuentes y solución de problemas

Preguntas frecuentes y soluciones para las aplicaciones móviles y de escritorio de OneUptime (PWA).

## Preguntas frecuentes generales

### ¿Qué es una aplicación web progresiva (PWA)?

Una aplicación web progresiva es una aplicación web que usa tecnologías web modernas para ofrecer experiencias similares a las de las aplicaciones nativas. Las PWA pueden instalarse directamente desde los navegadores sin tiendas de aplicaciones, funcionar sin conexión, enviar notificaciones push e integrarse con el sistema operativo de tu dispositivo.

### ¿Por qué OneUptime no usa las tiendas de aplicaciones tradicionales?

OneUptime usa tecnología PWA porque ofrece varias ventajas:
- **Actualizaciones instantáneas**: Sin esperar la aprobación de la tienda de aplicaciones ni actualizaciones manuales
- **Multiplataforma**: Una sola base de código funciona en todos los dispositivos
- **Sin límites de tamaño de descarga**: Funcionalidad completa sin restricciones de tamaño
- **Distribución directa**: Instala directamente desde tu instancia de OneUptime
- **Siempre actualizado**: Los usuarios siempre tienen la versión más reciente
- **Seguridad**: Los mismos beneficios de seguridad que las aplicaciones web


### ¿Cuánto almacenamiento usa la PWA de OneUptime?

- **Instalación inicial**: 10-20 MB
- **Crecimiento del caché**: 50-100 MB con uso regular
- **Caché máximo**: Generalmente limitado a 200 MB por los navegadores
- **Limpieza automática**: Los navegadores gestionan el almacenamiento automáticamente

### ¿La PWA de OneUptime admite notificaciones push?

Sí, la PWA de OneUptime admite notificaciones push enriquecidas:
- **Alertas de incidentes**: Notificaciones de incidentes en tiempo real
- **Actualizaciones de estado**: Alertas de cambio de estado del monitor
- **Disparadores personalizados**: Configura reglas de notificación
- **Contenido enriquecido**: Imágenes, acciones e información detallada
- **Actualizaciones de insignia**: Recuento de no leídos en el ícono de la aplicación

## Preguntas frecuentes sobre instalación

### ¿Por qué no veo el botón "Instalar"?

Razones comunes y soluciones:
1. **Compatibilidad del navegador**: Usa Chrome, Edge o Safari
2. **Se requiere HTTPS**: Asegúrate de que la instancia de OneUptime use HTTPS
3. **Requisitos de PWA**: El servidor debe cumplir con los requisitos del manifiesto de PWA
4. **Problemas de caché**: Limpia el caché del navegador y vuelve a cargar
5. **Ya instalada**: La aplicación puede ya estar instalada
6. **Tiempo de espera**: Algunos navegadores necesitan 30+ segundos en la página

### ¿Puedo instalar en múltiples dispositivos?

¡Sí! Puedes instalar la PWA de OneUptime en:
- Dispositivos ilimitados por usuario
- Múltiples navegadores en el mismo dispositivo
- Diferentes sistemas operativos
- Dispositivos compartidos (con cuentas separadas)

### ¿Cómo actualizo la aplicación instalada?

La PWA de OneUptime se actualiza automáticamente:
- **Actualizaciones automáticas**: La aplicación se actualiza cuando la visitas mientras estás en línea
- **Actualizaciones en segundo plano**: Las actualizaciones se descargan en segundo plano
- **Disponibilidad inmediata**: Las nuevas funciones están disponibles al instante
- **Sin acción del usuario**: A diferencia de las aplicaciones de la tienda, no se necesitan actualizaciones manuales

### ¿Puedo personalizar el nombre de la aplicación durante la instalación?

Sí, durante la instalación puedes:
- Cambiar el nombre de la aplicación (predeterminado: "OneUptime")
- Agregar el nombre de tu organización
- Usar una convención de nomenclatura personalizada
- Modificar la etiqueta del ícono (depende de la plataforma)

### ¿Cómo desinstalo la PWA de OneUptime?

La desinstalación varía según la plataforma:

**Android:**
- Mantén pulsado el ícono de la aplicación → Desinstalar
- Configuración → Aplicaciones → OneUptime → Desinstalar

**iOS:**
- Mantén pulsado el ícono de la aplicación → Eliminar aplicación → Eliminar aplicación

**Windows:**
- Configuración → Aplicaciones → OneUptime → Desinstalar
- Clic derecho en el elemento del menú Inicio → Desinstalar

**macOS:**
- Arrastra desde Aplicaciones a la Papelera
- Clic derecho en el ícono del Dock → Eliminar

**Linux:**
- Elimina del lanzador de aplicaciones
- Elimina el archivo .desktop


## Preguntas frecuentes sobre notificaciones

### ¿Por qué no recibo notificaciones?

Problemas comunes de notificaciones y soluciones:

**Verifica los permisos:**
```
1. Permisos de notificaciones del navegador habilitados
2. Permisos de notificaciones del sistema operativo
3. Configuración de notificaciones de OneUptime configurada
4. Modo No molestar deshabilitado
```

**Específico por plataforma:**
- **Android**: Comprueba la configuración de optimización de batería
- **iOS**: Verifica la configuración de notificaciones en la aplicación Configuración
- **Windows**: Comprueba la configuración del Asistente de concentración
- **macOS**: Verifica los permisos del centro de notificaciones
- **Linux**: Comprueba el estado del demonio de notificaciones

### ¿Puedo personalizar los sonidos de notificación?

Opciones de personalización de notificaciones:
- **Sonidos del sistema**: Usa la configuración de sonido de notificación del SO
- **Configuración del navegador**: Configura en las preferencias de notificación del navegador
- **Configuración de OneUptime**: Establece las preferencias de notificación en el panel
- **Niveles de prioridad**: Configura diferentes sonidos para los niveles de gravedad

### ¿Cómo desactivo temporalmente las notificaciones?

Desactivación temporal de notificaciones:
- **No molestar**: Habilita el modo DND del sistema
- **Configuración del navegador**: Deshabilita temporalmente las notificaciones del sitio
- **Panel de OneUptime**: Pausa las notificaciones en la configuración
- **Modos de concentración**: Usa los modos de concentración/concentración del SO

## Preguntas frecuentes sobre seguridad

### ¿Es segura la PWA de OneUptime?

Características de seguridad y consideraciones:
- **Cifrado HTTPS**: Todos los datos se transmiten de forma segura
- **Política del mismo origen**: Se aplican las restricciones de seguridad del navegador
- **Entorno aislado**: Se ejecuta en el entorno aislado de seguridad del navegador
- **Actualizaciones regulares**: Los parches de seguridad se aplican automáticamente
- **Sin acceso root**: Acceso limitado al sistema en comparación con las aplicaciones nativas


*Nota: Los datos sensibles están cifrados y siguen los estándares de seguridad del navegador.*

### ¿Puedo usar la PWA de OneUptime en redes corporativas?

Consideraciones para redes corporativas:
- **Reglas de firewall**: Asegura el acceso HTTPS (puerto 443)
- **Configuración de proxy**: Configura los ajustes de proxy del navegador
- **Confianza en el certificado**: Instala certificados corporativos si es necesario
- **Acceso VPN**: Usa VPN para acceso remoto
- **Políticas de seguridad**: Cumple con los requisitos de seguridad de TI

## Solución de problemas

### Problemas de instalación

**Problema**: El botón de instalación no aparece
```
Soluciones:
1. Espera 30+ segundos en la página de OneUptime
2. Actualiza la página y espera de nuevo
3. Limpia el caché y las cookies del navegador
4. Prueba con un navegador diferente (Chrome/Edge recomendado)
5. Verifica la conexión HTTPS (comprueba el ícono del candado)
6. Comprueba si ya está instalada
```

**Problema**: La instalación falla o se bloquea
```
Soluciones:
1. Asegura suficiente espacio de almacenamiento (100 MB+)
2. Cierra otras pestañas del navegador y aplicaciones
3. Actualiza el navegador a la última versión
4. Deshabilita temporalmente las extensiones del navegador
5. Prueba la instalación en modo privado/incógnito
6. Reinicia el navegador e intenta de nuevo
```

**Problema**: La aplicación se instala pero no aparece
```
Soluciones:
1. Comprueba todas las ubicaciones del lanzador de aplicaciones
2. Busca "OneUptime" en la búsqueda del dispositivo
3. Busca en la sección de gestión de aplicaciones del navegador
4. Espera 1-2 minutos para que el sistema se actualice
5. Reinicia el dispositivo y comprueba de nuevo
```

**Problema**: La aplicación se bloquea con frecuencia
```
Soluciones:
1. Actualiza el navegador a la última versión
2. Limpia todos los datos del navegador de OneUptime
3. Deshabilita las extensiones del navegador
4. Comprueba el espacio de almacenamiento disponible
5. Reinicia el sistema operativo
6. Reinstala la PWA de OneUptime
```

**Problema**: Las notificaciones push no funcionan
```
Soluciones:
1. Comprueba los permisos de notificación en el navegador
2. Verifica la configuración de notificaciones del sistema
3. Prueba primero con una notificación sencilla
4. Limpia los datos de notificación y vuelve a conceder los permisos
5. Comprueba la configuración del modo No molestar/Concentración
6. Verifica la configuración de notificaciones de OneUptime
```

**Problema**: La aplicación no sincroniza los datos más recientes
```
Soluciones:
1. Desliza hacia abajo para actualizar (móvil)
2. Presiona Ctrl+F5 (Windows/Linux) o Cmd+R (Mac)
3. Cierra y vuelve a abrir la aplicación
4. Limpia el caché de la aplicación y vuelve a cargar
5. Comprueba la conectividad de red
```

### Problemas específicos de cada plataforma

**Problemas en Android:**
```
Problema: La aplicación no aparece en el cajón de aplicaciones
Solución: Comprueba la sección "Agregadas recientemente", busca en el cajón de aplicaciones

Problema: Notificaciones retrasadas
Solución: Deshabilita la optimización de batería para la aplicación del navegador

Problema: La aplicación se bloquea al iniciar
Solución: Limpia los datos de la aplicación Chrome, reinicia el dispositivo
```

**Problemas en iOS:**
```
Problema: No puedo agregar a la pantalla de inicio
Solución: Usa el navegador Safari, asegúrate de tener iOS 11.3+

Problema: Ícono de la aplicación faltante
Solución: Comprueba todas las páginas de la pantalla de inicio y la Biblioteca de aplicaciones

Problema: Face ID no funciona
Solución: Habilita Face ID para Safari en la configuración
```

**Problemas en Windows:**
```
Problema: La aplicación no aparece en el menú Inicio
Solución: Busca el nombre de la aplicación, comprueba la lista de aplicaciones instaladas

Problema: Las notificaciones no se muestran
Solución: Comprueba la configuración de notificaciones de Windows, habilita para el navegador

Problema: Problemas de tamaño de ventana
Solución: Cambia el tamaño manualmente; la aplicación recordará las dimensiones
```

**Problemas en macOS:**
```
Problema: No puedo instalar mediante Safari
Solución: Actualiza a macOS Sonoma+, usa Archivo → Agregar al Dock

Problema: La aplicación no está en la carpeta Aplicaciones
Solución: Comprueba Launchpad, usa la búsqueda de Spotlight

Problema: Las notificaciones no funcionan
Solución: Comprueba Preferencias del sistema → Notificaciones
```

**Problemas en Linux:**
```
Problema: Falta la opción de instalación de PWA
Solución: Usa Chrome/Chromium, asegúrate de que el entorno de escritorio admita PWA

Problema: El ícono no aparece en el lanzador
Solución: Actualiza la base de datos de escritorio, comprueba el archivo .desktop

Problema: Las notificaciones de audio no funcionan
Solución: Comprueba PulseAudio, verifica los permisos de audio del navegador
```

### Mensajes de error

**"Este sitio no se puede instalar"**
```
Causas:
- La instancia de OneUptime no cumple con los requisitos de PWA
- Manifiesto de la aplicación web faltante o no válido
- HTTPS no configurado correctamente
- El navegador no admite la instalación de PWA

Soluciones:
- Contacta con el administrador para verificar la configuración de PWA
- Prueba con un navegador diferente
- Comprueba la consola del navegador para obtener errores detallados
```
