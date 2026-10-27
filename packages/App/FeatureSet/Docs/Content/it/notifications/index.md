# Come OneUptime vi raggiunge

OneUptime vi raggiunge in due modi. Vi chiama quando un incidente o un avviso scatta mentre siete di reperibilità, e vi tiene aggiornati su ciò che è vostro: una nota sul vostro incidente, un monitor che ha cambiato stato, il vostro prossimo turno. Entrambi arrivano agli indirizzi che tenete nelle **Impostazioni utente**, progetto per progetto. Questa pagina spiega come si combinano i pezzi, dove si trovano e con cosa partite.

:::cards
- [Tre pagine, tre domande](#tre-pagine-tre-domande): Metodi, regole di reperibilità e impostazioni delle notifiche, e cosa decide ciascuno.
- [Dove trovarli](#dove-trovarli): Le pagine delle impostazioni utente, sezione per sezione.
- [Con cosa partite](#con-cosa-partite): I metodi, le regole e le impostazioni che riceve un nuovo membro.
- [Quando nessuna regola corrisponde](#quando-nessuna-regola-corrisponde): Come una chiamata vi raggiunge comunque, e chi viene informato.
:::

## Come funziona

```mermaid title="Due modi in cui OneUptime vi raggiunge, con gli stessi metodi"
flowchart TB
    page["Un incidente o un avviso<br/>vi chiama mentre siete<br/>di reperibilità"] --> rules["Le vostre regole<br/>di reperibilità"]
    owned["Succede qualcosa a<br/>un elemento vostro"] --> settings["Le vostre impostazioni<br/>delle notifiche"]
    rules --> methods["I vostri metodi<br/>verificati: e-mail,<br/>telefono, push, chat"]
    settings --> methods
```

- Una politica di reperibilità vi chiama quando una delle sue regole di escalation nomina voi, un team di cui fate parte o una pianificazione in cui siete di reperibilità. Le vostre regole di reperibilità decidono allora quali dei vostri metodi OneUptime prova, e dopo quanto tempo.
- Quando succede qualcosa a un elemento vostro, o ai vostri turni, le vostre impostazioni delle notifiche decidono su quali canali passa l'aggiornamento.
- In entrambi i casi OneUptime usa solo metodi che avete verificato, nel progetto da cui arriva la chiamata o l'aggiornamento.

## Tre pagine, tre domande

| Pagina | Cosa contiene | La domanda a cui risponde |
| --- | --- | --- |
| **Metodi di notifica** | I vostri indirizzi e-mail, numeri di telefono, numeri WhatsApp, account Telegram, Slack e Microsoft Teams, dispositivi push e webhook | Dove può raggiungermi OneUptime? |
| **Regole di reperibilità** | Per ogni tipo di chiamata e ogni gravità, quale metodo provare e dopo quanto tempo | Come vengo chiamato mentre sono di reperibilità? |
| **Impostazioni notifiche** | Per ogni evento su un elemento vostro o sui vostri turni, quali canali usare | Di cos'altro vengo a sapere, e dove? |

Sono separate di proposito. Attivare tutti i canali nelle **Impostazioni notifiche** non vi chiama mai, e un metodo che non avete verificato non viene mai usato, qualunque cosa dicano le vostre regole.

> [!IMPORTANT]
> Metodi, regole e impostazioni appartengono a un progetto. Configurateli in ogni progetto in cui lavorate: le **Impostazioni utente** mostrano sempre il progetto in cui vi trovate.

## Dove trovarli

Aprite le **Impostazioni utente**, a destra della barra sotto la barra superiore. Il loro menu laterale contiene tutto ciò che riguarda il modo in cui OneUptime vi raggiunge:

| Sezione | Pagine |
| --- | --- |
| **Per iniziare** | **Elenco di configurazione**: cosa resta da configurare, nell'ordine che conta |
| **Avvisi e notifiche** | **Metodi di notifica**, **Regole di reperibilità**, **Impostazioni notifiche** e **Preferenze e-mail**, che stabilisce quante e-mail producono i vostri aggiornamenti |
| **Registri di reperibilità** | **Registri di reperibilità**: ogni volta che siete stati chiamati in questo progetto, e cosa è stato inviato |
| **Policy chiamate in entrata** | **Numeri di telefono in entrata**: il numero su cui vi chiama una policy di chiamate in entrata |
| **Calendario** | **Feed calendario**: i vostri turni nella vostra app di calendario, e promemoria prima che inizino |
| **Profilo** | **Campi personalizzati**: dati che il vostro progetto chiede ai suoi membri |
| **Area di lavoro** | **Slack** e **Microsoft Teams**: il vostro account, in ogni area di lavoro che il progetto ha collegato |

**Per iniziare** e **Avvisi e notifiche** sono aperte; le altre sezioni partono chiuse, e una sezione si apre da sola quando siete su una delle sue pagine. **Area di lavoro** compare solo se il progetto ha collegato Slack o Microsoft Teams.

Anche i proprietari e gli amministratori del progetto possono vedere la vostra configurazione: in **Utenti** aprono la vostra riga e la sua sezione **Reperibilità**, con **Prontezza**, **Metodi di notifica** e **Regole di reperibilità**. Lì possono aggiungere un metodo per voi, ma il codice va al metodo stesso, quindi solo voi potete verificarlo.

## Con cosa partite

Quando entrate in un progetto con un'e-mail di accesso verificata, OneUptime vi configura in modo che una chiamata possa sempre raggiungervi:

1. La vostra e-mail di accesso viene aggiunta come metodo e-mail verificato.
2. Per ogni gravità, su ciascuna delle quattro schede delle **Regole di reperibilità**, una regola vi invia un'e-mail appena venite chiamati.
3. Un insieme di aggiornamenti su ciò che è vostro, e sui vostri turni, viene attivato via e-mail. Vedete [Impostazioni notifiche](/docs/notifications/notification-settings#cosa-è-attivo-per-un-nuovo-membro).

Ogni metodo che verificate in seguito riceve le stesse regole: una regola per ogni gravità, inviata appena venite chiamati. Quindi verificare un numero di telefono per gli SMS significa che ogni chiamata vi manda anche un SMS. Per tenere gli SMS solo per le chiamate critiche, eliminate le regole SMS delle altre gravità. Vedete [Regole di reperibilità personali](/docs/notifications/on-call-rules#le-regole-con-cui-partite).

## L'elenco di configurazione

**Impostazioni utente → Elenco di configurazione** apre **Your setup checklist**: tutto ciò che serve a OneUptime per raggiungervi, nell'ordine che conta. Un passaggio rimanda alla pagina che lo risolve, e **Ricontrolla** rilegge tutto.

| Sezione | Cosa controlla |
| --- | --- |
| **So we can reach you** | Avete un metodo, ogni metodo aggiunto è verificato, e almeno uno è su un canale che il progetto ha attivato |
| **How you want to be paged** | Ogni gravità ha una regola, su ciascuna delle quattro schede delle **Regole di reperibilità** |
| **Staying informed** | Venite a sapere quando inizia un turno, e dietro ogni canale attivato nelle **Impostazioni notifiche** c'è un metodo verificato |
| **Nice to have** | Un numero per le chiamate in entrata, i vostri account Slack e Microsoft Teams, un link al calendario e i vostri campi del profilo |

**Nice to have** non conta nella barra di avanzamento, e nemmeno un passaggio che solo qualcun altro può risolvere. La riga in alto riassume tutto:

| Titolo | Cosa significa |
| --- | --- |
| **È tutto pronto** | Le chiamate vi raggiungono, e non resta nulla da fare |
| **Alcune cose devono ancora essere configurate** | Una gravità non ha una regola, o un passaggio non è ancora fatto |
| **Per ora niente può raggiungerti** | Nessuno dei vostri metodi è utilizzabile: nessuno è verificato, oppure ogni metodo verificato è su un canale che questo progetto ha disattivato |
| **Sei configurato e al momento non sei di reperibilità** | Tutto è pronto per il giorno in cui una politica vi nominerà |

## Quando nessuna regola corrisponde

Una chiamata può raggiungervi per un tipo e una gravità per cui non avete una regola: per esempio una gravità aggiunta dopo il vostro arrivo. OneUptime vi chiama comunque, con ciò che avete verificato:

1. Ogni metodo gratuito che avete: dispositivi push, indirizzi e-mail, Slack e Microsoft Teams.
2. Se non ne avete nessuno, un solo metodo a pagamento, in questo ordine: SMS, una chiamata telefonica, WhatsApp, Telegram. È il primo che avete verificato, su un canale che il progetto ha attivato.
3. Se non avete nemmeno questi, un webhook.

Ricevete un'e-mail al riguardo, e così i proprietari della politica di reperibilità, o quelli del progetto se la politica non ne ha. Se non c'è nulla di verificato, la chiamata non può essere consegnata, e l'e-mail lo dice. Queste e-mail vengono trattenute finché continuano ad arrivare chiamate, così una tempesta di chiamate non diventa una tempesta di e-mail. Per aggiungere la regola mancante, vedete [Regole di reperibilità personali](/docs/notifications/on-call-rules#quando-una-gravità-non-ha-una-regola).

## Risoluzione dei problemi

:::details Ero di reperibilità, ma non mi è arrivato nulla
Aprite **Impostazioni utente → Registri di reperibilità**. Nessuna riga per l'incidente significa che la sua politica di reperibilità non vi ha mai chiamato: controllate le sue regole di escalation e chi era di reperibilità. Per una riga con stato **Errore**, **Visualizza messaggio di stato** dice perché, per esempio un canale che il progetto ha disattivato. Controllate poi che i vostri metodi siano verificati e che **Your setup checklist** non abbia nulla in sospeso sotto **So we can reach you**.
:::

:::details Ricevo e-mail su elementi che non ho mai chiesto
Siete proprietari dell'elemento, direttamente o tramite un team, oppure l'elemento non ha proprietari e voi siete proprietari del progetto. Disattivate l'evento in **Impostazioni utente → Impostazioni notifiche**, o riducete il volume in **Impostazioni utente → Preferenze e-mail**.
:::

:::details Ho aggiunto un numero di telefono, ma non è nelle mie regole
Un numero entra nelle vostre regole quando è verificato. Fate clic su **Verifica** nella sua riga e inserite il codice. Se il suo riquadro non ha un pulsante per aggiungere, il progetto ha disattivato quel canale. Vedete [Metodi di notifica](/docs/notifications/notification-methods#attivare-un-canale-per-il-progetto).
:::

## Passi successivi

:::cards
- [Metodi di notifica](/docs/notifications/notification-methods): Aggiungete e verificate gli indirizzi su cui OneUptime può raggiungervi.
- [Regole di reperibilità personali](/docs/notifications/on-call-rules): Decidete quale metodo prova ogni chiamata, e quando.
- [Impostazioni notifiche](/docs/notifications/notification-settings): Scegliete gli aggiornamenti di cui venite a sapere, e su quali canali.
- [Regole di escalation](/docs/on-call/escalation-rules): Come una politica di reperibilità decide chi chiamare, livello per livello.
:::
