# Pianificazioni di reperibilità

Una pianificazione di reperibilità stabilisce chi è reperibile in ogni momento. Le persone si alternano: ognuna è reperibile per un certo tempo, poi subentra la successiva. Aggiungi una pianificazione alle regole di escalation di una policy di reperibilità e la policy avviserà chi è reperibile in quella pianificazione quando viene eseguito quel livello.

## Chi si alterna

Quando crei una pianificazione nella pagina **Pianificazioni di reperibilità**, il modulo chiede il suo **Nome** e **Chi si alterna?**. Fai clic su **Aggiungi utente** e scegli le persone nell'ordine in cui si alternano: sono reperibili una alla volta, e la prima lo è non appena la pianificazione viene creata. Diventano il primo livello della pianificazione, **Layer 1**, reperibile 24 ore su 24. La nuova pianificazione si apre poi sulla sua pagina **Livelli**, dove puoi modificare la rotazione o aggiungere altri livelli.

**Chi si alterna?** è facoltativo. Se lo lasci vuoto, la pianificazione parte senza livelli: non rende reperibile nessuno finché non aggiungi un livello nella sua pagina **Livelli**. La domanda viene posta solo a chi può aggiungere livelli.

Tutto il resto si trova in **Altri campi**, compresso finché non lo apri:

- **Ogni turno dura**: **1 giorno**, **1 settimana**, **2 settimane** o **1 mese**, e **1 settimana** se non lo cambi. Viene chiesto non appena viene scelto qualcuno. Ogni persona è reperibile per quel tempo, poi subentra la successiva, all'ora del giorno in cui è stata creata la pianificazione.
- **Fuso orario**: il fuso orario in cui valgono gli orari di passaggio e le ore di reperibilità. Parte dal tuo.
- **Descrizione** ed **Etichette**.

Finché qualcuno è scelto e in **Altri campi** non è cambiato nulla, la sua intestazione compressa dice cosa succederà: ogni persona è reperibile per una settimana, poi subentra la successiva.

## Livelli

La rotazione di una pianificazione è fatta di livelli, nella sua pagina **Livelli**. I livelli si leggono dall'alto verso il basso: il livello più alto con qualcuno reperibile è quello che avvisa, quindi metti la rotazione principale in alto e la copertura di riserva sotto.

**Aggiungi livello** aggiunge un livello che parte come il primo: reperibile da subito, ogni persona per una settimana, 24 ore su 24. Espandi un livello per aggiungervi persone e per cambiare quando inizia, ogni quanto passa il turno, quando lo passa la prima volta e in quali ore è reperibile.

Ogni persona mantiene lo stesso colore ovunque, così puoi seguirla a colpo d'occhio: su ogni livello, nella pianificazione finale e nelle sue sostituzioni, e nella **Cronologia delle reperibilità**.

## Creare pianificazioni con l'API o Terraform

Le pianificazioni di reperibilità sono la risorsa `/api/on-call-duty-policy-schedule`; i loro livelli e le persone al loro interno sono le risorse `/api/on-call-duty-schedule-layer` e `/api/on-call-duty-schedule-layer-user`.

- Creare una pianificazione con `firstLayerUsers` (un elenco di ID utente, nell'ordine in cui si alternano) nei suoi `miscDataProps` le dà il primo livello, come fa la dashboard: **Layer 1**, reperibile da subito, 24 ore su 24. `firstLayerRotation` indica quanto dura ogni turno, come una rotazione del tipo `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; senza, una settimana. Ogni utente deve essere membro del progetto e chi chiama deve poter creare livelli, altrimenti la pianificazione non viene creata.
- Una pianificazione creata senza di essi non ha livelli, come prima; la risorsa pianificazione di Terraform non li invia.
- Un livello creato senza `rotation` passa il turno ogni giorno, come sempre.
