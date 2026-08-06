# Unntak-monitor

Unntaksovervåking lar deg overvåke applikasjonsunntak og feil, og utløser varsler når antallet unntak overskrider de konfigurerte tersklene. OneUptime evaluerer unntaksdata fra telemetritjenestene dine over et tidsvindu.

## Oversikt

Unntak-monitorer teller og filtrerer unntak som samsvarer med spesifikke kriterier. Dette gjør det mulig å:

- Varsle ved topper i unntak i applikasjonene dine
- Overvåke spesifikke unntakstyper
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
| Message          | Tekstsøk i unntaksmeldinger                                                   | Nei     |
| Include Resolved | Inkluder unntak som er merket som løst (standard: false)                      | Nei     |
| Include Archived | Inkluder unntak som er arkivert (standard: false)                             | Nei     |
| Time Window      | Hvor langt tilbake det skal søkes etter unntak (i sekunder, standard: 60)     | Nei     |

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

#### Overvåke unntak som inneholder en spesifikk melding

- **Melding**: `out of memory`
- **Tidsvindu**: 300 sekunder
- **Check On**: Exception Count
- **Filtertype**: Greater Than
- **Verdi**: 0

## Krav til oppsett

Unntaksovervåking krever at applikasjonene dine sender unntaksdata til OneUptime via OpenTelemetry. Se dokumentasjonen for [OpenTelemetry](/docs/telemetry/open-telemetry) for instruksjoner om oppsett.
