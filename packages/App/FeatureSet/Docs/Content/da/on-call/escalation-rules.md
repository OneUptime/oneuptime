# Eskaleringsregler

En vagtpolitik tilkalder folk i niveauer. Hver eskaleringsregel er ét niveau: hvem der tilkaldes, og hvor længe der ventes på, at nogen kvitterer, før næste niveau tilkaldes. En politiks regler står i rækkefølge på dens side **Eskaleringsregler**.

## Hvem der tilkaldes først

Når du opretter en vagtpolitik på siden **Vagtpolitikker**, beder formularen om dens **Navn** og **Hvem tilkaldes først?**. Spørgsmålet bruger samme vælger som **Underret**: vagtplaner, teams og personer, så mange du har brug for. Dem, du vælger, udgør politikkens første eskaleringsregel, **Level 1**, som venter **30 minutter** på en kvittering, før næste niveau tilkaldes. Den nye politik åbner derefter på sin side **Eskaleringsregler**, hvor du kan tilføje flere niveauer.

**Hvem tilkaldes først?** er valgfrit. Lader du det stå tomt, starter politikken uden eskaleringsregler: Den tilkalder ingen, før du tilføjer en, og dens oversigt siger det. Beskrivelsen og etiketterne ligger under **Flere felter**. Spørgsmålet stilles kun til dem, der må tilføje eskaleringsregler.

## Tilføj en eskaleringsregel

Åbn vagtpolitikken, vælg **Eskaleringsregler** i sidemenuen, og klik på **Tilføj eskaleringsregel**. Dialogen er én kort side med to spørgsmål:

- **Underret** — hvem der tilkaldes på dette niveau. Én vælger dækker vagtplaner, teams og personer: klik på **Tilføj modtager**, søg, og vælg så mange, du har brug for. Der skal være mindst én.
  - En **vagtplan** tilkalder den, der har vagt, når niveauet kører, ikke en fast person.
  - Et **team** tilkalder hvert medlem af teamet.
  - En **person** tilkaldes direkte.
- **Eskalér efter (i minutter)** — hvor længe der ventes på en kvittering, før næste niveau tilkaldes. Den starter på **30 minutter**; ret den, så den passer til niveauet.

Alt andet ligger under **Flere felter**, foldet sammen, indtil du åbner det:

- **Navn** — valgfrit. En regel uden navn kaldes efter sit niveau: den første regel i en politik er **Level 1**, den anden **Level 2** og så videre. Navnefeltet viser det navn, reglen får.
- **Beskrivelse** — valgfrie noter, fx hvem dette niveau tilkalder og hvorfor.

Sammenklappet nævner overskriften på **Flere felter** de to og viser dem, reglen har: en beskrivelse eller et navn, du selv har valgt.

## Sådan tilkalder niveauerne folk

Når en hændelse eller en advarsel når politikken, tilkalder **Level 1** sine modtagere med det samme. Hvis ingen kvitterer inden for ventetiden, tilkaldes **Level 2**, og så videre ned gennem listen. Når det sidste niveaus ventetid er gået uden kvittering, starter politikken forfra fra **Level 1**, hvis dens **Gentagelsespolitik** (under reglerne) siger, at den skal gentages, så mange gange som den tillader, og ellers stopper den.

Oversigten øverst på siden **Eskaleringsregler** viser hele stigen: hvornår hvert niveau tilkaldes, hvem det tilkalder, og hvad der sker efter det sidste. Et niveau, hvor ikke alle modtagere kan tilkaldes, siger det på sit kort; klik på mærkatet for at se hvem og hvorfor.

Hvordan hver person, et niveau tilkalder, bliver nået, bestemmer vedkommendes egne vagtregler: **Brugerindstillinger** > **Vagtregler**, med en fane for hændelser, hændelsesepisoder, advarsler og advarselsepisoder og et kort pr. alvorlighed, der viser, hvilken notifikationsmetode der bruges og efter hvor lang tid. En projektadministrator kan se og ændre et medlems regler under **Brugere** > medlemmet > **Vagtregler**.

SMS, telefonopkald, WhatsApp og Telegram er slået fra i et nyt projekt: på OneUptime Cloud betales hver besked af projektets saldo, og en selvhostet installation skal først have en Twilio-konto eller en Telegram-bot sat op. Indtil en kanal er slået til, kan ingen i projektet tilføje en metode på den. Kun en projektejer eller nogen med tilladelsen **Manage Billing** kan slå en kanal til, i kortet **Notifikationskanaler** under **Projektindstillinger > Notifikationer > Notifikationsindstillinger** — en projektadministrator kan ikke. Alle andre får at vide præcis, hvem der kan, overalt hvor en kanal er slået fra: over deres egen liste over metoder på den, på deres opsætningstjekliste og i den besked, de får, når noget kræver den.

## Rediger, omordn og slet regler

- **Edit rule** åbner den samme dialog på én side, udfyldt med reglen, som den er: dens modtagere, dens ventetid og dens navn og beskrivelse under **Flere felter**. Tilføj eller fjern modtagere, og gem. Tømmer du navnet, får reglen igen sit niveaus navn.
- **Move up** og **Move down** i en regels **⋯**-menu ændrer dens niveau. En regel, der er opkaldt efter sit niveau, beholder et navn, der passer til dens plads: når **Level 3** rykker op forbi **Level 2**, bytter de to navne. Et navn, du selv har valgt, fx **Managers**, forbliver det samme, uanset hvor reglen flytter hen.
- **Delete rule** spørger først og fortæller, hvem niveauet tilkalder. Sletter du et niveau, rykker niveauerne under det op, og regler, der er opkaldt efter deres niveau, omdøbes, så de passer.

## Opret regler med API'et eller Terraform

Eskaleringsregler er ressourcen `/api/on-call-duty-policy-escalation-rule`; de personer, teams og vagtplaner, en regel tilkalder, er ressourcerne `/api/on-call-duty-policy-escalation-rule-user`, `-team` og `-schedule`.

- En regel, der oprettes uden `name`, opkaldes efter sit niveau, ligesom i dashboardet: **Level 3** for en regel, der bliver tredje niveau i sin politik. Terraform-ressourcen til eskaleringsregler kræver stadig et navn.
- `escalateAfterInMinutes` har ingen standardværdi uden for dashboardet. En regel, der oprettes uden den, venter ikke: næste niveau tilkaldes, så snart dette har kørt. Angiv den udtrykkeligt — dashboardet foreslår 30.
- Regler, der er opkaldt efter deres niveau, omdøbes, når du flytter eller sletter regler i dashboardet. Ændrer du `order` via API'et eller Terraform, ændres kun rækkefølgen.
- Oprettes en vagtpolitik via `/api/on-call-duty-policy` med `onCallSchedules`, `teams` eller `users` (lister med id'er) i dens `miscDataProps`, får den sin første eskaleringsregel, ligesom i dashboardet: **Level 1**, som tilkalder dem, med en `escalateAfterInMinutes` på 30. Hvert id skal høre til projektet, og kalderen skal have lov til at oprette eskaleringsregler; ellers oprettes politikken ikke. En politik, der oprettes uden dem, har ingen regler, som før; Terraform-ressourcen til politikker sender dem ikke.
