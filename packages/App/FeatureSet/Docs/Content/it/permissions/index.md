# Utenti, team e autorizzazioni

Tutto in OneUptime vive dentro un **progetto**. Chi può fare cosa in quel progetto dipende da tre cose: gli **utenti** che ne fanno parte, i **team** a cui appartengono e le **autorizzazioni** concesse a quei team.

La regola che spiega quasi tutto: **gli utenti non possiedono mai autorizzazioni direttamente.** L'accesso di un utente è l'unione delle autorizzazioni di tutti i team a cui appartiene in quel progetto. Per cambiare ciò che qualcuno può fare, si cambia la sua appartenenza a un team oppure le autorizzazioni di quel team.

I **proprietari** sono un'idea diversa. Un proprietario è chi è responsabile di una risorsa specifica: un monitor, un incidente, una dashboard. I proprietari vengono avvisati riguardo alle loro risorse, e le autorizzazioni possono facoltativamente essere ristrette a «solo le cose che possiedo».

## Il modello a colpo d'occhio

```text
Progetto
  └── Team                         ← qui vengono agganciate le autorizzazioni
       ├── Autorizzazioni concesse ← ciascuna con un ambito: Tutte / Possedute / Etichette
       ├── Autorizzazioni bloccate ← prevalgono sempre su quelle concesse
       └── Membri del team         ← utenti che hanno accettato l'invito
```

| Concetto | Che cos'è |
| --- | --- |
| Utente | Un singolo account OneUptime. Un accesso, un numero qualsiasi di progetti. |
| Progetto | Il confine del tenant. Monitor, incidenti, team e dati appartengono a un solo progetto. |
| Team | Un gruppo con un nome all'interno di un progetto, che porta le autorizzazioni. |
| Membro del team | Un utente invitato in un team che ha accettato. |
| Autorizzazione | Una singola capacità, p. es. `CreateProjectMonitor`, o un ruolo che ne raggruppa molte, p. es. `MonitorAdmin`. |
| Ambito | Fin dove arriva un'autorizzazione concessa: tutte le risorse, solo quelle possedute o solo quelle etichettate. |
| Proprietario | Un utente o un team indicato come responsabile di una risorsa specifica. |
| Etichetta | Un contrassegno applicato alle risorse, usato per limitare le autorizzazioni e per organizzare. |

## Utenti

Un account utente è globale all'istanza OneUptime: lo stesso accesso funziona in ogni progetto a cui l'utente è stato invitato.

Un utente è «dentro» un progetto quando è membro di **almeno un team** al suo interno. Non esiste un passaggio separato «aggiungi utente al progetto»: invitare qualcuno in un progetto significa invitarlo in un team.

- Gli inviti creano un membro del team in attesa. L'utente conta come membro del progetto — e ottiene una qualsiasi autorizzazione — **solo dopo aver accettato l'invito.**
- Rimuovere un utente da tutti i team di un progetto gli toglie l'accesso a quel progetto.
- Chi lascia un progetto smette di riceverne le notifiche. I suoi metodi, regole e impostazioni di notifica per il progetto vengono rimossi insieme all'ultimo team — email, SMS, chiamata, WhatsApp, Telegram, push, webhook, Slack e Microsoft Teams, il riepilogo email e l'email non ancora inviata, il numero per le chiamate in arrivo e i promemoria dei turni —, quindi chi rientra riparte dalle impostazioni predefinite. Ciò che lo nomina ancora, come l'utente chiamato da una regola delle chiamate in arrivo o un proprietario mantenuto su un incidente risolto, non lo notifica più: nulla viene inviato per conto di un progetto a chi non ne è membro, e un invito in sospeso non è ancora un'appartenenza. Questi punti mostrano **Non è più membro** accanto al nome, così puoi mettere qualcun altro. Chi è stato invitato e non ha ancora accettato mostra invece **Invito non ancora accettato**.
- Se il progetto impone l'SSO e un utente non si è ancora autenticato tramite l'identity provider, viene trattato come utente SSO non autorizzato e non vede nulla finché non lo fa. Vedi [SSO](/docs/identity/sso).
- Con SCIM configurato, l'identity provider può creare, aggiornare e rimuovere automaticamente utenti e loro appartenenze ai team. Vedi [SCIM](/docs/identity/scim).

Dove trovarlo: **Impostazioni → Utenti** elenca tutte le persone del progetto e il loro stato di invito.

## Team

I team sono il modo in cui le autorizzazioni arrivano alle persone. Ogni nuovo progetto ne ha tre fin dall'inizio:

| Team | Autorizzazione che detiene | Modificabile |
| --- | --- | --- |
| Owners | `ProjectOwner` | No. Ha sempre almeno un membro. |
| Admin | `ProjectAdmin` | No |
| Members | `ProjectMember` | Sì — è un punto di partenza, modificatelo liberamente |

I team **Owners** e **Admin** sono bloccati di proposito: le loro autorizzazioni non sono modificabili e i team non possono essere eliminati né rinominati. È questo che impedisce a un progetto di chiudersi fuori accidentalmente. Il team Owners deve sempre mantenere almeno un membro.

`ProjectOwner` è il livello di accesso più alto: fatturazione, eliminazione del progetto e tutto ciò che può fare un amministratore. `ProjectAdmin` copre tutto tranne la fatturazione e l'eliminazione del progetto.

Attivare o disattivare SMS, chiamate telefoniche, WhatsApp o Telegram per il progetto rientra nella fatturazione, perché ogni messaggio costa denaro. Solo `ProjectOwner`, il ruolo `BillingAdmin` (**Billing Admin**) e l'autorizzazione `ManageProjectBilling` (**Manage Billing**) possono cambiare questi interruttori, in **Impostazioni del progetto > Notifiche > Impostazioni notifiche** — non `ProjectAdmin`.

Ricaricare i saldi prepagati del progetto rientra anch'esso nella fatturazione. Su OneUptime Cloud SMS, chiamate telefoniche, WhatsApp e Telegram sono pagati dal saldo in **Impostazioni del progetto > Notifiche > Impostazioni notifiche**, e l'IA dai crediti IA in **Impostazioni del progetto > IA > Crediti IA**. Solo un proprietario del progetto o qualcuno con **Manage Billing** può ricaricarli o cambiarne la **Ricarica automatica** — non un amministratore del progetto. Un messaggio su un saldo in esaurimento dice chi può ricaricarlo, e solo queste persone hanno un pulsante **Ricarica saldo** funzionante o un link alla pagina.

Create tutti i team aggiuntivi che volete — «Reperibilità Frontend», «Supporto», «Revisori in sola lettura» — e date a ciascuno le autorizzazioni che gli servono.

Dove trovarlo: **Impostazioni → Team**. Aprite un team per raggiungere **Members** e **Permissions**; **Block Permissions** si trova sotto **More settings**, in fondo alla pagina Permissions.

## Autorizzazioni

Un'autorizzazione è una singola capacità. Ci sono due modi per distribuirle, entrambi nella scheda **Permissions** del team.

### Ruoli

Un ruolo raggruppa un'intera area del prodotto a uno di tre livelli:

- **Admin** — controllo completo su quell'area, inclusa la sua configurazione (gravità, stati, modelli).
- **Member** — il lavoro quotidiano: creare, modificare ed eliminare le risorse, ma non riconfigurare l'area.
- **Viewer** — sola lettura.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` e così via. I ruoli sono la scelta giusta quasi sempre: restano corretti mentre OneUptime aggiunge funzionalità, perché una nuova tabella legata ai monitor viene aggiunta ai ruoli monitor esistenti invece di richiedervi una nuova concessione.

I workflow sono l'eccezione. Un workflow esegue i suoi passaggi all'interno del progetto, quindi `WorkflowMember` apre i workflow e le loro esecuzioni e li esegue a mano, ma non li crea, non li modifica e non li elimina. `WorkflowAdmin` li costruisce. Vedi [Configurazione dei workflow](/docs/workflows/configuration).

Tutti i {{PERMISSION_ROLE_COUNT}} ruoli sono elencati nel [Riferimento autorizzazioni](/docs/permissions/reference).

### Autorizzazioni granulari

Ogni singola capacità è assegnabile anche da sola: `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` e altre {{PERMISSION_TOTAL_COUNT}}. Usatele quando un ruolo è troppo ampio e dovete concedere esattamente una cosa.

Sono anche le chiavi che usate quando create chiavi API, e quelle che l'API e il provider Terraform si aspettano.

L'elenco completo è nel [Riferimento autorizzazioni](/docs/permissions/reference).

### Concedere e bloccare

Ogni team ha due elenchi:

- **Permissions** (concedi) — ciò che questo team può fare.
- **Block Permissions** — ciò che questo team non può mai fare, indipendentemente da qualsiasi concessione.

**Il blocco vince sempre.** Una voce di blocco senza etichette toglie del tutto quella capacità al team. Una voce di blocco con etichette la toglie solo per le risorse che portano quelle etichette: utile per «questo team può modificare i monitor, tranne quelli etichettati Production».

Un'autorizzazione non può portare etichette di restrizione in entrambi gli elenchi contemporaneamente; OneUptime rifiuta la seconda con una spiegazione.

Le concessioni di un utente si sommano su tutti i suoi team, ma un blocco vale per tutto ciò che l'utente fa: un blocco senza etichette su un team toglie la capacità anche se un altro team la concede, e una voce di blocco non concede mai nulla. Se qualcuno ha meno accesso del previsto, cercate un blocco in ciascuno dei suoi team; se ne ha di più, cercate una concessione in ciascuno.

## Ambito: fin dove arriva un'autorizzazione concessa

Ogni autorizzazione concessa ha un ambito, scelto al momento dell'aggiunta:

| Ambito | Significato |
| --- | --- |
| Tutte le risorse del progetto | Il valore predefinito. L'autorizzazione vale per ogni risorsa corrispondente. |
| Possedute da questo team o dai suoi membri | L'autorizzazione vale solo per le risorse in cui questo team, o l'utente che agisce, è indicato come proprietario. |
| Limita per etichette (avanzato) | L'autorizzazione vale solo per le risorse che portano almeno una delle etichette selezionate. |

**Possedute** è il modo più semplice per costruire un modello «ognuno si occupa dei propri servizi»: date a un team `MonitorAdmin` con ambito Possedute, poi rendete quel team proprietario dei monitor di cui è responsabile. Limita solo le risorse che possono davvero avere proprietari: monitor, incidenti, dashboard, servizi e simili. La configurazione del progetto (stati degli incidenti, etichette, i team stessi) non ha proprietari, quindi lì un ruolo con ambito Possedute si comporta normalmente.

**Etichette** è la versione più manuale della stessa idea: contrassegnate le risorse, poi concedete autorizzazioni limitate a quei contrassegni.

Alcuni ruoli sono a livello di progetto per definizione e non offrono alcun ambito, perché restringerli non avrebbe senso: «Billing Admin, ma solo per la fatturazione che possiedo» non descrive nulla:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Proprietari

Un proprietario è un utente o un team collegato a una risorsa specifica. La maggior parte delle risorse che rappresentano qualcosa che gestite — monitor, incidenti, avvisi, manutenzioni programmate, policy di reperibilità, dashboard, servizi, pagine di stato, workflow, runbook e SLO — ha una scheda **Owners**.

I proprietari svolgono due compiti:

1. **Notifica.** I proprietari sono chi OneUptime avvisa quando succede qualcosa alla risorsa: un monitor va giù, viene creato un incidente, uno SLO inizia a consumare il proprio error budget.
2. **Accesso, quando lo chiedete.** La proprietà è ciò contro cui si risolve l'ambito Possedute. Un utente corrisponde se è personalmente proprietario, oppure se lo è uno dei team a cui appartiene.

La proprietà da sola non concede nulla. Essere proprietari di un monitor non permette di modificarlo se nessuno dei vostri team detiene anche un'autorizzazione sui monitor. La proprietà restringe l'accesso; non lo amplia mai.

## Etichette

Le etichette sono contrassegni validi in tutto il progetto che applicate alle risorse. Servono a due scopi: filtrare e raggruppare nella dashboard e limitare le autorizzazioni come descritto sopra.

Una restrizione per etichette è soddisfatta se la risorsa porta **almeno una** delle etichette dell'autorizzazione. Una risorsa senza alcuna etichetta non soddisfa nessuna autorizzazione limitata per etichette.

Un record senza etichette proprie, come la nota di un incidente, un annuncio di una pagina di stato o un insight dell'IA su un servizio, porta le etichette dei record a cui appartiene o di cui parla. Un'autorizzazione limitata per etichette lo raggiunge quando uno di quei record porta una delle sue etichette, e un blocco con etichette lo esclude quando uno di essi porta un'etichetta bloccata, in lettura, modifica ed eliminazione allo stesso modo. Un record che non riguarda nessuno di essi, come un insight dell'IA che non riguarda alcun servizio, appartiene al progetto: una restrizione per etichette non lo restringe e un blocco con etichette non lo esclude.

Dove trovarlo: **Impostazioni → Etichette**.

## Telemetria

Log, tracce, metriche, eccezioni, profili e riproduzioni di sessione appartengono alla risorsa che li ha inviati: un servizio, un host, un cluster Kubernetes, un monitor, un'applicazione RUM e simili. Un'autorizzazione di telemetria legge fin dove arriva il suo ambito:

- **Tutte le risorse** legge la telemetria di ogni risorsa del progetto.
- **Possedute** legge la telemetria delle risorse possedute da voi o da uno dei vostri team, e la telemetria che non nomina alcuna risorsa.
- **Etichette** legge la telemetria delle risorse che portano una delle etichette dell'autorizzazione.

Un blocco con etichette su un'autorizzazione di telemetria esclude la telemetria delle risorse che portano quelle etichette, qualunque altra cosa abbiate. Vale ovunque si legga la telemetria: gli explorer con i loro grafici, filtri ed elenchi di attributi, le esportazioni, le riproduzioni di sessione e ciò che l'assistente IA legge per voi. L'elenco dei nomi delle metriche mostra le metriche riportate da un servizio che potete leggere e quelle che nessun servizio riporta, come le metriche di host e cluster. Se potete leggere anche la telemetria di altri tipi di risorse, come host o cluster, mostra tutti i nomi delle metriche.

I log dei monitor, lo storico degli SLO, i flussi di rete e le ripartizioni dei costi Kubernetes si leggono allo stesso modo, attraverso il monitor, lo SLO, il dispositivo di rete o il cluster a cui appartengono: Possedute ed Etichette raggiungono le righe dei record che potete leggere, e un blocco con etichette esclude le righe dei record che portano quelle etichette. Il registro di audit e gli indicatori di threat intelligence li legge su tutto il progetto chiunque possa leggerli.

## Chiavi API

Alle chiavi API le autorizzazioni vengono concesse direttamente sulla chiave: non appartengono a team e non sono influenzate dalle appartenenze.

- Assegnate le stesse autorizzazioni granulari e gli stessi ruoli che dareste a un team.
- Le chiavi supportano **autorizzazioni bloccate** e **restrizioni per etichette**, esattamente come i team.
- Le chiavi **non** supportano l'ambito Possedute. La proprietà si risolve rispetto a un utente, e una chiave non è un utente: concedete quindi alle chiavi l'accesso necessario in modo esplicito.

Date a ogni integrazione la propria chiave con l'insieme di autorizzazioni più stretto che funzioni, così potrete revocarne una senza disturbare le altre.

Dove trovarlo: **Impostazioni → Chiavi API**. Vedi anche il [Riferimento API](/docs/api-reference/api-reference).

## Come OneUptime decide se una richiesta è consentita

Per un utente autenticato, nell'ordine:

1. Trovare i team a cui l'utente appartiene in questo progetto, contando solo gli inviti accettati. Una richiesta raggiunge solo i record di questo progetto: un record di un altro progetto, indicato con il suo id o in un filtro, viene trattato come se non esistesse.
2. Raccogliere tutte le righe di autorizzazione di quei team — concesse e bloccate — ciascuna con le sue etichette e il suo ambito.
3. Controllare prima l'elenco dei blocchi. Un blocco senza etichette su una qualsiasi autorizzazione che la tabella di destinazione accetta per quell'operazione rifiuta subito la richiesta, qualunque sia il team su cui è impostato.
4. Controllare l'elenco delle concessioni. La richiesta ha bisogno di almeno un'autorizzazione che la tabella di destinazione accetta per quell'operazione. Su una risorsa operativa — un monitor, un incidente, una dashboard e simili — conta anche l'autorizzazione **All Operational Resources** corrispondente (Create, Read, Edit o Delete), a meno che non sia bloccata a sua volta.
5. Applicare l'ambito. Le concessioni con ambito Possedute restringono la query alle risorse possedute; quelle per etichette la restringono alle etichette corrispondenti. Se un'altra concessione per la stessa operazione è più ampia, vince quella più ampia. Un record senza etichette proprie, come una nota di un incidente, soddisfa una concessione per etichette quando uno dei record a cui appartiene porta una delle sue etichette.
6. Applicare i blocchi per etichette. Un blocco con etichette rifiuta la richiesta se la risorsa di destinazione ne porta una. Quando un record non ha etichette proprie, come una nota di un incidente o un annuncio di una pagina di stato, un blocco con etichette lo esclude dalle letture, dalle modifiche e dalle eliminazioni se un record a cui appartiene porta una di quelle etichette. Un elenco di record di tutti i vostri progetti insieme, come gli incidenti della vostra pagina iniziale, restringe i record di ciascun progetto secondo i vostri blocchi e le vostre concessioni in quel progetto.

Ogni campo di un record si legge con l'autorizzazione di lettura del record stesso: un'autorizzazione per un altro tipo di record non lo apre mai. Alcuni campi sono volutamente più ristretti. I segreti li leggono solo le persone che possono modificare o amministrare il record a cui appartengono, come le chiavi delle richieste in arrivo e delle email in arrivo di un monitor e la chiave del suo agente server, o le chiavi del webhook e delle email in arrivo di un workflow. Guardare la registrazione di una riproduzione di sessione richiede **Watch Session Replays**, non solo **List Session Replays**. La telemetria si legge segnale per segnale: **Read Telemetry Service Log** legge i log, **Read Telemetry Service Traces** legge le tracce e **Read Telemetry Service Metrics** legge le metriche, grafici delle metriche compresi.

I campi seguono la stessa regola. Un blocco senza etichette sull'autorizzazione di un campo toglie quel campo, e su una risorsa operativa l'autorizzazione **All Operational Resources** corrispondente apre ogni campo che può aprire chiunque possa leggere o modificare il record — ma non un campo volutamente più ristretto, come una chiave segreta.

La stessa regola decide tutto il resto che chiede se detenete un'autorizzazione: le azioni che non sono una semplice lettura o scrittura — aggiungere credito SMS, chiamate o IA, pagare una fattura, provare una regola di notifica — e i pulsanti che OneUptime mostra. Un pulsante che non potete usare appare bloccato e dice perché; quando la ragione è un blocco su uno dei vostri team, nomina l'autorizzazione bloccata.

Gli aggiornamenti in tempo reale seguono la stessa regola. Quando un record viene creato, modificato o eliminato, OneUptime avvisa le pagine aperte delle persone che possono leggere quel record, e di nessun altro. Ciò che limita quello che potete leggere limita anche i vostri aggiornamenti in tempo reale: etichette, proprietari, un blocco con etichette, un incidente privato o la conversazione IA di un'altra persona. Quando una modifica vi toglie l'accesso a un record, per esempio rendendolo privato, anche le vostre pagine aperte vengono avvisate, così smettono di mostrarlo. Una modifica alle vostre autorizzazioni raggiunge le vostre pagine aperte entro 30 secondi.

Ogni utente autenticato detiene inoltre un piccolo insieme di autorizzazioni automatiche che coprono cose come leggere il proprio profilo e le proprie regole di notifica. Non sono autorizzazioni amministrative e non danno accesso ai dati di nessun altro.

Le autorizzazioni risolte sono memorizzate in cache per utente e progetto e aggiornate quando cambiano l'appartenenza ai team o le autorizzazioni del team. Se modificate le autorizzazioni e un utente non vede subito il cambiamento, chiedetegli di ricaricare.

## Ricette

**Un team che si limita a osservare.** Create il team e aggiungete il ruolo `Viewer`, oppure i ruoli `*Viewer` per le sole aree che deve vedere.

**Reperibili che gestiscono i propri servizi.** Date al team `MonitorAdmin`, `IncidentMember` e `OnCallMember` con ambito **Possedute**, poi aggiungete il team come proprietario dei monitor che gestisce.

**Collaboratori esterni tenuti fuori dalla produzione.** Date al team i ruoli necessari con ambito **Tutte**, poi aggiungete un'**autorizzazione bloccata** per le capacità sensibili, limitata all'etichetta `Production`.

**Una pipeline CI che segnala solo i deploy.** Create una chiave API con le sole autorizzazioni granulari che le servono, senza ruoli.

**Qualcuno che non deve vedere la fatturazione.** Non aggiungetelo al team Owners. `ProjectAdmin` esclude già la fatturazione.

## Prossimi passi

- [Riferimento autorizzazioni](/docs/permissions/reference) — ogni ruolo e ogni autorizzazione granulare, generati dal codice sorgente di OneUptime.
- [SSO](/docs/identity/sso) e [SCIM](/docs/identity/scim) — autenticazione e provisioning automatico degli utenti.
- [Riferimento API](/docs/api-reference/api-reference) — usare le autorizzazioni dall'API.
