# Deklarera en incident

Att deklarera en incident är ögonblicket då OneUptime börjar hålla räkningen. En post skapas, ett nummer stämplas på den, jourpolicyer utlöses och — om du inte säger annat — får prenumeranterna på din statussida höra om det. Allt annat i incidentens livscykel hänger på den första skrivningen.

Det finns fyra sätt att få in en incident i OneUptime, och alla landar på samma ställe: en rad i tabellen `Incident` med en allvarlighetsgrad, ett aktuellt tillstånd och en lista över berörda resurser. Skillnaden är bara vem som fyller i fälten — du klockan tre på natten, en sparad mall, en monitors kriterier, eller din egen kod som anropar API:et.

Den här sidan går igenom alla fyra, fält för fält, och täcker sedan vad servern fyller i åt dig och vad som utlöses i samma stund som incidenten finns.

## Fyra sätt att deklarera en incident

| Om du vill …                                                    | Välj                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Öppna en incident för hand och fylla i allt                     | Guiden **Deklarera incident**                                               |
| Öppna en återkommande sorts incident med fälten förifyllda      | **Skapa från mall**                                                         |
| Öppna en automatiskt när en monitors kontroller går fel         | Ett monitorkriteriefilter med **När filter matchar, deklarera en incident.** |
| Öppna en från din egen kod, ett skript eller ett annat verktyg  | `POST /api/incident`                                                        |

Alla fyra skriver samma modell, så en incident som öppnats av en probe ser exakt likadan ut som en som någon öppnat för hand — bortsett från några bokföringskolumner servern sätter på de automatiska.

## Deklarera en för hand

Öppna **Incidenter → Alla incidenter** och klicka på **Deklarera incident** uppe till höger i listan **Incidenter**. Då kommer du till ett kort med rubriken **Deklarera ny incident**, som delar upp formuläret i tre steg: **Incidentdetaljer**, **Berörda resurser** och **Jour och roller**, och därefter en sammanfattning att granska. När ditt projekt frågar efter några av sina anpassade incidentfält när en incident skapas, kommer ett fjärde steg, **Detaljer**, direkt efter **Berörda resurser**.

Bara det första steget har obligatoriska fält, plus alla anpassade fält som dina administratörer har markerat som **Obligatoriskt vid skapande**. Du kan också bifoga resurser, lägga till jourpolicyer och tilldela roller efteråt, från incidentens egna sidor. Varje steg före sammanfattningen har en vanlig **Nästa**, och **Deklarera incident** finns i sammanfattningen, det sista steget.

**Avancerad.** Alternativen som de flesta incidenter aldrig behöver väntar ihopfällda under rubriken **Avancerad** i slutet av sitt steg; klicka på den för att öppna dem. Ihopfälld visar rubriken **Konfigurerat** när något i den är satt — av en mall, till exempel — och den öppnas av sig själv när något i den behöver rättas. Sammanfattningen visar bara ett ihopfällt alternativ när det är satt, utom **Meddela statussideprenumeranter**, som den alltid visar, med vilka som meddelas.

### Steg 1 — Incidentdetaljer

- **Titel** — obligatoriskt. Sammanfattningen på en rad som alla ser i listan, i Slack och, om incidenten är synlig, på din statussida.
- **Incidentallvar** — obligatoriskt. En av allvarlighetsgraderna som är konfigurerade för ditt projekt.
- **Beskrivning** — valfri, skriven i Markdown. Det är detta statussidan visar, så skriv den för kunderna och inte för ditt team.

Under **Avancerad**:

- **Deklarerad den** — börjar i det ögonblick du öppnade sidan. All varaktighet för incidenten mäts härifrån; datera tillbaka den för att registrera en incident som började tidigare.
- **Inledande tillstånd** — valfritt, och tomt från början. Lämnas det tomt startar incidenten i tillståndet med flaggan `isCreatedState`, eller i mallens inledande tillstånd. Välj bara ett senare tillstånd för att registrera en incident som redan är kvitterad eller löst.
- **Etiketter** — valfritt. Etiketter samlar relaterade incidenter, och ett team som är begränsat till etiketter ser bara de incidenter som bär en av dess etiketter.
- **Privat incident** — av som standard (`isPrivate`). En privat incident syns bara för sina ägare, projektadministratörer och projektägare, och är dold på alla statussidor.

**Om tillståndsmenyn krånglar.** Om ditt projekt inte har något tillstånd som bär flaggan `isCreatedState` misslyckas skapandet och du får veta att du behöver lägga till ett skapat incidenttillstånd i inställningarna. Det händer normalt bara i projekt där tillstånden redigerats kraftigt — se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

### Steg 2 — Berörda resurser

Monitorerna kommer först, för sig: statussidor ser en incident genom dess monitorer, och statusen som monitorerna byter till står direkt under dem.

- **Monitorer** — en sökruta som bifogar de monitorer som incidenten påverkar (`monitors`). En statussida visar incidenten, och meddelar sina prenumeranter, när den listar en av dessa monitorer.
- **Ändra övervakningsstatus till** — valfritt, och visas först när minst en monitor är vald. Sätter varje monitor i incidenten till en övervakningsstatus, så att det är en enda åtgärd att deklarera incidenten och markera dess monitorer som försämrade. En malls status visas så snart du väljer en monitor; utan vald monitor sparas ingen status.
- **Andra påverkade resurser** — en andra sökruta för allt annat som incidenten påverkar: värdar, Kubernetes-kluster, Docker- och Podman-värdar, Proxmox-, Ceph- och Docker Swarm-kluster, vCenter, IoT-flottor, databaser och tjänster. Det är separata relationer på incidenten (`hosts`, `kubernetesClusters`, `services` med flera).

Incidentens kort **Berörda resurser** frågar på samma sätt när du redigerar det senare.

Under **Avancerad**:

- **Begränsa till dessa statussidor** — valfritt. Lämnas det tomt visas incidenten på alla statussidor som listar dess monitorer, och meddelar deras prenumeranter; med valda sidor bara på dem bland dem. Se [En statussida per målgrupp](/docs/status-pages/one-status-page-per-audience).
- **Meddela statussideprenumeranter** — kryssruta, ikryssad som standard (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Under den, och igen i sammanfattningen, visar formuläret vilka statussidor som meddelas och hur många prenumeranter var och en har; i sammanfattningen visar **Förhandsgranska avisering** e-postmeddelandet de får. Kryssa ur den för internt brus som du ändå vill registrera.

**Koppla på monitorer även när det känns överflödigt.** Länken mellan en incident och en statussida går genom incidentens monitorer: en statussida visar en incident när en av sidans resurser är en av incidentens monitorer. En avisering om tillståndsändring till prenumeranter hoppas över helt när incidenten inte har några monitorer kopplade. Se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups).

### Steg 3 — Jour och roller

- **Jourpolicy** — ett flerval av de jourpolicyer som körs när den här incidenten skapas (`onCallDutyPolicies`).
- **Tilldela incidentroller** — vem som tar varje roll som ditt projekt definierar. En roll märkt **Primär** som du lämnar tom är din: du tar den när incidenten deklareras.

Det här är det enda stället där en jourpolicy kopplas direkt till en incident. Allvarlighetsgrader bär ingen jourpolicy — allvarlighetsgrad är en etikett, och den påverkar larmning bara som *matchningskriterium* inuti en jourregel. Regler konfigurerade under **Incidenter → Regler → Jourregler** lägger sina policyer ovanpå det du väljer här; mängden som till slut körs är den avdubblettade unionen av båda.

Själva rollerna konfigureras under **Incidenter → Inställningar → Incidentroller**. Ett nytt projekt har en, Incident Commander; lägg till där vad din process behöver i övrigt.

Flaggan **Should be visible on status page?** (`isVisibleOnStatusPage`) finns inte i guiden; den är sann som standard. Ändra den efteråt från **Inställningar** i incidentens sidomeny, där den heter **Synlig på statussidan**.

## Deklarera från en mall

Om du gång på gång deklarerar samma sorts incident — samma titelmönster, samma allvarlighetsgrad, samma jourpolicy — spara den en gång som en mall.

Klicka på **Skapa från mall** (konturknappen bredvid **Deklarera incident**) så öppnas dialogen **Skapa incident från mall**, med en rullgardin **Välj incidentmall**. Välj en mall så öppnas skapandeformuläret förifyllt; du kan fortfarande ändra vad som helst innan du skickar. Om ditt projekt inte har några mallar än får du i stället dialogen **No Incident Templates**, med en knapp **Create Template** som tar dig till **Incidenter → Inställningar → Incidentmallar**.

Mallar byggs med en egen guide — **Mallinformation**, **Incidentdetaljer**, **Berörda resurser**, **Jour** — plus steg för anpassade fält när ditt projekt har sådana. Ägare och etiketter ligger under **Avancerad** i slutet av **Incidentdetaljer**. **Berörda resurser** frågar som deklarationsformuläret — **Monitorer**, sedan **Ändra övervakningsstatus till**, sedan **Andra påverkade resurser**, med **Begränsa till dessa statussidor** under **Avancerad** — förutom att en mall alltid frågar efter övervakningsstatus: den gäller även de monitorer som väljs när en incident deklareras från mallen. Det här är fälten:

| Fält                         | Syfte                                                     |
| ---------------------------- | --------------------------------------------------------- |
| **Mallnamn**                 | Hur mallen känns igen i väljaren.                         |
| **Mallbeskrivning**          | En notis till ditt framtida jag om när du ska ta till den. |
| **Titel**                    | Titeln som förifylls på incidenten.                       |
| **Beskrivning**              | Markdown-beskrivning som förifylls på incidenten.         |
| **Incidentallvar**           | Allvarlighetsgrad som förifylls på incidenten.            |
| **Inledande incidenttillstånd** | Tillståndet incidenter från den här mallen börjar i.   |
| **Monitorer** | Monitorer att bifoga. |
| **Ändra övervakningsstatus till** | Övervakningsstatus för incidentens monitorer, även de som väljs vid deklarationen. |
| **Andra påverkade resurser** | Värdar, kluster och tjänster att bifoga. |
| **Begränsa till dessa statussidor** | Statussidor som incidenten är begränsad till. |
| **Jourpolicy**               | Policyer att köra när incidenten skapas.                  |
| **Ägare** | Personer och team som äger incidenter skapade från den här mallen, valda ur en enda lista. |
| **Etiketter**                | Etiketter som sätts på incidenten.                        |

Några snabba regler:

- Mallar går inte att redigera från mallistan — du skapar en och öppnar den sedan för att ändra den.
- En mall fyller bara ett fält du lämnat tomt. På skapandesidan tillämpas mallen som en förifyllning du kan skriva över; via API:et fyller servern ett fält från mallen bara när förfrågan lämnade fältet `undefined`. Det anroparen skickar vinner alltid.

## Deklarera automatiskt från monitorkriterier

De flesta incidenter borde inte behöva en människa som skriver in dem. I en monitors kriterieredigerare slår du på växeln **När filter matchar, deklarera en incident.** så dyker en sektion **Skapa incident** upp med en knapp **Lägg till incident** — ett kriteriefilter kan deklarera mer än en incident.

Varje post har:

- **Incidenttitel** — stöder mallning; platshållaren föreslår något i stil med `{{monitorName}} is down`.
- **Allvarlighetsgrad** — obligatorisk.
- **Incidentbeskrivning** — också mallbar.
- **Jour → Jourpolicyer** — policyer som körs när den här incidenten skapas.
- **Incidentroller** — förtilldela teammedlemmar till roller.
- **Ägarskap och etiketter → Ägarteam**, **Ägaranvändare**, **Etiketter**.
- **Avancerade alternativ → Lös incident automatiskt** (löser incidenten automatiskt när kriterierna slutar matcha), **Visa incident på statussida**, **Privat incident** och **Åtgärdsanteckningar**.

För hela listan över `{{variable}}`-platshållare du kan använda i titel, beskrivning och åtgärdsanteckningar, se [Incident- och varningsmallar](/docs/monitor/incident-alert-templating).

Incidenter som skapas så här taggas av servern: `isCreatedAutomatically` sätts, `createdCriteriaId` registrerar vilket kriteriefilter som utlöstes och `createdByProbe` registrerar vilken probe som såg det. Allt annat hos dem beter sig precis som hos en handdeklarerad incident.

## Deklarera via API:et

Incidentmodellen exponerar en vanlig CRUD-slutpunkt, så `POST /api/incident` skapar en. Autentisera med en API-nyckel som genererats under **Projektinställningar → API-nycklar** och skickas i huvudet `apikey` — nyckeln identifierar projektet, så du behöver inte skicka något projekt-id separat.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Användbara fält i förfrågningskroppen:

- `title` — det enda fältet du verkligen måste skicka.
- `declaredAt` — valfritt här trots att formuläret kräver det. Utelämna det så använder servern aktuell tid.
- `incidentSeverityId` och `currentIncidentStateId` — servern kontrollerar att båda tillhör samma projekt som API-nyckeln, och avvisar förfrågan om de inte gör det. Samma kontroll gäller monitorstatusen bakom **Change Monitor Status to**.
- `createdIncidentTemplateId` — tillämpa en sparad mall. Varje fält du utelämnar fylls från mallen; varje fält du skickar behålls som det är.

Besläktade slutpunkter är `/api/incident-state`, `/api/incident-severity` och `/api/incident-state-timeline`. Den genererade [API-referensen](/reference) har de exakta förfrågnings- och svarsformerna för var och en, inklusive hur relationsfält som monitorer uttrycks.

## Incidentnummer och prefix

Varje incident får ett löpande nummer från en räknare per projekt, tilldelat av servern när den skapas. Två kolumner håller det: `incidentNumber` (heltalet) och `incidentNumberWithPrefix` (det du faktiskt ser). Utan konfigurerat prefix är visningsvärdet `#42`.

För att ändra det, gå till **Incidenter → Inställningar → Nummerprefix** och klicka på **Uppdatera**. Fältet **Prefix för incidentnummer** visar numret medan du skriver: `INC-` ger `INC-42`. Lämna det tomt för att behålla standarden `#`. Ett nytt prefix gäller incidenter som deklareras efter att du sparat; befintliga incidenter behåller sina nummer. Samma dialog har också **Nummerprefix för incidentepisoder** för episodnumrering.

Numret visas som första kolumnen i incidentlistan, länkar till incidenten och dyker upp som **Incidentnummer** på incidentens **Översikt**.

## Vad som händer i samma stund som en incident deklareras

Skapandeanropet gör mer än att skriva en rad. I tur och ordning:

1. **Servern fyller luckorna.** `declaredAt` sätts till nu, aktuellt tillstånd sätts till projektets `isCreatedState`-tillstånd, och incidentnumret och det prefixade numret tilldelas från projektets räknare.
2. **En mall tillämpas**, om `createdIncidentTemplateId` skickades med — och fyller bara fält som anroparen lämnade odefinierade.
3. **Sekretessregler körs** och markerar incidenten som privat när en matchande regel säger så. Det är den första regelmotorn som körs, så allt efter den ser rätt sekretessinställning.
4. **Ägarregler körs** och lägger till ägaranvändarna och ägarteamen som matchande regler pekar ut.
5. **Etikettregler körs** och lägger till etiketter som matchar incidenten.
6. **Jourregler körs.** Varje aktiverad regel under **Incidenter → Regler → Jourregler** vars kriterier matchar lägger sina policyer på incidenten. Det finns ingen prioritetsordning och ingen kortslutning — alla matchande regler utlöses och policyerna avdubbletteras.
7. **Runbook-regler körs** och kopplar på och startar matchande runbooks. Se [Runbooks](/docs/runbooks/index).
8. **Jourpolicyer körs.** Varje policy på incidenten — vald i guiden, ärvd från en mall eller tillagd av en regel — körs parallellt med händelsetypen `IncidentCreated`. Att en policy misslyckas stoppar inte de andra.
9. **Prenumeranter köas**, om **Meddela statussideprenumeranter** lämnades påslaget och incidenten är synlig på statussidan. Leveransen sköts av ett bakgrundsjobb, inte inuti din förfrågan.
10. **Arbetsflöden utlöses.** Utlösaren **On Create Incident** startar varje arbetsflöde som byggts på den. Se [Översikt över arbetsflöden](/docs/workflows/index).

Därifrån är incidenten aktiv: den räknas mot märket **Aktiva incidenter** i incidenternas sidomeny (varje tillstånd utan flaggan `isResolvedState` räknas som aktivt), den dyker upp på statussidorna som bär någon av dess monitorer, och dess **Tillståndstidslinje** börjar registrera.

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentmodellen hänger ihop.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad tillståndsflaggorna gör och hur du lägger till egna.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — offentliga anteckningar, privata anteckningar, ägare och aktivitetsflödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — mallar, anpassade fält, roller, regler och arbetsflödesutlösare.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som får höra om incidenten du precis deklarerade.
- [Incident- och varningsmallar](/docs/monitor/incident-alert-templating) — variablerna som finns för automatiskt deklarerade incidenter.
