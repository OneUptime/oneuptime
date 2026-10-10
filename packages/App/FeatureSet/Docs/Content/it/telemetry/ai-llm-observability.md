# Osservabilità IA / LLM con OneUptime

Leggi ogni conversazione avuta dalla tua IA, riproducila così come è avvenuta e vieni avvisato quando risponde male. Tutto si basa su OpenTelemetry standard, senza SDK proprietari: se la tua app emette span con le **convenzioni semantiche GenAI** di OpenTelemetry (`gen_ai.*`), OneUptime li trasforma in conversazioni, avvisi, utilizzo e costi.

## Cosa ottieni

Apri **IA / LLM** nella barra di navigazione, sotto Osservabilità:

- **Conversazioni** — ogni conversazione avuta dalla tua IA: cosa hanno chiesto le persone, cosa ha risposto l'IA, gli strumenti che ha usato e cosa è andato storto. Sopra l'elenco ci sono cinque numeri: conversazioni, risposte dell'IA, quante richiedono attenzione, costo e quanto dura di solito una risposta. Apri una conversazione per leggerla o riprodurla.
- **Chiamate** — ogni chiamata di LLM, embedding, agente e strumento, filtrabile per servizio, provider, modello, operazione, persona e team. Fai clic su una chiamata per aprirla nel visualizzatore di tracce.
- **Utilizzo** — le chiamate, i token e il costo di un intervallo di tempo, e chi spende cosa: dipendenti, team, modelli, provider e app ordinati per spesa.
- **Avvisi** — avvisi pronti all'uso per quando l'IA risponde male, e i tuoi monitor IA / LLM.
- **Budget** — limiti di costo giornalieri, pubblicati come metriche su cui impostare avvisi.
- **Prezzi** — i tuoi prezzi per modello, per i modelli che il catalogo integrato non conosce.
- **Configurazione** — i cinque passaggi qui sotto, con l'endpoint del tuo progetto.

Nel visualizzatore di tracce, lo span di ogni chiamata all'IA ha anche un pannello **IA / LLM** con il modello, il numero di token, il costo, i parametri della richiesta, e il prompt e il completamento.

## Passaggio 1 — Invia le chiamate alla tua IA

Crea una chiave di acquisizione della telemetria: apri **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione** e fai clic su **Crea chiave di ingestione**. La tua app passa la chiave come header OTLP. (Vedi la [guida a OpenTelemetry](/docs/telemetry/open-telemetry) per gli screenshot.)

Poi strumenta la tua app con una qualsiasi libreria GenAI di OpenTelemetry:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI e altri.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy e altri.
- Il **Vercel AI SDK**, oppure le **strumentazioni OpenTelemetry** per OpenAI, Anthropic e Gemini.

Instradi il traffico LLM attraverso un gateway come **LiteLLM** o **Portkey**? Esporta le tracce dal gateway invece di strumentare ogni app — vedi [Osservare i gateway IA](/docs/telemetry/ai-gateways). Cerchi gli assistenti di programmazione usati dai tuoi ingegneri — Claude Code, Cursor, Codex, Gemini CLI, Copilot? Esportano il proprio OpenTelemetry e non hanno bisogno di nulla da parte tua: vedi [Osservabilità degli assistenti di programmazione IA](/docs/telemetry/ai-coding-assistants).

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### Semplici variabili d'ambiente OpenTelemetry

Se strumenti con un SDK OpenTelemetry nativo, punta l'esportatore OTLP verso OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Ospiti OneUptime in autonomia? Sostituisci `https://oneuptime.com/otlp` con `https://YOUR-ONEUPTIME-HOST/otlp`.

## Passaggio 2 — Registra cosa è stato detto

Una conversazione mostra cosa hanno chiesto le persone e cosa ha risposto l'IA quando la tua strumentazione li registra. OpenLLMetry registra prompt e completamenti a meno che tu non lo disattivi (`TRACELOOP_TRACE_CONTENT=false`). Le strumentazioni OpenTelemetry li registrano solo se lo chiedi:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Senza di essi, una conversazione mostra comunque i suoi tempi, il suo costo e i suoi problemi, e indica che il suo contenuto non è stato registrato. I prompt possono contenere dati sensibili: vedi [Privacy e oscuramento](#privacy-e-oscuramento) per mascherarli prima che vengano archiviati.

## Passaggio 3 — Raggruppa le chiamate in conversazioni

Un'app di chat fa una chiamata al modello per ogni turno. Imposta `gen_ai.conversation.id` — oppure `session.id` — sull'id della tua chat in ogni chiamata all'IA, e ogni chat appare come un'unica conversazione, indipendentemente da quante chiamate e tracce abbia richiesto. Con OpenLLMetry, impostalo una volta per richiesta come proprietà di associazione:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Anche le chiamate senza id di conversazione vengono mostrate, una richiesta (una traccia) alla volta.

## Passaggio 4 — Indica chi ha chiesto

Imposta `user.id` o `user.email` — la proprietà di associazione qui sopra imposta l'email — per vedere con chi è avvenuta ogni conversazione, cercare nell'elenco per persona e ordinare la spesa per dipendente nella scheda Utilizzo. [Attribuzione a dipendenti e team](#attribuzione-a-dipendenti-e-team) elenca tutte le chiavi che OneUptime legge.

## Passaggio 5 — Segnala le risposte sbagliate

OneUptime controlla ogni risposta appena arriva e segna cosa è andato storto:

| Problema     | Cosa significa                                                       | Rilevato da                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non riuscito | La chiamata è terminata con un errore, quindi non è arrivata alcuna risposta | Stato dello span Error, `error.type`, oppure un motivo di fine `error`                                                                                                     |
| Rifiutato    | L'IA ha rifiutato, oppure un filtro di sicurezza l'ha bloccata       | Un motivo di fine di rifiuto o di sicurezza (`content_filter`, `refusal`, `SAFETY` e simili), un rifiuto nella risposta, oppure una risposta che inizia con un tipico rifiuto in inglese |
| Troncato     | La risposta si è fermata al limite di token                          | Un motivo di fine `length`, `max_tokens` o `MAX_TOKENS`                                                                                                                          |
| Vuoto        | L'IA ha risposto senza testo e senza chiamate a strumenti            | Contenuto registrato che non contiene nulla, oppure 0 token in uscita                                                                                                            |
| Segnalato    | Una valutazione inviata dalla tua app ha giudicato la risposta sbagliata | Un evento `gen_ai.evaluation.result`                                                                                                                                        |

I primi quattro non richiedono nulla da parte tua. Per segnalare il resto — una risposta che il tuo guardrail, il tuo eval o il tuo giudice LLM rifiuta — aggiungi un evento `gen_ai.evaluation.result` allo span della risposta, con `gen_ai.evaluation.score.label` impostato su `fail`:

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

Anche etichette come `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` e `hallucination` contano come esito negativo. L'evento deve trovarsi sullo span della risposta che giudica, mentre quello span è aperto.

OneUptime non invia mai le tue conversazioni a un'altra IA per giudicarle: ogni controllo legge solo ciò che la chiamata stessa porta con sé.

## Leggere e riprodurre una conversazione

Una conversazione si apre per intero, come un'app di chat mostra la sua cronologia: ciò che la persona ha detto a destra, le risposte dell'IA a sinistra con modello, ora, token e costo, le chiamate agli strumenti in mezzo, e ciò che è andato storto segnato nel punto in cui è successo. **Dettagli** sotto una risposta mostra il suo motivo di fine e le sue valutazioni, con un link alla chiamata in Tracce.

La barra in basso riproduce la conversazione così come la persona l'ha vissuta:

- **Riproduci di nuovo** la riproduce dal primo messaggio al ritmo in cui è avvenuta, con «L'IA sta rispondendo…» che conta mentre una risposta è in arrivo. Fai clic sull'ora di un messaggio qualsiasi per riprodurre da lì.
- **Salta le attese**, attivo per impostazione predefinita, accorcia i silenzi più lunghi di 3 secondi. Il pulsante della velocità riproduce a 1×, 2×, 4× o 8×.
- **K** riproduce o mette in pausa, **J** o **←** torna indietro di un messaggio, e **L** o **→** va avanti di uno.
- L'indirizzo conserva il messaggio a cui si è fermata una riproduzione (`?step=`), così un link si apre su quel momento.

## Vieni avvisato quando l'IA risponde male

La scheda **Avvisi** propone gli avvisi che servono alla maggior parte delle app di IA. Sceglierne uno apre Crea monitor già compilato, dove puoi cambiare qualsiasi cosa prima di salvare:

| Avviso                           | Quando ti avvisa                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Le risposte vanno male           | Più del 5% delle risposte in 15 minuti fallisce, viene rifiutato, troncato, è vuoto o segnalato        |
| Le chiamate all'IA falliscono    | Più del 10% delle chiamate al modello in 5 minuti termina con un errore                                |
| L'IA rifiuta di rispondere       | Più del 5% delle risposte in 30 minuti sono rifiuti                                                    |
| Le risposte vengono troncate     | 3 o più risposte in 30 minuti si fermano al limite di token                                            |
| Le risposte vengono segnalate    | Una valutazione segna una risposta come sbagliata                                                      |
| Le risposte sono lente           | Più del 10% delle risposte in 15 minuti impiega più di 30 secondi                                      |
| L'IA smette di rispondere        | L'IA non dà alcuna risposta per 30 minuti                                                              |

Gli avvisi su una percentuale aspettano anche almeno 3 risposte sbagliate, così una risposta sbagliata su due non sveglia nessuno.

Ogni avviso è un monitor **IA / LLM**. Le sue impostazioni dicono cosa conta come risposta sbagliata — i problemi qui sopra, una risposta più lenta di un limite che imposti tu, o entrambi —, quali app e quale modello osserva, e quanto indietro guarda ogni controllo. Sotto, un'anteprima mostra cosa conterebbe il monitor in questo momento. I suoi criteri confrontano tre numeri: la **quota di risposte sbagliate** (in %), il **numero di risposte sbagliate** e il **numero di risposte**. Un avviso pronto all'uso genera un avviso che si risolve da solo e mostra il monitor come Degradato finché le risposte sono sbagliate; attiva invece il suo incidente per chiamare qualcuno.

La spesa è sorvegliata dai [budget di costo giornalieri](#budget-di-costo-giornalieri).

## Attributi riconosciuti da OneUptime

OneUptime legge prima le convenzioni GenAI di OpenTelemetry e ripiega sulle varianti di OpenLLMetry e OpenInference, così le librerie più diffuse funzionano subito.

| Cosa                                  | Attributo principale         | Accettati anche                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider / sistema                    | `gen_ai.provider.name`       | `gen_ai.system` (deprecato nelle convenzioni, ancora molto emesso), `llm.system`, `llm.provider`                                                                                                                                                                         |
| Operazione                            | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Modello richiesto                     | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Modello della risposta                | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Token in entrata                      | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Token in uscita                       | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Token totali                          | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; ricavati da entrata + uscita quando nessuno dei due è riportato                                                                                                                                                       |
| Costo (USD)                           | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Nome dell'agente                      | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Nome dello strumento                  | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Id di conversazione / sessione        | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Dipendente (chi ha fatto la chiamata) | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` e `metadata.user_api_key_user_id` (grafie di LiteLLM OTel v2 e v1 — vengono lette entrambe), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Email del dipendente                  | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / centro di costo                | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` e `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                   |

Le sottochiavi di `traceloop.association.properties.*` sono **fornite dal chiamante**: Traceloop definisce il prefisso e il tuo codice fornisce ciò che sta sotto. `gen_ai.usage.total_tokens` e `gen_ai.usage.cost` sono chiavi **de facto**, non convenzioni semantiche GenAI — le convenzioni non definiscono né un attributo per i token totali né uno per il costo —, e OneUptime le legge perché le strumentazioni comuni le emettono. `gen_ai.system` è il predecessore deprecato di `gen_ai.provider.name` nelle convenzioni stesse; vengono letti entrambi.

**Le tre righe di identità vengono cercate anche con un prefisso `resource.`.** L'acquisizione OTLP appiattisce ogni attributo di _risorsa_ nella mappa degli attributi dello span sotto un prefisso `resource.`, così `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` arriva come `resource.team.id`. OneUptime cerca prima in tutto l'elenco senza prefisso, poi in tutto l'elenco `resource.`, così un attributo dello span (che descrive una chiamata) prevale su un attributo di risorsa (che descrive l'intero processo). Le altre righe vengono cercate solo sulla chiave senza prefisso: sono valori per singola chiamata.

**Il contenuto di prompt e completamenti** viene letto dall'evento `gen_ai.client.inference.operation.details`; dagli attributi dello span `gen_ai.input.messages`, `gen_ai.output.messages` e `gen_ai.system_instructions`; dagli eventi per ruolo **deprecati** che le strumentazioni più vecchie emettono ancora (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); dagli attributi indicizzati (`gen_ai.prompt.N.content` e `gen_ai.completion.N.content`, e per OpenInference `llm.input_messages.N.message.content` e `llm.output_messages.N.message.content`); e dagli array di messaggi JSON (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Come viene calcolato il costo

Se la tua strumentazione riporta un costo (`gen_ai.usage.cost`), OneUptime lo usa così com'è: il valore riportato vince sempre. Quando non viene riportato alcun costo, OneUptime calcola un **costo stimato in fase di acquisizione** a partire dal numero di token dello span e da un catalogo integrato di prezzi di listino dei modelli comuni di OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova e Meta Llama. I modelli vengono riconosciuti dal prefisso del nome, così snapshot datati come `gpt-4o-2024-08-06` e id decorati dal fornitore come `us.anthropic.claude-3-5-sonnet-20241022-v2:0` vengono risolti correttamente. I modelli sconosciuti o personalizzati non vengono mai indovinati — il loro costo resta `0` finché non dai loro un prezzo nella scheda **Prezzi**. Le stime usano i prezzi di listino e non tengono conto degli sconti per cache o batch.

Ospiti OneUptime in autonomia? Il catalogo si trova in `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Attribuzione a dipendenti e team

«Quale dei nostri ingegneri ha speso 4.000 $ in Opus il mese scorso» è una domanda su una persona, e nessuno span LLM vi risponde a meno che qualcosa sullo span non nomini qualcuno. OneUptime copia l'attore umano in colonne interrogabili durante l'acquisizione, così raggruppi e filtri su una colonna invece di scrivere ricerche sugli attributi.

Le tre righe di identità della tabella qui sopra sono l'intero meccanismo; vince la prima chiave presente, nell'ordine indicato. `user.id` è in testa perché è la chiave canonica di OpenTelemetry per un attore umano ed è quella su cui standardizzarti se imposti l'identità da solo. **Un'eccezione: Claude Code** emette `user.id` come identificatore anonimo casuale conservato in `~/.claude.json`, non come una persona. Sui suoi punti dati di metriche, il cui elenco parte dall'email, è innocuo, ma se attivi la beta delle tracce di Claude Code, lo `user.id` anonimo passa davanti a `user.email` sugli span: elimina o rimappa `user.id` in un processore del collector per quella flotta. `enduser.id` è ancora un attributo attivo delle convenzioni semantiche ed è accettato come alias equivalente. `cursor.user.id` viene per ultimo perché è un intero opaco, legato al team, che richiede l'API di amministrazione di Cursor per risalire a una persona.

L'identità viene letta solo sugli span già riconosciuti come chiamate LLM: `user.id`, `user.email` e `team.id` sono chiavi generiche che portano anche gli span del browser e dei normali backend. I **punti dati di metriche** portano un elenco più breve che parte dall'email — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, con i team da `team.id`, `team`, `cost_center`, `department` e `cursor.team.id`, ciascuno cercato anche con il prefisso `resource.` —, perché le CLI degli agenti di programmazione che emettono metriche senza span emettono `user.email` in modo nativo. Oggi nulla legge l'identità dai **record di log**.

### Impostare il team e il centro di costo

Nessuna strumentazione emette `team.id`, `team`, `cost_center` o `department`: li imposta la tua organizzazione, di solito tramite `OTEL_RESOURCE_ATTRIBUTES` sul processo:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Arrivano in OneUptime come `resource.team.id`, `resource.team`, `resource.cost_center` e `resource.department`, ed entrambi i livelli vengono riconosciuti sugli span e sui punti dati di metriche, sia che il tuo esportatore lasci le chiavi nel blocco di risorsa OTLP sia che le copi su ogni span (Claude Code fa la seconda cosa). Un `team.id` senza prefisso impostato direttamente su uno span vince comunque.

Le grafie dei gateway arrivano senza alcuna configurazione da parte tua. LiteLLM chiama i suoi attributi in modo diverso nelle sue due modalità OpenTelemetry — il callback `otel` v1 predefinito usa un semplice prefisso `metadata.` (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), la modalità v2 opzionale (`LITELLM_OTEL_V2=true`) lo spazio dei nomi `litellm.` —, e **OneUptime le legge entrambe**.

### Le chiavi dei clienti sono escluse di proposito

Uno span LLM può portare **due** persone diverse: il dipendente che ha fatto la chiamata e il **cliente** a valle per cui è stata fatta. Queste chiavi portano il cliente, e OneUptime deliberatamente non ne legge **nessuna** in una colonna di identità:

- `gen_ai.user` e `llm.user` — il modo in cui le strumentazioni riportano il parametro di richiesta `user` di OpenAI, che OpenAI documenta come «a stable identifier for your end-users» (ora deprecato a favore di `safety_identifier` e `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` e `litellm.end_user.id` — l'id esplicito dell'utente finale di LiteLLM in tutte e tre le grafie, distinto dall'id del proprietario della chiave, che **è** il dipendente e **viene** letto.

Il motivo è la correttezza dell'addebito interno: leggi un id cliente nella colonna del dipendente e un bot di assistenza che serve 40.000 clienti crea 40.000 «dipendenti» fantasma, mentre l'ingegnere a cui appartiene la spesa sembra non aver speso nulla. Questi attributi restano nella mappa degli attributi grezza, dove puoi interrogarli direttamente.

### Le colonne di identità vengono ripulite

La colonna dell'email del dipendente contiene dati personali reali. Le tue **Regole di mascheramento** della telemetria nell'ambito **Attributi** la coprono esattamente come coprono l'attributo da cui è stata letta, così una regola di oscuramento delle email vale anche per la colonna. Configura le regole di mascheramento e i filtri di scarto in **Tracce → Impostazioni**.

## Span e metriche sono un ripiego, non una somma

**Gli span GenAI fanno fede. Il flusso delle metriche viene consultato solo quando il flusso degli span non ha riportato nulla, e i due non vengono mai sommati.** Uno span porta modello, token e costo in un'unica riga, quindi dove ci sono span, rispondono a ogni domanda. Dove non ci sono — le CLI degli agenti di programmazione pubblicano _metriche_ di token e costo e nessuno span GenAI —, subentra il flusso delle metriche. Non vengono sommati perché molte strumentazioni emettono entrambi i segnali per la stessa chiamata (OpenLLMetry è il caso tipico), e sommarli conterebbe ogni dollaro due volte.

La conseguenza da mettere in conto: **non appena i tuoi span GenAI riportano un valore diverso da zero, il contributo di una sorgente solo di metriche a quel valore non compare.** Il ripiego vale per valore e per suddivisione, non per emettitore:

| Dove                                              | Cosa ripiega sulle metriche                                | Quando                                          |
| ------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Utilizzo → Token in entrata / Token in uscita     | Totali dei token in entrata e in uscita                    | Entrambe le somme di token degli span sono 0    |
| Utilizzo → Costo (USD)                            | Costo, in USD e micro-USD, scalato e sommato               | La somma dei costi degli span è 0               |
| Utilizzo → Chiamate LLM                           | Niente — solo span                                         | —                                               |
| Utilizzo → Dipendente, Team, Modello              | Solo il costo. Le colonne di chiamate e token mostrano `—` | Quella suddivisione non ha restituito righe di span |
| Utilizzo → Provider, Applicazione / Servizio      | Niente — solo span                                         | —                                               |
| Conversazioni                                     | Niente — le conversazioni sono costruite dagli span        | —                                               |

Provider e Applicazione / Servizio non hanno un ripiego sulle metriche perché i contatori degli agenti di programmazione non portano alcun attributo di provider GenAI e non sono collegati ad alcun servizio di telemetria di OneUptime. Ovunque un valore provenga dalle metriche, la pagina lo etichetta **dalle metriche GenAI**, perché un valore ricavato dalle metriche non ha righe corrispondenti nell'elenco Chiamate.

**Se ti serve che la spesa di uno strumento solo di metriche sia visibile a sé, dagli un progetto tutto suo**, così il suo flusso di span è davvero vuoto e il ripiego entra in azione. Lo stesso vale per i budget: imposta un budget per servizio invece di mescolare servizi che emettono span e servizi solo di metriche.

## Dashboard e avvisi sulle metriche

Le metriche GenAI arrivano come normali metriche OpenTelemetry, quindi puoi creare **dashboard** che rappresentano `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` e il resto, e creare **monitor delle metriche** su di esse — per esempio quando il p95 di `gen_ai.client.operation.duration` supera una soglia, raggruppato per modello. Vedi [Monitor metriche](/docs/monitor/metrics-monitor).

## Budget di costo giornalieri

La scheda **Budget** imposta limiti giornalieri in USD, valutati sulla giornata UTC. Ogni 15 minuti un worker in background somma il costo degli span LLM della giornata (riportato o calcolato), lo registra sul budget e pubblica due metriche di tipo gauge:

| Metrica                             | Significato                                       |
| ----------------------------------- | ------------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | La spesa della giornata finora, in USD            |
| `oneuptime.llm.budget.percent.used` | La spesa come percentuale del limite giornaliero  |

Entrambe portano gli attributi `oneuptime.llm.budget.id` e `oneuptime.llm.budget.name`, più l'ambito di servizio, provider e modello del budget quando è impostato. Filtra i monitor per **`oneuptime.llm.budget.id`**, che è stabile; il nome cambia quando rinomini il budget.

**Per gli avvisi si usa un [Monitor metriche](/docs/monitor/metrics-monitor) su quelle metriche.** Per lo schema classico 80% / 100%, crea un monitor su `oneuptime.llm.budget.percent.used`, filtralo per `oneuptime.llm.budget.id` e aggiungi due criteri: `>= 80` che crea un avviso di avvertimento e `>= 100` che ne crea uno critico. **Imposta la finestra temporale mobile del monitor a 30 minuti**: un budget pubblica un punto ogni 15 minuti, quindi la finestra predefinita di 1 minuto troverebbe una serie vuota tra due passaggi.

I budget possono essere limitati a un servizio di telemetria, a un provider LLM o a un modello esatto, oppure valere per tutto il progetto, e ne possono coesistere diversi. Un monitor di budget può anche chiamare un Workflow che ferma un agente fuori controllo — vedi [Circuit breaker per agenti IA fuori controllo](/docs/telemetry/ai-agent-circuit-breaker).

## Privacy e oscuramento

Prompt e completamenti possono contenere dati sensibili. OneUptime applica le tue **Regole di mascheramento** e i tuoi **Filtri di scarto** della telemetria agli span LLM come a qualsiasi altra traccia, così puoi mascherare attributi o scartare span prima che vengano archiviati; configurali in **Tracce → Impostazioni**. La colonna dell'email del dipendente è coperta dalle stesse regole — vedi [Le colonne di identità vengono ripulite](#le-colonne-di-identità-vengono-ripulite).

Le conversazioni si leggono con la stessa autorizzazione delle tracce: chi può leggere le tracce del progetto può leggerne le conversazioni, e nessun altro.

## Correlati

- [Osservabilità degli assistenti di programmazione IA](/docs/telemetry/ai-coding-assistants) — la matrice di supporto per Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline e gli altri, e come funziona la spesa per dipendente tra di essi.
- [Monitorare Claude Code](/docs/telemetry/claude-code)
- [Monitorare Cursor](/docs/telemetry/cursor)
- [Monitorare OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Monitorare Gemini CLI e GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Osservare i gateway IA (LiteLLM e Portkey)](/docs/telemetry/ai-gateways)
- [Circuit breaker per agenti IA fuori controllo](/docs/telemetry/ai-agent-circuit-breaker)
