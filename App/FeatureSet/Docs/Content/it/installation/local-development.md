# Sviluppo Locale

Per lo sviluppo locale è necessario usare il file docker-compose.dev.yml. 

Devi assicurarti di avere: 
- Docker e Docker compose installati. 
- Node.js e NPM installati.

```
# Clona questo repo e spostati nella directory.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copia config.example.env in config.env
cp config.example.env config.env

# Poiché questo è sviluppo, non devi modificare nessuno di quei valori in config.env. Puoi farlo, ma è opzionale.
npm run dev
```
