# Agentes de IA

Los Agentes de IA en OneUptime corrigen automáticamente errores, problemas de rendimiento y consultas de bases de datos en tu código. Impulsados por datos de observabilidad de OpenTelemetry, los Agentes de IA crean solicitudes de extracción (pull requests) con correcciones, no solo alertas.

## ¿Qué pueden hacer los Agentes de IA?

Los Agentes de IA analizan tus datos de observabilidad (trazas, registros y métricas) para detectar y corregir automáticamente problemas en tu base de código:

- **Corrección automática de errores**: Cuando el Agente de IA detecta excepciones en tus trazas o registros, corrige el problema automáticamente y crea una solicitud de extracción.
- **Corrección de problemas de rendimiento**: Analiza las trazas que tardan más en ejecutarse y crea solicitudes de extracción con optimizaciones de rendimiento.
- **Corrección de consultas de bases de datos**: Identifica consultas de bases de datos lentas o ineficientes y las optimiza con índices adecuados y reescrituras de consultas.
- **Corrección de problemas de frontend**: Aborda problemas de rendimiento específicos del frontend, problemas de renderización y errores de JavaScript automáticamente.
- **Adición automática de telemetría**: Agrega trazas, métricas y registros a tu base de código con un solo clic. No se necesita instrumentación manual.
- **Integración con GitHub y GitLab**: Se integra perfectamente con tus repositorios existentes. Los PRs se crean directamente en tu flujo de trabajo.
- **Integración con CI/CD**: Se integra con tus pipelines de CI/CD existentes. Las correcciones se prueban y validan antes de crear el PR.
- **Soporte para Terraform**: Corrige problemas de infraestructura automáticamente. Compatible con Terraform y OpenTofu para infraestructura como código.
- **Integración con rastreadores de incidencias**: Se conecta con Jira, Linear y otros rastreadores de incidencias. Vincula automáticamente las correcciones a los problemas relevantes.

## Cómo funciona

1. **Recopilar datos**: OpenTelemetry recopila trazas, registros y métricas de tu aplicación
2. **Detectar problemas**: La IA identifica errores, cuellos de botella de rendimiento y consultas lentas
3. **Generar corrección**: La IA analiza tu base de código y crea la corrección automáticamente
4. **Crear PR**: Solicitud de extracción con la corrección y un informe detallado lista para revisión

## Flexibilidad de proveedor LLM

OneUptime funciona con cualquier proveedor LLM. Puedes usar:

- Modelos **OpenAI GPT**
- Modelos **Anthropic Claude**
- **Meta Llama** (a través de Ollama u otros proveedores)
- Modelos **personalizados auto-alojados**

Aloja tu modelo de IA por tu cuenta y mantén tu código completamente privado.

## Privacidad

Independientemente de tu plan, OneUptime nunca ve, almacena ni entrena con tu código:

- **Sin acceso al código**: Tu código permanece en tu infraestructura
- **Sin almacenamiento de datos**: Política de retención de datos cero
- **Sin entrenamiento**: Tu código nunca se utiliza para entrenar IA

## Agentes de IA globales vs. Agentes de IA auto-alojados

### Agentes de IA globales

Si utilizas **OneUptime SaaS** (versión alojada en la nube), los Agentes de IA globales son proporcionados por OneUptime y están preconfigurados y listos para usar. Estos agentes son gestionados por OneUptime y no requieren configuración adicional.

Los Agentes de IA globales están disponibles automáticamente para todos los proyectos a menos que estén deshabilitados en la configuración de tu proyecto.

### Agentes de IA auto-alojados

Para organizaciones que necesitan ejecutar agentes de IA dentro de su propia infraestructura (por ejemplo, por razones de seguridad, cumplimiento o requisitos de acceso a la red), OneUptime admite agentes de IA auto-alojados.

Los agentes de IA auto-alojados:
- Se ejecutan dentro de tu red privada
- Pueden acceder a recursos y sistemas internos
- Te dan control total sobre el entorno del agente
- Pueden personalizarse para tus necesidades específicas

## Configuración de un Agente de IA auto-alojado

### Paso 1: Crear un Agente de IA en OneUptime

1. Inicia sesión en tu panel de OneUptime
2. Ve a **Configuración del proyecto** > **Agentes de IA**
3. Haz clic en **Crear Agente de IA** para agregar un nuevo agente
4. Rellena los campos requeridos:
   - **Nombre**: Un nombre descriptivo para tu agente de IA
   - **Descripción** (opcional): Una descripción del propósito del agente
5. Una vez creado, recibirás un `AI_AGENT_ID` y un `AI_AGENT_KEY`

**Importante**: Guarda tu `AI_AGENT_KEY` de forma segura. Solo se mostrará una vez y no se puede recuperar posteriormente.

### Paso 2: Implementar el Agente de IA

#### Docker

Para ejecutar un agente de IA, asegúrate de tener Docker instalado. Ejecuta el agente con:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Si estás auto-alojando OneUptime, cambia `ONEUPTIME_URL` a la URL de tu instancia auto-alojada personalizada.

#### Docker Compose

También puedes ejecutar el agente de IA usando docker-compose. Crea un archivo `docker-compose.yml`:

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Luego ejecuta:

```bash
docker compose up -d
```

#### Kubernetes

Crea un archivo `oneuptime-ai-agent.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

Aplica la configuración:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Variables de entorno

El agente de IA admite las siguientes variables de entorno:

#### Variables requeridas

| Variable | Descripción |
|----------|-------------|
| `AI_AGENT_KEY` | La clave del agente de IA de tu panel de OneUptime |
| `AI_AGENT_ID` | El ID del agente de IA de tu panel de OneUptime |
| `ONEUPTIME_URL` | La URL de tu instancia de OneUptime (predeterminado: https://oneuptime.com) |


## Verificación de tu Agente de IA

Después de implementar tu agente de IA:

1. Ve a **Configuración del proyecto** > **Agentes de IA** en tu panel de OneUptime
2. Tu agente debería aparecer como **Conectado** en unos minutos
3. Si el estado muestra **Desconectado**, revisa los registros del contenedor en busca de errores

Para ver los registros del contenedor:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Solución de problemas

### El agente no se conecta

1. **Verificar credenciales**: Asegúrate de que `AI_AGENT_KEY` y `AI_AGENT_ID` sean correctos
2. **Verificar la red**: Asegúrate de que el agente pueda alcanzar tu instancia de OneUptime
3. **Revisar los registros**: Verifica los registros del contenedor en busca de mensajes de error
4. **Reglas de firewall**: Asegúrate de que se permita el tráfico HTTPS saliente (puerto 443)

### El agente sigue desconectándose

1. **Verificar límites de recursos**: Asegúrate de que el contenedor tenga suficiente memoria y CPU
2. **Estabilidad de la red**: Verifica que la conectividad de red sea estable
3. **Revisar los registros**: Busca errores de tiempo de espera o conexión en los registros

## ¿Necesitas ayuda?

Si encuentras problemas con tu agente de IA:

1. Consulta los [problemas de GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) para ver problemas conocidos
2. Crea un nuevo problema si el tuyo no está reportado aún
3. Contacta con [soporte](https://oneuptime.com/support) si estás en un plan empresarial
