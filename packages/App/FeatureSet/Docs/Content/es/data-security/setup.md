# Configurar Seguridad de datos

Seguridad de datos lee solo lo que le permites. Cada conexión a la nube se lee en uno de tres niveles, una base de datos que gestionas se lee con una cadena de conexión que le das, y la telemetría no necesita nada. Esta página explica qué permite leer a OneUptime cada opción, los permisos exactos que concede y qué guarda OneUptime de lo que lee.

:::cards
- [Elegir un nivel](#elegir-un-nivel-para-cada-conexión): Desactivado, Solo configuración, o Configuración y muestras de contenido.
- [Qué concede cada nivel](#qué-concede-cada-nivel): Las acciones de AWS, y los roles de Azure y Google Cloud.
- [Escanear una base de datos que gestionas](#escanear-una-base-de-datos-que-gestionas): Una cadena de conexión de solo lectura, o una sonda en tu red.
- [Qué guarda OneUptime](#qué-guarda-oneuptime): Recuentos, ubicaciones y muestras enmascaradas, nunca un valor.
- [Dejar que Seguridad de datos cierre una exposición](#dejar-que-seguridad-de-datos-cierre-una-exposición): La única escritura que se le puede dar a una conexión, desactivada hasta que la actives.
:::

## Elegir un nivel para cada conexión

| Nivel | En el formulario | Qué lee OneUptime |
| --- | --- | --- |
| Desactivado | **Desactivado** | Ni la configuración ni el contenido de ningún almacén. Seguridad de datos sigue listando los almacenes que conoce tu inventario en la nube, con lo que el inventario dice de ellos: si una base de datos RDS está cifrada, es pública, está protegida contra la eliminación y tiene copias de seguridad, y si una tabla de DynamoDB se puede restaurar a un momento dado. |
| Configuración | **Solo configuración** | Cómo está configurado cada almacén de datos: quién puede acceder a él, y cómo son su cifrado, sus copias de seguridad, su control de versiones, su registro de actividad, su replicación y sus etiquetas. Nunca datos, y nunca un secreto. |
| Contenido | **Configuración y muestras de contenido** | Eso, y muestras de lo que contienen los buckets de S3, las cuentas de almacenamiento de Azure, los buckets de Cloud Storage y los datasets de BigQuery. |

Cada conexión empieza en **Desactivado**. [Conectar una cuenta en la nube](/docs/telemetry/cloud-accounts#seguridad-de-datos) muestra, palabra por palabra, el comando que ejecuta cada nivel en cada nube. Para cambiar el nivel de una conexión:

:::steps
### Abre la conexión

Ve a **Nube → Conectar**. Elige **Editar** en la conexión, o conecta una cuenta nueva.

### Elige el nivel

En **Más campos**, pon **Seguridad de datos** en el nivel que quieras.

### Vuelve a ejecutar el comando

El comando que muestra el formulario cambia con el nivel. Ejecútalo en el shell de tu nube, como hiciste al conectar: concede lo que necesita el nuevo nivel, y nada más. Después selecciona **Guardar cambios**, o **Conectar** para una conexión nueva.
:::

Las lecturas en el nuevo nivel empiezan en menos de una hora, y **Comprobar ahora** o **Escanear ahora** en un almacén inicia una al momento. OneUptime lee solo lo que dice el nivel de la conexión, permita lo que permita aún el rol: baja el nivel y las lecturas se detienen al momento. Para retirar también el acceso, ejecuta el nuevo comando: en AWS sustituye la política por la del nivel inferior. **Desactivado** no añade nada, así que deja lo que concedió un comando anterior. Quítalo tú mismo: en AWS con `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, y en Azure y Google Cloud quitando los roles que añadió el nivel de contenido.

## Qué concede cada nivel

### Amazon Web Services

El nivel de configuración pone en el rol una segunda política insertada, `OneUptimeDataSecurity`, junto a la de solo lectura. Contiene exactamente las acciones de lectura a las que llama el lector de seguridad de datos. Cada una lee un ajuste; ninguna lee datos ni escribe nada:

| Para qué las usa OneUptime | Acciones |
| --- | --- |
| Listar los buckets, y leer quién puede acceder a cada uno y cómo son su cifrado, su control de versiones, su registro de actividad, sus copias y sus etiquetas | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Leer cómo se accede a las bases de datos, cómo se cifran y cómo se hacen sus copias de seguridad, y con quién se comparten sus instantáneas manuales | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Leer cómo están configurados los dominios de búsqueda, las cachés y los sistemas de archivos | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Distinguir las claves propias de AWS (alias/aws/...) de las claves que gestionas | `kms:ListAliases` |

El nivel de contenido añade tres acciones a la misma política, cada una sobre sus propios recursos:

| Acción | Permitida sobre | Para qué sirve |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Listar los nombres de los objetos de un bucket |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Leer los primeros bytes de un objeto muestreado |
| `kms:Decrypt` | `*`, solo cuando `kms:ViaService` es `s3.*.amazonaws.com` | Leer un objeto cifrado con una clave de KMS, solo a través de S3: nunca un descifrado directo de nada más que proteja la clave |

Con una **Clave de acceso** en lugar de un rol, la política va en un grupo, `OneUptimeDataSecurity`, al que se añade el usuario de la clave: IAM limita las políticas insertadas propias de un usuario a 2.048 caracteres en total, y la política de solo lectura ocupa la mayoría. Una conexión que lee toda una AWS Organization pone la misma política en el rol de cada cuenta.

:::details La política completa en el nivel de contenido
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

El nivel de configuración no añade nada: el rol **Monitoring Reader** de la conexión ya lee la configuración de cada recurso a través de Azure Resource Manager. El nivel de contenido añade el rol integrado **Storage Blob Data Reader**, en el mismo ámbito que la conexión: la suscripción o el grupo de administración raíz del inquilino.

### Google Cloud

El nivel de configuración no añade nada: el rol **Cloud Asset Viewer** de la conexión ya lee la configuración y la política de IAM de cada recurso. El nivel de contenido añade dos roles, `roles/storage.objectViewer` y `roles/bigquery.dataViewer`, en el proyecto o la organización, y activa la API de BigQuery, `bigquery.googleapis.com`.

## Dejar que Seguridad de datos cierre una exposición

Leer es todo lo que hace una conexión hasta que decidas otra cosa. **Respuesta de seguridad de datos**, en **Más campos** junto a **Seguridad de datos**, permite además a Seguridad de datos bloquear el acceso público de un almacén y dejar de compartir sus instantáneas: desde el problema del almacén, con **Corrígelo desde aquí** (consulta [Comprobaciones y problemas de Seguridad de datos](/docs/data-security/checks-and-issues#corrígelo-desde-aquí)), y desde los playbooks de Operaciones de seguridad. Está en **Desactivado** hasta que eliges **Bloquear el acceso público y el uso compartido**, y entonces el comando que muestra el formulario concede una única escritura acotada, por separado:

| Nube | Qué añade el comando | Qué puede hacer |
| --- | --- | --- |
| AWS | Una tercera política insertada, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` y `rds:ModifyDBClusterSnapshotAttribute`: el Block Public Access de un bucket, y con quién se comparte una instantánea manual |
| Azure | Un rol personalizado, `OneUptime Data Security Response`, en el ámbito de la conexión | `Microsoft.Storage/storageAccounts/read` y `Microsoft.Storage/storageAccounts/write`: los ajustes de una cuenta de almacenamiento, como el acceso anónimo a blobs, nunca sus claves |
| Google Cloud | Un rol personalizado, `oneuptimeDataSecurityResponse` | `storage.buckets.get` y `storage.buckets.update`: los ajustes de un bucket, como la prevención del acceso público |

Nada de lo que concede lee datos, elimina nada ni cambia quién puede iniciar sesión. Vuelve a ponerlo en **Desactivado** y Seguridad de datos deja de usarlo al momento. Para retirar también el acceso en AWS, elimina la política con `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Por qué las muestras de contenido son opcionales

El nivel de configuración encuentra lo que está expuesto: un bucket público, una base de datos abierta a internet, la falta de cifrado, de copias de seguridad o de registros de acceso. No puede saber qué contiene un almacén, así que un almacén en el que no se encontró nada cuenta como Público, la sensibilidad más baja, y sus problemas son tan graves como lo serían para datos públicos. Un bucket público de imágenes del sitio web no es una emergencia; un bucket público de números de tarjeta sí lo es.

Las muestras de contenido distinguen ambos casos. Fijan la sensibilidad de cada almacén según lo que contiene, así que el mismo problema tiene gravedad crítica con números de tarjeta y baja con imágenes. También encuentran lo que solo muestra el contenido: secretos, códigos de seguridad de tarjetas, contraseñas guardadas tal como se escribieron y copias de datos de producción en un almacén de pruebas.

Así que el orden que sigue la mayoría de los equipos es: el nivel de configuración en todas partes, y después muestras de contenido donde necesites saber qué contiene un almacén. El escaneo de contenido también se puede desactivar para un solo almacén, con **Escanear contenido** en los **Ajustes** del almacén, o para todo el proyecto.

## Qué lee un escaneo de contenido

Un escaneo lee un poco de un almacén, dentro de los límites del proyecto, y se detiene a los 8 minutos, quede lo que quede. El siguiente continúa desde ahí: omite un objeto que no ha cambiado desde que se leyó, salvo que eso fuera hace 7 días o más.

- **Los buckets y contenedores** se muestrean por tipo, no por cantidad. Primero se listan los nombres de los objetos, como máximo diez veces tantos como el escaneo puede leer y nunca más de 200.000. Cada nombre se convierte en su patrón, con las fechas, los UUID, las secuencias hexadecimales largas y los números convertidos en `*`, así que `exports/2026-10-27/users-0001.csv` es `exports/*/users-*.csv`. Se leen los objetos más recientes de cada patrón, uno de cada patrón antes que un segundo de cualquiera, y como máximo 5 de un mismo patrón. Cada objeto se lee desde el principio: como máximo **Bytes por objeto** de él, y **Bytes por escaneo** en total. Un escaneo muestrea como máximo 10 contenedores de una cuenta de almacenamiento de Azure.
- **Los archivos se leen según lo que son.** CSV y TSV por columna, JSON y JSON lines por ruta, `.env`, `.ini`, `.properties`, TOML y YAML por clave, XML y HTML como su texto, los archivos de Word, Excel y PowerPoint por su texto y sus celdas, y todo lo demás como texto libre. Un archivo gzip se descomprime primero. Las imágenes, Parquet, Avro, PDF y otros formatos binarios no se leen, y el escaneo lo indica.
- **Los datasets y las bases de datos** se leen tabla por tabla: como máximo **Tablas por escaneo** tablas, y **Filas por tabla** filas de cada una.

Cada escaneo guarda un registro de lo que leyó, por nombre: los objetos, tablas o servicios, nunca su contenido. Lo que no pudo leer (una solicitud que la nube rechazó, el plazo, el presupuesto de bytes) es una advertencia en el escaneo, y el escaneo se marca como **Completado parcialmente**.

## Escanear una base de datos que gestionas

Seguridad de datos muestrea bases de datos PostgreSQL y MySQL, de una de dos formas. Una base de datos que supervisa el producto de bases de datos, o una con la que hablan tus servicios en el mapa de servicios, ya es un almacén. Una base de datos que ningún escaneo encuentra, añádela tú mismo como almacén.

- **Desde los workers de OneUptime.** En los **Ajustes** del almacén, pon en **Cadena de conexión** una que solo pueda leer, como `postgresql://reader:password@db.internal:5432/app`. Se cifra en reposo y la API nunca la devuelve. Dale un usuario de base de datos que pueda leer y nada más.
- **Desde una sonda en tu red.** Elige la sonda en **Escanear desde la sonda**, y escribe en **Variable de conexión de la sonda** el nombre de la variable de entorno de esa sonda que contiene la cadena de conexión. La sonda lee la base de datos desde dentro de tu red y envía solo lo que encontró: la cadena de conexión nunca llega a OneUptime. Consulta [Sondas personalizadas](/docs/probe/custom-probe) para ejecutar una sonda.

## Qué guarda OneUptime

Para cada tipo de datos encontrado en cada ubicación (una columna, un campo, un patrón de objetos, un atributo de telemetría), un hallazgo guarda:

- cuántos valores muestreados lo contenían, de cuántos, y cuántos de ellos eran valores de prueba conocidos;
- cuántos valores distintos coincidieron, estimado a partir de hashes que se quedan en la memoria del escáner y se descartan con el escaneo;
- la confianza, y si el nombre de la ubicación apuntaba al tipo de datos;
- como máximo tres muestras enmascaradas, enmascaradas dentro del escáner antes de que nada salga de él.

Nunca guarda un valor en bruto. Cada clase de valor se enmascara para que una persona pueda reconocerlo, nunca usarlo:

| Valor | Muestra enmascarada |
| --- | --- |
| Una dirección de correo electrónico | `j***@e******.com`: la primera letra del nombre y del dominio, y la etiqueta de primer nivel |
| Un número de tarjeta | `**** **** **** 4242`: los cuatro últimos dígitos, como PCI DSS permite mostrar una tarjeta |
| Un secreto | Sus cuatro primeros y cuatro últimos caracteres cuando es largo, sus dos primeros cuando es corto, y solo la cabecera de una clave privada |
| Una URL o cadena de conexión | Todo salvo la contraseña |
| Una dirección IP | Su primera parte, la red, con el resto oculto |
| Un valor encontrado por nombre | Su primer carácter, seguido de `****` |
| Una marca de documento | La marca tal como está escrita, como «Confidencial»: dice qué es el documento |
| Cualquier otra cosa | Sus dos a cuatro últimos caracteres, con los separadores conservados, como `***-**-6789` |

Desactiva **Conservar muestras enmascaradas** en los ajustes del proyecto para guardar solo recuentos: a partir del siguiente escaneo de cada almacén, los hallazgos que escriba no guardan muestras.

Las copias de datos entre almacenes se encuentran por huellas, no por valores: 128 números de 16 bits por cada tipo de datos, con un hash hecho con una clave propia del proyecto (consulta [Cómo se mantienen privadas las huellas](/docs/data-security/flows-access-residency#cómo-se-mantienen-privadas-las-huellas)).

Un hallazgo cuenta para su almacén durante 30 días después de que un escaneo lo viera por última vez, ya que una muestra puede pasar por alto lo que sigue ahí. Uno que no se ve durante 90 días se elimina. Un almacén guarda como máximo 2.000 hallazgos.

## Ajustes

Los ajustes de Seguridad de datos son un único conjunto por proyecto, en la sección **Ajustes** del menú de Seguridad de datos. Empiezan con estos valores predeterminados:

| Ajuste | Predeterminado | Qué hace |
| --- | --- | --- |
| **Comprobar configuración** | Activado | Ejecuta las comprobaciones en cada almacén. Desactivado, no se abre, cambia ni cierra ningún problema. |
| **Escanear contenido** | Activado | Muestrea el contenido de los almacenes donde se concedió el permiso de contenido. |
| **Escanear telemetría** | Activado | Muestrea los registros, trazas, excepciones, reproducciones y conversaciones de IA del proyecto. |
| **Conservar muestras enmascaradas** | Activado | Guarda hasta tres muestras enmascaradas con cada hallazgo. Desactivado, guarda solo recuentos. |
| **Abrir casos de seguridad** | Activado | Abre un caso de seguridad, agrupado por almacén, cuando se abre un problema crítico. |
| **Generar alertas** | Desactivado | Genera una alerta, que avisa a quien esté de guardia, cuando se abre un problema crítico. |
| **Gravedad de la alerta** | Vacío | La gravedad de esas alertas. Vacío es la más grave del proyecto. |
| **Declarar incidentes** | Desactivado | Declara un incidente, que se gestiona con tu proceso de incidentes, cuando se abre un problema crítico. |
| **Gravedad del incidente** | Vacío | La gravedad de esos incidentes. Vacío es la más grave del proyecto. |
| **Notificar a los propietarios** | Activado | Envía un correo a los propietarios de un almacén cuando se abre un problema en él. |
| **Objetos por escaneo** | 2.000 | El máximo de objetos que lee un escaneo de un bucket, de 10 a 50.000. |
| **Bytes por objeto** | 65.536 (64 KB) | El máximo de bytes que se leen de un objeto, de 1.024 a 4.194.304. |
| **Bytes por escaneo** | 52.428.800 (50 MB) | El máximo de bytes que lee en total un escaneo de contenido, de 65.536 a 1.073.741.824. |
| **Filas por tabla** | 1.000 | El máximo de filas que se leen de una tabla, de 10 a 100.000. |
| **Tablas por escaneo** | 200 | El máximo de tablas que lee un escaneo, de 1 a 5.000. |
| **Tamaño de la muestra de telemetría** | 500 | Cuántos registros recientes de cada servicio y señal lee un escaneo de telemetría, de 10 a 10.000. |
| **Escanear cada (horas)** | 24 | Cada cuánto se vuelve a muestrear el contenido de un almacén, de 1 a 720. |
| **Nunca sensible** | Vacío | Valores que nunca son hallazgos, como tu propia dirección de soporte. |
| **Tipos de datos desactivados** | Vacío | Tipos de datos integrados que los escaneos del proyecto no buscan: los interruptores de **Tipos de datos integrados**. |

## Solución de problemas

:::details Un almacén dice que su contenido no se escaneó
El escaneo dice por qué: «El escaneo de contenido necesita el permiso de contenido de la conexión, o una cadena de conexión para una base de datos». Pon la conexión del almacén en **Configuración y muestras de contenido** y vuelve a ejecutar su comando, o da a la base de datos una cadena de conexión. Comprueba también que **Escanear contenido** está activado para el almacén y en los ajustes del proyecto.
:::

:::details Una comprobación dice que no puede saberlo
Un dato que el lector no pudo leer (un permiso que el rol no tiene, una API que no está activada) es desconocido, nunca supuesto. Su comprobación informa de que no puede saberlo, y un problema que abrió sigue abierto: nadie puede concluir que un problema está corregido porque OneUptime no pudo mirar. Las advertencias de la lectura de la configuración dicen qué no pudo leer. Vuelve a ejecutar el comando de la conexión para conceder lo que falta.
:::

:::details No aparecen buckets de S3 ni datasets de BigQuery
Vienen de la lectura de la configuración, no del inventario en la nube. Pon la conexión en **Solo configuración** o superior, y vuelve a ejecutar su comando.
:::

:::details Un escaneo aparece como Completado parcialmente
Alcanzó un límite antes de leerlo todo: los 8 minutos, **Bytes por escaneo** u **Objetos por escaneo**, o una solicitud que la nube rechazó. Sus advertencias dicen cuál. El siguiente escaneo continúa, omitiendo lo que no ha cambiado, o puedes subir el límite.
:::

## Próximos pasos

:::cards
- [Tipos de datos sensibles](/docs/data-security/data-types): Lo que busca el escáner en lo que lee.
- [Comprobaciones y problemas de Seguridad de datos](/docs/data-security/checks-and-issues): Qué se comprueba en la lectura de la configuración.
- [Datos sensibles en la telemetría](/docs/data-security/telemetry): Tus registros, trazas y conversaciones de IA, que no necesitan configuración.
- [Conectar una cuenta en la nube](/docs/telemetry/cloud-accounts): Conecta AWS, Azure o Google Cloud en primer lugar.
:::
