# Assistenti di programmazione IA

I tuoi ingegneri usano Claude Code, Cursor, Codex, Gemini CLI e Copilot, e le fatture continuano a crescere. Questa pagina risponde alle domande di un responsabile: **chi usa quale strumento, con quali modelli, e quanto spende ogni persona e ogni team**.

La maggior parte degli assistenti di programmazione esporta OpenTelemetry da sé, quindi non c'è niente da installare sulle macchine degli sviluppatori: punta l'esportazione verso OneUptime, e token, costi e uso degli strumenti arrivano accanto alle chiamate di IA delle tue app. Tutto ciò che c'è qui arriva tramite OpenTelemetry; OneUptime non interroga l'API di amministrazione o di fatturazione di nessun fornitore.

:::cards
- [Matrice di supporto](#matrice-di-supporto): Cosa invia ogni strumento, e se nomina una persona.
- [Attribuzione a dipendenti e team](#attribuzione-a-dipendenti-e-team): Le chiavi che mettono un nome e un team sulla spesa.
- [La scheda Utilizzo](#la-scheda-utilizzo): Cosa le tabelle della spesa possono e non possono mostrare per un assistente di programmazione.
- [Da dove iniziare](#da-dove-iniziare): Un ordine di adozione che dà risultati dal primo giorno.
:::

## Come funziona

Ogni strumento invia la sua telemetria all'endpoint OTLP di OneUptime con la tua chiave di acquisizione: da ogni macchina degli sviluppatori, dai server del fornitore (Cursor), o da un gateway attraverso cui passa il tuo traffico verso i modelli.

```mermaid title="Come gli assistenti di programmazione arrivano a OneUptime"
flowchart TB
    subgraph sources["Inviato via OTLP da"]
        direction TB
        machines["Claude Code, Codex, Gemini CLI<br/>e Copilot su ogni macchina"]
        cursor["I server di Cursor"]
        gateway["Un gateway IA"]
        machines ~~~ cursor ~~~ gateway
    end
    sources --> ingest["OneUptime"]
    ingest --> usage["Scheda Utilizzo: dipendente,<br/>team e modello"]
```

## Prima di iniziare

1. Crea una chiave di acquisizione della telemetria in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione**.
2. Il tuo endpoint OTLP è `https://oneuptime.com/otlp`, o `https://YOUR-ONEUPTIME-HOST/otlp` se ospiti OneUptime in proprio.
3. Ogni esportazione invia la chiave nell'header `x-oneuptime-token`.

Una sola chiave di acquisizione per tutta la flotta va bene. Finisce su ogni macchina degli sviluppatori, quindi trattala come una credenziale condivisa che può solo inviare dati, e ruotala come qualsiasi altra.

## Matrice di supporto

Tre cose decidono cosa ottieni da uno strumento: se invia OpenTelemetry, come la sua telemetria arriva a OneUptime, e se qualcosa al suo interno nomina una persona.

| Strumento | Cosa invia | Come arriva a OneUptime | Chi nomina | Guida |
| --- | --- | --- | --- | --- |
| Claude Code | Metriche e log; tracce in beta | Da ogni macchina; variabili d'ambiente o un file di impostazioni gestite | `user.email`, con l'accesso fatto con un account Claude | [Claude Code](/docs/telemetry/claude-code) |
| Cursor | Metriche e log | Dai server di Cursor, configurato una volta nella dashboard di Cursor; solo con il piano Enterprise | `cursor.user.id`, un intero | [Cursor](/docs/telemetry/cursor) |
| OpenAI Codex | Tracce, metriche e log, ciascuno attivato in `~/.codex/config.toml` | Da ogni macchina, un URL completo per segnale | Nessuno su span o metriche: imposti tu `user.id` e `user.email` in `[otel.span_attributes]` | [OpenAI Codex](/docs/telemetry/openai-codex) |
| Gemini CLI | Tracce, metriche e log | Da ogni macchina, di solito tramite un collector locale | `user.email`, con l'accesso fatto | [Gemini CLI e GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot) |
| GitHub Copilot | Tracce, metriche e log, solo dalle sue superfici agente | Dall'editor o dall'host dell'agente | Nessuno: imposti tu `enduser.id` e `user.email` su ogni macchina | [Gemini CLI e GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot) |
| Cline | Metriche e log | Configurato centralmente, nella dashboard dell'organizzazione di Cline | Un `user_id` anonimizzato | — |
| LiteLLM e Portkey | Tracce di ogni chiamata che passa dal gateway | Dal processo del gateway | Con LiteLLM, il proprietario della chiave virtuale | [Gateway IA](/docs/telemetry/ai-gateways) |
| Le tue app | Ciò che invia la tua strumentazione GenAI | Dalla tua app | Chiunque tu imposti come `user.id` | [Osservabilità IA / LLM](/docs/telemetry/ai-llm-observability) |
| Windsurf, JetBrains AI, Amazon Bedrock, Azure OpenAI | Nessun OpenTelemetry proprio | Solo tramite un gateway che metti davanti | Chi nomina il gateway | [Gateway IA](/docs/telemetry/ai-gateways) |

Un trattino significa che OneUptime non ha ancora una guida per lo strumento. La sua telemetria viene comunque acquisita come qualsiasi altro OpenTelemetry.

:::details Cosa esporta esattamente GitHub Copilot
Copilot esporta OpenTelemetry solo dalle sue superfici agente: la chat e la modalità agente di VS Code, l'host dell'agente dietro Copilot CLI, il Copilot SDK, e i workflow agente negli IDE JetBrains tramite il plugin di Copilot. GitHub non documenta alcuna esportazione per i completamenti inline, Copilot su github.com o la revisione del codice di Copilot. Copilot non invia alcun attributo utente, quindi imposta `enduser.id` e `user.email` per macchina tramite `resourceAttributes` o `OTEL_RESOURCE_ATTRIBUTES`.
:::

:::details Amazon Bedrock, Azure OpenAI, Windsurf e JetBrains AI
- **Amazon Bedrock**: le API `InvokeModel` e `Converse` non inviano OpenTelemetry. Bedrock AgentCore è diverso: AWS documenta per esso metriche, span e log, inviati a CloudWatch per impostazione predefinita. Impostare `DISABLE_ADOT_OBSERVABILITY=true` disattiva la configurazione ADOT predefinita del runtime, così puoi puntare l'SDK ADOT verso OneUptime.
- **Azure OpenAI**: il servizio non invia nulla, e le sue metriche di Azure Monitor non hanno una dimensione utente. Strumenta il client, o metti davanti API Management o un altro gateway.
- **Windsurf**: non documenta alcuna esportazione di telemetria. I dati per utente sono nell'API Enterprise di Windsurf, che OneUptime non interroga.
- **JetBrains AI Assistant e Junie**: non esportano l'utilizzo. Il plugin OpenTelemetry di JetBrains riceve la telemetria della tua app dentro l'IDE; non invia nulla all'esterno.
:::

## Attribuzione a dipendenti e team

OneUptime copia in colonne la persona che ha fatto una chiamata, e il suo team, all'arrivo della telemetria, così la scheda **Utilizzo** può ordinare persone e team senza filtri sugli attributi.

### Attributi letti come il dipendente

Su uno span vince la prima chiave presente, in quest'ordine:

| Colonna | Chiavi, dalla preferita |
| --- | --- |
| Id del dipendente | `user.id`, `enduser.id`, `litellm.metadata.user_api_key_user_id`, `metadata.user_api_key_user_id`, `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Email del dipendente | `user.email`, `litellm.metadata.user_api_key_user_email`, `metadata.user_api_key_user_email`, `traceloop.association.properties.user_email`, `enduser.email` |
| Team / centro di costo | `team.id`, `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id`, `litellm.team.id`, `metadata.user_api_key_team_id`, `cursor.team.id` |

Su un punto dati di una metrica l'elenco è più corto e inizia dall'email, perché gli assistenti di programmazione che inviano metriche inviano `user.email` da sé:

| Colonna | Chiavi, dalla preferita |
| --- | --- |
| Dipendente | `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Team / centro di costo | `team.id`, `team`, `cost_center`, `department`, `cursor.team.id` |
| Modello | `gen_ai.request.model`, `model`, `cursor.model.name` |

Come vengono lette queste chiavi:

- **Ogni chiave viene letta anche con il prefisso `resource.`.** L'acquisizione OTLP salva gli attributi di risorsa sotto quel prefisso, quindi `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` arriva come `resource.team.id`. Le chiavi senza prefisso vengono provate per prime, così un valore sullo span batte uno sull'intero processo.
- **La scheda Utilizzo mostra l'email di una persona quando la chiamata ne ha una, altrimenti l'id.** Le righe che mostrano la stessa email vengono sommate, così un ingegnere su due macchine è una sola riga.
- **L'identità viene letta solo dalle chiamate di IA.** `user.id`, `user.email` e `team.id` sono chiavi generiche che portano anche gli span del browser e del backend; solo gli span già riconosciuti come chiamate di IA ricevono le colonne.
- **I record di log non vengono letti per l'identità.** Conta per Codex, che mette `user.email` solo nei suoi log.
- LiteLLM scrive queste chiavi in due modi: il suo callback `otel` predefinito usa il prefisso `metadata.`, e la sua modalità facoltativa OpenTelemetry v2 (`LITELLM_OTEL_V2=true`) lo spazio dei nomi `litellm.`. OneUptime legge entrambi, così un proxy standard funziona senza configurazione aggiuntiva.

### Team e centri di costo

Nessuna strumentazione invia `team.id`, `team`, `cost_center` o `department`: li imposta la tua organizzazione, di solito tramite `OTEL_RESOURCE_ATTRIBUTES` sul processo dello strumento.

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Impostala dove già prepari le macchine degli sviluppatori: un profilo MDM, un file di impostazioni gestite o un profilo della shell dai tuoi dotfile. I valori non possono contenere spazi: usa i trattini bassi, o la codifica percentuale come `%20`. Codex non ha attributi di risorsa, quindi imposta le stesse chiavi nel suo `[otel.span_attributes]`.

Per separare la spesa per applicazione, usa il nome del servizio (`OTEL_SERVICE_NAME`, o l'impostazione propria dello strumento). La suddivisione **Applicazione / Servizio** copre solo gli strumenti che inviano span GenAI.

### Cosa deliberatamente non viene trattato come il dipendente

Una chiamata può portare due persone diverse: il dipendente che l'ha fatta, e il cliente per cui è stata fatta. Queste chiavi portano il cliente, e OneUptime non le legge mai in una colonna di identità:

- `gen_ai.user` e `llm.user`: il modo in cui le strumentazioni riportano il parametro di richiesta `user` di OpenAI, che OpenAI descrive come un identificatore dei tuoi utenti finali.
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` e `litellm.end_user.id`: l'utente finale di LiteLLM, distinto dal proprietario della chiave, che è il dipendente.

Leggere l'id di un cliente come dipendente trasformerebbe un bot di supporto che serve 40.000 clienti in 40.000 dipendenti fantasma, mentre l'ingegnere a cui appartiene la spesa sembrerebbe non spendere nulla. Le chiavi restano negli attributi dello span, e la scheda **LLM** del visualizzatore di tracce le mostra come l'utente finale.

### Privacy

La colonna dell'email del dipendente contiene dati personali. Le **Regole di mascheramento** delle tracce la coprono esattamente come coprono l'attributo da cui è stata letta, quindi una regola che maschera le email maschera anche la colonna. Le trovi in **Tracce → Impostazioni**.

## Metriche degli assistenti di programmazione che OneUptime legge

Gli assistenti di programmazione chiamano le loro metriche con un proprio prefisso invece di `gen_ai.*`, quindi OneUptime conosce ognuna per nome:

| Metrica | Strumento | Unità |
| --- | --- | --- |
| `claude_code.token.usage` | Claude Code | Token |
| `claude_code.cost.usage` | Claude Code | USD |
| `cursor.token.usage` | Cursor | Token |
| `cursor.cost.usage` | Cursor | USD, una stima secondo la stessa Cursor |
| `codex.turn.token_usage` | OpenAI Codex | Token |
| `codex.turn.cost_microusd` | OpenAI Codex | Milionesimi di USD: OneUptime li converte, quindi non farlo tu |

OneUptime legge anche i token da `gen_ai.client.token.usage`, `gen_ai.client.token.count`, `llm.token.usage` e `llm.usage.tokens`, e il costo da `gen_ai.client.cost`, `gen_ai.client.cost.usd`, `gen_ai.usage.cost`, `litellm_spend_metric` e `litellm.cost.total`.

Due cose da sapere prima di leggere i numeri:

- **`gemini_cli.token.usage` è escluso di proposito.** Gemini CLI invia i suoi token due volte, come metrica propria e come `gen_ai.client.token.usage`, e leggerle entrambe li raddoppierebbe. I suoi token vengono contati una volta, tramite `gen_ai.client.token.usage`. Gemini CLI non invia alcuna metrica di costo: attiva le sue tracce perché ogni chiamata abbia un prezzo.
- **Vengono contati solo i token di input e di output.** Il tipo di token viene letto da `gen_ai.token.type`, `llm.token.type`, `type`, `cursor.token.type` o `token_type`, e contano solo `input` e `output` (o i vecchi `prompt` e `completion`). Letture e scritture della cache, il `total` di Codex (che ripete gli altri) e `reasoning_output` (parte di `output`) restano fuori, quindi un totale ricavato dalle metriche è più piccolo della somma di tutto ciò che uno strumento invia.

## La scheda Utilizzo

Apri **Prodotti → AI / LLM** e vai su **Utilizzo**. Ordina **Dipendente**, **Team**, **Modello**, **Provider** e **Applicazione / Servizio** per spesa, negli ultimi 7 giorni se non scegli un altro intervallo. Le chiamate che non nominano nessuno vengono contate in **Non attribuito**: una grande riga **Non attribuito** ti dice quale strumento ha ancora bisogno della sua identità.

### Le metriche degli assistenti di programmazione sono un ripiego, non un'aggiunta

Gli span GenAI vengono prima: le metriche vengono lette solo per un valore per cui gli span non hanno riportato nulla, e le due cose non vengono mai sommate ([perché](/docs/telemetry/ai-llm-observability#prima-gli-span-le-metriche-colmano-i-vuoti)). Per gli assistenti di programmazione questo ha una conseguenza netta: **se lo stesso progetto riceve span GenAI con un costo, la spesa degli assistenti di programmazione non compare.** Dai agli assistenti di programmazione un progetto tutto loro, con la sua chiave di acquisizione.

Quando il ripiego si applica, ecco cosa può mostrare ogni suddivisione per uno strumento che invia solo metriche:

| Suddivisione | Dalle metriche |
| --- | --- |
| **Dipendente** | Sì, da ogni chiave di identità qui sopra, senza prefisso e con il prefisso `resource.` |
| **Team** | Sì, dalle chiavi del team |
| **Modello** | Sì: Claude Code e Codex inviano un `model` senza prefisso, Cursor `cursor.model.name` |
| **Provider** | No: le metriche degli assistenti di programmazione non nominano alcun provider |
| **Applicazione / Servizio** | No: le loro metriche non appartengono ad alcun servizio OneUptime |

Una riga letta dalle metriche porta solo il costo: le sue celle di chiamate e token mostrano `—`, perché un contatore di spesa non ha dettagli per chiamata, e uno 0 lì direbbe che la persona non ha fatto chiamate. La tabella porta la dicitura **dalle metriche GenAI**.

## Niente OpenTelemetry? Metti davanti un gateway

Per Windsurf, JetBrains AI, le API dei modelli di Bedrock, Azure OpenAI e qualsiasi altra cosa senza un'esportazione propria, metti davanti un gateway IA. Ogni chiamata passa allora da un unico processo che invia OpenTelemetry, e configuri l'esportazione una sola volta.

**Usa LiteLLM con una chiave virtuale per dipendente.** LiteLLM mette su ogni span l'id e l'email del proprietario della chiave, che OneUptime legge come il dipendente, e il team della chiave come il team. Calcola anche da sé il prezzo di ogni chiamata, con le tariffe personalizzate che imposti sul proxy, e il costo che riporta vince sulla stima di OneUptime. Non usare per questo il suo id di utente finale: quello è il cliente. La configurazione è in [Gateway IA](/docs/telemetry/ai-gateways).

Due limiti prima di organizzarti attorno a un gateway:

- **Un gateway vede solo il traffico che passa da lui.** L'override dell'URL di base di Cursor è un'impostazione per utente che copre solo i modelli di chat (il completamento con Tab continua a usare i modelli di Cursor), quindi preferisci l'esportazione nativa di Cursor.
- **Un gateway vede la chiamata al modello, non l'agente.** Registra prompt e risposte, ma non le chiamate a strumenti, le modifiche ai file e le decisioni di accettare o rifiutare che riporta la telemetria propria di uno strumento.

## Contenuto dei prompt: i valori predefiniti cambiano da strumento a strumento

Prompt e risposte sono i dati più rischiosi di questa pipeline: contengono abitualmente codice sorgente, dati dei clienti e credenziali incollate. Controlla il valore predefinito di ogni strumento:

| Strumento | Contenuto dei prompt per impostazione predefinita |
| --- | --- |
| Claude Code | Disattivato: ogni tipo di contenuto ha la sua variabile per attivarlo |
| Cursor | Disattivato: solo la famiglia facoltativa `conversation_content` invia il testo dei messaggi |
| OpenAI Codex | Disattivato: `log_user_prompt` vale `false` per impostazione predefinita |
| Gemini CLI | **Attivato**: `logPrompts` vale `true` per impostazione predefinita, quindi impostalo a `false` quando attivi la telemetria |
| GitHub Copilot | Disattivato: `captureContent`, che le impostazioni gestite possono bloccare con `lockCaptureContent` |
| LiteLLM | Attivato con il callback `otel` predefinito (disattivalo con `turn_off_message_logging`); disattivato in modalità OpenTelemetry v2 |

Codex invia anche le sue metriche a OpenAI per impostazione predefinita: vedi [OpenAI Codex](/docs/telemetry/openai-codex). Dove catturi il contenuto di proposito, le **Regole di mascheramento** e i **Filtri di scarto** delle tracce si applicano come a qualsiasi altra telemetria.

## Cosa OneUptime non fa ancora

- **Nessun connettore di amministrazione o di fatturazione dei fornitori.** OneUptime non interroga l'Admin API di Anthropic, l'Admin API di Cursor, gli endpoint di utilizzo e costi di OpenAI, la fatturazione di Copilot di GitHub, né le API di Windsurf o di JetBrains. Per cifre da fattura, prendile dal fornitore.
- **Il costo è una stima, a meno che uno strumento non lo riporti.** Un costo riportato viene usato così com'è; altrimenti OneUptime calcola il prezzo dei token con i prezzi di listino. Lo stesso `cursor.cost.usage` di Cursor è una stima.
- **L'identità sui record di log non viene letta.** Lo `user.email` di Codex, che invia solo nei log, non viene collegato alla spesa.
- **Il `cursor.user.email` di Cursor non viene ancora letto**, quindi gli utenti di Cursor compaiono con il loro intero `cursor.user.id`.
- **Gli span di Codex non nominano alcun modello**, quindi OneUptime non può dar loro un prezzo: Codex mostra i token per persona, e il suo costo solo nei totali.
- **Gli strumenti cambiano in fretta.** Se questa pagina dice che uno strumento non ha un'esportazione, controlla la sua documentazione attuale prima di costruire attorno a un gateway.

## Da dove iniziare

Procedi in quest'ordine; ogni passaggio è utile da solo. Usa un progetto che non riceve già span GenAI dalle tue app, altrimenti [la regola del ripiego](#le-metriche-degli-assistenti-di-programmazione-sono-un-ripiego-non-unaggiunta) tiene la spesa degli assistenti di programmazione fuori dalla pagina.

1. **Gemini CLI**, se qualcuno lo usa. Invia `user.email` senza configurazione, quindi mostra l'attribuzione funzionante da capo a fondo. Attiva anche le sue tracce: non invia alcuna metrica di costo.
2. **Claude Code**: un file di impostazioni gestite per la flotta, `user.email` gratis, una vera metrica di costo, e tasso di accettazione, commit, pull request e righe di codice per sviluppatore.
3. **Cursor**, con il piano Enterprise: una schermata nella dashboard di Cursor, nessuna macchina degli sviluppatori toccata, anche se le persone arrivano come interi.
4. **Copilot e Codex**, che richiedono entrambi un'identità impostata su ogni macchina. Fallo quando prepari le macchine: le chiamate arrivate senza identità non possono essere attribuite dopo.
5. **Un gateway LiteLLM** per tutto il resto, con una chiave virtuale per dipendente.

## Passaggi successivi

:::cards
- [Claude Code](/docs/telemetry/claude-code): Attiva l'esportazione di Claude Code per una macchina o per tutta la flotta.
- [Cursor](/docs/telemetry/cursor): Invia la telemetria del team di Cursor dalla dashboard di Cursor.
- [OpenAI Codex](/docs/telemetry/openai-codex): Configura i tre esportatori di Codex e metti un'identità sui suoi span.
- [Osservabilità IA / LLM](/docs/telemetry/ai-llm-observability): Conversazioni, avvisi, costi e budget per ogni chiamata di IA.
:::
