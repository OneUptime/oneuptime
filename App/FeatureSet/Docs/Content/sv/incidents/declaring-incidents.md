# Deklarera en incident

Att deklarera en incident är ögonblicket då OneUptime börjar föra bok. En post skapas, ett nummer stämplas på den, jourpolicyer utlöses och — om du inte säger annat — får dina statussideprenumeranter höra om det. Allt annat i incidentens livscykel hänger på den första skrivningen.

Det finns fyra sätt att få in en incident i OneUptime, och alla hamnar på samma ställe: en rad i tabellen `Incident` med en allvarlighetsgrad, ett aktuellt tillstånd och en lista över berörda resurser. Skillnaden är bara vem som fyller i fälten — du klockan tre på natten, en sparad mall, en monitors kriterier eller din egen kod som anropar API:et.

Den här sidan går igenom alla fyra, fält för fält, och täcker sedan vad servern fyller i åt dig och vad som utlöses i samma stund som incidenten finns.

## Fyra sätt en incident blir deklarerad

| Om du vill…                                                    | Välj                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Öppna en incident för hand och fylla i allt                    | Guiden **Deklarera incident**                                           |
| Öppna en återkommande sorts incident med fälten förifyllda     | **Skapa från mall**                                                     |
| Öppna en automatiskt när en monitors kontroller misslyckas     | Ett monitorkriteriefilter med **När filter matchar, deklarera en incident.** |
| Öppna en från din egen kod, ett skript eller ett annat verktyg | `POST /api/incident`                                                    |

Alla fyra skriver samma modell, så en incident som öppnats av en probe ser precis ut som en som någon öppnat för hand — bortsett från några bokföringskolumner som servern sätter på de automatiska.

## Deklarera en för hand

Öppna **Incidenter → Alla incidenter** och klicka på **Deklarera incident** uppe till höger i listan **Incidenter**. Det tar dig till ett kort med rubriken **Deklarera ny incident**, som sprider formuläret över fem steg: **Incidentdetaljer**, **Berörda resurser**, **Incidentroller**, **Jour** och **Mer**. Skicka-knappen på slutet heter också **Deklarera incident**.

Bara det första steget har obligatoriska fält. Om du har bråttom, fyll i **Incidentdetaljer** och skicka — du kan koppla på resurser, tilldela roller och lägga till jourpolicyer från incidentens egna sidor efteråt.

### Steg 1 — Incidentdetaljer

- **Titel** — obligatorisk. Enradssammanfattningen som alla ser i listan, i Slack och (om incidenten är synlig) på din statussida. Platshållare: `Incident Title`.
- **Beskrivning** — valfri, skriven i Markdown. Det här är fältet som renderas på statussidan, så skriv det för kunderna snarare än för ditt team. Du kan redigera det senare från **Beskrivning** i incidentens sidomeny.
- **Deklarerad den** — obligatorisk i formuläret, förifylld med nu. Det här är tidsstämpeln som varje varaktighet på incidenten mäts från, så backdatera den om du registrerar något som började tidigare.
- **Incidentallvar** — obligatorisk. En av de allvarlighetsgrader som konfigurerats för ditt projekt; nya projekt förses med **Critical Incident**, **Major Incident** och **Minor Incident**.
- **Incidentstatus** — valfri. Låt den vara och incidenten hamnar i tillståndet som är flaggat `isCreatedState`, vilket nya projekt skapar som **Identified**. Sätt den bara när du registrerar en incident som redan hade passerat den punkten.

**Om tillståndsmenyn krånglar.** Om ditt projekt inte har något tillstånd som bär flaggan `isCreatedState` misslyckas skapandet och du får veta att du ska lägga till ett skapat incidenttillstånd från inställningarna. Det händer normalt bara i ett projekt vars tillstånd har redigerats kraftigt — se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

### Steg 2 — Berörda resurser

- **Berörda resurser** — en enda sökruta som kopplar på monitorer, värdar, Kubernetes-kluster, Docker-värdar, Podman-värdar och tjänster. Under huven är dessa separata relationer på incidenten (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` med flera), men formuläret slår ihop dem till en väljare.
- **Change Monitor Status to** — valfri. Väljer en monitorstatus som tillämpas på varje monitor som kopplats till den här incidenten, så att deklarera incidenten och markera monitorerna som försämrade blir en åtgärd i stället för två.

**Koppla på monitorer även när det känns överflödigt.** Kopplingen mellan en incident och en statussida går via incidentens monitorer: en statussida visar en incident när en av dess resurser är en av incidentens monitorer. En avisering om tillståndsändring till prenumeranter hoppas över helt när incidenten inte har några monitorer kopplade. Se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups).

### Steg 3 — Incidentroller

- **Tilldela incidentroller** — tilldela teammedlemmar till de roller ditt projekt definierar. Vissa roller tar emot mer än en användare.

Rollerna själva konfigureras under **Incidenter → Inställningar → Incidentroller**, där du definierar de roller som kan tilldelas under arbetet — Incident Commander, Responder och vad din process nu kräver. Om du hoppar över det här steget tilldelas en Incident Commander automatiskt vid den första tillståndsändringen om ingen redan har rollen.

### Steg 4 — Jour

- **Jourpolicy** — en flervalslista över de jourpolicyer som ska köras när den här incidenten skapas. Det motsvarar `onCallDutyPolicies` på incidenten.

Det här är den enda platsen där en jourpolicy kopplas direkt till en incident. Allvarlighetsgrader bär ingen jourpolicy — allvarlighetsgrad är en etikett, och den påverkar larmning bara som ett *matchningskriterium* inuti en jourregel. Regler som konfigureras under **Incidenter → Regler → Jourregler** lägger sina policyer ovanpå det du väljer här; den slutliga mängd som körs är den dubblettfria unionen av båda.

### Steg 5 — Mer

- **Etiketter** — valfria och en avancerad funktion: teammedlemmar med åtkomst till dessa etiketter är de som kan komma åt incidenten.
- **Meddela statussideprenumeranter** — kryssruta, påslagen som standard. Styr om prenumeranter får e-post om att incidenten skapats (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Slå av den för internt brus som du ändå vill registrera.
- **Privat incident** — kryssruta, avslagen som standard (`isPrivate`). En privat incident syns bara för dess ägaranvändare, medlemmarna i dess ägarteam, projektadministratörer och projektägare — och den är dold från varje statussida, oavsett andra inställningar. Incidentlistan markerar dessa med en röd **Private**-pill.

Flaggan **Should be visible on status page?** (`isVisibleOnStatusPage`) finns inte i guiden; den är sann som standard. Ändra den efteråt från **Inställningar** i incidentens sidomeny, där den heter **Synlig på statussidan**.

## Deklarera från en mall

Om du hela tiden deklarerar samma sorts incident — samma titelmönster, samma allvarlighetsgrad, samma jourpolicy — spara den en gång som en mall.

Klicka på **Skapa från mall** (den konturade knappen bredvid **Deklarera incident**) så öppnas en modal med rubriken **Skapa incident från mall**, med en rullgardinsmeny **Välj incidentmall**. Välj en mall så öppnas skapandeformuläret förifyllt; du kan fortfarande ändra vad som helst innan du skickar. Om ditt projekt inte har några mallar ännu får du i stället en **No Incident Templates**-modal, med en **Create Template**-knapp som tar dig till **Incidenter → Inställningar → Incidentmallar**.

Mallar byggs med en egen sexstegsguide — **Mallinformation**, **Incidentdetaljer**, **Berörda resurser**, **Jour**, **Ägare**, **Etiketter** — med dessa fält:

| Fält                             | Syfte                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| **Mallnamn**                     | Hur mallen identifieras i väljaren.                          |
| **Mallbeskrivning**              | En notering till ditt framtida jag om när du ska ta till den. |
| **Titel**                        | Titeln som förifylls på incidenten.                          |
| **Beskrivning**                  | Markdown-beskrivning som förifylls på incidenten.            |
| **Incidentallvar**               | Allvarlighetsgrad som förifylls på incidenten.               |
| **Inledande incidenttillstånd**  | Tillståndet som incidenter från den här mallen startar i.    |
| **Berörda resurser**             | Monitorer, värdar, kluster och tjänster att koppla på.       |
| **Change Monitor Status to**     | Monitorstatus att tillämpa på de påkopplade monitorerna.     |
| **Jourpolicy**                   | Policyer att köra när incidenten skapas.                     |
| **Ägare – Team**                 | Team som äger incidenter skapade från den här mallen.        |
| **Ägare – Användare**            | Användare som äger incidenter skapade från den här mallen.   |
| **Etiketter**                    | Etiketter som tillämpas på incidenten.                       |

Några snabba regler:

- Mallar kan inte redigeras från mallistan — du skapar en och öppnar den sedan för att ändra den.
- En mall fyller bara i ett fält du lämnat tomt. På skapandesidan tillämpas mallen som en förifyllning du kan skriva över; via API:et fyller servern ett fält från mallen bara när begäran lämnade fältet `undefined`. Det anroparen skickat vinner alltid.

## Deklarera automatiskt från monitorkriterier

De flesta incidenter borde inte behöva att en människa skriver in dem. Slå på växeln **När filter matchar, deklarera en incident.** i en monitors kriterieredigerare så dyker en sektion **Skapa incident** upp med en knapp **Lägg till incident** — ett kriteriefilter kan deklarera mer än en incident.

Varje post har:

- **Incidenttitel** — stöder mallar; platshållaren föreslår något i stil med `{{monitorName}} is down`.
- **Allvarlighetsgrad** — obligatorisk.
- **Incidentbeskrivning** — också mallbar.
- **Jour → Jourpolicyer** — policyer som körs när den här incidenten skapas.
- **Incidentroller** — förtilldela teammedlemmar till roller.
- **Ägarskap och etiketter → Ägarteam**, **Ägaranvändare**, **Etiketter**.
- **Avancerade alternativ → Lös incident automatiskt** (löser incidenten automatiskt när kriterierna slutar matcha), **Visa incident på statussida**, **Privat incident** och **Åtgärdsanteckningar**.

För den fullständiga listan över `{{variable}}`-platshållare du kan använda i titel, beskrivning och åtgärdsanteckningar, se [Incident- och varningsmallar](/docs/monitor/incident-alert-templating).

Incidenter som skapas så här taggas av servern: `isCreatedAutomatically` sätts, `createdCriteriaId` registrerar vilket kriteriefilter som utlöstes och `createdByProbe` registrerar vilken probe som såg det. Allt annat med dem beter sig precis som en handdeklarerad incident.

## Deklarera via API:et

Incidentmodellen exponerar en vanlig CRUD-slutpunkt, så `POST /api/incident` skapar en. Autentisera med en API-nyckel genererad under **Projektinställningar → API-nycklar**, skickad i huvudet `apikey` — nyckeln identifierar projektet, så du behöver inte skicka ett projekt-id separat.

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

Användbara fält i begärans body:

- `title` — det enda fältet du verkligen måste skicka.
- `declaredAt` — valfritt här trots att formuläret kräver det. Utelämna det så använder servern aktuell tid.
- `incidentSeverityId` och `currentIncidentStateId` — servern kontrollerar att båda tillhör samma projekt som API-nyckeln och avvisar begäran om de inte gör det. Samma kontroll gäller monitorstatusen bakom **Change Monitor Status to**.
- `createdIncidentTemplateId` — tillämpa en sparad mall. Varje fält du utelämnar fylls från mallen; varje fält du skickar behålls som det är.

Relaterade slutpunkter är `/api/incident-state`, `/api/incident-severity` och `/api/incident-state-timeline`. Den genererade [API-referensen](/reference) har de exakta begärans- och svarsformerna för var och en, inklusive hur relationsfält som monitorer uttrycks.

## Incidentnummer och prefix

Varje incident får ett löpnummer från en räknare per projekt, tilldelat av servern vid skapandet. Två kolumner håller det: `incidentNumber` (heltalet i råform) och `incidentNumberWithPrefix` (det du faktiskt ser). Utan konfigurerat prefix är visningsvärdet `#42`.

För att ändra det, gå till **Incidenter → Inställningar → Fler inställningar**. Kortet **Nummerprefix** har ett fält **Prefix för incidentnummer** (upp till 20 tecken, platshållare `INC-`) — sätt det så renderas samma incident som `INC-42`. Lämna det tomt för att behålla standardvärdet `#`. Kortet bär också **Nummerprefix för incidentepisoder** för episodnumrering.

Numret visas som första kolumnen i incidentlistan, länkar till incidenten och dyker upp som **Incidentnummer** på incidentens **Översikt**.

## Vad som händer i samma stund som en incident deklareras

Skapandeanropet gör mer än att skriva en rad. I tur och ordning:

1. **Servern fyller luckorna.** `declaredAt` blir nu som standard, det aktuella tillståndet blir som standard projektets `isCreatedState`-tillstånd, och incidentnumret och det prefixade numret tilldelas från projektets räknare.
2. **En mall tillämpas**, om `createdIncidentTemplateId` skickades med — den fyller bara fält som anroparen lämnat odefinierade.
3. **Sekretessregler körs** och markerar incidenten som privat när en matchande regel säger det. Det här är den första regelmotorn som körs, så allt efter den ser rätt sekretessinställning.
4. **Ägarregler körs** och lägger till de ägaranvändare och ägarteam som matchande regler namnger.
5. **Etikettregler körs** och lägger till etiketter som matchar incidenten.
6. **Jourregler körs.** Varje aktiverad regel under **Incidenter → Regler → Jourregler** vars kriterier matchar lägger sina policyer till incidenten. Det finns ingen prioritetsordning och ingen kortslutning — alla matchande regler utlöses och policyerna görs dubblettfria.
7. **Runbook-regler körs** och kopplar på och startar matchande runbooks. Se [Runbooks](/docs/runbooks/index).
8. **Jourpolicyer körs.** Varje policy på incidenten — vald i guiden, ärvd från en mall eller tillagd av en regel — körs parallellt med händelsetypen `IncidentCreated`. Att en policy misslyckas stoppar inte de andra.
9. **Prenumeranter köas**, om **Meddela statussideprenumeranter** lämnades påslagen och incidenten är synlig på statussidan. Leveransen sköts av ett bakgrundsjobb, inte inline med din begäran.
10. **Arbetsflöden utlöses.** Utlösaren **On Create Incident** startar alla arbetsflöden byggda på den. Se [Översikt över arbetsflöden](/docs/workflows/index).

Därifrån är incidenten live: den räknas mot märket **Aktiva incidenter** i incidenternas sidomeny (varje tillstånd som inte är flaggat `isResolvedState` räknas som aktivt), den dyker upp på de statussidor som bär en av dess monitorer, och dess **Tillståndstidslinje** börjar registrera.

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentmodellen hänger ihop.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad tillståndsflaggorna gör och hur du lägger till egna.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — offentliga anteckningar, privata anteckningar, ägare och aktivitetsflödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — mallar, anpassade fält, roller, regler och arbetsflödesutlösare.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som får höra om incidenten du just deklarerat.
- [Incident- och varningsmallar](/docs/monitor/incident-alert-templating) — variablerna som finns för automatiskt deklarerade incidenter.
