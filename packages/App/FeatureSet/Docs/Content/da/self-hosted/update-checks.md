# Opdaterings- og sikkerhedstjek

Én gang om dagen spørger en selvhostet OneUptime GitHub, om der er kommet en nyere udgivelse, og om en sikkerhedsmeddelelse, som OneUptime har offentliggjort, berører den version, du kører. Hvis det er tilfældet, bliver dine masteradministratorer bedt om at opgradere. Denne side beskriver, hvad tjekket sender, hvad du ser, og hvordan du slår det fra.

:::cards
- [Hvad tjekket sender](#hvad-tjekket-sender): To offentlige spørgsmål og intet om din installation.
- [Hvad du ser](#hvad-du-ser): Sidefoden, Admin-dashboardet og én e-mail pr. sikkerhedsmeddelelse.
- [Slå tjekket fra](#slå-tjekket-fra): Til et netværk uden internetadgang eller for at bruge et spejl.
:::

## Hvad tjekket sender

Workeren sender to forespørgsler til GitHubs API (`api.github.com`) uden token:

| Forespørgsel | Hvad den spørger om |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Hvilken OneUptime-udgivelse der er den nyeste |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Hvilke sikkerhedsmeddelelser OneUptime har offentliggjort, hvilke versioner hver af dem berører, og hvilken udgivelse der retter den |

Der står intet om din installation i dem: hverken den version, du kører, eller dens adresse, og intet om dine brugere, projekter eller overvågningsdata. GitHub ser din servers offentlige IP-adresse, som ved enhver forespørgsel, og en `User-Agent`, der nævner OneUptime. Om en sikkerhedsmeddelelse berører din version, afgøres på din server, og ingen browser kalder GitHub.

Tjekket kører, når workeren starter, og derefter én gang om dagen. Det spørger GitHub igen højst hver 12. time og højst én gang i timen efter en forespørgsel, der mislykkedes.

## Hvad du ser

Kun masteradministratorer får besked. Det er dem, der kan opgradere, og at fortælle andre, at serveren kører en version med et kendt sikkerhedsproblem, ville udpege en server, der mangler rettelsen.

- En nyere udgivelse tilføjer **Opdatering tilgængelig** i sidefoden på Dashboardet og på Admin-dashboardet. Mærket åbner opgraderingsguiden.
- En offentliggjort sikkerhedsmeddelelse, der berører den version, du kører, tilføjer i stedet **Sikkerhedsopdatering** samme sted, i rødt.
- Admin-dashboardets første side viser derefter hver sikkerhedsmeddelelse: dens alvorlighed, de versioner, den berører, den udgivelse, der retter den, og et link til den på GitHub. Siden viser også, hvornår tjekket sidst læste meddelelserne, og hvorfor det seneste tjek mislykkedes, hvis det gjorde.
- Dine masteradministratorer og adressen i Admin-notifikations-e-mail (**Indstillinger** > **E-mails** i Admin-dashboardet) får én e-mail om hver sikkerhedsmeddelelse, der berører din version, og aldrig en til om den samme.

Alt dette forsvinder, så snart du kører en version, som ingen sikkerhedsmeddelelse berører. Se [Opgradering](/docs/installation/upgrading) for at opgradere.

## Slå tjekket fra

Slå tjekket fra på et netværk uden internetadgang, eller hvis din server ikke må kontakte GitHub. Så bliver intet vist eller sendt på e-mail.

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
Sæt den i `config.env`, og kør derefter `npm start`.
:::

Vil du i stedet tjekke mod et spejl i dit netværk, så peg tjekket mod det. Spejlet skal svare i samme format som GitHub.

| Helm-værdi | Docker Compose-indstilling | Standard |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Når GitHub ikke kan nås

På et netværk uden internetadgang er en mislykket forespørgsel forventet, ikke en fejl. Workeren logger den på debug-niveau, beholder det, den sidst læste, og prøver igen senere. Admin-dashboardet viser, hvornår sikkerhedsmeddelelserne sidst blev læst, og hvorfor det seneste tjek mislykkedes: GitHubs hastighedsbegrænsning, ingen rute til GitHub, en timeout eller et svar, der ikke er fra GitHub.

## Næste trin

:::cards
- [Opgradering](/docs/installation/upgrading): Opgrader til en nyere udgivelse, én hovedversion ad gangen.
- [Arkitektur](/docs/self-hosted/architecture): Alle forbindelser, som en selvhostet OneUptime opretter.
- [Bag en VPN eller firewall](/docs/self-hosted/behind-a-firewall): Det, der når din server udefra.
:::
