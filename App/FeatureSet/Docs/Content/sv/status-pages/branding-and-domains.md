# Varumärke och anpassade domäner

En statussida är den enda OneUptime-yta dina kunder faktiskt tittar på, så den bör se ut som att den tillhör dig och bo på din egen domän. Båda delarna konfigureras från sektionen **Varumärke** i en statussidas sidomeny, plus en inställning som gömmer sig i **Avancerade inställningar**.

Det du bör veta innan du börjar: varumärkning är uppdelad på sju separata skärmar, och uppdelningen ligger inte alltid där du skulle gissa. Logotypen och omslagsbilden finns inte på **Essentiellt varumärke** — de finns på **Sidhuvud**. Faviconen finns på **Essentiellt varumärke**. Färger finns på **Översiktssida**. Allt annat du kanske tänker på som "temasättning" är anpassad CSS.

Den här sidan går igenom varje skärm i tur och ordning och tar dig sedan genom hela sekvensen CNAME-sedan-SSL för att lägga sidan på `status.yourcompany.com`.

## Var varje varumärkesreglage bor

Öppna en statussida så har sidomenyns sektion **Varumärke** sju poster. Här är kartan, så att du slutar leta.

| Sida                           | Vad du sätter där                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Essentiellt varumärke**      | Sidtitel, sidbeskrivning, indexering i sökmotorer, favicon.                                                |
| **Sidhuvud**                   | Logotyp, omslagsbild, deras alt-texter och länkraden i sidhuvudet.                                         |
| **Sidfot**                     | Upphovsrättsrad och länkraden i sidfoten.                                                                  |
| **Översiktssida**              | Översiktsbeskrivning, stapelfärger i historikdiagrammet, driftstoppsstatusar, övergripande drifttidsprocent. |
| **HTML, CSS och JavaScript**   | Sidhuvuds-HTML, sidfots-HTML, anpassad CSS, anpassad JavaScript.                                           |
| **Anpassade domäner**          | Din egen domän, CNAME-verifiering och SSL.                                                                 |
| **Språk**                      | Standardspråk och de språk som erbjuds i sidfotens språkväljare.                                           |

## Essentiellt varumärke

**Statussidor → din sida → Varumärke → Essentiellt varumärke** (`{id}/branding`) rymmer tre kort.

- **Titel och beskrivning** — kortet noterar att detta också används för SEO. **Redigera** öppnar **Sidtitel** (platshållare `Please enter page title here.`) och **Sidbeskrivning**. Det här är vad sökmotorer och länkförhandsvisningar visar, så skriv det för en kund, inte för ditt team.
- **Search Engine Indexing** — en enda växel, **Allow Search Engines to Index this Status Page**, beskriven i produkten som att styra om Google och Bing får lista sidan i sina resultat. Den är på som standard. Slå av den så serveras sidan med `noindex, nofollow` i stället.
- **Favicon** — **Edit Favicon** öppnar bilduppladdningen **Favicon**. Det här är den lilla ikonen i webbläsarfliken.

Använd det när: sidan bara är intern eller fortfarande håller på att sättas upp. Slå av **Allow Search Engines to Index this Status Page** så att en halvfärdig sida inte börjar ranka på ditt varumärkesnamn.

## Sidhuvudsskärmen

**Statussidor → din sida → Varumärke → Sidhuvud** (`{id}/header-style`). Trots namnet i sidomenyn är det här dina två största varumärkestillgångar bor.

Det första kortet har rubriken **Logotyp, omslag och favicon**, med en knapp **Edit Images**:

- **Logotyp** — bilduppladdning, platshållare `Upload logo`.
- **Logo Alt Text** — platshållare `Logo of My Company`. Om du lämnar den tom används statussidans titel i stället.
- **Omslag** — bilduppladdning, platshållare `Upload cover image`. Det här är den breda bannern bakom sidhuvudet.
- **Cover Image Alt Text** — samma idé för omslaget.

Under det finns en tabell **Sidhuvudslänkar** ("Sidhuvudslänkar för din statussida"). Varje länk har en **Titel** och en **Länk** (en URL, platshållare `https://link.com`), och rader ordnas om genom dragning. Utan några konfigurerade lyder tabellen "Ingen länk i sidhuvudet för denna statussida."

Bra för: att peka besökare tillbaka till din marknadsföringssajt, din dokumentation eller en supportportal utan att låta dem gissa URL:en.

## Sidfotsskärmen

**Statussidor → din sida → Varumärke → Sidfot** (`{id}/footer-style`) har samma form som **Sidhuvud**, ett kort och en tabell.

- **Upphovsrättsinformation** — **Edit Copyright** öppnar ett enda fält, **Upphovsrättsinformation**, med platshållaren `Acme, Inc.`.
- **Sidfotslänkar** — samma par **Titel** plus **Länk**, dragordnade, tomt meddelande "Ingen länk i sidfoten för denna statussida."

Länkar till juridik, integritet och villkor hör hemma här. Sidhuvudslänkar är för navigering; sidfotslänkar är för det finstilta.

## Varumärkning av översiktssidan

**Statussidor → din sida → Varumärke → Översiktssida** (`{id}/overview-page-branding`) är den enda skärmen där färger kan konfigureras, och den bestämmer också vad "nere" betyder i diagrammet.

- **Översiktssida** — **Edit Branding** öppnar ett markdown-fält, **Beskrivning av översiktssida.**, som renderas ovanför resurslistan. Använd det för en mening med sammanhang: vad den här sidan täcker och vart man går för support.
- **Rules for Bar Colors of History Chart** — en ordnad, dragsorterbar tabell av regler. Varje regel har **När drifttid % är större än eller lika med** och **Använd sedan denna stapelfärg**; tabellkolumnerna lyder `When Uptime Percent >=` och `Then, Bar Color is`. Ordningen spelar roll, så arrangera dem som du vill att de utvärderas.
- **Statusar för driftstoppsövervakare** — **Edit Statuses** öppnar en flervalslista som beskrivs som "These monitor statuses are considered as down". Så här bestämmer du om till exempel en försämrad status ska räknas mot drifttiden på den här sidan.
- **Standardfärg för stapeln i historikdiagrammet** — **Edit Default Bar Color** öppnar väljaren **Standardfärg för stapel**, färgen som används när ingen regel matchar.
- **Övergripande drifttid i procent** — **Edit Settings** öppnar växeln **Visa total upptidsprocent** och en rullgardinsmeny **Välj precision för drifttid**, som är två decimaler som standard (`99.99% (Two Decimal)`).

**Hur många dagar diagrammet täcker sätts inte här.** Det är **Visa upptidshistorik (i dagar)** på **Statussidor → din sida → Avancerad → Avancerade inställningar** (`{id}/settings`), giltigt från 1 till 90.

## Anpassad HTML, CSS och JavaScript

**Statussidor → din sida → Varumärke → HTML, CSS och JavaScript** (`{id}/custom-code`) har fyra kort som redigeras oberoende av varandra, uppbackade av kolumnerna `headerHTML`, `footerHTML`, `customCSS` och `customJavaScript` på statussidan:

- **Sidhuvud-HTML** — platshållare `Insert Custom HTML here.`, injiceras i sidans sidhuvud.
- **Sidfots-HTML** — samma sak, för sidfoten.
- **Anpassad CSS** — platshållare `Insert Custom CSS here.`
- **Anpassad JavaScript** — platshållare `Insert Custom JavaScript here.`

**Det finns ingen temaväljare.** OneUptimes statussidor har ingen tema- eller varumärkesfärgsinställning: de enda inbyggda färgreglagen någonstans är **Standardfärg för stapel** och stapelfärgsreglerna för historikdiagrammet på skärmen **Översiktssida**. Typsnitt, bakgrundsfärger, accentfärger och layoutjusteringar går alla via **Anpassad CSS** här. Om du har letat efter ett fält för "varumärkesfärg" är det här svaret — det finns inget, och den här rutan är nödutgången.

> Anpassad JavaScript körs i dina besökares webbläsare på en sida som folk laddar precis när de är oroliga att något är trasigt. Håll den liten, håll den självhostad där du kan, och testa den innan du förlitar dig på den.

## Språkinställningar

**Statussidor → din sida → Varumärke → Språk** (`{id}/languages`) har två kort, och båda handlar om språkväljaren besökare får i sidans sidfot.

- **Standardspråk** — **Edit Default Language** öppnar en rullgardinsmeny som listar varje språk som stöds med sitt inhemska namn och sitt engelska namn (`Deutsch (German)`). Kortet beskriver det som språket förstagångsbesökare ser; besökare kan alltid byta från sidfoten. Standard är engelska.
- **Aktiverade språk** — **Edit Enabled Languages** öppnar en flervalslista, platshållare `All languages`. Lämna den tom så erbjuds varje språk som stöds. Välj några så listar sidfotens väljare bara dem.

Sexton språk följer med OneUptime: engelska, tyska, franska, spanska, italienska, portugisiska, nederländska, danska, norska, svenska, ryska, japanska, koreanska, kinesiska (förenklad), kinesiska (traditionell) och hindi.

## Anpassade domäner

Som standard nås en statussida på den förhandsgransknings-URL som visas på dess skärm **Översikt**. För att lägga den på ditt eget värdnamn, gå till **Statussidor → din sida → Varumärke → Anpassade domäner** (`{id}/domains`).

Kortet har rubriken **Anpassade domäner** och dess beskrivning stavar ut kravet direkt: lägg till din installations CNAME-post för statussidor som CNAME för dessa domäner för att det ska fungera. Utan något konfigurerat lyder tabellen "Inga anpassade domäner hittades." Tabellen har två kolumner, **Domän** och **Status**, och filter för **Domän**, **CNAME giltig** och **SSL provisionerat**.

### Innan du börjar

Två förutsättningar, och att hoppa över någon av dem är den vanligaste anledningen till att detta inte fungerar:

- **Föräldradomänen måste redan vara verifierad.** Rullgardinsmenyn **Domän** listar bara verifierade domäner från projektinställningarna — fältets egen hjälptext pekar dig mot **Mer → Projektinställningar → Anpassade domäner** för att lägga till en först.
- **Installationen måste ha en CNAME-post för statussidor konfigurerad.** På självhostade driftsättningar är det miljövariabeln `STATUS_PAGE_CNAME_RECORD` i Docker Compose, eller `statusPage.cnameRecord` i Helms `values.yaml`. Utan den visar både modalen **Lägg till CNAME** och modalen **Beställ kostnadsfri SSL** meddelandet "Custom Domains not enabled for this OneUptime installation" i stället för instruktioner.

### Lägga till domänen

Klicka på **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har två steg:

**Grundläggande**

- **Underdomän** — bara etiketten, platshållare `status (leave blank for root)`. Skriv bara `status`, inte hela värdnamnet. Lämna den tom eller skriv `@` för att använda rot-/apexdomänen.
- **Domän** — en rullgardinsmeny över verifierade domäner, platshållare `Select domain`.

**Mer**

- **Ladda upp anpassat certifikat** — en växel, av som standard. Låt den vara av så beställer OneUptime ett kostnadsfritt certifikat åt dig. Slå på den så får du fälten **Certifikat** och **Privat certifikatnyckel** för ditt eget PEM-material.

## Verifiera CNAME:et

Medan domänen är overifierad visar raden en åtgärd **Lägg till CNAME**. Den öppnar en modal med rubriken **Lägg till CNAME** som ger dig exakt vad du ska klistra in hos din DNS-leverantör:

- **Posttyp** — `CNAME`
- **Namn** — den fullständiga domänen du just skapade, till exempel `status.yourcompany.com`
- **Innehåll** — din installations CNAME-post för statussidor

Modalen noterar att när posten väl är på plats kan automatisk verifiering ta upp till 24 timmar. Du behöver inte vänta på det: modalens skicka-knapp är **Verifiera CNAME**, som kontrollerar posten på begäran.

Skapa DNS-posten först, klicka sedan på **Verifiera CNAME**. Att klicka på den innan posten finns misslyckas bara.

## Beställa ett SSL-certifikat

När CNAME:et är verifierat — och bara om du inte laddade upp ditt eget certifikat — dyker en åtgärd **Beställ kostnadsfri SSL** upp på raden. Dess modal, **Order Free SSL Certificate for this Status Page**, förklarar att OneUptime använder LetsEncrypt, att processen är säker och kostnadsfri och att provisioneringen tar några timmar efter att beställningen lagts. Skicka-knappen är **Beställ kostnadsfri SSL**.

**De angivna tiderna är oense mellan skärmarna**, så läs inte in för mycket i något enskilt tal: beställningsmodalen säger tre timmar, kolumnen **Status** säger en timme, och ett anpassat certifikat säger trettio minuter. Behandla dem alla som "kom tillbaka senare idag", och kontakta supporten om inget har hänt då.

När det väl är provisionerat sker förnyelsen automatiskt. Det finns inget återkommande för dig att göra.

## Läsa domänens Status-kolumn

Kolumnen **Status** är hela uppsättningstillståndsmaskinen i en cell. Varje meddelande talar om antingen vad du ska göra härnäst eller att du är klar.

| Vad Status-kolumnen säger                             | Vad det betyder                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME:et är inte verifierat ännu. Lägg till posten, sedan **Verifiera CNAME**.        |
| Action Required: Please order SSL certificate.        | CNAME:et är verifierat men inget certifikat är beställt. Klicka på **Beställ kostnadsfri SSL**. |
| No action is required, allow 30 minutes to provision. | Du laddade upp ett anpassat certifikat och det håller på att installeras.             |
| No action is required, this will be provisioned soon. | Det kostnadsfria certifikatet är beställt och på väg. Kontakta supporten om det aldrig landar. |
| Certificate Provisioned. No action required.          | Klart. OneUptime förnyar certifikatet automatiskt.                                    |

Om en rad står kvar på "Action Required: Please add your CNAME record." långt efter att du skapat DNS-posten, kontrollera att postens namn är den fullständiga domänen och att dess innehåll exakt matchar din installations CNAME-post.

## Powered by OneUptime

Raden "Powered by OneUptime" är inte en inställning i varumärkessektionen. Den bor på **Statussidor → din sida → Avancerad → Avancerade inställningar** (`{id}/settings`), i kortet **Drivs av OneUptime-varumärke**, som en enda växel: **Dölj "Powered By OneUptime"-varumärke**. **Edit Settings** öppnar den, precis som varje annat kort på den sidan.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur delarna hänger ihop.
- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — välja vad besökarna faktiskt ser på sidan.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — e-post-, SMS-, Slack- och webhook-prenumeranter, plus meddelanden.
- [Offentligt API](/docs/status-pages/public-api) — läsa statussidedata programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att visas på och försvinna från sidan.
