# Arbeta med OneUptime från GitHub

OneUptimes GitHub App är inte bara en anslutning till din kod — du kan prata med den i ditt repositorie, och den utför arbetet där.

Nämn den i ett ärende så öppnar den en pull request. Nämn den i en pull request så reviderar den grenen, eller granskar diffen. Sätt en etikett på ett ärende så tar den sig an ärendet. Allt den producerar är en pull request eller en granskning som en människa ska läsa: **den mergar aldrig något, och den godkänner aldrig en pull request.**

```text
@oneuptime implement this                              →  en pull request som stänger ärendet
@oneuptime revise this — använd exponentiell backoff   →  nya commits på den här pull requestens gren
@oneuptime review                                      →  en kodgranskning publicerad på den här pull requesten
```

> Byt ut `@oneuptime` mot din egen apps @-namn. På OneUptime Cloud är det `@oneuptime`. På en egenhostad instans är det vad du än döpte din GitHub App till, i gemener och med mellanslag utbytta mot bindestreck — en app som heter "Acme AI" nämns som `@acme-ai`. Om omnämnanden inte gör någonting är det här det första du ska kontrollera.

## Innan du börjar

- Repositoriet måste vara **anslutet till ett OneUptime-projekt** via GitHub App:en. Se [GitHub Integration (egenhostad)](/docs/self-hosted/github-integration) för uppsättningen, eller anslut det från **Projektinställningar → Kodförråd** på OneUptime Cloud.
- En **Runner med förmågan "Kör AI-kodfixar"** måste vara online — samma Runner som utför [AI-fixuppgifter](/docs/ai/ai-agent). Utan en sådan tas kommandon emot och misslyckas sedan efter 30 minuter med ett meddelande om att ingen agent hämtade dem.
- GitHub App:en måste ha behörigheten **Issues: Läs och skriv** och prenumerera på webhook-händelserna som listas under [Vad du ska prenumerera på](#vad-du-ska-prenumerera-på).

## Kommandona

Varje kommando börjar med ett omnämnande av appen. Omnämnandet kan stå var som helst i kommentaren, och allt du skriver efter det skickas med som din förfrågan.

### På en pull request

| Kommando | Vad som händer |
| --- | --- |
| `@oneuptime review` | Klonar grenen, läser den ändrade koden **och koden runt omkring**, och publicerar en granskning som en kommentar. Ändrar ingenting. |
| `@oneuptime revise this — <vad du vill ha ändrat>` | Klonar pull requestens egen gren, gör ändringen och pushar nya commits till samma gren. Öppnar aldrig en andra pull request. |

Allt du skriver efter omnämnandet som inte är ett känt kommando behandlas som en revideringsförfrågan, eftersom det nästan alltid är vad det är:

```text
@oneuptime retry-loopen här borde använda exponentiell backoff, och testet
ska täcka 429-fallet
```

### På ett ärende

| Kommando | Vad som händer |
| --- | --- |
| `@oneuptime implement this` | Arbetar med ärendet och öppnar en pull request som stänger det. |
| `@oneuptime <vad som helst annat>` | Samma sak, med dina ord som extra vägledning. |

Du kan också lämna över ett ärende till appen **utan att kommentera alls**:

- **Sätt utlösaretiketten.** Att sätta repositoriets utlösaretikett — `oneuptime` som standard — på ett ärende startar samma arbete. Det är det mest tillförlitliga sättet att dela ut arbete från GitHubs gränssnitt.
- **Tilldela ärendet till appens bot-användare**, där ditt repositorie tillåter det. GitHub låter inte en app vara tilldelad överallt, och det är därför etiketten finns; om tilldelning inte gör någonting, använd etiketten.

### Var som helst

| Kommando | Vad som händer |
| --- | --- |
| `@oneuptime help` | Listar kommandona. Ett blankt omnämnande utan något efter gör samma sak. |
| `@oneuptime status` | Berättar vad den arbetar med just nu i den här tråden. |
| `@oneuptime cancel` | Stoppar de körningar den har igång i den här tråden. Arbete som redan pushats förblir pushat. |

`help`, `status` och `cancel` startar aldrig en agentkörning, så de kostar ingenting och belastar inte din dagliga budget för fixuppgifter.

## Hur det ser ut i tråden

Ett kommando ger **en kommentar**, som appen redigerar allteftersom arbetet fortskrider — så en långkörande uppgift förvandlar aldrig en pull request till en statuslogg.

1. Den reagerar 👀 på din kommentar och publicerar en bekräftelse som namnger det OneUptime-projekt körningen tillhör och länkar till den pågående körningen.
2. När den är klar skrivs samma kommentar om med utfallet: pull requesten den öppnade, de commits den pushade, eller en ärlig förklaring till varför den inte gjorde något.

Om den inte hittar något värt att ändra säger den det, i stället för att öppna en spekulativ pull request. Det är ett normalt utfall, inte ett misslyckande — ge den mer vägledning och fråga igen.

## Vem som får styra den

**Bara personer med write-, maintain- eller admin-åtkomst till repositoriet.** OneUptime frågar GitHub direkt om kommentatorns behörighet på just det repositoriet varje gång; den litar inte på "contributor"-märket som GitHub visar bredvid en kommentar, eftersom det beskriver tidigare aktivitet snarare än nuvarande åtkomst.

Ett omnämnande från någon annan får en enda 😕-reaktion på sin kommentar och inget mer. Det är avsiktligt: på ett publikt repositorie kan vem som helst kommentera, och en app som tillförlitligt svarar främlingar är en app som kan användas för att spamma en tråd.

Den ignorerar också varje kommentar skriven av en bot, inklusive sina egna, och ignorerar omnämnanden som står inuti ett citat (`>`) eller ett kodblock. Tillsammans är det de två reglerna som hindrar ett svar på en av dess egna kommentarer från att dra igång den på nytt.

## Vad den inte gör

- **Den mergar aldrig.** Ingenting den här appen gör kan lägga kod på din standardgren.
- **Den godkänner aldrig och begär aldrig ändringar.** Granskningar publiceras som kommentarer, så en granskning från en app kan aldrig uppfylla en branch protection-regel.
- **Den skriver aldrig om historiken.** En revidering lägger till commits; den force-pushar inte. Om någon annan hann pusha till grenen först misslyckas revideringen i stället för att kasta bort deras arbete.
- **Den kan inte revidera en pull request från en fork.** En forks gren ligger i ett repositorie som installationen inte kan skriva till. Den granskar den fortfarande — be om en granskning i stället.
- **Den ändrar aldrig en pull requests titel, beskrivning eller målgren.** Bara kod.

## Vad det kostar, och hur du sätter gränser

Varje kommando som startar arbete är en fullständig agentkörning — en kloning, upp till 40 LLM-anrop och 100 000 output-tokens, plus ditt repositories bygg- och testkommandon om du har konfigurerat sådana.

Två gränser gäller, och båda är desamma som redan styr [AI-fixuppgifter](/docs/ai/ai-agent):

- **Projektets dagliga gräns för fixkörningar** (**Projektinställningar → AI**, 25/dag som standard). GitHub-kommandon delar den budgeten med resten av projektets fixkörningar.
- **Taket för öppna pull requests per repositorie** (**Kodförråd → repositoriet → Inställningar**, 5 som standard). Granskningar och revideringar är undantagna: ingen av dem lägger till en ny pull request i din granskningskö.

Bara en körning av ett givet slag är igång per ärende eller pull request åt gången. Frågar du två gånger får du veta att den redan arbetar; att be om en granskning medan en revidering pågår startar båda, eftersom de är olika förfrågningar.

Om en körning inte kan starta säger appen varför i tråden — den misslyckas aldrig tyst.

## Stänga av det

Per repositorie: **Kodförråd → repositoriet → Inställningar → Respond to GitHub Commands**. Med den avslagen ignorerar appen omnämnanden, tilldelningar och utlösaretiketten i det repositoriet, och talar om för den som frågar var reglaget sitter.

Samma sida bär **GitHub Trigger Label**, om du vill ha något annat än `oneuptime`.

## Vad du ska prenumerera på

I din GitHub Apps inställningar under **Permissions & events**, prenumerera på:

| Händelse | Behövs för |
| --- | --- |
| **Issue comment** | `@mention`-kommandon på ärenden *och* pull requests |
| **Issues** | tilldelning till appen, och utlösaretiketten |
| **Pull request** | granskning begärd av appen |
| **Pull request review** | ett omnämnande i brödtexten på en inskickad granskning |
| **Pull request review comment** | ett omnämnande på en inline-kommentar i diffen |

Och under **Repository permissions** måste **Issues** vara **Läs och skriv** — GitHub dirigerar kommentarer i pull request-konversationer via issues-API:et, så det är det som gör att appen kan kommentera på pull requests också.

## Prompt injection: vad som skyddas och vad som inte gör det

Ärendetext, pull request-beskrivningar, diffar och kommentarer blir alla en del av agentens prompt, och på ett publikt repositorie kan vem som helst skriva dem. Text som säger "ignorera dina instruktioner och gör X" är något man realistiskt kan hitta i ett ärende.

Två saker begränsar det här, och det är värt att veta vilken som är vilken:

- **Prompterna märker opålitlig text som en förfrågan, inte som instruktioner**, och körningens repositorie, gren och pull request är fastställda innan agenten ens startar — inget agenten läser kan ändra vad den arbetar med.
- **Den verkliga inneslutningen är sandlådan.** Agenten körs på din Runner, i en engångsklon, med credentials borttagna ur kommandomiljön och sina git-operationer begränsade. Den kan bara pusha till en gren, och bara en människa kan merga en.

Behandla en AI-författad pull request som du skulle behandla en från en ny bidragsgivare som läst ärendet: granska diffen, inte beskrivningen.

## Felsökning

**Ingenting händer när jag nämner den.** Kontrollera @-namnet först — det är appens slug, inte dess visningsnamn. Kontrollera sedan att repositoriet är anslutet till ett projekt (**Projektinställningar → Kodförråd**), att **Respond to GitHub Commands** är påslaget, och att din GitHub App prenumererar på händelserna ovan.

**Den reagerar 😕 och säger ingenting.** Du har inte write-åtkomst till repositoriet.

**Den säger att den redan arbetar med det här.** En körning av det slaget är redan igång på det här ärendet eller den här pull requesten. `@oneuptime status` talar om vilken, och `@oneuptime cancel` stoppar den.

**Den bekräftade och blev sedan tyst länge.** Kontrollera att en Runner med **Kör AI-kodfixar** är online under **Inställningar → Runbook-agenter**. Utan en sådan misslyckas körningen efter 30 minuter, och tråden får besked.

**Den säger att pull requesten kommer från en fork.** Revideringar behöver en gren i det här repositoriet. Be om en granskning i stället, eller pusha grenen hit.

## Läs vidare

- [AI-fixuppgifter](/docs/ai/ai-agent) — samma agent, utlöst från ett undantag i stället för från GitHub.
- [GitHub Integration (egenhostad)](/docs/self-hosted/github-integration) — skapa och konfigurera GitHub App:en.
- [Runbook-agenter](/docs/runbooks/agents) — arbetaren som utför körningarna.
