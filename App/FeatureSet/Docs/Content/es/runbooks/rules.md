# Reglas de runbook

Las reglas de runbook adjuntan runbooks automáticamente cuando se crea un **incidente**, una **alerta** o un **evento de mantenimiento programado**. Se gestionan desde el menú de Configuración de cada entidad:

- Incidentes → Configuración → **Reglas de runbook**
- Alertas → Configuración → **Reglas de runbook**
- Mantenimiento programado → Configuración → **Reglas de runbook**

Las tres páginas editan el mismo modelo subyacente de reglas — simplemente están filtradas para mostrar solo las reglas de ese tipo de entidad.

## Anatomía de una regla

| Campo                   | Propósito                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Nombre**              | Etiqueta corta y legible. Aparece en los logs de auditoría.                                                   |
| **Descripción**         | Contexto opcional para los compañeros de equipo.                                                              |
| **Habilitada**          | Conmutador para suspender una regla sin borrarla.                                                             |
| **Title Pattern**       | Regex sin distinguir mayúsculas, evaluado contra el título de la entidad. Vacío = cualquier título.           |
| **Description Pattern** | Regex sin distinguir mayúsculas, evaluado contra la descripción de la entidad. Vacío = cualquier descripción. |
| **Runbooks a iniciar**  | Uno o más runbooks que se lanzan al dispararse la regla.                                                      |

## Semántica de coincidencia

Una regla coincide cuando **todos los criterios indicados pasan**. Los criterios vacíos se saltan, así que:

- Una regla sin patrones se ejecuta en todos los eventos de su tipo (una regla global de "ejecuta siempre").
- Una regla con solo un patrón de título se dispara en eventos cuyo título coincida con ese regex.
- Varias reglas pueden coincidir con el mismo evento — cada coincidencia se dispara, y la unión de sus runbooks se ejecuta (cada runbook tiene su propia ejecución).

## Ejemplo: failover de DB para incidentes de base de datos

```
Name:           Start DB failover for DB incidents
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB failover playbook, Notify DBA team]
```

Esto creará dos ejecuciones de runbook cada vez que se cree un incidente con "db", "database", "postgres", etc. en el título.

## Ejemplo: regla de higiene "ejecuta siempre"

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (empty)
Description Pattern:  (empty)
Runbooks:             [Capture pre-incident state]
```

Se dispara en todos los incidentes — útil para capturar snapshots de estado del sistema, métricas de página, etc.

## Qué pasa cuando una regla se dispara

1. Se carga el runbook.
2. Sus pasos se **snapshotean** en una nueva ejecución de runbook.
3. La ejecución se encola en el worker de la cola de Runbook.
4. La ejecución se vincula a la entidad origen — aparece en la página del incidente, alerta o mantenimiento programado y en la lista de Ejecuciones del runbook.

Puedes ver todas las ejecuciones disparadas por reglas en **Runbooks → Ejecuciones**, filtradas por estado, runbook o fecha.

## Runbooks deshabilitados

Si una regla referencia un runbook con `isEnabled = false`, la regla sigue coincidiendo pero la ejecución se omite. Vuelve a habilitar el runbook para reanudar.

## Probar una regla

Antes de confiar en una regla en producción, crea un incidente (o alerta) de prueba con un título que coincida con el patrón y confirma que se disparan los runbooks esperados. Las reglas se evalúan en el momento de creación — editar el título de un incidente después no vuelve a disparar reglas.
