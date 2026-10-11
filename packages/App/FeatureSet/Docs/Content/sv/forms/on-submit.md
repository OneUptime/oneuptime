# Vad en inlämning skapar

Varje inlämning via ett formulär skapar en post i ditt projekt: en **incident** eller en **schemalagd underhållshändelse**. Ett formulärs sida **Vid inlämning** visar vilken, och hur varje fält på den nya posten fylls i — från ett svar, från ett standardvärde, från en inställning som alltid gäller, eller från incidentmallen. **Redigera inställningar** ändrar standardvärdena och det som alltid gäller.

:::cards
- [Så blir en inlämning en incident](#så-blir-en-inlämning-en-incident): Varje fält på den nya incidenten, och var dess värde kommer ifrån.
- [Så blir en inlämning en schemalagd underhållshändelse](#så-blir-en-inlämning-en-schemalagd-underhållshändelse): Samma sak, för en underhållsbegäran.
- [Inställningarna Vid inlämning](#inställningarna-vid-inlämning): Standardvärden, vad som alltid bifogas, ägare och publicering.
- [Den privata anteckningen](#den-privata-anteckningen): Vem som skickade den, och de svar som inget fält innehåller.
:::

## Vad som händer vid inlämning

```mermaid title="Från en inlämning till en incident eller en underhållshändelse"
flowchart TB
    submit["Skicka"] --> checks["Skydd och<br/>kontroll av svaren"]
    checks --> fields["Varje fält: svaret,<br/>annars inställningarna Vid inlämning,<br/>annars incidentmallen"]
    fields --> record["Incidenten eller<br/>underhållshändelsen"]
    record --> note["En privat anteckning: vem som skickade den,<br/>och de andra svaren"]
    record --> runs["Regler, jourpolicyer<br/>och arbetsflöden körs"]
```

En inlämning som inte klarar en kontroll skapar ingenting. Se [Vad som skyddar ett formulär](/docs/forms/sharing-and-security#vad-som-skyddar-ett-formulär).

## Vad varje inlämning skapar

Kortet **Vad varje inlämning skapar** innehåller det val du gjorde när du skapade formuläret:

- **Incident** — varje inlämning deklarerar en incident, så att ditt jourteam får veta det direkt. Använd det för problemrapporter.
- **Schemalagt underhåll** — varje inlämning schemalägger en underhållshändelse. Använd det för ändrings- och underhållsbegäranden.

Att välja det andra ber dig bekräfta, eftersom formuläret ändras med det:

- Titeln, beskrivningen, monitorerna och etiketterna förblir kopplade: båda typerna av poster har dem.
- Varje annan kopplad fråga — en allvarlighetsgrad, ett val av statussida, ett anpassat fält av den gamla typen — blir en av formulärets egna frågor, med samma formulering, vars svar visas i den privata anteckningen.
- Inställningarna Vid inlämning börjar om, eftersom inställningarna för en incident och för en händelse är olika.
- Ett formulär som nu skapar underhållshändelser frågar när underhållet börjar och slutar.

Frågorna sparas direkt, tillsammans med ändringen. Kontrollera dem på sidan **Bygg**.

## Så blir en inlämning en incident

Kortet visar varje fält på den nya incidenten och var dess värde kommer ifrån:

| Fält | Kommer från |
| --- | --- |
| **Titel** | Svaret på frågan **Titel**. När formuläret inte frågar efter den, eller den lämnas tom: **Standardtitel**, annars formulärets namn. |
| **Beskrivning** | Svaret på frågan **Beskrivning**. När den inte efterfrågas eller lämnas tom, incidentmallens beskrivning, om formuläret har en mall. |
| **Allvarlighetsgrad** | Inlämnarens val, när formuläret frågar efter det. Annars formulärets inställning **Allvarlighetsgrad**, annars incidentmallens allvarlighetsgrad. |
| **Monitorer** | De monitorer som inlämnaren valde, tillsammans med de som inställningarna alltid bifogar. Utan någon av dem, incidentmallens. |
| **Etiketter** | De etiketter som inlämnaren valde, tillsammans med de som inställningarna alltid lägger till. Utan någon av dem, incidentmallens. |
| **Påverkan började** | Svaret på **Påverkan började**, när formuläret frågar efter det. |
| **Incident Mall** | Formulärets inställning **Incident Mall**. Den fyller i allt som svaren och inställningarna lämnar oangivet. |
| **Jourpolicyer** | De policyer som inställningarna anger, körda för varje incident som formuläret deklarerar. Utan några, incidentmallens. |
| **Ägare** | De personer och team som inställningarna anger, tillsammans med mallens ägare. De får veta om varje incident. |
| **Anpassade fält** | Svaret på varje fråga om ett anpassat fält — om inte fältet kopierar sitt värde från ett anpassat monitorfält och incidentens monitorer har ett; mallen fyller i resten. |
| **Statussidor** | Visas aldrig på statussidor, och prenumeranter får inte veta något, förrän någon i ditt team publicerar den. |
| **Övriga svar** | Visas i en privat anteckning på incidenten, med vem som lämnade in. |

> [!IMPORTANT]
> **Ingen allvarlighetsgrad, ingen incident.** En incident behöver en allvarlighetsgrad. När formuläret inte frågar efter en och dess inställningar inte anger någon — eller den angivna har tagits bort — och dess mall inte heller anger någon, varnar raden **Allvarlighetsgrad** dig, och varje inlämning avvisas med "Det här formuläret kan inte skapa en incident eftersom det saknar allvarlighetsgrad. Meddela teamet som delade det." Välj en allvarlighetsgrad i **Redigera inställningar**, eller en mall som anger en.

### Incidentmallen

Välj en **Incident Mall** i inställningarna så deklareras varje incident som formuläret deklarerar utifrån den, på samma sätt som servern tillämpar en mall överallt — se [Så tillämpas en mall](/docs/incidents/settings#så-tillämpas-en-mall). Svaren och formulärets inställningar kommer först, och mallen fyller i allt annat: det inledande tillståndet, beskrivningen, allvarlighetsgraden, de berörda resurserna, jourpolicyerna, ägarna, etiketterna, värdena i anpassade fält och en ändring av monitorstatus.

> [!WARNING]
> **Tänk på monitorerna.** Att deklarera en incident på en monitor via ett formulär påverkar monitoren exakt som att deklarera en incident på den manuellt: den aktiva övervakningen av monitoren pausas tills incidenten är löst, och en malls **Ändra övervakningsstatus till** ändrar monitorns status direkt — på varje statussida som visar monitoren, även medan själva incidenten är dold. Med ett formulär kan alla som har länken göra detta. Bifoga bara monitorer via ett formulär när varje inlämning ska pausa dem.

### Hur incidenten ser ut

En incident som deklareras via ett formulär är en vanlig incident, med några egna inställningar:

- **Dold från statussidor.** **Synlig på statussidan** är avstängt, och det är **Meddela statussideprenumeranter** också. Tills en responder publicerar den når inget om incidenten en statussida eller en prenumerant — förutom en malls ändring av monitorstatus, ovan.
- **Deklarerad av ingen.** Inlämnaren är inte en OneUptime-användare, så ingen användare registreras som den som deklarerade incidenten.
- **Dess ägare får veta.** De ägare som inställningarna och mallen anger läggs till så snart incidentens Slack- och Microsoft Teams-kanaler finns, och aviseras — incidentens avisering **Incident skapad** väntar tills de är dess ägare, så att den går till dem i stället för till projektets ägare.
- **En privat anteckning registrerar inlämningen** — se [Den privata anteckningen](#den-privata-anteckningen).

Allt som körs för en ny incident körs även för dessa: integritets-, ägar-, etikett-, jour- och runbook-regler, jourpolicyer och arbetsflöden med **On Create Incident**. Jourregler matchar ett formulärs incidenter som alla andra — även på deras titel och beskrivning, som inlämnaren skrev.

:::steps
#### Läs vad inlämnaren skrev

Titeln och beskrivningen visas på statussidor när incidenten har publicerats.

#### Publicera incidenten

Slå på **Synlig på statussidan** från incidentens sida **Inställningar**.

#### Meddela prenumeranterna, om de ska veta

Eftersom incidenten deklarerades med **Meddela statussideprenumeranter** avstängt skickar en publicering inte aviseringen "incident skapad". För att meddela prenumeranterna publicerar du en offentlig anteckning med **Meddela statussideprenumeranter** ikryssat — se [Publicera en offentlig anteckning](/docs/incidents/notes-owners-and-feed#publicera-en-offentlig-anteckning).
:::

## Så blir en inlämning en schemalagd underhållshändelse

| Fält | Kommer från |
| --- | --- |
| **Titel** | Svaret på frågan **Titel**. När formuläret inte frågar efter den, eller den lämnas tom: **Standardtitel**, annars formulärets namn. |
| **Beskrivning** | Svaret på frågan **Beskrivning**. |
| **Börjar den**, **Slutar den** | Svaren på **Börjar den** och **Slutar den**, som varje underhållsformulär frågar efter och kräver. Slutet måste ligga efter början. |
| **Monitorer** | De monitorer som inlämnaren valde, tillsammans med de som inställningarna alltid bifogar. |
| **Statussidor** | De statussidor som inlämnaren valde, tillsammans med de som inställningarna anger. |
| **Etiketter** | De etiketter som inlämnaren valde, tillsammans med de som inställningarna alltid lägger till. |
| **Ägare** | De personer och team som inställningarna anger. De äger varje händelse som formuläret schemalägger. |
| **Visa på statussidor** | **Nej** om inte inställningarna slår på det. |
| **Avisera prenumeranter** | **Nej** om inte inställningarna slår på det. |
| **Anpassade fält** | Svaret på varje fråga om ett anpassat fält — om inte fältet kopierar sitt värde från ett anpassat monitorfält och händelsens monitorer har ett. |
| **Övriga svar** | Visas i en privat anteckning på händelsen, med vem som lämnade in. |

Händelsen börjar i projektets tillstånd **Scheduled** och går vidare som alla andra: den blir pågående när den börjar och avslutas när den slutar.

En inlämning är någons begäran, och en begäran granskas innan den publiceras. Så om du inte ändrar det hålls händelsen borta från sina statussidor tills någon i ditt team visar den, och dess prenumeranter får inte veta när den skapas, börjar eller slutar. **Visa på statussidor** och **Avisera prenumeranter**, i inställningarnas steg **Publicering**, ändrar det för varje händelse som formuläret schemalägger — slå bara på dem när du litar på alla som har länken.

## Inställningarna Vid inlämning

**Redigera inställningar** öppnar inställningarna i steg: **Nästa** går vidare, och **Spara ändringar** finns i det sista steget. Varje steg är redan ifyllt, så steglistan bredvid formuläret öppnar vilket som helst av dem, även det sista: ändra en inställning i dess steg, öppna sedan det sista steget och spara.

| Steg | Incidentformulär | Underhållsformulär |
| --- | --- | --- |
| **Standardvärden** | **Standardtitel**, **Allvarlighetsgrad**, **Incident Mall** | **Standardtitel** |
| **Koppla alltid** | **Monitorer**, **Etiketter**, **Jourpolicyer** | **Monitorer**, **Statussidor**, **Etiketter** |
| **Ägare** | **Ägare** | **Ägare** |
| **Publicering** | — | **Visa på statussidor**, **Avisera prenumeranter** |

**Ägare** är en enda väljare för personer och team: **Lägg till ägare** öppnar en enda söklista med båda, och varje val visas som en bricka som du kan ta bort. Allt som inställningarna anger måste höra till formulärets projekt, och ägare måste vara medlemmar i det. En post som tas bort efter att den valdes hoppas över när en inlämning skapas, och resten gäller fortfarande.

## Den privata anteckningen

Varje inlämning lämnar en privat anteckning på det den skapade:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Den anger formuläret och inlämnaren — "Submitted anonymously through the form **Report a Problem**." när formuläret inte frågade vem det är — och anger sedan, när inlämningen började från en av formulärets mallar, vilken: "Started from the template **Application Outage**." — och visar därefter svaren på formulärets egna frågor, vart och ett under sin fråga, i formulärets ordning. Svaren på kopplade frågor finns redan på posten: dess titel, dess allvarlighetsgrad, dess anpassade fält. Eftersom anteckningen är privat når den aldrig en statussida, men den publiceras i postens Slack- och Microsoft Teams-kanaler som vilken annan anteckning som helst.

Adressen är en länk som skriver till exakt den adressen — i instrumentpanelen, i Slack och i e-posten till ägarna.

## Dolda frågor och mallar

En [dold fråga](/docs/forms/building#dolda-frågor) besvaras från den [mall](/docs/forms/building#mallar) som inlämningen började från — aldrig från begäran — och dess svar hamnar exakt där ett inskrivet svar skulle hamna: en dold **Beskrivning** blir incidentens beskrivning, ett dolt anpassat fält dess värde, en dold av formulärets egna frågor en rad i den privata anteckningen. En inlämning som inte började från någon mall lämnar dolda frågor obesvarade, och deras fält fylls i från inställningarna Vid inlämning, som för alla frågor som lämnas tomma. En mall som tas bort medan någon hade formuläret öppet stoppar inte personens inlämning: den skapas som personen svarade, utan mallens dolda svar.

En mall kan ställa formulärets frågor [på sitt eget sätt](/docs/forms/building#så-ställer-en-mall-varje-fråga), och servern håller inlämningen till frågorna som den mall den anger ställer dem. En fråga som mallen döljer besvaras från mallen, som en dold fråga, även när formuläret ställer den; en som mallen ställer läses från begäran, även när formuläret döljer den; och en som mallen kräver måste besvaras, annars avvisas inlämningen och inget skapas.

De svar som en mall fyllde i på sidan blir inlämnarens så snart inlämningen sker: servern tar de svar som begäran skickar för de frågor som sidan ställer, vad mallen än sa.

## Text som en inlämnare skriver

En inlämning går direkt till platser där text kan agera på egen hand — Slack- och Microsoft Teams-kanaler, varje responders webbläsare, ägarnas e-post — och ingen läser den först. Så innan posten skapas:

| Vad inlämnaren skriver | Vad som lagras |
| --- | --- |
| Ett omnämnande, som \<!channel\>, \<!here\> eller \<@U0123ABC\>, i titeln, beskrivningen eller vilket textsvar som helst | **Omnämnanden aviserar ingen.** Allt som Slack läser som ett omnämnande får ett osynligt tecken efter sin inledande hakparentes. Det läses likadant överallt, men inget chattverktyg agerar på det. |
| En bild, i beskrivningen eller ett svar av typen **Formaterad text** | **Bilder blir länkar.** Varje bild blir en länk till samma adress, så inget läses in från den plats som inlämnaren valde förrän en responder klickar på den. |
| Ett kodblock vars språk är `mermaid`, oavsett stavning | **Diagram blir kod.** Det lagras som vanlig kod, så det visar sin text i stället för att rita ett diagram. |
| Bildsyntax eller ett diagramblock i titeln | **Titeln är vanlig text.** De får också det osynliga tecknet, så var titeln än hamnar — en episod, ett chattmeddelande, en anteckningsmall — läser den inte in något och ritar inget. De osynliga tecknen räknas in i titelns gräns. |

Allt annat — länkar, resten av Markdown, val i listrutor, tal, datum, en ikryssad ruta — lagras som inlämnaren angav det, och inlämningen behåller inlämnarens namn och e-post som de skrevs.

## Nästa steg

:::cards
- [Bygga ett formulär](/docs/forms/building): Frågorna som fyller de här fälten, dolda frågor och mallar.
- [Incidentinställningar och automatisering](/docs/incidents/settings): Incidentmallar och anpassade fält.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed): Privata anteckningar, offentliga anteckningar och ägare.
- [Delning & säkerhet](/docs/forms/sharing-and-security): Vem som kan lämna in, och hur ofta.
:::
