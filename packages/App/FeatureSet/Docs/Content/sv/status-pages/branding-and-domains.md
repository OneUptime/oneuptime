# Varumärke och anpassade domäner

En statussida är den enda yta i OneUptime era kunder faktiskt tittar på, så den bör se ut som er och ligga på er egen domän. Båda delarna konfigureras från sektionen **Varumärke** i en statussidas sidomeny, plus en inställning som gömmer sig i **Avancerade inställningar**.

Det du bör veta innan du börjar: varumärkesinställningarna är utspridda över sju skilda skärmar, och uppdelningen ligger inte alltid där du skulle gissa. Logotypen och omslagsbilden finns inte på **Essentiellt varumärke** — de finns på **Sidhuvud**. Faviconen finns på **Essentiellt varumärke**. Färgerna finns på **Översiktssida**. Allt annat du kanske tänker på som "tema" är anpassad CSS.

Den här sidan går igenom en skärm i taget och tar dig sedan genom hela sekvensen med CNAME och därefter SSL, för att lägga sidan på `status.dittforetag.se`.

## Var varje varumärkesreglage finns

Öppna en statussida, så har sidomenyns sektion **Varumärke** sju poster. Här är kartan, så att du slipper leta.

| Sida                             | Vad du sätter där                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Essentiellt varumärke**        | Sidtitel, sidbeskrivning, indexering i sökmotorer, favicon.                                        |
| **Sidhuvud**                     | Logotyp, omslagsbild, deras alt-texter och länkraden i sidhuvudet.                                  |
| **Sidfot**                       | Upphovsrättsraden och länkraden i sidfoten.                                                        |
| **Översiktssida**                | Beskrivning på översikten, stapelfärger i historikdiagrammet, statusar för driftstopp, total drifttid i procent. |
| **HTML, CSS och JavaScript**     | HTML i sidhuvudet, HTML i sidfoten, anpassad CSS, anpassad JavaScript.                             |
| **Anpassade domäner**            | Er egen domän, CNAME-verifiering och SSL.                                                          |
| **Språk**                        | Standardspråk och de språk som erbjuds i sidfotens språkväljare.                                   |

## Essentiellt varumärke

**Statussidor → din sida → Varumärke → Essentiellt varumärke** (`{id}/branding`) rymmer tre kort.

- **Titel och beskrivning** — kortet påpekar att detta också används för SEO. **Redigera** öppnar **Sidtitel** (platshållare `Please enter page title here.`) och **Sidbeskrivning**. Det här är vad sökmotorer och länkförhandsvisningar visar, så skriv det för en kund, inte för ert team.
- **Search Engine Indexing** — en enda växel, **Allow Search Engines to Index this Status Page**, som i produkten beskrivs som att styra om Google och Bing får lista sidan i sina resultat. Den är på som standard. Slå av den så serveras sidan med `noindex, nofollow` i stället.
- **Favicon** — **Edit Favicon** öppnar bilduppladdningen **Favicon**. Det är den lilla ikonen i webbläsarfliken.

Använd det när: sidan bara är intern eller fortfarande håller på att sättas upp. Slå av **Allow Search Engines to Index this Status Page** så att en halvfärdig sida inte börjar ranka på ert varumärkesnamn.

## Skärmen Sidhuvud

**Statussidor → din sida → Varumärke → Sidhuvud** (`{id}/header-style`). Trots namnet i sidomenyn är det här era två största varumärkestillgångar bor.

Första kortet heter **Logotyp, omslag och favicon** och har en knapp **Edit Images**:

- **Logotyp** — bilduppladdning, platshållare `Upload logo`.
- **Logo Alt Text** — platshållare `Logo of My Company`. Lämnar du den tom används statussidans titel i stället.
- **Omslag** — bilduppladdning, platshållare `Upload cover image`. Det är den breda bannern bakom sidhuvudet.
- **Cover Image Alt Text** — samma sak för omslaget.

Under det ligger en tabell **Sidhuvudslänkar** ("Sidhuvudslänkar för din statussida"). Varje länk har en **Titel** och en **Länk** (en URL, platshållare `https://link.com`), och rader ordnas om genom att dras. Utan några konfigurerade lyder tabellen "Ingen länk i sidhuvudet för denna statussida."

Bra för: att peka besökarna tillbaka till er marknadsföringssajt, er dokumentation eller en supportportal utan att de behöver gissa URL:en.

## Skärmen Sidfot

**Statussidor → din sida → Varumärke → Sidfot** (`{id}/footer-style`) har samma form som **Sidhuvud**, ett kort och en tabell.

- **Upphovsrättsinformation** — **Edit Copyright** öppnar ett enda fält, **Upphovsrättsinformation**, med platshållaren `Acme, Inc.`.
- **Sidfotslänkar** — samma par av **Titel** och **Länk**, dragordnade, med tomtexten "Ingen länk i sidfoten för denna statussida."

Länkar till juridik, integritetspolicy och villkor hör hemma här. Sidhuvudets länkar är till för navigering; sidfotens är till för det finstilta.

## Varumärke på översiktssidan

**Statussidor → din sida → Varumärke → Översiktssida** (`{id}/overview-page-branding`) är den enda skärmen där färger går att ställa in, och den avgör också vad "nere" betyder i diagrammet.

- **Översiktssida** — **Edit Branding** öppnar ett markdown-fält, **Beskrivning av översiktssida.**, som renderas ovanför resurslistan. Använd det för en mening med sammanhang: vad sidan täcker och vart man vänder sig för support.
- **Rules for Bar Colors of History Chart** — en ordnad, dragsorterbar regeltabell. Varje regel har **När drifttid % är större än eller lika med** och **Använd sedan denna stapelfärg**; tabellkolumnerna lyder `When Uptime Percent >=` och `Then, Bar Color is`. Ordningen spelar roll, så lägg dem i den ordning du vill att de utvärderas.
- **Statusar för driftstoppsövervakare** — **Edit Statuses** öppnar ett flerval som beskrivs som "Dessa övervakningsstatusar betraktas som nere". Det är så du avgör om exempelvis en degraderad status ska räknas mot drifttiden på den här sidan.
- **Standardfärg för stapeln i historikdiagrammet** — **Edit Default Bar Color** öppnar väljaren **Standardfärg för stapel**, den färg som används när ingen regel matchar.
- **Övergripande drifttid i procent** — **Edit Settings** öppnar växeln **Visa total upptidsprocent** och en rullgardinsmeny **Välj precision för drifttid**, som är två decimaler som standard (`99.99% (Two Decimal)`).

**Hur många dagar diagrammet täcker sätts inte här.** Det är **Visa upptidshistorik (i dagar)** på **Statussidor → din sida → Avancerad → Avancerade inställningar** (`{id}/settings`), giltigt från 1 till 90.

## Anpassad HTML, CSS och JavaScript

**Statussidor → din sida → Varumärke → HTML, CSS och JavaScript** (`{id}/custom-code`) har fyra kort som redigeras var för sig, uppbackade av kolumnerna `headerHTML`, `footerHTML`, `customCSS` och `customJavaScript` på statussidan:

> Aktiv anpassad HTML, CSS och JavaScript levereras bara på en verifierad anpassad domän. Det är inaktiverat på standardadressen `/status-page/:id`, eftersom URL:en har samma ursprung som den del av OneUptime där användarna är inloggade.

- **Sidhuvud-HTML** — platshållare `Insert Custom HTML here.`, injiceras i sidans sidhuvud.
- **Sidfots-HTML** — samma sak, för sidfoten.
- **Anpassad CSS** — platshållare `Insert Custom CSS here.`
- **Anpassad JavaScript** — platshållare `Insert Custom JavaScript here.`

**Det finns ingen temaväljare.** OneUptimes statussidor har varken tema- eller varumärkesfärgsinställning: de enda inbyggda färgreglagen någonstans är **Standardfärg för stapel** och reglerna för stapelfärg på skärmen **Översiktssida**. Typsnitt, bakgrundsfärger, accentfärger och layoutjusteringar går alla genom **Anpassad CSS** här. Har du letat efter ett fält för "varumärkesfärg" är det här svaret — det finns inget, och den här rutan är nödutgången.

> Anpassad JavaScript körs i era besökares webbläsare, på en sida folk laddar just när de är oroliga för att något är trasigt. Håll den liten, hosta den själv där du kan, och testa den innan du förlitar dig på den.

## Språkinställningar

**Statussidor → din sida → Varumärke → Språk** (`{id}/languages`) har två kort, och båda handlar om språkväljaren besökarna får i sidfoten.

- **Standardspråk** — **Edit Default Language** öppnar en rullgardinsmeny som listar varje språk som stöds med både inhemskt namn och engelskt namn (`Deutsch (German)`). Kortet beskriver det som det språk förstagångsbesökare möter; besökare kan alltid byta från sidfoten. Standard är engelska.
- **Aktiverade språk** — **Edit Enabled Languages** öppnar ett flerval, platshållare `All languages`. Lämna det tomt så erbjuds varje språk som stöds. Väljer du några få listar sidfotens väljare bara dem.

Sexton språk följer med OneUptime: engelska, tyska, franska, spanska, italienska, portugisiska, nederländska, danska, norska, svenska, ryska, japanska, koreanska, kinesiska (förenklad), kinesiska (traditionell) och hindi.

## Anpassade domäner

Som standard nås en statussida på den förhandsgransknings-URL som visas på dess **Översikt**. För att lägga den på ert eget värdnamn går du till **Statussidor → din sida → Varumärke → Anpassade domäner** (`{id}/domains`).

Kortet heter **Anpassade domäner** och beskrivningen stavar ut kravet rakt av: lägg till er installations CNAME-post för statussidor som CNAME för de här domänerna för att det ska fungera. Utan något konfigurerat lyder tabellen "Inga anpassade domäner hittades." Tabellen har två kolumner, **Domän** och **Status**, och filter för **Domän**, **CNAME giltig** och **SSL provisionerat**.

### Innan du börjar

Två förutsättningar, och att hoppa över någon av dem är den vanliga orsaken till att det inte fungerar:

- **Moderdomänen måste redan vara verifierad.** Rullgardinsmenyn **Domän** listar bara verifierade domäner från projektinställningarna — fältets egen hjälptext pekar dig mot **Mer → Projektinställningar → Anpassade domäner** för att lägga till en först.
- **Installationen måste ha en CNAME-post för statussidor konfigurerad.** I självhostade driftsättningar är det miljövariabeln `STATUS_PAGE_CNAME_RECORD` i Docker Compose, eller `statusPage.cnameRecord` i Helms `values.yaml`. Utan den visar både modalen **Lägg till CNAME** och modalen **Beställ kostnadsfri SSL** meddelandet "Custom Domains not enabled for this OneUptime installation" i stället för instruktioner.

### Lägga till domänen

Klicka på **Create Status Page Domain**. Modalen (**Create New Status Page Domain**) har två steg:

**Basic**

- **Underdomän** — bara etiketten, platshållare `status (leave blank for root)`. Skriv bara `status`, inte hela värdnamnet. Lämna den tom eller skriv `@` för att använda rot-/apexdomänen.
- **Domän** — en rullgardinsmeny med verifierade domäner, platshållare `Select domain`.

**More**

- **Ladda upp anpassat certifikat** — en växel, av som standard. Låt den vara av så beställer OneUptime ett kostnadsfritt certifikat åt er. Slå på den så får ni fälten **Certifikat** och **Privat certifikatnyckel** för ert eget PEM-material.

## Verifiera CNAME-posten

Så länge domänen är overifierad visar raden åtgärden **Lägg till CNAME**. Den öppnar en modal med titeln **Lägg till CNAME** som ger dig exakt det du ska klistra in hos din DNS-leverantör:

- **Posttyp** — `CNAME`
- **Namn** — den fullständiga domän du just skapade, till exempel `status.dittforetag.se`
- **Innehåll** — er installations CNAME-post för statussidor

Modalen nämner att den automatiska verifieringen kan ta upp till 24 timmar när posten väl är på plats. Du behöver inte vänta på det: modalens skicka-knapp heter **Verifiera CNAME** och kontrollerar posten på begäran.

Skapa DNS-posten först, klicka sedan på **Verifiera CNAME**. Att klicka innan posten finns misslyckas bara.

## Beställa ett SSL-certifikat

När CNAME-posten är verifierad — och bara om du inte laddat upp ett eget certifikat — dyker åtgärden **Beställ kostnadsfri SSL** upp på raden. Dess modal, **Order Free SSL Certificate for this Status Page**, förklarar att OneUptime använder LetsEncrypt, att processen är säker och kostnadsfri, och att provisioneringen tar några timmar efter att beställningen lagts. Skicka-knappen heter **Beställ kostnadsfri SSL**.

**De angivna tiderna säger emot varandra mellan skärmarna**, så läs inte in för mycket i någon enskild siffra: beställningsmodalen säger tre timmar, kolumnen **Status** säger en timme, och ett eget certifikat säger trettio minuter. Behandla dem alla som "kom tillbaka senare i dag", och kontakta supporten om inget hänt då.

När det väl är provisionerat sker förnyelsen automatiskt. Det finns inget återkommande för dig att göra.

## Läsa domänens Status-kolumn

Kolumnen **Status** är hela uppsättningens tillståndsmaskin i en enda cell. Varje meddelande talar antingen om vad du ska göra härnäst eller att du är klar.

| Vad Status-kolumnen säger                             | Vad det betyder                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME-posten är inte verifierad än. Lägg till posten och klicka på **Verifiera CNAME**. |
| Action Required: Please order SSL certificate.        | CNAME är verifierad men inget certifikat är beställt. Klicka på **Beställ kostnadsfri SSL**. |
| No action is required, allow 30 minutes to provision. | Du laddade upp ett eget certifikat och det håller på att installeras.                |
| No action is required, this will be provisioned soon. | Det kostnadsfria certifikatet är beställt och på väg. Kontakta supporten om det aldrig landar. |
| Certificate Provisioned. No action required.          | Klart. OneUptime förnyar certifikatet automatiskt.                                   |

Sitter en rad kvar på "Action Required: Please add your CNAME record." långt efter att du skapat DNS-posten, kontrollera att postens namn är den fullständiga domänen och att dess innehåll stämmer exakt med er installations CNAME-post.

## Powered by OneUptime

Raden "Powered by OneUptime" är ingen inställning i varumärkessektionen. Den bor på **Statussidor → din sida → Avancerad → Avancerade inställningar** (`{id}/settings`), i kortet **Drivs av OneUptime-varumärke**, som en enda växel: **Dölj "Powered By OneUptime"-varumärke**. **Edit Settings** öppnar den, precis som varje annat kort på den sidan.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur delarna hänger ihop.
- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — att välja vad besökarna faktiskt ser på sidan.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — prenumeranter via e-post, SMS, Slack och webhook, plus meddelanden.
- [Offentligt API](/docs/status-pages/public-api) — att läsa statussidans data programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att dyka upp på och försvinna från sidan.
