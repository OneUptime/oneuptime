# Desenvolvimento Local

Para desenvolvimento local, você precisa usar o arquivo docker-compose.dev.yml.

Você precisa ter:
- Docker e Docker Compose instalados.
- Node.js e NPM instalados.

```
# Clone este repositório e entre no diretório.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copie config.example.env para config.env
cp config.example.env config.env

# Como é ambiente de desenvolvimento, você não precisa editar nenhum desses valores em config.env. Você pode, mas é opcional.
npm run dev
```
