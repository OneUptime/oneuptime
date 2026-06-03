# Integración con Telegram

Envía actualizaciones de incidentes a un chat o grupo de [Telegram](https://telegram.org). OneUptime tiene un componente de workflow **Telegram** integrado, por lo que la configuración es rápida.

Esta integración es **saliente**: OneUptime envía mensajes a través de un bot de Telegram.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Paso 1 — Crear un bot y obtener su token

1. En Telegram, envía un mensaje a [@BotFather](https://t.me/BotFather) y escribe `/newbot`.
2. Sigue las instrucciones. BotFather te da un **token de bot** como `123456789:AA...`.

## Paso 2 — Encontrar tu chat ID

1. Añade el bot al grupo (o inicia un chat directo con él) y envíale cualquier mensaje.
2. Abre `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` en un navegador.
3. Encuentra `"chat":{"id":...}` en la respuesta — ese número es tu **chat ID** (los IDs de grupo son negativos).

## Paso 3 — Guardar los secretos

1. En OneUptime, ve a **Workflows → Global Variables → Create**.
2. Crea `TELEGRAM_BOT_TOKEN` (secreto) y `TELEGRAM_CHAT_ID`.

## Paso 4 — Construir el workflow

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → Telegram` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un componente **Telegram** conectado al disparador:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Guarda**, habilita y crea un incidente de prueba. El mensaje llega a tu chat.

## Alternativa: el componente API

Un bloque **API** también funciona:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Consejos

- El bot solo ve mensajes después de ser añadido a un grupo y de que el **modo privacidad** lo permita — si `getUpdates` está vacío, envíale primero un mensaje al bot, o desactiva el modo privacidad a través de BotFather.
- Usa **Conditions** para filtrar por gravedad antes de enviar.
- Añade `"parse_mode": "Markdown"` al cuerpo de la API (o usa el formato del componente) para texto en negrita y enlaces.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — el patrón saliente.
- [Discord](/docs/integrations/discord) — la misma idea para Discord.
- [Componentes → Telegram](/docs/workflows/components#telegram) — la referencia del componente.
