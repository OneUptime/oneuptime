# Pasarela de SMS y llamadas

OneUptime puede enviar sus SMS y llamadas a través de una pasarela que gestionas tú, en lugar de Twilio. Úsala cuando tus normas exijan que cada mensaje pase por tu propio proveedor de SMS y voz, o por un sistema que lo revise antes de que salga de tu red. OneUptime envía cada SMS y cada llamada a tu pasarela como una solicitud JSON firmada, y tu pasarela la entrega.

:::cards
- [Configurar la pasarela](#configurar-la-pasarela): Una URL y un secreto de firma que se crea por ti.
- [Qué recibe tu pasarela](#qué-recibe-tu-pasarela): Una solicitud JSON firmada por cada SMS o llamada.
- [Actuar sobre un aviso](#actuar-sobre-un-aviso): Reconocer, escalar o resolver desde una llamada o una respuesta.
- [Entrega y reintentos](#entrega-y-reintentos): Qué ocurre cuando tu pasarela no responde.
:::

## Cómo funciona

```mermaid title="Un SMS a través de tu propia pasarela"
flowchart LR
    OneUptime["OneUptime"]
    Gateway["Tu pasarela"]
    Provider["Tu proveedor de SMS y voz"]
    Phone["Teléfono"]
    OneUptime -->|"solicitud JSON firmada"| Gateway
    Gateway --> Provider
    Provider --> Phone
```

La pasarela ocupa el lugar de la cuenta de Twilio propia del servidor para todo lo que pasaría por ella: avisos de guardia, notificaciones, códigos de verificación y SMS a los suscriptores de las páginas de estado. Los proyectos que añaden su propia configuración de Twilio, en la tarjeta **Configuración de Twilio** de **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**, siguen enviando a través de esa configuración. Los interruptores de SMS y llamadas de cada proyecto, y su saldo donde la facturación está activada, se comprueban igual que con Twilio.

## Configurar la pasarela

:::steps
1. En el Admin Dashboard, ve a **Ajustes > Llamadas y SMS** y haz clic en **Edit Provider** en la tarjeta **SMS and Call Provider**.
2. Elige **Your own gateway** e introduce la **Gateway URL**. La pasarela puede estar en tu red privada.
3. Guarda. OneUptime crea un secreto de firma por ti. Cópialo de la tarjeta a tu pasarela.
4. Haz clic en **Send Test**. Tu pasarela debe responder con un estado 2xx y no enviar nada.
:::

Para sustituir el secreto, vacía **Signing Secret** en **Más campos** y guarda: OneUptime crea uno nuevo. Para volver a Twilio, elige **Twilio** y guarda.

## Qué recibe tu pasarela

Cada SMS y cada llamada es una solicitud `POST` con un cuerpo JSON y estos encabezados:

| Encabezado | Valor |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OneUptime-Event` | `sms`, `call` o `test` |
| `X-OneUptime-Signature` | `sha256=` seguido del HMAC-SHA256 del cuerpo en hexadecimal, con el secreto de firma como clave |
| `User-Agent` | `OneUptime-CallAndSmsGateway/1.0` |

```json title="An on-call page by SMS"
{
  "version": 1,
  "event": "sms",
  "id": "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  "sentAt": "2026-10-27T09:30:00.000Z",
  "to": "+15551234567",
  "message": "OneUptime: A new alert has been created. Alert #42: Database is down…",
  "isSensitive": false,
  "project": {
    "id": "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
    "name": "Production"
  },
  "actions": {
    "acknowledge": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…",
    "escalate": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/escalate?token=…",
    "resolve": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/resolve?token=…"
  }
}
```

| Campo | Qué es |
| --- | --- |
| `version` | Siempre `1` para esta forma. Solo se le añaden campos. |
| `event` | `sms`, `call` o `test`, como en `X-OneUptime-Event`. |
| `id` | Único para este mensaje e igual en cada intento de entregarlo: úsalo para ignorar un mensaje que ya enviaste. |
| `sentAt` | Cuándo lo envió OneUptime, en ISO 8601. |
| `to` | El número de teléfono, en formato E.164. `null` en una prueba. |
| `message` | El SMS, o lo que dice la llamada. Un SMS tiene como máximo 1600 caracteres, y el texto de una llamada como máximo 16 384. Un texto más largo se corta y termina con una nota que indica que el resto está en OneUptime. |
| `isSensitive` | `true` para un código de verificación. Mantén el mensaje fuera de tus propios logs. |
| `project` | El `id` y el `name` del proyecto, o `null` cuando no lo envió ningún proyecto. |
| `actions` | Para un aviso de guardia, los enlaces que actúan sobre él. `null` en los demás casos. |

Una llamada se describe en lugar de guionizarse: `message` es lo que dice, sin el «pulse 1 para reconocer» de Twilio. Ofrece las acciones a tu manera, por ejemplo con pulsaciones de teclas, y llama al enlace correspondiente.

### Comprobar la firma

Calcula el HMAC del cuerpo sin procesar de la solicitud, antes de analizarlo, y compáralo con el encabezado. La comprobación es la misma que para un [canal personalizado](/docs/self-hosted/custom-notification-channels#comprobar-la-firma), así que un solo verificador sirve para ambos:

```javascript title="Node.js"
const crypto = require("crypto");

function isFromOneUptime(rawBody, signatureHeader, secret) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = String(signatureHeader || "");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

## Actuar sobre un aviso

Cuando la persona responde durante una llamada o con una respuesta, tu pasarela envía una solicitud `POST` al enlace correspondiente de `actions`. Los enlaces funcionan como los de un canal personalizado: no necesitan clave de API, cada uno lleva un token solo para ese aviso, válido durante 7 días, y la acción queda registrada como hecha por la persona a la que se avisó. Consulta [Actuar sobre un aviso](/docs/self-hosted/custom-notification-channels#actuar-sobre-un-aviso) para ver cada acción y la respuesta.

```bash title="Acknowledge a page"
curl -X POST "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…"
```

## Entrega y reintentos

Una solicitud cuenta como entregada cuando tu pasarela responde con un estado 2xx en 10 segundos. Una solicitud a la que no respondió, o a la que respondió con 408, 429 o un estado 5xx, se envía de nuevo al cabo de 1 segundo y de otros 4 segundos: tres intentos en total. Con cualquier otro estado 4xx no se vuelve a enviar.

El registro de SMS o de llamadas, y para un aviso de guardia el registro de guardia de la persona, dice `Sent to the SMS and call gateway (HTTP 200).` o por qué no se entregó, nunca la URL. OneUptime no sabe si el mensaje llegó al teléfono, así que un SMS aparece como enviado en cuanto tu pasarela lo acepta, y el número desde el que salió queda en blanco.

## Solicitudes de prueba

**Send test** envía una solicitud con `event` en `test`, y `to`, `project` y `actions` en `null`. Respóndela con un estado 2xx y no envíes nada.

## Próximos pasos

:::cards
- [Canales de notificación personalizados](/docs/self-hosted/custom-notification-channels): Avisar a las personas a través de tu propia aplicación.
- [Notificaciones push](/docs/self-hosted/push-notifications): Desactivar el push en todo el servidor.
- [Integración de Twilio](/docs/self-hosted/twilio-integration): Enviar a través de Twilio en su lugar.
- [Acceso a red privada](/docs/self-hosted/private-network-access): A qué puede llegar tu servidor en tu propia red.
:::
