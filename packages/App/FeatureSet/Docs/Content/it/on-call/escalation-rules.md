# Regole di escalation

Una policy di reperibilità avvisa le persone per livelli. Ogni regola di escalation è un livello: chi viene avvisato e quanto attendere che qualcuno confermi prima di avvisare il livello successivo. Le regole di una policy sono elencate, in ordine, nella sua pagina **Regole di escalation**.

```mermaid title="Una policy di reperibilità avvisa livello per livello finché qualcuno conferma"
flowchart TB
    trigger["Incidente o avviso"] --> level1["Level 1 avvisa"]
    level1 --> ack1{"Confermato<br/>in tempo?"}
    ack1 -->|"Sì"| stop["Gli avvisi si fermano"]
    ack1 -->|"No"| level2["Level 2 avvisa"]
    level2 --> ack2{"Confermato<br/>in tempo?"}
    ack2 -->|"Sì"| stop
    ack2 -->|"No, ultimo livello"| repeat{"Ripetere la policy?"}
    repeat -->|"Sì"| level1
    repeat -->|"No"| done["La policy si ferma"]
```

:::cards
- [Chi viene avvisato per primo](#chi-viene-avvisato-per-primo): Crea una policy con il suo primo livello.
- [Aggiungere una regola di escalation](#aggiungere-una-regola-di-escalation): Aggiungi il livello successivo, passo dopo passo.
- [Come i livelli avvisano le persone](#come-i-livelli-avvisano-le-persone): Tempi, ripetizioni e come viene raggiunta ogni persona.
- [API e Terraform](#creare-regole-con-lapi-o-terraform): Crea policy e regole come codice.
:::

## Chi viene avvisato per primo

Quando crei una policy di reperibilità nella pagina **Policy di reperibilità**, il modulo chiede il suo **Nome** e **Chi viene avvisato per primo?**. La domanda usa lo stesso selettore di **Notifica**: pianificazioni di reperibilità, team e persone, quanti ne servono. Chi scegli diventa la prima regola di escalation della policy, **Level 1**, che attende **30 minuti** una conferma prima di avvisare il livello successivo.

:::steps
1. Vai in **Reperibilità** > **Policy di reperibilità** e fai clic su **Crea: Policy di reperibilità**.
2. Inserisci un **Nome**.
3. In **Chi viene avvisato per primo?**, fai clic su **Aggiungi destinatario** e scegli le pianificazioni di reperibilità, i team e le persone da avvisare per primi.
4. Fai clic su **Crea: Policy di reperibilità**. La nuova policy si apre poi nella sua pagina **Regole di escalation**, dove puoi aggiungere altri livelli.
:::

**Chi viene avvisato per primo?** è facoltativo. Se lo lasci vuoto, la policy parte senza regole di escalation: non avvisa nessuno finché non ne aggiungi una, e la sua panoramica lo segnala. La descrizione e le etichette si trovano in **Altri campi**. La domanda viene posta solo a chi può aggiungere regole di escalation.

## Aggiungere una regola di escalation

:::steps
### Apri le regole di escalation della policy

Apri la policy di reperibilità, scegli **Regole di escalation** nel suo menu laterale e fai clic su **Aggiungi regola di escalation**. La finestra di dialogo è una sola pagina breve.

### Scegli chi notificare

In **Notifica**, fai clic su **Aggiungi destinatario**, cerca e scegli tutte le pianificazioni di reperibilità, i team e le persone che questo livello deve avvisare. Aggiungine almeno uno.

| Destinatario | Chi viene avvisato quando il livello si attiva |
| --- | --- |
| Una **pianificazione di reperibilità** | Chi è reperibile in quel momento, non una persona fissa. |
| Un **team** | Ogni membro del team. |
| Una **persona** | Quella persona, direttamente. |

### Imposta quanto attendere

**Escala dopo (in minuti)** è quanto attendere una conferma prima di avvisare il livello successivo. Parte da **30 minuti**; cambialo in base al livello.

### Dai un nome alla regola, se vuoi

Tutto il resto si trova in **Altri campi**, chiuso finché non lo apri:

- **Nome**: facoltativo. Una regola senza nome prende il nome del suo livello: la prima regola di una policy è **Level 1**, la seconda **Level 2** e così via. Il campo del nome mostra il nome che la regola riceverà.
- **Descrizione**: note facoltative, ad esempio chi avvisa questo livello e perché.

Da chiusa, l'intestazione di **Altri campi** nomina i due campi e mostra quelli che la regola ha: una descrizione o un nome scelto da te.

### Crea la regola

Fai clic su **Create Rule**. La regola viene aggiunta sotto le altre, come livello successivo della policy.
:::

## Come i livelli avvisano le persone

Quando un incidente o un avviso raggiunge la policy, **Level 1** avvisa subito i suoi destinatari. Se nessuno conferma entro la sua attesa, viene avvisato **Level 2**, e così via lungo l'elenco. Trascorsa l'attesa dell'ultimo livello senza conferma, la policy ricomincia da **Level 1** se il suo **Criterio di ripetizione** (sotto le regole) prevede di ripetere, tante volte quante consente, altrimenti si ferma. Confermare o risolvere l'incidente o l'avviso ferma gli avvisi a qualsiasi livello.

Un incidente, un avviso o un episodio creato già riconosciuto o risolto — registrato a posteriori — non esegue nessuna delle sue policy: nessuno viene avvisato, e il suo feed lo indica nominandole. Vedi [Dichiarato già riconosciuto o risolto](/docs/incidents/declaring-incidents#dichiarato-già-riconosciuto-o-risolto).

Per ripetere una policy, fai clic su **Modifica** nella scheda **Criterio di ripetizione**, attiva **Repeat if no one acknowledges** e imposta **Number of times to repeat**.

### Il riepilogo dell'escalation

Il riepilogo in cima alla pagina **Regole di escalation** mostra l'intera scala: quando viene avvisato ogni livello, chi avvisa e cosa succede dopo l'ultimo. Un livello i cui destinatari non possono essere avvisati tutti lo indica sulla sua scheda; fai clic sull'etichetta per vedere chi e perché.

### Come viene raggiunta ogni persona

Ogni persona avvisata da un livello viene raggiunta come indicano le sue regole di reperibilità: **Impostazioni utente** > **Regole di reperibilità**, con una scheda per incidenti, episodi di incidente, avvisi ed episodi di avviso e una scheda per gravità che indica quale metodo di notifica viene provato e dopo quanto tempo. Un amministratore del progetto può vedere e modificare le regole di un membro in **Utenti** > il membro > **Regole di reperibilità**.

```mermaid title="Chi avvisa un livello e come viene raggiunta ogni persona"
flowchart TB
    subgraph notify["Notifica"]
        direction LR
        schedule["Pianificazione di reperibilità"]
        team["Team"]
        user["Persona"]
    end
    schedule -->|"chi è reperibile"| person["Persona avvisata"]
    team -->|"ogni membro"| person
    user -->|"direttamente"| person
    person --> rules["Le sue regole di reperibilità"]
    rules --> methods["I suoi metodi di notifica"]
```

Una sostituzione utente in vigore per una persona invia i suoi avvisi a chi la sostituisce.

Ogni messaggio è uno che il suo fornitore accetta, così un avviso parte sempre. Ecco quanto porta ogni canale:

| Canale | Il messaggio più lungo che porta |
| --- | --- |
| SMS | 1.600 caratteri |
| Chiamata telefonica | Ciò che entra nello script di chiamata di Twilio da 4.000 caratteri |
| Notifica push | 4 KB, di cui al massimo 3 KB per titolo, testo e dati |
| WhatsApp | 1.024 caratteri |
| Telegram | 4.096 caratteri |

Un messaggio più lungo, con un titolo lungo o una descrizione lunga inserita da un modello, viene tagliato e termina con una nota che il testo completo è in OneUptime: «… (truncated — see OneUptime for the full text)». Il testo di un messaggio WhatsApp è un modello fisso, quindi lì vengono tagliati i valori più lunghi, ognuno terminato da «…». I link in un messaggio non vengono mai tagliati.

### Quando un avviso non viene inviato

Un avviso non inviato indica il motivo nei **Registri di reperibilità** della persona (Impostazioni utente): la sua riga mostra **Errore** e il suo messaggio di stato ne dà la ragione. Non resta più su **Sending**. Il messaggio dice una di queste cose:

- il saldo del progetto non ha potuto pagarlo, e chi può aggiungere saldo;
- il canale è disattivato nel progetto, e chi può attivarlo.

I proprietari del progetto ricevono un'email una volta, finché il saldo non viene ricaricato o il canale non viene riattivato.

Su OneUptime Cloud ogni SMS, chiamata, messaggio WhatsApp e Telegram viene pagato con il saldo del progetto in **Impostazioni del progetto > Notifiche > Impostazioni notifiche**: il suo costo esatto viene scalato dal saldo quando il fornitore lo accetta, indipendentemente da quanti messaggi partono insieme.

- Con la **Ricarica automatica** attiva lì, il messaggio che trova il saldo sotto la soglia aggiunge prima l'importo impostato per la ricarica automatica, addebitandolo sulla carta del progetto; i messaggi che lo trovano basso nello stesso momento addebitano la carta una sola volta.
- Se l'addebito non riesce (non c'è un metodo di pagamento o la carta è stata rifiutata), la ricarica automatica riprova la carta un'ora dopo, e **Impostazioni notifiche** lo indica in alto fino ad allora. Aggiungere saldo a mano, o salvare di nuovo la ricarica automatica, riprova subito.
- Gli avvisi continuano a partire con il saldo rimasto finché la ricarica automatica non riesce ad addebitare la carta.

> [!IMPORTANT]
> SMS, chiamate telefoniche, WhatsApp e Telegram sono disattivati in un nuovo progetto: su OneUptime Cloud ogni messaggio viene pagato con il saldo del progetto, e un'installazione self-hosted ha prima bisogno di un account Twilio o di un bot Telegram configurato. Finché un canale è disattivato, nessuno nel progetto può aggiungere un metodo su di esso. Solo un proprietario del progetto o qualcuno con il ruolo **Billing Admin** o il permesso **Manage Billing** può attivarne uno, nella scheda **Canali di notifica** di **Impostazioni del progetto > Notifiche > Impostazioni notifiche**: un amministratore del progetto non può. Tutti gli altri vengono informati esattamente su chi può farlo, ovunque un canale sia disattivato: sopra il proprio elenco di metodi su quel canale, nella propria checklist di configurazione e nel messaggio che ricevono quando qualcosa ne ha bisogno.

## Modificare, riordinare ed eliminare le regole

La scheda di ogni regola ha **Edit rule** e un menu **⋯** con le altre azioni:

- **Edit rule** apre la stessa finestra di dialogo di una pagina, compilata con la regola com'è: i suoi destinatari, la sua attesa, il nome e la descrizione in **Altri campi**. Aggiungi o rimuovi destinatari e fai clic su **Salva modifiche**. Svuotare il nome ridà alla regola il nome del suo livello.
- **Move up** e **Move down** nel menu **⋯** di una regola ne cambiano il livello. Una regola che prende il nome dal suo livello mantiene un nome coerente con la sua posizione: quando **Level 3** sale sopra **Level 2**, le due si scambiano i nomi. Un nome che hai scelto, come **Responsabili**, resta lo stesso ovunque vada la regola.
- **Delete rule** chiede prima conferma e indica chi avvisa il livello. Eliminare un livello fa salire i livelli sottostanti, e le regole che prendono il nome dal livello vengono rinominate di conseguenza.

## Creare regole con l'API o Terraform

Le regole di escalation sono la risorsa `/api/on-call-duty-policy-escalation-rule`; le persone, i team e le pianificazioni che una regola avvisa sono le risorse `/api/on-call-duty-policy-escalation-rule-user`, `-team` e `-schedule`.

- Una regola creata senza `name` prende il nome del suo livello, come nella dashboard: **Level 3** per una regola che diventa il terzo livello della sua policy. La risorsa Terraform delle regole di escalation richiede ancora un nome.
- `escalateAfterInMinutes` non ha un valore predefinito fuori dalla dashboard. Una regola creata senza di esso non attende: il livello successivo viene avvisato non appena questo è stato eseguito. Impostalo esplicitamente: 30 è il valore suggerito dalla dashboard.
- Una regola creata con `onCallSchedules`, `teams` o `users` (elenchi di ID) nei suoi `miscDataProps` riceve quei destinatari; è così che li invia il selettore **Notifica** della dashboard. Una regola creata senza di essi non avvisa nessuno finché non aggiungi destinatari tramite le risorse indicate sopra.
- Le regole che prendono il nome dal livello vengono rinominate quando sposti o elimini regole nella dashboard. Cambiare `order` tramite l'API o Terraform cambia solo l'ordine.
- Creare una policy di reperibilità su `/api/on-call-duty-policy` con `onCallSchedules`, `teams` o `users` (elenchi di ID) nei suoi `miscDataProps` le dà la sua prima regola di escalation, come fa la dashboard: **Level 1**, che li avvisa, con un `escalateAfterInMinutes` di 30. Ogni ID deve appartenere al progetto e il chiamante deve poter creare regole di escalation, altrimenti la policy non viene creata. Una policy creata senza di essi non ha regole, come prima; la risorsa Terraform delle policy non li invia.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Production on-call"
    },
    "miscDataProps": {
      "onCallSchedules": ["<schedule-id>"],
      "users": ["<user-id>"]
    }
  }'
```

## Passaggi successivi

:::cards
- [Pianificazioni di reperibilità](/docs/on-call/schedules): Costruisci le rotazioni che un livello avvisa.
- [Cronologia delle reperibilità](/docs/on-call/schedule-timeline): Controlla chi è reperibile in tutte le pianificazioni e individua i buchi di copertura.
- [Politica chiamate in arrivo](/docs/on-call/incoming-call-policy): Permetti a chi chiama di raggiungere al telefono chi è reperibile.
:::
