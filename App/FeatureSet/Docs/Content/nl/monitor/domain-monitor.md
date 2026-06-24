# Domein Monitor

Domeinmonitoring stelt u in staat de registratiestatus en vervaldatum van uw domeinnamen te bewaken. OneUptime voert periodiek WHOIS-opzoekopdrachten uit om de gezondheid van uw domein bij te houden en u te waarschuwen voordat het verloopt.

## Overzicht

Domeinmonitors bevragen WHOIS-gegevens voor uw domeinen om registratiedetails bij te houden. Hiermee kunt u:

- Vervaldata van domeinen bewaken
- Verlopen of binnenkort vervallende domeinen detecteren
- Informatie van domeinregistrar bijhouden
- Naamserverconfiguratie verifiëren
- Domeinstatuscodes bewaken

## Een Domein Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Domein** als het monitortype
4. Voer de domeinnaam in die u wilt bewaken
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Basisinstellingen

| Veld       | Beschrijving                                | Vereist |
| ---------- | ------------------------------------------- | ------- |
| Domeinnaam | Het te bewaken domein (bijv. `example.com`) | Ja      |

### Geavanceerde instellingen

| Veld            | Beschrijving                              | Standaard |
| --------------- | ----------------------------------------- | --------- |
| Time-out (ms)   | Hoe lang te wachten op een WHOIS-antwoord | 10000     |
| Nieuwe pogingen | Aantal nieuwe pogingen bij mislukking     | 3         |

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw domein als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype                    | Beschrijving                                      |
| ------------------------------- | ------------------------------------------------- |
| Domein verloopt over (in dagen) | Aantal dagen totdat de domeinregistratie verloopt |
| Domeinregistrar                 | De naam van de domeinregistrar                    |
| Domein-naamserver               | Naamserverhostnamen voor het domein               |
| Domeinstatuscode                | WHOIS-domeinstatuscodes                           |
| Domein is verlopen              | Of het domein is verlopen                         |

### Filtertypen

Voor **Domein is verlopen**:

- **True** — Domein is verlopen
- **False** — Domein is niet verlopen

Voor **Domein verloopt over (in dagen)**:

- **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan**, **Gelijk aan**, **Niet gelijk aan**

Voor **Domeinregistrar**, **Domein-naamserver** en **Domeinstatuscode**:

- **Bevat** — Waarde bevat de opgegeven tekst
- **Bevat niet** — Waarde bevat de opgegeven tekst niet
- **Begint met** — Waarde begint met de opgegeven tekst
- **Eindigt met** — Waarde eindigt met de opgegeven tekst
- **Gelijk aan** — Waarde komt exact overeen
- **Niet gelijk aan** — Waarde komt niet overeen

### Voorbeeldcriteria

#### Melding als domein binnen 30 dagen verloopt

- **Controleer op**: Domein verloopt over (in dagen)
- **Filtertype**: Kleiner dan
- **Waarde**: 30

#### Als offline markeren als domein verlopen is

- **Controleer op**: Domein is verlopen
- **Filtertype**: True

#### Verifieer dat naamservers correct zijn

- **Controleer op**: Domein-naamserver
- **Filtertype**: Bevat
- **Waarde**: `ns1.example.com`

## Best practices

1. **Stel vroege waarschuwingen in** — Configureer gedegradeerde meldingen bij 60 dagen en offline-meldingen bij 14 dagen voor vervaldatum
2. **Bewaken alle kritieke domeinen** — Voeg primaire domeinen, afzonderlijk geregistreerde subdomeinen en domeinen voor e-mail of API's toe
3. **Bijhouden van registrarwijzigingen** — Bewaken het registrarveld om ongeautoriseerde domeinoverdrachten te detecteren
