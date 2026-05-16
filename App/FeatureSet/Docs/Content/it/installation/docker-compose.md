# Distribuisci OneUptime gratuitamente con Docker Compose

Se preferisci ospitare OneUptime sul tuo server, puoi usare Docker Compose per distribuire un'istanza su singolo server di OneUptime su Debian, Ubuntu o RHEL. Questa opzione ti offre maggiore controllo e personalizzazione sulla tua istanza, ma richiede anche più competenze tecniche e risorse per la distribuzione e la manutenzione.

#### Scegli i Requisiti di Sistema

A seconda del tuo utilizzo e del tuo budget, puoi scegliere tra diversi requisiti di sistema per il tuo server. Per prestazioni ottimali, suggeriamo di usare OneUptime con:

- **Requisiti di Sistema Consigliati**
  - 16GB RAM
  - 8 Core
  - 400 GB Disco
  - Ubuntu 22.04
  - Docker e Docker Compose installati
- **Homelab / Requisiti Minimi**
  - Se vuoi eseguire OneUptime per uso personale o sperimentale in un ambiente domestico (alcuni dei nostri utenti lo hanno persino installato su RaspberryPi), puoi usare i requisiti homelab:
    - 8 GB RAM
    - 4 Core
    - 20 GB Disco
    - Docker e Docker Compose installati


#### Prerequisiti per la Distribuzione su Singolo Server

Tutorial di installazione: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Prima di iniziare il processo di distribuzione, assicurati di avere:

- Un server che esegue Debian, Ubuntu o un derivato RHEL
- Docker e Docker Compose installati sul tuo server

Per installare OneUptime: 

```
# Clona questo repo solo con il branch release e spostati nella directory.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copia config.example.env in config.env
cp config.example.env config.env

# IMPORTANTE: Modifica il file config.env. Assicurati di avere segreti casuali.

npm start
```

Se non vuoi usare npm o non lo hai installato, esegui invece questo: 

```
# Leggi le variabili d'ambiente dal file config.env ed esegui docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Usa sudo se hai problemi di permessi con il binding delle porte. 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Accesso a OneUptime

OneUptime dovrebbe essere in esecuzione su: http://localhost. Devi registrare un nuovo account per la tua istanza per iniziare a usarla.

### Configurazione dei Certificati TLS/SSL

OneUptime **non** supporta la configurazione di certificati SSL/TLS. Devi configurare i certificati SSL/TLS autonomamente.

Se devi usare certificati SSL/TLS, segui questi passaggi:

1. Usa un reverse proxy come Nginx o Caddy.
2. Usa Let's Encrypt per ottenere i certificati.
3. Punta il reverse proxy al server OneUptime.
4. Aggiorna le seguenti impostazioni:
   - Imposta la variabile d'ambiente `HTTP_PROTOCOL` su `https`.
   - Cambia la variabile d'ambiente `HOST` con il nome di dominio del server dove è ospitato il reverse proxy.

## Checklist per la Produzione

Idealmente non distribuire OneUptime in produzione con docker-compose. Raccomandiamo vivamente di usare Kubernetes. È disponibile un chart Helm per OneUptime [qui](https://artifacthub.io/packages/helm/oneuptime/oneuptime). 

Se vuoi comunque distribuire OneUptime in produzione con docker-compose, considera quanto segue:

- **SSL/TLS**: Configura i certificati SSL/TLS. OneUptime non supporta la configurazione di certificati SSL/TLS. Devi configurarli autonomamente. Vedi sopra. 
- **Segreti**: Assicurati di avere segreti casuali nel file `config.env`. Ci sono alcuni segreti predefiniti in quel file. Sostituiscili con stringhe lunghe e casuali. 
- **Backup**: Esegui regolarmente il backup dei tuoi database (Clickhouse, Postgres). Redis è usato come cache ed è stateless, può essere tranquillamente ignorato. 
- **Aggiornamenti**: Aggiorna regolarmente OneUptime. Rilasciamo aggiornamenti ogni giorno. Raccomandiamo di aggiornare il software almeno una volta a settimana se sei in produzione. 

### Aggiornamento di OneUptime

Per aggiornare: 

```
git checkout release # Assicurati di essere sul branch release.
git pull
npm run update
```

### Considerazioni

- Nella nostra configurazione Docker, utilizziamo un driver di logging locale. OneUptime, in particolare all'interno dei container probe e ingest, genera una quantità sostanziale di log. Per evitare che il tuo storage si esaurisca, è fondamentale limitare lo storage di logging in Docker. Per istruzioni dettagliate su come farlo, consulta la documentazione ufficiale di Docker [qui](https://docs.docker.com/config/containers/logging/local/).


### Disinstallazione di OneUptime

Per disinstallare OneUptime, esegui il seguente comando:

```
npm run down
```

Questo fermerà e rimuoverà tutti i container, le reti e i volumi creati da OneUptime. Non rimuoverà il file `config.env` né il repository clonato.
