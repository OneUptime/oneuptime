# Konfiguration & säkerhet

Den här sidan täcker de inställningar och säkerhetsgränser som är värda att känna till innan du riktar ett arbetsflöde mot riktig trafik.

## Slå på eller av ett arbetsflöde

Varje arbetsflöde har en **Enabled**-växel i **Settings**. När den är av körs inte arbetsflödet — webhook-anrop, schemalagda tider och OneUptime-händelser ignoreras alla. Nya arbetsflöden börjar inaktiverade.

Använd den här växeln som din "redo att köra"-grind:

1. Bygg arbetsflödet.
2. Klicka på **Run Manually** med en realistisk payload.
3. Kontrollera **Logs** — försäkra dig om att varje block gick dit du förväntade dig.
4. Slå på **Enabled**.

Att stänga av ett arbetsflöde stoppar inte körningar som redan pågår; det stoppar bara nya från att starta.

## Ägare och etiketter

- **Owners** — användare och team som listas som ägare får åtkomst till arbetsflödet och kan välja att få notiser när det misslyckas. Ställ in dem under **Settings → Owners**.
- **Labels** — taggar för att gruppera arbetsflöden. Arbetsflödeslistan låter dig filtrera på etikett, vilket gör ett upptaget projekt mycket enklare att navigera. Användbart när du har arbetsflöden organiserade efter team, integration eller miljö.
- **Label rules** — under **Workflows → Settings → Label Rules** kan du automatiskt tillämpa etiketter på nya arbetsflöden baserat på namn- eller beskrivningsmönster.
- **Owner rules** — under **Workflows → Settings → Owner Rules** kan du automatiskt tilldela ägare till nya arbetsflöden.

## Hemligheter

Markera en global variabel som en **secret** om den innehåller något känsligt. Värdet krypteras, döljs i gränssnittet efter att du sparat och döljs i körningsloggar (visas som `[REDACTED]`).

Använd hemliga variabler för:

- API-nycklar för externa tjänster.
- Autentiseringstokens.
- Signeringsnycklar för webhooks.
- Allt du inte skulle vilja att någon med läsåtkomst skulle se.

Klistra inte in en hemlighet direkt i ett block — värden som `Authorization: Bearer eyJh...` blir synliga i arbetsflödet och loggarna. Använd `{{variable.MY_SECRET}}` istället.

## Hur länge en körning kan ta

Varje körning har en maximal längd. Om en körning inte har avslutats i tid markeras den som **Timeout** och pågående block avbryts. Standardvärdet är generöst — tillräckligt långt för normala HTTP-anrop och kedjor av block.

Enskilda block har sina egna tidsgränser inuti det — till exempel ger ett API-block upp på en hängande utgående förfrågan långt innan hela körningen gör det.

## Gräns för att anropa andra arbetsflöden

Komponenten **Execute Workflow** låter ett arbetsflöde anropa ett annat. För att förhindra oavsiktliga loopar där arbetsflöde A anropar B som anropar A igen, finns det ett tak på hur djupt kedjan kan gå. En körning som går förbi gränsen avslutas med ett tydligt felmeddelande.

Om du har ett verkligt behov av en lång kedja (som ett jobb som bearbetar en post per körning) är det vanligtvis enklare att loopa inuti ett enda arbetsflöde med **Custom Code**.

## Webhook-säkerhet

Webhook-utlösare ger dig en unik URL. Vem som helst som känner till URL:en kan anropa den. För att skydda mot oavsiktliga eller oönskade anropare:

- Behandla URL:en som ett lösenord. Dela inte den offentligt eller committa den till ett offentligt repo.
- För känsliga arbetsflöden, be det anropande systemet att skicka en delad token som en header (som `X-Webhook-Token`) och kontrollera den med ett **Conditions**-block innan du gör något viktigt. Spara den förväntade tokenen som en hemlig variabel.
- För mycket känsliga arbetsflöden, föredra en OneUptime-händelseutlösare och ett manuellt importsteg istället för en offentlig webhook.

## Utgående nätverksåtkomst

API- och andra HTTP-block gör sina förfrågningar från OneUptime. Om du kör självhostat, se till att din installation kan nå tjänsterna du anropar. Om du använder OneUptime Cloud listas våra utgående IP-intervall i [IP-adresser](/docs/configuration/ip-addresses) så att du kan tillåta dem på den andra sidan.

## Behörigheter

Arbetsflöden respekterar ditt projekts rollbaserade åtkomstkontroll. De relevanta behörigheterna:

- **Create / Read / Edit / Delete Workflow** — de grundläggande behörigheterna på själva arbetsflödet.
- **Run Workflow** — behövs för att klicka på **Run Manually** eller utlösa ett arbetsflöde via API.
- **Read Workflow Log** — behövs för att se körningar.
- **Read / Create / Edit / Delete Workflow Variable** — kontroll över listan med globala variabler.

De flesta utvecklare bör ha skapa/redigera/läsa på arbetsflöden men inte på variabler. Spara redigeringsåtkomst för variabler åt de personer som hanterar projektets hemligheter.

## Plangränser

OneUptime Cloud begränsar antalet körningar per månad på mindre planer. Din aktuella gräns visas under **Project Settings → Billing**. När du når den avvisas nya utlösare till nästa faktureringscykel. Självhostade installationer har inte denna gräns.

## När arbetsflöden inte är rätt verktyg

Några fall där du bör välja något annat:

- **Tung beräkning eller stora datamängder** — arbetsflöden är designade för lätt limarbete, inte sifferknäckning. Kör tungt arbete i din egen infrastruktur och låt ett arbetsflöde sparka igång det.
- **Långkörande processer som sträcker sig över timmar** — en enskild körning är menad att avslutas snabbt. Om du behöver "gör A, vänta två timmar, gör B", använd en extern schemaläggare som skickar en webhook tillbaka till OneUptime när det är dags.
- **Steg-för-steg-incidenthantering med människor i loopen** — det är vad [Runbooks](/docs/runbooks/index) är till för. Arbetsflöden är för obevakad automation.

## Läs vidare

- [Översikt över arbetsflöden](/docs/workflows/index) — det stora hela.
- [Komponenter](/docs/workflows/components) — block-för-block-referens.
- [Runbooks](/docs/runbooks/index) — när du ska använda en runbook istället.
