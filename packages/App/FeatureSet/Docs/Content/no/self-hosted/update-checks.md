# Oppdaterings- og sikkerhetskontroller

Én gang om dagen spør en selvhostet OneUptime GitHub om det har kommet en nyere utgivelse, og om en sikkerhetsmelding som OneUptime har publisert, påvirker versjonen du kjører. Når det skjer, blir hovedadministratorene dine bedt om å oppgradere. Denne siden forklarer hva kontrollen sender, hva du ser, og hvordan du slår den av.

:::cards
- [Hva kontrollen sender](#hva-kontrollen-sender): To offentlige spørsmål, og ingenting om installasjonen din.
- [Hva du ser](#hva-du-ser): Bunnteksten, Admin-dashbordet og én e-post per sikkerhetsmelding.
- [Slå av kontrollen](#slå-av-kontrollen): For et nettverk uten internettilgang, eller for å bruke et speil.
:::

## Hva kontrollen sender

Workeren sender to forespørsler til GitHubs API (`api.github.com`), uten token:

| Forespørsel | Hva den spør om |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Hvilken OneUptime-utgivelse som er den nyeste |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Hvilke sikkerhetsmeldinger OneUptime har publisert, hvilke versjoner hver av dem påvirker, og utgivelsen som retter den |

Ingenting om installasjonen din er med i dem: verken versjonen du kjører eller adressen dens, og ingenting om brukerne, prosjektene eller overvåkingsdataene dine. GitHub ser den offentlige IP-adressen til serveren din, slik den gjør ved alle forespørsler, og en `User-Agent` som nevner OneUptime. Om en sikkerhetsmelding påvirker versjonen din, regnes ut på serveren din, og ingen nettleser kaller GitHub.

Kontrollen kjører når workeren starter, og deretter én gang om dagen. Den spør GitHub på nytt høyst hver 12. time, og høyst én gang i timen etter en forespørsel som feilet.

## Hva du ser

Bare hovedadministratorer får beskjed. Det er de som kan oppgradere, og å fortelle noen andre at serveren kjører en versjon med et kjent sikkerhetsproblem, ville peke ut en server som mangler rettelsen.

- En nyere utgivelse legger til **Oppdatering tilgjengelig** i bunnteksten i Dashbordet og i Admin-dashbordet. Merket åpner oppgraderingsveiledningen.
- En publisert sikkerhetsmelding som påvirker versjonen du kjører, viser i stedet **Sikkerhetsoppdatering** på samme sted, i rødt.
- Den første siden i Admin-dashbordet viser da hver sikkerhetsmelding: alvorlighetsgraden, versjonene den påvirker, utgivelsen som retter den, og en lenke til den på GitHub. Den viser også når kontrollen sist leste sikkerhetsmeldingene, og hvorfor den siste kontrollen feilet, hvis den gjorde det.
- Hovedadministratorene dine og adressen i Admin-varsel-e-post (**Innstillinger** > **E-poster** i Admin-dashbordet) får én e-post om hver sikkerhetsmelding som påvirker versjonen din, og aldri en til om den samme.

Alt dette forsvinner så snart du kjører en versjon som ingen sikkerhetsmelding påvirker. Se [Oppgradering](/docs/installation/upgrading) for å oppgradere.

## Slå av kontrollen

På et nettverk uten internettilgang, eller hvis serveren din ikke skal kontakte GitHub, slår du av kontrollen. Da blir ingenting vist eller sendt på e-post.

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
Sett den i `config.env`, og kjør deretter `npm start`.
:::

Vil du heller kontrollere mot et speil i nettverket ditt, peker du kontrollen mot det. Speilet må svare i samme format som GitHub.

| Helm-verdi | Docker Compose-innstilling | Standard |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Når GitHub ikke kan nås

På et nettverk uten internettilgang er en mislykket forespørsel forventet, ikke en feil. Workeren logger den på debug-nivå, beholder det den leste sist, og prøver igjen senere. Admin-dashbordet viser når sikkerhetsmeldingene sist ble lest, og hvorfor den siste kontrollen feilet: GitHubs hastighetsbegrensning, ingen rute til GitHub, et tidsavbrudd eller et svar som ikke er fra GitHub.

## Neste steg

:::cards
- [Oppgradering](/docs/installation/upgrading): Oppgrader til en nyere utgivelse, én hovedversjon om gangen.
- [Arkitektur](/docs/self-hosted/architecture): Alle tilkoblinger en selvhostet OneUptime oppretter.
- [Bak en VPN eller brannmur](/docs/self-hosted/behind-a-firewall): Hva som når serveren din utenfra.
:::
