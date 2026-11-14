# Guía de autoalojamiento

Sigue esta página de arriba abajo para pasar de un servidor vacío a tu propio OneUptime, que funciona con HTTPS, te ha enviado un correo de prueba y puede avisarte. Cada paso termina con cómo saber que ha funcionado, y enlaza a las páginas más largas para los detalles.

:::cards
- [Instalar OneUptime](#instalar-oneuptime): Docker Compose en un servidor, o el chart de Helm en Kubernetes.
- [Terminar de configurar el servidor](#terminar-de-configurar-el-servidor): El correo, luego los SMS y las llamadas, cada uno con una prueba.
- [Comprobar tu instalación](#comprobar-tu-instalación): Un comando que nombra lo que está mal.
- [Inicio rápido](/docs/introduction/quickstart): Tu primer monitor, tu primera política de guardia y tu primera página de estado.
:::

## Qué necesitas

- **Un servidor.** Para Docker Compose, un servidor Linux con 8 GB de memoria, 4 núcleos y 20 GB de disco para probar OneUptime, o 16 GB, 8 núcleos y 400 GB para un equipo: consulta [Dimensionamiento y planificación de capacidad](/docs/installation/sizing). Para el chart de Helm, un clúster de Kubernetes.
- **Un nombre de dominio** con el que se abrirá OneUptime, como `oneuptime.example.com`, con un registro DNS `A` que apunte al servidor. Puedes empezar con la dirección IP del servidor, pero un certificado de Let's Encrypt necesita un nombre de dominio.
- **Los puertos 80 y 443** accesibles desde internet, para HTTPS.
- **Una forma de enviar correo**: un servidor de correo, como el de tu empresa, Microsoft 365 o Google Workspace, o una cuenta en Amazon SES, SendGrid, Mailgun, Postmark o Resend.
- **Una cuenta de Twilio**, para recibir avisos por SMS y llamada telefónica. El correo y las notificaciones push no la necesitan.

**Ha funcionado cuando** `dig +short oneuptime.example.com` muestra la dirección IP del servidor.

## Instalar OneUptime

:::tabs
@tab Docker Compose
En un servidor nuevo con Ubuntu, Debian o una distribución basada en RHEL, un solo comando instala Docker, Git y Node.js si faltan, clona OneUptime en una carpeta `oneuptime`, pregunta la dirección que se usará y lo arranca:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Para hacer lo mismo a mano, con Docker, Git y Node.js instalados:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Abre `config.env` y define `HOST`, su primer ajuste, con tu nombre de dominio o tu dirección IP, sin `http://`. Es el único ajuste que tienes que cambiar: el correo, los SMS y las llamadas se configuran en el Admin Dashboard, y todo lo que hay bajo `ADVANCED` funciona tal como está. Después arranca OneUptime:

```bash
npm start
```

**Ha funcionado cuando** `npm start` termina con **OneUptime is up!** y la dirección que hay que abrir. El primer arranque tarda varios minutos, mientras Docker descarga las imágenes. Si `npm start` se detiene antes, dice qué cambiar. [Docker Compose](/docs/installation/docker-compose) tiene todos los detalles.
@tab Kubernetes
Crea un `values.yaml` con tu nombre de dominio o tu dirección IP, sin `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

El chart guarda sus datos en la clase de almacenamiento predeterminada de tu clúster. Si `kubectl get storageclass` no marca ninguna como `(default)`, añade `global.storageClass` con el nombre de una. Después instala el chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Ha funcionado cuando** `kubectl get pods` muestra todos los pods `Running` y la dirección que mostró `helm install` abre OneUptime. La [guía de instalación del chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) tiene todos los detalles.
:::

## Activar HTTPS

Cuando tu nombre de dominio apunte al servidor, deja que OneUptime obtenga un certificado gratuito de Let's Encrypt. Lo renueva por sí mismo.

:::tabs
@tab Docker Compose
Define estos valores en `config.env` y vuelve a ejecutar `npm start`:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

¿Ya tienes un proxy inverso, como Caddy, Nginx o un balanceador de carga? Mantén `PROVISION_SSL=false`, define `HTTP_PROTOCOL=https` y `TRUSTED_PROXY_HOPS=2`, y consulta [Usar tu propio proxy inverso](/docs/installation/docker-compose#usar-tu-propio-proxy-inverso).
@tab Kubernetes
Define estos valores en `values.yaml` y aplícalos:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Para terminar TLS en un controlador de ingress propio, deja `ssl.provision` desactivado y define solo `httpProtocol: https`.
:::

**Ha funcionado cuando** `https://oneuptime.example.com` se abre sin aviso de certificado. El primer certificado suele llegar en pocos minutos. ¿Pruebas OneUptime en `localhost`? Sáltate este paso: un certificado necesita un nombre de dominio.

## Crear la cuenta de administrador

Abre tu dirección, como `https://oneuptime.example.com`, y regístrate. La primera cuenta de un servidor nuevo se convierte en su administrador principal, que puede abrir el Admin Dashboard en `/admin`.

**Ha funcionado cuando** `/admin` abre el Admin Dashboard. Mientras el correo, HTTPS o la decisión sobre los registros sigan pendientes, se abre en **Termine de configurar este servidor**.

## Terminar de configurar el servidor

La página **Configuración del servidor** del Admin Dashboard, en `/admin/setup`, enumera lo que necesita un servidor nuevo, lo más importante primero. El correo, HTTPS y quién puede registrarse son obligatorios. Los SMS y las llamadas, una sonda global, las copias de seguridad y las comprobaciones de actualizaciones son recomendados. Cada elemento tiene un botón que abre el lugar donde se configura, y `npm start` termina mostrando la dirección de esta página.

:::steps
### Configurar el correo

Haz clic en **Configurar el correo electrónico**. Abre **Ajustes > Notificaciones > Correos**, donde introduces tu servidor de correo (la mayoría usa el puerto `587`) o tu proveedor de correo, y la dirección desde la que salen los correos. Guarda, haz clic en **Enviar correo de prueba** y envíate uno.

**Ha funcionado cuando** llega el correo y la lista marca el correo como hecho. Si la prueba falla, muestra lo que respondió el servidor de correo: consulta [SMTP](/docs/emails/smtp#solución-de-problemas).

### Elegir quién puede registrarse

Cualquiera que pueda abrir tu dirección puede registrarse. Cuando tu equipo tenga sus cuentas, desactiva **Permitir el registro** en **Ajustes > Autenticación**: quien invites a un proyecto podrá unirse igualmente. Para dejar los registros abiertos, haz clic en **Mantener abiertos los registros**.

**Ha funcionado cuando** la lista marca los registros como hechos.

### Configurar SMS y llamadas, o usar solo correo y push

Para recibir avisos por SMS y llamada telefónica, haz clic en **Configurar SMS y llamadas** y añade tu cuenta de Twilio en **Ajustes > Notificaciones > Llamadas y SMS**: [Integración de Twilio](/docs/self-hosted/twilio-integration) muestra dónde encontrar cada valor. Después haz clic en **Enviar SMS de prueba** y **Hacer llamada de prueba**. Para enviarlos por una pasarela propia, consulta [Pasarela de SMS y llamadas](/docs/self-hosted/sms-and-call-gateway). Si el correo y las notificaciones push te bastan, haz clic en **Usar solo correo y notificaciones push**.

**Ha funcionado cuando** llega el SMS y suena tu teléfono, o la lista muestra tu elección.
:::

El elemento de HTTPS queda hecho cuando [Activar HTTPS](#activar-https) funciona, y cada elemento recomendado dice qué hacer.

## Comprobar tu instalación

:::tabs
@tab Docker Compose
En la carpeta `oneuptime`, ejecuta el doctor:

```bash
npm run doctor
```

Comprueba cada contenedor, `config.env`, que `HOST` llegue a este servidor, el certificado y el disco libre, y pregunta a OneUptime qué ve de sí mismo, como el correo y las sondas. Cada problema viene con su solución: consulta [Comprobar tu instalación](/docs/installation/docker-compose#comprobar-tu-instalación).
@tab Kubernetes
Ejecuta el script de diagnóstico del chart contra tu clúster, como muestra la [guía de solución de problemas del chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it). Solo lee, y termina con un resumen de lo que encontró, lo peor primero.
:::

**Ha funcionado cuando** el doctor termina con **Everything looks right.** y sale con `0`. Sale con `1` cuando hay algo que arreglar, y con `2` cuando no pudo hacer sus comprobaciones. En Kubernetes, el resumen no tiene ningún hallazgo `CRITICAL`.

## Monitorizar algo y recibir avisos

Tu servidor ya puede enviar correos y avisar a las personas. El [Inicio rápido](/docs/introduction/quickstart) continúa en el producto: un monitor para tu sitio web, una política de guardia que te avisa cuando se cae y una página de estado, en unos quince minutos. Su última parte declara un incidente de prueba, para que veas llegar el aviso.

## Solución de problemas

:::details npm start se detiene y dice que HOST aún no es una dirección
`HOST` en `config.env` todavía tiene un marcador, como `<your-address>`. Defínelo con tu nombre de dominio o tu dirección IP, sin `http://`, y vuelve a ejecutar `npm start`.
:::

:::details El correo de prueba falla
El mensaje bajo el botón es lo que respondió el servidor de correo. Revisa el nombre del host, el puerto, el usuario y la contraseña, y que el servidor de correo te deje enviar desde la dirección de la que salen los correos. Consulta [SMTP](/docs/emails/smtp#solución-de-problemas).
:::

:::details El navegador avisa sobre el certificado
Let's Encrypt necesita los puertos 80 y 443 accesibles desde internet, y tu nombre de dominio apuntando a este servidor. Espera unos minutos y ejecuta `npm run doctor`: comprueba el certificado y dice qué está mal.
:::

## Próximos pasos

:::cards
- [Inicio rápido](/docs/introduction/quickstart): Un monitor, una política de guardia y una página de estado en quince minutos.
- [Docker Compose](/docs/installation/docker-compose): Tu propio proxy, copias de seguridad, actualizaciones y la lista para producción.
- [Actualización](/docs/installation/upgrading): Pasar a una versión nueva, una versión principal cada vez.
- [Arquitectura](/docs/self-hosted/architecture): Cómo encajan las partes de OneUptime.
:::
