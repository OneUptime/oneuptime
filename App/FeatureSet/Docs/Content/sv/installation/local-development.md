# Lokal utveckling

För lokal utveckling måste du använda filen docker-compose.dev.yml.

Du måste se till att du har:

- Docker och Docker Compose installerade.
- Node.js och NPM installerade.

```
# Klona detta repo och gå in i katalogen.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopiera config.example.env till config.env
cp config.example.env config.env

# Eftersom detta är dev behöver du inte redigera några av dessa värden i config.env. Du kan, men det är valfritt.
npm run dev
```
