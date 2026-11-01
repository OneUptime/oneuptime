# Uppdaterings- och säkerhetskontroller

En gång om dagen frågar en självhostad OneUptime GitHub om en nyare version har kommit, och om ett säkerhetsmeddelande som OneUptime har publicerat berör den version du kör. När ett säkerhetsmeddelande gör det uppmanas dina huvudadministratörer att uppgradera. Den här sidan beskriver vad kontrollen skickar, vad du ser och hur du stänger av den.

:::cards
- [Vad kontrollen skickar](#vad-kontrollen-skickar): Två offentliga frågor, och inget om din installation.
- [Vad du ser](#vad-du-ser): Sidfoten, administratörspanelen och ett e-postmeddelande per säkerhetsmeddelande.
- [Stäng av den](#stäng-av-den): För ett nätverk utan internetåtkomst, eller för att använda en spegel.
:::

## Vad kontrollen skickar

Workern skickar två begäranden till GitHubs API (`api.github.com`), utan token:

| Begäran | Vad den frågar efter |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Vilken OneUptime-version som är den senaste |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Vilka säkerhetsmeddelanden OneUptime har publicerat, vilka versioner vart och ett berör och vilken version som åtgärdar det |

Inget om din installation finns med i dem: inte versionen du kör, inte dess adress och inget om dina användare, projekt eller övervakningsdata. GitHub ser din servers offentliga IP-adress, som vid alla begäranden, och en `User-Agent` som namnger OneUptime. Huruvida ett säkerhetsmeddelande berör din version avgörs på din server, och ingen webbläsare anropar GitHub.

Kontrollen körs när workern startar och därefter en gång om dagen. Den frågar GitHub igen högst var 12:e timme, och högst en gång i timmen efter en begäran som misslyckades.

## Vad du ser

Bara huvudadministratörer får veta det. Det är de som kan uppgradera, och att berätta för någon annan att servern kör en version med ett känt säkerhetsproblem skulle peka ut en server som saknar säkerhetsuppdateringar.

- En nyare version lägger till **Uppdatering tillgänglig** i sidfoten i Dashboarden och i administratörspanelen. Den öppnar uppgraderingsguiden.
- Ett publicerat säkerhetsmeddelande som berör den version du kör lägger i stället till **Säkerhetsuppdatering** där, i rött.
- Administratörspanelens första sida listar då varje säkerhetsmeddelande: dess allvarlighetsgrad, vilka versioner det berör, vilken version som åtgärdar det och en länk till det på GitHub. Den visar också när kontrollen senast läste säkerhetsmeddelandena, och varför den senaste kontrollen misslyckades, om den gjorde det.
- Dina huvudadministratörer och adressen under Admin-notifierings-e-post (**Inställningar** > **E-post** i administratörspanelen) får ett e-postmeddelande om varje säkerhetsmeddelande som berör din version, och aldrig ett andra.

Allt detta försvinner så snart du kör en version som inget säkerhetsmeddelande berör. Hur du uppgraderar står i [Uppgradering](/docs/installation/upgrading).

## Stäng av den

I ett nätverk utan internetåtkomst, eller om din server inte ska kontakta GitHub, stänger du av kontrollen. Då visas ingenting och inga e-postmeddelanden skickas.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Ange det i `config.env` och kör sedan `npm start`.
:::

Om du i stället vill kontrollera mot en spegel i ditt nätverk pekar du kontrollen mot den. Spegeln måste svara i samma format som GitHub.

| Helm-värde | Docker Compose-inställning | Standardvärde |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## När GitHub inte går att nå

I ett nätverk utan internetåtkomst är en misslyckad begäran väntad, inte ett fel. Workern loggar den på debugnivå, behåller det den senast läste och försöker igen senare. Administratörspanelen visar när säkerhetsmeddelandena senast lästes, och varför den senaste kontrollen misslyckades: GitHubs hastighetsgräns, ingen väg till GitHub, en timeout eller ett svar som inte kommer från GitHub.

## Nästa steg

:::cards
- [Uppgradering](/docs/installation/upgrading): Uppgradera till en nyare version, en huvudversion i taget.
- [Arkitektur](/docs/self-hosted/architecture): Varje anslutning som en självhostad OneUptime gör.
- [Bakom VPN eller brandvägg](/docs/self-hosted/behind-a-firewall): Det som når din server utifrån.
:::
