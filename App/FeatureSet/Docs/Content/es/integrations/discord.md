# Integración con Discord

Publica actualizaciones de incidentes en un canal de [Discord](https://discord.com). OneUptime tiene un componente de workflow **Discord** integrado, por lo que esta es una de las integraciones más rápidas de configurar.

Esta integración es **saliente**: OneUptime publica en un canal de Discord a través de una URL de webhook entrante.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Paso 1 — Crear un webhook de Discord

1. En Discord, abre **Edit Channel → Integrations → Webhooks** del canal de destino.
2. Haz clic en **New Webhook**, dale un nombre (p. ej. `OneUptime`), elige el canal y **copia la URL del webhook**.

## Paso 2 — Guardar la URL del webhook (opcional pero recomendado)

1. En OneUptime, ve a **Workflows → Global Variables → Create**.
2. Nómbrala `DISCORD_WEBHOOK_URL`, pega la URL y activa **Is Secret**.

Guardarla en una variable te permite reutilizarla en varios workflows y rotarla en un solo lugar.

## Paso 3 — Construir el workflow

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → Discord` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un componente **Discord** conectado al disparador:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (o pégala directamente).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Guarda**, habilita y crea un incidente de prueba. El mensaje aparece en tu canal.

## Alternativa: el componente API

Si prefieres no usar el componente dedicado, un bloque **API** hace lo mismo:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Esto es útil si quieres usar los [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) más ricos de Discord — añade un array `embeds` al cuerpo.

## Consejos

- Usa **Conditions** para publicar solo en ciertas gravedades — ramifica sobre `{{Incident.incidentSeverity.name}}` antes del bloque Discord.
- Añade más workflows sobre **Incident → On Update** para publicar reconocimientos y resoluciones en el mismo canal.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — el patrón saliente.
- [Telegram](/docs/integrations/telegram) — la misma idea para Telegram.
- [Componentes → Discord](/docs/workflows/components#discord) — la referencia del componente.
