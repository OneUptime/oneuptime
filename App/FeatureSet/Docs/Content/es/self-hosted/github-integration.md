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
   - **URL del webhook:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Secreto del webhook:** Genera una cadena aleatoria segura (guárdala para más adelante)

### Paso 2: Configurar los permisos de la aplicación

En la sección "Permisos y eventos", configura los siguientes permisos:

**Permisos del repositorio:**

| Permiso                   | Nivel de acceso     | Propósito                                                                    |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Contenidos                | Lectura y escritura | Leer archivos del repositorio, enviar ramas (requerido para el Agente de IA) |
| Solicitudes de extracción | Lectura y escritura | Crear y gestionar solicitudes de extracción                                  |
| Incidencias               | Lectura y escritura | Leer y comentar en incidencias                                               |
| Estados de confirmación   | Lectura             | Verificar el estado de compilación/CI                                        |
| Acciones                  | Lectura             | Leer ejecuciones y registros de flujos de trabajo de GitHub Actions          |
| Metadatos                 | Lectura             | Metadatos básicos del repositorio (requerido)                                |

**Permisos de organización (si se usa con organizaciones):**

| Permiso  | Nivel de acceso | Propósito                              |
| -------- | --------------- | -------------------------------------- |
| Miembros | Lectura         | Listar los miembros de la organización |

**Permisos de cuenta:**

| Permiso                           | Nivel de acceso | Propósito                                                  |
| --------------------------------- | --------------- | ---------------------------------------------------------- |
| Direcciones de correo electrónico | Lectura         | Leer el correo electrónico del usuario para notificaciones |

### Paso 3: Suscribirse a eventos de webhook

Eventos para que OneUptime reciba actualizaciones en tiempo real; suscríbete a estos eventos de webhook:

- **Solicitud de extracción**: Recibir notificaciones cuando se abren, cierran o fusionan PRs
- **Envío**: Recibir notificaciones cuando se envía código
- **Ejecución de flujo de trabajo**: Recibir actualizaciones de estado de CI/CD

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
2. Navega a **Más** > **Repositorios de código**
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
| `GITHUB_APP_WEBHOOK_SECRET` | El secreto del webhook para verificar las cargas útiles del webhook             | No (pero recomendado) |

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
