# Episodi

Un episodio raggruppa incidenti correlati, o avvisi correlati, perché il vostro team li gestisca come uno solo: un unico posto in cui vederli, un unico gruppo di proprietari, un unico stato da riconoscere e risolvere. Le regole di raggruppamento aprono episodi e vi aggiungono incidenti e avvisi man mano che arrivano (vedete [Regole di raggruppamento degli incidenti](/docs/incidents/settings#regole-di-raggruppamento-degli-incidenti)). Potete anche mettere voi stessi degli incidenti in un episodio, più di uno alla volta: dall'episodio oppure dagli elenchi degli incidenti.

Tutto ciò che è descritto in questa pagina funziona allo stesso modo per gli episodi di avvisi: leggete «avviso» dove c'è scritto «incidente». Gli episodi di incidenti si trovano in **Incidenti → Episodi**, quelli di avvisi in **Avvisi → Episodi**.

## Aggiungere incidenti da un episodio

Aprite l'episodio, scegliete **Incidenti dei membri** nel menu laterale (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) e fate clic su **Aggiungi incidenti**. La finestra elenca i 50 incidenti più recenti che potete vedere e che non sono ancora nell'episodio, ciascuno con numero, titolo, stato e gravità. Per trovarne uno più vecchio, cercate per titolo o per numero: `INC-42`, `42` e `#42` trovano tutti l'incidente 42.

- Selezionate tutti quelli che vi servono, fino a 100 alla volta. Il pulsante li conta: **Aggiungi 3 elementi (Incidenti)**.
- Un incidente che è già in un altro episodio lo indica sotto il titolo, con il numero di quell'episodio. Aggiungerlo qui lo lascia anche lì: un incidente può far parte di più episodi.
- Se alcuni non possono essere aggiunti, la finestra resta aperta e li elenca con il motivo; gli altri vengono aggiunti.

## Aggiungere incidenti dagli elenchi degli incidenti

Selezionate gli incidenti nell'elenco **Incidenti**, o in qualsiasi altro elenco di incidenti come quello di un monitor, e aprite **Azioni di massa**:

| Azione | Cosa fa |
| --- | --- |
| **Aggiungi a un episodio esistente** | Scegliete un episodio. Prima vengono gli episodi in corso, dal più recente, poi quelli risolti di recente; cercate per titolo o numero per trovarne qualsiasi altro. Prima di aggiungere, la finestra dice quanti degli incidenti selezionati sono già in quell'episodio, e restano come sono, e quanti sono in un altro episodio, dove restano. |
| **Aggiungi a un nuovo episodio** | Crea un episodio che contiene gli incidenti selezionati. Chiede solo un titolo e una gravità, entrambi compilati in base all'incidente selezionato più grave; il titolo di un incidente privato non viene mai copiato. Aggiungete proprietari, criteri di reperibilità e note nella pagina dell'episodio. |

Entrambe accettano fino a 100 incidenti selezionati. Il risultato dice quanti sono stati aggiunti, quanti erano già nell'episodio e quali non sono stati aggiunti e perché, con un link che apre l'episodio.

## Cosa fa l'aggiunta

- **Una sola voce nel feed dell'episodio** nomina ogni incidente aggiunto: i primi 20 per numero e titolo, poi quanti altri. Viene pubblicata una sola volta nel canale Slack o Microsoft Teams dell'episodio, non una volta per incidente. Un incidente privato viene indicato solo con il suo numero.
- **Il feed di ogni incidente** dice a quale episodio è stato aggiunto.
- **La gravità dell'episodio** sale a quella dell'incidente più grave aggiunto a un episodio esistente, e non scende mai. Un nuovo episodio parte con la gravità che scegliete.
- **Un episodio risolto resta risolto.** Aggiungervi incidenti non lo riapre, e l'aggiunta non cambia mai lo stato di un incidente.
- **I proprietari dell'episodio vengono avvisati** che sono stati aggiunti incidenti, come quando ne viene aggiunto uno solo. Quando l'episodio viene creato con loro, la sua notifica di creazione li comprende.

## Togliere un incidente

In **Incidenti dei membri**, **Rimuovi** su una riga, o sulle righe selezionate da **Azioni di massa**, toglie l'incidente solo da questo episodio. L'incidente in sé non viene eliminato e resta in ogni altro episodio di cui fa parte.

## Chi può aggiungere

Per aggiungere serve il permesso di aggiungere incidenti a un episodio, che hanno i ruoli Project Owner, Project Admin, Project Member, Incident Admin e Incident Member, oltre a un ruolo personalizzato con Create Incident Episode Member. Potete aggiungere solo incidenti che potete vedere: un incidente privato può essere aggiunto solo dai suoi proprietari e dai proprietari e amministratori del progetto. Aggiungi a un nuovo episodio richiede anche il permesso di creare un episodio. Quando non potete usare un'azione, è bloccata e il suo suggerimento nomina il permesso che manca.

## Con l'API

Aggiungete più incidenti a un episodio con una sola richiesta:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

La risposta nomina ogni incidente inviato, una sola volta: aggiunto, già nell'episodio, oppure non aggiunto e perché. Una richiesta con più di 100 ID viene rifiutata.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

Per gli avvisi, inviate `alertEpisodeId` e `alertIds` a `/api/alert-episode-member/add-alerts`. Per creare un episodio che contiene degli incidenti, inviate i loro ID con la richiesta che crea l'episodio, `POST /api/incident-episode`, come `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; per un episodio di avvisi, `POST /api/alert-episode` con `alertIdsToAdd`. Se uno di essi non può essere aggiunto, non viene creato alcun episodio.
