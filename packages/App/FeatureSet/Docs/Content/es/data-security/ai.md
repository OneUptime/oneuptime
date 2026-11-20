# OneUptime AI en Seguridad de datos

OneUptime AI trabaja con lo que encontró Seguridad de datos sin ver tus datos. Recibe nombres, formas, recuentos y configuración, nunca un valor de tus datos, una muestra enmascarada, una entrada ni una cadena de conexión. Cada función se ejecuta en el modelo propio de tu proyecto, incluido uno autoalojado, y cada página, comprobación, escaneo e integración de Seguridad de datos funciona con la IA desactivada.

:::cards
- [Lo que ve OneUptime AI](#lo-que-ve-oneuptime-ai): Lo que envía cada función, y lo que nunca envía.
- [Compruébalo tú mismo](#compruébalo-tú-mismo): La entrada exacta que enviaría uno de tus problemas.
- [Tu propio modelo](#tu-propio-modelo): Cada función en el proveedor de tu proyecto, Ollama, vLLM o cualquier endpoint compatible con OpenAI.
- [Cómo se mide](#cómo-se-mide): Cada función con casos fijos, antes de cada versión.
:::

## Lo que ve OneUptime AI

Ninguna función envía nunca a un modelo:

- un valor de tus datos;
- una muestra enmascarada, como `j***@e******.com`: un correo electrónico enmascarado aún lleva un dominio, y una tarjeta enmascarada sus últimos cuatro dígitos;
- una entrada de tu telemetría: una línea de registro, un span o una sesión;
- una cadena de conexión, una clave o cualquier otro secreto.

Seguridad de datos lee tus datos ella misma, dentro de sus escaneos, y no guarda nada de ellos. Lo que envía a OneUptime AI se construye en un solo lugar, a partir de una lista de lo que se puede enviar, y una prueba falla cuando una función envía a un modelo cualquier otra cosa.

| Función | Lo que envía | Se ejecuta sola |
| --- | --- | --- |
| **Explicar con IA** | El título, la gravedad y las evidencias del problema, por qué importa su comprobación y la corrección para la nube del almacén; el nombre, el tipo, la región y el ID en la nube del almacén, su sensibilidad y los nombres de sus tipos de datos; para un problema en la telemetría, dónde se encontró cada clase de datos: el atributo, el cuerpo del registro o el prompt en que está | No: una persona la pide, en la página de un problema |
| **Corregir con IA** | Lo que envía Explicar con IA, como solicitud al agente de código, que luego lee el propio código del repositorio para hacer el cambio | No: una persona la pide, en un repositorio que puede cambiar en **Código** |
| **Sugerencias para campos que ningún detector identificó** | El tipo de almacén y los tipos de datos que la IA puede nombrar; el nombre de cada campo, los nombres de los campos de al lado y las formas de sus valores, cada letra como `a` o `A` y cada dígito como `9`; cuántos valores se leyeron y qué longitud tienen | Sí: el escaneo de contenido de un almacén las inicia |
| **Preguntar a la IA** | Los almacenes, problemas y accesos que la persona puede leer en Seguridad de datos; qué se encontró y dónde, cada tipo de datos por su ubicación, con recuentos y confianza | No: una persona hace una pregunta |

**Explicar con IA** y **Preguntar a la IA** también leen primero el [contexto de IA](/docs/ai/ai-context) de tu equipo, cuando tiene uno: las notas que tu equipo escribió para OneUptime AI sobre tus sistemas.

### El texto que escribieron tus sistemas es un dato

El nombre de un almacén, su ID en la nube, sus etiquetas, las evidencias con que respondió una nube y la clave de un atributo vienen de tus nubes y de tu código, así que cualquiera que pueda nombrar un bucket o etiquetar un recurso escribe lo que lee OneUptime AI. OneUptime AI recibe cada instrucción en un mensaje propio, y ese texto en un segundo mensaje, como datos:

- cada texto se limita a una longitud y se pone en una sola línea, y se quita lo que parece un secreto, una dirección de correo electrónico o una dirección IP;
- el texto que se lee como instrucciones para una IA, como «ignore previous instructions», se marca, y a OneUptime AI se le indica que nunca lo siga;
- una respuesta estructurada, como la de las sugerencias de campos, se lee de forma estricta: el objeto pedido, o ninguna respuesta.

### Lo que se guarda

La fila de cada llamada en **Ajustes del proyecto → IA → Registros de IA** dice qué función llamó a qué modelo, sus tokens y su costo. Nunca guarda lo que se envió o se respondió: los Miembros del proyecto y los Visores leen los Registros de IA, y los datos de Seguridad de datos son para sus propietarios y los roles de seguridad. La telemetría propia de OneUptime tampoco registra nunca lo que enviaron Explicar con IA o las sugerencias de campos, ni siquiera donde el operador del servidor registra lo que envían otras llamadas de IA.

Cuando una llamada falla, Explicar con IA y las sugerencias de campos no guardan ni una palabra del error del proveedor, que puede citar lo que se envió. El agente de código detrás de Corregir con IA y el chat de Preguntar a la IA siguen guardando el error del proveedor de una llamada fallida en su fila.

## Compruébalo tú mismo

**Seguridad de datos → Ajustes → OneUptime AI** muestra todo esto para tu proyecto:

- **Lo que ve OneUptime AI**: cada función, lo que envía y nunca envía, lo que la inicia, el modelo en que se ejecuta y lo que se guarda de ella. El modelo se nombra a quien puede leer los proveedores de LLM del proyecto.
- **Mostrar un ejemplo**: la entrada exacta que **Explicar con IA** enviaría para tu problema abierto de mayor riesgo, tal como la enviaría, con lo que pediría **Corregir con IA**. El contexto de IA de tu proyecto, que va primero, se muestra por su longitud. Solo muestra un problema que puedes leer.

**Ajustes del proyecto → IA → Proveedores de LLM** enlaza a ella, para quien elige el modelo.

## Tu propio modelo

Cada función de IA de Seguridad de datos se ejecuta en el modelo que eligió tu proyecto:

- **Explicar con IA** y las sugerencias de campos se ejecutan en el proveedor que elige una regla de IA para el trabajo; si no, en el proveedor de LLM predeterminado de tu proyecto; si no, en el propio del servidor.
- El agente de código de **Corregir con IA** se ejecuta en el proveedor que elige una regla de IA; si no, en uno de los proveedores de tu proyecto; si no, en el propio del servidor.
- **Preguntar a la IA** se ejecuta en el proveedor elegido en el chat; si no, en el predeterminado de tu proyecto.

Un modelo autoalojado las ejecuta todas: Ollama, vLLM o cualquier endpoint compatible con OpenAI que añadas en **Ajustes del proyecto → IA → Proveedores de LLM**. En un servidor aislado de la red, el vLLM incluido en el chart de Helm es el proveedor propio del servidor, así que nada sale del servidor.

### Con la IA desactivada

Con **Habilitar IA** desactivado en **Ajustes del proyecto → IA → Funciones de IA**, OneUptime AI no envía nada, y Seguridad de datos sigue funcionando como antes: cada página, comprobación, escaneo e integración. No aparece ningún botón de IA en un problema, y no se pregunta por ningún campo después de un escaneo.

## Cómo se mide

Cada función de IA de Seguridad de datos se mide con un conjunto fijo de casos inventados, construidos como la función construye su entrada y puntuados según lo que dice una respuesta correcta: una explicación que nombra la corrección y no repite nada que el nombre de un almacén le dijera que dijese, el tipo de datos correcto para cada campo, una corrección que cambia lo que necesita la comprobación y nada más, y una respuesta a partir de lo que leyó Preguntar a la IA. Los casos se ejecutan contra un modelo fijado cada noche, con cada cambio en un prompt de IA de Seguridad de datos y antes de cada versión, que exige que cada función alcance su umbral.

Para medir tu propio modelo con los mismos casos, ejecuta la evaluación desde una copia de OneUptime, con la clave de tu modelo, si la necesita, en `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Próximos pasos

:::cards
- [Integraciones de Seguridad de datos](/docs/data-security/integrations): Lo que hacen Explicar con IA y Corregir con IA en un problema.
- [Proveedores de LLM](/docs/ai/llm-provider): Añade tu propio modelo, incluido uno autoalojado.
- [Tipos de datos sensibles](/docs/data-security/data-types): Cómo se sugieren los campos que ningún detector pudo ubicar.
- [Comprobaciones y problemas de Seguridad de datos](/docs/data-security/checks-and-issues): Qué significa cada problema, y cómo corregirlo.
:::
