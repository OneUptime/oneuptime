# Proveedores de LLM

Un proveedor de LLM es el modelo detrás de cada función de IA en OneUptime: investigaciones, Preguntar a la IA, borradores y pull requests de corrección. Esta página muestra qué proveedor usa una función, cómo añadir el tuyo (OpenAI, Azure OpenAI y Microsoft Foundry, Anthropic, Groq, Mistral, Ollama o cualquier servidor compatible con OpenAI) y cómo apuntar OneUptime a un modelo que ejecutas tú mismo.

:::cards
- [Qué proveedor usa la IA](#qué-proveedor-usa-la-ia): El proveedor predeterminado del proyecto, o si no, el global.
- [Autoalojado: sin configuración mediante variables de entorno](#autoalojado-sin-configuración-mediante-variables-de-entorno): Un proveedor para cada proyecto, desde los ajustes del servidor.
- [Configurar un proveedor de LLM](#configurar-un-proveedor-de-llm): Añade un proveedor a un proyecto y pruébalo.
- [Elegir una URL base para un modelo autoalojado](#elegir-una-url-base-para-un-modelo-autoalojado): Una dirección a la que llegue el servidor de OneUptime.
:::

## Qué impulsa un proveedor

- **Investigaciones**: OneUptime AI investiga los incidentes y las alertas nuevos y publica en la línea de tiempo un análisis de causa raíz con citas. Consulta [AI SRE](/docs/ai/ai-sre).
- **Preguntas**: **Preguntar a la IA** responde a partir de los datos de tu proyecto, con una cita en cada afirmación. Consulta [Preguntar a la IA](/docs/ai/ask-ai).
- **Borradores**: **Redactar con IA** en las notas de incidentes, alertas y mantenimientos programados, y los postmortems, redactados a petición o cuando un incidente se resuelve.
- **Código**: pull requests que corrigen excepciones, trazas lentas y las causas que encuentran las investigaciones, desde OneUptime o desde GitHub. Consulta [Código](/docs/ai/ai-agent).
- **Todo lo demás**: la clasificación de AI Insights, los pasos de IA de los flujos de trabajo y los runbooks, y las respuestas en Slack y Microsoft Teams.

## Qué proveedor usa la IA

Las funciones de IA usan el proveedor predeterminado del proyecto. Un proyecto sin proveedor predeterminado usa el proveedor global, cuando lo hay. Preguntar a la IA también puede cambiar una conversación a otro de los proveedores del proyecto, o a uno global.

```mermaid title="Qué proveedor usa una función de IA"
flowchart TB
    F["Una función de IA<br/>necesita un modelo"] --> D{"¿Tiene el proyecto<br/>un proveedor<br/>predeterminado?"}
    D -->|"sí"| P["El proveedor<br/>predeterminado<br/>del proyecto"]
    D -->|"no"| G{"¿Hay un proveedor<br/>global?"}
    G -->|"sí"| GP["El proveedor global:<br/>créditos de IA en<br/>OneUptime Cloud"]
    G -->|"no"| N["No se ejecuta nada,<br/>y las páginas de IA<br/>dicen que falta<br/>un proveedor"]
```

Un proveedor es el predeterminado de un proyecto cuando **Establecer como predeterminado** está activado, como ocurre en cada proveedor nuevo. Un proyecto cuyos proveedores tienen todos desactivado el predeterminado recurre al proveedor global, como si no tuviera ninguno.

Cada regla de OneUptime AI —reglas de IA y reglas de post mortem— puede elegir en su lugar un proveedor propio, en **Más campos**: uno de los proveedores del proyecto o uno global, que se usa para todo lo que inicia la regla. Una regla que no elige ninguno usa el proveedor predeterminado, y un proveedor elegido que ya no se puede usar vuelve a él. Consulta [Qué proveedor de LLM usa una regla](/docs/ai/ai-sre#qué-proveedor-de-llm-usa-una-regla).

## OneUptime Cloud

En **OneUptime Cloud**, cada proyecto puede usar el proveedor global sin configurar nada. Está listo para cada función de IA y se paga con los créditos de IA del proyecto.

Para usar en su lugar tus propias claves de API o un modelo concreto, añade un proveedor propio, como se explica abajo: no se te cobra por la IA que se ejecuta en tu propio proveedor.

El proveedor de LLM global se paga con los créditos de IA del proyecto. Para limitar lo que la IA puede gastar cada día, define un **Límite diario de gasto de IA (USD)** en **Ajustes del proyecto → IA → Funciones de IA → Más ajustes**; un **Límite diario de tokens de IA** ahí limita los tokens en cualquier proveedor, también el tuyo. Consulta [los límites diarios propios del proyecto](/docs/ai/ai-sre#los-límites-diarios-propios-del-proyecto).

OneUptime Cloud solo puede llegar a endpoints de LLM en la internet pública. No puede conectarse a un modelo en tu red privada, como un servidor Ollama o vLLM autoalojado. Para usar un modelo que ejecutas tú mismo, aloja OneUptime en una red que pueda llegar a él, o expón el modelo en un endpoint público: consulta [Elegir una URL base para un modelo autoalojado](#elegir-una-url-base-para-un-modelo-autoalojado).

## Autoalojado: sin configuración mediante variables de entorno

En una instancia autoalojada, la forma más rápida de activar la IA para **todos los proyectos a la vez** es definir las variables de entorno `GLOBAL_LLM_PROVIDER_*` en tu servidor de OneUptime: en `config.env` para Docker Compose, o mediante los valores de Helm. Al arrancar, OneUptime registra con ellas un proveedor de LLM global y lo mantiene al día; ningún proyecto tiene que configurar nada, y las tareas de corrección de IA también lo usan cuando un proyecto no tiene proveedor propio.

| Variable | Descripción |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Necesaria para activarlo. Una de `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | La clave de API: necesaria para OpenAI, Azure OpenAI, Anthropic, Groq y Mistral; no hace falta para Ollama ni para un servidor compatible con OpenAI sin clave |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | El endpoint: necesario para Azure OpenAI, Ollama y los servidores compatibles con OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | El modelo que se usa. Opcional: si no se define, OneUptime usa el modelo predeterminado del proveedor y, en un servidor compatible con OpenAI, el primer modelo que lista el servidor |
| `GLOBAL_LLM_PROVIDER_NAME` | Un nombre descriptivo opcional, que se muestra en el panel |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

La sincronización es declarativa: cambia una variable y el proveedor la sigue en el siguiente reinicio; quita `GLOBAL_LLM_PROVIDER_TYPE` y el proveedor se elimina. Los proveedores globales creados a mano en el Admin Dashboard nunca se tocan. Un proyecto puede seguir añadiendo un proveedor propio en **Ajustes del proyecto → IA → Proveedores de LLM**, y un proveedor que pertenece al proyecto siempre tiene prioridad.

## Proveedores compatibles

| Proveedor | Para qué sirve | Clave de API necesaria | URL base necesaria |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 y los demás modelos de OpenAI | Sí | No (usa la predeterminada) |
| **Azure OpenAI / Microsoft Foundry** | Modelos que despliegas en Microsoft Foundry o Azure OpenAI: modelos de OpenAI, Foundry Models y Claude | Sí | Sí |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 y los demás modelos Claude | Sí | No (usa la predeterminada) |
| **Groq** | Inferencia rápida para Llama, Mixtral y otros modelos abiertos | Sí | No (usa la predeterminada) |
| **Mistral** | Los modelos alojados de Mistral | Sí | No (usa la predeterminada) |
| **Ollama** | Modelos de código abierto que ejecutas tú mismo, como Llama 3.1, Mistral o Qwen | No | Sí |
| **OpenAI Compatible** | Cualquier servidor compatible con OpenAI: vLLM, LocalAI, LM Studio y otros | No (opcional) | Sí |

## Configurar un proveedor de LLM

:::steps
### Abre Proveedores de LLM

Ve a **Ajustes del proyecto → IA → Proveedores de LLM** (la sección **IA** del menú lateral empieza plegada) y haz clic en **Crear Proveedor de LLM**.

### Elige el proveedor

En **Proveedor**, elige tu **Proveedor de LLM**: una tarjeta para OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama y cualquier servidor compatible con OpenAI, cada una con una línea que dice qué es.

### Conéctalo

En **Conexión**, el formulario solo pide lo que usa ese proveedor, con su propia ayuda bajo cada campo:

- **Clave de API**: tu clave de API, necesaria para OpenAI, Azure OpenAI, Anthropic, Groq y Mistral y opcional para un servidor compatible con OpenAI; para Ollama no se pide ninguna
- **URL base**: el endpoint, necesario para Azure OpenAI, Ollama y OpenAI Compatible; para los demás, solo para pasar por un proxy o una pasarela
- **Nombre del modelo**: el modelo que se usa, como `gpt-5.1`, `claude-sonnet-5-5` o `llama3.1`. Si lo dejas vacío, OneUptime usa el modelo predeterminado del proveedor; un servidor compatible con OpenAI no tiene ninguno, así que OneUptime le pregunta qué modelos sirve y usa el primero que lista
- **Nombre**: el nombre del proveedor hasta que escribas el tuyo, como "Production OpenAI" o "Local Ollama"
- **Más campos**, plegado bajo los campos anteriores: una **Descripción**, **Establecer como predeterminado**, que está activado en un proveedor nuevo porque las funciones de IA solo usan el proveedor predeterminado del proyecto, y **Parámetros adicionales**, un objeto JSON opcional con parámetros extra que se envían al proveedor en cada petición (por ejemplo `{"temperature": 0.2}`)

**Quién puede ver un proveedor.** Los proveedores de LLM de un proyecto solo los leen sus miembros que pueden leer los ajustes del proyecto: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Visor**, **Administrador de ajustes**, **Miembro de ajustes**, **Visor de ajustes** y **Read LLM**. La **Clave de API** y los **Parámetros adicionales** de un proveedor solo los leen los propietarios y administradores del proyecto, porque los parámetros se envían al proveedor en cada petición y pueden llevar un token o una cabecera igual que la clave. Los demás miembros ven si hay parámetros guardados, no cuáles son. Los miembros que pueden editar un proveedor pueden sustituir su clave de API o sus parámetros sin leerlos: en el formulario de edición esos campos empiezan vacíos, y dejar uno en blanco conserva lo guardado. Para quitar los parámetros, guarda `{}`. Solo los propietarios y administradores del proyecto pueden cambiar la **URL base** de un proveedor, porque su clave de API y sus parámetros adicionales se envían a esa dirección; los demás miembros que pueden editar un proveedor pueden cambiar todo lo demás. Todo el que puede leer un proveedor puede leer su **URL base**, así que nunca pongas en ella una clave, un token o una contraseña: usa la **Clave de API**. La lista **Proveedores LLM globales** de la misma página, los proveedores compartidos a los que recurre un proyecto, muestra su nombre, su descripción y su precio a cualquiera que haya iniciado sesión, y nada más sobre ellos.

### Pruébalo

**Probar un proveedor.** **Probar**, en la página del proveedor o en el menú de su fila, envía al proveedor un prompt corto con su **Clave de API**, **Nombre del modelo**, **URL base** y **Parámetros adicionales**, y dice si respondió y llamó a una herramienta, algo que necesitan las funciones de IA de OneUptime. Una prueba fallida dice primero qué comprobar y luego qué respondió el proveedor. Quien puede cambiar un proveedor puede probarlo: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de ajustes**, **Miembro de ajustes** y **Edit LLM**. Todos los demás que pueden ver el proveedor encuentran **Probar** bloqueado. Un proveedor de LLM global lo prueba un administrador del servidor, en el Admin Dashboard, en **Ajustes → Proveedores LLM globales**.
:::

## Configuración por proveedor

### OpenAI

1. Obtén tu clave de API en [OpenAI Platform](https://platform.openai.com/api-keys)
2. Selecciona **OpenAI** como proveedor de LLM
3. Introduce tu clave de API
4. Elige un nombre de modelo:
   - `gpt-5.1` - Predeterminado recomendado, fuerte en llamadas a herramientas e investigaciones complejas
   - `gpt-5.1-mini` - Más rápido y más económico

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Obtén tu clave de API en [Anthropic Console](https://console.anthropic.com/)
2. Selecciona **Anthropic** como proveedor de LLM
3. Introduce tu clave de API
4. Elige un nombre de modelo:
   - `claude-sonnet-5-5` - Predeterminado recomendado, el mejor equilibrio entre inteligencia, velocidad y coste
   - `claude-opus-5-5` - Más capaz, para las investigaciones más difíciles
   - `claude-haiku-5-5` - El más rápido y económico

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 y todos los modelos Claude posteriores eligen su propio muestreo y rechazan una petición que define `temperature`, `top_p` o `top_k`. OneUptime omite esos ajustes para estos modelos. Si aun así un modelo rechaza uno, OneUptime vuelve a enviar la petición sin él y lo recuerda para ese proveedor.

Los modelos Claude 5 piensan antes de responder, y el razonamiento cuenta para el límite de tokens de la respuesta, así que OneUptime le deja espacio. Para que piensen menos y respondan más rápido y por menos, define `{"output_config": {"effort": "low"}}` en los **Parámetros adicionales** del proveedor. OneUptime envía a Anthropic los ajustes que añades ahí en cada petición, excepto `model`, `messages`, `system`, `tools`, `tool_choice` y `stream`, que define él mismo.

OneUptime usa el almacenamiento en caché de prompts de Anthropic. Cada llamada de una investigación o de una respuesta de Preguntar a la IA vuelve a enviar el prompt del sistema, las herramientas y la conversación hasta el momento, y OneUptime los marca para la caché: una llamada paga una décima parte del precio o menos por lo que enviaron las llamadas anteriores, y un cuarto más del precio por lo nuevo, que escribe en la caché. Si una pasarela delante de Claude rechaza las marcas de caché, OneUptime vuelve a enviar la solicitud sin ellas y lo recuerda para el proveedor. [Cómo se cuentan los tokens](/docs/ai/ai-sre#cómo-se-cuentan-los-tokens) explica cómo cuentan los tokens en caché para tus límites.

### Azure OpenAI y Microsoft Foundry

Usa **Azure OpenAI / Microsoft Foundry** para los modelos que despliegas en Microsoft Foundry o Azure OpenAI: modelos de OpenAI, otros Foundry Models y Claude. Introduce una de las claves del recurso como **Clave de API**, el nombre del despliegue como **Nombre del modelo** y el endpoint del recurso como **URL base**, por ejemplo `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry y Azure OpenAI](/docs/ai/microsoft-foundry) recorre la parte de Azure: el recurso, los permisos, el despliegue del modelo, los requisitos de red y la solución de problemas.

### Ollama (autoalojado)

Ollama ejecuta modelos de código abierto en tus propias máquinas.

1. Instala Ollama desde [ollama.ai](https://ollama.ai)
2. Descarga un modelo: `ollama pull llama3.1`
3. Asegúrate de que Ollama se ejecuta y de que el servidor de OneUptime llega a él. Una instalación nativa escucha solo en `127.0.0.1`, así que arráncala con `OLLAMA_HOST=0.0.0.0:11434` para aceptar conexiones de otras máquinas y contenedores (la imagen oficial de Docker `ollama/ollama` ya lo hace)
4. Selecciona **Ollama** como proveedor de LLM
5. Introduce la URL base: la dirección del servidor de Ollama tal como la alcanza el servidor de OneUptime, como `http://ollama:11434` (OneUptime añade `/api/chat` por su cuenta). `localhost` no funciona: consulta [Elegir una URL base para un modelo autoalojado](#elegir-una-url-base-para-un-modelo-autoalojado)
6. Introduce el nombre del modelo que descargaste

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Amplía la ventana de contexto.** Salvo que se indique otra cosa, Ollama dimensiona la ventana de contexto de un modelo según la memoria de GPU que encuentra: 4k tokens por debajo de 24 GiB, 32k hasta 48 GiB y 256k por encima (las versiones antiguas usan 2.048 o 4.096 tokens). Las funciones de IA de OneUptime son agentes. Cada petición lleva su prompt de sistema y sus definiciones de herramientas, más de 10.000 tokens antes de cualquier pregunta, y una investigación de IA añade cada resultado de consulta a la conversación sobre la marcha. Cuando una petición ya no cabe, Ollama descarta los mensajes más antiguos, y la pregunta se va con ellos. Según el modelo y la versión de Ollama, el modelo responde entonces sin la pregunta o sin sus herramientas, o la petición falla con "no user query found in messages" (Qwen 3.8 y posteriores) o "the prompt is longer than the context length currently available to the model". OneUptime informa de esos fallos como "…the request is larger than the model's context window" y no vuelve a ejecutar la investigación. Define un `num_ctx` mayor en los **Parámetros adicionales** del proveedor:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime fusiona este objeto `options` con las opciones que envía a Ollama, así que incluye solo los ajustes que quieras cambiar. 65.536 tokens es lo que Ollama recomienda para agentes, y cubre la mayoría de las investigaciones. Una investigación larga puede usar más, porque OneUptime solo empieza a acortar resultados de consultas antiguos cuando la conversación supera unos 75.000 tokens: usa 131.072 si el modelo lo admite y tu GPU puede con ello. Una ventana de contexto mayor necesita más memoria, y `ollama ps` muestra el contexto que recibió cada modelo cargado. Para subir en cambio el valor predeterminado para todos los clientes, define `OLLAMA_CONTEXT_LENGTH` en el servidor de Ollama. Es la única forma cuando OneUptime llega a Ollama a través de su API `/v1` compatible con OpenAI (el proveedor **OpenAI Compatible**), que ignora `num_ctx`. Para un proveedor global registrado a partir de las variables `GLOBAL_LLM_PROVIDER_*`, define los **Parámetros adicionales** en el Admin Dashboard, en **Ajustes → Proveedores LLM globales**; la sincronización al arrancar no toca ese campo.

**Modelos populares de Ollama:**

- `llama3.1` - El modelo Llama 3.1 de Meta, el Llama más antiguo con soporte de llamadas a herramientas
- `llama3.3` - El modelo Llama 3.3 de Meta
- `qwen2.5` - El modelo Qwen 2.5 de Alibaba
- `mistral-nemo` - El modelo Nemo de Mistral AI

> [!NOTE]
> Las funciones de IA de OneUptime son agentes: dependen mucho de las llamadas a herramientas. Usa `llama3.1` o posterior, u otro modelo que llame a herramientas. Un modelo pequeño, o uno sin llamadas a herramientas (como `llama2` o el `llama3` original), responde mal: no puede consultar tus monitores, incidentes ni telemetría, así que las investigaciones vuelven vacías o inventadas.

### Elegir una URL base para un modelo autoalojado

La URL base de un modelo autoalojado, ya sea Ollama, vLLM, LM Studio o cualquier otro servidor compatible con OpenAI, tiene que ser una dirección a la que llegue el **servidor de OneUptime**. Tu navegador nunca se conecta a ella.

**Las direcciones de loopback siempre se rechazan.** Antes de conectarse, OneUptime comprueba cada dirección a la que resuelve el nombre de host de la URL base. `localhost`, `127.0.0.1`, `[::1]` y `0.0.0.0`, así como las direcciones link-local y de metadatos de la nube como `169.254.169.254`, se rechazan en todos los despliegues, incluidos los autoalojados. Es deliberado: la URL base de un proveedor no debe servir para llegar a servicios del propio servidor de OneUptime. Dentro de Docker Compose o Kubernetes, `localhost` sería de todos modos el contenedor de OneUptime, no la máquina que ejecuta tu modelo.

Usa en su lugar una dirección privada o un nombre de host interno:

| Dónde se ejecuta el servidor del modelo | URL base |
| --- | --- |
| Un servicio en la red de Docker Compose de OneUptime (`oneuptime`) | El nombre del servicio, p. ej. `http://ollama:11434` |
| El mismo clúster de Kubernetes que OneUptime | El nombre DNS del Service, p. ej. `http://ollama.<namespace>.svc.cluster.local:11434`, el mismo patrón que el [vLLM incluido](#vllm-autoalojado-en-kubernetes-helm) |
| La propia máquina anfitriona, fuera de cualquier contenedor | La IP de LAN del anfitrión, p. ej. `http://192.168.1.20:11434`, o `http://host.docker.internal:11434` en Docker Desktop |
| Otra máquina de tu red | Su IP privada o su nombre de host interno, p. ej. `http://10.0.0.12:11434` |

Los servidores compatibles con OpenAI siguen las mismas reglas con su propio puerto y su ruta `/v1`, p. ej. `http://vllm:8000/v1`, o `http://192.168.1.20:1234/v1` para LM Studio. Como una instalación nativa de Ollama, LM Studio escucha solo en `127.0.0.1` hasta que activas **Serve on Local Network** en sus ajustes de servidor.

**Las direcciones privadas funcionan en las instalaciones autoalojadas.** Un OneUptime autoalojado puede llegar a direcciones de red privadas, como `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` e IPv6 `fc00::/7`, salvo que definas `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, que las rechaza como hace OneUptime Cloud. Ese ajuste no se aplica a un proveedor de LLM global, que configura un administrador (con las variables `GLOBAL_LLM_PROVIDER_*` o en el Admin Dashboard) y no un proyecto: sigue pudiendo llegar a direcciones privadas. Las direcciones de loopback y link-local siguen rechazadas para todos los proveedores.

**OneUptime Cloud (SaaS) no puede llegar a redes privadas.** Rechaza las direcciones de red privadas, y los nombres de host que resuelven a ellas, para todos los proveedores de LLM. Para usar un modelo que se ejecuta en tu propia infraestructura, aloja OneUptime en una red que pueda llegar a él, o expón el modelo en un endpoint accesible públicamente. Protege un endpoint público con una clave de API: el proveedor **Ollama** no envía credenciales, mientras que **OpenAI Compatible** envía la clave de API como token bearer (Ollama también sirve una API compatible con OpenAI en `/v1`, así que puede ir detrás de un proxy inverso que compruebe la clave).

### OpenAI Compatible (vLLM, LocalAI, LM Studio y otros)

Usa el proveedor **OpenAI Compatible** para cualquier servidor que implemente la API `/chat/completions` de OpenAI pero no sea OpenAI, por ejemplo [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) o text-generation-webui. Suelen ejecutarse en tu propia dirección, a menudo sin autenticación.

1. Arranca tu servidor compatible con OpenAI y anota su URL base (suele terminar en `/v1`)
2. Selecciona **OpenAI Compatible** como proveedor de LLM
3. Introduce la **URL base** (obligatoria), p. ej. `http://your-server:8000/v1`. El servidor de OneUptime tiene que llegar a ella, así que no `localhost`: consulta [Elegir una URL base para un modelo autoalojado](#elegir-una-url-base-para-un-modelo-autoalojado)
4. Introduce el **Nombre del modelo** o déjalo vacío: en ese caso OneUptime pregunta a tu servidor qué modelos sirve y usa el primero que lista, que en vLLM es el modelo que sirve. Un nombre que introduzcas tiene que coincidir con un modelo que sirva tu servidor
5. Introduce la **Clave de API** solo si tu servidor la pide; déjala en blanco para un servidor sin clave

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Después de guardar, usa **Probar** en el proveedor para comprobar la conexión, el nombre del modelo y la URL base.

### vLLM autoalojado en Kubernetes (Helm)

Si alojas OneUptime con el chart de Helm, puedes ejecutar [vLLM](https://docs.vllm.ai), un servidor de inferencia compatible con OpenAI, dentro de tu clúster y servir modelos locales en tus propias GPU. Ningún dato sale de tu infraestructura.

1. Actívalo en tus valores de Helm (necesita nodos con GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Ejecuta `helm upgrade` y espera a que el pod de vLLM esté Ready (el primer arranque descarga el modelo)
3. Listo: vLLM se registra automáticamente como proveedor de LLM global al arrancar (`vllm.globalProvider.enabled`, por defecto `true`), así que las funciones de IA funcionan para todos los proyectos, incluidas las tareas de corrección de IA. (En todas partes, en la nube y autoalojado, las tareas de corrección del agente usan el proveedor global cuando el proyecto no tiene proveedor propio; en la nube ese uso se factura como tokens de IA medidos. Un proveedor propio del proyecto siempre tiene prioridad.)

Si desactivaste el registro automático (`vllm.globalProvider.enabled: false`), crea el proveedor a mano:

1. Selecciona **OpenAI Compatible** como proveedor de LLM (vLLM habla la API de OpenAI)
2. Introduce la URL base dentro del clúster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (sustituye `cluster.local` si cambiaste `global.clusterDomain`)
3. Introduce el nombre del modelo: el id completo del modelo en Hugging Face (o `vllm.servedModelName` si definiste uno), o déjalo vacío para usar el modelo que sirve vLLM
4. Introduce la clave de API solo si definiste `vllm.apiKey`; déjala en blanco para un vLLM sin clave

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Con la facturación activada, o con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` en los valores de Helm), el proveedor propio de un proyecto no puede llegar a esta dirección dentro del clúster, que resuelve a una IP privada del clúster. Crea en su lugar el proveedor en el Admin Dashboard, en **Ajustes → Proveedores LLM globales**, con los mismos campos: un proveedor de LLM global sí puede llegar a esa dirección.

Consulta la [guía de vLLM del chart de Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) para la planificación de GPU, los modelos restringidos y las opciones de ajuste.

## Buenas prácticas

- **Pon nombres claros a los proveedores**, como "Production OpenAI" o "Development Ollama", para que tu equipo sepa cuál es cuál.
- **Guarda las claves en el campo Clave de API.** Las claves de API se cifran en reposo, y solo las leen los propietarios y administradores del proyecto.
- **Prueba después de cada cambio**, con **Probar** en el proveedor.
- **Vigila lo que cuesta la IA.** Cada llamada aparece con sus tokens y su coste en **Ajustes del proyecto → IA → Registros de IA**.

## Solución de problemas

:::details No se puede llegar al proveedor
- **OpenAI o Anthropic**: comprueba que tu clave de API es válida y tiene créditos
- **Azure OpenAI / Microsoft Foundry**: el error empieza por lo que hay que cambiar. [Microsoft Foundry y Azure OpenAI](/docs/ai/microsoft-foundry) explica cada error con el que responde Azure
- **Ollama**: comprueba que el servidor de Ollama se ejecuta, que escucha en una dirección a la que llega el servidor de OneUptime (`OLLAMA_HOST=0.0.0.0:11434` en una instalación nativa) y que la URL base apunta a esa dirección
- **OpenAI Compatible**: comprueba que la URL base termina en `/v1` (o coincide con tu servidor), que el nombre del modelo, si introdujiste uno, coincide con un modelo que sirve tu servidor y que solo definiste una clave de API si tu servidor la pide. Si el nombre del modelo está vacío y el servidor no lista ningún modelo en su endpoint `/models`, introduce uno
- **"…points to an address OneUptime is not allowed to connect to"**: la URL base resuelve a una dirección rechazada: `localhost` u otra dirección de loopback o, en OneUptime Cloud, una dirección de red privada. (OneUptime Cloud informa en cambio de un nombre de host rechazado como "…could not be reached".) Consulta [Elegir una URL base para un modelo autoalojado](#elegir-una-url-base-para-un-modelo-autoalojado)
- **Un cortafuegos**: comprueba que tu red permite conexiones salientes a la API del proveedor
:::

:::details No se encuentra el modelo
Comprueba cómo está escrito el nombre del modelo. En Ollama, descarga primero el modelo con `ollama pull <model-name>`. Algunos modelos solo están disponibles en algunas regiones.
:::

:::details La ventana de contexto es demasiado pequeña
- **"…the request is larger than the model's context window"**: la petición no cupo en la ventana de contexto del modelo, normalmente porque una investigación de IA ha reunido muchas pruebas. Sube `num_ctx` en los **Parámetros adicionales** del proveedor, o `OLLAMA_CONTEXT_LENGTH` en el servidor de Ollama; consulta [Ollama (autoalojado)](#ollama-autoalojado)
- **"no user query found in messages"**: el mismo problema, tal como lo informa Qwen. OneUptime siempre envía la pregunta; Ollama la descartó para que cupiera el resto de la petición
:::

¿Sigues atascado? Busca tu error en los [issues de GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues), o contacta con soporte si tu plan lo incluye.

## Próximos pasos

:::cards
- [Código](/docs/ai/ai-agent): Los pull requests que escribe tu proveedor, y dónde empiezan.
- [AI SRE](/docs/ai/ai-sre): Lo que hace OneUptime AI con el proveedor una vez que lo tiene.
- [Preguntar a la IA](/docs/ai/ask-ai): Hazle una pregunta a tu proyecto, y cambia el proveedor de una conversación.
:::
