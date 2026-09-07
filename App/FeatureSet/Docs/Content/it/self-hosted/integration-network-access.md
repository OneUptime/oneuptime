# Accesso alle integrazioni da reti private

Un'istanza OneUptime self-hosted può inviare richieste a Twilio e Microsoft pur rimanendo irraggiungibile dai loro servizi cloud. La connessione VPN di un dipendente non concede a nessuno dei due fornitori l'accesso alla rete privata. Utilizzi la [guida alla configurazione Twilio](/docs/self-hosted/twilio-integration) e la [guida alla configurazione Teams](/docs/self-hosted/microsoft-teams-integration) insieme ai passaggi di rete riportati di seguito.

## In quale direzione serve l'accesso?

| Funzionalità | Da OneUptime al fornitore | Dal fornitore a OneUptime |
| --- | --- | --- |
| Inviare un SMS o riprodurre un semplice avviso vocale in uscita | HTTPS | Non necessario per inviare l'SMS o riprodurre istruzioni vocali fornite direttamente |
| Aggiornamenti di consegna SMS, azioni del tastierino vocale, instradamento delle chiamate in ingresso | HTTPS | Callback obbligatori; consultare i percorsi nella guida Twilio |
| Notifiche Teams | HTTPS verso le API Microsoft | Necessario per l'integrazione completa del bot, incluso il rilevamento delle conversazioni |
| Comandi Teams, pulsanti delle schede, eventi di installazione nelle chat | HTTPS | `POST /api/microsoft-bot/messages` |

Le [impostazioni di accesso alle reti private](/docs/self-hosted/private-network-access) controllano le richieste in uscita di OneUptime verso servizi interni. Abilitare `ALLOW_PRIVATE_NETWORK_WEBHOOKS` non rende OneUptime raggiungibile da Twilio o Teams.

## Produzione: pubblicare un gateway verso l'installazione privata

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Gateway pubblico (reverse proxy o bilanciatore di carico)
          | Connessione privata; solo percorsi di callback
          v
Ingress OneUptime privato -> Applicazione OneUptime
```

1. **Scelga un nome host**, ad esempio `oneuptime.example.com`. Pubblichi record DNS pubblici che puntino a un gateway esposto a Internet. I fornitori non possono raggiungere indirizzi IP privati e nomi DNS esclusivamente interni. Con DNS separato, i dipendenti possono risolvere lo stesso nome host verso l'ingress privato e continuare a utilizzare la dashboard tramite VPN. Anche l'ingress privato deve servire HTTPS con un certificato valido per quel nome host.
2. **Colleghi il gateway a OneUptime.** Lo collochi in una DMZ con una rotta verso l'ingress privato, oppure utilizzi un gateway pubblico collegato attraverso la propria VPN site-to-site o connessione privata. Consenta il traffico dal gateway all'ingress sulla porta del servizio a monte. Per Kubernetes/Portainer, un servizio privato `ClusterIP` da solo non basta: il gateway necessita di un ingress/controller o di un'altra destinazione raggiungibile. Mantenga privati database e altri servizi interni.
3. **Termini HTTPS sulla porta 443** con un certificato pubblicamente attendibile e una catena intermedia completa. Consenta TCP in ingresso sulla porta 443 del gateway. Installare un certificato o modificare il DNS non crea da solo la rotta verso la destinazione privata.
4. **Inoltri soltanto i percorsi di callback richiesti** dalla tabella della guida Twilio e `/api/microsoft-bot/messages` per Teams. Li instradi attraverso l'ingress di OneUptime, che già associa `/notification` all'applicazione. Conservi metodo, percorso originale, stringa di query, corpo, `Authorization` e `X-Twilio-Signature`. Conservi l'`Host` pubblico e imposti intestazioni attendibili `X-Forwarded-Host` e `X-Forwarded-Proto: https` nel gateway. Non rimuova `/api` e non aggiunga reindirizzamenti. Neghi gli altri percorsi sul gateway pubblico; i dipendenti possono usare l'ingress privato per dashboard e callback di accesso tramite browser.
5. **Mantenga intatta l'autenticazione dei callback.** Esenti questi percorsi da SSO del browser, CAPTCHA e pagine di accesso del proxy, perché i fornitori non possono completarli. OneUptime continua a convalidare i propri token di callback, le firme Twilio nei percorsi delle chiamate in ingresso e l'autenticazione Bot Framework. Non rimuova tali controlli. Consenta l'accesso all'origine soltanto dal gateway e dai client interni autorizzati e oscuri i token di callback nei registri. Twilio descrive questa [architettura proxy in DMZ e la sicurezza dei webhook](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Imposti l'URL canonico di OneUptime** prima di configurare una delle integrazioni:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valori Helm/Portainer:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Queste impostazioni controllano gli URL generati; non configurano DNS, TLS o accesso attraverso il firewall. Applichi la configurazione Compose o l'aggiornamento della release Helm e attenda il riavvio dell'applicazione. OneUptime non offre un nome host separato per i callback Twilio. Se il nome host cambia, aggiorni i webhook esistenti dei numeri telefonici Twilio, l'endpoint di messaggistica Azure Bot e gli URI di reindirizzamento della registrazione dell'app, quindi scarichi e carichi nuovamente il manifesto Teams.

## Accesso in uscita e restrizioni IP

Consenta la risoluzione DNS e HTTPS in uscita dall'applicazione OneUptime. Twilio consiglia l'accesso a `*.twilio.com`, poiché gli indirizzi delle sue API cambiano; consulti le [indicazioni Twilio sugli indirizzi IP](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams utilizza `graph.microsoft.com`, `login.microsoftonline.com`, gli endpoint di autenticazione/canale Bot Framework e l'URL del servizio connettore della conversazione. Utilizzi le [indicazioni Microsoft sui firewall](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) ed esamini il traffico bloccato durante i test; questi esempi non sono un elenco completo di domini.

Non utilizzi gli intervalli SIP/multimediali Twilio o quelli multimediali dei client Teams come elenchi di origini consentite per i webhook. Gli indirizzi dei normali webhook Twilio sono dinamici; le edizioni Twilio idonee offrono [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), che richiede una configurazione separata con Twilio. Le indicazioni Microsoft sui firewall avvertono che gli elenchi fissi di IP consentiti in ingresso per Bot Framework non sono supportati. Autentichi i callback nell'applicazione, senza presumere che un IP di origine fisso ne stabilisca l'identità.

## Test e installazioni senza accesso in ingresso

Da una rete esterna alla VPN, verifichi DNS pubblico e TLS, quindi controlli il percorso Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Nelle versioni attuali di OneUptime, la risposta prevista è `405 Method Not Allowed` con `Allow: POST`. Questo conferma che la richiesta GET ha raggiunto il percorso, non che una richiesta POST autenticata del bot funzionerà. Le versioni precedenti possono restituire l'errore JSON 404 di OneUptime; esamini il corpo della risposta e i registri del proxy. Errori TLS, timeout o una pagina di errore HTML del proxy indicano problemi di certificato o instradamento.

Una richiesta GET del browser non prova un callback POST Twilio. Invii un vero SMS di test, controlli l'aggiornamento della consegna, risponda a una chiamata di incidente di prova e usi l'azione del tastierino; quindi invii un messaggio al bot Teams e prema un pulsante di una scheda. Confronti la diagnostica di consegna del fornitore con i registri del gateway e dell'applicazione, oscurando i token. La sola consegna in uscita riuscita non dimostra il funzionamento dei callback.

Per lo sviluppo, Twilio documenta i [test attraverso un tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview) e Microsoft il [debug locale di Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Inoltri un tunnel HTTPS pubblico verso un proxy che consenta soltanto i percorsi richiesti, configuri il nome host risultante come sopra e arresti il tunnel dopo i test. Un tunnel espone comunque un endpoint in ingresso; non rende l'installazione fisicamente isolata dalla rete.

Se i criteri vietano tutta la connettività in ingresso, l'invio di SMS e la riproduzione vocale semplice con istruzioni fornite direttamente possono continuare a funzionare tramite HTTPS in uscita. Non possono invece funzionare callback di consegna, azioni del tastierino, instradamento delle chiamate in ingresso e integrazione completa del bot Teams. Gli endpoint privati Azure Bot per Direct Line non risolvono la connettività Teams: la [guida Microsoft all'isolamento di rete](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) afferma che disabilitare l'accesso pubblico rimuove gli altri canali, incluso Teams. Un'installazione completamente disconnessa non può utilizzare queste integrazioni cloud.
