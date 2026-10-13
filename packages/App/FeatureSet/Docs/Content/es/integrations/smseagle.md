# Integración con SMSEagle

Envía avisos de alertas como SMS o llamadas a través de [SMSEagle](https://www.smseagle.eu), una pasarela SMS de hardware instalada en tu propia red. OneUptime incluye componentes de flujo de trabajo de **SMSEagle**, así que la configuración es rápida.

Esta integración es **saliente**: OneUptime envía los mensajes a través de la [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
Alerta de OneUptime → On Create  ──►  componente SMSEagle  ──►  SMS o llamada a un teléfono
```

## Paso 1: Crea una clave de API

1. En la GUI web de SMSEagle, ve a **Settings → API → API v2** y haz clic en **Create API key**.
2. En **Permissions**, permite **Send SMS** y, si quieres llamadas, **Make a TTS Advanced Call**.
3. Copia la clave. OneUptime la llama **SMSEagle Access Token**.

## Paso 2: Permite que OneUptime llegue al dispositivo

1. Permite la conexión desde tu servidor de OneUptime hasta la dirección del dispositivo, por ejemplo `https://192.168.0.100`, en los firewalls y VPN que haya entre ambos.
2. Un dispositivo SMSEagle suele tener una dirección privada, que los flujos de trabajo bloquean por defecto. En una instancia autoalojada, añade la dirección IP o el nombre de host del dispositivo a `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` en el servidor de la API, por ejemplo `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, y reinícialo. Consulta [Acceso a redes privadas](/docs/self-hosted/private-network-access).

## Paso 3: Guarda los secretos

1. En OneUptime, ve a **Flujos de trabajo → Variables globales → Crear**.
2. Crea `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (secreta) y `ONCALL_PHONE`.

## Paso 4: Construye el flujo de trabajo

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, llámalo `Alerts → SMSEagle` y abre el **Constructor**.
2. Añade un disparador **Alert** configurado como **On Create**. Cámbiale el nombre a `Alert`.
3. Añade un componente **Send SMS via SMSEagle** conectado al disparador:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Haz clic en **Guardar**, actívalo y crea una alerta de prueba. El SMS llega al teléfono.

La plantilla **Text a phone via SMSEagle when an alert fires** construye el mismo flujo de trabajo.

## Llamadas en lugar de SMS

Usa **Make a Call via SMSEagle** en su lugar. Tiene los mismos ajustes más un **Voice ID**, la voz de texto a voz del dispositivo, y lee en voz alta el **Text to Read Out**. La clave de API necesita el permiso **Make a TTS Advanced Call**.

La plantilla **Call a phone via SMSEagle when an alert fires** construye el mismo flujo de trabajo con una llamada.

## Alternativa: el componente API

Un bloque **API** también sirve:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Consejos

- Si el dispositivo rechaza el mensaje, el motivo está en el valor **Error** del componente. Regístralo en la salida **Error**.
- Usa **Condiciones** para filtrar por gravedad antes de enviar.
- Para avisar a varias personas, conecta varios componentes de SMSEagle, uno por número.

## Qué leer a continuación

- [Resumen de Integraciones](/docs/integrations/index): el patrón saliente.
- [Componentes → SMSEagle](/docs/workflows/components#smseagle): la referencia del componente.
