# Integrazione Twilio per SMS e chiamate vocali

OneUptime self-hosted utilizza il suo account Twilio per inviare avvisi tramite SMS e chiamate vocali. Il pagamento avviene direttamente a Twilio. Configuri le credenziali nella dashboard di OneUptime: l'invio delle notifiche legge la configurazione salvata e il chart Helm non include valori per le credenziali Twilio. Una migrazione precedente importava `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_PHONE_NUMBER`; modificare queste variabili non è il modo per aggiornare le credenziali di un'installazione esistente.

## 1. Preparare l'account Twilio

1. Apra la [console Twilio](https://console.twilio.com/) e recuperi **Account SID** e **Auth Token**.
2. Ottenga un numero di telefono Twilio con le funzionalità SMS e/o voce necessarie. Utilizzi il formato E.164, incluso il prefisso internazionale, per i numeri di mittente e destinatario.
3. Verifichi il saldo dell'account, le autorizzazioni per i paesi di destinazione e i requisiti applicabili di registrazione del mittente. Gli account di prova prevedono restrizioni sui destinatari, geografiche e di altro tipo che possono impedire il funzionamento di avvisi reali di OneUptime. Consulti la [documentazione Twilio sugli account e sulle prove](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) prima dei test. Utilizzi un account a pagamento in produzione.

## 2. Salvare le credenziali in OneUptime

Per un progetto:

1. Acceda a **Impostazioni progetto > Notifiche > Impostazioni notifiche**.
2. In **Configurazione Twilio**, selezioni **Crea configurazione Twilio**.
3. Inserisca un nome, **Twilio Account SID**, **Twilio Auth Token** e **Numero di telefono Twilio principale**. Facoltativamente, inserisca **Numeri di telefono Twilio secondari** per altri paesi, separati da virgole.
4. Attivi **Imposta come predefinita del progetto** per utilizzare questa configurazione per SMS e chiamate ai membri del progetto, incluse le notifiche di reperibilità. Creare una configurazione senza attivare questa opzione non la seleziona per tali notifiche.
5. Salvi. Una sola configurazione può essere quella predefinita del progetto. Le pagine di stato utilizzano la configurazione assegnata esplicitamente a ciascuna pagina.

Per una configurazione predefinita per l'intera installazione, un amministratore può invece aprire **Dashboard amministratore > Impostazioni > Chiamate e SMS**, modificare le credenziali e i numeri Twilio e salvare. Le notifiche ai membri utilizzano questa configurazione globale quando il loro progetto non ne ha una predefinita. Mantenga riservato l'Auth Token.

## 3. Configurare l'accesso alla rete

Un'installazione privata necessita di accesso HTTPS in uscita a Twilio per inviare richieste di SMS e chiamate. Twilio consiglia di consentire HTTPS in uscita verso `*.twilio.com`, poiché gli indirizzi delle sue API sono dinamici; consulti gli [indirizzi IP Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Applichi questa regola al traffico in uscita dell'applicazione OneUptime, comprese le NetworkPolicies Kubernetes e i firewall esterni.

L'accesso in ingresso dipende dalla funzionalità:

| Funzionalità | Twilio deve poter raggiungere OneUptime? |
| --- | --- |
| Invio di SMS | No. Gli aggiornamenti dello stato di consegna richiedono però un callback. |
| Semplice chiamata vocale di prova | No. OneUptime fornisce le istruzioni vocali insieme alla richiesta API in uscita. |
| Premere 1 per confermare un avviso di reperibilità | Sì. Twilio trasmette a OneUptime l'input del tastierino. |
| Criteri per le chiamate in ingresso | Sì. Twilio richiede le istruzioni di chiamata e comunica i risultati della composizione. |

Per i callback, segua la guida all'[accesso alla rete per Twilio e Microsoft Teams](/docs/self-hosted/integration-network-access) per pubblicare i percorsi HTTPS necessari tramite un ingress o un reverse proxy, mantenendo privata la dashboard. Una VPN sul portatile di un amministratore non fornisce connettività a Twilio.

Imposti `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` nel file `config.env` di Docker Compose, oppure `host: oneuptime.example.com` e `httpProtocol: https` nei valori Helm, quindi applichi la modifica alla distribuzione. Sostituisca l'esempio con il suo dominio. Queste impostazioni determinano gli URL generati; non creano record DNS, certificati o regole firewall. OneUptime non dispone di un'impostazione separata del nome host per i callback Twilio.

Di seguito sono riportati i percorsi esterni attraverso il gateway Nginx di OneUptime; i segnaposto variano per ogni notifica:

| Metodo | Percorso | Scopo |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Stato di consegna SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Conferma tramite tastierino |
| POST | `/notification/incoming-call/voice` | Istruzioni facoltative per chiamate in ingresso |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Risultati facoltativi dell'instradamento delle chiamate in ingresso |

OneUptime genera automaticamente gli URL per SMS e conferma. Non sostituisca i relativi token con un URL webhook statico. Per le chiamate in ingresso, segua la guida ai [criteri per le chiamate in ingresso](/docs/on-call/incoming-call-policy), che configura il webhook del numero quando viene associato un numero.

Twilio richiede [URL webhook raggiungibili pubblicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Utilizzi un certificato TLS pubblicamente attendibile e conservi host, protocollo, percorso, parametri di query, corpo e intestazione `X-Twilio-Signature` originali nel passaggio attraverso i proxy. I gestori delle chiamate in ingresso convalidano le firme Twilio; la consegna degli SMS utilizza un token URL per messaggio e la conferma tramite tastierino utilizza un token di query firmato. Non esponga i token in registri o screenshot condivisi. Consulti la [sicurezza dei webhook Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Verificare separatamente consegna e callback

1. Utilizzi **Invia SMS di prova** e **Invia chiamata di prova** nella configurazione Twilio del progetto. Confermi la ricezione sul telefono destinatario.
2. Configuri il contatto verificato dell'utente per SMS/chiamate e le regole di notifica, quindi attivi un avviso di reperibilità controllato. Prema 1 e verifichi la conferma in OneUptime.
3. Verifichi lo stato di consegna dell'SMS in OneUptime e nei registri dei messaggi Twilio. Un invio accettato non dimostra la consegna; [Twilio comunica le modifiche di stato successive tramite callback](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Se l'invio non riesce, controlli credenziali, funzionalità del numero, restrizioni dell'account e connettività in uscita. Se un messaggio o una chiamata arriva ma lo stato o la conferma non si aggiorna, esamini l'URL del callback e i registri dell'ingress pubblico. La [guida Twilio agli errori di recupero HTTP](https://www.twilio.com/docs/api/errors/11200) aiuta a diagnosticare callback irraggiungibili, problemi TLS ed errori HTTP. Una chiamata di prova riuscita, da sola, non verifica l'accesso dei callback.
