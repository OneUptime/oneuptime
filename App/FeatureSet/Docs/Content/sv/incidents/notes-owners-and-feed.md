# Anteckningar, ägare och flöde

Varje incident samlar på sig en skriftlig historik medan ni arbetar med den. En del av den historiken är till för era kunder — uppdateringen som går ut på statussidan 02:14 och säger att ni hittat den trasiga deployen. Resten är till för ert team — stacktracen någon klistrade in, grafen som till slut gav mening, beslutet att failovra.

OneUptime håller isär de två publikerna. **Offentliga anteckningar** publiceras på din statussida och kan avisera prenumeranter. **Privata anteckningar** (modellen `IncidentInternalNote`) stannar inne i instrumentpanelen. Under båda ligger **Incident Flöde**, en tidslinje som bara växer och registrerar allt som hänt med incidenten, och listan **Ägare**, som avgör vem som får veta.

Allt hänger på incidentens vänstra sidomeny: **Anteckningar → Offentliga anteckningar**, **Anteckningar → Privata anteckningar** och **Team → Ägare**. Flödet bor på incidentens sida **Översikt**.

## Offentliga anteckningar kontra privata anteckningar

De två anteckningstyperna ser likadana ut i instrumentpanelen och beter sig mycket olika.

- **Offentliga anteckningar** — modellen `IncidentPublicNote`, som serveras till statussidor som del av incidentens tidslinje. De bär ett datum **Publicerad** som du kan sätta själv och en kryssruta **Meddela statussideprenumeranter**.
- **Privata anteckningar** — modellen `IncidentInternalNote`. Inget i statussideappen läser dem. De har inget publicerat-datum (listan stämplas och sorteras på `createdAt`) och inga prenumerantfält alls, så en privat anteckning kan aldrig utlösa en prenumerantavisering.

**Vad "privat" faktiskt betyder.** Det betyder "inte publicerad på statussidan" — inte "begränsad till en mindre grupp människor". Båda anteckningstyperna delar samma läsbehörigheter, så var och en som kan läsa incidenten kan läsa dess privata anteckningar. Om du behöver begränsa vem som alls kan se en incident, använd flaggan **Privat incident** (`isPrivate`) på själva incidenten, som döljer incidenten från varje statussida och begränsar den till incidentens ägaranvändare, medlemmarna i dess ägarteam samt projektadministratörer och projektägare.

**Ägare ser båda.** Jobbet som aviserar ägare hämtar offentliga och privata anteckningar tillsammans. En privat anteckning är privat från dina prenumeranter, inte från de som arbetar med incidenten.

| Om du vill…                                                       | Välj                     |
| ----------------------------------------------------------------- | ------------------------ |
| Berätta för kunder vad ni vet och när ni vet mer                  | **Offentlig anteckning** |
| Backdatera en uppdatering du redan skickat någon annanstans       | **Offentlig anteckning** |
| Registrera en hypotes, ett kommando du körde eller en återvändsgränd | **Privat anteckning**  |
| Bifoga en heapdump eller en skärmbild av en intern instrumentpanel | **Privat anteckning**   |

## Posta en offentlig anteckning

Öppna **Anteckningar → Offentliga anteckningar** i incidentens sidomeny och skapa en anteckning. Kortet förklarar att det du skriver här dyker upp på statussidan; tomtillståndet säger att inga offentliga anteckningar har skapats för den här incidenten hittills.

| Fält                                 | Syfte                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Offentlig incidentanteckning**     | Brödtexten, i Markdown. Obligatorisk. Formuläret påminner dig om att anteckningen syns på din statussida och länkar ett fusklakan. |
| **Bilagor**                          | Filer som delas med prenumeranter på statussidan. Valfritt.                                                               |
| **Meddela statussideprenumeranter**  | Kryssruta, påslagen som standard. Slå av den för att publicera tyst.                                                      |
| **Publicerad**                       | Obligatoriskt datum och klockslag, förifyllt med nu, visat i din aktuella tidszon.                                        |

**Publicerad är anteckningens verkliga tidsstämpel.** Statussidor sorterar och visar offentliga anteckningar efter `postedAt`, inte efter när du skrev dem — så om du ikappar statussidan med en uppdatering du skickade för 40 minuter sedan, sätt **Publicerad** till när det faktiskt hände. Om en anteckning kommer in via API:et utan en sådan stämplar OneUptime aktuell tid.

Listan visar vem som skrev varje anteckning, dess **Publicerad**, den renderade Markdown-texten med sina bilagor och en kolumn **Prenumerantaviseringsstatus**. Du kan filtrera på **Skapad av**, **Anteckning** och **Skapad den**.

## Posta en privat anteckning

**Anteckningar → Privata anteckningar** är medvetet enklare. Det finns bara två fält:

- **Privat incidentanteckning** — Markdown-brödtext, obligatorisk. Formuläret säger rakt ut att den här är privat för ditt team och inte syns på statussidan.
- **Bilagor** — filer avsedda för incidentarbetsteamet.

Ingen **Publicerad**, ingen prenumerantkryssruta — anteckningen stämplas när den skapas.

## Bilagor på anteckningar

Båda anteckningstyperna tar emot filbilagor via ett fält **Bilagor**, och båda renderar en bilagelista under anteckningens brödtext med en länk **Download attachment** per fil.

Där de skiljer sig är vem som kan hämta filen:

- **Bilagor på offentliga anteckningar** kan laddas ner av statussidans besökare via en statussideväg, tillsammans med själva anteckningen.
- **Bilagor på privata anteckningar** är bara nåbara via det autentiserade instrumentpanels-API:et. Det finns ingen statussideväg för dem.

Det gör bilagor till samma offentligt/privat-beslut som anteckningstexten. En kundvänd tidslinjebild hör hemma på en offentlig anteckning; en konfigurationsdump på en privat.

## Generera en anteckning med AI

Båda anteckningssidorna bär en knapp **Generate with AI**. Den skickar incidenten till projektets AI-leverantör och släpper den genererade Markdown-texten i anteckningsredigeraren, där du redigerar den innan du sparar — inget publiceras automatiskt.

- **Generate Public Note with AI** — beskrivs som att analysera incidentdatat för att producera en kundvänd anteckning. Mallar inkluderar **Status Update** och **Resolution Notice**.
- **Generate Private Note with AI** — producerar i stället en intern teknisk anteckning. Mallar inkluderar **Investigation Update** och **Technical Analysis**.

Bakom knappen postar instrumentpanelen till `/incident/generate-note-from-ai/{incidentId}` med den valda mallen och en anteckningstyp `public` eller `internal`.

## Anteckningsmallar

Om ditt team skriver samma tre uppdateringar vid varje avbrott, spara dem en gång. Båda anteckningssidorna har en knapp **Skapa från mall** som öppnar väljaren **Skapa anteckning från mall** med en rullgardinsmeny **Välj anteckningsmall**.

Mallar delas mellan offentliga och privata anteckningar: en enda mallista betjänar båda, och samma mall kan infogas i vilken av de två anteckningstyperna som helst.

Du hanterar dem under **Incidenter → Inställningar → Anteckningsmallar** — kortet har rubriken **Mallar för offentliga eller privata anteckningar för incidenter** och dess formulär har ett steg **Mallinformation** (**Mallnamn** och **Mallbeskrivning**, båda obligatoriska) och ett steg **Anteckningsdetaljer** för brödtexten. Om du klickar på **Skapa från mall** innan du skapat några säger OneUptime att inga finns ännu; notera att meddelandet pekar mot Projektinställningar, men sidan bor faktiskt under **Incidenter → Inställningar → Anteckningsmallar**.

## Posta anteckningar från Slack eller Microsoft Teams

Om du har kopplat en arbetsyta behöver de som arbetar aldrig lämna kanalen. Både Slack och Microsoft Teams exponerar en åtgärd för att lägga till anteckning som öppnar en modal med en rullgardinsmeny som erbjuder **Offentlig anteckning** eller **Privat anteckning** plus en textruta, och skriver resultatet direkt på incidenten.

Två detaljer värda att känna till:

- **Dubblettskydd** — varje anteckning registrerar Slack-meddelandet den kom från (`postedFromSlackMessageId`, formaterat `channel_id:message_ts`), så att flera personer som reagerar på samma meddelande ger en anteckning, inte fem.
- **Anteckningar ekar tillbaka** — att posta någon av anteckningstyperna skickar också ett meddelande in i den kopplade incidentkanalen, eftersom anteckningens flödespost skapas med arbetsyteavisering påslagen.

## När en offentlig anteckning faktiskt når prenumeranterna

Att skapa en offentlig anteckning med **Meddela statussideprenumeranter** påslagen garanterar inte i sig att ett e-postmeddelande går ut. Anteckningen måste klara en kedja av kontroller, och varje misslyckande registrerar en specifik orsak i stället för att ge ett fel:

1. **Meddela statussideprenumeranter** måste vara på. Om den inte är det stämplas anteckningen som överhoppad i samma stund den skapas.
2. Anteckningen måste tillhöra en incident som fortfarande finns.
3. Incidenten måste ha minst en monitor kopplad — utan monitorer finns det ingen statussideresurs att dirigera anteckningen till.
4. Incidentens flagga **Synlig på statussidan** (`isVisibleOnStatusPage`) måste vara sann.
5. Varje statussida incidenten når måste ha **Visa incidenter** (`showIncidentsOnStatusPage`) påslagen.
6. Varje prenumerant måste klara sina egna inställningar — inte avprenumererad, och prenumererande på den här resursen och på händelsetypen `Incident` där sidan låter prenumeranter välja.

**Aviseringar är inte omedelbara.** Jobbet som skickar dem körs en gång i minuten, så räkna med upp till ungefär en minut mellan att du sparar anteckningen och att posten lämnar. Det är vad etiketten **Sending Soon** betyder.

Kolumnen **Prenumerantaviseringsstatus** följer hela resan:

| Status                       | Vad det betyder                                          |
| ---------------------------- | -------------------------------------------------------- |
| **Notifications skipped.**   | En av grindarna ovan stängdes. Orsaken registreras.      |
| **Sending Soon**             | Köad, väntar på nästa körning av utskicksjobbet.         |
| **Notifications Being Sent** | Jobbet arbetar sig igenom prenumerantlistan.             |
| **Aviseringar skickade**     | Alla prenumerantaviseringar gick ut.                     |
| **Misslyckades**             | Jobbet kastade ett fel; felet lagras med anteckningen.   |

Klicka på **mer information** på statusen för att öppna **Detaljer om aviseringsstatus**. Där ett omskick är meningsfullt är den modalens knapp **Retry**, som lägger tillbaka anteckningen i väntande läge så att nästa körning plockar upp den igen.

Själva meddelandet prenumeranterna får mallas per statussida och per kanal — e-post, SMS, Slack och Microsoft Teams har var sin mall för händelsen **Subscriber Incident Note Created**, med variabler för statussidans namn och URL, detaljlänken, de berörda resurserna, incidentens allvarlighetsgrad och titel, anteckningens brödtext och en avprenumerationslänk per prenumerant. Se [Prenumeranter och meddelanden](/docs/status-pages/subscribers) för hur de mallarna och kanalerna konfigureras.

## Incidentflödet

Kortet **Incident Flöde** ligger längst ner i vänsterkolumnen på incidentens sida **Översikt**. Det är incidentens historia i ordning: varje post är en ikon, avataren och namnet på den som orsakade den, en relativ tidsstämpel med exakt lokal tid vid hovring, och en Markdown-brödtext. Posterna sorteras med äldst först.

Vissa poster bär extra detaljer — en ägaravisering listar till exempel alla som mejlades. De visar en knapp **More Information** som öppnar en panel **More Information**.

Kortets rubrikrad har också en meny **Åtgärder** så att du kan agera utan att lämna tidslinjen:

- **Execute Runbook** — starta ett [runbook](/docs/runbooks/index) mot den här incidenten.
- **Kör jourpolicy** — larma en policy på begäran.
- **Add Public Note** — samma fyra fält som sidan Offentliga anteckningar, i en modal.
- **Lägg till privat anteckning** — bara anteckningstext och bilagor.

Bredvid den hämtar **Uppdatera** om flödet.

**Flödet växer bara, och det är inte din granskningslogg.** API:et tillåter att skapa och läsa flödesposter men inte att uppdatera eller radera dem, så ingen kan tyst skriva om en incidents historia. Det är inte permanent heller: på debiterade installationer tas flödesrader äldre än tre år bort. För ett varaktigt register över vem som ändrade vad, använd **Granskning → Granskningsloggar** i incidentens sidomeny.

## Vad flödet registrerar

Flödesposter skrivs av incidenttjänsten själv, av båda anteckningstjänsterna, av tillståndstidslinjen, av ägar- och medlemsändringar, av regelmotorerna, av jourexekvering, av AI-utredningen och efteranalyskörarna, samt av cron-jobben för aviseringar. Händelsetyperna omfattar:

- **Själva incidenten** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Anteckningar och sammanställningar** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Människor** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Aviseringar** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automation** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Varje typ får sin egen ikon, så du kan skanna ett långt flöde och plocka ut tillståndsändringarna ur bruset. AI-genererad rotorsaksanalys markeras tydligt och renderas i ett begränsat Markdown-läge.

Flöden respekterar incidentsekretess: för privata incidenter filtreras flödesläsningar på samma sätt som incidenten.

## Ägare

Ägare är de personer och team som ansvarar för en incident. De är aviseringsmålet för allt som händer med den — och de är anledningen till att en incident inte förblir obemärkt medan alla utgår från att någon annan tagit den.

Öppna **Team → Ägare** i incidentens sidomeny. Kortet **Ägare** visar ett räknarmärke och beskriver ägare som de personer och team som ansvarar för den här incidenten och som aviseras om ändringar, med en löpande räkning i stil med "2 personer · 1 team". Ägare renderas som överlappande avatarer; att hovra över en visar personens e-postadress eller markerar posten som ett **Team**.

- Klicka på **Lägg till ägare** för att öppna en väljare med en sökruta för personer eller team.
- Klicka på borttagningskontrollen på en avatar för att öppna bekräftelsen **Ta bort ägare**, och sedan **Ta bort**.
- Utan ägare ännu säger kortet det och bjuder in dig att lägga till en kollega eller ett team så att de aviseras om ändringar.

Ägaranvändare och ägarteam är separata poster — att lägga till ett team gör varje medlem i det teamet till ägare i aviseringssyfte utan att lista dem individuellt.

## Hur ägare tilldelas

Det finns fyra vägar in på ägarlistan:

- **Från en incidentmall** — mallar bär fälten **Ägare – Team** och **Ägare – Användare**, beskrivna som de team och användare som äger incidenten och som aviseras när den skapas eller uppdateras. Att skapa en incident från mallen förifyller dem. Se [Deklarera en incident](/docs/incidents/declaring-incidents).
- **Från ägarregler för incidenter** — matchande regler lägger till ägare automatiskt vid skapandet.
- **Vid skapandet via API:et** — ägaranvändare och ägarteam som skickas med skapandeanropet läggs till omedelbart, med en flagga som styr om de får e-postmeddelandet "du blev tillagd".
- **För hand** — kontrollen **Lägg till ägare** på sidan **Ägare**, när som helst under incidenten.

Att lägga till samma person två gånger är ofarligt; ägare som redan är tilldelade dubbleras inte.

## Ägarregler för incidenter

**Ägarregler för incidenter** tilldelar automatiskt ägaranvändare och ägarteam när matchande incidenter skapas — dirigeringslagret som gör att en databasincident hamnar hos databasteamet utan att någon tänker på det. Du hittar dem tillsammans med resten av incidentautomationen som täcks i [Incidentinställningar och automatisering](/docs/incidents/settings).

Regelformuläret har tre steg — **Grundläggande information**, **Matchningskriterier** och **Ägare** — och ägarsteget rymmer två sektioner:

- **Ägare att tilldela** — välj **Ägarteam** och **Ägaranvändare**. När regeln matchar läggs varje vald användare och varje valt team till som ägare, och redan tilldelade ägare dubbleras inte.
- **Ärv ägare** — tilldela ägare från relaterade entiteter i stället för att namnge dem. **Ärv ägare från övervakare** gör varje ägare av incidentens monitorer till ägare av incidenten, och **Ärv ägare från värdar**, **… från Kubernetes-kluster**, **… från Docker-värdar**, **… från Podman-värdar** och **… från tjänster** gör detsamma för de resurserna.

En växel **Avisera ägare** styr om folk får veta det. Låt den vara på för verklig dirigering; slå av den för att lägga till ägare tyst — praktiskt när en regel är en bokföringsbekvämlighet snarare än en larmning.

Varje regelkörning skrivs till incidentflödet, så du kan alltid se om en person lades till av en regel eller av en människa.

## Vad ägare aviseras om

Fem jobb aviserar ägare, vart och ett körs en gång i minuten:

- **Incident skapad** — ämne `[New Incident {number}] - {title}`.
- **En anteckning postades** — för både offentliga *och* privata anteckningar, ämne `[Update Incident {number}] - {title}`.
- **Incidentens tillstånd ändrades** — se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).
- **Du lades till som ägare** — ämne `You have been added as the owner of Incident {number} - {title}`.
- **Fortfarande olöst** — en påminnelse som drivs av incidentens nästa påminnelsetid, ämne `[Reminder] Incident {number} is still {state} - {title}`.

Varje avisering byggs för e-post, SMS, röstsamtal, push och WhatsApp och lämnas till användarens aviseringsinställningar, som avgör vad som faktiskt skickas. Varje mottagare kan stänga av var och en av dessa individuellt — inställningarna per användare är formulerade som att skicka dig aviseringar om incident skapad, anteckning postad, tillstånd ändrat, ägare tillagd, medlem tilldelad och påminnelse om fortfarande öppen. Någon som bara vill ha ett samtal vid tillståndsändringar kan få exakt det.

**Incidenter utan ägare är inte tysta.** Om en incident inte har några ägare alls går aviseringsjobben tillbaka till projektets ägare, så inget tappas på golvet. Varje aviserad person läggs också till i motsvarande flödespost, så du kan efteråt se exakt vem som fick veta och på vilken adress.

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — vad en incident är och hur delarna hänger ihop.
- [Deklarera en incident](/docs/incidents/declaring-incidents) — skapa incidenter för hand, från mallar och från monitorer.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — tillståndsmaskinen som driver halva flödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — ägarregler, anteckningsmallar och resten av automationen.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — var offentliga anteckningar hamnar och vem som tar emot dem.
- [Statussidor – Översikt](/docs/status-pages/index) — den kundvända sidan av en incident.
