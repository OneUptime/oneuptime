# Lokale ontwikkeling

Voor lokale ontwikkeling dient u het bestand docker-compose.dev.yml te gebruiken.

Zorg dat u het volgende heeft:
- Docker en Docker Compose geïnstalleerd.
- Node.js en NPM geïnstalleerd.

```
# Kloon deze repository en ga er naartoe.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopieer config.example.env naar config.env
cp config.example.env config.env

# Omdat dit ontwikkeling is, hoeft u geen van de waarden in config.env te bewerken. U kunt het doen, maar dat is optioneel.
npm run dev
```
