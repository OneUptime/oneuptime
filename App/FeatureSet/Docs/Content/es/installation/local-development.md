# Desarrollo local

Para el desarrollo local necesitas usar el archivo docker-compose.dev.yml. 

Debes asegurarte de tener: 
- Docker y Docker Compose instalados. 
- Node.js y NPM instalados.

```
# Clona este repositorio y accede a él.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copia config.example.env a config.env
cp config.example.env config.env

# Como es para desarrollo, no tienes que editar ninguno de esos valores en config.env. Puedes hacerlo, pero es opcional.
npm run dev
```
