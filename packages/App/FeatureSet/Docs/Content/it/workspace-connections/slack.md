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

Come **Invia prova** accanto a un canale in **Impostazioni del progetto** > **Workspace** > **Slack**, serve il permesso di creare regole di notifica: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** o **Create Workspace Notification Rule** in un ruolo personalizzato. Chi può soltanto vedere le regole, come un **Viewer**, viene avvisato che non ha il permesso di inviare notifiche di prova. Su OneUptime Cloud, provare una regola richiede il piano **Growth**, come aggiungerne una.

## Accesso alla rete per le installazioni self-hosted

Per le connessioni in uscita, i callback in ingresso e le installazioni private, consultare la sezione sull’accesso alla rete della [Integrazione Slack](/docs/self-hosted/slack-integration).
