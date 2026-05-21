# Konfiguration & behörigheter

Den här sidan täcker de inställningar och åtkomstkontroller som är värda att känna till när du har en instrumentpanel du vill behålla.

## Ägare

En instrumentpanels **ägare** är användare och team som du har gett explicit åtkomst till (utöver deras projektomfattande roll).

Under **Dashboard → Owners**:

- Lägg till en **user owner** för att ge en person extra åtkomst till denna instrumentpanel.
- Lägg till en **team owner** för att ge samma sak till varje medlem i ett team.

Använd ägare när den projektomfattande läsrollen är för bred — till exempel en instrumentpanel med kunddetaljer som endast bör vara synlig för kundframgångsteamet.

## Etiketter

Etiketter är taggar för att organisera instrumentpaneler. Tillämpa dem under **Dashboard → Overview**.

Vanliga mönster:

- **Per team**: `team:platform`, `team:checkout`, `team:growth`.
- **Per miljö**: `env:prod`, `env:staging`.
- **Per syfte**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

Listan **Dashboards** låter dig filtrera på etikett, vilket är det snabbaste sättet att hitta en instrumentpanel i ett projekt som har samlat på sig många av dem.

## Behörigheter

Instrumentpaneler fungerar med ditt projekts rollbaserade åtkomstkontroll. De relevanta behörigheterna:

| Behörighet | Vad den tillåter |
| --- | --- |
| **Create Dashboard** | Skapa nya instrumentpaneler. |
| **Read Dashboard** | Visa instrumentpaneler (i privat läge). |
| **Edit Dashboard** | Ändra widgetar, variabler och inställningar. |
| **Delete Dashboard** | Radera en instrumentpanel. |

Det finns matchande behörigheter för instrumentpanelägare och anpassade domäner, så att du kan ge "hantera ägare" utan att ge "redigera instrumentpanelen."

Tilldela dessa på projektroller under **Project Settings → Teams & Roles**.

## Åtkomst för offentliga instrumentpaneler

När du gör en instrumentpanel offentlig (se [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing)), styr tre inställningar vem som kan se den:

1. **Public Dashboard**-växel — om av returnerar den offentliga URL:en 404.
2. **Master Password** — om inställt anger besökare ett lösenord innan instrumentpanelen visas.
3. **IP Whitelist** (Scale-plan) — om inställt avvisas förfrågningar från andra IP:er.

Du kan kombinera alla dessa. Den mest låsta kombinationen är "Public på, lösenord inställt, IP-tillåtslista aktiv" — användbart för partnerportaler där du vill ha alla tre lagren.

## Datakvarhållning

Instrumentpaneler i sig själva förfaller inte. Datan de visar följer ditt projekts kvarhållningsinställningar — mätvärden, loggar och traces är frågbara så länge din plan behåller dem. En widget riktad mot "de senaste 90 dagarna" på en plan som behåller 30 dagar visar vad som fortfarande finns lagrat.

## Duplicera en instrumentpanel

För att kopiera en befintlig instrumentpanel, öppna instrumentpanellistan och välj **Duplicate**. Kopian inkluderar varje widget, variabel och inställning förutom offentlig delning — den börjar alltid av så att du kan bestämma om du vill slå på den igen.

Detta är rätt drag när du vill forka en mall (som "vår jourinstrumentpanel") till en tjänstespecifik kopia.

## Radera en instrumentpanel

Under **Dashboard → Delete**. Detta kan inte ångras — instrumentpanelens layout och alla anpassade domäner som är kopplade till den tas bort. Din telemetridata påverkas inte.

Om instrumentpanelen är offentlig på en anpassad domän slutar URL:en svara så snart du raderar den. Flytta domänen till en annan instrumentpanel först om du vill behålla URL:en fungerande.

## Säkerhetskopiering

Om du kör OneUptime självhostat är en vanlig databassäkerhetskopiering tillräcklig — instrumentpanelens konfiguration sparas tillsammans med resten av ditt projekt.

På OneUptime Cloud hanteras säkerhetskopiering åt dig. Om du vill ha din egen kopia kan du läsa instrumentpanelen via [OneUptime API](/docs/api-reference/api-reference).

## Läs vidare

- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — kontroller i offentligt läge.
- [Variabler & filter](/docs/dashboards/variables) — mallning.
- [Widgetar](/docs/dashboards/widgets) — widget-katalogen.
- [Översikt över instrumentpaneler](/docs/dashboards/index) — det stora hela.
