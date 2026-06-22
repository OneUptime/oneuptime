# Guía de instalación en Linux

Instala OneUptime como una aplicación de escritorio en distribuciones Linux para un monitoreo y gestión de incidentes completos.

## Métodos de instalación

### Método 1: Google Chrome/Chromium (recomendado)

Chrome y Chromium proporcionan la mejor experiencia de PWA en Linux con integración nativa en el escritorio.

#### Pasos de instalación de PWA:

1. **Abre OneUptime en Chrome/Chromium**

   - Inicia tu navegador
   - Navega a la URL de tu instancia de OneUptime
   - Inicia sesión en tu cuenta de OneUptime
   - Espera a que la página cargue completamente

2. **Instala la PWA**

   - Busca el **ícono de instalación** (⊞) en la barra de direcciones
   - Haz clic en **"Instalar OneUptime"**
   - O usa el **menú de Chrome** (⋮) → **Más herramientas** → **Crear acceso directo**

3. **Opciones de instalación**

   - Marca **"Abrir como ventana"** para una experiencia de aplicación nativa
   - Personaliza el nombre de la aplicación si lo deseas
   - Elige crear un acceso directo en el escritorio
   - Haz clic en **"Instalar"** o **"Crear"**

4. **Inicia la aplicación**
   - Encuentra OneUptime en el lanzador de aplicaciones
   - O usa el acceso directo del escritorio
   - La aplicación se abre en una ventana dedicada

### Método 2: Firefox

Firefox admite la instalación de PWA en Linux con integración básica en el escritorio.

1. **Instalación de PWA**:
   - Abre OneUptime en Firefox
   - Busca el banner o solicitud de instalación
   - Haz clic en **"Instalar"** cuando esté disponible
   - Nota: Integración de escritorio limitada en comparación con Chrome

### Método 3: Microsoft Edge

Edge está disponible en Linux y proporciona buen soporte para PWA.

1. **Instala la PWA**: Sigue los mismos pasos que en el método de Chrome

## Actualizaciones y mantenimiento

### Actualizaciones automáticas

La PWA de OneUptime se actualiza automáticamente:

- Las actualizaciones se aplican cuando el navegador actualiza la aplicación
- Las actualizaciones de seguridad críticas se implementan de inmediato
- No se requiere intervención manual

## Desinstalación

### Eliminación específica por navegador

```bash
# Gestión de PWA en Chrome
google-chrome chrome://apps/

# Eliminar todos los datos del navegador relacionados con OneUptime
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Actualizaciones y mantenimiento

### Actualizaciones automáticas

La PWA de OneUptime se actualiza automáticamente:

- Las actualizaciones se aplican cuando el navegador actualiza la aplicación
- Las actualizaciones de seguridad críticas se implementan de inmediato
- No se requiere intervención manual
