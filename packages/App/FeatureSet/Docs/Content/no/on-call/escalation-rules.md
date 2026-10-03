# Eskaleringsregler

En vaktretningslinje varsler folk i nivåer. Hver eskaleringsregel er ett nivå: hvem som varsles, og hvor lenge det ventes på at noen bekrefter før neste nivå varsles. Reglene i en retningslinje står i rekkefølge på siden **Eskaleringsregler**.

## Hvem som varsles først

Når du oppretter en vaktretningslinje på siden **Vaktretningslinjer**, spør skjemaet om **Navn** og **Hvem varsles først?**. Spørsmålet bruker samme velger som **Varsle**: vaktplaner, team og personer, så mange du trenger. De du velger, utgjør den første eskaleringsregelen i retningslinjen, **Level 1**, som venter **30 minutter** på en bekreftelse før neste nivå varsles. Den nye retningslinjen åpnes deretter på siden **Eskaleringsregler**, der du kan legge til flere nivåer.

**Hvem varsles først?** er valgfritt. Lar du det stå tomt, starter retningslinjen uten eskaleringsregler: Den varsler ingen før du legger til en, og oversikten sier fra om det. Beskrivelsen og etikettene ligger under **Avansert**. Spørsmålet stilles bare til dem som kan legge til eskaleringsregler.

## Legg til en eskaleringsregel

Åpne vaktretningslinjen, velg **Eskaleringsregler** i sidemenyen og klikk på **Add Escalation Rule**. Dialogen er én kort side med to spørsmål:

- **Varsle** — hvem som varsles på dette nivået. Én velger dekker vaktplaner, team og personer: klikk på **Legg til mottaker**, søk og velg så mange du trenger. Minst én må med.
  - En **vaktplan** varsler den som har vakt når nivået kjører, ikke en fast person.
  - Et **team** varsler hvert medlem av teamet.
  - En **person** varsles direkte.
- **Eskaler etter (i minutter)** — hvor lenge det ventes på en bekreftelse før neste nivå varsles. Den starter på **30 minutter**; endre den slik at den passer nivået.

Alt annet ligger under **Avansert**, sammenfoldet til du åpner det:

- **Navn** — valgfritt. En regel uten navn heter etter nivået sitt: den første regelen i en retningslinje er **Level 1**, den andre **Level 2** og så videre. Navnefeltet viser navnet regelen får.
- **Beskrivelse** — valgfrie notater, for eksempel hvem dette nivået varsler og hvorfor.

Overskriften på **Avansert** viser **Konfigurert** når regelen har en beskrivelse eller et navn du har valgt selv.

## Slik varsler nivåene folk

Når en hendelse eller et varsel når retningslinjen, varsler **Level 1** mottakerne sine med en gang. Hvis ingen bekrefter innen ventetiden, varsles **Level 2**, og så videre nedover listen. Når ventetiden for det siste nivået har gått uten bekreftelse, starter retningslinjen på nytt fra **Level 1** hvis **Gjentakelsesretningslinje** (under reglene) sier at den skal gjentas, så mange ganger den tillater, og ellers stopper den.

Oversikten øverst på siden **Eskaleringsregler** viser hele stigen: når hvert nivå varsles, hvem det varsler og hva som skjer etter det siste. Et nivå der ikke alle mottakerne kan varsles, sier fra om det på kortet sitt; klikk på merket for å se hvem og hvorfor.

## Rediger, omorganiser og slett regler

- **Edit rule** åpner den samme dialogen på én side, fylt ut med regelen slik den er: mottakerne, ventetiden og navnet og beskrivelsen under **Avansert**. Legg til eller fjern mottakere og lagre. Tømmer du navnet, får regelen igjen nivåets navn.
- **Move up** og **Move down** i en regels **⋯**-meny endrer nivået. En regel som heter etter nivået sitt, beholder et navn som passer plassen: når **Level 3** flyttes opp forbi **Level 2**, bytter de to navn. Et navn du har valgt selv, som **Managers**, forblir det samme uansett hvor regelen flyttes.
- **Delete rule** spør først og forteller hvem nivået varsler. Sletter du et nivå, flyttes nivåene under det opp, og regler som heter etter nivået sitt, får nye navn som passer.

## Opprett regler med API-et eller Terraform

Eskaleringsregler er ressursen `/api/on-call-duty-policy-escalation-rule`; personene, teamene og vaktplanene en regel varsler, er ressursene `/api/on-call-duty-policy-escalation-rule-user`, `-team` og `-schedule`.

- En regel som opprettes uten `name`, får navn etter nivået sitt, slik som i dashbordet: **Level 3** for en regel som blir det tredje nivået i retningslinjen. Terraform-ressursen for eskaleringsregler krever fortsatt et navn.
- `escalateAfterInMinutes` har ingen standardverdi utenfor dashbordet. En regel som opprettes uten den, venter ikke: neste nivå varsles så snart dette har kjørt. Angi den eksplisitt — dashbordet foreslår 30.
- Regler som heter etter nivået sitt, får nye navn når du flytter eller sletter regler i dashbordet. Endrer du `order` via API-et eller Terraform, endres bare rekkefølgen.
- Opprettes en vaktretningslinje via `/api/on-call-duty-policy` med `onCallSchedules`, `teams` eller `users` (lister med ID-er) i `miscDataProps`, får den sin første eskaleringsregel, slik som i dashbordet: **Level 1**, som varsler dem, med en `escalateAfterInMinutes` på 30. Hver ID må høre til prosjektet, og den som kaller, må ha lov til å opprette eskaleringsregler; ellers opprettes ikke retningslinjen. En retningslinje som opprettes uten dem, har ingen regler, som før; Terraform-ressursen for retningslinjer sender dem ikke.
