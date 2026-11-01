# Update- en beveiligingscontroles

Eén keer per dag vraagt een zelf gehoste OneUptime aan GitHub of er een nieuwere versie is, en of een beveiligingsadvies dat OneUptime heeft gepubliceerd, de versie treft die u draait. Is dat zo, dan krijgen uw hoofdbeheerders het verzoek om te upgraden. Deze pagina beschrijft wat de controle verstuurt, wat u ziet en hoe u de controle uitzet.

:::cards
- [Wat de controle verstuurt](#wat-de-controle-verstuurt): Twee openbare vragen, en niets over uw installatie.
- [Wat u ziet](#wat-u-ziet): De voettekst, het Admin-dashboard en één e-mail per advies.
- [De controle uitzetten](#de-controle-uitzetten): Voor een netwerk zonder internettoegang, of om een mirror te gebruiken.
:::

## Wat de controle verstuurt

De worker stuurt twee verzoeken naar de API van GitHub (`api.github.com`), zonder token:

| Verzoek | Wat het vraagt |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Welke OneUptime-versie de nieuwste is |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Welke beveiligingsadviezen OneUptime heeft gepubliceerd, welke versies elk advies treft en welke versie het verhelpt |

Er staat niets over uw installatie in: niet de versie die u draait, niet het adres ervan, en niets over uw gebruikers, projecten of monitoringgegevens. GitHub ziet het openbare IP-adres van uw server, zoals bij elk verzoek, en een `User-Agent` die OneUptime noemt. Of een advies uw versie treft, wordt op uw server bepaald, en geen enkele browser roept GitHub aan.

De controle draait wanneer de worker start en daarna één keer per dag. GitHub wordt hoogstens om de 12 uur opnieuw gevraagd, en na een mislukt verzoek hoogstens één keer per uur.

## Wat u ziet

Alleen hoofdbeheerders krijgen het te horen. Zij kunnen upgraden, en iemand anders vertellen dat de server een versie met een bekend beveiligingsprobleem draait, zou een ongepatchte server aanwijzen.

- Een nieuwere versie voegt **Update beschikbaar** toe aan de voettekst van het Dashboard en van het Admin-dashboard. Het label opent de upgradehandleiding.
- Een gepubliceerd beveiligingsadvies dat de versie treft die u draait, zet daar in plaats daarvan **Beveiligingsupdate** neer, in rood.
- De eerste pagina van het Admin-dashboard toont dan elk advies: de ernst, de versies die het treft, de versie die het verhelpt en een link ernaar op GitHub. Ook staat er wanneer de controle de adviezen het laatst heeft gelezen, en waarom de laatste controle is mislukt, als dat zo is.
- Uw hoofdbeheerders en de Admin-meldings-e-mail (**Instellingen** > **E-mails** in het Admin-dashboard) krijgen één e-mail over elk advies dat uw versie treft, en nooit een tweede.

Dit alles verdwijnt zodra u een versie draait die door geen enkel advies wordt getroffen. Zie [Upgraden](/docs/installation/upgrading) om te upgraden.

## De controle uitzetten

Zet de controle uit op een netwerk zonder internettoegang, of als uw server geen contact met GitHub mag opnemen. Er wordt dan niets getoond of gemaild.

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
Stel dit in `config.env` in en voer daarna `npm start` uit.
:::

Wilt u in plaats daarvan controleren tegen een mirror binnen uw netwerk, laat de controle dan naar die mirror wijzen. De mirror moet antwoorden in dezelfde vorm als GitHub.

| Helm-waarde | Docker Compose-instelling | Standaard |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Wanneer GitHub niet bereikbaar is

Op een netwerk zonder internettoegang is een mislukt verzoek te verwachten, geen fout. De worker logt het op debugniveau, bewaart wat hij het laatst heeft gelezen en probeert het later opnieuw. Het Admin-dashboard toont wanneer de adviezen het laatst zijn gelezen, en waarom de laatste controle is mislukt: de rate limit van GitHub, geen route naar GitHub, een time-out of een antwoord dat niet van GitHub is.

## Volgende stappen

:::cards
- [Upgraden](/docs/installation/upgrading): Upgrade naar een nieuwere versie, één hoofdversie tegelijk.
- [Architectuur](/docs/self-hosted/architecture): Elke verbinding die een zelf gehoste OneUptime maakt.
- [Achter een VPN of firewall](/docs/self-hosted/behind-a-firewall): Wat uw server van buitenaf bereikt.
:::
