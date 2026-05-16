# Reglas de runbook

Las reglas de runbook adjuntan runbooks automáticamente cuando se crea un **incidente**, **alerta** o **evento de mantenimiento programado**. Se gestionan desde el menú Configuración de cada entidad:

- Incidentes → Configuración → **Reglas de runbook**
- Alertas → Configuración → **Reglas de runbook**
- Mantenimiento programado → Configuración → **Reglas de runbook**

Las tres páginas editan el mismo modelo de regla subyacente — solo están filtradas para mostrar las reglas del tipo de entidad correspondiente.

## Anatomía de una regla

| Campo | Propósito |
| --- | --- |
| **Nombre** | Etiqueta corta y legible. Aparece en los registros de auditoría. |
| **Descripción** | Contexto opcional para tu equipo. |
| **Activada** | Conmutador para suspender una regla sin borrarla. |
| **Patrón de título** | Regex sin distinción de mayúsculas/minúsculas contra el título de la entidad. Vacío = cualquier título coincide. |
| **Patrón de descripción** | Regex sin distinción de mayúsculas/minúsculas contra la descripción de la entidad. Vacío = cualquier descripción coincide. |
| **Runbooks a iniciar** | Uno o más runbooks que se lanzarán cuando la regla se dispare. |

## Semántica de coincidencia

Una regla coincide cuando **todos los criterios especificados se cumplen**. Los criterios vacíos se omiten:

- Una regla sin patrones se ejecuta en cada evento de su tipo (regla global "siempre ejecutar").
- Una regla con solo un patrón de título se dispara con eventos cuyo título coincida con el regex.
- Varias reglas pueden coincidir con el mismo evento — cada coincidencia dispara, y la unión de sus runbooks se ejecuta (cada runbook tiene su propia ejecución).

## Ejemplo: failover de BD para incidentes de base de datos

```
Nombre:            Iniciar failover de BD para incidentes de BD
Disparador:        Incidente
Patrón de título:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:          [Playbook de failover de BD, Notificar al equipo DBA]
```

Esto crea dos ejecuciones de runbook cada vez que se crea un incidente con "db", "database", "postgres", etc. en el título.

## Ejemplo: regla de higiene siempre activa

```
Nombre:                  Comprobación previa a cada incidente
Disparador:              Incidente
Patrón de título:        (vacío)
Patrón de descripción:   (vacío)
Runbooks:                [Capturar estado previo al incidente]
```

Se dispara en cada incidente — útil para capturar snapshots del estado del sistema, métricas de página, etc.

## Qué ocurre cuando se dispara una regla

1. Se carga el runbook.
2. Sus pasos se copian como **snapshot** en una nueva ejecución de runbook.
3. La ejecución se encola en el worker de Runbook.
4. La ejecución queda vinculada a la entidad origen — aparece en la página del incidente, alerta o mantenimiento, y en la lista de ejecuciones del runbook.

Puedes ver todas las ejecuciones disparadas por regla en **Runbooks → Ejecuciones**, filtradas por estado, runbook o fecha.

## Runbooks deshabilitados

Si una regla referencia un runbook con `isEnabled = false`, la regla sigue coincidiendo pero la ejecución se omite. Vuelve a habilitar el runbook para reanudar.

## Probar una regla

Antes de confiar en una regla en producción, crea un incidente (o alerta) de prueba con un título que coincida con el patrón y verifica que los runbooks esperados se ejecutan. Las reglas se evalúan en el momento de la creación — editar después el título de un incidente no vuelve a disparar las reglas.
