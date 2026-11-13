# SSL-certificaat-monitor

Een SSL-certificaatmonitor controleert de TLS-certificaten die uw sites en services tonen, zoals een browser dat doet, en waarschuwt u voordat ze verlopen. Hij zet de monitor ook offline wanneer een certificaat niet meer geldig is: verlopen, ingetrokken door de uitgever, zelfondertekend, uitgegeven voor een andere hostnaam, of door een instantie die browsers niet vertrouwen.

:::cards
- [De monitor maken](#een-ssl-certificaatmonitor-maken): Zes stappen in het dashboard.
- [Standaardcriteria](#standaardcriteria): Een waarschuwing 14 dagen voor het verlopen, zonder instellen.
- [Bewakingscriteria](#bewakingscriteria): Geldigheid, verlopen, intrekking en zelfondertekende certificaten.
- [Problemen oplossen](#problemen-oplossen): Zelfondertekende en interne certificaten, en de intrekkingscontrole.
:::

## Hoe het werkt

Bij elke controle opent een sonde een TLS-verbinding met de host en poort in de URL, poort `443` tenzij de URL een andere noemt, en controleert het certificaat zoals een browser dat zou doen: een vertrouwde uitgever, een hostnaam die overeenkomt en data die vandaag omvatten. Als het certificaat de controle niet doorstaat, leest de sonde het toch, zodat de vervaldatum, de uitgever en de vingerafdrukken hoe dan ook worden vastgelegd. Een verbinding die mislukt, een time-out krijgt of een ongeldig certificaat toont, wordt opnieuw geprobeerd, tot het aantal nieuwe pogingen dat u toestaat. Daarna beoordeelt OneUptime het resultaat met de criteria van de monitor.

Een certificaat dat die controles doorstaat, wordt ook op intrekking gecontroleerd, zoals een browser dat doet. De sonde leest het OCSP-antwoord dat de server met zijn certificaat meestuurt, als dat er is, vraagt daarna de OCSP-responder van de uitgever die in het certificaat staat en leest, alleen als die geen antwoord geeft, de certificaatintrekkingslijst (CRL) van de uitgever. Hij vertrouwt alleen een actueel antwoord dat is ondertekend door de uitgever of door een responder die de uitgever heeft gemachtigd, en hij controleert het eigen certificaat van de server, niet de tussencertificaten. Een ingetrokken certificaat is niet geldig. Als er geen ondertekend antwoord te krijgen is, is de intrekkingsstatus onbekend en wordt het certificaat, net als in een browser, niet als ingetrokken behandeld.

Een antwoord wordt bewaard tot de volgende update van de uitgever, hoogstens een uur, en een opvraging die mislukte wordt na 5 minuten opnieuw geprobeerd. Een nieuw certificaat wordt dus meteen gecontroleerd, en een certificaat dat wordt ingetrokken terwijl het in gebruik is, wordt binnen een uur opgemerkt.

```mermaid title="Hoe de standaardcriteria een certificaat beoordelen"
flowchart TB
    connect["TLS-handshake,<br/>gecontroleerd als een browser"] --> valid{"Geldig certificaat?"}
    valid -->|"Nee, of geen antwoord"| offline["Offline,<br/>incident gemeld"]
    valid -->|"Ja"| soon{"Verloopt binnen<br/>14 dagen?"}
    soon -->|"Ja"| alert["Waarschuwing,<br/>status ongewijzigd"]
    soon -->|"Nee"| ok["Operationeel"]
```

Een sonde die haar eigen netwerkverbinding kwijt is, meldt geen resultaat en kan uw certificaat dus niet als ongeldig markeren.

## Voordat u begint

- **Een rol die monitoren mag maken**: Project Owner, Project Admin, Project Member, Monitor Admin of Monitor Member, of een aangepaste rol met de machtiging Create Monitor.
- **Een sonde die de host en de poort kan bereiken.** De standaardsondes van uw project worden voor elke nieuwe monitor gekozen. Een service in een privénetwerk heeft een [aangepaste sonde](/docs/probe/custom-probe) in dat netwerk nodig.

## Een SSL-certificaatmonitor maken

:::steps
### Een nieuwe monitor beginnen

Ga naar **Monitoren** en klik op **Monitor maken**. Kies onder **Monitortype** het type **SSL-certificaat**.

### Hem een naam geven

Voer een **Naam** in, zoals `example.com certificate`, en klik op **Volgende**.

### De URL invoeren

Voer bij **Website-URL** de site in waarvan het certificaat moet worden gecontroleerd, zoals `https://example.com`. Neem voor een service op een andere poort die poort op: `https://example.com:8443`.

### Hem testen

Klik op **Monitor testen**, kies een sonde onder **Selecteer sonde** en klik op **Test uitvoeren**. **Testresultaat van monitor** toont het certificaat dat de sonde kreeg, met de uitgever en de vervaldatum.

### De criteria nakijken

**Criteria** begint met de [standaardcriteria](#standaardcriteria): offline wanneer het certificaat niet geldig is, een waarschuwing wanneer het binnen 14 dagen verloopt. Wijzig ze als dat nodig is en klik op **Volgende**.

### Sondes kiezen en maken

Behoud of wijzig de **Sondes** en het **Bewakingsinterval** (het begint bij **Elke 5 minuten**; voor SSL-certificaatmonitoren worden 5 minuten of langer aangeboden) en klik op **Monitor maken**. De pagina van de monitor wordt geopend.
:::

## Configuratieopties

| Veld | Standaard | Wat u invult |
| --- | --- | --- |
| **Website-URL** | Geen | De site waarvan het certificaat wordt gecontroleerd, zoals `https://example.com` of `https://example.com:8443`. Alleen de host en de poort worden gebruikt; het pad wordt genegeerd. |
| **Aanvraagtime-out (seconden)** (onder **Meer velden**) | `60` | Hoe lang bij elke poging op de TLS-handshake wordt gewacht. Het maximum is 60 seconden. |
| **Nieuwe pogingen bij mislukking** (onder **Meer velden**) | Standaard van de sonde, meestal `3` | Hoe vaak een mislukte poging opnieuw wordt geprobeerd. Het maximum is 3. |

**Nieuwe pogingen bij mislukking** telt de nieuwe pogingen _na_ de eerste, dus `0` voert de controle één keer uit en `2` tot drie keer. Leeg gelaten gebruikt het de standaard van de sonde: 3, tenzij `PROBE_MONITOR_RETRY_LIMIT` van de sonde iets anders zegt. Mislukte verbindingen, mislukte certificaatvalidaties en time-outs worden allemaal opnieuw geprobeerd, met een pauze van een seconde tussen de pogingen.

## Bewakingscriteria

Criteria bepalen wanneer het certificaat telt als in orde, verminderd of kapot, en of dat een incident meldt of een waarschuwing aanmaakt. Elk criterium controleert een of meer filters:

| Filter | Voorwaarden | Wat het controleert |
| --- | --- | --- |
| **Certificaat is geldig** | **Waar**, **Onwaar** | Het certificaat doorstaat de controles van een browser: een vertrouwde uitgever, een hostnaam die overeenkomt, data die vandaag omvatten en geen intrekking door de uitgever. **Onwaar** wanneer het eindpunt niet antwoordde. |
| **Certificaat is ongeldig** | **Waar**, **Onwaar** | Het tegenovergestelde van **Certificaat is geldig**: **Waar** wanneer het certificaat die controles niet doorstaat of niet kon worden gecontroleerd. |
| **Certificaat is verlopen** | **Waar**, **Onwaar** | De vervaldatum van het certificaat is verstreken. |
| **Certificaat is ingetrokken** | **Waar**, **Onwaar** | De uitgever van het certificaat heeft het ingetrokken. **Onwaar** wanneer de uitgever zegt dat het niet is ingetrokken, en wanneer dat niet kon worden gecontroleerd. |
| **Certificaat is zelfondertekend** | **Waar**, **Onwaar** | Het certificaat, of een certificaat in de keten, is zelfondertekend. |
| **Dagen tot verloop** | **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan** | Dagen totdat het certificaat verloopt. |
| **Uren tot verloop** | **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan** | Uren totdat het certificaat verloopt. |

**Dagen tot verloop** telt hele dagen: een certificaat dat over 14 dagen en 20 uur verloopt, heeft nog 14 dagen. **Uren tot verloop** telt hele uren op dezelfde manier.

Met twee of meer filters bepaalt **Overeenkomstvoorwaarde** of **Alle** filters moeten overeenkomen of dat **Minstens één** filter volstaat. De **Acties** van een criterium bepalen wat het doet: de monitorstatus wijzigen, een waarschuwing aanmaken, een incident melden, of meerdere daarvan.

### Standaardcriteria

Een nieuwe SSL-certificaatmonitor begint met drie criteria, zodat hij u zonder instellen waarschuwt voordat een certificaat verloopt:

1. **Certificaat is niet geldig** — het certificaat is verlopen, ingetrokken door de uitgever, zelfondertekend, uitgegeven voor een andere hostnaam of door een niet-vertrouwde instantie, of kon niet worden gecontroleerd omdat het eindpunt niet antwoordde. De monitor wordt als **Offline** gemarkeerd en er wordt een incident met de naam "_monitor name_ certificate is not valid" gemaakt. De hoofdoorzaak ervan zegt welk van deze gevallen het was en, bij een ingetrokken certificaat, wanneer en waarom de uitgever het heeft ingetrokken. Het incident lost zichzelf op zodra het certificaat weer geldig is.
2. **Certificaat verloopt binnenkort** — het certificaat is geldig, maar verloopt binnen 14 dagen. Er wordt een **waarschuwing** met de naam "_monitor name_ certificate expires soon" aangemaakt.
3. **Certificaat is geldig** — de monitor wordt als **Operationeel** gemarkeerd.

De waarschuwing "verloopt binnenkort" is een waarschuwing, geen incident: ze verschijnt niet op uw statuspagina's, ze roept niemand op tenzij u er een bereikbaarheidsbeleid aan toevoegt, en ze wijzigt de status van de monitor niet. Ze gebruikt de tweede waarschuwingsernst van uw project, **Laag** in een nieuw project. Zodra het vernieuwde certificaat wordt opgepikt, staat de monitor weer op "Certificaat is geldig" en lost de waarschuwing zichzelf op.

Criteria worden van boven naar beneden gecontroleerd, en het eerste dat overeenkomt bepaalt wat er gebeurt. Daarom staat "verloopt binnenkort" boven "is geldig": een certificaat dat bijna verloopt is nog geldig, en zou dus met beide overeenkomen.

Om eerder gewaarschuwd te worden, wijzigt u de waarde van het filter **Dagen tot verloop** in het criterium "verloopt binnenkort", bijvoorbeeld in `30`. Om in plaats daarvan iemand op te roepen, opent u de **Acties** van dat criterium: zet **Wanneer filters overeenkomen, verklaar een incident.** aan, of houd de waarschuwing en voeg er onder **Bereikbaarheidsbeleid** een bereikbaarheidsbeleid aan toe.

:::details De waarschuwing toevoegen aan een monitor die van vóór de waarschuwing is
Monitoren die zijn gemaakt voordat OneUptime deze waarschuwing toevoegde, hebben geen criterium "verloopt binnenkort". Zo voegt u het toe:

1. Open bij de monitor **Configuratie → Criteria** en klik op **Criteria bewerken**.
2. Klik op **Criteria toevoegen**. Zet het filter op **Certificaat is geldig** / **Waar**, klik op **Filter toevoegen** en zet het tweede op **Dagen tot verloop** / **Kleiner dan of gelijk aan** / `14`. Laat **Overeenkomstvoorwaarde** op **Alle** staan (het verschijnt onder de filters zodra er twee zijn).
3. Zet onder **Acties** **Wanneer filters overeenkomen, maak een waarschuwing aan.** aan en laat **Wanneer filters overeenkomen, wijzig de monitorstatus.** uit, zodat het een waarschuwing aanmaakt en de monitorstatus niet wijzigt.
4. Sleep het nieuwe criterium boven het criterium dat de monitor als online markeert, en sla op.
:::

### Voorbeeldcriteria

| Doel | Filter | Voorwaarde | Waarde |
| --- | --- | --- | --- |
| Een maand van tevoren waarschuwen | **Dagen tot verloop** | **Kleiner dan of gelijk aan** | `30` |
| Iemand op de laatste dag oproepen | **Uren tot verloop** | **Kleiner dan** | `24` |
| Pas offline wanneer het certificaat verlopen is | **Certificaat is verlopen** | **Waar** | — |
| Een zelfondertekend certificaat markeren | **Certificaat is zelfondertekend** | **Waar** | — |
| Het securityteam oproepen wanneer de uitgever het certificaat intrekt | **Certificaat is ingetrokken** | **Waar** | — |

Een criterium over het verlopen moet boven het criterium staan dat het certificaat als geldig markeert: een certificaat dat bijna verloopt is nog geldig, en het eerste criterium dat overeenkomt wint. Op dezelfde manier is een ingetrokken certificaat ook niet geldig, dus een criterium met **Certificaat is ingetrokken** moet boven het criterium "niet geldig" staan.

## Aanbevolen werkwijzen

1. **Geef uzelf tijd om te vernieuwen** — De standaardwaarschuwing komt 14 dagen voor het verlopen, wat past bij certificaten die zichzelf vernieuwen. Duurt vernieuwen bij u langer (een gekocht certificaat, of een wijzigingsproces), verhoog het dan naar 30 dagen.
2. **Bewaak elk eindpunt** — Hebt u meerdere domeinen of subdomeinen, maak dan voor elk een monitor. Elk kan zijn eigen certificaat hebben.
3. **Denk aan andere poorten** — Services die TLS op een andere poort dan `443` aanbieden, zoals `8443`, hebben ook certificaten. Zet de poort in de URL.
4. **Controleer na het vernieuwen** — Controleer na het vernieuwen van een certificaat het volgende resultaat van de monitor: de getoonde vervaldatum moet de nieuwe zijn.

## Problemen oplossen

:::details Het certificaat is in orde in mijn browser, maar de monitor zegt dat het niet geldig is
De hoofdoorzaak van het incident zegt waarom. Een veelvoorkomende reden is een server die zijn certificaat zonder de tussencertificaten verstuurt: browsers vullen het gat vaak zelf, de sonde niet. Configureer de server zo dat hij de volledige keten verstuurt. Een andere is een URL waarvan de hostnaam niet op het certificaat staat.
:::

:::details Ik bewaak een interne service met een zelfondertekend certificaat
Een zelfondertekend certificaat is nooit geldig, dus de standaardcriteria houden de monitor offline. **Certificaat is zelfondertekend**, **Certificaat is verlopen** en **Dagen tot verloop** werken er nog wel voor, dus bouw de criteria daarop. Onder **Configuratie → Criteria**:

1. Klik in het criterium "niet geldig" op **Filter toevoegen**, zet het nieuwe filter op **Certificaat is zelfondertekend** / **Onwaar** en zet **Overeenkomstvoorwaarde** op **Alle**. Het criterium zet de monitor nog steeds offline wanneer het eindpunt niet antwoordt, of het certificaat op een andere manier fout is.
2. Voeg een criterium toe met **Certificaat is verlopen** / **Waar** dat de monitor als **Offline** markeert en een incident meldt, en sleep het naar boven.
3. Vervang in het criterium "verloopt binnenkort" **Certificaat is geldig** / **Waar** door **Certificaat is verlopen** / **Onwaar**, zodat de waarschuwing ook het zelfondertekende certificaat dekt.

Zolang het certificaat actueel is, komt geen enkel criterium overeen en toont de monitor zijn standaardstatus, **Operationeel**.
:::

:::details De monitor is offline met "could not be checked because the endpoint is not reachable"
De sonde kon geen TLS-verbinding met de host en poort openen. Controleer de poort in de URL, en of een firewall de sondes doorlaat. Een host in een privénetwerk heeft een [aangepaste sonde](/docs/probe/custom-probe) nodig.
:::

:::details De intrekkingsstatus van het certificaat kon niet worden gecontroleerd
Als de sonde geen ondertekend antwoord van de uitgever van het certificaat kan krijgen, toont de samenvatting van de monitor **Intrekkingsstatus** als **Kon niet worden gecontroleerd**, en **Probleem bij intrekkingscontrole**, onder **Meer details weergeven**, zegt waarom: het certificaat noemt geen OCSP-responder of CRL, de uitgever antwoordde niet op tijd, of zijn antwoord kon niet worden geverifieerd. Net als in een browser wordt zo'n certificaat niet als ingetrokken behandeld, en de sonde vraagt het na 5 minuten opnieuw.

Een [aangepaste sonde](/docs/probe/custom-probe) zonder internettoegang kan geen enkele uitgever bereiken. Hij controleert certificaten toch: hij wacht enkele seconden op elke responder die hij niet bereikt, ongeveer eens per 5 minuten. Zet `PROBE_CERTIFICATE_REVOCATION_CHECK_ENABLED` op de sonde op `false` en start hem opnieuw om hem te laten stoppen met vragen.
:::

## Volgende stappen

:::cards
- [Website-monitor](/docs/monitor/website-monitor): Controleren of de site zelf antwoordt.
- [Domein-monitor](/docs/monitor/domain-monitor): Gewaarschuwd worden voordat de registratie van het domein verloopt.
- [Escalatieregels](/docs/on-call/escalation-rules): Bepalen wie door de waarschuwingen en incidenten wordt opgeroepen.
- [Incidenten – Overzicht](/docs/incidents/index): Wat er gebeurt nadat de monitor er een heeft gemeld.
:::
