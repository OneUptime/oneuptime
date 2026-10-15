# Episodios

Un episodio agrupa incidentes relacionados, o alertas relacionadas, para que tu equipo los trabaje como uno solo: un solo lugar para verlos, un solo grupo de propietarios, un solo estado que reconocer y resolver. Las reglas de agrupación abren episodios y les añaden incidentes y alertas a medida que llegan (consulta [Reglas de agrupación de incidentes](/docs/incidents/settings#reglas-de-agrupación-de-incidentes)). También puedes poner incidentes en un episodio tú mismo, varios a la vez: desde el episodio o desde las listas de incidentes.

Todo lo de esta página funciona igual para los episodios de alertas: lee «alerta» donde dice «incidente». Los episodios de incidentes están en **Incidentes → Episodios** y los de alertas en **Alertas → Episodios**.

## Añadir incidentes desde un episodio

Abre el episodio, elige **Incidentes miembro** en su menú lateral (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) y haz clic en **Añadir incidentes**. El diálogo muestra los 50 incidentes más recientes que puedes ver y que aún no están en el episodio, cada uno con su número, título, estado y gravedad. Para encontrar uno más antiguo, busca por título o por número: `INC-42`, `42` y `#42` encuentran todos el incidente 42.

- Marca todos los que necesites, hasta 100 a la vez. El botón los cuenta: **Añadir 3 elementos (Incidentes)**.
- Un incidente que ya está en otro episodio lo indica bajo su título, con el número de ese episodio. Añadirlo aquí lo mantiene también allí: un incidente puede estar en más de un episodio.
- Si algunos no se pueden añadir, el diálogo sigue abierto y los muestra con el motivo; los demás se añaden.

## Añadir incidentes desde las listas de incidentes

Selecciona incidentes en la lista **Incidentes**, o en cualquier otra lista de incidentes, como la de un monitor, y abre **Acciones masivas**:

| Acción | Qué hace |
| --- | --- |
| **Añadir a un episodio existente** | Elige un episodio. Primero aparecen los episodios en curso, del más reciente al más antiguo, y después los resueltos recientemente; busca por título o número para encontrar cualquier otro. Antes de añadir, el diálogo indica cuántos de los incidentes seleccionados ya están en ese episodio, que se quedan como están, y cuántos están en otro episodio, donde siguen. |
| **Añadir a un episodio nuevo** | Crea un episodio con los incidentes seleccionados dentro. Solo pide un título y una gravedad, ambos rellenados a partir del incidente seleccionado más grave; el título de un incidente privado nunca se copia. Añade propietarios, políticas de guardia y notas en la página del episodio. |

Ambas aceptan hasta 100 incidentes seleccionados. El resultado indica cuántos se añadieron, cuántos ya estaban en el episodio y cuáles no se añadieron y por qué, con un enlace que abre el episodio.

## Qué hace añadir

- **Una sola entrada en el feed del episodio** nombra cada incidente añadido: los 20 primeros por número y título, y después cuántos más. Se publica una sola vez en el canal de Slack o Microsoft Teams del episodio, no una vez por incidente. Un incidente privado se nombra solo por su número.
- **El feed de cada incidente** indica a qué episodio se añadió.
- **La gravedad del episodio** sube a la del incidente más grave añadido a un episodio existente, y nunca baja. Un episodio nuevo empieza con la gravedad que elijas.
- **Un episodio resuelto sigue resuelto.** Añadirle incidentes no lo reabre, y añadir nunca cambia el estado de un incidente.
- **Los propietarios del episodio reciben aviso** de que se añadieron incidentes, igual que cuando se añade uno solo. Cuando el episodio se crea con ellos, su propia notificación de creación los cubre.

## Quitar un incidente

En **Incidentes miembro**, **Eliminar** en una fila, o en las filas seleccionadas desde **Acciones masivas**, quita el incidente solo de este episodio. El incidente en sí no se borra y sigue en cualquier otro episodio en el que esté.

## Quién puede añadir

Añadir requiere permiso para añadir incidentes a un episodio, que tienen los roles Project Owner, Project Admin, Project Member, Incident Admin e Incident Member, y también un rol personalizado con Create Incident Episode Member. Solo puedes añadir incidentes que puedes ver: un incidente privado solo lo pueden añadir sus propietarios y los propietarios y administradores del proyecto. Añadir a un episodio nuevo requiere además permiso para crear un episodio. Cuando no puedes usar una acción, aparece bloqueada y su descripción emergente nombra el permiso que falta.

## Con la API

Añade varios incidentes a un episodio en una sola solicitud:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

La respuesta nombra cada incidente enviado, una sola vez: añadido, ya en el episodio, o no añadido y por qué. Una solicitud con más de 100 ID se rechaza.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

Para alertas, envía `alertEpisodeId` y `alertIds` a `/api/alert-episode-member/add-alerts`. Para crear un episodio con incidentes dentro, envía sus ID con la solicitud que crea el episodio, `POST /api/incident-episode`, como `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; para un episodio de alertas, `POST /api/alert-episode` con `alertIdsToAdd`. Si alguno no se puede añadir, no se crea ningún episodio.
