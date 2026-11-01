# Controlli di aggiornamento e sicurezza

Una volta al giorno, un'installazione self-hosted di OneUptime chiede a GitHub se è uscita una versione più recente e se un avviso di sicurezza pubblicato da OneUptime riguarda la versione che esegui. Quando un avviso la riguarda, ai tuoi amministratori principali viene chiesto di aggiornare. Questa pagina spiega cosa invia il controllo, cosa vedi e come disattivarlo.

:::cards
- [Cosa invia il controllo](#cosa-invia-il-controllo): Due domande pubbliche, e nulla sulla tua installazione.
- [Cosa vedi](#cosa-vedi): Il piè di pagina, l'Admin Dashboard e un'email per ogni avviso.
- [Disattivare il controllo](#disattivare-il-controllo): Per una rete senza accesso a internet, o per usare un mirror.
:::

## Cosa invia il controllo

Il worker invia due richieste all'API di GitHub (`api.github.com`), senza token:

| Richiesta | Cosa chiede |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Qual è la release più recente di OneUptime |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Quali avvisi di sicurezza ha pubblicato OneUptime, le versioni che ciascuno riguarda e la release che lo corregge |

Non contengono nulla sulla tua installazione: né la versione che esegui, né il suo indirizzo, né nulla sui tuoi utenti, progetti o dati di monitoraggio. GitHub vede l'indirizzo IP pubblico del tuo server, come per qualsiasi richiesta, e l'intestazione `User-Agent`, che nomina OneUptime. È il tuo server a stabilire se un avviso riguarda la tua versione, e nessun browser chiama GitHub.

Il controllo viene eseguito all'avvio del worker e poi una volta al giorno. Torna a interrogare GitHub al massimo ogni 12 ore, e al massimo una volta all'ora dopo una richiesta non riuscita.

## Cosa vedi

Vengono informati solo gli amministratori principali. Sono loro a poter aggiornare, e dire a chiunque altro che il server esegue una versione con un problema di sicurezza noto indicherebbe un server senza patch.

- Una versione più recente aggiunge **Aggiornamento disponibile** al piè di pagina della Dashboard e dell'Admin Dashboard. Un clic apre la guida all'aggiornamento.
- Un avviso di sicurezza pubblicato che riguarda la versione che esegui aggiunge lì, al suo posto, **Aggiornamento di sicurezza**, in rosso.
- La prima pagina dell'Admin Dashboard elenca allora ogni avviso: la sua gravità, le versioni che riguarda, la release che lo corregge e un link all'avviso su GitHub. Indica anche quando il controllo ha letto gli avvisi l'ultima volta e, se l'ultimo controllo non è riuscito, perché.
- I tuoi amministratori principali e l'E-mail di notifica admin (**Impostazioni** > **E-mail** nell'Admin Dashboard) ricevono un'email per ogni avviso che riguarda la tua versione, e mai una seconda.

Tutto questo scompare non appena esegui una versione che nessun avviso riguarda. Per aggiornare, vedi [Aggiornamento](/docs/installation/upgrading).

## Disattivare il controllo

Su una rete senza accesso a internet, o se il tuo server non deve contattare GitHub, disattiva il controllo. A quel punto non viene mostrato né inviato via email nulla.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Imposta questo valore in `config.env`, poi esegui `npm start`.
:::

Per controllare invece un mirror all'interno della tua rete, punta il controllo verso di esso. Il mirror deve rispondere nei formati di GitHub.

| Valore Helm | Impostazione Docker Compose | Predefinito |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Quando GitHub non è raggiungibile

Su una rete senza accesso a internet una richiesta non riuscita è prevista, non è un errore. Il worker la registra a livello debug, conserva ciò che ha letto l'ultima volta e riprova più tardi. L'Admin Dashboard indica quando gli avvisi sono stati letti l'ultima volta e perché l'ultimo controllo non è riuscito: il limite di frequenza di GitHub, nessun percorso verso GitHub, un timeout o una risposta che non è di GitHub.

## Passaggi successivi

:::cards
- [Aggiornamento](/docs/installation/upgrading): Aggiorna a una versione più recente, una versione principale alla volta.
- [Architettura](/docs/self-hosted/architecture): Ogni connessione stabilita da un'installazione self-hosted di OneUptime.
- [Dietro una VPN o un firewall](/docs/self-hosted/behind-a-firewall): Cosa raggiunge il tuo server dall'esterno.
:::
