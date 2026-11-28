# CrowdSec

Ontvang de waarschuwingen van [CrowdSec](https://www.crowdsec.net/) in de beveiligingsgebeurtenissen van OneUptime zodra CrowdSec ze genereert, en blokkeer de adressen op de blokkeerlijst van je project met CrowdSec. De eigen meldingsplug-in van CrowdSec stuurt elke waarschuwing naar een CrowdSec-verbinding, die zaken opent uit de detecties van CrowdSec. Zodra je blokkeren aanzet, bant OneUptime elk adres dat je blokkeert via de Local API van CrowdSec, en elke bouncer die die API leest, blokkeert het adres.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een verbinding, en de melding die de waarschuwingen van CrowdSec ernaartoe stuurt.
- [Wat er wordt ontvangen](#wat-er-wordt-ontvangen): Hoe elke CrowdSec-waarschuwing een beveiligingsgebeurtenis wordt.
- [Adressen blokkeren met CrowdSec](#adressen-blokkeren-met-crowdsec): Ban de adressen op je blokkeerlijst in CrowdSec.
- [De blokkeerlijsten van CrowdSec lezen](#de-blokkeerlijsten-van-crowdsec-lezen): De lijsten die de CrowdSec Console levert, als feed met dreigingsinformatie.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een CrowdSec-waarschuwing naar een beveiligingsgebeurtenis"
flowchart TB
    crowdsec["CrowdSec geeft een<br/>waarschuwing"] --> profile["Een profiel stuurt die<br/>naar de melding<br/>oneuptime"]
    profile --> post["De http-plug-in<br/>post die naar de<br/>verbinding"]
    post --> event["Die wordt opgeslagen<br/>als Detection Finding"]
```

De Local API van CrowdSec geeft elke waarschuwing die een profiel naar een melding stuurt door aan de plug-in van die melding. De melding van de verbinding gebruikt de `http`-plug-in van CrowdSec: die post de waarschuwing, in de eigen JSON van CrowdSec, met je ingestiesleutel naar de ingestie van beveiligingsgebeurtenissen, en noemt daarbij de verbinding. OneUptime slaat haar op als een [OCSF](https://schema.ocsf.io/)-gebeurtenis Detection Finding (klasse `2004`), toetst haar aan je detectieregels, en opent een zaak uit elke eigen detectie van CrowdSec die het niveau van **Zaken openen vanaf** van de verbinding haalt. Er wordt niets gepold: een waarschuwing arriveert enkele seconden nadat CrowdSec haar genereert.

## Voordat je begint

- In OneUptime de rol Projecteigenaar, Projectbeheerder of Beveiligingsbeheerder. Beveiligingslid en Beveiligingskijker zien verbindingen, maar kunnen ze niet wijzigen.
- CrowdSec 1.5 of later, met zijn Local API en de `http`-meldingsplug-in die het meelevert. Deze pagina is geschreven op basis van CrowdSec v1.8.2.
- Uitgaand HTTPS van de host waarop de Local API van CrowdSec draait naar je OneUptime.
- Om ook adressen te blokkeren: een Local API die OneUptime kan bereiken, en een machine voor OneUptime (zie [Adressen blokkeren met CrowdSec](#adressen-blokkeren-met-crowdsec)).

## De verbinding instellen

:::steps
### De verbinding toevoegen in OneUptime

Open **Producten → Beveiligingsgebeurtenissen → Verbindingen** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **CrowdSec** en klik op **Volgende**. Om alleen waarschuwingen te ontvangen, laat je elke instelling uit de tabel hieronder leeg; om ook adressen te blokkeren, vul je ze in.

### Testen voordat je opslaat

Klik op **Deze instellingen testen** onder **Testen voor het opslaan**. Zonder ingestelde Local API zegt de test dat en benadert hij niets; met een Local API bereikt hij die, meldt hij zich aan als de machine, en slaat hij niets op. Klik daarna op **Volgende**, geef de verbinding een **Naam** in de stap **Waarschuwingen**, kies de waarde van **Zaken openen vanaf** en maak haar aan.

### De melding opslaan op de CrowdSec-host

Het aanmaken van de verbinding opent haar **Waarschuwingen verzenden**, dat je later weer opent vanuit de rij van de verbinding. Kies onder **Kies een ingestiesleutel** een sleutel en bewaar dan de melding die het toont, met je sleutel en je verbinding al ingevuld, op de host waarop de Local API van CrowdSec draait:

```yaml title="/etc/crowdsec/notifications/oneuptime.yaml"
type: http
name: oneuptime

# info or quieter: at debug, CrowdSec logs each request's headers.
log_level: info

format: |
  {{.|toJson}}

url: https://oneuptime.com/security-events/v1/ingest?connection=YOUR_CONNECTION_ID&format=crowdsec
method: POST
headers:
  Content-Type: application/json
  x-oneuptime-token: YOUR_INGESTION_TOKEN
```

### De waarschuwingen van je profielen ernaartoe sturen

Voeg in `/etc/crowdsec/profiles.yaml` `oneuptime` toe aan de `notifications` van elk profiel waarvan OneUptime de waarschuwingen moet ontvangen, en herlaad daarna CrowdSec:

```yaml title="/etc/crowdsec/profiles.yaml"
notifications:
  - oneuptime
```

```bash
sudo systemctl reload crowdsec
```

### Een testwaarschuwing sturen

```bash
sudo cscli notifications test oneuptime
```

**Waarschuwingen verzenden** zegt wanneer ze binnenkomt, en **Waarschuwingen bekijken** opent haar in de beveiligingsgebeurtenissen. Het is een gebeurtenis met ernst Informational, en ze opent geen zaak.
:::

| Instelling | Wat je invult |
| --- | --- |
| **Local API-URL** | Alleen om adressen te blokkeren: waar OneUptime de Local API van CrowdSec bereikt, zoals `https://crowdsec.example.com:8080`. Gebruik `https` overal waar de verbinding een netwerk oversteekt. |
| **Machine-ID** | Alleen om adressen te blokkeren: de machine waarmee OneUptime zich aanmeldt, toegevoegd op de CrowdSec-host met `sudo cscli machines add oneuptime --auto -f -`. |
| **Adressen blokkeren met CrowdSec** | Uit op een nieuwe verbinding. Aan bant hij de adressen en bereiken op je blokkeerlijst in CrowdSec, en heeft hij de andere drie instellingen nodig (zie [Adressen blokkeren met CrowdSec](#adressen-blokkeren-met-crowdsec)). |
| **Machinewachtwoord** | Alleen om adressen te blokkeren: het wachtwoord dat `cscli` voor de machine toonde. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Inloggegevens bijwerken** op de verbinding. |

De stap **Waarschuwingen** heeft ook een optionele **Beschrijving**, en **Ingeschakeld**, dat aan begint. Een verbinding die niet is ingeschakeld, bewaart de waarschuwingen die ze ontvangt als gebeurtenissen, en opent er geen zaak uit.

In een container komt de melding in de map die op `/etc/crowdsec/notifications/` is gekoppeld, en een herstart van de container leest haar in. Een Kubernetes-installatie noemt haar in haar Helm-waarden onder `config.notifications`, met `profiles.yaml` ernaast onder `config`.

## Wat er wordt ontvangen

Elke waarschuwing die CrowdSec stuurt, wordt één gebeurtenis Detection Finding (OCSF-klasse `2004`), met leverancier en product `CrowdSec`:

| CrowdSec-veld | OneUptime-kolom |
| --- | --- |
| `uuid`, of een hash van een waarschuwing zonder | Gebeurtenis-UID, waarop ook duplicaten worden verwijderd |
| `stop_at`, of `start_at` | Tijd van de gebeurtenis |
| `scenario` | Regel-ID, en de regelnaam: de titel van het scenario op de CrowdSec Hub, of de naam ervan |
| `source.ip`, of `source.value` van een `Ip`-waarschuwing | IP van de actor |
| `target_fqdn` of `target_host` van de waarschuwing of haar gebeurtenissen, anders de `machine` die haar gebeurtenissen noemen | Doelhost |
| `target_user`, `target_uri` | Doelgebruiker en -resource |
| De `type` van de eerste beslissing | Status: `Blocked` voor een ban, `Challenge` voor een captcha, `Logged` zonder beslissing of in simulatiemodus |
| Het gedrag van het scenario | Ernst, en de MITRE ATT&CK-tactieken en -technieken ervan |
| Al het andere, zoals `source.cn`, `source.as_name` en `events_count` | `attributes`: de velden van de waarschuwing plat gemaakt tot sleutels met punten, haar eerste 10 gebeurtenissen volledig, en de lezing van OneUptime onder `crowdsec.` |

Een CrowdSec-waarschuwing heeft geen eigen ernst, dus OneUptime leidt die af uit wat het scenario detecteert, zoals de CrowdSec Hub het labelt (`ssh:bruteforce`, `http:exploit`):

| Gedrag | Ernst |
| --- | --- |
| Een exploit, zoals een CVE of wat de AppSec-component blokkeerde, of wat een aanvaller doet eenmaal binnen | High |
| Brute force, denial of service, fraude, een onmogelijke aanmelding, of gedrag dat OneUptime niet kan plaatsen | Medium |
| Scans, probes, crawls, bots, spam en wijzigingen in cloud-audits | Low |
| De eigen testscenario's van CrowdSec | Informational |

Met **Zaken openen vanaf** op **Hoog en hoger** openen de exploits van CrowdSec zaken, en blijven zijn alledaagse bans van scanners en wachtwoordraders gebeurtenissen voor je detectieregels. Alleen de eigen detecties van CrowdSec openen zaken. Een beslissing die iemand met `cscli` of in de Console van CrowdSec heeft toegevoegd, een adres op een blokkeerlijst van CrowdSec, de testwaarschuwing en de eigen bans van OneUptime die terugkomen, zijn Informational en openen er geen. Een waarschuwing die twee keer wordt gestuurd, zoals `cscli notifications reinject` doet, wordt één keer opgeslagen.

## Adressen blokkeren met CrowdSec

Zet **Adressen blokkeren met CrowdSec** aan op een verbinding, en de adressen en bereiken op de [blokkeerlijst](/docs/telemetry/security-cases#blokkeerlijst) van je project worden gebannen in CrowdSec. Elke bouncer die de Local API leest, zoals de firewall-, nginx- en Traefik-bouncers, blokkeert ze waar hij draait, zoals hij de eigen bans van CrowdSec blokkeert. Blokkeringen gaan door dezelfde goedkeuringen, dezelfde limieten van automatische reactie en hetzelfde **Opheffen** als op elke andere plek waar je blokkeerlijst wordt toegepast.

De schakelaar staat uit op een nieuwe verbinding. Zo zet je hem aan:

1. Voeg op de CrowdSec-host een machine voor OneUptime toe; het commando toont het wachtwoord ervan:

   ```bash
   sudo cscli machines add oneuptime --auto -f -
   ```

2. Laat OneUptime de Local API bereiken, die op `127.0.0.1:8080` luistert tenzij anders ingesteld: zet `api.server.listen_uri` in de `config.yaml` van CrowdSec, bied haar aan via TLS of achter een `https`-proxy, en laat de adressen van OneUptime door je firewall.
3. Bewerk de verbinding, vul **Local API-URL** en **Machine-ID** in, zet het wachtwoord in **Machinewachtwoord**, zet **Adressen blokkeren met CrowdSec** aan en sla op. **Verbinding testen** controleert daarna of de machine zich aanmeldt en de bans van OneUptime leest, zonder iets te wijzigen.

Hoe een ban ontstaat, en hoe hij eindigt:

- Elke blokkering is één ban-beslissing, gemaakt zoals `cscli decisions add` er een maakt, onder het scenario `oneuptime/blocklist`. CrowdSec bewaart haar als een handmatige beslissing, dus wordt ze nooit gedeeld met de Central API van CrowdSec, tenzij je handmatige beslissingen deelt. OneUptime leest en verwijdert alleen zijn eigen bans, nooit een die een persoon of CrowdSec heeft gemaakt.
- Een blokkering met een einde is een ban tot precies dat einde, en CrowdSec heft hem dan zelf op, of OneUptime het nu kan bereiken of niet. Een blokkering tot ze wordt opgeheven, is een ban van 7 dagen, die wordt verlengd zodra er 3 dagen of minder over zijn, zodat een ban die OneUptime niet meer bijhoudt binnen een week afloopt.
- **Opheffen** verwijdert de ban bij de volgende ronde, binnen een minuut. Een ban die in CrowdSec is verwijderd, met `cscli decisions delete` of een flush, wordt bij de volgende ronde opnieuw gemaakt zolang de blokkering duurt.
- Een adres of bereik op een van de allowlists van CrowdSec wordt nooit gebannen: de blokkering toont het daar als niet toegepast, met de naam van de allowlist, en een al gemaakte ban wordt verwijderd zodra een allowlist het adres bevat.
- De eigen adressen van je project, zoals je **Vertrouwde proxy's**, load balancers en edge-netwerken, worden nergens geblokkeerd, ook niet in CrowdSec.
- CrowdSec bant alleen: een challenge wordt daar niet toegepast, en een domein, een URL of een bestand wordt er niet naartoe gestuurd.

Als de Local API niet bereikbaar is, verandert er niets in CrowdSec: de bans die het heeft, blijven, en lopen af wanneer ze aflopen. **Toegepast bij** in de **Blokkeerlijst** zegt wanneer CrowdSec elke blokkering voor het laatst had, en OneUptime probeert het na 1 minuut opnieuw en wacht daarna elke keer twee keer zo lang, tot 30 minuten. Een nieuwe blokkering wacht tot ze kan worden gemaakt.

## De blokkeerlijsten van CrowdSec lezen

De CrowdSec Console levert de blokkeerlijsten waarop je organisatie is geabonneerd als een Raw IP List-integratie: één adres per regel, achter een gebruikersnaam en wachtwoord. Een [feed met dreigingsinformatie](/docs/telemetry/threat-intelligence) leest ze, en vergelijkt je gebeurtenissen ermee:

1. Maak in de CrowdSec Console een Raw IP List-integratie aan, met IP-aggregatie uit: OneUptime vergelijkt adressen, geen bereiken. Kopieer het endpoint, de gebruikersnaam en het wachtwoord ervan.
2. Open in OneUptime **Producten → Beveiligingsgebeurtenissen → Detecties → Dreigingsinformatie**, klik op **Feed met dreigingsinformatie aanmaken** en kies **Lijst van indicatoren**.
3. Plak het endpoint als **Lijst-URL**, kies **Gebruikersnaam en wachtwoord** onder **Aanmelden** en plak beide. Op het Community-abonnement van CrowdSec, dat één download per dag toestaat, zet je **Opvraaginterval (minuten)** op `1440`.

De lijsten zijn van CrowdSec: je mag ze in je eigen tools gebruiken, maar niet doorgeven. OneUptime biedt geen eigen lijst aan.

## Verbinding testen

**Verbinding testen** op de rij van een verbinding, en **Deze instellingen testen** in het formulier, draaien in het API-proces, niet in een achtergrondworker. Ze voeren deze controles uit, in volgorde:

| Controle | Wat ze controleert |
| --- | --- |
| **Configuratie** | De instellingen zijn allemaal leeg of allemaal ingevuld, en goed gevormd. Er wordt niets benaderd als dit mislukt. |
| **Reach CrowdSec's Local API** | `GET /health` antwoordt. Zonder ingestelde Local API zegt de controle dat de verbinding alleen waarschuwingen ontvangt, en de volgende drie draaien niet. |
| **Sign in to the Local API** | `POST /v1/watchers/login` accepteert de machine en haar wachtwoord. |
| **Read CrowdSec's allowlists** | `GET /v1/allowlists` antwoordt, en hoeveel adressen en bereiken ze bevatten. Een Local API ouder dan 1.6.8, die er geen heeft, slaagt. |
| **Block with CrowdSec** | Alleen met **Adressen blokkeren met CrowdSec** aan: de machine kan de bans van OneUptime teruglezen, en hoeveel er van kracht zijn. De controle wijzigt niets. |
| **Background workers**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, die opslaan wat CrowdSec stuurt, en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Alerts received** | Voor een opgeslagen verbinding: wanneer de laatste waarschuwing binnenkwam. Nog geen levert een waarschuwing op, met uitleg hoe je een testwaarschuwing stuurt. |

Een test bant of verwijdert nooit iets. **Rapport kopiëren** kopieert de controlelijst als JSON, zonder het wachtwoord of tokens.

## Problemen oplossen

De **Gezondheid** van de verbinding toont **Wacht op waarschuwingen** tot de eerste waarschuwing binnenkomt, daarna **Ontvangt waarschuwingen**, hoe lang de volgende ook duurt; **Zaken gepauzeerd** betekent dat de verbinding niet is ingeschakeld. CrowdSec schrijft wat de plug-in antwoordde naar zijn eigen log, `/var/log/crowdsec.log`, als `HTTP server returned non 200 status code`.

:::details Er komt geen waarschuwing binnen
- Voer `sudo cscli notifications list` uit: `oneuptime` moet in de lijst staan, en actief zijn in een profiel. Een melding die geen profiel noemt, stuurt niets.
- `401`: de ingestiesleutel in `x-oneuptime-token` ontbreekt, is onjuist of verlopen, en `422`: hij staat uit. Kies een sleutel in **Waarschuwingen verzenden**, en kopieer de melding opnieuw.
- `400`: het adres noemt geen CrowdSec-verbinding van dit project. Kopieer het adres uit **Waarschuwingen verzenden** van de verbinding: het eindigt op de ID van de verbinding.
- Helemaal niets in het log: de CrowdSec-host kan je OneUptime niet bereiken. Controleer het uitgaande HTTPS ervan, en de proxy ervan.
:::

:::details Verbinding testen mislukt bij Reach CrowdSec's Local API
`CrowdSec Local API health check could not be completed` betekent dat niets antwoordde: de Local API luistert standaard op `127.0.0.1`, dus OneUptime kan haar pas bereiken als `api.server.listen_uri` en je firewall dat toelaten. Een waarschuwing dat ze via `http` antwoordt, betekent dat het wachtwoord van de machine onversleuteld over het netwerk gaat: bied de Local API aan via TLS, of zet er een `https`-proxy voor.
:::

:::details Verbinding testen mislukt bij Sign in to the Local API
`CrowdSec Local API login failed (HTTP 401)` eindigt met wat je moet doen: controleer de machine-ID en het wachtwoord met `sudo cscli machines list`, valideer een machine die nog niet is gevalideerd met `sudo cscli machines validate oneuptime`, of voeg een machine toe die zich met een wachtwoord aanmeldt. Sla een nieuw wachtwoord op met **Inloggegevens bijwerken**.
:::

:::details Een blokkering wordt niet toegepast in CrowdSec
Beweeg de muis over het **Toegepast bij** ervan: het noemt een allowlist die het adres bevat, een challenge die CrowdSec niet toepast, of de fout van de Local API. Zolang de Local API niet bereikbaar is, blijft OneUptime het proberen, en de bans die CrowdSec al heeft, blijven van kracht.
:::

:::details CrowdSec stuurt zijn waarschuwingen, maar er wordt er geen opgeslagen
Wat CrowdSec stuurt, wordt opgeslagen door de achtergrondworkers: op een zelf gehoste installatie met `DISABLE_QUEUE_WORKERS=true` op de app en zonder aparte worker-deployment worden waarschuwingen aangenomen en nooit opgeslagen. **Verbinding testen** toont het als een mislukte controle **Background workers**. Zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`).
:::

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat CrowdSec stuurt.
- [Beveiligingszaken](/docs/telemetry/security-cases): Werk de zaken af die de detecties van CrowdSec openen, en blokkeer vanuit die zaken.
- [Dreigingsinformatie](/docs/telemetry/threat-intelligence): Vergelijk je gebeurtenissen met de blokkeerlijsten van CrowdSec.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
