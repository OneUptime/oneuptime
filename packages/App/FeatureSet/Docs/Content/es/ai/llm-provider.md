# Proveedores LLM

OneUptime admite la integración con diversos proveedores de Modelos de Lenguaje Grande (LLM) para habilitar funciones impulsadas por IA en toda la plataforma. Esta guía te ayudará a configurar tu propio proveedor LLM.

## ¿Qué pueden hacer los proveedores LLM?

Los proveedores LLM en OneUptime te ayudan a automatizar y mejorar tu flujo de trabajo de gestión de incidentes:

- **Notas de incidentes**: Generar automáticamente notas detalladas de incidentes y actualizaciones
- **Notas de alertas**: Crear descripciones y contexto significativos para las alertas
- **Notas de mantenimiento programado**: Generar notas de eventos de mantenimiento automáticamente
- **Análisis post-mortem de incidentes**: Redactar automáticamente informes completos de análisis post-mortem de incidentes
- **Mejoras de código**: Si conectas tu repositorio de código a OneUptime, utilizaremos tu proveedor LLM para analizar datos de telemetría (registros, trazas, métricas, excepciones) y sugerir mejoras de código

## Usuarios de OneUptime SaaS

Si utilizas **OneUptime SaaS** (versión alojada en la nube), puedes usar el **Proveedor LLM global** de forma predeterminada sin ninguna configuración adicional. El Proveedor LLM global está preconfigurado y listo para usar para todas las funciones de IA.

Si prefieres usar tus propias claves de API o un proveedor específico, aún puedes configurar un proveedor LLM personalizado siguiendo las instrucciones a continuación.

OneUptime SaaS solo puede llegar a endpoints de LLM en internet público. No puede conectarse a un modelo de tu red privada, como un servidor Ollama o vLLM autoalojado. Para usar un modelo que ejecutas tú mismo, autoaloja OneUptime en una red que pueda llegar a él o expón el modelo en un endpoint público; consulta [Cómo elegir la URL base de un modelo autoalojado](#cómo-elegir-la-url-base-de-un-modelo-autoalojado).

## Autoalojado: configuración cero con variables de entorno

En una instancia autoalojada, la forma más rápida de activar las funciones de IA para **todos los proyectos a la vez** es definir las variables de entorno `GLOBAL_LLM_PROVIDER_*` en tu servidor de OneUptime: en `config.env` para Docker Compose, o mediante los valores de Helm. Al arrancar, OneUptime registra a partir de ellas un Proveedor LLM global (y lo mantiene sincronizado); no hace falta configurar nada en el panel para cada proyecto, y las tareas de corrección de IA también lo usan cuando un proyecto no tiene un proveedor propio.

| Variable | Descripción |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Obligatoria para activarlo. Uno de estos valores: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | Clave de API: obligatoria para OpenAI, Azure OpenAI, Anthropic, Groq y Mistral; no hace falta para Ollama ni para servidores compatibles con OpenAI sin clave |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Punto de conexión de la API: obligatorio para Azure OpenAI, Ollama y servidores compatibles con OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modelo que se usará (obligatorio para servidores compatibles con OpenAI, recomendado en los demás casos) |
| `GLOBAL_LLM_PROVIDER_NAME` | Nombre descriptivo opcional que se muestra en el panel |

**Ejemplo: Ollama autoalojado**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# Una dirección a la que llegue el servidor de OneUptime. Nunca localhost:
# consulta "Cómo elegir la URL base de un modelo autoalojado" más abajo.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No hace falta clave de API: Ollama funciona sin clave.
```

**Ejemplo: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

La sincronización es declarativa: si cambias las variables, el proveedor se actualiza en el siguiente reinicio, y si eliminas `GLOBAL_LLM_PROVIDER_TYPE`, se borra. Los proveedores globales creados manualmente en el panel de administración nunca se modifican. Los proyectos pueden seguir añadiendo su propio proveedor en **Ajustes del proyecto** > **IA** > **Proveedores de LLM**; un proveedor propio del proyecto siempre tiene prioridad sobre el global.

## Proveedores admitidos

OneUptime actualmente admite los siguientes proveedores LLM:

| Proveedor             | Descripción                                                                    | Clave de API requerida | URL base requerida         |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------- | -------------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo y otros modelos de OpenAI                         | Sí                     | No (usa la predeterminada) |
| **Azure OpenAI**      | Modelos de OpenAI alojados en tu implementación de Azure                       | Sí                     | Sí                         |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku y otros modelos Claude          | Sí                     | No (usa la predeterminada) |
| **Groq**              | Inferencia rápida para Llama, Mixtral y otros modelos abiertos                 | Sí                     | No (usa la predeterminada) |
| **Mistral**           | Modelos alojados de Mistral                                                    | Sí                     | No (usa la predeterminada) |
| **Ollama**            | Modelos de código abierto auto-alojados como Llama 2, Mistral, CodeLlama, etc. | No                     | Sí                         |
| **OpenAI Compatible** | Cualquier servidor compatible con OpenAI (vLLM, LocalAI, LM Studio, etc.)      | No (opcional)          | Sí                         |

## Configuración de un proveedor LLM

### Paso 1: Navegar a la configuración de proveedores LLM

1. Inicia sesión en tu panel de OneUptime
2. Ve a **Agentes de IA** > **Proveedores LLM**
3. Haz clic en **Crear proveedor LLM** para agregar un nuevo proveedor

### Paso 2: Configurar tu proveedor

Completa los siguientes campos:

- **Nombre**: Un nombre descriptivo para esta configuración LLM (por ejemplo, "OpenAI de producción", "Ollama local")
- **Descripción** (opcional): Una descripción para identificar el propósito de este proveedor
- **Tipo de LLM**: Selecciona el tipo de proveedor (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama u OpenAI Compatible)
- **Clave de API**: Tu clave de API (requerida para OpenAI, Azure OpenAI, Anthropic, Groq y Mistral; opcional para Ollama y para servidores compatibles con OpenAI)
- **Nombre del modelo**: El modelo específico a usar (por ejemplo, `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL base** (opcional): URL de punto de conexión de API personalizado (requerida para Azure OpenAI, Ollama y OpenAI Compatible; opcional para otros)

## Configuración específica del proveedor

### OpenAI

1. Obtén tu clave de API de [OpenAI Platform](https://platform.openai.com/api-keys)
2. Selecciona **OpenAI** como tipo de LLM
3. Ingresa tu clave de API
4. Elige un nombre de modelo:
   - `gpt-4o` - Modelo más capaz, mejor para tareas complejas
   - `gpt-4o-mini` - Más rápido y económico
   - `gpt-4-turbo` - Buen equilibrio entre capacidad y velocidad
   - `gpt-3.5-turbo` - Rápido y económico

**Ejemplo de configuración:**

```
Nombre: OpenAI de producción
Tipo de LLM: OpenAI
Clave de API: sk-xxxxxxxxxxxxxxxxxxxx
Nombre del modelo: gpt-4o
```

### Anthropic

1. Obtén tu clave de API de [Anthropic Console](https://console.anthropic.com/)
2. Selecciona **Anthropic** como tipo de LLM
3. Ingresa tu clave de API
4. Elige un nombre de modelo:
   - `claude-3-opus-20240229` - Modelo más capaz
   - `claude-3-sonnet-20240229` - Buen equilibrio entre inteligencia y velocidad
   - `claude-3-haiku-20240307` - El más rápido y compacto
   - `claude-3-5-sonnet-20241022` - Último modelo Sonnet

**Ejemplo de configuración:**

```
Nombre: Anthropic de producción
Tipo de LLM: Anthropic
Clave de API: sk-ant-xxxxxxxxxxxxxxxxxxxx
Nombre del modelo: claude-3-5-sonnet-20241022
```

### Ollama (Auto-alojado)

Ollama te permite ejecutar LLMs de código abierto localmente o en tu propia infraestructura.

1. Instala Ollama desde [ollama.ai](https://ollama.ai)
2. Descarga el modelo que desees: `ollama pull llama3.1`
3. Asegúrate de que Ollama esté ejecutándose y sea accesible desde el servidor de OneUptime. Una instalación nativa solo escucha en `127.0.0.1`, así que iníciala con `OLLAMA_HOST=0.0.0.0:11434` para que acepte conexiones de otras máquinas y contenedores (la imagen oficial de Docker `ollama/ollama` ya lo hace)
4. Selecciona **Ollama** como tipo de LLM
5. Ingresa la URL base: la dirección del servidor Ollama tal como la alcanza el servidor de OneUptime, por ejemplo `http://ollama:11434` (OneUptime añade `/api/chat` por sí mismo). `localhost` no funciona; consulta [Cómo elegir la URL base de un modelo autoalojado](#cómo-elegir-la-url-base-de-un-modelo-autoalojado)
6. Ingresa el nombre del modelo que descargaste

**Ejemplo de configuración (Ollama como un servicio llamado `ollama` en la red de Docker Compose de OneUptime):**

```
Nombre: Ollama autoalojado
Tipo de LLM: Ollama
URL base: http://ollama:11434
Nombre del modelo: llama3.1
```

**Amplía la ventana de contexto.** Si no se indica otra cosa, Ollama ejecuta un modelo con una ventana de contexto pequeña (4096 tokens en las versiones actuales, 2048 en las anteriores) y recorta en silencio todo lo que no cabe. Las funciones de IA de OneUptime envían sus definiciones de herramientas en cada solicitud, y solo esas pueden ocupar varios miles de tokens. Cuando se recortan, no aparece ningún error: el modelo simplemente responde que no tiene ninguna herramienta para la pregunta. Establece un `num_ctx` mayor en el campo **Parámetros adicionales** del proveedor:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime combina este objeto `options` con las opciones que envía a Ollama, así que indica solo los ajustes que quieras cambiar. Una ventana de contexto mayor necesita más memoria, así que elige un tamaño que tu modelo admita y que tu hardware pueda manejar. Para subir en su lugar el valor predeterminado para todos los clientes, define `OLLAMA_CONTEXT_LENGTH` en el servidor de Ollama. Para un proveedor global registrado a partir de las variables `GLOBAL_LLM_PROVIDER_*`, configura ese campo en el panel de administración, en **Ajustes** > **Proveedores LLM globales**; la sincronización al arrancar no lo modifica.

**Modelos populares de Ollama:**

- `llama3.1` - Modelo Llama 3.1 de Meta, el Llama más antiguo con soporte para llamadas a herramientas
- `llama3.3` - Modelo Llama 3.3 de Meta
- `qwen2.5` - Modelo Qwen 2.5 de Alibaba
- `mistral-nemo` - Modelo Nemo de Mistral AI

> Nota: las funciones de IA de OneUptime son agénticas: dependen en gran medida de las llamadas a herramientas. Usa `llama3.1` o posterior (u otro modelo compatible con llamadas a herramientas). Los modelos pequeños o sin soporte para llamadas a herramientas (por ejemplo, `llama2` o el `llama3` original) dan malos resultados: no pueden consultar tus monitores, incidentes ni telemetría, por lo que las investigaciones vuelven vacías o con información inventada.

### Cómo elegir la URL base de un modelo autoalojado

La URL base de un modelo autoalojado (Ollama, vLLM, LM Studio o cualquier otro servidor compatible con OpenAI) debe ser una dirección a la que pueda llegar el **servidor de OneUptime**. Tu navegador nunca se conecta a ella.

**Las direcciones de loopback se rechazan siempre.** Antes de conectarse, OneUptime comprueba cada dirección a la que se resuelve el nombre de host de la URL base. `localhost`, `127.0.0.1`, `[::1]` y `0.0.0.0`, así como las direcciones link-local y de metadatos de nube como `169.254.169.254`, se rechazan en todos los despliegues, incluidos los autoalojados. Es intencionado: la URL base de un proveedor no debe servir para llegar a servicios del propio servidor de OneUptime. Además, dentro de Docker Compose o Kubernetes, `localhost` sería el contenedor de OneUptime, no la máquina que ejecuta tu modelo.

En su lugar, usa una dirección privada o un nombre de host interno:

| Dónde se ejecuta el servidor del modelo | URL base |
| --- | --- |
| Un servicio en la red de Docker Compose de OneUptime (`oneuptime`) | El nombre del servicio, por ejemplo `http://ollama:11434` |
| El mismo clúster de Kubernetes que OneUptime | El nombre DNS del Service, por ejemplo `http://ollama.<namespace>.svc.cluster.local:11434`, el mismo patrón que el [vLLM incluido](#vllm-auto-alojado-en-kubernetes-helm) |
| La propia máquina host, fuera de cualquier contenedor | La IP de LAN del host, por ejemplo `http://192.168.1.20:11434`, o `http://host.docker.internal:11434` en Docker Desktop |
| Otra máquina de tu red | Su IP privada o su nombre de host interno, por ejemplo `http://10.0.0.12:11434` |

Los servidores compatibles con OpenAI siguen las mismas reglas con su propio puerto y la ruta `/v1`, por ejemplo `http://vllm:8000/v1`, o `http://192.168.1.20:1234/v1` para LM Studio. Igual que una instalación nativa de Ollama, LM Studio solo escucha en `127.0.0.1` hasta que activas **Serve on Local Network** en la configuración de su servidor.

**Las direcciones privadas funcionan en instalaciones autoalojadas.** Un OneUptime autoalojado puede llegar a direcciones de red privada, como `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` e IPv6 `fc00::/7`, salvo que establezcas `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, que las rechaza igual que OneUptime Cloud.

**OneUptime Cloud (SaaS) no puede llegar a redes privadas.** Rechaza las direcciones de red privada, y los nombres de host que se resuelven a ellas, para todos los proveedores de LLM. Para usar un modelo que se ejecuta en tu propia infraestructura, autoaloja OneUptime en una red que pueda llegar a él o expón el modelo en un endpoint de acceso público. Protege un endpoint público con una clave de API: el proveedor **Ollama** no envía credenciales, mientras que **OpenAI Compatible** envía la Clave de API como token bearer (Ollama también ofrece una API compatible con OpenAI en `/v1`, así que puede quedar detrás de un proxy inverso que compruebe la clave).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Usa el proveedor **OpenAI Compatible** para cualquier servidor que implemente la API `/chat/completions` de OpenAI pero que no sea OpenAI en sí, por ejemplo [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) o text-generation-webui. Estos servidores normalmente se auto-alojan en tu propia URL y a menudo funcionan sin autenticación.

1. Inicia tu servidor compatible con OpenAI y anota su URL base (normalmente termina en `/v1`)
2. Selecciona **OpenAI Compatible** como tipo de LLM
3. Ingresa la **URL base** (requerida), por ejemplo `http://your-server:8000/v1`. Debe ser accesible desde el servidor de OneUptime, así que no puede ser `localhost`; consulta [Cómo elegir la URL base de un modelo autoalojado](#cómo-elegir-la-url-base-de-un-modelo-autoalojado)
4. Ingresa el **Nombre del modelo** (requerido); debe coincidir con un modelo que exponga tu servidor
5. Ingresa la **Clave de API** solo si tu servidor la requiere; déjala en blanco para servidores sin autenticación

**Ejemplo de configuración (vLLM sin clave):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Consejo: Después de guardar, usa el botón **Probar** en el proveedor para confirmar que la conexión, el nombre del modelo y la URL base son correctos.

### vLLM auto-alojado en Kubernetes (Helm)

Si auto-alojas OneUptime con el chart de Helm, puedes ejecutar [vLLM](https://docs.vllm.ai) (un servidor de inferencia compatible con OpenAI) dentro de tu clúster y servir modelos locales en tus propias GPUs. Ningún dato sale de tu infraestructura.

1. Actívalo en tus valores de Helm (requiere nodos con GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Ejecuta `helm upgrade` y espera a que el pod de vLLM esté Ready (el primer inicio descarga el modelo)
3. Eso es todo: vLLM se registra automáticamente como Proveedor LLM global al iniciar (`vllm.globalProvider.enabled`, `true` por defecto), por lo que las funciones de IA funcionan para todos los proyectos. Nota: los Agentes de IA a nivel de proyecto no pueden usar proveedores globales y todavía necesitan un Proveedor LLM específico del proyecto.

Si desactivaste el registro automático (`vllm.globalProvider.enabled: false`), crea el proveedor manualmente:

1. Selecciona **OpenAI Compatible** como tipo de LLM (vLLM habla la API de OpenAI)
2. Ingresa la URL base dentro del clúster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (sustituye `cluster.local` si cambiaste `global.clusterDomain`)
3. Ingresa el Nombre del modelo: el id completo del modelo de HuggingFace (o `vllm.servedModelName` si configuraste uno)
4. Ingresa la Clave de API solo si configuraste `vllm.apiKey`; déjala en blanco para un vLLM sin autenticación

**Ejemplo de configuración:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Consulta la [guía de vLLM del chart de Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) para conocer las opciones de programación de GPU, modelos restringidos y ajustes.

## Uso de URLs base personalizadas

Para implementaciones empresariales o cuando se usan servicios de proxy, puedes especificar una URL base personalizada:

- **Azure OpenAI**: Usa tu URL de punto de conexión de Azure
- **APIs compatibles con OpenAI**: Cualquier API que siga la especificación de API de OpenAI
- **Instancias privadas de Ollama**: La URL de tu servidor Ollama interno

## Buenas prácticas

1. **Usa nombres descriptivos**: Nombra tus proveedores claramente (por ejemplo, "GPT-4 de producción", "Ollama de desarrollo")
2. **Protege tus claves de API**: Las claves de API están cifradas en reposo, pero evita compartirlas
3. **Prueba tu configuración**: Después de configurar, verifica que el proveedor funcione con las funciones de IA
4. **Monitorea el uso**: Realiza un seguimiento del uso de la API para gestionar los costos

## Solución de problemas

### Problemas de conexión

- **OpenAI/Anthropic**: Verifica que tu clave de API sea válida y tenga créditos suficientes
- **Ollama**: Asegúrate de que el servidor Ollama esté en ejecución, escuche en una dirección a la que pueda llegar el servidor de OneUptime (`OLLAMA_HOST=0.0.0.0:11434` en una instalación nativa) y de que la URL base apunte a esa dirección
- **OpenAI Compatible**: Asegúrate de que la URL base termine en `/v1` (o coincida con tu servidor), que el Nombre del modelo coincida con un modelo que expone tu servidor, y establece una Clave de API solo si tu servidor la requiere
- **"…points to an address OneUptime is not allowed to connect to"**: la URL base se resuelve a una dirección rechazada: `localhost` u otra dirección de loopback o, en OneUptime Cloud, una dirección de red privada. (OneUptime Cloud informa de un nombre de host rechazado como "…could not be reached".) Consulta [Cómo elegir la URL base de un modelo autoalojado](#cómo-elegir-la-url-base-de-un-modelo-autoalojado)
- **Firewall**: Verifica que tu red permita conexiones salientes a la API del proveedor

### Modelo no encontrado

- Verifica que el nombre del modelo esté escrito correctamente
- Para Ollama, asegúrate de haber descargado el modelo con `ollama pull <model-name>`
- Verifica si el modelo está disponible en tu región (algunos modelos tienen restricciones regionales)

## ¿Necesitas ayuda?

Si encuentras problemas al configurar tu proveedor LLM, por favor:

1. Consulta los [problemas de GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) para ver problemas conocidos
2. Contacta con soporte si estás en un plan empresarial
