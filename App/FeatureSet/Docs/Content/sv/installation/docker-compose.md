# Driftsätt OneUptime helt gratis med Docker Compose

Om du föredrar att vara värd för OneUptime på din egen server kan du använda Docker Compose för att driftsätta en instans av OneUptime på en enda server med Debian, Ubuntu eller RHEL. Det här alternativet ger dig mer kontroll och anpassningsmöjligheter för din instans, men kräver också mer tekniska kunskaper och resurser för att driftsätta och underhålla.

#### Välj dina systemkrav
Beroende på din användning och budget kan du välja olika systemkrav för din server. För optimal prestanda rekommenderar vi att du använder OneUptime med:

- **Rekommenderade systemkrav**
  - 16 GB RAM
  - 8 kärnor
  - 400 GB disk
  - Ubuntu 22.04
  - Docker och Docker Compose installerade
- **Hemlab/minimikrav**
  - Om du vill köra OneUptime för personligt eller experimentellt bruk i en hemmiljö (vissa av våra användare har det till och med installerat på RaspberryPi) kan du använda hemlab-kraven:
    - 8 GB RAM
    - 4 kärnor
    - 20 GB disk
    - Docker och Docker Compose installerade


#### Förutsättningar för driftsättning på en enda server

Installationsguide: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Innan du börjar driftsättningsprocessen, se till att du har:

- En server som kör Debian, Ubuntu eller RHEL-derivat
- Docker och Docker Compose installerade på din server

För att installera OneUptime: 

```
# Klona detta repo med bara release-grenen och gå in i katalogen.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopiera config.example.env till config.env
cp config.example.env config.env

# VIKTIGT: Redigera config.env-filen. Se till att du har slumpmässiga hemligheter.

npm start
```

Om du inte vill använda npm eller inte har det installerat, kör detta istället: 

```
# Läs miljövariabler från config.env-filen och kör docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Använd sudo om du har behörighetsproblem med att binda portar. 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Åtkomst till OneUptime

OneUptime bör köras på: http://localhost. Du behöver registrera ett nytt konto för din instans för att börja använda det.

### Konfigurera TLS/SSL-certifikat

OneUptime **stöder inte** konfiguration av SSL/TLS-certifikat. Du måste konfigurera SSL/TLS-certifikat på egen hand.

Om du behöver använda SSL/TLS-certifikat följer du dessa steg:

1. Använd en omvänd proxy som Nginx eller Caddy.
2. Använd Let's Encrypt för att tilldela certifikaten.
3. Rikta den omvända proxyn mot OneUptime-servern.
4. Uppdatera följande inställningar:
   - Sätt miljövariabeln `HTTP_PROTOCOL` till `https`.
   - Ändra miljövariabeln `HOST` till domännamnet för servern där den omvända proxyn körs.

## Checklista för produktionsberedskap

Helst bör du inte driftsätta OneUptime i produktion med docker-compose. Vi rekommenderar starkt att du använder Kubernetes. Det finns ett Helm-diagram tillgängligt för OneUptime [här](https://artifacthub.io/packages/helm/oneuptime/oneuptime). 

Om du ändå vill driftsätta OneUptime i produktion med docker-compose, överväg följande:

- **SSL/TLS**: Konfigurera SSL/TLS-certifikat. OneUptime stöder inte konfiguration av SSL/TLS-certifikat. Du måste konfigurera SSL/TLS-certifikat på egen hand. Se ovan. 
- **Hemligheter**: Se till att du har slumpmässiga hemligheter i din `config.env`-fil. Det finns några standardhemligheter i den filen. Ersätt dem med slumpmässiga långa strängar. 
- **Säkerhetskopior**: Säkerhetskopiera dina databaser regelbundet (Clickhouse, Postgres). Redis används som cache och är tillståndslös och kan ignoreras. 
- **Uppdateringar**: Uppdatera OneUptime regelbundet. Vi lanserar uppdateringar varje dag. Vi rekommenderar att du uppdaterar programvaran minst en gång i veckan om du kör i produktion. 

### Uppdatera OneUptime

För att uppdatera: 

```
git checkout release # Se till att du är på release-grenen.
git pull
npm run update
```

### Saker att ta hänsyn till

- I vår Docker-installation använder vi en lokal loggdrivrutin. OneUptime, särskilt i sond- och ingest-containrarna, genererar en stor mängd loggar. För att förhindra att din lagring fylls är det avgörande att begränsa logglagringsytan i Docker. För detaljerade instruktioner om hur du gör detta, se den officiella Docker-dokumentationen [här](https://docs.docker.com/config/containers/logging/local/).


### Avinstallera OneUptime

För att avinstallera OneUptime, kör följande kommando:

```
npm run down
```

Detta stoppar och tar bort alla containers, nätverk och volymer som skapades av OneUptime. Det tar inte bort `config.env`-filen eller det klonade repositoriet.
