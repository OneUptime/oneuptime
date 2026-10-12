# Trusseletterretning (STIX/TAXII)

En threat intel-feed henter kjente ondsinnede IP-adresser, domener, URL-er, e-postadresser og filhasher inn i OneUptime, og forteller deg når [sikkerhetshendelsene](/docs/telemetry/security-events) dine nevner en av dem. Hver feed abonnerer på én TAXII 2.1-samling med STIX 2.1-indikatorer: din egen MISP-, OpenCTI- eller OpenTAXII-server, eller samlingen til en leverandør. OneUptime leverer ikke noe feedinnhold selv: du tar med samlingene, slik du tar med Sigma-reglene.

:::cards
- [Abonner på en feed](#abonner-på-en-feed): En TAXII-server, en samling og hvordan du logger på.
- [Hva som tas inn](#hva-som-tas-inn): Indikatormønstrene OneUptime beholder, og hvor lenge.
- [Slik finnes treff](#slik-finnes-treff): Merket når hendelser kommer inn, og sammenlignet hvert minutt.
- [Trusselnivåer](#trusselnivåer): Hvordan en indikators confidence blir en alvorlighetsgrad.
:::

## Slik fungerer det

```mermaid title="Fra en TAXII-samling til et varsel"
flowchart TB
    taxii["TAXII 2.1-samling"] -->|"Hentes med feedens<br/>intervall"| indicators["Indikatorer: IP-er,<br/>domener, URL-er,<br/>e-poster, hasher"]
    events["Nye<br/>sikkerhetshendelser"] --> tag["Merket ved<br/>ankomst med<br/>threat.*-attributter"]
    indicators --> tag
    indicators --> match["Sammenlignet hvert<br/>minutt med nylige<br/>hendelser"]
    match --> act["Et varsel, en eventuell<br/>hendelse og et funn"]
```

## Før du begynner

- En TAXII 2.1-server som publiserer STIX 2.1-objekter av typen `indicator`, og ID-en til samlingen som skal hentes. En feed logger på anonymt, med et bearer-token eller med HTTP Basic-autentisering.
- Servere som krever et TLS-klientsertifikat (mutual TLS), for eksempel CISA AIS, støttes ikke. MITREs offentlige ATT&CK-server publiserer teknikker og grupper i stedet for indikatorer, så en feed som peker dit, forblir tom.
- En rolle som kan opprette feeder: Project Owner, Project Admin, Security Admin eller Security Member. Security Viewer kan lese feeder og indikatorer. Se [Roller](/docs/permissions/reference#roller).

## Abonner på en feed

:::steps
### Gå til Threat Intel

Åpne **Produkter → Security Events → Threat Intel**.

### Opprett feeden

Klikk på **Opprett Threat Intel Feed**, og fyll ut de fire stegene: **Grunnleggende informasjon**, **TAXII Server**, **Autentisering** og **Ved treff**. Feltene står i tabellen nedenfor.

### Sjekk den første hentingen

I løpet av et minutt eller to viser feedens rad **Last Polled**, og **Last Poll Summary** forteller hva hentingen fikk med seg. Indikatorene vises i tabellen **Indicators** under feedene.
:::

| Felt | Hva du skal fylle inn |
| --- | --- |
| **TAXII API Root URL** | Serverens TAXII 2.1-API-rot, for eksempel `https://taxii.example.com/api1/`. Samlingene adresseres under den. |
| **Collection ID** | Samlingen som publiserer indikatorene. |
| **Poll Interval (Minutes)** | Hvor ofte nye objekter hentes: 1 til 1440 minutter, 60 som standard. |
| **Minimum Confidence** | Indikatorer med lavere STIX-`confidence` hoppes over: 0 til 100, og 0 beholder alt. Indikatorer uten confidence slipper alltid gjennom. |
| **API Token** | Et bearer-token, for en samling som ber om det. |
| **Basic Auth Username** og **Basic Auth Password** | For en samling som bruker HTTP Basic-autentisering. La begge og tokenet stå tomme for en offentlig samling. |
| **Create Alert on Match** | På som standard: hver indikator som treffer, åpner et varsel. |
| **Varselsalvor** | Alvorlighetsgraden til hvert varsel denne feeden åpner. La den stå tom for å bruke trusselnivået til hver indikator. |
| **Create Incident on Match** | Av som standard. Hendelser (incidents) driver vakteskalering, SLA-er og statussider, og for indikatortreff er varsler som regel nok. |
| **Hendelsesalvor** | Som **Varselsalvor**, for hendelser (incidents). |
| **Write Detection Finding on Match** | På som standard: hvert treff skriver et funn inn i hendelsesstrømmen. |

Tokener og passord krypteres og vises aldri igjen etter at du har lagret dem. For å endre dem velger du **Update Credentials** i feedens rad og deretter **API Token (Bearer)**, **Basic Auth** eller **Anonymous (clear stored credentials)**: valget ditt erstatter feedens pålogging, så å lagre et token fjerner et lagret passord, og omvendt.

### Slik hentes en feed

Hver henting ber om objektene som er lagt til siden forrige gang, gjennom TAXII-markøren `added_after`, og leser opptil 10 sider med 500 objekter. En stor samling synkroniseres derfor over flere hentinger: **Last Poll Summary** sier fra når det gjenstår flere sider. For å bli ferdig med en stor første synkronisering raskere senker du **Poll Interval (Minutes)**, helt ned til 1, til den har tatt igjen.

Hentingene presenterer seg med brukeragenten `OneUptime/<version> (+https://oneuptime.com)`. Hvis leverandørens brannmur svarer `403`, be dem om å tillate den: mange brannmurer blokkerer forespørsler som ser ut som et navnløst skript.

En deaktivert feed hentes ikke og sammenlignes ikke. Indikatorene den allerede har, fortsetter å merke nye hendelser til de utløper.

## Hva som tas inn

OneUptime beholder STIX-objekter av typen `indicator` der mønsteret er ren likhet på en av disse typene:

| Type | Eksempelmønster |
| --- | --- |
| IPv4-adresse (`ipv4-addr`) | `[ipv4-addr:value = '198.51.100.7']` |
| IPv6-adresse (`ipv6-addr`) | `[ipv6-addr:value = '2001:db8::7']` |
| Domenenavn (`domain-name`) | `[domain-name:value = 'evil.example']` |
| URL (`url`) | `[url:value = 'http://evil.example/payload']` |
| E-postadresse (`email-addr`) | `[email-addr:value = 'billing@evil.example']` |
| Filhash, SHA-256 (`file-hash-sha256`) | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| Filhash, SHA-1 (`file-hash-sha1`) | `[file:hashes.'SHA-1' = 'da39…0709']` |
| Filhash, MD5 (`file-hash-md5`) | `[file:hashes.MD5 = 'd41d…427e']` |

Sammenligninger som er koblet med `OR`, innenfor én `[...]` eller på tvers av flere, går fint, og hver verdi blir en egen indikator:

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

Alle andre mønstre, med `AND`, `FOLLOWEDBY`, `NOT`, `LIKE`, `MATCHES`, en tidsbetingelse som `WITHIN`, eller en annen objekttype, hoppes over i sin helhet og telles som ikke støttet i **Last Poll Summary**. Å oversette bare en del av et `AND`-mønster ville treffe langt mer enn feedens forfatter mente.

### Hvor lenge en indikator er aktiv

- En indikator treffer fra `valid_from` til `valid_until`. Uten `valid_until` er den aktiv i 365 dager fra `valid_from`, og en ny henting forlenger ikke det.
- En tilbakekalt indikator, eller en som er oppdatert med en `valid_until` i fortiden, slutter å treffe så snart oppdateringen er hentet. Det samme gjelder en verdi som leverandøren fjerner fra et oppdatert mønster.
- Verdier lagres med små bokstaver og treffer uansett store og små bokstaver.

Tabellen **Indicators** viser indikatorene slik de er lagret, med en **Status** som er **Aktiv**, **Utløpt** eller **Revoked**. En indikator som er hentet på nytt, kan vises to ganger en stund, og en utløpt eller tilbakekalt rad blir stående i listen til lageropprydningen fjerner den, opptil omtrent en måned etter at den utløper. Sammenligningen sjekker alltid gyldighet og tilbakekalling, så en slik rad treffer aldri.

## Slik finnes treff

### Merket når hendelser kommer inn

Hver innkommende sikkerhetshendelse, fra inntaks-API-et eller en tilkobling, sjekkes mot de aktive indikatorene dine før den lagres. Når en av observablene (IP-ene, vertene, domenene, hashene og brukerne hentet fra hendelsen) er lik verdien til en indikator, stemples hendelsen med disse attributtene:

| Attributt | Verdi |
| --- | --- |
| `threat.matched` | Alltid `"true"` på en merket hendelse |
| `threat.indicator_id` | ID-en til STIX-indikatoren |
| `threat.indicator_type` | Indikatorens type, for eksempel `ipv4-addr` eller `file-hash-sha256` |
| `threat.indicator_value` | Verdien som traff, med små bokstaver |
| `threat.feed` / `threat.feed_id` | Feeden indikatoren kom fra |
| `threat.confidence` | Indikatorens STIX-confidence |
| `threat.match_count` | Hvor mange av hendelsens observables som traff en indikator |

Når flere indikatorer treffer én hendelse, er det den med høyest confidence som fyller ut disse verdiene. De er vanlige attributter, så du kan søke på dem under **Hendelser**, filtrere monitorer for sikkerhetshendelser med dem og bruke dem i deteksjonsregler:

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

Merkingen kjenner bare indikatorene som finnes når en hendelse kommer inn: hendelser merkes aldri på nytt senere.

### Sammenlignet hvert minutt

Hvert minutt sammenlignes de aktive indikatorene til hver aktiverte feed med hendelsene der hendelsestidspunktet ligger etter feedens forrige sjekk. Det fanger opp etterretning som kom etter at en hendelse ble merket.

- Den første sjekken dekker de siste 15 minuttene. Etter et avbrudd tar neste sjekk igjen høyst de siste 24 timene.
- Hvert vindu sjekkes én gang. Etterretning som kommer etter at vinduet er sjekket, gjelder bare for senere hendelser.
- En hendelse som kommer sent, med et tidspunkt fra før forrige sjekk, merkes fortsatt når den kommer inn, men sammenlignes ikke.
- Hver sjekk sammenligner høyst 100 indikatorverdier per feed: de som finnes i flest hendelser.

### Hva et treff gjør

- Et varsel med tittelen `[Threat Intel] <feed name> — <indicator value>`, ett per feed og verdi så lenge det er åpent. Når det er løst, åpner neste treff et nytt. Varsler løses ikke automatisk.
- En hendelse (incident), bare med **Create Incident on Match**, deduplisert på samme måte.
- Et Threat Intel-funn, med **Write Detection Finding on Match**: en hendelse `Detection Finding` (OCSF-klasse 2004) fra produktet `OneUptime Threat Intel`, med indikatorens trusselnivå som alvorlighetsgrad, og disse attributtene:

| Attributt | Verdi |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | Feeden |
| `oneuptime.threat.indicator_id` | ID-en til STIX-indikatoren |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | Det som traff |
| `oneuptime.threat.confidence` | Indikatorens confidence |
| `oneuptime.threat.match_count` | Hvor mange hendelser som ligger bak dette funnet |

Funn sammenlignes aldri selv, så ett treff kan ikke utløse et annet.

## Trusselnivåer

Indikatorer har ikke noe Sigma-nivå: STIX-`confidence` gir dem i stedet et trusselnivå.

| Indikatorens confidence | Trusselnivå |
| --- | --- |
| 90 til 100 | Critical |
| 70 til 89 | High |
| 40 til 69 | Medium |
| 1 til 39 | Low |
| Uten poengsum (0 eller mangler) | Medium |

En indikator uten poengsum teller som Medium: noen valgte likevel å legge den i en feed. Trusselnivået er funnets alvorlighetsgrad, og velger varselets alvorlighetsgrad blant prosjektets alvorlighetsgrader, i denne rekkefølgen:

1. Feedens **Varselsalvor** (eller **Hendelsesalvor**), når den er angitt: den gjelder for hvert treff fra feeden.
2. Alvorlighetsgraden din som er oppkalt etter trusselnivået, for eksempel High, uansett store og små bokstaver.
3. Etter rang: Critical og High får den alvorligste alvorlighetsgraden din, Medium og Low den minst alvorlige.

Trusselnivået hører til hver indikator, ikke til feeden, så én feed kan åpne et Critical-varsel og et Low-varsel i samme minutt. **Minimum Confidence** filtrerer på det samme tallet: et minimum på 70 beholder bare High- og Critical-indikatorer, pluss de uten poengsum, som alltid slipper gjennom.

## Følg med på treffene til en feed

Handlingen **Opprett monitor** i raden til en feed åpner en ny monitor for sikkerhetshendelser som teller feedens funn: hendelsesklassen `Detection Finding`, filtrert på feedens ID i `oneuptime.threat.feed_id` (aldri navnet, som et nytt navn ville endre), over den siste timen. Bruk den for en plutselig bølge av treff, eller for en travel feed som blir stille.

## Oppbevaring og fakturering

Indikatorer er konfigurasjon, ikke telemetri, og faktureres ikke som innhentede data. Funnene et treff skriver, er vanlige sikkerhetshendelser, som faktureres og oppbevares som resten: se [Sikkerhetshendelser](/docs/telemetry/security-events#oppbevaring-og-fakturering).

## Feilsøking

:::details Last Error er satt etter en henting
`401` eller `403`: legitimasjonen er feil eller mangler; erstatt den med **Update Credentials**. En `403` kan også være leverandørens brannmur som blokkerer brukeragenten. `404`: sjekk **TAXII API Root URL**, som vanligvis slutter med en sti som `/api1/`, og **Collection ID**. Feilen forsvinner ved neste vellykkede henting.
:::

:::details Feeden hentes, men ingen indikatorer vises
Les **Last Poll Summary**. Ingen objekter hentet: samlingen er tom eller publiserer ingen indikatorer. Mønstre som ikke støttes: leverandøren bruker mønsterfunksjoner som denne siden oppgir som hoppet over. Under minimum confidence: senk **Minimum Confidence**. Allerede inaktive: leverandøren sendte indikatorer som allerede var tilbakekalt eller utløpt.
:::

:::details Det finnes indikatorer, men ingenting treffer
Sammenligningen sammenligner en indikators verdi med en hendelses observables, ikke med hvert felt: åpne en hendelse du forventet at skulle treffe, under **Hendelser**, og sjekk at observablene inneholder verdien. Bare indikatorer med statusen **Aktiv** treffer. Sjekk **Last Match Error** på feeden.
:::

:::details Et treff åpnet ikke noe varsel
**Create Alert on Match** er av, eller et varsel for den samme feeden og verdien er fortsatt åpent, og senere treff legges inn i det. Et prosjekt må ha minst én varselalvorlighetsgrad for at en feed skal kunne åpne varsler.
:::

## Neste steg

:::cards
- [Sikkerhetshendelser](/docs/telemetry/security-events): Send hendelser, søk i dem og skriv deteksjonsregler.
- [Google SecOps](/docs/integrations/google-secops): Hent inn deteksjonene og hendelsene fra Chronicle.
- [Tillatelsesreferanse](/docs/permissions/reference): Security-rollene, og hva hver av dem kan gjøre.
:::
