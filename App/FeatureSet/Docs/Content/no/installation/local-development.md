# Lokal utvikling

For lokal utvikling må du bruke filen docker-compose.dev.yml.

Du må sørge for at du har:
- Docker og Docker Compose installert.
- Node.js og NPM installert.

```
# Klon dette repoet og cd inn i det.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopier config.example.env til config.env
cp config.example.env config.env

# Siden dette er dev, trenger du ikke redigere noen av verdiene i config.env. Du kan, men det er valgfritt.
npm run dev
```
