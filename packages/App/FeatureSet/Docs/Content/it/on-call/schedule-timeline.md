# Cronologia delle reperibilità

La cronologia delle reperibilità mostra tutte le pianificazioni di reperibilità del progetto su un'unica griglia settimanale o mensile: una riga per pianificazione, una colonna per giorno. Risponde alla domanda «chi è reperibile nel mio team, o in tutta l'organizzazione, questa settimana?» senza aprire ogni pianificazione.

I turni della cronologia sono quelli con cui OneUptime avvisa le persone, sostituzioni utente comprese: la cronologia, le regole di escalation e i feed calendario li leggono tutti dalla stessa fonte.

```mermaid title="Un solo insieme di turni dietro cronologia, avvisi e feed calendario"
flowchart TB
    subgraph setup["Ogni pianificazione"]
        direction LR
        layers["Livelli e<br/>rotazioni"]
        overrides["Sostituzioni<br/>utente"]
    end
    layers --> shifts["Chi è reperibile,<br/>e quando"]
    overrides --> shifts
    shifts --> timeline["Cronologia delle<br/>reperibilità"]
    shifts --> paging["Le regole di<br/>escalation<br/>li avvisano"]
    shifts --> feeds["Feed calendario"]
```

## Aprire la cronologia

- **Reperibilità** > **Cronologia delle reperibilità** mostra tutte le pianificazioni che puoi vedere, raggruppate per team proprietario. In **Pianificazioni di reperibilità**, **Cronologia delle reperibilità** nel menu **⋯** apre la stessa pagina.
- **Team** > un team > **Pianificazioni di reperibilità** mostra solo le pianificazioni di cui quel team è proprietario.

Un team è proprietario di una pianificazione quando compare nella pagina **Proprietari** della pianificazione. Le pianificazioni senza team proprietario sono raggruppate sotto **Nessun team proprietario**. Disattiva **Raggruppa per team** per vedere tutte le pianificazioni in un unico elenco, ordinato per nome.

## Leggere la griglia

| Sulla griglia | Che cosa significa |
| --- | --- |
| Una barra | Un turno: chi è reperibile, da quando a quando. Una persona ha lo stesso colore in tutte le pianificazioni. |
| Una barra sbiadita | Un turno passato. |
| Una barra contrassegnata da **⇄** | Una sostituzione: qualcuno copre un turno. La corsia sottile sottostante nomina la persona il cui turno viene coperto, barrata. |
| Un blocco ambra tratteggiato | Un buco di copertura: nessuno è reperibile. Un avviso che scala verso quella pianificazione non avvisa nessuno. |
| La linea rossa | Adesso. |
| La riga sotto il nome di una pianificazione | Chi è reperibile adesso, oppure **Nessuno di turno ora**. |

Passa il puntatore su una barra o un buco, o raggiungili con la tastiera, per vederne i dettagli.

Sotto la griglia, **Di turno questa settimana** (**Di turno questo mese** nella vista mensile) elenca tutte le persone reperibili nel periodo. Passa il puntatore su un nome per vedere per quanto tempo quella persona è reperibile e in quante pianificazioni.

## Cambiare periodo e fuso orario

- Passa da **Settimana** a **Mese**, spostati con le frecce e torna indietro con **Oggi**.
- Gli orari sono mostrati nel tuo fuso orario. Il pulsante del fuso orario apre **Visualizza la cronologia nel fuso orario**, che mostra la cronologia in qualsiasi altro fuso senza cambiare chi è reperibile: ogni pianificazione continua a passare il turno nel proprio fuso orario.
- La cronologia copre 180 giorni nel passato e 365 giorni nel futuro.

> [!NOTE]
> I turni passati vengono ricalcolati dalla configurazione attuale di ogni pianificazione: mostrano quindi la rotazione così come è impostata oggi, che può differire da chi è stato davvero avvisato allora. Per le ore effettivamente trascorse in reperibilità, usa **Reperibilità** > **Report** > **Tempo di reperibilità dell'utente**. Vedi [Tempo di reperibilità dell'utente](/docs/on-call/readiness#tempo-di-reperibilità-dellutente).

## Trovare una pianificazione o una persona

- **Cerca** trova nomi di pianificazioni, nomi di team e le persone reperibili.
- Il filtro dei team limita la vista a un team o a **I miei team**; **Pianificazioni in cui sono** mantiene solo le pianificazioni di cui fai parte.
- Sopra la griglia, fai clic su **senza nessuno di turno ora** o **con buchi di copertura questa settimana** (**con buchi di copertura questo mese** nella vista mensile) per vedere solo quelle pianificazioni. Fai di nuovo clic per vederle tutte.
- Fai clic su una persona sotto la griglia, o su una delle sue barre, per evidenziare tutti i suoi turni. **Rimuovi evidenziazione** annulla l'evidenziazione e **Cancella i filtri** azzera la ricerca e i filtri.

## Chi vede cosa

| Si applica a | Regola |
| --- | --- |
| Permessi | Gli stessi permessi e le stesse restrizioni per etichetta di **Pianificazioni di reperibilità**, più il permesso di leggere i livelli delle pianificazioni. |
| Sostituzioni | Di chi è il turno coperto da una sostituzione lo vede solo chi può leggere le sostituzioni utente. Gli altri vedono comunque chi viene avvisato. |
| Numero di pianificazioni | Fino a 250 pianificazioni alla volta, ordinate per nome. La pagina **Pianificazioni di reperibilità** di un team la limita alle pianificazioni di quel team. |
| Piano | Su OneUptime Cloud, la cronologia richiede il piano **Growth**, come le pianificazioni di reperibilità. |

## Passaggi successivi

:::cards
- [Pianificazioni di reperibilità](/docs/on-call/schedules): Imposta chi si alterna, i livelli e gli orari di reperibilità.
- [Feed calendario](/docs/on-call/calendar-feeds): Porta i tuoi turni in Google Calendar, Outlook o Calendario di Apple.
- [Regole di escalation](/docs/on-call/escalation-rules): Decidi chi avvisa ogni livello di una policy di reperibilità.
:::
