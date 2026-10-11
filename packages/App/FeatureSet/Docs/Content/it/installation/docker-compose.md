# Docker Compose

Esegui un'istanza OneUptime completa e gratuita su un unico server Linux con Docker Compose. Questa pagina ti porta da un server appena creato a un'istanza funzionante, poi tratta HTTPS, l'hardening per la produzione, i backup, gli aggiornamenti e la rimozione.

:::cards
- [Installare OneUptime](#installare-oneuptime): Da un server appena creato al tuo primo account, in sei passi.
- [Configurare HTTPS](#configurare-https): Lascia che OneUptime ottenga un certificato, o metti davanti il tuo proxy.
- [Checklist per la produzione](#checklist-per-la-produzione): Cosa sistemare prima che arrivi il traffico reale.
- [Aggiornare OneUptime](#aggiornare-oneuptime): Passa all'ultima release.
:::

## Come funziona

Docker Compose esegue ogni parte di OneUptime come container sul tuo server. Tutto il traffico entra dal container `ingress`, che lo instrada verso l'`app`. L'app conserva i suoi dati in PostgreSQL, ClickHouse e Valkey. Una sonda inclusa esegue i controlli dei tuoi monitor e riporta i risultati tramite l'ingress.

```mermaid title="Il deployment con Docker Compose"
flowchart TB
    Users["Utenti e agent"]
    Proxy["Il tuo reverse proxy, facoltativo"]
    Targets["Siti che monitori"]
    subgraph Server["Il tuo server"]
        Ingress["ingress"]
        App["app"]
        Probe["probe-1"]
        Runner["runner"]
        subgraph Data["Datastore"]
            direction LR
            PG[("postgres")]
            CH[("clickhouse")]
            VK[("valkey")]
        end
    end
    Users -->|HTTPS| Proxy
    Proxy -->|HTTP| Ingress
    Users -.->|"senza proxy"| Ingress
    Ingress --> App
    App --> PG
    App --> CH
    App --> VK
    Probe -->|risultati| Ingress
    Runner -->|job| Ingress
    Probe -->|controlli| Targets
```

| Servizio | Immagine | Cosa fa |
| --- | --- | --- |
| `ingress` | `oneuptime/nginx` | Riceve tutto il traffico sulle porte 80 e 443 e lo instrada verso l'app. Serve HTTPS quando OneUptime gestisce il certificato. |
| `app` | `oneuptime/app` | La dashboard, l'API, le pagine di stato, l'ingestione della telemetria e i worker in background. |
| `probe-1` | `oneuptime/probe` | Una sonda globale che esegue i controlli dei tuoi monitor. Usa la rete dell'host. |
| `runner` | `oneuptime/runner` | Il Runner dell'istanza, che esegue le correzioni del codice con l'IA. Usa la rete dell'host. |
| `postgres` | `postgres:15` | Configurazione e stato: monitor, incidenti, utenti. Conservati nel volume `postgres`. |
| `clickhouse` | `clickhouse/clickhouse-server:26.7` | Telemetria: log, metriche, trace ed eccezioni. Conservata nel volume `clickhouse`. |
| `valkey` | `valkey/valkey:9.1-alpine` | Cache e code. Non conserva nulla su disco. |

> [!NOTE]
> Il servizio `valkey` esegue [Valkey](https://valkey.io), il fork con licenza BSD di Redis 7.2, configurato tramite le impostazioni `VALKEY_*` in `config.env`. Va bene qualsiasi server che parli il protocollo Redis: punta `VALKEY_HOST` a un Redis gestito se preferisci. Fino alla 13.0.0 queste impostazioni si chiamavano `REDIS_*`; i vecchi nomi vengono ancora letti, il container risponde ancora al nome host `redis` e `npm run update` non li riscrive, quindi un `config.env` più vecchio non richiede modifiche.

Per la produzione su larga scala, o quando ti serve l'alta disponibilità, usa invece il [chart Helm](https://artifacthub.io/packages/helm/oneuptime/oneuptime) su Kubernetes: Docker Compose esegue una sola copia di ogni servizio su un unico server.

## Requisiti

Scegli la dimensione del server in base a ciò che ci farai girare. È la telemetria (log, metriche, trace) a determinare memoria e disco; consulta [Dimensionamento e pianificazione della capacità](/docs/installation/sizing) quando conosci i tuoi volumi.

| | Consigliato | Minimo per un homelab |
| --- | --- | --- |
| **Memoria** | 16 GB | 8 GB |
| **CPU** | 8 core | 4 core |
| **Disco** | 400 GB | 20 GB |
| **Sistema** | Ubuntu 22.04, o un altro Linux basato su Debian, Ubuntu o RHEL | Lo stesso |
| **Architettura** | x86-64 (`amd64`) o ARM (`arm64`) | La stessa |

Il minimo per un homelab va bene per un uso personale e sperimentale: c'è chi fa girare OneUptime su un Raspberry Pi.

Ti servono anche:

- **Docker** con il plugin **Docker Compose v2** (il comando `docker compose`).
- **Git**, per scaricare OneUptime.
- **Node.js e npm**, che eseguono gli script `npm start` e `npm run update` che avvolgono Docker Compose.
- **Porte 80 e 443** libere sul server. La tabella qui sotto elenca ogni porta che OneUptime usa sull'host.

| Porta dell'host | Usata da | Impostazione | A cosa serve |
| --- | --- | --- | --- |
| 80 | `ingress` | `ONEUPTIME_HTTP_PORT` | La dashboard, l'API, l'ingestione della telemetria e la validazione di Let's Encrypt. |
| 443 | `ingress` | `STATUS_PAGE_HTTPS_PORT` | HTTPS per la tua istanza quando OneUptime gestisce il certificato, e per le pagine di stato e le dashboard su domini personalizzati. |
| 5400 | `postgres` | Impostata in `docker-compose.yml` | Permette a `npm run backup` di raggiungere PostgreSQL. Tienila chiusa verso Internet. |
| 3874 | `probe-1` | `GLOBAL_PROBE_1_PORT` | Il server proprio della sonda. Niente fuori dal server ne ha bisogno. |
| 3876 | `runner` | `ONEUPTIME_RUNNER_PORT` | Il server proprio del Runner. Niente fuori dal server ne ha bisogno. |

C'è anche una [guida video](https://youtu.be/j1SWmMW2oL4) dell'installazione.

## Installare OneUptime

:::steps
### Clona il branch release

Il branch `release` contiene i file dell'ultima release.

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
```

### Crea config.env

Tutte le impostazioni di OneUptime si trovano in `config.env`. Parti dall'esempio:

```bash
cp config.example.env config.env
```

### Imposta il nome host

Apri `config.env` e imposta `HOST` sul nome di dominio o sull'indirizzo IP che verrà usato per raggiungere OneUptime, senza `http://`. Lascia `localhost` solo per provare OneUptime sul tuo computer.

```ini title="config.env"
HOST=oneuptime.example.com
```

### Genera secret casuali

Il file di esempio contiene secret segnaposto che sono pubblici su GitHub. Sostituisci ciascuno con un valore casuale proprio:

```bash
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done
grep -c "please-change-this" config.env
```

L'ultimo comando stampa `0`: non è rimasto alcun segnaposto. Il ciclo usa GNU `sed`, presente su ogni server Linux. Queste sono le impostazioni che compila:

| Impostazione | Cosa protegge |
| --- | --- |
| `ONEUPTIME_SECRET` | Le chiamate tra i servizi di OneUptime. |
| `ENCRYPTION_SECRET` | I secret che OneUptime conserva, come i token delle integrazioni e le password SMTP, e i token di accesso che emette. |
| `DATABASE_PASSWORD`, `CLICKHOUSE_PASSWORD`, `VALKEY_PASSWORD` | I tre datastore. |
| `REGISTER_PROBE_KEY` | La registrazione delle sonde presso la tua istanza. |
| `GLOBAL_PROBE_1_KEY`, `GLOBAL_PROBE_2_KEY` | Le sonde globali che Docker Compose può eseguire (`probe-1` è attiva per impostazione predefinita). |
| `ONEUPTIME_RUNNER_KEY` | Il Runner incluso. |

> [!IMPORTANT]
> Imposta i secret prima del primo avvio e poi non cambiarli. PostgreSQL prende la sua password solo quando crea il database, e cambiare `ENCRYPTION_SECRET` in seguito rende illeggibile ogni valore cifrato con quello vecchio.

### Avvia OneUptime

:::tabs
@tab npm
```bash
npm start
```
@tab Docker CLI
```bash
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)
```
:::

Il primo avvio richiede diversi minuti: Docker scarica le immagini e OneUptime crea i suoi database. `npm start` attende che ogni parte risponda e termina con **OneUptime is up!**

### Crea il primo account

Apri `http://` seguito dal tuo `HOST` (per esempio `http://localhost`) e registrati. Il primo account di una nuova istanza ne diventa l'amministratore principale, che può aprire l'Admin Dashboard su `/admin`.

Chiunque possa raggiungere la pagina può registrarsi dopo di te. Per impedirlo, apri l'Admin Dashboard, vai in **Impostazioni > Autenticazione** e disattiva **Consenti la registrazione**. Le persone che inviti in un progetto possono comunque creare il proprio account.
:::

## Configurare HTTPS

OneUptime serve HTTP semplice finché non scegli uno dei due modi per aggiungere HTTPS:

| | Lasciare che OneUptime ottenga un certificato | Usare il tuo reverse proxy |
| --- | --- | --- |
| **TLS termina su** | L'`ingress` di OneUptime, con un certificato Let's Encrypt gratuito che rinnova da solo | Il tuo proxy: Caddy, Nginx o un load balancer |
| **Ti serve** | Un nome di dominio pubblico che punti al server, e le porte 80 e 443 raggiungibili da Internet | Un proxy e un certificato per il tuo dominio |
| **Impostazioni** | `PROVISION_SSL=true`, `HTTP_PROTOCOL=https` | `PROVISION_SSL=false`, `HTTP_PROTOCOL=https`, `TRUSTED_PROXY_HOPS=2` |
| **Pagine di stato su domini personalizzati** | Funzionano senza altra configurazione | Il tuo proxy deve servire anche quei domini |

Se metti pagine di stato o dashboard su domini personalizzati, lasciare che OneUptime gestisca TLS è la configurazione più semplice: l'ingress ordina e serve da solo i certificati di quei domini.

### Lasciare che OneUptime ottenga un certificato

:::steps
#### Punta il tuo dominio al server

Crea un record DNS `A` (o `AAAA` per IPv6) per il tuo dominio, con l'indirizzo IP pubblico del server come valore.

#### Attiva l'ottenimento dei certificati

Imposta questi valori in `config.env`:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

`HOST` deve essere un nome di dominio: OneUptime non può ottenere un certificato per un indirizzo IP o per `localhost`.

#### Riavvia con le nuove impostazioni

```bash
npm start
```

#### Apri la tua istanza in HTTPS

Apri `https://oneuptime.example.com`. OneUptime ordina il certificato all'avvio e poi lo controlla ogni ora, rinnovandolo quando mancano meno di 30 giorni. Finché non arriva il primo certificato, di solito entro pochi minuti, l'ingress serve un certificato autofirmato temporaneo e il browser ti avvisa.
:::

### Usare il tuo reverse proxy

Questi passi eseguono il proxy sullo stesso server di OneUptime. Se il tuo proxy gira su un'altra macchina, salta il primo passo e punta il proxy alla porta 80 di questo server.

:::steps
#### Sposta l'ingress dalle porte 80 e 443

Il proxy ha bisogno delle porte 80 e 443, quindi sposta l'ingress su altre porte. La sonda e il Runner usano la rete dell'host e raggiungono OneUptime tramite `http://localhost`, quindi si spostano con lui:

```ini title="config.env"
ONEUPTIME_HTTP_PORT=8080
STATUS_PAGE_HTTPS_PORT=8443
GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080
ONEUPTIME_RUNNER_ONEUPTIME_URL=http://localhost:8080
```

#### Indica a OneUptime che è dietro un proxy

```ini title="config.env"
HOST=oneuptime.example.com
HTTP_PROTOCOL=https
PROVISION_SSL=false
TRUSTED_PROXY_HOPS=2
```

`HTTP_PROTOCOL=https` fa usare HTTPS ai link che OneUptime costruisce. `TRUSTED_PROXY_HOPS=2` conta il tuo proxy e l'ingress di OneUptime, così OneUptime legge l'indirizzo reale del visitatore per le allowlist IP e i limiti di frequenza. Aggiungine uno per ogni altro proxy che aggiunge voci a `X-Forwarded-For`, come una CDN o un load balancer.

#### Riavvia OneUptime sulle nuove porte

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)
bash Tests/Scripts/status-check.sh localhost:8080
```

`npm start` controlla `http://localhost` sulla porta 80, dove ci sarà il tuo proxy, quindi controlla tu la nuova porta. Lo script termina con **OneUptime is up!**

#### Configura il proxy

:::tabs
@tab Caddy
```text title="Caddyfile"
oneuptime.example.com {
	reverse_proxy localhost:8080
}
```
Caddy ottiene e rinnova il certificato da solo, reindirizza HTTP su HTTPS e fa passare le connessioni WebSocket. Ricarica Caddy dopo aver modificato il file, per esempio con `sudo systemctl reload caddy`.
@tab Nginx
```nginx title="/etc/nginx/conf.d/oneuptime.conf"
map $http_upgrade $oneuptime_connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name oneuptime.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name oneuptime.example.com;

    ssl_certificate     /etc/letsencrypt/live/oneuptime.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oneuptime.example.com/privkey.pem;

    # The limits OneUptime's own ingress uses.
    client_max_body_size 50M;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $oneuptime_connection_upgrade;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # MCP clients keep a stream open.
    location /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
I percorsi dei certificati sono quelli in cui Certbot mette un certificato Let's Encrypt; usa i percorsi del tuo certificato se viene da altrove. Controlla il file e ricarica Nginx con `sudo nginx -t && sudo systemctl reload nginx`.
:::

#### Apri la tua istanza tramite il proxy

Apri `https://oneuptime.example.com`. Dovresti vedere la pagina di accesso di OneUptime, servita con il certificato del tuo proxy.
:::

> [!NOTE]
> Dietro il tuo proxy, invia la telemetria tramite OTLP/HTTP (`/otlp`). OTLP su gRPC raggiunge OneUptime solo quando è il suo ingress a terminare TLS (`PROVISION_SSL=true`).

## Checklist per la produzione

Docker Compose esegue una sola copia di ogni servizio su un unico server, il che si adatta a team piccoli e homelab. Prima di affidartici, ripassa questa lista.

| Ambito | Cosa fare |
| --- | --- |
| **Secret** | Nessun valore in `config.env` è ancora un segnaposto `please-change-this-to-random-value`. Vedi [Genera secret casuali](#genera-secret-casuali). |
| **HTTPS** | OneUptime si raggiunge in HTTPS e `HTTP_PROTOCOL=https` è impostato. Vedi [Configurare HTTPS](#configurare-https). |
| **Registrazioni** | Quando il tuo team ha i suoi account, disattiva **Consenti la registrazione** in **Impostazioni > Autenticazione** nell'Admin Dashboard. |
| **Firewall** | Solo le porte 80 e 443 (e SSH) sono aperte verso Internet. PostgreSQL è pubblicato sulla porta 5400 per i backup: chiudila con il firewall del tuo provider cloud, perché le regole di `ufw` non si applicano alle porte che Docker pubblica. |
| **Backup** | PostgreSQL viene salvato ogni giorno e le copie lasciano il server. Vedi [Backup e ripristino](#backup-e-ripristino). |
| **E-mail** | Un server di posta è configurato in **Impostazioni > Notifiche > E-mail** nell'Admin Dashboard, così OneUptime può inviare inviti e notifiche. Vedi [SMTP](/docs/emails/smtp). |
| **Disco** | Lo spazio libero è tenuto d'occhio. ClickHouse cresce con la telemetria che conservi (vedi [Dimensionamento e pianificazione della capacità](/docs/installation/sizing)); il log di ogni container è limitato a 1000 MB. |
| **Aggiornamenti** | OneUptime viene aggiornato almeno una volta alla settimana. Le release escono spesso. Vedi [Aggiornare OneUptime](#aggiornare-oneuptime). |
| **Alta disponibilità** | Se ti serve, passa al [chart Helm](https://artifacthub.io/packages/helm/oneuptime/oneuptime) su Kubernetes. |

## Backup e ripristino

PostgreSQL contiene tutto ciò che configuri: monitor, incidenti, pagine di stato, utenti. `npm run backup` ne fa il dump in un file nella cartella `Backups`.

:::steps
### Dai allo script di backup la password del database

In `config.env`, imposta `DATABASE_BACKUP_PASSWORD` sul valore di `DATABASE_PASSWORD`. Lo script legge `config.env` come testo semplice, quindi il `${DATABASE_PASSWORD}` fornito non viene mai sostituito.

### Esegui il backup

```bash
npm run backup
```

Chiede la tua password di sudo e scrive `Backups/db-<day of the month>.backup`, così i backup giornalieri sostituiscono quelli di un mese prima. Eseguilo almeno una volta al giorno.

### Copia i backup fuori dal server

Un backup sullo stesso disco del database non sopravvive alla perdita di quel disco.
:::

ClickHouse conserva la tua telemetria nel volume Docker `oneuptime_clickhouse`, e nessuno script ne fa il backup. Se devi conservare quella telemetria, fai il backup del volume con uno strumento per ClickHouse come [clickhouse-backup](https://github.com/Altinity/clickhouse-backup), oppure copialo mentre OneUptime è fermo.

Per ripristinare PostgreSQL, imposta i valori `DATABASE_RESTORE_*` in `config.env`: `DATABASE_RESTORE_PASSWORD` sul valore di `DATABASE_PASSWORD`, come per i backup, e `DATABASE_RESTORE_FILENAME` sul backup da ripristinare, per esempio `db-31.backup`. Poi esegui `bash restore.sh`. Il database in cui ripristina deve già esistere; in un'installazione in funzione esiste.

> [!CAUTION]
> `restore.sh` elimina dal database di destinazione ogni oggetto presente nel backup prima di ricrearlo. Chiede conferma prima di iniziare; controlla il nome del database che mostra.

## Aggiornare OneUptime

Fai prima un backup, poi esegui:

```bash
git checkout release
git pull
npm run update
```

`npm run update` chiede la tua password di sudo, aggiunge al tuo `config.env` le nuove impostazioni di `config.example.env` (i tuoi valori restano), scarica le nuove immagini e riavvia OneUptime. Come `npm start`, termina con **OneUptime is up!**

Passare a una nuova versione major (dalla 13 alla 14, per esempio) può richiedere di più: leggi [Aggiornamento di OneUptime](/docs/installation/upgrading) prima di iniziare.

`APP_TAG=release` in `config.env` scarica sempre l'ultima release della Community Edition. Per restare su una versione, imposta `APP_TAG` sul suo numero, per esempio `14.0.22`. Per la Enterprise Edition, i tag sono `enterprise-release` e `enterprise-14.0.22`.

## Disinstallare OneUptime

Ferma OneUptime e rimuovi i suoi container e la sua rete:

```bash
npm run down
```

I tuoi dati restano nei volumi `oneuptime_postgres` e `oneuptime_clickhouse`, e la cartella `oneuptime` conserva `config.env` e i tuoi backup. Per eliminare anche i dati:

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose down --volumes --remove-orphans)
```

Poi elimina la cartella `oneuptime`.

> [!CAUTION]
> `--volumes` elimina per sempre ogni monitor, incidente, utente e tutta la telemetria. Fai prima un backup se potrebbe servirti qualcosa.

## Risoluzione dei problemi

:::details Docker dice "permission denied" quando esegui npm start
Il tuo utente non raggiunge il daemon di Docker. Aggiungilo al gruppo `docker`, poi esci e rientra:

```bash
sudo usermod -aG docker $USER
```
:::

:::details L'ingress non parte perché la porta 80 o 443 è occupata
Un altro programma sul server, spesso un web server, occupa la porta. Fermalo, oppure sposta l'ingress su altre porte e metti quel programma davanti a OneUptime come descritto in [Usare il tuo reverse proxy](#usare-il-tuo-reverse-proxy).
:::

:::details npm start termina con "Maximum retries reached"
Il controllo con cui termina `npm start` si è arreso prima che OneUptime rispondesse. Il primo avvio può durare più di quanto il controllo aspetti, mentre si scaricano le immagini e si creano i database. Guarda cosa è in esecuzione e leggi i log:

```bash
npm run ps
npm run logs
```

Quando ogni container è in esecuzione, ripeti il controllo con `npm run status-check`. Se hai spostato l'ingress dalla porta 80, controlla invece la sua nuova porta: `bash Tests/Scripts/status-check.sh localhost:8080`.
:::

:::details Alcune pagine si caricano, ma gli aggiornamenti in tempo reale o gli upload falliscono
Apri OneUptime all'indirizzo in `HOST`. L'ingress instrada le richieste in base al nome host: solo `HOST` e `localhost` raggiungono l'intera applicazione, e qualsiasi altro nome, come l'indirizzo IP del server, viene trattato come dominio di una pagina di stato. Imposta `HOST` sul nome che si usa, poi esegui `npm start`.
:::

:::details Il browser avvisa del certificato dopo che hai impostato PROVISION_SSL
Finché Let's Encrypt non emette il certificato, l'ingress serve un certificato autofirmato temporaneo. Se l'avviso resta per più di qualche minuto, controlla che:

- `HOST` sia un nome di dominio, non un indirizzo IP né `localhost`.
- Il record DNS del dominio punti a questo server.
- La porta 80 sia raggiungibile da Internet, così Let's Encrypt può validare il dominio.

Quando un ordine fallisce, l'app registra un errore che inizia con `CoreSSL:EnsurePrimaryHostCertificate`, seguito dal motivo:

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose logs app) | grep -A 5 CoreSSL
```
:::

:::details La sonda inclusa risulta Disconnesso dopo che hai spostato la porta dell'ingress
L'Admin Dashboard elenca la sonda in **Impostazioni > Monitoraggio > Sonde globali**. Raggiunge OneUptime su `GLOBAL_PROBE_1_ONEUPTIME_URL`, che per impostazione predefinita è `http://localhost` (porta 80). Impostalo sulla nuova porta dell'ingress, per esempio `http://localhost:8080`, imposta `ONEUPTIME_RUNNER_ONEUPTIME_URL` allo stesso modo e riavvia OneUptime.
:::

## Passi successivi

:::cards
- [Aggiornamento di OneUptime](/docs/installation/upgrading): Cosa ti chiede ogni versione major.
- [Dimensionamento e pianificazione della capacità](/docs/installation/sizing): Pianifica memoria e disco per la tua telemetria.
- [Architettura self-hosted](/docs/self-hosted/architecture): Come si incastrano i componenti.
- [Edizione Enterprise](/docs/self-hosted/enterprise): Cosa aggiunge l'immagine Enterprise, e la sua licenza.
:::
