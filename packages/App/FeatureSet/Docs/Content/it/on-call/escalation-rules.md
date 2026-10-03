# Regole di escalation

Una policy di reperibilità avvisa le persone per livelli. Ogni regola di escalation è un livello: chi viene avvisato e quanto attendere che qualcuno confermi prima di avvisare il livello successivo. Le regole di una policy sono elencate, in ordine, nella sua pagina **Regole di escalation**.

## Chi viene avvisato per primo

Quando crei una policy di reperibilità nella pagina **Policy di reperibilità**, il modulo chiede il suo **Nome** e **Chi viene avvisato per primo?**. La domanda usa lo stesso selettore di **Notifica**: pianificazioni di reperibilità, team e persone, quanti ne servono. Chi scegli forma la prima regola di escalation della policy, **Level 1**, che attende **30 minuti** una conferma prima di avvisare il livello successivo. La nuova policy si apre poi nella sua pagina **Regole di escalation**, dove puoi aggiungere altri livelli.

**Chi viene avvisato per primo?** è facoltativo. Se lo lasci vuoto, la policy parte senza regole di escalation: non avvisa nessuno finché non ne aggiungi una, e la sua panoramica lo segnala. La descrizione e le etichette si trovano in **Avanzato**. La domanda viene posta solo a chi può aggiungere regole di escalation.

## Aggiungere una regola di escalation

Apri la policy di reperibilità, scegli **Regole di escalation** nel menu laterale e fai clic su **Add Escalation Rule**. La finestra è un'unica pagina breve con due domande:

- **Notifica** — chi viene avvisato a questo livello. Un solo selettore comprende pianificazioni di reperibilità, team e persone: fai clic su **Aggiungi destinatario**, cerca e scegli quanti ne servono. Ne serve almeno uno.
  - Una **pianificazione di reperibilità** avvisa chi è reperibile quando il livello viene eseguito, non una persona fissa.
  - Un **team** avvisa ogni membro del team.
  - Una **persona** viene avvisata direttamente.
- **Escala dopo (in minuti)** — quanto attendere una conferma prima di avvisare il livello successivo. Parte da **30 minuti**; modificalo in base al livello.

Tutto il resto si trova in **Avanzato**, chiuso finché non lo apri:

- **Nome** — facoltativo. Una regola senza nome prende il nome del suo livello: la prima regola di una policy è **Level 1**, la seconda **Level 2** e così via. Il campo del nome mostra il nome che la regola riceverà.
- **Descrizione** — note facoltative, per esempio chi avvisa questo livello e perché.

L'intestazione di **Avanzato** indica **Configurato** quando la regola ha una descrizione o un nome scelto da te.

## Come i livelli avvisano le persone

Quando un incidente o un avviso raggiunge la policy, **Level 1** avvisa subito i suoi destinatari. Se nessuno conferma entro la sua attesa, viene avvisato **Level 2**, e così via lungo l'elenco. Trascorsa l'attesa dell'ultimo livello senza conferma, la policy ricomincia da **Level 1** se la sua **Repeat Policy** (sotto le regole) prevede la ripetizione, per tutte le volte consentite, altrimenti si ferma.

Il riepilogo in cima alla pagina **Regole di escalation** mostra l'intera scala: quando viene avvisato ogni livello, chi avvisa e cosa succede dopo l'ultimo. Un livello i cui destinatari non possono essere avvisati tutti lo segnala sulla sua scheda; fai clic sull'etichetta per vedere chi e perché.

## Modificare, riordinare ed eliminare le regole

- **Edit rule** apre la stessa finestra di una pagina, compilata con la regola così com'è: i suoi destinatari, la sua attesa, e il nome e la descrizione in **Avanzato**. Aggiungi o rimuovi destinatari e salva. Svuotando il nome, la regola riprende il nome del suo livello.
- **Move up** e **Move down** nel menu **⋯** di una regola ne cambiano il livello. Una regola che prende il nome dal suo livello mantiene un nome adatto alla sua posizione: quando **Level 3** sale oltre **Level 2**, le due si scambiano i nomi. Un nome scelto da te, come **Managers**, resta lo stesso ovunque vada la regola.
- **Delete rule** chiede prima conferma e indica chi avvisa il livello. Eliminando un livello, i livelli sottostanti salgono e le regole che prendono il nome dal loro livello vengono rinominate di conseguenza.

## Creare regole con l'API o Terraform

Le regole di escalation sono la risorsa `/api/on-call-duty-policy-escalation-rule`; le persone, i team e le pianificazioni che una regola avvisa sono le risorse `/api/on-call-duty-policy-escalation-rule-user`, `-team` e `-schedule`.

- Una regola creata senza `name` prende il nome del suo livello, come nella dashboard: **Level 3** per una regola che diventa il terzo livello della sua policy. La risorsa Terraform per le regole di escalation richiede ancora un nome.
- `escalateAfterInMinutes` non ha un valore predefinito al di fuori della dashboard. Una regola creata senza di esso non attende: il livello successivo viene avvisato appena questo è stato eseguito. Impostalo esplicitamente: la dashboard suggerisce 30.
- Le regole che prendono il nome dal loro livello vengono rinominate quando sposti o elimini regole nella dashboard. Modificare `order` tramite l'API o Terraform cambia solo l'ordine.
- Creare una policy di reperibilità tramite `/api/on-call-duty-policy` con `onCallSchedules`, `teams` o `users` (elenchi di ID) nei suoi `miscDataProps` le dà la sua prima regola di escalation, come nella dashboard: **Level 1**, che li avvisa, con un `escalateAfterInMinutes` di 30. Ogni ID deve appartenere al progetto e chi chiama deve poter creare regole di escalation, altrimenti la policy non viene creata. Una policy creata senza di essi non ha regole, come prima; la risorsa Terraform delle policy non li invia.
