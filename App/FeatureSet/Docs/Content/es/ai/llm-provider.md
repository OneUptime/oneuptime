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

## Proveedores admitidos

OneUptime actualmente admite los siguientes proveedores LLM:

| Proveedor | Descripción | Clave de API requerida | URL base requerida |
|----------|-------------|------------------|-------------------|
| **OpenAI** | GPT-4, GPT-4o, GPT-3.5 Turbo y otros modelos de OpenAI | Sí | No (usa la predeterminada) |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku y otros modelos Claude | Sí | No (usa la predeterminada) |
| **Ollama** | Modelos de código abierto auto-alojados como Llama 2, Mistral, CodeLlama, etc. | No | Sí |

## Configuración de un proveedor LLM

### Paso 1: Navegar a la configuración de proveedores LLM

1. Inicia sesión en tu panel de OneUptime
2. Ve a **Configuración del proyecto** > **IA** > **Proveedores LLM**
3. Haz clic en **Crear proveedor LLM** para agregar un nuevo proveedor

### Paso 2: Configurar tu proveedor

Completa los siguientes campos:

- **Nombre**: Un nombre descriptivo para esta configuración LLM (por ejemplo, "OpenAI de producción", "Ollama local")
- **Descripción** (opcional): Una descripción para identificar el propósito de este proveedor
- **Tipo de LLM**: Selecciona el tipo de proveedor (OpenAI, Anthropic u Ollama)
- **Clave de API**: Tu clave de API (requerida para OpenAI y Anthropic)
- **Nombre del modelo**: El modelo específico a usar (por ejemplo, `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL base** (opcional): URL de punto de conexión de API personalizado (requerida para Ollama, opcional para otros)

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
2. Descarga el modelo que desees: `ollama pull llama2`
3. Asegúrate de que Ollama esté ejecutándose y sea accesible
4. Selecciona **Ollama** como tipo de LLM
5. Ingresa la URL base (por ejemplo, `http://localhost:11434`)
6. Ingresa el nombre del modelo que descargaste

**Ejemplo de configuración:**
```
Nombre: Ollama local
Tipo de LLM: Ollama
URL base: http://localhost:11434
Nombre del modelo: llama2
```

**Modelos populares de Ollama:**
- `llama2` - Modelo Llama 2 de Meta
- `llama3` - Modelo Llama 3 de Meta
- `mistral` - Modelo de Mistral AI
- `codellama` - Modelo Llama especializado en código
- `mixtral` - Modelo de mezcla de expertos de Mistral

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
- **Ollama**: Asegúrate de que el servidor Ollama esté en ejecución y la URL base sea correcta
- **Firewall**: Verifica que tu red permita conexiones salientes a la API del proveedor

### Modelo no encontrado

- Verifica que el nombre del modelo esté escrito correctamente
- Para Ollama, asegúrate de haber descargado el modelo con `ollama pull <model-name>`
- Verifica si el modelo está disponible en tu región (algunos modelos tienen restricciones regionales)

## ¿Necesitas ayuda?

Si encuentras problemas al configurar tu proveedor LLM, por favor:

1. Consulta los [problemas de GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) para ver problemas conocidos
2. Contacta con soporte si estás en un plan empresarial
