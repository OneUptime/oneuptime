# Statussidor – Översikt

En statussida är det offentliga ansiktet för allt du övervakar: en URL dina kunder kan öppna i stället för att mejla dig och fråga om det bara är de. Den visar det aktuella läget för de tjänster du väljer att exponera, incidenterna du arbetar med, underhållet du har planerat och vilket meddelande du än vill fästa högst upp.

När något går sönder klockan två på natten är statussidan det första din supportkö länkar till. Den är också det dina prenumeranter aviseras från — så det är värt att sätta upp den innan du behöver den, inte under avbrottet.

Statussidor bor under **Statussidor** i instrumentpanelens vänstra navigering, i gruppen **Grundläggande**. Allt på den här sidan gäller per statussida: ett projekt kan köra hur många som helst — en offentlig för kunder, en privat för en intern publik, en per region för en specifik marknad.

## I korthet

- **Skapas med två fält.** En ny statussida frågar bara efter **Namn** och **Beskrivning**. Resurser, varumärke och domäner konfigureras efteråt.
- **Resurserna är vad besökarna ser.** Varje rad på sidan är en **Statussida Resurs** — en monitor (eller monitorgrupp) med eget visningsnamn, verktygstips och drifttidsalternativ. Grupper delar upp en lång sida i sektioner och kan nästlas.
- **En förhandsgransknings-URL från dag ett.** Varje statussida får en förhandsgranskningslänk så att du kan titta på den innan en anpassad domän finns.
- **Besökarvända vägar styrs av inställningar.** Incidenter, meddelanden, schemalagda händelser och prenumerationssidan visas var och en bara när deras växel på **Avancerade inställningar** är på.
- **Tre sätt att göra den privat.** Privata användare, ett huvudlösenord eller SAML SSO / OIDC — plus en IP-vitlista.
- **Prenumeranter får veta automatiskt.** E-post-, SMS-, Slack-, Microsoft Teams- och webhook-prenumeranter kan alla följa en sida, varje kanal bakom sin egen växel.

## Nyckelbegrepp

| Begrepp               | Vad det betyder                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Statussida**        | En offentlig (eller privat) sida, med eget varumärke, egna domäner, resurser och prenumeranter. Modellen `StatusPage`.                     |
| **Resurs**            | En rad besökarna ser — en monitor eller monitorgrupp som visas på sidan med ett visningsnamn och drifttidsalternativ.                     |
| **Grupp**             | En namngiven sektion som rymmer resurser. Grupper nästlas inuti andra grupper, och varje nivå rullar upp statusen för allt under den.     |
| **Meddelande**        | Ett meddelande du postar till en eller flera statussidor, med en starttid och en valfri sluttid.                                          |
| **Prenumerant**       | Någon (eller något) som följer sidan via e-post, SMS, Slack, Microsoft Teams eller en webhook.                                            |
| **Anpassad domän**    | En domän som är din — `status.example.com` — pekad mot sidan med en CNAME och ett SSL-certifikat.                                         |
| **Privat användare**  | Ett konto som kan logga in på en privat statussida. Skilt från dina OneUptime-projektanvändare.                                           |

## Skapa en statussida

1. Öppna **Statussidor → Alla statussidor** och klicka på **Skapa statussida**.
2. Fyll i **Namn** (obligatoriskt, minst två tecken) och eventuellt **Beskrivning** i modalen **Create New Status Page**.
3. Klicka på **Skapa statussida**.

Det är hela skapandeformuläret. Listan du landar tillbaka på visar **Namn**, **Beskrivning**, **Etiketter** och **Ägare**, och kan filtreras på **Statussidans ID**, **Namn** och **Beskrivning**.

Öppna den nya sidan så landar du på dess skärm **Översikt**, som bär två kort: **Status Page Preview URL** med en länk till själva sidan, och **Detaljer för statussida** där du kan redigera namnet, beskrivningen och etiketterna du just satte.

Härnäst, i ungefärlig nyttoordning:

- Lägg till resurser så att sidan har något på sig — se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups).
- Sätt sidtitel, favicon, logotyp och omslag och koppla sedan på en anpassad domän — se [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains).
- Bestäm vilka kanaler folk kan prenumerera på — se [Prenumeranter och meddelanden](/docs/status-pages/subscribers).
- Justera vad som visas på sidan under **Avancerade inställningar**.

## Var allting bor

När en statussida är öppen är dess egen vänstra sidomeny indelad i nio sektioner. Använd detta som karta för resten av den här dokumentationsgruppen.

| Sektion               | Vad som finns i den                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Grundläggande**     | **Översikt**, **Meddelanden**, **Ägare**.                                                                                                                 |
| **Resurser**          | En enda skärm **Resurser** — grupper till vänster, den valda gruppens monitorer till höger.                                                                |
| **Prenumeranter**     | **E-postprenumeranter**, **SMS-prenumeranter**, **Slack-prenumeranter**, **MS Teams-prenumeranter**, **Webhook-prenumeranter**, **Prenumerantinställningar**. |
| **Aviseringsloggar**  | **Aviseringsloggar** — vad som skickades till prenumeranter.                                                                                               |
| **Granskning**        | **Granskningsloggar**.                                                                                                                                    |
| **Varumärke**         | **Essentiellt varumärke**, **HTML, CSS och JavaScript**, **Anpassade domäner**, **Sidhuvud**, **Sidfot**, **Översiktssida**, **Språk**.                    |
| **Säkerhet**          | **Privata användare**, **SSO**, **OIDC**, **SCIM**, **Autentiseringsinställningar**.                                                                       |
| **AI**                | **MCP**.                                                                                                                                                  |
| **Avancerad**         | **Monitor Rules**, **Inbäddad status**, **Rapporter**, **Anpassade fält**, **Avancerade inställningar**, **Ta bort statussida**.                           |

Två namngivningsegenheter värda att känna till innan du börjar leta:

- Posten **Resurser** heter bara **Resurser** när projektet har monitorgrupper aktiverade. Annars står det **Monitorer**. Det är samma skärm i båda fallen.
- Det finns ingen separat gruppsida. Grupper och resurser slogs ihop, och den gamla vägen `/groups` omdirigerar nu till resursskärmen.

Utanför en enskild sida har själva sektionen **Statussidor** en sektion **Mer** med **Meddelanden**, och en ihopfälld sektion **Inställningar** som rymmer **Meddelandemallar**, **Prenumerantmallar**, **Anpassade fält**, **Ägarregler** och **Etikettregler** — dessa är projektövergripande och delas av varje statussida.

## Vad besökarna ser

Den offentliga sidan är en egen app, med en liten uppsättning vägar:

- `/` — **Översikt**.
- `/incidents` och `/incidents/:id` — incidentlistan och en enskild incident.
- `/announcements` och `/announcements/:id`.
- `/scheduled-events` och `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — flödet.
- `/login`, `/sso` och `/master-password` — bara relevanta på en privat sida.

Den övre navigeringsraden visar alltid **Översikt**; resten dyker upp bara när de är aktiverade. **Incidenter**, **Meddelanden** och **Schemalagda händelser** behöver var och en sin växel på; **Subscribe** behöver både **Visa prenumerantsida** och minst en prenumerantkanal aktiverad. En privat sida får också en post **Logga ut**.

### Översiktssidan

Översikten är den sida de flesta besökare någonsin ser. Uppifrån och ner renderar den:

1. **Alla aktiva meddelanden** — meddelanden vars starttid har passerat och vars sluttid inte har det.
2. **En övergripande statusbanner** — en enda rad som sammanfattar om alla eller bara vissa resurser är påverkade.
3. **En övergripande drifttidsprocent**, om du slagit på det. Av som standard.
4. **Resursgrupperna**, var och en med sina resurser, deras aktuella status och deras drifttidshistorikstaplar.
5. **Aktiva incidenter**.
6. **Schemalagd Underhåll Händelser**.

En helt ny sida utan något på sig visar ett tomtillstånd som säger åt dig att lägga till resurser från instrumentpanelen — vilket är din signal att bege dig till skärmen **Resurser**.

För vad som sätter en incident på den här sidan från början, och vad som tar bort den igen, se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

## Välja vad som visas på sidan

De flesta visningsreglagen bor på ett ställe: **Statussidor → din sida → Avancerad → Avancerade inställningar**. Varje kort har sin egen knapp **Edit Settings**.

**Incidentinställningar**:

- **Visa incidenter** (`showIncidentsOnStatusPage`) — på som standard. Att slå av den tar också bort navigeringsposten **Incidenter**.
- **Visa incidenthistorik (i dagar)** (`showIncidentHistoryInDays`) — hur långt tillbaka incidentlistan når. Standard är 14.
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

- **Visa upptidshistorik (i dagar)** (`showUptimeHistoryInDays`) — längden på drifttidsstapeln bredvid varje resurs. Standard är 90 och måste ligga mellan 1 och 90. Varje alternativ **Visa upptid %** och **Visa statushistorikdiagram** på en resurs eller grupp läser det här talet.

**Prenumerantinställningar**:

- **Visa prenumerantsida** (`showSubscriberPageOnStatusPage`) — på som standard, plus de fem aktiveringsväxlarna per kanal. Samma kanalväxlar dyker också upp på den dedikerade skärmen **Prenumerantinställningar** under sektionen **Prenumeranter**; behandla den som den kanoniska platsen att sätta dem på.

**Drivs av OneUptime-varumärke**:

- **Dölj "Powered By OneUptime"-varumärke** — av som standard, så besökarens sidfot lyder "Powered by OneUptime" tills du slår på den här.

**Var färgerna finns.** Drifttidsstaplarnas färger är inte här — **Standardfärg för stapel**, stapelfärgsreglerna, **Statusar för driftstoppsövervakare** och **Visa total upptidsprocent** bor alla på **Statussidor → din sida → Varumärke → Översiktssida**. Det finns ingen tema- eller varumärkesfärgsinställning någonstans; allt utöver de reglagen görs med **Anpassad CSS**.

## Förhandsgranska innan du går live

Skärmen **Översikt** på varje statussida bär ett kort **Status Page Preview URL** med en länk rakt till sidan. Använd det medan du fortfarande lägger till resurser och innan någon anpassad domän finns.

Bakom kulisserna har varje offentlig väg en förhandsgranskningstvilling under `/status-page/{statusPageId}/...` — en förhandsgranskad översikt, en förhandsgranskad incidentlista, en förhandsgranskad prenumerationssida och så vidare. Det betyder att en URL eller skärmbild tagen från instrumentpanelens förhandsgranskning inte kommer att stämma med vad en kund ser när en anpassad domän är påkopplad, så dubbelkolla varje länk du klistrar in i ett runbook eller ett mejl.

## Begränsa vem som kan se sidan

Alla statussidor är inte till för allmänheten. Alla reglagen sitter under sektionen **Säkerhet**.

### Privata användare

Slå av **Är synlig för allmänheten** på **Statussidor → din sida → Säkerhet → Autentiseringsinställningar** (kolumnen `isPublicStatusPage`). Besökare landar då på `/login` och måste logga in.

Lägg till personerna som får logga in på **Statussidor → din sida → Säkerhet → Privata användare**. Det finns en åtgärd **Lägg till i bulk** — klistra in en lista med e-postadresser så får var och en ett inbjudningsmejl. Privata användare har sitt eget flöde för glömt lösenord och lösenordsåterställning, skilt från dina OneUptime-projektkonton.

### Huvudlösenord

**Autentiseringsinställningar** har också ett kort **Huvudlösenord** med en växel **Kräv huvudlösenord** och själva lösenordet. Besökare hamnar då på `/master-password` och låser upp sidan med en enda delad hemlighet.

**Huvudlösenord och privata användare kan inte staplas.** Medan huvudlösenordet är på är autentisering med privata användare avstängd, och skärmen **Privata användare** visar en banner som säger det.

### SSO och OIDC

För en privat sida knuten till din identitetsleverantör konfigurerar **Statussidor → din sida → Säkerhet → SSO** SAML (inloggnings-URL, utfärdare, x509-certifikat, signatur- och sammandragsmetoder) och **Statussidor → din sida → Säkerhet → OIDC** konfigurerar OpenID Connect (discovery-URL, utfärdare, klient-ID och hemlighet, scopes, claim-namn). **SCIM** provisionerar privata användare från identitetsleverantören automatiskt. Dessa är låsta bakom en planfunktion, så de kanske inte finns i varje installation.

Ett kort **SSO-inställningar** exponerar **Tvinga SSO för inloggning** (`requireSsoForLogin`, av som standard). Testa din SSO-konfiguration innan du slår på den — om den inte fungerar låser du ute dig själv från statussidan.

### IP-vitlista

**Autentiseringsinställningar** bär även ett kort **IP-vitlista**, uppbackat av kolumnen `ipWhitelist`, för sidor som bara ska svara från kända nätverk.

## Den inbäddningsbara brickan och RSS-flödet

Två sätt att visa status någon annanstans än på själva sidan.

**Inbäddad statusbricka.** Slå på **Aktivera inbäddad statusbricka** (`enableEmbeddedOverallStatus`, av som standard) i kortet **Inbäddad statusbricka** på **Statussidor → din sida → Avancerad → Inbäddad status**. Den paras med en `embeddedOverallStatusToken` och serverar brickan från `/badge/:statusPageId`, så att du kan släppa in den aktuella övergripande statusen i din dokumentation, i din apps sidfot eller på en marknadsföringssida.

**RSS-flöde.** Varje statussida serverar `/rss` — ett flöde med titeln "{status page name} Updates" vars poster har prefixen `Incident: `, `Announcement: ` och `Scheduled Maintenance: `. Praktiskt för folk som hellre skickar dina uppdateringar till en läsare eller en chattbot än prenumererar via e-post.

Om du hellre hämtar datat själv backas statussidan av offentliga lässlutpunkter för översikten, incidenter, schemalagda underhållshändelser, meddelanden och episoder — se [Offentligt API](/docs/status-pages/public-api).

## Läs vidare

- [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) — sätta monitorer på sidan och organisera dem i sektioner.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — logotyp, favicon, sidfot, anpassad kod och att peka din egen domän mot sidan.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — de fem prenumerantkanalerna, dubbel opt-in och att posta meddelanden.
- [Offentligt API](/docs/status-pages/public-api) — läsa statussidedata programmatiskt.
- [Incidenter – Översikt](/docs/incidents/index) — händelserna som dyker upp på sidan.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att visas på en statussida och vad som tar bort den.
