# Implementa OneUptime completamente gratis con Docker Compose

Si prefieres alojar OneUptime en tu propio servidor, puedes usar Docker Compose para implementar una instancia de OneUptime en un solo servidor con Debian, Ubuntu o RHEL. Esta opción te da más control y personalización sobre tu instancia, pero también requiere más habilidades técnicas y recursos para implementarla y mantenerla.

#### Elige los requisitos del sistema

Dependiendo de tu uso y presupuesto, puedes elegir entre diferentes requisitos del sistema para tu servidor. Para un rendimiento óptimo, te sugerimos usar OneUptime con:

- **Requisitos del sistema recomendados**
  - 16 GB de RAM
  - 8 núcleos
  - 400 GB de disco
  - Ubuntu 22.04
  - Docker y Docker Compose instalados
- **Requisitos para hogar / mínimos**
  - Si deseas ejecutar OneUptime para uso personal o experimental en un entorno doméstico (algunos de nuestros usuarios incluso lo tienen instalado en una RaspberryPi), puedes usar los requisitos mínimos:
    - 8 GB de RAM
    - 4 núcleos
    - 20 GB de disco
    - Docker y Docker Compose instalados


#### Prerrequisitos para la implementación en un solo servidor

Tutorial de instalación: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Antes de comenzar el proceso de implementación, asegúrate de tener:

- Un servidor que ejecute Debian, Ubuntu o un derivado de RHEL
- Docker y Docker Compose instalados en tu servidor

Para instalar OneUptime: 

```
# Clona este repositorio con solo la rama release y accede a él.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copia config.example.env a config.env
cp config.example.env config.env

# IMPORTANTE: Edita el archivo config.env. Asegúrate de tener secretos aleatorios.

npm start
```

Si no quieres usar npm o no lo tienes instalado, ejecuta esto en su lugar: 

```
# Lee las variables de entorno del archivo config.env y ejecuta docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Usa sudo si tienes problemas de permisos al enlazar puertos. 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Acceso a OneUptime

OneUptime debería ejecutarse en: http://localhost. Debes registrar una nueva cuenta en tu instancia para empezar a usarla.

### Configuración de certificados TLS/SSL

OneUptime **no** admite la configuración de certificados SSL/TLS. Debes configurar los certificados SSL/TLS por tu cuenta.

Si necesitas usar certificados SSL/TLS, sigue estos pasos:

1. Usa un proxy inverso como Nginx o Caddy.
2. Usa Let's Encrypt para provisionar los certificados.
3. Apunta el proxy inverso al servidor de OneUptime.
4. Actualiza los siguientes ajustes:
   - Establece la variable de entorno `HTTP_PROTOCOL` en `https`.
   - Cambia la variable de entorno `HOST` al nombre de dominio del servidor donde está alojado el proxy inverso.

## Lista de verificación de preparación para producción

Idealmente, no implementes OneUptime en producción con docker-compose. Recomendamos encarecidamente usar Kubernetes. Hay un gráfico Helm disponible para OneUptime [aquí](https://artifacthub.io/packages/helm/oneuptime/oneuptime). 

Si aún quieres implementar OneUptime en producción con docker-compose, considera lo siguiente:

- **SSL/TLS**: Configura certificados SSL/TLS. OneUptime no admite la configuración de certificados SSL/TLS. Debes configurarlos por tu cuenta. Consulta más arriba. 
- **Secretos**: Asegúrate de tener secretos aleatorios en tu archivo `config.env`. Hay algunos secretos predeterminados en ese archivo. Por favor, reemplázalos con cadenas largas y aleatorias. 
- **Copias de seguridad**: Realiza copias de seguridad periódicas de tus bases de datos (Clickhouse, Postgres). Redis se usa como caché y no tiene estado, por lo que puede omitirse de forma segura. 
- **Actualizaciones**: Actualiza OneUptime regularmente. Lanzamos actualizaciones todos los días. Te recomendamos actualizar el software al menos una vez por semana si lo ejecutas en producción. 

### Actualización de OneUptime

Para actualizar: 

```
git checkout release # Asegúrate de estar en la rama release.
git pull
npm run update
```

### Aspectos a considerar

- En nuestra configuración de Docker, utilizamos un controlador de registro local. OneUptime, especialmente dentro de los contenedores de sonda e ingesta, genera una cantidad sustancial de registros. Para evitar que tu almacenamiento se llene, es fundamental limitar el almacenamiento de registros en Docker. Para obtener instrucciones detalladas sobre cómo hacerlo, consulta la documentación oficial de Docker [aquí](https://docs.docker.com/config/containers/logging/local/).


### Desinstalación de OneUptime

Para desinstalar OneUptime, ejecuta el siguiente comando:

```
npm run down
```

Esto detendrá y eliminará todos los contenedores, redes y volúmenes creados por OneUptime. No eliminará el archivo `config.env` ni el repositorio clonado.
