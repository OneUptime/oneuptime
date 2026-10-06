# Indgående opkaldspolitik (Twilio-integration)

Indgående opkaldspolitikker giver eksterne opkaldere mulighed for at nå dine vagtingeniører ved at ringe til et dedikeret telefonnummer. Når nogen ringer, dirigerer OneUptime opkaldet gennem dine konfigurerede eskaleringsregler, indtil en ingeniør svarer.

## Sådan fungerer det

```mermaid
flowchart TD
    A[Opkalder ringer<br/>Indgående opkaldsnummer] --> B[Twilio modtager opkald]
    B --> C[Twilio sender webhook<br/>til OneUptime]
    C --> D[OneUptime afspiller<br/>hilsenbesked]
    D --> E[Indlæs eskaleringsregler]
    E --> F{Regel 1:<br/>Prøv vagthavende bruger}
    F -->|Intet svar| G{Regel 2:<br/>Prøv reserveingeniør}
    F -->|Besvaret| H[Forbind opkalder<br/>til ingeniør]
    G -->|Intet svar| I{Regel 3:<br/>Prøv leder}
    G -->|Besvaret| H
    I -->|Intet svar| J[Afspil besked om<br/>intet svar og læg på]
    I -->|Besvaret| H
    H --> K[Opkald forbundet]
    K --> L[Opkald slutter]
    L --> M[Log opkaldsdetaljer]
```

## Opkaldsdirigieringsflow

```mermaid
sequenceDiagram
    participant Opkalder
    participant Twilio
    participant OneUptime
    participant VagtIngeniør

    Opkalder->>Twilio: Ringer til indgående opkaldsnummer
    Twilio->>OneUptime: POST /incoming-call/voice
    OneUptime->>Twilio: TwiML: Afspil hilsen
    Twilio->>Opkalder: "Vent venligst mens vi forbinder dig..."

    loop Eskaleringsregler
        OneUptime->>OneUptime: Hent næste eskaleringsregel
        OneUptime->>Twilio: TwiML: Ring til vagthavende bruger
        Twilio->>VagtIngeniør: Telefonen ringer
        alt Ingeniør svarer
            VagtIngeniør->>Twilio: Tager telefonen
            Twilio->>OneUptime: Opkaldsstatus: gennemført
            Twilio->>Opkalder: Forbind til ingeniør
            Note over Opkalder,VagtIngeniør: Opkald i gang
        else Intet svar (timeout)
            Twilio->>OneUptime: Opkaldsstatus: intet svar
            OneUptime->>OneUptime: Prøv næste regel
        end
    end

    alt Alle regler udtømt
        OneUptime->>Twilio: TwiML: Afspil besked om intet svar
        Twilio->>Opkalder: "Ingen er tilgængelig..."
        Twilio->>Opkalder: Læg på
    end
```

## Forudsætninger

- En Twilio-konto – Opret en på [https://www.twilio.com](https://www.twilio.com)
- Dit Twilio-konto-SID og Auth Token
- Adgang til din OneUptime selvhostede instans

## Oversigt

Funktionen Indgående opkaldspolitik fungerer ved at:

1. Modtage indgående opkald på et Twilio-telefonnummer
2. Afspille en tilpasselig hilsenbesked
3. Dirigere opkaldet gennem eskaleringsregler (vagtplaner eller personer)
4. Forbinde opkalderen til den første tilgængelige vagthavende ingeniør
5. Eskalere til den næste regel, hvis ingen svarer

Da du selvhoster OneUptime, skal du konfigurere din egen Twilio-konto. Dette giver dig fuld kontrol over dine telefonnumre og fakturering.

## Trin 1: Opret en Twilio-konto

1. Gå til [https://www.twilio.com](https://www.twilio.com) og opret en konto
2. Fuldfør verifikationsprocessen
3. Notér dit **Konto-SID** og **Auth Token** fra Twilio Console-dashboardet

## Trin 2: Konfigurer opkalds-/SMS-konfiguration i OneUptime

1. Log ind på dit OneUptime-dashboard
2. Gå til **Projektindstillinger** > **Notifikationer** > **Notifikationsindstillinger**
3. Klik på **Create Twilio Config** under **Twilio-konfiguration**
4. Udfyld følgende felter:
   - **Navn**: Et brugervenligt navn (f.eks. "Produktions-Twilio-konfiguration")
   - **Beskrivelse**: Valgfri beskrivelse
   - **Twilio Account SID**: Dit Twilio-konto-SID (starter med `AC`)
   - **Twilio Auth Token**: Dit Twilio Auth Token
   - **Twilio primært telefonnummer**: Et telefonnummer fra din Twilio-konto til udgående opkald
   - **Indstil som projektstandard**: slået til for projektets første Twilio-konfiguration, så SMS'er og opkald til projektmedlemmer også går gennem denne konto. Slå den fra, hvis kontoen kun er til indgående opkald.
5. Klik på **Gem**

## Trin 3: Opret en indgående opkaldspolitik

1. Gå til **Vagtordning** > **Indgående opkaldspolitikker**
2. Klik på **Opret indgående opkaldspolitik**
3. Udfyld følgende felter:
   - **Navn**: Et brugervenligt navn (f.eks. "Support-hotline")
   - **Beskrivelse**: Valgfri beskrivelse
4. Klik på **Gem**

## Trin 4: Tilknyt Twilio-konfiguration til politik

1. Åbn din nyoprettede indgående opkaldspolitik
2. Find **Trin 2: Tilknyt Twilio-konfiguration** i kortet **Telefonnummerdirigering**
3. Klik på **Vælg Twilio-konfiguration** og vælg den konfiguration, du oprettede i trin 2
4. Gem valget

## Trin 5: Konfigurer et telefonnummer

Du har to muligheder for at opsætte et telefonnummer:

### Mulighed A: Brug et eksisterende Twilio-telefonnummer

Hvis du allerede har telefonnumre i din Twilio-konto:

1. Klik på **Brug eksisterende nummer** i kortet **Telefonnummer**
2. OneUptime henter alle telefonnumre fra din Twilio-konto
3. Vælg det telefonnummer, du vil bruge
4. Klik på **Brug dette** for at tildele det til politikken

> **Bemærk**: Hvis telefonnummeret allerede har en webhook konfigureret, opdateres den til at pege på OneUptime.

### Mulighed B: Køb et nyt telefonnummer

For at købe et nyt telefonnummer direkte fra OneUptime:

1. Klik på **Køb nyt nummer** i kortet **Telefonnummer**
2. Vælg et **Land** fra rullelisten
3. Angiv valgfrit et **Retningsnummer** (f.eks. 45 for Danmark)
4. Angiv valgfrit cifre, som nummeret skal **Indeholde** (f.eks. 555)
5. Klik på **Søg** for at finde tilgængelige numre
6. Vælg et telefonnummer fra resultaterne
7. Klik på **Køb** for at købe nummeret

Telefonnummeret købes fra din Twilio-konto, og webhook'en **konfigureres automatisk** – ingen manuel opsætning er nødvendig!

```mermaid
flowchart LR
    A[Opret politik] --> B[Tilknyt Twilio-konfiguration]
    B --> C{Vælg telefonnummer<br/>mulighed}
    C -->|Eksisterende| D[Vælg fra<br/>Twilio-konto]
    C -->|Ny| E[Søg og køb<br/>nyt nummer]
    D --> F[Webhook konfigureret automatisk]
    E --> F
    F --> G[Tilføj eskaleringsregler]
    G --> H[Politik klar!]
```

## Trin 6: Konfigurer eskaleringsregler

Eskaleringsregler bestemmer, hvem der ringes til, når nogen ringer til politikkens nummer, fra toppen af listen og nedad:

1. Åbn din indgående opkaldspolitik
2. Gå til fanen **Eskaleringsregler**
3. Klik på **Tilføj eskaleringsregel**
4. Udfyld reglen. Det er ét trin:
   - **Hvem der skal ringes til**: en vagtplan eller én person. En vagtplan ringer til den, der har vagt i den, når opkaldet kommer ind. Personerne er medlemmerne af dit projekt.
   - **Ringetid (i sekunder)**: hvor længe deres telefon ringer, før opkaldet går videre til næste regel. Den starter på 20 sekunder, og Twilio tager 5 til 600.
   - **Navn** og **Beskrivelse** er valgfrie og ligger under **Flere felter**. En regel uden navn vises efter sin plads på listen: **Level 1**, **Level 2**.
5. Gem den, og tilføj en regel for hver vagtplan eller person, der skal prøves derefter

Reglerne ringes op fra toppen af listen og nedad, og en ny regel tilføjes nederst. Træk en regel i håndtaget øverst til venstre for at ændre rækkefølgen; fra tastaturet fokuserer du håndtaget, trykker på mellemrum, flytter reglen med piletasterne og trykker på mellemrum igen.

> **Husk telefonsvareren**: hold **Ringetid** kortere end den tid, det tager, før personens telefon sender et ubesvaret opkald til telefonsvareren. Hvis telefonsvareren svarer først, forbindes den, der ringer, til den, og opkaldet går ikke videre til næste regel. Twilio lægger selv et par sekunder til hver opringning. Derfor starter en ny regel på 20 sekunder. Regler, der blev tilføjet, da standarden var 30 sekunder, beholder deres 30: hvis deres opkald ender på telefonsvareren, så sænk **Ringetid** på de regler.

### Eksempel på eskaleringsregel

```mermaid
flowchart TD
    subgraph "Eskaleringskæde"
        A[Level 1: Primær vagtplan<br/>Ring i 20 sekunder] --> B[Level 2: Sekundær vagtplan<br/>Ring i 20 sekunder]
        B --> C[Level 3: Ingeniørleder<br/>Ring i 20 sekunder]
        C --> D[Besked om intet svar]
    end
```

| Niveau  | Hvem der skal ringes til  | Ringetid    |
| ------- | ------------------------- | ----------- |
| Level 1 | Primær vagtplan           | 20 sekunder |
| Level 2 | Sekundær vagtplan         | 20 sekunder |
| Level 3 | Ingeniørleder (en person) | 20 sekunder |

## Trin 7: Konfigurer stemmebeskeder (valgfrit)

Tilpas de beskeder, opkaldere hører:

1. Åbn din indgående opkaldspolitik
2. Gå til **Indstillinger**
3. Konfigurer:
   - **Velkomstbesked**: Afspilles, når opkaldet besvares
   - **Besked ved intet svar**: Afspilles, når alle eskaleringsregler fejler
   - **Besked ved ingen tilgængelige**: Afspilles, når ingen er på vagt

## Konfigurationsindstillinger

### Politikindstillinger

| Indstilling                                   | Beskrivelse                                 | Standard                                                                   |
| --------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| Hilsenbesked                                  | TTS-besked afspillet, når opkaldet besvares | "Vent venligst mens vi forbinder dig til vagthavende ingeniør."            |
| Besked om intet svar                          | Besked, når alle eskaleringsregler fejler   | "Ingen er tilgængelig. Prøv venligst igen senere."                         |
| Ingen vagthavende ingeniør tilgængelig-besked | Besked, når ingen er på vagt                | "Vi beklager, men ingen vagthavende ingeniør er i øjeblikket tilgængelig." |
| Gentag politik, hvis ingen svarer             | Genstart fra første regel, hvis alle fejler | Deaktiveret                                                                |
| Gentag politik antal gange                    | Maks. antal genforsøg                       | 1                                                                          |

### Eskaleringsregel-indstillinger

| Indstilling              | Beskrivelse                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hvem der skal ringes til | En vagtplan, der ringer til den, der har vagt i den, eller én person. Hver regel ringer til én af dem                                                     |
| Ringetid (i sekunder)    | Hvor længe telefonen ringer, før opkaldet går videre til næste regel (standard: 20; fra 5 til 600)                                                        |
| Navn og Beskrivelse      | Valgfrie, under Flere felter. En regel uden navn vises som Level 1, Level 2 og så videre efter sin plads på listen                                          |
| Rækkefølge               | Reglens plads på listen: reglerne ringes op fra toppen og nedad. Ændres ved at trække reglerne; via API'et lægges en ny regel uden rækkefølge nederst |

Via API'et angiver en regel `onCallDutyPolicyScheduleId` eller `userId` (én af dem, aldrig begge) og `escalateAfterSeconds`: ringetiden, 20 når den udelades.

## Visning af opkaldslogge

For at se historikken for indgående opkald:

1. Gå til **Vagtordning** > **Indgående opkaldspolitikker**
2. Klik på din politik
3. Gå til fanen **Opkaldslogs**

Loggene viser:

- Opkalderens telefonnummer
- Opkaldsstatus (Gennemført, Intet svar, Mislykket osv.)
- Hvem der besvarede opkaldet
- Opkaldsvarighed
- Tidsstempel

## Konfiguration af brugertelefonnummer

For at brugere kan modtage indgående opkald, skal de have et bekræftet telefonnummer:

1. Brugere går til **Brugerindstillinger** > **Notifikationsmetoder**
2. Tilføj et telefonnummer under **Indgående opkaldsnumre**
3. Bekræft telefonnummeret via SMS-kode

Kun brugere med bekræftede telefonnumre kan ringes op via eskaleringsregler.

## Frigørelse af et telefonnummer

Hvis du ikke længere har brug for et telefonnummer:

1. Åbn din indgående opkaldspolitik
2. Klik på **Frigiv nummer** i kortet **Telefonnummer**
3. Bekræft frigørelsen

> **Advarsel**: Frigivne numre returneres til Twilio og er muligvis ikke tilgængelige til genkøb.

## Fejlfinding

### Opkald modtages ikke

- Bekræft, at Twilio-konfigurationen er korrekt tilknyttet politikken
- Kontroller, at din OneUptime-instans er tilgængelig fra internettet
- Bekræft, at Twilio-konto-SID og Auth Token er korrekte
- Kontroller Twilio Console for fejllogge

### Opkald opretter ikke forbindelse til ingeniører

- Bekræft, at brugere har bekræftede telefonnumre i deres notifikationsindstillinger
- Kontroller, at eskaleringsregler er korrekt konfigureret
- Sørg for, at vagtplaner har brugere tildelt for den aktuelle tid
- Bekræft, at politikken er aktiveret
- Hvis opkald ender på en ingeniørs telefonsvarer, så sæt reglens **Ringetid** lavere end den tid, det tager, før deres telefon går på telefonsvareren

### Lydkvalitetsproblemer

- Sørg for, at din server har stabil internetforbindels
- Kontroller Twilios statusside for eventuelle igangværende problemer
- Bekræft, at telefonnumre er i det korrekte format (E.164-format: +4511223344)

## Sikkerhedsovervejelser

- Hold dit Twilio Auth Token sikkert og eksponér det aldrig offentligt
- Brug HTTPS til din OneUptime-instans
- OneUptime validerer webhook-signaturer for at sikre, at anmodninger kommer fra Twilio
- Overvej at begrænse, hvilke telefonnumre der kan ringe til dine indgående opkaldspolitikker

## Arkitekturoversigt

```mermaid
graph TB
    subgraph "Eksternt"
        A[Opkalder]
        B[Twilio Cloud]
    end

    subgraph "OneUptime"
        C[Indgående opkalds-API]
        D[Opkaldsrouter]
        E[Eskaleringsmotor]
        F[Database]
    end

    subgraph "Vagttjenesteteam"
        G[Ingeniør 1]
        H[Ingeniør 2]
        I[Leder]
    end

    A -->|1. Ringer til nummer| B
    B -->|2. Webhook| C
    C -->|3. Indlæs politik| F
    C -->|4. Hent regler| D
    D -->|5. Behandl regler| E
    E -->|6. TwiML-svar| B
    B -->|7. Ring til| G
    B -->|8. Eskaler| H
    B -->|9. Eskaler| I
```

## Support

For problemer med funktionen Indgående opkaldspolitik:

1. Kontroller Twilio Console for fejllogge
2. Gennemgå OneUptime-serverlogge
3. Kontakt support på [hello@oneuptime.com](mailto:hello@oneuptime.com)
