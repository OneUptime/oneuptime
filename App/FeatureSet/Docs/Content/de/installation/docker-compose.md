# OneUptime kostenlos mit Docker Compose bereitstellen

Wenn Sie OneUptime auf Ihrem eigenen Server hosten möchten, können Sie Docker Compose verwenden, um eine Einzelserver-Instanz von OneUptime auf Debian, Ubuntu oder RHEL bereitzustellen. Diese Option gibt Ihnen mehr Kontrolle und Anpassungsmöglichkeiten für Ihre Instanz, erfordert jedoch auch mehr technische Kenntnisse und Ressourcen für die Bereitstellung und Wartung.

#### Systemanforderungen wählen
Je nach Nutzung und Budget können Sie verschiedene Systemanforderungen für Ihren Server wählen. Für optimale Leistung empfehlen wir die Verwendung von OneUptime mit:

- **Empfohlene Systemanforderungen**
  - 16 GB RAM
  - 8 Kerne
  - 400 GB Festplatte
  - Ubuntu 22.04
  - Docker und Docker Compose installiert
- **Homelab / Minimalanforderungen**
  - Wenn Sie OneUptime für den persönlichen oder experimentellen Einsatz in einer Heimumgebung betreiben möchten (einige unserer Benutzer haben es sogar auf einem RaspberryPi installiert), können Sie die Homelab-Anforderungen verwenden:
    - 8 GB RAM
    - 4 Kerne
    - 20 GB Festplatte
    - Docker und Docker Compose installiert


#### Voraussetzungen für die Einzelserver-Bereitstellung

Installations-Tutorial: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Bevor Sie mit dem Bereitstellungsprozess beginnen, stellen Sie sicher, dass Sie über Folgendes verfügen:

- Einen Server mit Debian, Ubuntu oder einem RHEL-Derivat
- Docker und Docker Compose auf Ihrem Server installiert

Um OneUptime zu installieren: 

```
# Dieses Repository nur mit dem Release-Branch klonen und in das Verzeichnis wechseln.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env nach config.env kopieren
cp config.example.env config.env

# WICHTIG: config.env-Datei bearbeiten. Stellen Sie sicher, dass Sie zufällige Geheimnisse verwenden.

npm start
```

Wenn Sie npm nicht verwenden möchten oder es nicht installiert haben, führen Sie stattdessen Folgendes aus: 

```
# Umgebungsvariablen aus der config.env-Datei lesen und docker compose up ausführen.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Verwenden Sie sudo, falls Sie Berechtigungsprobleme beim Binden von Ports haben. 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Zugriff auf OneUptime

OneUptime sollte unter http://localhost erreichbar sein. Sie müssen ein neues Konto für Ihre Instanz registrieren, um es zu verwenden.

### TLS/SSL-Zertifikate einrichten

OneUptime unterstützt **nicht** das Einrichten von SSL/TLS-Zertifikaten. Sie müssen SSL/TLS-Zertifikate selbst einrichten.

Wenn Sie SSL/TLS-Zertifikate verwenden müssen, befolgen Sie diese Schritte:

1. Verwenden Sie einen Reverse-Proxy wie Nginx oder Caddy.
2. Verwenden Sie Let's Encrypt zur Bereitstellung der Zertifikate.
3. Richten Sie den Reverse-Proxy auf den OneUptime-Server.
4. Aktualisieren Sie die folgenden Einstellungen:
   - Setzen Sie die Umgebungsvariable `HTTP_PROTOCOL` auf `https`.
   - Ändern Sie die Umgebungsvariable `HOST` auf den Domänennamen des Servers, auf dem der Reverse-Proxy gehostet wird.

## Checkliste für die Produktionsbereitschaft

Idealerweise sollten Sie OneUptime in der Produktion nicht mit docker-compose bereitstellen. Wir empfehlen dringend die Verwendung von Kubernetes. Es gibt ein Helm-Chart für OneUptime [hier](https://artifacthub.io/packages/helm/oneuptime/oneuptime). 

Wenn Sie OneUptime trotzdem in der Produktion mit docker-compose bereitstellen möchten, beachten Sie bitte Folgendes:

- **SSL/TLS**: Richten Sie SSL/TLS-Zertifikate ein. OneUptime unterstützt das Einrichten von SSL/TLS-Zertifikaten nicht. Sie müssen SSL/TLS-Zertifikate selbst einrichten. Siehe oben. 
- **Geheimnisse**: Stellen Sie sicher, dass Sie zufällige Geheimnisse in Ihrer `config.env`-Datei haben. Es gibt einige Standardgeheimnisse in dieser Datei. Bitte ersetzen Sie diese durch zufällige lange Zeichenketten. 
- **Backups**: Sichern Sie regelmäßig Ihre Datenbanken (Clickhouse, Postgres). Redis wird als Cache verwendet und ist zustandslos und kann sicher ignoriert werden. 
- **Updates**: Bitte aktualisieren Sie OneUptime regelmäßig. Wir veröffentlichen täglich Updates. Wir empfehlen, die Software mindestens einmal pro Woche zu aktualisieren, wenn Sie sie in der Produktion betreiben. 

### OneUptime aktualisieren

Zum Aktualisieren: 

```
git checkout release # Bitte stellen Sie sicher, dass Sie sich im Release-Branch befinden.
git pull
npm run update
```

### Zu beachtende Punkte

- In unserem Docker-Setup verwenden wir einen lokalen Logging-Treiber. OneUptime, insbesondere in den Probe- und Ingest-Containern, generiert eine erhebliche Menge an Logs. Um zu verhindern, dass Ihr Speicher voll wird, ist es entscheidend, den Logging-Speicher in Docker zu begrenzen. Detaillierte Anweisungen hierzu finden Sie in der offiziellen Docker-Dokumentation [hier](https://docs.docker.com/config/containers/logging/local/).


### OneUptime deinstallieren

Um OneUptime zu deinstallieren, führen Sie den folgenden Befehl aus:

```
npm run down
```

Dadurch werden alle von OneUptime erstellten Container, Netzwerke und Volumes gestoppt und entfernt. Die `config.env`-Datei oder das geklonte Repository werden nicht entfernt.
