# Guía de instalación en Windows

Instala OneUptime como una aplicación de escritorio en Windows para un monitoreo y gestión de incidentes completos.


## Métodos de instalación

### Método 1: Microsoft Edge (recomendado)

Edge proporciona la mejor integración de PWA en Windows con características nativas.

1. **Abre OneUptime en Edge**
   - Inicia el navegador Microsoft Edge
   - Navega a la URL de tu instancia de OneUptime
   - Inicia sesión en tu cuenta de OneUptime
   - Espera a que la página cargue completamente

2. **Instala la aplicación**
   - Busca el **ícono de instalación** (⊞) en la barra de direcciones
   - Haz clic en el botón **"Instalar OneUptime"**
   - O haz clic en el **menú de tres puntos** → **Aplicaciones** → **Instalar este sitio como aplicación**

3. **Personaliza la instalación**
   - **Nombre de la aplicación**: Modifica si lo deseas (predeterminado: OneUptime)
   - **Menú Inicio**: Elige si agregarla al menú Inicio
   - **Barra de tareas**: Opción para anclar a la barra de tareas
   - **Escritorio**: Crea un acceso directo en el escritorio

4. **Completa la instalación**
   - Haz clic en **"Instalar"** para finalizar
   - OneUptime se abrirá en su propia ventana
   - Encuéntrala en el menú Inicio bajo las aplicaciones instaladas

### Método 2: Google Chrome

Chrome ofrece un excelente soporte para PWA con rica integración en el escritorio.

1. **Abre OneUptime en Chrome**
   - Inicia Google Chrome
   - Ve a tu instancia de OneUptime
   - Asegúrate de haber iniciado sesión
   - Permite que la página cargue completamente

2. **Instala a través de la barra de direcciones**
   - Busca el **ícono de instalación** (⊞) en la barra de direcciones
   - Haz clic en **"Instalar OneUptime"**
   - O usa el menú: **tres puntos** → **Más herramientas** → **Crear acceso directo**

3. **Opciones de instalación**
   - Marca **"Abrir como ventana"** para una experiencia similar a una aplicación
   - Personaliza el nombre de la aplicación si lo deseas
   - Haz clic en **"Instalar"** o **"Crear"**

4. **Inicia la aplicación**
   - Encuentra OneUptime en el menú Inicio de Windows
   - O inicia desde el acceso directo del escritorio
   - La aplicación se abre en una ventana dedicada

### Método 3: Firefox

Firefox admite la instalación de PWA con integración básica en el escritorio.

1. **Abre OneUptime en Firefox**
   - Inicia el navegador Firefox
   - Navega a la URL de OneUptime
   - Completa el proceso de inicio de sesión

2. **Instala la PWA**
   - Busca la **solicitud de instalación** o el banner
   - O haz clic en **menú** → **Instalar**
   - Si está disponible, haz clic en el equivalente de **"Agregar a pantalla de inicio"**


### Configuración de inicio
1. **Inicio automático**: Configura OneUptime para que inicie con Windows
   - Haz clic derecho en la barra de tareas → Administrador de tareas → Inicio
   - Habilita OneUptime si lo deseas
2. **Tamaño predeterminado**: Establece el tamaño y posición de ventana preferidos

### Configuración de notificaciones
1. **Notificaciones de Windows**
   - Configuración → Sistema → Notificaciones y acciones
   - Busca OneUptime y configura las preferencias de alerta
   - Habilita notificaciones de banner para incidentes

2. **Asistente de concentración**
   - Configura los ajustes de No molestar
   - Permite las notificaciones críticas de OneUptime
   - Establece niveles de prioridad para diferentes tipos de alerta

## Solución de problemas

### Problemas de instalación

**El botón de instalación no aparece:**
```
Soluciones:
1. Asegúrate de estar usando Edge o Chrome (navegadores recomendados)
2. Verifica la conexión HTTPS a la instancia de OneUptime
3. Limpia el caché y las cookies del navegador
4. Actualiza el navegador a la última versión
5. Comprueba si se cumplen los requisitos de PWA en el servidor
6. Deshabilita temporalmente las extensiones del navegador
```

**La instalación falla o se bloquea:**
```
Soluciones:
1. Ejecuta el navegador como administrador
2. Comprueba la configuración del Control de cuentas de usuario (UAC) de Windows
3. Asegura suficiente espacio en disco (mínimo 100 MB)
4. Deshabilita temporalmente el antivirus
5. Limpia completamente los datos del navegador
6. Reinicia Windows e intenta de nuevo
```

**La aplicación no aparece en el menú Inicio:**
```
Soluciones:
1. Busca "OneUptime" en la búsqueda de Windows
2. Comprueba si se instaló con un nombre diferente
3. Busca en la sección "Agregadas recientemente"
4. Reinstala y asegúrate de que "Agregar al menú Inicio" esté marcado
5. Crea manualmente un acceso directo si es necesario
```

### Problemas de notificaciones

**Las notificaciones de Windows no funcionan:**
```
Soluciones:
1. Configuración de Windows → Sistema → Notificaciones y acciones
2. Habilita las notificaciones para OneUptime
3. Comprueba la configuración del Asistente de concentración
4. Asegura los permisos de notificación en OneUptime
5. Prueba primero con una notificación sencilla
```

## Desinstalación

### Eliminación completa
1. **Método de configuración de Windows**
   - Configuración → Aplicaciones → Aplicaciones y características
   - Busca "OneUptime"
   - Haz clic y selecciona "Desinstalar"

2. **Método del navegador**
   - Abre Edge/Chrome
   - Ve a edge://apps/ o chrome://apps/
   - Encuentra OneUptime
   - Haz clic en opciones → Desinstalar

3. **Método del menú Inicio**
   - Haz clic derecho en OneUptime en el menú Inicio
   - Selecciona "Desinstalar"
   - Confirma la eliminación


## Actualizaciones y mantenimiento

### Actualizaciones automáticas
- La PWA de OneUptime se actualiza automáticamente cuando está en línea
- No se requiere intervención manual
- Las actualizaciones se aplican de inmediato al reiniciar
- Los parches críticos se implementan al instante
