# Konfiguration & behörigheter

Den här sidan samlar de inställningar och åtkomstkontroll-rattar som är värda att känna till när du har en instrumentpanel du faktiskt vill behålla.

## Ägarskap

En instrumentpanels **ägare** är de användare och team som beviljas explicita behörigheter på den (separat från den projektomfattande rollen).

Under **Dashboard → Owners**:

- Lägg till en **användarägare** för att ge en specifik person extra åtkomst till denna instrumentpanel.
- Lägg till en **team-ägare** för att ge samma sak till varje medlem i ett team.

Använd ägarskap när den projektomfattande läsrollen är för bred — t.ex. en instrumentpanel med känsliga kundnivå-detaljer som bara ska vara synliga för kundframgångsteamet.

## Etiketter

Etiketter är många-till-många-taggar för att organisera instrumentpaneler. Applicera dem under **Dashboard → Overview**.

Vanliga etikettmönster:

- **Efter team**: `team:platform`, `team:checkout`, `team:growth`.
- **Efter miljö**: `env:prod`, `env:staging`.
- **Efter syfte**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

**Dashboards**-listan låter dig filtrera efter etikett, vilket är det snabbaste sättet att hitta en instrumentpanel i ett projekt som har samlat på sig dussintals.

## Behörigheter

Instrumentpaneler är förstklassiga resurser i OneUptimes rollbaserade åtkomstkontroll. De relevanta behörigheterna:

| Behörighet | Tillåter |
| --- | --- |
| `CreateDashboard` | Skapa nya instrumentpaneler i projektet. |
| `ReadDashboard` | Visa instrumentpaneler (i privat läge). |
| `EditDashboard` | Modifiera widgetar, variabler, inställningar på en instrumentpanel. |
| `DeleteDashboard` | Ta bort en instrumentpanel. |

Det finns matchande behörigheter för de stödjande entiteterna: instrumentpanelägare (användare / team) och anpassade domäner har sina egna create / read / edit / delete-par så att du kan bevilja "hantera ägare" utan att bevilja "redigera själva instrumentpanelen."

Tilldela dessa på projektroller under **Project Settings → Teams & Roles**.

## Åtkomstkontroll i offentligt läge

Åtkomst i offentligt läge (se [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing)) styrs av tre lager, i ordning:

1. **Public Dashboard**-växel — om av returnerar den offentliga URL:en en 404.
2. **Master Password** — om satt måste besökare ange det innan instrumentpanelen renderas.
3. **IP Whitelist** (Scale-plan) — om satt får förfrågningar från icke-listade IP:er en 403.

En instrumentpanel kan ha vilken kombination som helst. Den mest defensiva konfigurationen är "Public på, lösenord satt, IP-tillåtslista aktiv" — användbart för partnerportaler där du vill ha alla tre.

## Retention

Instrumentpaneler själva går inte ut. Datan de visar följer projektets telemetri-retention — mätvärden, loggar och traces är frågbara så länge som din plan behåller dem. En widget som pekar på "de senaste 90 dagarna" på en plan med 30 dagars retention kommer att rendera vad som än fortfarande finns i lagret.

## Klona en instrumentpanel

För att duplicera en befintlig instrumentpanel, öppna den och använd **Duplicate**-åtgärden från instrumentpanellistan. Kopian inkluderar varje widget, variabel och inställning förutom konfigurationen för offentligt läge (som alltid börjar av — du bestämmer om du vill återaktivera på kopian).

Det här är rätt mönster när du vill forka en mall ("vår jour-instrumentpanel") till en tjänstspecifik version.

## Ta bort en instrumentpanel

Under **Dashboard → Delete**. Detta är oåterkalleligt — arbetsytans konfiguration och eventuella anpassade domänkopplingar tas bort. Telemetridata påverkas inte (den bor i metric- / log- / trace-lagren, inte på instrumentpanelen).

Om en instrumentpanel publiceras offentligt med en anpassad domän, slutar den offentliga URL:en att lösas i samma stund som du tar bort den. Dra av domänen först om du behöver peka om den.

## Migrering och backup

För self-hostade installationer: instrumentpanelens fullständiga konfiguration (widgetar, variabler, inställningar) bor i `Dashboard`-tabellen i Postgres. En vanlig databasbackup är tillräcklig — det finns inget separat exportformat för instrumentpaneler.

För OneUptime Cloud: vanliga backuper hanteras åt dig. Om du vill ha en lokal kopia av en instrumentpanels konfiguration, använd [OneUptime API](/docs/api-reference/api-reference) för att läsa `Dashboard`-posten.

## Var läsa vidare

- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — den offentliga sidan av åtkomstkontroll.
- [Variabler & filter](/docs/dashboards/variables) — mallning.
- [Widgetar](/docs/dashboards/widgets) — widget-katalogen.
- [Översikt över instrumentpaneler](/docs/dashboards/index) — den begreppsmässiga kartan.
