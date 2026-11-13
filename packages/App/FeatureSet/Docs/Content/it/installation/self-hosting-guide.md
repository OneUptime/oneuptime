# Guida al self-hosting

Segui questa pagina dall'alto in basso per passare da un server vuoto al tuo OneUptime, che funziona in HTTPS, ti ha inviato un'email di prova e può avvisarti. Ogni passaggio finisce con il modo per capire che ha funzionato, e rimanda alle pagine più lunghe per i dettagli.

:::cards
- [Installare OneUptime](#installare-oneuptime): Docker Compose su un server, oppure il chart Helm su Kubernetes.
- [Completare la configurazione del server](#completare-la-configurazione-del-server): L'email, poi SMS e chiamate, ciascuno con una prova.
- [Controllare l'installazione](#controllare-linstallazione): Un comando che dice cosa non va.
- [Guida rapida](/docs/introduction/quickstart): Il tuo primo monitor, la prima policy di reperibilità e la prima pagina di stato.
:::

## Cosa ti serve

- **Un server.** Per Docker Compose, un server Linux con 8 GB di memoria, 4 core e 20 GB di disco per provare OneUptime, oppure 16 GB, 8 core e 400 GB per un team: vedi [Dimensionamento e pianificazione della capacità](/docs/installation/sizing). Per il chart Helm, un cluster Kubernetes.
- **Un nome di dominio** con cui si aprirà OneUptime, come `oneuptime.example.com`, con un record DNS `A` che punta al server. Puoi iniziare con l'indirizzo IP del server, ma un certificato di Let's Encrypt richiede un nome di dominio.
- **Le porte 80 e 443** raggiungibili da internet, per HTTPS.
- **Un modo per inviare email**: un server di posta, come quello della tua azienda, Microsoft 365 o Google Workspace, oppure un account su Amazon SES, SendGrid, Mailgun, Postmark o Resend.
- **Un account Twilio**, per essere avvisato via SMS e telefonata. Email e notifiche push non ne hanno bisogno.

**Ha funzionato quando** `dig +short oneuptime.example.com` stampa l'indirizzo IP del server.

## Installare OneUptime

:::tabs
@tab Docker Compose
Su un server nuovo con Ubuntu, Debian o una distribuzione basata su RHEL, un solo comando installa Docker, Git e Node.js dove mancano, clona OneUptime in una cartella `oneuptime`, chiede l'indirizzo che verrà usato e lo avvia:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Per fare lo stesso a mano, con Docker, Git e Node.js installati:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Apri `config.env` e imposta `HOST`, la sua prima impostazione, sul tuo nome di dominio o indirizzo IP, senza `http://`. È l'unica impostazione che devi cambiare: email, SMS e chiamate si configurano nell'Admin Dashboard, e tutto ciò che sta sotto `ADVANCED` funziona così com'è. Poi avvia OneUptime:

```bash
npm start
```

**Ha funzionato quando** `npm start` termina con **OneUptime is up!** e l'indirizzo da aprire. Il primo avvio richiede alcuni minuti, mentre Docker scarica le immagini. Se `npm start` si ferma prima, dice cosa cambiare. [Docker Compose](/docs/installation/docker-compose) ha tutti i dettagli.
@tab Kubernetes
Crea un `values.yaml` con il tuo nome di dominio o indirizzo IP, senza `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Il chart tiene i suoi dati sulla storage class predefinita del cluster. Se `kubectl get storageclass` non ne segna nessuna come `(default)`, aggiungi `global.storageClass` con il nome di una di esse. Poi installa il chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Ha funzionato quando** `kubectl get pods` mostra ogni pod `Running` e l'indirizzo stampato da `helm install` apre OneUptime. La [guida all'installazione del chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) ha tutti i dettagli.
:::

## Attivare HTTPS

Quando il tuo nome di dominio punta al server, lascia che OneUptime ottenga un certificato gratuito da Let's Encrypt. Rinnova il certificato da solo.

:::tabs
@tab Docker Compose
Imposta questi valori in `config.env`, poi esegui di nuovo `npm start`:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Hai già un reverse proxy, come Caddy, Nginx o un bilanciatore di carico? Lascia `PROVISION_SSL=false`, imposta `HTTP_PROTOCOL=https` e `TRUSTED_PROXY_HOPS=2`, e leggi [Usare il tuo reverse proxy](/docs/installation/docker-compose#usare-il-tuo-reverse-proxy).
@tab Kubernetes
Imposta questi valori in `values.yaml`, poi applicali:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Per terminare TLS su un tuo ingress controller, lascia `ssl.provision` disattivato e imposta solo `httpProtocol: https`.
:::

**Ha funzionato quando** `https://oneuptime.example.com` si apre senza avvisi sul certificato. Il primo certificato di solito arriva in pochi minuti. Stai provando OneUptime su `localhost`? Salta questo passaggio: un certificato richiede un nome di dominio.

## Creare l'account amministratore

Apri il tuo indirizzo, come `https://oneuptime.example.com`, e registrati. Il primo account di un server nuovo ne diventa l'amministratore principale, che può aprire l'Admin Dashboard su `/admin`.

**Ha funzionato quando** `/admin` apre l'Admin Dashboard. Finché email, HTTPS o la scelta sulle registrazioni restano in sospeso, si apre su **Completa la configurazione di questo server**.

## Completare la configurazione del server

La pagina **Configurazione del server** dell'Admin Dashboard, su `/admin/setup`, elenca ciò che serve a un server nuovo, prima il più importante. Email, HTTPS e chi può registrarsi sono obbligatori. SMS e chiamate, una sonda globale, i backup e i controlli degli aggiornamenti sono consigliati. Ogni voce ha un pulsante che apre il punto in cui si imposta, e `npm start` termina stampando l'indirizzo di questa pagina.

:::steps
### Configurare l'email

Fai clic su **Configura l'email**. Apre **Impostazioni > Notifiche > Email**, dove inserisci il tuo server di posta (la maggior parte usa la porta `587`) o il tuo provider di email, e l'indirizzo da cui partono le email. Salva, poi fai clic su **Invia email di prova** e mandane una a te stesso.

**Ha funzionato quando** l'email arriva e la checklist segna l'email come fatta. Se la prova non riesce, mostra cosa ha risposto il server di posta: vedi [SMTP](/docs/emails/smtp#risoluzione-dei-problemi).

### Scegliere chi può registrarsi

Chiunque possa aprire il tuo indirizzo può registrarsi. Quando il tuo team ha i suoi account, disattiva **Consenti la registrazione** in **Impostazioni > Autenticazione**: chi inviti in un progetto può comunque entrare. Per lasciare aperte le registrazioni, fai clic su **Lascia aperte le registrazioni**.

**Ha funzionato quando** la checklist segna le registrazioni come fatte.

### Configurare SMS e chiamate, oppure usare solo email e push

Per essere avvisato via SMS e telefonata, fai clic su **Configura SMS e chiamate** e aggiungi il tuo account Twilio in **Impostazioni > Notifiche > Chiamate e SMS**: [Integrazione Twilio](/docs/self-hosted/twilio-integration) mostra dove trovare ogni valore. Poi fai clic su **Invia SMS di prova** e **Fai una chiamata di prova**. Per inviarli invece tramite un tuo gateway, vedi [Gateway per SMS e chiamate](/docs/self-hosted/sms-and-call-gateway). Se email e notifiche push bastano, fai clic su **Usa solo email e notifiche push**.

**Ha funzionato quando** l'SMS arriva e il telefono squilla, oppure la checklist mostra la tua scelta.
:::

La voce HTTPS è fatta appena [Attivare HTTPS](#attivare-https) funziona, e ogni voce consigliata dice cosa fare.

## Controllare l'installazione

:::tabs
@tab Docker Compose
Nella cartella `oneuptime`, esegui il doctor:

```bash
npm run doctor
```

Controlla ogni container, `config.env`, che `HOST` raggiunga questo server, il certificato e lo spazio libero su disco, e chiede a OneUptime cosa vede di sé, come l'email e le sonde. Ogni problema arriva con la sua soluzione: vedi [Controllare l'installazione](/docs/installation/docker-compose#controllare-linstallazione).
@tab Kubernetes
Esegui lo script di diagnostica del chart sul tuo cluster, come mostra la [guida alla risoluzione dei problemi del chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it). Legge soltanto, e termina con un riepilogo di ciò che ha trovato, prima il più grave.
:::

**Ha funzionato quando** il doctor termina con **Everything looks right.** ed esce con `0`. Esce con `1` quando c'è qualcosa da sistemare, e con `2` quando non è riuscito a fare i suoi controlli. Su Kubernetes, il riepilogo non ha alcun risultato `CRITICAL`.

## Monitorare qualcosa ed essere avvisati

Il tuo server ora può inviare email e avvisare le persone. La [Guida rapida](/docs/introduction/quickstart) prosegue nel prodotto: un monitor per il tuo sito, una policy di reperibilità che ti avvisa quando va giù e una pagina di stato, in circa quindici minuti. L'ultima parte dichiara un incidente di prova, così vedi arrivare l'avviso.

## Risoluzione dei problemi

:::details npm start si ferma e dice che HOST non è ancora un indirizzo
`HOST` in `config.env` contiene ancora un segnaposto, come `<your-address>`. Impostalo sul tuo nome di dominio o indirizzo IP, senza `http://`, ed esegui di nuovo `npm start`.
:::

:::details L'email di prova non riesce
Il messaggio sotto il pulsante è ciò che ha risposto il server di posta. Controlla il nome host, la porta, il nome utente e la password, e che il server di posta ti lasci inviare dall'indirizzo da cui partono le email. Vedi [SMTP](/docs/emails/smtp#risoluzione-dei-problemi).
:::

:::details Il browser avvisa sul certificato
Let's Encrypt ha bisogno delle porte 80 e 443 raggiungibili da internet, e del tuo nome di dominio che punta a questo server. Aspetta qualche minuto, poi esegui `npm run doctor`: controlla il certificato e dice cosa non va.
:::

## Passi successivi

:::cards
- [Guida rapida](/docs/introduction/quickstart): Un monitor, una policy di reperibilità e una pagina di stato in quindici minuti.
- [Docker Compose](/docs/installation/docker-compose): Il tuo proxy, i backup, gli aggiornamenti e la checklist per la produzione.
- [Aggiornamento](/docs/installation/upgrading): Passare a una nuova release, una versione principale alla volta.
- [Architettura](/docs/self-hosted/architecture): Come si incastrano le parti di OneUptime.
:::
