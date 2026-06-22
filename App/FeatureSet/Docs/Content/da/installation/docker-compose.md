# Deploy OneUptime helt gratis med Docker Compose

Hvis du foretrækker at hoste OneUptime på din egen server, kan du bruge Docker Compose til at deploye en enkelt-server-instans af OneUptime på Debian, Ubuntu eller RHEL. Denne mulighed giver dig mere kontrol og tilpasning over din instans, men kræver også mere teknisk kompetence og ressourcer til deployment og vedligeholdelse.

#### Vælg dine systemkrav

Afhængigt af dit forbrug og budget kan du vælge fra forskellige systemkrav til din server. For optimal ydeevne anbefaler vi at bruge OneUptime med:

- **Anbefalede systemkrav**
  - 16 GB RAM
  - 8 kerner
  - 400 GB disk
  - Ubuntu 22.04
  - Docker og Docker Compose installeret
- **Homelab / minimale krav**
  - Hvis du vil køre OneUptime til personlig eller eksperimentel brug i et hjemmemiljø (nogle af vores brugere har det endda installeret på RaspberryPi), kan du bruge homelab-kravene:
    - 8 GB RAM
    - 4 kerner
    - 20 GB disk
    - Docker og Docker Compose installeret

#### Forudsætninger for enkelt-server-deployment

Installationsvejledning: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Inden du starter deployment-processen, skal du sørge for, at du har:

- En server der kører Debian, Ubuntu eller RHEL-derivat
- Docker og Docker Compose installeret på din server

Sådan installeres OneUptime:

```
# Klon dette repo med kun release-branchen og gå ind i mappen.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Kopiér config.example.env til config.env
cp config.example.env config.env

# VIGTIGT: Rediger config.env-filen. Sørg for at du har tilfældige hemmeligheder.

npm start
```

Hvis du ikke kan lide at bruge npm eller ikke har det installeret, skal du i stedet køre dette:

```
# Læs miljøvariabler fra config.env-filen og kør docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Brug sudo, hvis du har problemer med tilladelser til at binde porte.
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```

### Adgang til OneUptime

OneUptime bør køre på: http://localhost. Du skal registrere en ny konto til din instans for at begynde at bruge den.

### Opsætning af TLS/SSL-certifikater

OneUptime understøtter **ikke** opsætning af SSL/TLS-certifikater. Du skal opsætte SSL/TLS-certifikater på egen hånd.

Hvis du har brug for at bruge SSL/TLS-certifikater, skal du følge disse trin:

1. Brug en reverse proxy som Nginx eller Caddy.
2. Brug Let's Encrypt til at klargøre certifikaterne.
3. Peg reverse proxyen mod OneUptime-serveren.
4. Opdater følgende indstillinger:
   - Sæt `HTTP_PROTOCOL`-miljøvariablen til `https`.
   - Skift `HOST`-miljøvariablen til domænenavnet på serveren, hvor reverse proxyen hostes.

## Tjekliste for produktionsklar tilstand

Undgå helst at deploye OneUptime i produktion med docker-compose. Vi anbefaler kraftigt at bruge Kubernetes. Der er et Helm-chart tilgængeligt til OneUptime [her](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

Hvis du stadig vil deploye OneUptime i produktion med docker-compose, bør du overveje følgende:

- **SSL/TLS**: Opsæt SSL/TLS-certifikater. OneUptime understøtter ikke opsætning af SSL/TLS-certifikater. Du skal opsætte SSL/TLS-certifikater på egen hånd. Se venligst ovenfor.
- **Hemmeligheder**: Sørg for, at du har tilfældige hemmeligheder i din `config.env`-fil. Der er nogle standardhemmeligheder i den fil. Erstat dem venligst med tilfældige lange strenge.
- **Sikkerhedskopier**: Sikkerhedskopier regelmæssigt dine databaser (Clickhouse, Postgres). Redis bruges som cache og er stateless og kan ignoreres sikkert.
- **Opdateringer**: Opdater venligst OneUptime regelmæssigt. Vi udgiver opdateringer hver dag. Vi anbefaler, at du opdaterer softwaren mindst én gang om ugen, hvis du kører i produktion.

### Opdatering af OneUptime

Sådan opdateres:

```
git checkout release # Sørg for, at du er på release-branchen.
git pull
npm run update
```

### Ting at overveje

- I vores Docker-opsætning bruger vi en lokal logdriver. OneUptime, særligt inden for probe- og ingest-containere, genererer en betydelig mængde logs. For at forhindre, at dit lager fyldes op, er det afgørende at begrænse loglagringskapaciteten i Docker. For detaljerede instruktioner om, hvordan du gør dette, kan du se den officielle Docker-dokumentation [her](https://docs.docker.com/config/containers/logging/local/).

### Afinstallation af OneUptime

For at afinstallere OneUptime skal du køre følgende kommando:

```
npm run down
```

Dette stopper og fjerner alle containere, netværk og volumes oprettet af OneUptime. Det fjerner ikke `config.env`-filen eller det klonede repository.
