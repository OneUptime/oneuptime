# Comprobaciones de actualizaciones y seguridad

Una vez al día, un OneUptime autoalojado pregunta a GitHub si hay una versión más reciente y si algún aviso de seguridad publicado por OneUptime afecta a la versión que ejecutas. Cuando alguno la afecta, se pide a tus administradores maestros que actualicen. Esta página explica qué envía la comprobación, qué ves y cómo desactivarla.

:::cards
- [Qué envía la comprobación](#qué-envía-la-comprobación): Dos preguntas públicas, y nada sobre tu instalación.
- [Qué ves](#qué-ves): El pie de página, el Admin Dashboard y un correo por aviso.
- [Desactiva la comprobación](#desactiva-la-comprobación): Para una red sin acceso a internet, o para usar un espejo.
:::

## Qué envía la comprobación

El worker envía dos peticiones a la API de GitHub (`api.github.com`), sin token:

| Petición | Qué pregunta |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Cuál es la versión más reciente de OneUptime |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Qué avisos de seguridad ha publicado OneUptime, las versiones a las que afecta cada uno y la versión que lo corrige |

No incluyen nada sobre tu instalación: ni la versión que ejecutas, ni su dirección, ni nada sobre tus usuarios, proyectos o datos de monitorización. GitHub ve la dirección IP pública de tu servidor, como en cualquier petición, y un `User-Agent` que nombra a OneUptime. Si un aviso afecta a tu versión se calcula en tu servidor, y ningún navegador llama a GitHub.

La comprobación se ejecuta cuando arranca el worker y, después, una vez al día. Vuelve a preguntar a GitHub como mucho cada 12 horas, y como mucho una vez por hora tras una petición fallida.

## Qué ves

Solo se avisa a los administradores maestros. Son quienes pueden actualizar, y decirle a cualquier otra persona que el servidor ejecuta una versión con un problema de seguridad conocido señalaría un servidor sin parchear.

- Una versión más reciente añade **Actualización disponible** al pie de página del Dashboard y del Admin Dashboard. Al hacer clic, se abre la guía de actualización.
- Un aviso de seguridad publicado que afecta a la versión que ejecutas añade ahí, en su lugar, **Actualización de seguridad**, en rojo.
- La primera página del Admin Dashboard muestra entonces cada aviso: su gravedad, las versiones a las que afecta, la versión que lo corrige y un enlace al aviso en GitHub. También indica cuándo leyó la comprobación los avisos por última vez y, si la última comprobación falló, por qué.
- Tus administradores maestros y el Correo de notificación admin (**Ajustes** > **Correos** en el Admin Dashboard) reciben un correo sobre cada aviso que afecta a tu versión, y nunca un segundo.

Todo esto desaparece en cuanto ejecutas una versión a la que no afecta ningún aviso. Para actualizar, consulta [Actualización](/docs/installation/upgrading).

## Desactiva la comprobación

En una red sin acceso a internet, o si tu servidor no debe contactar con GitHub, desactiva la comprobación. Entonces no se muestra nada ni se envía nada por correo.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Establécelo en `config.env` y después ejecuta `npm start`.
:::

Para comprobar en su lugar contra un espejo dentro de tu red, apunta la comprobación hacia él. El espejo tiene que responder con los formatos de GitHub.

| Valor de Helm | Ajuste de Docker Compose | Predeterminado |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Cuando no se puede llegar a GitHub

En una red sin acceso a internet, una petición fallida es lo esperado, no un error. El worker la registra con nivel debug, conserva lo último que leyó y vuelve a intentarlo más tarde. El Admin Dashboard indica cuándo se leyeron los avisos por última vez y por qué falló la última comprobación: el límite de frecuencia de GitHub, ninguna ruta hacia GitHub, un tiempo de espera agotado o una respuesta que no es de GitHub.

## Próximos pasos

:::cards
- [Actualización](/docs/installation/upgrading): Actualiza a una versión más reciente, de una versión principal en una.
- [Arquitectura](/docs/self-hosted/architecture): Cada conexión que establece un OneUptime autoalojado.
- [Detrás de una VPN o un cortafuegos](/docs/self-hosted/behind-a-firewall): Qué llega a tu servidor desde fuera.
:::
