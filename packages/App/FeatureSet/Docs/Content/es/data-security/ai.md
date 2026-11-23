# OneUptime AI en Seguridad de datos

OneUptime AI trabaja con lo que encontró Seguridad de datos sin ver tus datos. Recibe nombres, formas, recuentos y configuración, nunca un valor de tus datos, una muestra enmascarada, una entrada ni una cadena de conexión. Cada función se ejecuta en el modelo propio de tu proyecto, incluido uno autoalojado, y cada página, comprobación, escaneo e integración de Seguridad de datos funciona con la IA desactivada.

:::cards
- [Por su cuenta](#por-su-cuenta): Qué hace con cada problema nuevo, qué te espera y las reglas de IA.
- [Lo que ve OneUptime AI](#lo-que-ve-oneuptime-ai): Lo que envía cada función, y lo que nunca envía.
- [Compruébalo tú mismo](#compruébalo-tú-mismo): La entrada exacta que enviaría uno de tus problemas.
- [Tu propio modelo](#tu-propio-modelo): Cada función en el proveedor de tu proyecto, Ollama, vLLM o cualquier endpoint compatible con OpenAI.
- [Cómo se mide](#cómo-se-mide): Cada función con casos fijos, antes de cada versión.
:::

## Por su cuenta

Con **Trabajar en los problemas nuevos** activado en **Seguridad de datos → IA**, como en los proyectos nuevos, la IA de OneUptime trabaja por su cuenta en cada problema nuevo crítico o alto. Escribe el análisis de cada uno de esos problemas, y de cada uno que se vuelva a abrir, como lo hace **Analizar el problema** y a partir de lo que eso envía, antes de que nadie lo abra, y solo lo vuelve a escribir cuando cambió aquello en lo que se basa. Para un problema de telemetría oculta por su cuenta un secreto en la telemetría nueva, donde la regla está demostrada en las entradas en las que se vio el secreto y nada lee lo que oculta, y propone las reglas de depuración para el resto (consulta [Contenido por su cuenta](/docs/data-security/telemetry#contenido-por-su-cuenta)). Una propuesta espera en esa página en **Esperándote**, primero las más arriesgadas, con qué cambiará, por qué, cómo se demostrará y cómo deshacerlo. **Aprobar** hace el cambio con tus propios permisos: una regla de depuración requiere permiso para crear reglas de depuración de registros, reglas de depuración de trazas o reglas del pipeline de métricas. **Descartar propuesta** dice que no, con un motivo que se añade a la cronología del problema. La comprobación propia del problema decide si un cambio funcionó: el almacén se vuelve a comprobar y el problema se resuelve cuando no queda ninguno de sus datos.

La IA de OneUptime también propone propietarios para los almacenes que no tienen ninguno, a partir de lo que ya apunta a ellos: las etiquetas en la nube del almacén, los servicios que lo usan y sus propietarios, los propietarios del código del archivo que lo declara, quién lo cambió según el registro de cambios de la nube y quién lo añadió a OneUptime. Solo nombra equipos y personas de tu propio proyecto, dice qué tan segura está y dice dónde las evidencias no coinciden. La propuesta para un almacén sensible llega con su problema **Este almacén sensible no tiene propietario**, y los demás almacenes nuevos reciben la suya una vez al día y cuando se lee por primera vez una conexión a la nube. Cuando los propietarios de tres o más almacenes se basan en la misma etiqueta o en el mismo comienzo de su nombre, también propone la regla del propietario que mantiene con propietario al siguiente almacén como esos, y dice con cuántos almacenes coincidiría la regla. Estas propuestas esperan en **Propietarios por revisar**, en esta página y en **Almacenes de datos**: **Aprobar** añade los propietarios con tus propios permisos, y se les avisa como a cualquier propietario; **Cambiar y aprobar** elige otros propietarios primero; **Deshacer** quita exactamente los propietarios que añadió, y la regla con ellos. Añadir un propietario cambia a quién se avisa, así que siempre te espera, diga lo que diga una regla de IA.

De forma predeterminada, la IA de OneUptime pregunta antes de cada cambio, salvo uno que solo oculta datos, se puede deshacer y está demostrado que es seguro, y nunca borra datos ni avisa a nadie sin preguntar. Un cambio que hizo sin preguntar aparece en **Hecho por la IA**, con **Deshacer**. **Por qué la IA no actuó** lista los problemas que revisó y dejó como estaban, y por qué. Cada propuesta, aprobación, descarte y reversión está en la **Cronología** del problema y del almacén. Con el interruptor desactivado, Seguridad de datos funciona como siempre, y **Analizar el problema** y **Corregir con IA** siguen funcionando cuando los pulsas; con la IA desactivada para el proyecto, ninguno de los dos.

OneUptime AI también da su veredicto sobre cada hallazgo que espera la decisión de una persona: **Confirmarlo**, **No sensible** o **No se puede determinar**, con las propias decisiones de tu equipo sobre hallazgos parecidos como precedente (consulta [Los veredictos de OneUptime AI](/docs/data-security/data-types#los-veredictos-de-oneuptime-ai)). Nunca marca un hallazgo como no sensible, y solo confirma uno por su cuenta donde **Juzgar** está en **Automáticamente** en una regla de IA. A partir de los hallazgos que tu equipo marca como no sensibles, propone desactivar un tipo de datos o excluir una ubicación de los escaneos de un almacén, propuestas que siempre te esperan.

En la página de un problema, la tarjeta **OneUptime AI** sobre **Cómo corregirlo** muestra el análisis y lo que se propuso para ese problema, con los mismos botones. La **Vista general** de seguridad de datos dice cuántas fugas contuvo la IA de OneUptime esta semana y cuántas propuestas te esperan. **Notas para la IA de OneUptime** cuenta semana a semana en qué quedaron sus cambios: consulta [Cómo le va a OneUptime AI](/docs/ai/ai-sre#cómo-le-va-a-oneuptime-ai).

### Reglas de IA

En **Reglas de IA** de **Seguridad de datos → IA**, una regla dice en qué problemas trabaja la IA de OneUptime - por su comprobación o grupo de comprobaciones, su gravedad, y la sensibilidad, el tipo, el proveedor, el entorno, las etiquetas, las categorías de datos y el servicio del almacén - y, para cada tipo de trabajo, **Analizar**, **Contener**, **Corrección** y **Juzgar**, si está en **Desactivado**, **Sugerir** (propone y te espera) o **Automáticamente**. Cuando varias reglas coinciden con un problema, un tipo de trabajo se ejecuta si alguna lo activa, y **Sugerir** gana a **Automáticamente**. Cada propuesta dice qué regla la decidió. **Contener** en **Automáticamente** permite que también se ejecute por su cuenta una regla de depuración demostrada para datos personales, no solo la de un secreto; una regla de la que no está demostrado que sea segura siempre te espera, diga lo que diga una regla de IA. Sin ninguna regla, se aplican los valores predeterminados del proyecto: analizar los problemas críticos y altos, y sugerir todo lo demás.

Las reglas de IA pertenecen a todo el proyecto, como las de incidentes y alertas: los Propietarios del proyecto y los Administradores del proyecto las cambian, igual que cualquiera con los permisos de reglas de IA. Los roles de seguridad ven lo que la IA de OneUptime propuso e hizo, pero no las reglas.

## Lo que ve OneUptime AI

Ninguna función envía nunca a un modelo:

- un valor de tus datos;
- una muestra enmascarada, como `j***@e******.com`: un correo electrónico enmascarado aún lleva un dominio, y una tarjeta enmascarada sus últimos cuatro dígitos;
- una entrada de tu telemetría: una línea de registro, un span o una sesión;
- una cadena de conexión, una clave o cualquier otro secreto.

Seguridad de datos lee tus datos ella misma, dentro de sus escaneos, y no guarda nada de ellos. Lo que envía a OneUptime AI se construye en un solo lugar, a partir de una lista de lo que se puede enviar, y una prueba falla cuando una función envía a un modelo cualquier otra cosa.

| Función | Lo que envía | Se ejecuta sola |
| --- | --- | --- |
| **Análisis a petición** | El título, la gravedad y la evidencia del problema, por qué importa su comprobación y los pasos que lo corrigen; el nombre, el tipo, la región, las etiquetas y la configuración del almacén, su sensibilidad, los nombres de sus tipos de datos y aproximadamente cuántos registros contiene; quién puede llegar al almacén: la identidad, el nivel y la forma de concesión de cada permiso, y aproximadamente cuándo se usó por última vez, y los servicios vistos usándolo; las copias de sus datos en otros almacenes, sus casos de seguridad, la acción de respuesta que corrige el problema, y el repositorio y los archivos que lo declaran; cuántos propietarios tiene el almacén, nunca quiénes son; para un problema de telemetría, dónde se encontró cada tipo de dato: el atributo, el cuerpo del log o el prompt en el que está | No: lo pide una persona, en la página de un problema, o con Explicar con IA a través de la API o del servidor MCP |
| **Análisis de problemas nuevos** | El título, la gravedad y la evidencia del problema, por qué importa su comprobación y los pasos que lo corrigen; el nombre, el tipo, la región, las etiquetas y la configuración del almacén, su sensibilidad, los nombres de sus tipos de datos y aproximadamente cuántos registros contiene; quién puede llegar al almacén: la identidad, el nivel y la forma de concesión de cada permiso, y aproximadamente cuándo se usó por última vez, y los servicios vistos usándolo; las copias de sus datos en otros almacenes, sus casos de seguridad, la acción de respuesta que corrige el problema, y el repositorio y los archivos que lo declaran; cuántos propietarios tiene el almacén, nunca quiénes son; para un problema de telemetría, dónde se encontró cada tipo de dato: el atributo, el cuerpo del log o el prompt en el que está | Sí: lo inicia un problema nuevo o reabierto de gravedad Crítica o Alta, mientras **Trabajar en los problemas nuevos** esté activado |
| **Corregir con IA** | El problema tal como lo vio su comprobación, el nombre, el tipo, la región y el ID de nube del almacén, y para un problema de telemetría dónde se encontraron sus datos, como una solicitud al agente de código, que luego lee el propio código del repositorio para hacer el cambio | No: lo pide una persona, en un repositorio que puede cambiar en **Code** |
| **Sugerencias para campos que ningún detector identificó** | El tipo de almacén y los tipos de datos que la IA puede nombrar; el nombre de cada campo, los nombres de los campos de al lado y las formas de sus valores, cada letra como `a` o `A` y cada dígito como `9`; cuántos valores se leyeron y qué longitud tienen | Sí: el escaneo de contenido de un almacén las inicia |
| **Veredictos sobre los hallazgos que te esperan** | El tipo de datos de cada hallazgo, el nombre y el tipo de su campo, la certeza del escaneo y sus recuentos, redondeados, con cualquier indicio de coincidencia errónea; el nombre, el tipo y el entorno del almacén; las decisiones anteriores de tu equipo sobre hallazgos parecidos: dónde estaba cada uno, qué se decidió y el motivo dado, sin ningún valor que aparezca en el motivo | Sí: el escaneo de un almacén los inicia, para sus hallazgos de confianza Baja, las sugerencias de OneUptime AI y los hallazgos que muestran un indicio de coincidencia errónea, mientras **Trabajar en los problemas nuevos** esté activado |
| **Preguntar a la IA** | Los almacenes, problemas y accesos que la persona puede leer en Seguridad de datos; qué se encontró y dónde, cada tipo de datos por su ubicación, con recuentos y confianza | No: una persona hace una pregunta |
| **Propietarios de almacenes de datos** | El nombre, el tipo, el proveedor, el entorno y la sensibilidad del almacén, y los nombres de sus tipos de datos; lo que apunta a un propietario: sus etiquetas en la nube, los servicios que lo usan, los propietarios del código del archivo que lo declara y los cambios que se le hicieron; los equipos que nombran las evidencias, por su nombre, y las personas que nombran, solo como candidatos numerados, nunca por su nombre ni su correo electrónico | Sí: la inicia un almacén sin propietarios, una vez al día para los almacenes nuevos y cuando se lee por primera vez una conexión a la nube, mientras **Trabajar en los problemas nuevos** está activado |
| **Nombres para problemas con una sola causa** | Lo que comparten los almacenes de datos del grupo: el módulo, la pila o la etiqueta que los creó, la identidad que los creó o su patrón de nombre; la comprobación que fallan, cuántos problemas tiene el grupo, el tipo de almacén de datos y el código que los declara. Nunca el nombre de ninguno de los almacenes del grupo | Sí: lo inicia un grupo de problemas que causó un mismo error, cuando se forma o cambia lo que comparten sus almacenes, mientras **Trabajar en los problemas nuevos** esté activado |
| **Corregir la causa** | La comprobación que fallan los problemas del grupo, lo que comparten sus almacenes de datos y el módulo o los archivos que los declaran, como una solicitud al agente de código; cada almacén de datos que corrige la pull request: su nombre, tipo, región e ID en la nube, y su problema; después, el agente de código lee el propio código del repositorio para hacer el cambio | No: lo pide una persona, desde un grupo en **Problemas** o aprobando la propuesta de OneUptime AI, en un repositorio que puede cambiar en **Código**; o el paso **Fix the code with AI** de un playbook de seguridad. Una regla cuya **Corrección** es **Sin preguntar** la abre por sí sola |
| **Reglas de depuración para lo que «Depurar» no puede cubrir** | El tipo de datos de cada hallazgo, su categoría y si se encuentra por sus valores o por el nombre de un campo; dónde está, el atributo o el cuerpo del log, y los nombres de los atributos de al lado; las formas de sus valores, como `AA-9999` para el valor `AB-1234`, y cuántos valores se leyeron | Sí: la inicia un problema de telemetría en el que la IA de OneUptime contiene la fuga, para los datos que ninguna regla de «Depurar» puede ocultar, mientras **Trabajar en los problemas nuevos** está activado |
| **Datos sensibles en pull requests** | Lo que las reglas encontraron en el diff de la pull request: el archivo y la línea, el nombre escrito, el tipo de dato que nombra y la comprobación que no superaría; el diff de esos archivos y el título de la pull request, sin lo que parece un secreto, una dirección de correo electrónico o una dirección IP; nunca lo que contiene producción: dónde tu telemetría contuvo los datos, el nombre de un almacén o lo que contiene un almacén, ni una muestra de lo encontrado, ni siquiera enmascarada | Sí: la [revisión de producción](/docs/ai/ai-agent#revisión-de-producción-de-pull-requests) de una pull request lo inicia, cuando sus reglas encuentran datos sensibles en el cambio |

**Explicar con IA** y **Preguntar a la IA** también leen primero el [contexto de IA](/docs/ai/ai-context) de tu equipo, cuando tiene uno: las notas que tu equipo escribió para OneUptime AI sobre tus sistemas. **Análisis de problemas nuevos** también lo lee.

### El texto que escribieron tus sistemas es un dato

El nombre de un almacén, su ID en la nube, sus etiquetas, las evidencias con que respondió una nube y la clave de un atributo vienen de tus nubes y de tu código, así que cualquiera que pueda nombrar un bucket o etiquetar un recurso escribe lo que lee OneUptime AI. OneUptime AI recibe cada instrucción en un mensaje propio, y ese texto en un segundo mensaje, como datos:

- cada texto se limita a una longitud y se pone en una sola línea, y se quita lo que parece un secreto, una dirección de correo electrónico o una dirección IP;
- el texto que se lee como instrucciones para una IA, como «ignore previous instructions», se marca, y a OneUptime AI se le indica que nunca lo siga;
- una respuesta estructurada, como la de las sugerencias de campos, se lee de forma estricta: el objeto pedido, o ninguna respuesta.

### Lo que se guarda

La fila de cada llamada en **Ajustes del proyecto → IA → Registros de IA** dice qué función llamó a qué modelo, sus tokens y su costo. Nunca guarda lo que se envió o se respondió: los Miembros del proyecto y los Visores leen los Registros de IA, y los datos de Seguridad de datos son para sus propietarios y los roles de seguridad. La telemetría propia de OneUptime tampoco registra nunca lo que enviaron Explicar con IA, las sugerencias de campos o los veredictos sobre los hallazgos, ni siquiera donde el operador del servidor registra lo que envían otras llamadas de IA. El análisis en sí se guarda en su problema, para quien pueda leer el problema, y una línea que se basa en algo que un lector no puede leer se le oculta.

Cuando una llamada falla, Explicar con IA y las sugerencias de campos no guardan ni una palabra del error del proveedor, que puede citar lo que se envió. El agente de código detrás de Corregir con IA y Corregir la causa, y el chat de Preguntar a la IA, siguen guardando el error del proveedor de una llamada fallida en su fila.

Las propuestas de propietarios guardan lo mismo que Explicar con IA: las filas de sus llamadas nombran la función, el modelo, los tokens y el coste, nunca lo que se envió o se respondió, y ni una palabra del error de una llamada fallida. Lo mismo hacen las reglas de depuración que escribe la IA de OneUptime, y cada regla que escribió se ejecuta en las entradas en las que se vieron los datos antes de proponerla o crearla. Lo mismo guardan las lecturas de los datos sensibles de una pull request, cuyos puntos se guardan en su revisión de producción, en Código y en su comentario. Lo mismo guardan los veredictos sobre los hallazgos, cada uno en su hallazgo, para quien pueda leerlo.

## Compruébalo tú mismo

**Seguridad de datos → Ajustes → OneUptime AI** muestra todo esto para tu proyecto:

- **Lo que ve OneUptime AI**: cada función, lo que envía y nunca envía, lo que la inicia, el modelo en que se ejecuta y lo que se guarda de ella. El modelo se nombra a quien puede leer los proveedores de LLM del proyecto.
- **Mostrar un ejemplo**: la entrada exacta que **Explicar con IA** enviaría para tu problema abierto de mayor riesgo, tal como la enviaría, con lo que pediría **Corregir con IA**. El contexto de IA de tu proyecto, que va primero, se muestra por su longitud. Solo muestra un problema que puedes leer.

**Ajustes del proyecto → IA → Proveedores de LLM** enlaza a ella, para quien elige el modelo.

## Tu propio modelo

Cada función de IA de Seguridad de datos se ejecuta en el modelo que eligió tu proyecto:

- **Explicar con IA**, las sugerencias de campos y los veredictos sobre los hallazgos se ejecutan en el proveedor que elige una regla de IA para el trabajo; si no, en el proveedor de LLM predeterminado de tu proyecto; si no, en el propio del servidor.
- El agente de código de **Corregir con IA** se ejecuta en el proveedor que elige una regla de IA; si no, en uno de los proveedores de tu proyecto; si no, en el propio del servidor.
- **Preguntar a la IA** se ejecuta en el proveedor elegido en el chat; si no, en el predeterminado de tu proyecto.
- La lectura de los datos sensibles de una pull request se ejecuta en el proveedor que el repositorio elige para sus revisiones de producción; si no, en el proveedor de LLM predeterminado de tu proyecto; si no, en el propio del servidor.

Un modelo autoalojado las ejecuta todas: Ollama, vLLM o cualquier endpoint compatible con OpenAI que añadas en **Ajustes del proyecto → IA → Proveedores de LLM**. En un servidor aislado de la red, el vLLM incluido en el chart de Helm es el proveedor propio del servidor, así que nada sale del servidor.

### Con la IA desactivada

Con **Habilitar IA** desactivado en **Ajustes del proyecto → IA → Funciones de IA**, OneUptime AI no envía nada, y Seguridad de datos sigue funcionando como antes: cada página, comprobación, escaneo e integración. No aparece ningún botón de IA en un problema, no se pregunta por ningún campo después de un escaneo, y ningún hallazgo recibe un veredicto.

## Cómo se mide

Cada función de IA de Seguridad de datos se mide con un conjunto fijo de casos inventados, construidos como la función construye su entrada y puntuados según lo que dice una respuesta correcta: una explicación que nombra la corrección y no repite nada que el nombre de un almacén le dijera que dijese, el tipo de datos correcto para cada campo, una corrección que cambia lo que necesita la comprobación y nada más, y una respuesta a partir de lo que leyó Preguntar a la IA. Los casos se ejecutan contra un modelo fijado cada noche, con cada cambio en un prompt de IA de Seguridad de datos y antes de cada versión, que exige que cada función alcance su umbral.

Las propuestas de propietarios se puntúan por nombrar al propietario al que apuntan las evidencias, por no elegir a nadie cuando no apuntan a nadie y por no estar seguras donde las evidencias no coinciden. Las reglas de depuración se ejecutan sobre valores inventados de cada lugar, que el modelo nunca ve, y se puntúan por ocultar cada valor que contiene los datos y ninguno de los demás, y por no escribir ninguna regla para un lugar para el que ninguna regla es la correcta. Las lecturas de pull requests se puntúan por conservar cada punto que es una fuga, dejar fuera lo que no lo es y una corrección que diga qué cambiar. Los veredictos sobre los hallazgos se puntúan por dar a cada hallazgo el veredicto que permite su caso, basándose en las decisiones de tu equipo que nombra el caso: un número de tarjeta que tu equipo marcó como no sensible en cuatro almacenes, por ser números de pedido, es **No sensible**, y un secreto sobre el que nadie decidió nunca lo es.

Para medir tu propio modelo con los mismos casos, ejecuta la evaluación desde una copia de OneUptime, con la clave de tu modelo, si la necesita, en `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

En tu proyecto, **Veredictos acertados** en **Ajustes del proyecto → IA → Resultados de IA** cuenta cuántas veces lo que las personas decidieron sobre un problema analizado por OneUptime AI salió como decía su veredicto: corregido o aceptado cuando dijo **Real**, aceptado o marcado como público por diseño cuando dijo **Probablemente intencionado**, y marcado como que no es un problema cuando dijo **Probablemente un hallazgo erróneo**.

## Próximos pasos

:::cards
- [Integraciones de Seguridad de datos](/docs/data-security/integrations): Lo que hacen Explicar con IA y Corregir con IA en un problema.
- [Proveedores de LLM](/docs/ai/llm-provider): Añade tu propio modelo, incluido uno autoalojado.
- [Tipos de datos sensibles](/docs/data-security/data-types): Cómo se sugieren los campos que ningún detector pudo ubicar, y cómo se juzgan los hallazgos.
- [Comprobaciones y problemas de Seguridad de datos](/docs/data-security/checks-and-issues): Qué significa cada problema, y cómo corregirlo.
:::
