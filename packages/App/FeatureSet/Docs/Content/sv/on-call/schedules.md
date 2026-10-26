# Jourscheman

Ett jourschema bestämmer vem som har jour vid varje tidpunkt. Personer turas om i det: var och en har jour en tid, sedan tar nästa över. Lägg till ett schema i en jourpolicys eskaleringsregler, så larmar policyn den som har jour i det när den nivån körs.

> [!NOTE]
> På OneUptime Cloud ingår jourscheman i planen **Growth** och högre. Ett schema som ett projekt fortfarande har fortsätter att larma personerna i det, via de eskaleringsregler som nämner det, efter att en provperiod för Growth har tagit slut eller planen har sänkts. Under **Growth** visar därför sidan **Jourscheman** anteckningen om planen med de scheman som fortfarande är inställda under den, där du kan ta bort dem. Att skapa eller ändra ett schema kräver **Growth**.

:::cards
- [Vilka som turas om](#vilka-som-turas-om): Skapa ett schema med dess första rotation.
- [Lager](#lager): Stapla rotationer, begränsa jourtiderna och lägg till reservtäckning.
- [När någon är borta](#när-någon-är-borta): Hoppa över någon i rotationen tills hen är tillbaka.
- [API och Terraform](#skapa-scheman-med-apiet-eller-terraform): Skapa scheman och deras rotationer som kod.
:::

## Vilka som turas om

När du skapar ett schema på sidan **Jourscheman** frågar formuläret efter dess **Namn** och **Vilka turas om?**. De personer du väljer blir schemats första lager, **Layer 1**, med jour dygnet runt.

:::steps
1. Gå till **Jourtjänst** > **Jourscheman** och klicka på **Skapa jourschema**.
2. Ange ett **Namn**.
3. Klicka på **Lägg till användare** under **Vilka turas om?** och välj personerna i den ordning de turas om.
4. Öppna eventuellt **Fler fält** för att ändra hur länge varje pass varar, tidszonen, beskrivningen eller etiketterna.
5. Klicka på **Skapa jourschema**. Det nya schemat öppnas sedan på sin sida **Lager**, där du kan ändra rotationen eller lägga till fler lager.
:::

Personerna turas om en i taget, och den första har jour så snart schemat har skapats:

```mermaid title="Layer 1 med tre personer och pass på 1 vecka"
flowchart TB
    alice["Alice<br/>vecka 1"] -->|"överlämning"| bob["Bob<br/>vecka 2"]
    bob -->|"överlämning"| carol["Carol<br/>vecka 3"]
    carol -->|"tillbaka till den första"| alice
```

**Vilka turas om?** är valfritt. Lämnar du det tomt börjar schemat utan lager: det sätter ingen på jour förrän du lägger till ett lager på dess sida **Lager**. Frågan ställs bara till dem som får lägga till lager.

Allt annat finns under **Fler fält**, hopfällt tills du öppnar det:

| Fält | Vad det gör |
| --- | --- |
| **Varje pass varar** | **1 dag**, **1 vecka**, **2 veckor** eller **1 månad**, och **1 vecka** om du inte ändrar det. Det frågas efter så snart någon turas om. Varje person har jour så länge, sedan tar nästa över, vid den tid på dygnet då schemat skapades. |
| **Tidszon** | Den tidszon som överlämningstider och jourtider hålls i. Den börjar på din. |
| **Beskrivning** | Anteckningar om schemat. |
| **Etiketter** | Etiketter för att hitta och gruppera schemat. |

Så länge någon turas om och inget under **Fler fält** har ändrats säger den hopfällda rubriken vad som kommer att hända: varje person har jour i en vecka, sedan tar nästa över.

## Lager

Ett schemas rotation består av lager, på dess sida **Lager**. Lagren läses uppifrån och ned: det översta lagret där någon har jour är det som larmar, så lägg huvudrotationen överst och reservtäckningen under den.

```mermaid title="Det översta lagret där någon har jour är det som larmar"
flowchart TB
    start["En nivå larmar schemat"] --> first{"Någon med jour<br/>i det översta lagret?"}
    first -->|"Ja"| pageTop["Larma den personen"]
    first -->|"Nej"| next{"Någon med jour<br/>i nästa lager?"}
    next -->|"Ja"| pageNext["Larma den personen"]
    next -->|"Nej"| gap["Ingen larmas<br/>en täckningslucka"]
```

**Lägg till lager** lägger till ett lager som börjar som det första: jour från och med nu, varje person en vecka, dygnet runt. Expandera ett lager för att lägga till personer i det och för att ändra när det börjar, hur ofta det lämnar över, när det lämnar över första gången och de tider det har jour:

| Fält | Vad det anger |
| --- | --- |
| **Lagernamn** | Vad lagret täcker, till exempel "Primär vardagar". |
| **Rotationen börjar** | Det datum och den tid då lagrets rotation börjar. |
| **Rotera varje** | Hur ofta jouren går över till nästa person i lagret. |
| **Tid för första överlämning** | Den första överlämningen till nästa person, vid eller efter starten. Senare överlämningar följer varje rotationsintervall. |
| **Begränsningar** | De tider lagret har jour: **Inga begränsningar**, **Specifika tider på dygnet** eller **Specifika tider i veckan**, i schemats tidszon. Utanför dem tar lägre lager över. |

För att ändra vilket lager som kommer först använder du **Flytta lager uppåt (högre prioritet)** eller **Flytta lager nedåt (lägre prioritet)** i ett lagers meny.

Varje person behåller en färg överallt, så att du kan följa personen med en blick: i varje lager, i det slutliga schemat och dess åsidosättningar och på **Tidslinje för jourscheman**.

## När någon är borta

När någon åker på semester hoppar du över personen tills hen är tillbaka. Fäll ut ett lager på schemats sida **Lager** och klicka på **Hoppa över till…** bredvid personens namn. Det öppnar formuläret för frånvaro med personen under **Vem är borta?**, **Nästa person i rotationen** under **Vem täcker upp?** och **Börjar** från nu: ställ in **Slutar** på när hen är tillbaka och spara.

Medan personen är borta:

- Vart och ett av personens pass går till nästa person i lagret som inte är borta, i varje schema som hen ingår i. Ingen annans pass flyttas, och personens pass är hens igen så snart hen är tillbaka.
- Om alla i ett lager är borta har lagret ingen i jour, och lagren under tar över. Lagret visar **Alla i det här lagret är borta just nu**.
- Eskaleringsregler som larmar personen direkt eller via ett team hoppar över hen. Policyns körning visar att hen är borta, och till när.
- Personens rad i lagret visar när hen är tillbaka, och det slutliga schemat och **Tidslinje för jourscheman** visar vem som har vart och ett av hens pass.

Väljer du i stället någon under **Vem täcker upp?** får den personen alla hens larm, från varje schema och varje policy, i stället för att rotationen tar hens pass.

Frånvaro som läggs till på det här sättet gäller för alla jourpolicyer. Den listas under **Jourtjänst** > **Avancerad** > **Användaråsidosättningar**, där du kan ta bort den för att få tillbaka personen tidigare. För att hoppa över någon i bara en policy lägger du till åsidosättningen på den policyns sida **Användaråsidosättningar** och låter **Vem täcker upp?** vara som det är. Se [Användaråsidosättningar](/docs/on-call/user-overrides).

Via API:et hoppar en användaråsidosättning (`/api/on-call-duty-policy-user-override`) som skapas utan `routeAlertsToUserId` över personen i `overrideUserId` från `startsAt` till `endsAt`.

## Skapa scheman med API:et eller Terraform

Jourscheman är resursen `/api/on-call-duty-policy-schedule`; deras lager och personerna i dem är resurserna `/api/on-call-duty-schedule-layer` och `/api/on-call-duty-schedule-layer-user`.

- Att skapa ett schema med `firstLayerUsers` (en lista med användar-id:n, i den ordning de turas om) i dess `miscDataProps` ger det dess första lager, som instrumentpanelen gör: **Layer 1**, med jour från och med nu, dygnet runt. `firstLayerRotation` anger hur länge varje pass varar, som en rotation som `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; utan den en vecka. Varje användare måste vara medlem i projektet och anroparen måste få skapa lager, annars skapas inte schemat.
- Ett schema som skapas utan dem har inga lager, som tidigare; Terraforms resurs för scheman skickar dem inte.
- Ett lager som skapas utan `rotation` lämnar över dagligen, som det alltid har gjort.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy-schedule \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Primary on-call",
      "timezone": "Europe/Berlin"
    },
    "miscDataProps": {
      "firstLayerUsers": ["<user-id-1>", "<user-id-2>", "<user-id-3>"],
      "firstLayerRotation": {"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}
    }
  }'
```

## Nästa steg

:::cards
- [Eskaleringsregler](/docs/on-call/escalation-rules): Låt en nivå i en jourpolicy larma det här schemat.
- [Tidslinje för jourscheman](/docs/on-call/schedule-timeline): Se alla scheman sida vid sida, med täckningsluckorna.
- [Kalenderflöden](/docs/on-call/calendar-feeds): Lägg in pass i Google Kalender, Outlook eller Apple Kalender.
- [Personliga jourregler](/docs/notifications/on-call-rules): Bestäm hur ett larm når dig medan du har jour.
:::
