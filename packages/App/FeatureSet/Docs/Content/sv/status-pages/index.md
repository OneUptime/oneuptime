# Statussidor – Översikt

En statussida är den publika ytan för allt ni övervakar: en enda URL era kunder kan öppna i stället för att mejla er och fråga om det bara är de som drabbats. Den visar aktuellt läge för de tjänster ni väljer att exponera, de incidenter ni arbetar med, det underhåll ni har planerat, och vilket meddelande ni än vill fästa högst upp.

När något går sönder klockan två på natten är statussidan det första er supportkö länkar till. Det är också därifrån era prenumeranter blir aviserade — så den är värd att sätta upp innan ni behöver den, inte mitt under avbrottet.

Statussidor ligger under **Statussidor** i instrumentpanelens vänsternavigering, i gruppen **essentials**. Allt på den här sidan gäller per statussida: ett projekt kan driva hur många som helst — en publik för kunder, en privat för en intern målgrupp, en per region för en viss marknad.

## I korthet

- **Skapas med två fält.** En ny statussida frågar bara efter **Namn** och **Beskrivning**. Resurser, varumärke och domäner konfigureras efteråt.
- **Resurserna är det besökarna ser.** Varje rad på sidan är en **Statussida Resurs** — en monitor (eller monitorgrupp) med eget visningsnamn, verktygstips och drifttidsalternativ. Grupper delar upp en lång sida i sektioner och kan ligga i varandra.
- **En förhandsgransknings-URL från dag ett.** Varje statussida får en förhandsgranskningslänk så att du kan titta på den innan någon egen domän finns.
- **Besökarnas rutter styrs av inställningar.** Incidenter, meddelanden, schemalagda händelser och prenumerationssidan dyker upp först när respektive växel i **Avancerade inställningar** är på.
- **Tre sätt att göra den privat.** Privata användare, ett huvudlösenord eller SAML SSO / OIDC — plus en IP-vitlista.
- **Prenumeranter får veta automatiskt.** Prenumeranter via e-post, SMS, Slack, Microsoft Teams och webhook kan alla följa en sida, varje kanal bakom sin egen växel.

## Nyckelbegrepp

| Begrepp               | Vad det betyder                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Statussida**        | En publik (eller privat) sida med eget varumärke, egna domäner, resurser och prenumeranter. Modellen `StatusPage`.                  |
| **Resurs**            | En rad besökarna ser — en monitor eller monitorgrupp som lyfts fram på sidan med ett visningsnamn och drifttidsalternativ.          |
| **Grupp**             | En namngiven sektion som rymmer resurser. Grupper ligger i andra grupper, och varje nivå summerar statusen för allt under sig.      |
| **Meddelande**        | Ett budskap du publicerar på en eller flera statussidor, med en starttid och en valfri sluttid.                                     |
| **Prenumerant**       | Någon (eller något) som följer sidan via e-post, SMS, Slack, Microsoft Teams eller en webhook.                                      |
| **Anpassad domän**    | En domän som är er — `status.example.com` — pekad mot sidan med en CNAME och ett SSL-certifikat.                                    |
| **Privat användare**  | Ett konto som kan logga in på en privat statussida. Skilt från era OneUptime-projektanvändare.                                      |

## Skapa en statussida

1. Öppna **Statussidor → Alla statussidor** och klicka på **Skapa statussida**.
2. Fyll i **Namn** (obligatoriskt, minst två tecken) och eventuellt **Beskrivning** i modalen **Create New Status Page**.
3. Klicka på **Skapa statussida**.

Det är hela formuläret. Listan du landar tillbaka i visar **Namn**, **Beskrivning**, **Etiketter** och **Ägare**, och kan filtreras på **Statussidans ID**, **Namn** och **Beskrivning**.

Öppna den nya sidan så hamnar du på dess **Översikt**, som bär två kort: **Status Page Preview URL** med en länk till sidan i sig, och **Detaljer för statussida** där du kan ändra namnet, beskrivningen och etiketterna du precis satte.

Därefter, ungefär i nyttoordning:

- Lägg till resurser så att sidan har något på sig — se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups).
- Sätt sidtitel, favicon, logotyp och omslag, och koppla sedan på en egen domän — se [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains).
- Bestäm vilka kanaler folk kan prenumerera på — se [Prenumeranter och meddelanden](/docs/status-pages/subscribers).
- Finjustera vad som syns på sidan under **Avancerade inställningar**.

## Var allt finns

När en statussida väl är öppen är dess egen vänstermeny indelad i nio sektioner. Använd det här som karta över resten av den här dokumentationsgruppen.

| Sektion               | Vad som finns i den                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Grundläggande**     | **Översikt**, **Meddelanden**, **Ägare**.                                                                                                      |
| **Resurser**          | En enda skärm **Resurser** — grupper till vänster, den valda gruppens monitorer till höger.                                                    |
| **Prenumeranter**     | **E-postprenumeranter**, **SMS-prenumeranter**, **Slack-prenumeranter**, **MS Teams-prenumeranter**, **Webhook-prenumeranter**, **Prenumerantinställningar**. |
| **Aviseringsloggar**  | **Aviseringsloggar** — vad som skickats till prenumeranter.                                                                                    |
| **Granskning**        | **Granskningsloggar**.                                                                                                                         |
| **Varumärke**         | **Essentiellt varumärke**, **HTML, CSS och JavaScript**, **Anpassade domäner**, **Sidhuvud**, **Sidfot**, **Översiktssida**, **Språk**.        |
| **Säkerhet**          | **Privata användare**, **SSO**, **OIDC**, **SCIM**, **Autentiseringsinställningar**.                                                           |
| **AI**                | **MCP**.                                                                                                                                       |
| **Avancerad**         | **Monitor Rules**, **Inbäddad status**, **Rapporter**, **Anpassade fält**, **Avancerade inställningar**, **Ta bort statussida**.               |

Två egenheter i namngivningen är värda att känna till innan du börjar leta:

- Posten **Resurser** heter **Resurser** bara när projektet har monitorgrupper aktiverade. Annars står det **Monitorer**. Det är samma skärm i båda fallen.
- Det finns ingen separat sida för grupper. Grupper och resurser slogs ihop, och den gamla rutten `/groups` skickar numera vidare till resursskärmen.

Utanför en enskild sida har själva sektionen **Statussidor** en **Mer**-sektion med **Meddelanden**, och en ihopfälld **Inställningar**-sektion med **Meddelandemallar**, **Prenumerantmallar**, **Anpassade fält**, **Ägarregler** och **Etikettregler** — dessa gäller hela projektet och delas av varje statussida.

## Vad besökare ser

Den publika sidan är en egen app med en liten uppsättning rutter:

- `/` — **Översikt**.
- `/incidents` och `/incidents/:id` — incidentlistan och en enskild incident.
- `/announcements` och `/announcements/:id`.
- `/scheduled-events` och `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — flödet.
- `/login`, `/sso` och `/master-password` — bara relevanta på en privat sida.

Navigeringsraden högst upp visar alltid **Översikt**; resten dyker upp först när de är påslagna. **Incidenter**, **Meddelanden** och **Planerade händelser** kräver var sin växel; **Prenumerera** kräver både **Visa prenumerantsida** och minst en aktiverad prenumerationskanal. En privat sida får dessutom en post **Logga ut**.

### Översiktssidan

Översikten är den sida de flesta besökare någonsin ser. Uppifrån och ned renderar den:

1. **Alla pågående meddelanden** — meddelanden vars starttid har passerat och vars sluttid inte har det.
2. **En banner med övergripande status** — en enda rad som sammanfattar om alla eller bara vissa resurser är påverkade.
3. **En övergripande drifttidsprocent**, om du slagit på den. Av som standard.
4. **Resursgrupperna**, var och en med sina resurser, deras aktuella status och deras staplar med drifttidshistorik.
5. **Aktiva incidenter**.
6. **Planerade underhållshändelser**.

En helt ny sida utan något på sig visar ett tomt tillstånd som uppmanar dig att lägga till resurser från instrumentpanelen — vilket är din signal att gå till skärmen **Resurser**.

För vad som sätter en incident på den här sidan från början, och vad som tar bort den igen, se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

## Välja vad som visas på sidan

De flesta visningsreglagen finns på ett och samma ställe: **Statussidor → din sida → Avancerad → Avancerade inställningar**. Varje kort har en egen knapp **Edit Settings**.

**Incidentinställningar**:

- **Visa incidenter** (`showIncidentsOnStatusPage`) — på som standard. Slår du av den försvinner också navigeringsposten **Incidenter**.
- **Visa incidenthistorik (i dagar)** (`showIncidentHistoryInDays`) — hur långt bakåt incidentlistan sträcker sig. Standard är 14.
- **Visa incidentetiketter** (`showIncidentLabelsOnStatusPage`) — av som standard.

**Episodinställningar** — samma tre reglage för incidentepisoder: **Visa episoder** (`showEpisodesOnStatusPage`, på som standard), **Visa episodhistorik (i dagar)** (standard 14) och **Visa episodetiketter** (av som standard). Episoder är en egen modell med egna slutpunkter, inte en vy över incidenter.

**Meddelandeinställningar**:

- **Visa meddelanden** (`showAnnouncementsOnStatusPage`) — på som standard.
- **Visa meddelandehistorik (i dagar)** (`showAnnouncementHistoryInDays`) — standard är 14.

**Inställningar för schemalagd händelse**:

- **Visa schemalagda underhållshändelser** (`showScheduledMaintenanceEventsOnStatusPage`) — på som standard.
- **Visa historik för schemalagda händelser (i dagar)** (`showScheduledEventHistoryInDays`) — standard är 14.
- **Visa händelseetiketter** (`showScheduledEventLabelsOnStatusPage`) — av som standard.

**Inställningar för drifttidshistorik**:

- **Visa upptidshistorik (i dagar)** (`showUptimeHistoryInDays`) — längden på drifttidsstapeln bredvid varje resurs. Standard är 90 och värdet måste ligga mellan 1 och 90. Varje **Visa upptid %** och **Visa statushistorikdiagram** på en resurs eller grupp läser den här siffran.

**Prenumerantinställningar**:

- **Visa prenumerantsida** (`showSubscriberPageOnStatusPage`) — på som standard, plus de fem växlarna för respektive kanal. Samma kanalväxlar finns också på den dedikerade skärmen **Prenumerantinställningar** under sektionen **Prenumeranter**; behandla den som den kanoniska platsen att sätta dem på.

**Drivs av OneUptime-varumärke**:

- **Dölj "Powered By OneUptime"-varumärke** — av som standard, så besökarnas sidfot visar "Powered by OneUptime" tills du slår på den.

**Var färgerna finns.** Färgerna på drifttidsstaplarna sitter inte här — **Standardfärg för stapel**, reglerna för stapelfärg, **Statusar för driftstoppsövervakare** och **Visa total upptidsprocent** bor allihop på **Statussidor → din sida → Varumärke → Översiktssida**. Det finns ingen inställning för tema eller varumärkesfärg någonstans; allt bortom de reglagen görs med **Anpassad CSS**.

## Förhandsgranska innan du går live

Skärmen **Översikt** på varje statussida bär kortet **Status Page Preview URL** med en länk rakt till sidan. Använd den medan du fortfarande lägger till resurser och innan någon egen domän finns.

Bakom kulisserna har varje publik rutt en förhandsgranskningstvilling under `/status-page/{statusPageId}/...` — en förhandsgranskad översikt, en förhandsgranskad incidentlista, en förhandsgranskad prenumerationssida och så vidare. Det betyder att en URL eller en skärmbild tagen från förhandsgranskningen i instrumentpanelen inte kommer att stämma med vad kunden ser när en egen domän väl är kopplad, så dubbelkolla varje länk du klistrar in i ett runbook eller ett mejl.

## Begränsa vem som kan se sidan

Alla statussidor är inte till för allmänheten. Reglagen sitter under sektionen **Säkerhet**.

### Privata användare

Slå av **Är synlig för allmänheten** på **Statussidor → din sida → Säkerhet → Autentiseringsinställningar** (kolumnen `isPublicStatusPage`). Besökarna hamnar då på `/login` och måste logga in.

Lägg till dem som får logga in på **Statussidor → din sida → Säkerhet → Privata användare**. Det finns en åtgärd **Lägg till i bulk** — klistra in en lista med e-postadresser så får var och en ett inbjudningsmejl. Privata användare har egna flöden för glömt och återställt lösenord, skilda från era OneUptime-projektkonton.

### Huvudlösenord

**Autentiseringsinställningar** har också ett kort **Huvudlösenord** med växeln **Kräv huvudlösenord** och själva lösenordet. Besökarna landar då på `/master-password` och låser upp sidan med en enda delad hemlighet.

**Huvudlösenord och privata användare går inte att kombinera.** Så länge huvudlösenordet är på är autentisering med privata användare avstängd, och skärmen **Privata användare** visar en banner som talar om det.

### SSO och OIDC

För en privat sida knuten till er identitetsleverantör konfigurerar **Statussidor → din sida → Säkerhet → SSO** SAML (inloggnings-URL, utfärdare, x509-certifikat, signatur- och sammandragsmetoder) och **Statussidor → din sida → Säkerhet → OIDC** konfigurerar OpenID Connect (upptäckts-URL, utfärdare, klient-ID och hemlighet, scopes, claim-namn). **SCIM** provisionerar privata användare från identitetsleverantören automatiskt. De här ligger bakom en planfunktion, så de finns kanske inte i varje installation.

Ett kort **SSO-inställningar** exponerar **Tvinga SSO för inloggning** (`requireSsoForLogin`, av som standard). Testa er SSO-konfiguration innan ni slår på den — fungerar den inte låser ni ut er själva från statussidan.

### IP-vitlista

**Autentiseringsinställningar** bär även ett kort **IP-vitlista**, uppbackat av kolumnen `ipWhitelist`, för sidor som bara ska svara från kända nätverk.

## Den inbäddbara brickan och RSS-flödet

Två sätt att visa status någon annanstans än på sidan själv.

**Inbäddad statusbricka.** Slå på **Aktivera inbäddad statusbricka** (`enableEmbeddedOverallStatus`, av som standard) i kortet **Inbäddad statusbricka** på **Statussidor → din sida → Avancerad → Inbäddad status**. Den paras ihop med ett `embeddedOverallStatusToken` och serveras från `/badge/:statusPageId`, så du kan lägga in den aktuella övergripande statusen i er dokumentation, i sidfoten på er app eller på en marknadsföringssida.

**RSS-flöde.** Varje statussida serverar `/rss` — ett flöde med titeln "{status page name} Updates" vars poster har prefixen `Incident: `, `Announcement: ` och `Scheduled Maintenance: `. Praktiskt för dem som hellre matar in era uppdateringar i en läsare eller en chattbot än prenumererar via e-post.

Vill du hellre hämta datan själv finns statussidan uppbackad av publika läsändpunkter för översikten, incidenter, schemalagda underhållshändelser, meddelanden och episoder — se [Offentligt API](/docs/status-pages/public-api).

## Läs vidare

- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — att sätta monitorer på sidan och organisera dem i sektioner.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — logotyp, favicon, sidfot, egen kod och att peka er egen domän mot sidan.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — de fem prenumerationskanalerna, dubbel opt-in och att publicera meddelanden.
- [Offentligt API](/docs/status-pages/public-api) — att läsa statussidans data programmatiskt.
- [Incidenter – Översikt](/docs/incidents/index) — händelserna som dyker upp på sidan.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att synas på en statussida och vad som tar bort den.
