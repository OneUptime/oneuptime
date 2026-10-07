# Connettere OneUptime a Slack

### Passi per Connettere OneUptime a Slack

1. **Creare un Account su OneUptime**

   - Visitare [OneUptime.com](https://oneuptime.com) e creare un account.
   - Una volta creato l'account, creare un nuovo progetto.

2. **Connettere Slack al Progetto OneUptime**

   - Navigare a **Impostazioni del progetto** > **Slack** nel proprio progetto OneUptime.
   - Seguire le istruzioni per connettere il proprio account Slack al progetto OneUptime.

3. **Configurare le Notifiche degli Incidenti**

   - Dopo aver connesso l'account Slack, accedere a **Pagina Incidenti** > **Slack**.
   - Aggiungere regole per inviare notifiche degli incidenti a Slack. Ad esempio, è possibile creare una regola che crea un nuovo canale Slack e invita i responsabili degli incidenti quando viene creato un incidente.

4. **Configurare le Notifiche di Avvisi e Manutenzioni Programmate**
   - Regole simili possono essere applicate agli Avvisi e alle Manutenzioni Programmate navigando alle rispettive pagine e configurando le regole desiderate.

## Provare una regola

**Regola di test** sulla riga di una regola pubblica un messaggio di prova di quella regola nei canali che indica, così puoi vederlo arrivare. Se la regola crea un canale per ogni evento, anche la prova ne crea uno e vi invita le persone della regola.

Come **Invia prova** accanto a un canale in **Impostazioni del progetto** > **Workspace** > **Slack**, serve il permesso di creare regole di notifica: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** o **Create Workspace Notification Rule** e **Read Workspace Notification Rule** in un ruolo personalizzato. Per chi può soltanto vedere le regole, come un **Viewer**, **Regola di test** è bloccato e il suo suggerimento dice cosa serve; l'API rifiuta la sua prova con "You do not have permission to send test notifications in this project." Su OneUptime Cloud, provare una regola richiede il piano **Growth**, come aggiungerne una.

Su OneUptime Cloud, anche **Invia prova** accanto a un canale richiede il piano **Growth**, perché pubblicare in un canale è ciò che fanno regole e riepiloghi. **Invia prova ora** su un riepilogo richiede il permesso di creare riepiloghi (**Create Workspace Notification Summary** e **Read Workspace Notification Summary** in un ruolo personalizzato) e, su OneUptime Cloud, il piano **Growth**; per chiunque altro è bloccato e il suo suggerimento dice cosa serve. Un client MCP collegato con accesso in sola lettura non può inviare alcuna prova.

## Riepiloghi

La scheda **Summary** di **Incidenti** > **Workspace** > **Slack** (e quella di **Avvisi**) pubblica un riepilogo periodico nei canali che indichi: quanti incidenti o avvisi ci sono stati, quanto rapidamente sono stati confermati e risolti, e un elenco con i link. Un nuovo riepilogo viene inviato ogni settimana e copre gli ultimi 7 giorni. Lascia vuoto **Invia il primo report alle** e il primo viene inviato alle 09:00 all'inizio della prossima settimana, del prossimo giorno o mese; il modulo indica quando.

Un riepilogo segue l'orologio del suo **Fuso orario**, che all'inizio è il tuo. Lì mantiene la sua ora tutto l'anno: uno impostato per le 09:00 a Berlino continua a partire alle 09:00, ora di Berlino, dopo il cambio dell'ora, e anche le date del suo messaggio sono quelle di Berlino. Tramite l'API, invia `timezone` come nome di fuso orario IANA, ad esempio `Europe/Berlin`. Un riepilogo creato senza fuso orario prende quello del profilo di chi lo crea, oppure UTC quando lo crea una chiave API.

## Accesso alla rete per le installazioni self-hosted

Per le connessioni in uscita, i callback in ingresso e le installazioni private, consultare la sezione sull’accesso alla rete della [Integrazione Slack](/docs/self-hosted/slack-integration).
