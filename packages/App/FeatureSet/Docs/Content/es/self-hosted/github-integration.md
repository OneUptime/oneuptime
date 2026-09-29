# Integración con GitHub

Para integrar GitHub con tu instancia auto-alojada de OneUptime, necesitas crear una aplicación de GitHub y configurar las variables de entorno requeridas. Esto permite que OneUptime se conecte a tus repositorios de GitHub para la gestión del repositorio de código.

## Prerrequisitos

- Cuenta de GitHub con acceso de administrador de la organización (para repositorios de la organización) o acceso a cuenta personal
- Acceso a la configuración de tu servidor de OneUptime

## Instrucciones de configuración

### Paso 1: Crear una aplicación de GitHub

1. Ve a GitHub y navega a la configuración de tu organización o cuenta personal:

   - **Para organizaciones:** Ve a `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **Para cuentas personales:** Ve a `https://github.com/settings/apps`

2. Haz clic en **"Nueva aplicación de GitHub"**

3. Completa el formulario de registro:
   - **Nombre de la aplicación de GitHub:** OneUptime (o cualquier nombre único): **Guarda este nombre, lo necesitarás para la variable de entorno `GITHUB_APP_NAME`**
   - **URL de la página de inicio:** `https://your-oneuptime-domain.com`
   - **URL de devolución de llamada:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **URL de configuración:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **Importante: Esta URL es donde GitHub redirige a los usuarios después de instalar la aplicación. Debe establecerse para que funcione la redirección.**
   - **Redirigir al actualizar:** Marca esta opción para redirigir a los usuarios después de que actualicen la instalación de la aplicación
   - **Request user authorization (OAuth) during installation:** **Marque esta opción obligatoria.** OneUptime usa OAuth para verificar la propiedad de la instalación y rechaza la conexión si no está activada.
   - **URL del webhook:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Secreto del webhook:** Genera una cadena aleatoria segura (guárdala para más adelante)

### Paso 2: Configurar los permisos de la aplicación

En la sección "Permisos y eventos", configura los siguientes permisos:

**Permisos del repositorio:**

| Permiso                   | Nivel de acceso     | Propósito                                                                    |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Contenidos                | Lectura y escritura | Leer archivos del repositorio, enviar ramas (requerido para el Agente de IA) |
| Solicitudes de extracción | Lectura y escritura | Crear y gestionar solicitudes de extracción, y publicar revisiones           |
| Incidencias               | Lectura y escritura | Leer incidencias y publicar los comentarios de la app — **incluidos los de los pull requests**, cuya conversación GitHub sirve a través de la API de incidencias |
| Estados de confirmación   | Lectura             | Verificar el estado de compilación/CI                                        |
| Acciones                  | Lectura             | Leer ejecuciones y registros de flujos de trabajo de GitHub Actions          |
| Metadatos                 | Lectura             | Metadatos básicos del repositorio (requerido)                                |

**Incidencias: Lectura y escritura es lo que hace que la app sea interactiva.** Sin ese permiso, las menciones se reciben y luego fallan en silencio cuando la app intenta responder: GitHub sirve los comentarios de la conversación de un pull request desde la API de incidencias, así que ese único permiso condiciona cada respuesta que escribe la app. Consulta [Trabajar con OneUptime desde GitHub](/docs/ai/github-app).

**Permisos de organización (si se usa con organizaciones):**

| Permiso  | Nivel de acceso | Propósito                              |
| -------- | --------------- | -------------------------------------- |
| Miembros | Lectura         | Listar los miembros de la organización |

**Permisos de cuenta:**

| Permiso                           | Nivel de acceso | Propósito                                                  |
| --------------------------------- | --------------- | ---------------------------------------------------------- |
| Direcciones de correo electrónico | Lectura         | Leer el correo electrónico del usuario para notificaciones |

### Paso 3: Suscribirse a eventos de webhook

OneUptime usa dos conjuntos de eventos, y cada uno hace un trabajo distinto.

**Sincronización de repositorios** — `installation` e `installation_repositories`. Las GitHub Apps los reciben automáticamente; mantienen el conjunto de repositorios conectados al día con aquello en lo que está instalada la app.

**La app interactiva** — a estos hay que suscribirse de forma explícita, y cada uno habilita una manera concreta de pasarle trabajo a la app:

| Evento                          | Qué habilita                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| **Issue comment**               | comandos con `@mención` en issues **y** en pull requests                     |
| **Issues**                      | asignar un issue a la app, y la etiqueta de activación del repositorio       |
| **Pull request**                | solicitar una revisión a la app                                              |
| **Pull request review**         | una mención escrita en el cuerpo de una revisión enviada                     |
| **Pull request review comment** | una mención en un comentario en línea del diff                               |

Si no hay ninguno suscrito, la GitHub App sigue conectando repositorios y sigue abriendo pull requests de corrección desde OneUptime: simplemente no responde nunca a nada de lo que se escriba en GitHub. Esa es la causa más habitual de "el bot me ignora". Consulta [Trabajar con OneUptime desde GitHub](/docs/ai/github-app) para saber cuáles son los comandos y quién puede darlos.

Otros eventos (**Push**, **Workflow run**) se confirman y se ignoran; suscribirse a ellos no activa notificaciones ni automatización CI/CD.

### Paso 4: Establecer el acceso de instalación

En "¿Dónde se puede instalar esta aplicación de GitHub?", elige:

- **Solo en esta cuenta**: Para uso privado/interno
- **Cualquier cuenta**: Si deseas que otros instalen tu aplicación

### Paso 5: Crear la aplicación de GitHub

1. Haz clic en **"Crear aplicación de GitHub"**
2. Serás redirigido a la página de configuración de tu aplicación
3. Anota los siguientes valores:
   - **ID de la aplicación**: Encontrado en la parte superior de la página de configuración de la aplicación
   - **ID de cliente**: Encontrado en la sección "Acerca de"

### Paso 6: Generar el secreto de cliente

1. En la configuración de tu aplicación de GitHub, desplázate hasta "Secretos de cliente"
2. Haz clic en **"Generar un nuevo secreto de cliente"**
3. Copia el secreto inmediatamente: no podrás verlo de nuevo

### Paso 7: Generar la clave privada

1. Desplázate hacia abajo hasta la sección "Claves privadas"
2. Haz clic en **"Generar una clave privada"**
3. Se descargará automáticamente un archivo `.pem`
4. Guarda este archivo de forma segura: se usa para autenticarse como la aplicación de GitHub

### Paso 8: Configurar las variables de entorno de OneUptime

#### Docker Compose

Si usas Docker Compose, agrega estas variables de entorno a tu archivo `config.env`:

```bash
# Configuración de la aplicación de GitHub
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # El nombre exacto de tu aplicación de GitHub (por ejemplo, "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Nota:** Para la clave privada, codifícala en base64 y pégala sin saltos de línea si tu entorno no admite cadenas de varias líneas.

#### Kubernetes con Helm

Si usas Kubernetes con Helm, agrega esto a tu archivo `values.yaml`:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # El nombre exacto de tu aplicación de GitHub
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Importante:** Reinicia tu servidor de OneUptime después de agregar estas variables de entorno para que surtan efecto.

### Paso 9: Instalar la aplicación de GitHub

1. Ve a la página pública de tu aplicación de GitHub: `https://github.com/apps/YOUR_APP_NAME`
2. Haz clic en **"Instalar"** o **"Configurar"**
3. Selecciona la organización o cuenta donde deseas instalar la aplicación
4. Elige a qué repositorios puede acceder la aplicación:
   - **Todos los repositorios**: Acceso a todos los repositorios actuales y futuros
   - **Solo repositorios seleccionados**: Elige repositorios específicos
5. Haz clic en **"Instalar"**

### Paso 10: Conectar repositorios en OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Navega a **Productos** > **Repositorios de código**
3. Haz clic en **"Crear repositorio"** o usa el flujo de instalación de la aplicación de GitHub
4. Si se redirige desde GitHub, el ID de instalación se capturará automáticamente
5. Selecciona los repositorios que deseas conectar de la lista
6. Haz clic en **"Conectar"** para vincular el repositorio a tu proyecto de OneUptime

## Referencia de variables de entorno

| Variable                    | Descripción                                                                     | Requerida             |
| --------------------------- | ------------------------------------------------------------------------------- | --------------------- |
| `GITHUB_APP_ID`             | El ID de la aplicación de la configuración de tu aplicación de GitHub           | Sí                    |
| `GITHUB_APP_NAME`           | El nombre exacto de tu aplicación de GitHub (usado para las URL de instalación) | Sí                    |
| `GITHUB_APP_CLIENT_ID`      | El ID de cliente de la configuración de tu aplicación de GitHub                 | Sí                    |
| `GITHUB_APP_CLIENT_SECRET`  | El secreto de cliente que generaste                                             | Sí                    |
| `GITHUB_APP_PRIVATE_KEY`    | El contenido del archivo de clave privada (.pem)                                | Sí                    |
| `GITHUB_APP_WEBHOOK_SECRET` | El secreto del webhook para verificar las cargas útiles del webhook             | Sí, para webhooks |

## Acceso de red para despliegues autohospedados

### Dirección del tráfico y endpoints

| Tráfico | Acceso necesario |
| --- | --- |
| OneUptime → GitHub | DNS y HTTPS saliente por TCP 443 a `api.github.com` para tokens de aplicación y API de repositorios, y a `github.com` para intercambio OAuth y operaciones Git HTTPS |
| GitHub → OneUptime | HTTPS público por TCP 443 a `POST /api/github/webhook` para sincronizar instalación y acceso a repositorios |
| Navegador del usuario → OneUptime | Panel y `GET /api/github/auth/callback` para redirecciones de instalación/autorización; pueden permanecer accesibles por VPN |

Las URL callback/setup son una [redirección del navegador](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url); los servidores GitHub llaman al webhook. La VPN del usuario no da acceso al webhook a GitHub. Los dominios cubren solicitudes principales; herramientas, descargas, LFS o paquetes pueden necesitar otros destinos. Esta configuración corresponde a GitHub.com: cambiar el cortafuegos no configura compatibilidad con un hostname de GitHub Enterprise Server.

### Despliegues privados y seguridad de callbacks

Use DNS público y una pasarela con certificado HTTPS de confianza pública, cadena completa y ruta privada al ingress de OneUptime. Permita TCP 443 entrante y publique únicamente los callbacks POST del proveedor indicados arriba. Un `ClusterIP` privado, DNS interno o VPN de empleado no proporciona acceso al proveedor. DNS dividido permite mantener el panel y las rutas OAuth del navegador privados bajo el mismo hostname.

Configure `HOST=oneuptime.example.com` y `HTTP_PROTOCOL=https` en `config.env`, o `host: oneuptime.example.com` y `httpProtocol: https` en Helm. Aplique los cambios y espere al reinicio. Estos valores generan URL; no aprovisionan DNS, TLS ni reglas de cortafuegos. Si cambia el hostname, actualice las URL webhook, callback, setup y homepage de la GitHub App.

Conserve método, ruta original, parámetros, cuerpo, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` y `X-GitHub-Delivery`. Preserve host público y HTTPS mediante cabeceras de proxy confiables. Exima el webhook de SSO del navegador, CAPTCHA y páginas de autenticación del proxy. Mantenga la verificación SSL de GitHub y el mismo `GITHUB_APP_WEBHOOK_SECRET` en ambos sistemas: OneUptime rechaza solicitudes sin firma y no valida webhooks sin el secreto. Consulte la [validación de GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Si restringe también IP de origen, use y actualice periódicamente los rangos `hooks` de GitHub Meta API. No utilice rangos de runners de GitHub Actions ni omita la firma. GitHub advierte que [las direcciones cambian y la lista no es exhaustiva](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Verificar el acceso y conocer las limitaciones

Complete la instalación desde OneUptime y consulte **Advanced > Recent Deliveries** de la GitHub App. Envíe o reenvíe una entrega de prueba y verifique su encaminamiento y aceptación. Añada o quite un repositorio de prueba de la instalación y compruebe la lista conectada. GitHub documenta el [diagnóstico de entregas](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) y exige [confirmación 2xx en diez segundos](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Un GET del navegador no prueba un POST firmado.

Sin acceso entrante pueden funcionar autorización del navegador y operaciones API/Git salientes, pero no se sincronizan por webhook la eliminación de instalaciones ni los cambios de acceso a repositorios. OneUptime procesa actualmente `installation` e `installation_repositories`; aceptar otros eventos no implica automatización adicional. La [configuración de acceso a redes privadas](/docs/self-hosted/private-network-access) controla solicitudes salientes a destinos privados y no hace accesible el webhook.

## Solución de problemas

### Problemas comunes

**No se redirige de nuevo a OneUptime después de instalar la aplicación de GitHub:**

- Asegúrate de que la **URL de configuración** esté configurada en la configuración de tu aplicación de GitHub como: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Ve a la configuración de tu aplicación de GitHub > sección "Post instalación" y verifica que la URL de configuración esté establecida correctamente
- La opción "Redirigir al actualizar" también debe estar marcada
- Nota: La URL de configuración es diferente de la URL de devolución de llamada; ambas deben apuntar al mismo punto de conexión `/api/github/auth/callback`

**Error "La aplicación de GitHub no está configurada":**

- Asegúrate de que la variable de entorno `GITHUB_APP_CLIENT_ID` esté establecida
- Reinicia tu servidor de OneUptime después de establecer las variables de entorno

**Error "Firma de webhook no válida":**

- Verifica que tu `GITHUB_APP_WEBHOOK_SECRET` coincida con el secreto configurado en GitHub
- Asegúrate de que la URL del webhook sea correcta y accesible desde internet

**Error "Error al obtener el token de acceso de instalación":**

- Verifica que tu `GITHUB_APP_PRIVATE_KEY` tenga el formato correcto
- Comprueba que la clave privada incluya los marcadores BEGIN/END
- Asegúrate de que el ID de la aplicación sea correcto

**No se pueden ver los repositorios después de la instalación:**

- Verifica que la aplicación de GitHub tenga acceso a los repositorios que deseas conectar
- Comprueba los permisos de instalación en GitHub (Configuración > Aplicaciones > Aplicaciones de GitHub instaladas)

**Los eventos del webhook no se reciben:**

- Asegúrate de que la URL de tu webhook sea accesible públicamente
- Comprueba los registros de entrega del webhook de la aplicación de GitHub en la configuración de tu aplicación
- Verifica que el secreto del webhook esté correctamente configurado

### Comprobación de las entregas del webhook

1. Ve a la configuración de tu aplicación de GitHub
2. Haz clic en "Avanzado" en la barra lateral
3. Ve "Entregas recientes" para ver los intentos y respuestas del webhook

## Buenas prácticas de seguridad

1. **Rota los secretos regularmente**: Genera nuevos secretos de cliente y claves privadas periódicamente
2. **Usa secretos de webhook**: Siempre configura un secreto de webhook para verificar la autenticidad de la carga útil
3. **Limita el acceso al repositorio**: Solo concede acceso a los repositorios que necesitan estar conectados
4. **Monitorea las entregas del webhook**: Revisa regularmente para detectar entregas fallidas o actividad sospechosa
5. **Mantén las claves privadas seguras**: Nunca confirmes las claves privadas en el control de versiones

## Soporte

Si encuentras problemas con la integración de GitHub, por favor:

1. Consulta la sección de solución de problemas anterior
2. Revisa los registros de OneUptime para ver mensajes de error detallados
3. Contáctanos en [hello@oneuptime.com](mailto:hello@oneuptime.com)

¡Agradecemos los comentarios para mejorar esta integración!
