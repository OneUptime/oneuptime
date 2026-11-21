# OneUptime AI in Data Security

OneUptime AI works on what Data Security found without seeing your data. It is sent names, shapes, counts and configuration, never a value of your data, a masked sample, a record or a connection string. Every feature runs on your project's own model, a self-hosted one included, and every page, check, scan and integration of Data Security works with AI switched off.

:::cards
- [What OneUptime AI sees](#what-oneuptime-ai-sees): What each feature sends, and what it never sends.
- [See it for yourself](#see-it-for-yourself): The exact input one of your issues would send.
- [Your own model](#your-own-model): Every feature on your project's provider, Ollama, vLLM or any OpenAI-compatible endpoint.
- [How it is measured](#how-it-is-measured): Every feature on fixed cases, before every release.
:::

## What OneUptime AI sees

No feature ever sends a model:

- a value of your data;
- a masked sample, such as `j***@e******.com`: a masked email still carries a domain, and a masked card its last four digits;
- a record of your telemetry: a log line, a span or a session;
- a connection string, a key or any other secret.

Data Security reads your data itself, inside its scans, and keeps none of it. What it sends OneUptime AI is built in one place, from a list of what may be sent, and a test fails when any feature sends a model anything else.

| Feature | What it sends | Runs on its own |
| --- | --- | --- |
| **Analysis on request** | The issue's title, severity and evidence, why its check matters and the steps that fix it; the store's name, kind, region, tags and configuration, its sensitivity, the names of its data types and about how many records it holds; who can reach the store: each grant's identity, level and how it is granted, and roughly when it was last used, and the services seen using it; copies of its data in other stores, its security cases, the response action that fixes it, and the repository and files that declare it; how many owners the store has, never who they are; for a telemetry issue, where each kind of data was found: the attribute, log body or prompt it sits in | No: a person asks, on an issue's page, or with Explain with AI through the API or the MCP server |
| **Analysis of new issues** | The issue's title, severity and evidence, why its check matters and the steps that fix it; the store's name, kind, region, tags and configuration, its sensitivity, the names of its data types and about how many records it holds; who can reach the store: each grant's identity, level and how it is granted, and roughly when it was last used, and the services seen using it; copies of its data in other stores, its security cases, the response action that fixes it, and the repository and files that declare it; how many owners the store has, never who they are; for a telemetry issue, where each kind of data was found: the attribute, log body or prompt it sits in | Yes: a new or reopened Critical or High issue starts it, while **Work on new issues** is on |
| **Fix with AI** | The issue as its check saw it, the store's name, kind, region and cloud ID, and for a telemetry issue where its data was found, as a request to the coding agent, which then reads the repository's own code to make the change | No: a person asks, in a repository they may change in **Code** |
| **Suggestions for fields no detector placed** | The kind of store and the data types it may name; each field's name, the names of the fields beside it, and the shapes of its values, every letter as `a` or `A` and every digit as `9`; how many values were read, and how long they are | Yes: a store's content scan starts it |
| **Ask AI** | The stores, issues and access the person may read in Data Security; what was found where, each data type by its location, with counts and confidence | No: a person asks a question |

**Analysis on request**, **Analysis of new issues** and **Ask AI** also read your team's [AI context](/docs/ai/ai-context) first, when it has one: the notes your team wrote for OneUptime AI about your systems.

### Text your systems wrote is data

A store's name, its cloud ID, its tags, the evidence a cloud answered and an attribute's key come from your clouds and your code, so anyone who can name a bucket or tag a resource writes what OneUptime AI reads. OneUptime AI gets every instruction in a message of its own, and that text in a second message, as data:

- each text is held to a length and put on one line, with what looks like a secret, an email address or an IP address left out;
- text that reads like instructions to an AI, such as "ignore previous instructions", is marked, and OneUptime AI is told never to follow it;
- a structured answer, such as the field suggestions', is read strictly: the object asked for, or no answer.

### What is kept

Each call's row in **Project Settings → AI → AI Logs** says which feature called which model, its tokens and its cost. It never keeps what was sent or answered: Project Members and Viewers read the AI Logs, and Data Security's records are for its owners and the Security roles. OneUptime's own telemetry never records what the analysis or the field suggestions sent either, even where the server's operator records what other AI calls send. The analysis itself is kept on its issue, for whoever may read the issue, and a line that rests on something a reader may not read is hidden from them.

When a call fails, the analysis and the field suggestions keep no word of the provider's error, which can quote what was sent. The coding agent behind Fix with AI and Ask AI's chat still keep a failed call's provider error in its row.

## See it for yourself

**Data Security → Settings → OneUptime AI** shows all of this for your project:

- **What OneUptime AI Sees**: each feature, what it sends and never sends, what starts it, the model it runs on, and what is kept of it. The model is named to whoever may read the project's LLM providers.
- **Show an Example**: the exact input OneUptime AI's analysis would send for your riskiest open issue, in your project's language, as it would send it, with what **Fix with AI** would ask. Your project's AI context, which comes first, is shown by its length. It shows only an issue you may read.

**Project Settings → AI → LLM Providers** links to it, for whoever chooses the model.

## Your own model

Every Data Security AI feature runs on the model your project chose:

- The analysis and the field suggestions run on the provider an AI rule picks for the work, else your project's default LLM provider, else the server's own.
- **Fix with AI**'s coding agent runs on the provider an AI rule picks, else one of your project's own providers, else the server's own.
- **Ask AI** runs on the provider picked in the chat, else your project's default.

A self-hosted model runs all of them: Ollama, vLLM, or any OpenAI-compatible endpoint you add under **Project Settings → AI → LLM Providers**. On an air-gapped server, the Helm chart's bundled vLLM is the server's own provider, so nothing leaves the server.

### With AI off

With **Enable AI** off in **Project Settings → AI → AI Features**, OneUptime AI sends nothing, and Data Security keeps working as before: every page, check, scan and integration. No analysis and no AI button appear on an issue, and no field is asked about after a scan.

## How it is measured

Every Data Security AI feature is measured on a fixed set of made-up cases, built the way the feature builds its input and scored on what a right answer says: an analysis with the right verdict, each of its lines resting on the facts it was given, that repeats nothing a store's name told it to say, the right data type for each field, a fix that changes what the check needs and nothing else, and an answer from what Ask AI read. The cases run against a pinned model every night, on every change to a Data Security AI prompt, and before every release, which needs each feature to meet its threshold.

In your project, **Verdicts Agreed** on **Project Settings → AI → AI Results** counts how often what people decided about an issue OneUptime AI analyzed went the way its verdict said: fixed or accepted when it said **Real**, accepted or marked public by design when it said **Likely by design**, and marked not an issue when it said **Likely a wrong finding**.

To measure your own model on the same cases, run the eval from a checkout of OneUptime, with your model's key, if it needs one, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Next steps

:::cards
- [Data Security Integrations](/docs/data-security/integrations): What OneUptime AI's analysis and Fix with AI do on an issue.
- [LLM Providers](/docs/ai/llm-provider): Add your own model, a self-hosted one included.
- [Sensitive Data Types](/docs/data-security/data-types): How the fields no detector placed are suggested.
- [Data Security Checks and Issues](/docs/data-security/checks-and-issues): What every issue means, and how to fix it.
:::
