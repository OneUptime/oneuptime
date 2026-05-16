# Monitor manual

El monitoreo manual te permite crear monitores cuyo estado se gestiona completamente de forma manual o a través de la API. OneUptime no realiza ninguna verificación automatizada; tú controlas directamente el estado del monitor.

## Información general

Los monitores manuales son marcadores de posición que actualizas tú mismo. Esto es útil para:

- Integrarte con herramientas de monitoreo externas que actualicen el estado a través de la API de OneUptime
- Rastrear servicios o sistemas que no se pueden monitorear automáticamente
- Gestionar incidentes para componentes sin verificaciones de estado automatizadas
- Representar dependencias de terceros cuyo estado rastrear manualmente

## Creación de un monitor manual

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Manual** como tipo de monitor
4. Ingresa un nombre y una descripción para el monitor

## Cómo funciona

Los monitores manuales no tienen intervalos de monitoreo, sondas ni evaluación automatizada de criterios. El estado del monitor permanece como lo estableces hasta que lo cambies.

### Actualización del estado

Puedes actualizar el estado de un monitor manual de dos formas:

- **Panel**: Cambia el estado del monitor directamente desde el panel de OneUptime
- **API**: Actualiza el estado del monitor de forma programática usando la API de OneUptime

### Incidentes y alertas

Puedes crear incidentes y alertas para monitores manuales igual que con cualquier otro tipo de monitor. Esto te permite:

- Rastrear el tiempo de inactividad de servicios monitoreados externamente
- Crear incidentes manualmente cuando se informan problemas
- Usar monitores manuales en páginas de estado para comunicar el estado a los usuarios

## Cuándo usar monitores manuales

| Caso de uso | Descripción |
|----------|-------------|
| Servicios de terceros | Rastrea el estado de servicios externos de los que dependes pero que no puedes monitorear directamente |
| Infraestructura física | Representa hardware o sistemas físicos sin monitoreo de red |
| Procesos empresariales | Rastrea procesos no técnicos que afectan el estado del servicio |
| Estado gestionado por API | Permite que herramientas externas actualicen el estado del monitor a través de la API de OneUptime |
| Marcadores de posición de páginas de estado | Muestra componentes en tu página de estado que se gestionan fuera de OneUptime |
