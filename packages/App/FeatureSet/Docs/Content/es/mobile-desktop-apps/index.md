# Visión general de las aplicaciones

OneUptime tiene una aplicación para su teléfono y otra para su ordenador. **OneUptime On-Call**, para iPhone, iPad y Android, le avisa cuando está de guardia y le permite reconocer y resolver desde donde esté. En Windows, macOS y Linux, el panel de OneUptime se instala desde su navegador como una aplicación de escritorio con su propia ventana. Las dos funcionan con OneUptime Cloud y con un OneUptime que usted aloje.

:::cards
- [Elegir una aplicación](#elegir-una-aplicación): Para qué sirve cada aplicación, lado a lado.
- [Cómo llegan las aplicaciones a OneUptime](#cómo-llegan-las-aplicaciones-a-oneuptime): Por dónde viajan el inicio de sesión y los avisos de guardia.
- [Obtener la aplicación móvil](#obtener-la-aplicación-móvil): Desde el App Store, Google Play o GitHub.
- [Obtener la aplicación de escritorio](#obtener-la-aplicación-de-escritorio): Instalar el panel desde Edge, Chrome o Safari.
:::

## Elegir una aplicación

|  | Aplicación móvil | Aplicación de escritorio |
| --- | --- | --- |
| Qué es | OneUptime On-Call, una aplicación nativa para iPhone, iPad y Android | El panel de OneUptime, instalado desde su navegador |
| Dónde se obtiene | El App Store, Google Play, o un APK de GitHub | Su propio OneUptime: no hay nada que descargar |
| Avisos de guardia | Notificaciones push, que pueden sonar pese al modo silencio y a No molestar | Notificaciones del navegador, una vez registrado el navegador |
| Qué puede hacer | Incidentes, alertas, casos de seguridad, monitores y quién está de guardia; reconocer, resolver, aprobar pasos de playbook y añadir notas | Todo lo que hace el panel |
| Actualizaciones | Desde la tienda, o instalando un APK más reciente | Cada vez que se abre, carga el panel desde su OneUptime |
| Funciona en | iOS 16.4 o posterior, Android 7.0 o posterior | Windows, macOS y Linux, con Edge o Chrome, o Safari en macOS Sonoma 14 o posterior |

Puede usar las dos: tenga la aplicación de escritorio abierta en el trabajo, y deje que el teléfono le despierte por la noche.

## Cómo llegan las aplicaciones a OneUptime

```mermaid title="Cómo llegan los avisos de guardia a su teléfono y a su ordenador"
flowchart TB
    OneUptime["Su OneUptime:<br/>Cloud o autoalojado"]
    Expo["Servicio push de Expo,<br/>luego Apple o Google"]
    WebPush["El servicio push<br/>de su navegador"]
    Phone["OneUptime On-Call<br/>en su teléfono"]
    Desktop["La aplicación de escritorio<br/>en su ordenador"]
    OneUptime -->|"a un teléfono"| Expo
    OneUptime -->|"a un navegador<br/>registrado"| WebPush
    Expo -->|"notificación push"| Phone
    WebPush -->|"notificación"| Desktop
```

La aplicación móvil inicia sesión en su OneUptime y registra el teléfono en cada proyecto del que usted es miembro. A partir de ahí, OneUptime envía las notificaciones push del teléfono, entre ellas los avisos de guardia, a través del servicio push de Expo, que las entrega a Apple o Google para su envío. De forma predeterminada, un OneUptime autoalojado las envía a través del relé push de OneUptime, así que no necesita cuenta propia de Apple, Google ni Expo: consulte [Notificaciones push](/docs/self-hosted/push-notifications).

La aplicación de escritorio es el propio panel, en su propia ventana. Muestra notificaciones una vez que registra su navegador para las notificaciones push: las páginas de Windows, macOS y Linux muestran cómo.

## Antes de empezar

- Una cuenta en un proyecto de OneUptime. Para recibir avisos, también debe estar de guardia: consulte [Reglas de escalado](/docs/on-call/escalation-rules).
- La dirección de su OneUptime. En OneUptime Cloud es `https://oneuptime.com`; un OneUptime autoalojado tiene la suya, por ejemplo `https://oneuptime.example.com`.
- Su OneUptime servido por HTTPS. La aplicación móvil no se conecta por HTTP simple, y los navegadores solo muestran notificaciones, y Edge y Chrome solo instalan aplicaciones, para sitios HTTPS.

## Obtener la aplicación móvil

:::steps
### Instalar OneUptime On-Call
Obténgala del [App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) en un iPhone o iPad, o de [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) en Android. Para un teléfono Android sin Google Play, instale en su lugar el [APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk). Los mismos enlaces están en el panel, en **Ajustes del proyecto → Notificaciones → Aplicaciones móviles**.

### Conectarla a su OneUptime
Abra la aplicación, mantenga `https://oneuptime.com` para OneUptime Cloud o escriba la dirección de su propio OneUptime, e inicie sesión con su contraseña, una clave de acceso o inicio de sesión único.

### Permitir las notificaciones
Permítalas cuando el teléfono lo pregunte. La aplicación registra el teléfono en cada uno de sus proyectos, y sus avisos de guardia empiezan a llegarle.
:::

Cada paso en detalle, con lo que debe comprobar después: [Instalación en Android](/docs/mobile-desktop-apps/android-installation) e [Instalación en iOS](/docs/mobile-desktop-apps/ios-installation).

## Obtener la aplicación de escritorio

:::steps
### Abrir su panel
Inicie sesión en su OneUptime en Microsoft Edge o Google Chrome, o en Safari en un Mac.

### Instalarlo
En Edge o Chrome, haga clic en el icono de instalación a la derecha de la barra de direcciones. En Safari, elija **Archivo → Añadir al Dock**.

### Abrirlo como cualquier otra aplicación
Se abre en su propia ventana, desde el menú Inicio, el Dock o su lanzador de aplicaciones.
:::

Cada navegador paso a paso: [Instalación en Windows](/docs/mobile-desktop-apps/windows-installation), [Instalación en macOS](/docs/mobile-desktop-apps/macos-installation) e [Instalación en Linux](/docs/mobile-desktop-apps/linux-installation).

## Próximos pasos

:::cards
- [Instalación en Android](/docs/mobile-desktop-apps/android-installation): Instalar la aplicación en Android, iniciar sesión y comprobar que llegan los avisos.
- [Instalación en iOS](/docs/mobile-desktop-apps/ios-installation): Instalar la aplicación en un iPhone o iPad y activar las alertas críticas.
- [Instalación en Windows](/docs/mobile-desktop-apps/windows-installation): Instalar el panel desde Edge o Chrome.
- [Instalación en macOS](/docs/mobile-desktop-apps/macos-installation): Añadir el panel al Dock desde Safari, Chrome o Edge.
- [Instalación en Linux](/docs/mobile-desktop-apps/linux-installation): Instalar el panel desde Chrome, Chromium o Edge.
- [Preguntas frecuentes y solución de problemas](/docs/mobile-desktop-apps/faq-troubleshooting): Respuestas, soluciones, y qué hacer cuando un teléfono deja de recibir avisos.
:::
