# Lista blanca de números de teléfono

En OneUptime Cloud, los SMS y las llamadas de guardia llegan desde los números de abajo. Añádelos a la lista de permitidos de tu teléfono para que un aviso nunca se bloquee, se silencie ni se marque como spam.

## Números de OneUptime Cloud

| Número | País |
| --- | --- |
| +13022917020 | Estados Unidos (US) |
| +447427817020 | Reino Unido (UK) |

## Permite los números en tu teléfono

:::steps
1. Guarda los dos números en los contactos de tu teléfono como un único contacto, por ejemplo «OneUptime».
2. Si usas No molestar, un modo de concentración u otro modo silencioso, permite las llamadas y los mensajes de ese contacto.
3. Si tienes activada una aplicación de filtrado de llamadas o de spam, o la protección contra spam de tu operador, marca también allí los dos números como de confianza.
:::

> [!TIP]
> Añadir o verificar tu número de teléfono en **Ajustes de usuario** > **Métodos de notificación** te envía un código desde estos números, así que es una forma rápida de comprobar que llegan.

## Cuando los avisos llegan desde otros números

Tus avisos llegan desde números distintos de los de arriba cuando:

- **Tu proyecto usa su propia cuenta de Twilio.** Cuando un proyecto tiene una configuración de Twilio definida como predeterminada del proyecto (**Ajustes del proyecto** > **Notificaciones** > **Ajustes de notificaciones** > **Configuración de Twilio**), los SMS y las llamadas a los miembros del proyecto pasan por esa cuenta, desde sus números de teléfono. Añade esos números a la lista blanca en su lugar.
- **Usas una instalación autoalojada.** Los SMS y las llamadas llegan desde los números de Twilio que configuró tu administrador: la configuración de Twilio predeterminada del proyecto, o la de toda la instalación en **Admin Dashboard** > **Ajustes** > **Llamadas y SMS**. Pregunta a tu administrador qué números añadir a la lista blanca.

## Próximos pasos

:::cards
- [Reglas de escalado](/docs/on-call/escalation-rules): Cómo se localiza a cada persona que avisa un nivel, y en qué orden.
- [Programaciones de guardia](/docs/on-call/schedules): Decide quién está de guardia y cuándo.
- [Integración de SMS y voz de Twilio](/docs/self-hosted/twilio-integration): Usa tu propia cuenta y tus propios números de Twilio en una instalación autoalojada.
:::
