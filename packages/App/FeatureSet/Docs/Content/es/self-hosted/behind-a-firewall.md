# Detrás de una VPN o un cortafuegos

Un OneUptime autoalojado puede quedarse sin exponer a Internet: envía todas las alertas por conexiones salientes. Aun así, algunas cosas llegan desde fuera. Una persona de guardia toca **Acknowledge** en un mensaje, Twilio informa de una tecla pulsada durante una llamada y Slack informa de un clic en un botón. Esta página repasa cada una: quién se conecta a tu servidor y por qué ruta, para que publiques solo lo que uses, o nada en absoluto.

:::cards
- [Quién se conecta a tu servidor](#quién-se-conecta-a-tu-servidor): Los teléfonos de las personas de guardia y los proveedores que envían callbacks.
- [Mantén todo privado](#mantén-todo-privado): Pon en tu VPN los teléfonos de las personas de guardia.
- [Publica solo las páginas de reconocimiento](#publica-solo-las-páginas-de-reconocimiento): Una entrada estrecha para los enlaces de reconocimiento.
- [Callbacks de los proveedores](#callbacks-de-los-proveedores): Telegram, Twilio, WhatsApp, Slack y Microsoft Teams.
:::

## Quién se conecta a tu servidor

El envío nunca necesita acceso entrante: OneUptime se conecta hacia fuera con tu servidor de correo, Twilio, Telegram, Meta, Slack, Microsoft y el relé de push. Lo que llega desde fuera es una de estas cosas:

| Qué ocurre | Quién se conecta a tu servidor | ¿Puede cubrirlo una lista de permitidos por dirección de origen? |
| --- | --- | --- |
| Una persona de guardia toca **Acknowledge** en un correo, un SMS o un mensaje de WhatsApp o Telegram | El teléfono o el ordenador de esa persona | No: se conecta desde dondequiera que esté la persona |
| Una persona de guardia reconoce el aviso en la aplicación OneUptime On-Call | El teléfono de esa persona | No: por el mismo motivo |
| Una persona de guardia pulsa 1 en una llamada de guardia | Twilio | Solo con Static Proxy for Webhooks de Twilio |
| Alguien vincula su cuenta de Telegram | Telegram | Sí, o sondea Telegram y no permitas nada |
| Alguien hace clic en un botón de un mensaje de Slack o Microsoft Teams | Slack o Microsoft | No: ninguno de los dos publica direcciones fijas |
| WhatsApp informa de que un mensaje se entregó o se leyó | Meta | No: Meta no publica direcciones fijas |

Un servidor autoalojado habla directamente con estos proveedores, nunca a través de los servidores de OneUptime, así que no hay ninguna lista de direcciones de OneUptime que permitir.

## Mantén todo privado

Pon los teléfonos de las personas de guardia en tu VPN: siempre activa, o bajo demanda para tu nombre de host de OneUptime, para que nadie tenga que conectarla antes de reconocer un aviso a las 3 de la madrugada. Sin nada publicado:

- Los enlaces de reconocimiento de los correos, los SMS y los mensajes de WhatsApp y Telegram se abren, porque el teléfono llega a tu servidor.
- La aplicación OneUptime On-Call funciona: apúntala a la dirección de tu servidor. Las notificaciones push no necesitan acceso entrante, porque el servidor las envía a través del relé de push.
- Las personas vinculan sus cuentas de Telegram en cuanto activas el sondeo (consulta [Telegram](#telegram)).

Un enlace en una aplicación de mensajería se abre en el navegador integrado de esa aplicación o en el navegador predeterminado del teléfono, nunca en la aplicación de OneUptime. Por eso, una VPN por aplicación tiene que cubrir las aplicaciones de mensajería y el navegador, no solo la aplicación de OneUptime.

Pulsar 1 en una llamada, los botones de los mensajes de Slack y Microsoft Teams y los acuses de entrega de WhatsApp siguen necesitando que su proveedor llegue a tu servidor.

## Publica solo las páginas de reconocimiento

Si los teléfonos de las personas de guardia no pueden usar tu VPN, publica las páginas que abre un enlace de reconocimiento, y nada más. Pon delante de OneUptime un proxy inverso, o un túnel saliente como Cloudflare Tunnel, que no necesita ninguna regla de cortafuegos entrante, y deja pasar solo estas rutas:

| Método | Ruta | Qué sirve |
| --- | --- | --- |
| GET | `/l/*` | Los enlaces cortos de los SMS y de los mensajes de WhatsApp y Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | La página con el motivo del aviso y su botón **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | El botón **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Opcional: la página que pasa el aviso a la siguiente persona |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Opcional: su botón |
| GET | `/oneuptime-assets/*` | Las fuentes, los estilos y el logotipo de esas páginas |

:::steps
### Apunta un nombre público al proxy
Los enlaces de los mensajes se construyen a partir de tu ajuste `HOST`, así que ese nombre tiene que resolverse públicamente hacia el proxy, con un certificado de confianza pública. Con DNS dividido, las personas de tu red lo siguen resolviendo hacia la dirección privada y usan todo lo demás como antes.

### Reenvía las rutas sin cambios
Envía estas rutas al ingress de OneUptime con su método, su ruta y su cadena de consulta, y responde a todo lo demás con un 404.

### Limita la frecuencia de peticiones
Cada enlace lleva un ID aleatorio, y un enlace corto tiene ocho letras. Limita las peticiones que puede hacer cada dirección, para que nadie pueda probar ID a toda velocidad.
:::

Cuando la persona de guardia lo reconoce, la página abre la alerta en el panel, que solo carga dentro de tu red. Para entonces, el reconocimiento ya está guardado.

## Callbacks de los proveedores

### Telegram

Enviar alertas solo necesita HTTPS saliente hacia `api.telegram.org`. Vincular una cuenta supone que tu servidor reciba el mensaje `/start` que una persona envía a tu bot, de una de estas dos formas:

- **Sondeo**: activa **Poll Telegram for Messages** en **Admin Dashboard > Ajustes > Telegram**. OneUptime recoge los mensajes del bot desde Telegram cada pocos segundos por HTTPS saliente, así que nada tiene que llegar a tu servidor.
- **Webhook**: Telegram envía cada mensaje a `POST /api/notification/telegram/webhook`. Telegram [envía los webhooks](https://core.telegram.org/bots/webhooks) desde `149.154.160.0/20` y `91.108.4.0/22`, así que puedes permitir solo esas direcciones.

### Twilio

Cuando una persona de guardia pulsa 1 durante una llamada para reconocer el aviso, Twilio envía la tecla a `POST /api/user-notification-log-timeline/call/gather-input/*`. Las direcciones de los webhooks de Twilio cambian, salvo que tu edición de Twilio incluya [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Las actualizaciones de entrega de los SMS y las llamadas entrantes se describen en [Integración de Twilio](/docs/self-hosted/twilio-integration).

### WhatsApp

Las alertas y su reconocimiento no necesitan nada entrante. Meta envía los acuses de entrega y de lectura a `/api/notification/whatsapp/webhook`; sin ellos, el registro de WhatsApp de OneUptime no puede mostrar si un mensaje se entregó, se leyó o falló después de que Meta lo aceptara. Meta firma cada petición y no publica direcciones fijas.

### Slack y Microsoft Teams

Los botones, los menús y los comandos de sus mensajes llaman a tu servidor desde direcciones que ninguno de los dos publica. Las rutas, y cómo publicarlas, están en [Integración con Slack](/docs/self-hosted/slack-integration) e [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Próximos pasos

:::cards
- [Integración de Twilio](/docs/self-hosted/twilio-integration): SMS y llamadas a través de tu propia cuenta de Twilio.
- [Notificaciones push](/docs/self-hosted/push-notifications): El relé de push, y a qué llegan tu servidor y los teléfonos.
- [Visión general de las aplicaciones](/docs/mobile-desktop-apps/index): Conecta la aplicación OneUptime On-Call a tu servidor.
- [Acceso a red privada](/docs/self-hosted/private-network-access): El camino inverso: deja que OneUptime llegue a tus herramientas internas.
:::
