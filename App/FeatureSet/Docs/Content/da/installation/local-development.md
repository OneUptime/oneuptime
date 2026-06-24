# Lokal udvikling

Til lokal udvikling skal du bruge docker-compose.dev.yml-filen.

Du skal sørge for, at du har:

- Docker og Docker Compose installeret.
- Node.js og NPM installeret.

```
# Klon dette repo og gå ind i mappen.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopiér config.example.env til config.env
cp config.example.env config.env

# Da dette er til udvikling, behøver du ikke redigere nogen af disse værdier i config.env. Du kan gøre det, men det er valgfrit.
npm run dev
```
