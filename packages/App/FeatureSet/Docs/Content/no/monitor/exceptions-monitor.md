# Unntak-monitor

Unntaksovervåking lar deg overvåke applikasjonsunntak og feil, og utløser varsler når antallet unntak overskrider de konfigurerte tersklene. OneUptime evaluerer unntaksdata fra telemetritjenestene dine over et tidsvindu.

## Oversikt

Unntak-monitorer teller og filtrerer unntak som samsvarer med spesifikke kriterier. Dette gjør det mulig å:

- Varsle ved topper i unntak i applikasjonene dine
- Overvåke spesifikke unntakstyper
- Avgrense varsler til et utrullingsmiljø som `production`
- Søke etter unntak etter feilmelding
- Spore løste og aktive unntak separat
- Oppdage stabilitetsproblemer i applikasjoner fra feilmønstre

## Opprette en unntak-monitor

1. Gå til **Overvåkere** i OneUptime-dashbordet
2. Klikk **Opprett monitor**
3. Velg **Unntak** som monitortype
4. Velg telemetritjenestene som skal overvåkes
5. Konfigurer unntaksfiltre og kriterier etter behov

## Konfigurasjonsalternativer

### Telemetritjenester

Velg én eller flere tjenester det skal overvåkes unntak fra. Tjenester må sende unntaksdata til OneUptime via OpenTelemetry.

### Unntaksfiltre

| Filter           | Beskrivelse                                                                   | Påkrevd |
| ---------------- | ----------------------------------------------------------------------------- | ------- |
| Exception Types  | Filtrer etter unntakstypens navn (f.eks. `NullPointerException`, `TypeError`) | Nei     |
| Environments     | Filtrer etter utrullingsmiljø (f.eks. `production`, `staging`)                | Nei     |
| Message          | Tekstsøk i unntaksmeldinger                                                   | Nei     |
| Include Resolved | Inkluder unntak som er merket som løst (standard: false)                      | Nei     |
| Include Archived | Inkluder unntak som er arkivert (standard: false)                             | Nei     |
| Time Window      | Hvor langt tilbake det skal søkes etter unntak (i sekunder, standard: 60)     | Nei     |

### Miljøer

Miljøer hentes fra OpenTelemetry-ressursattributtet `deployment.environment` på hvert unntak, den samme verdien som unntaksutforskeren filtrerer på med `env:production`. Skriv inn ett miljø, eller flere atskilt med komma; et unntak telles når miljøet samsvarer med ett av dem.

Samsvaret må være eksakt og skiller mellom store og små bokstaver: `production` samsvarer ikke med `Production` eller `prod`. Unntak uten miljø telles ikke når dette filteret er satt. La det stå tomt for å telle unntak fra alle miljøer, inkludert unntak uten miljø.

Miljøfilteret kombineres med alle andre filtre, så en monitor som er avgrenset til én telemetritjeneste og `production`, teller bare produksjonsunntakene til den tjenesten.

Når du oppretter monitoren via API-et, setter du `environments` på stegets `exceptionMonitor` til en liste med miljønavn:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype    | Beskrivelse                                                 |
| --------------- | ----------------------------------------------------------- |
| Exception Count | Antall unntak som samsvarer med filtrene dine i tidsvinduet |

### Filtertyper

- **Greater Than** – Unntaksantallet overskrider en terskel
- **Less Than** – Unntaksantallet er under en terskel
- **Greater Than or Equal To** – Unntaksantallet er ved eller over en terskel
- **Less Than or Equal To** – Unntaksantallet er ved eller under en terskel
- **Equal To** – Unntaksantallet samsvarer nøyaktig
- **Not Equal To** – Unntaksantallet samsvarer ikke

### Eksempelkriterier

#### Varsle hvis mer enn 10 unntak på 60 sekunder

- **Tidsvindu**: 60 sekunder
- **Check On**: Exception Count
- **Filtertype**: Greater Than
- **Verdi**: 10

#### Varsle ved enhver NullPointerException

- **Unntakstyper**: `NullPointerException`
- **Tidsvindu**: 60 sekunder
- **Check On**: Exception Count
- **Filtertype**: Greater Than
- **Verdi**: 0

#### Varsle bare ved produksjonsunntak

- **Miljøer**: `production`
- **Tidsvindu**: 300 sekunder
- **Check On**: Exception Count
- **Filtertype**: Greater Than
- **Verdi**: 5

#### Overvåke unntak som inneholder en spesifikk melding

- **Melding**: `out of memory`
- **Tidsvindu**: 300 sekunder
- **Check On**: Exception Count
- **Filtertype**: Greater Than
- **Verdi**: 0

## Krav til oppsett

Unntaksovervåking krever at applikasjonene dine sender unntaksdata til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
