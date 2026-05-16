# Lokale Entwicklung

Für die lokale Entwicklung müssen Sie die Datei docker-compose.dev.yml verwenden. 

Sie müssen sicherstellen, dass Sie Folgendes haben: 
- Docker und Docker Compose installiert. 
- Node.js und NPM installiert.

```
# Dieses Repository klonen und in das Verzeichnis wechseln.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env nach config.env kopieren
cp config.example.env config.env

# Da dies die Entwicklungsumgebung ist, müssen Sie keine der Werte in config.env bearbeiten. Sie können es, aber das ist optional.
npm run dev
```
