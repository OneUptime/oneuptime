# Inventar – Oversigt

Inventaret er én liste over alt, hvad OneUptime ved om dit miljø: tjenester, værter, Kubernetes-objekter, virtuelle maskiner, netværksenheder, cloudressourcer, IoT-enheder, serverless-funktioner og de ting, der slet ikke sender telemetri. Det meste udfylder sig selv ud fra det, OneUptime allerede holder øje med. Du tilføjer det, som overvågning ikke kan fortælle: hvad en ting er til, hvem der ejer den, hvornår garantien udløber. I [Ordliste](/docs/introduction/glossary#det-du-overvåger) kan du se, hvad hver slags post i inventaret er.

:::cards
- [Sådan kommer elementer ind i inventaret](#sådan-kommer-elementer-ind-i-inventaret): Fundet, spejlet eller tilføjet af dig.
- [Find rundt](#find-rundt): Inventarets sider og hvert elements egne sider.
- [Importer enheder fra Esper](#importer-enheder-fra-esper): Alle Android-enheder, som din Esper-lejer tilmelder, holdt ajour.
- [Tilføj noget manuelt](#tilføj-noget-manuelt): En tredjeparts-API, en ekstern database eller en appliance.
- [Arkiver i stedet for at slette](#arkiver-i-stedet-for-at-slette): Den måde at rydde op i listen på, der holder.
:::

## Sådan kommer elementer ind i inventaret

OneUptime holder allerede øje med dit miljø for at overvåge det, så kataloget bygges ud fra det, det ser, og ikke ud fra det, nogen huskede at skrive ind. Hvert element har en kilde, og kilden afgør, hvem der ejer elementet: om du kan redigere det, og om det kan forsvinde af sig selv.

```mermaid title="Tre veje ind i én liste"
flowchart TB
    T["Din<br/>telemetri"] -->|"Discovered"| I["Inventar: ét element<br/>pr. ting, med en<br/>stabil identitetsnøgle"]
    R["OneUptimes<br/>pollere"] -->|"Spejlet hvert<br/>15. minut"| I
    Y["Ting uden<br/>telemetri"] -->|"Tilføjet af dig"| I
    I --> L["All Items, topologi-<br/>kortet og elementsiderne"]
    I --> X["Brugerdefinerede felter,<br/>CSV-eksporten og API'et"]
```

| Kilde | I API'et | Hvor det kommer fra | Hvor længe det bliver |
| --- | --- | --- | --- |
| **Opdaget** | `discovered` | OpenTelemetry-ressourceattributter, læst efterhånden som telemetri ankommer: en tjeneste, vært, et Kubernetes-objekt eller en virtuel maskine, der sender telemetri. | Registreres igen med hver batch. Fjernes, når det har været stille længere end vinduet for dets type (se nedenfor). |
| **Spejlet** | `inventory` | En post, som en OneUptime-poller vedligeholder: netværksenheder, cloudressourcer, IoT-enheder, serverless-funktioner, RUM-applikationer, Docker-værter, Podman-værter og de Android-enheder, som en Esper-forbindelse importerer. Kopieres hvert 15. minut. En Esper-enhed, hver gang dens forbindelse læses. | Så længe dets post findes. Slet posten, og elementet forsvinder med den. |
| **Tilføjet af dig** | `manual` | Tilføjet af dig, for noget OneUptime ikke kan se: en tredjeparts-API, en database, som en leverandør administrerer, en appliance i et rack. | Indtil du sletter det. Intet får det til at udløbe. |

Et fundet eller spejlet element kan ikke omdøbes eller få en anden type: kilden ville overskrive ændringen ved næste gennemløb. Elementets side **Indstillinger** fortæller i stedet, hvor en varig ændring skal foretages. Det, du altid kan tilføje til ethvert element, uanset kilde, er værdier i brugerdefinerede felter: se [Brugerdefinerede inventarfelter](/docs/inventory/custom-fields).

### Hvor længe et stille element bliver

Et fundet element har et hjerteslag. Hver gang der ankommer telemetri for det, rykker tidspunktet for, hvornår det sidst blev set, frem, og listens kolonne **Status** viser, hvor nyligt det er. Det samme gør en Android-enhed fra Esper: hver gang den tjekker ind hos Esper. Andre spejlede elementer og dem, du har tilføjet, har intet hjerteslag, så deres status forbliver tom i stedet for at slå alarm.

| Status | Hvad det betyder |
| --- | --- |
| **Live** | Set inden for de seneste 30 minutter. |
| **Nylig** | Set inden for det seneste døgn. |
| **Forældet** | Ikke set i mere end et døgn. Siden **Blevet stille** viser dem. |

Hver tredje time fjerner OneUptime de fundne elementer, der har været stille længere end vinduet for deres type, også de arkiverede, og deres værdier i brugerdefinerede felter forsvinder med dem. Spejlede elementer og dem, du har tilføjet, fjernes aldrig på denne måde.

| Type element | Fjernes efter så lang tid uden telemetri |
| --- | --- |
| Pods, deployments, Proxmox-gæster og virtuelle VMware-maskiner | 1 dag |
| Kubernetes-noder og -navnerum, Proxmox-noder, VMware-værter, -klynger og -datastores samt de databaser og fjerntjenester, dine traces kalder | 7 dage |
| Tjenester, værter, Kubernetes-, Proxmox- og Ceph-klynger, lagerarrays, vCenters og Docker Swarm-klynger | 30 dage |

En relation, som OneUptime har fundet, fjernes, når den ikke er set igen i 30 dage.

## Find rundt

Åbn **Produkter → Ressourcer → Inventar**. Dens sidemenu har disse sider. **Efter kilde**, **Indstillinger**, **Hjælp** og **Avanceret** starter foldet sammen: klik på en sektions titel for at åbne den.

| Side | Hvad du finder der |
| --- | --- |
| **Oversigt** | Hvor mange elementer du har, hvad de er, hvor mange der er blevet stille, og hvad der senest er tilføjet. |
| **Alle elementer** | Alle elementer. Søg efter navn, beskrivelse eller identitetsnøgle, afgræns listen efter type, kilde, status eller brugerdefineret felt, og tilføj et element manuelt. |
| **Administrerede enheder** | Dine Esper-forbindelser og alle de Android-enheder, de importerer, med deres status, gruppe, model og Android-version. |
| **Topologikort** | Hvordan elementerne hænger sammen: tjenester, hvad de kalder, og de værter, pods og enheder, de kører på. |
| **Blevet stille** | De elementer, der ikke er hørt fra i mere end et døgn: fundne elementer, der ikke har sendt telemetri, og enheder, der er holdt op med at tjekke ind hos Esper. |
| **Efter kilde** | Elementerne fra én kilde: **Opdaget**, **Spejlet** eller **Tilføjet af dig**. |
| **Indstillinger → Brugerdefinerede felter** | De felter, dit projekt fører på hvert element. |
| **Hjælp → Dokumentation** | En kort guide til inventaret med de typer elementer, det genkender. |
| **Avanceret → Arkiveret** | De elementer, du har arkiveret. Gendan dem herfra. |

Åbn et element, og dets egen sidemenu har dets **Oversigt** (type, kilde og status og hver attribut, der er observeret på det), dets **Forbindelser** og dets **Brugerdefinerede felter**; dets **Protokoller**, **Spor**, **Metrikker**, **Profiler** og **Undtagelser**; og dets **Hændelser**, **Advarsler** og **Planlagt vedligeholdelse**. Under **Avanceret** ligger dets **Indstillinger**, dets **Auditlogs** og **Slet element**. Telemetrisiderne viser det, elementet selv har sendt. Hændelserne, advarslerne og vedligeholdelseshændelserne er dem for den tjeneste, vært eller Kubernetes-klynge, elementet repræsenterer; på ethvert andet element fortæller de sider, hvilken ressource du skal se på i stedet.

### Aktivdetaljer

En vært eller en netværksenhed har et kort **Aktivdetaljer**, der beskriver begge på samme måde: værtsnavn, IP-adresse, MAC-adresse, serienummer, producent, model, firmwareversion, operativsystem, OS-version, enhedstype og placering. Kortet for en Android-enhed har også dens sikkerhedspatchniveau, fra Android-agenten eller Esper. En oplysning, som intet har rapporteret, står som **Ukendt**, og kortet forklarer, hvorfor det er sådan, og hvordan de ukendte bliver udfyldt: en enhed, der ikke rapporterer dem over SNMP, en enhed, der ikke er læst endnu, eller en Meraki-enhed, hvis dashboard har dem.

- En værts oplysninger kommer fra ressourceattributterne på dens telemetri: dens IP- og MAC-adresser, arkitektur og operativsystem fra start, og dens serienummer, mærke, model og firmware, når du stempler dem på.
- En netværksenheds oplysninger kommer fra dens SNMP-polling, dens rolle og dens site. Det, dens polling ikke har læst, kommer fra discovery: den seneste scanning af dens adresse, en routers ARP-tabel eller dens sondes DNS-opslag. En enhed uden ENTITY-MIB, som en Meraki MX, får stadig sit mærke, sin model og sit operativsystem fra sin systembeskrivelse og sin MAC-adresse fra sine egne porte. Dens IP-adresse vises aldrig som dens værtsnavn.
- En Meraki-enhed henter også det, dens polling lader stå tomt, fra Meraki-dashboardet, blandt andet dens serienummer, model og firmware, når en [Meraki-forbindelse](/docs/monitor/network-traffic#cisco-meraki-uden-netflow) læser dens organisation.

Kortet viser, hvor hver oplysning kom fra, og hvornår. Den kilde, de fleste oplysninger deler, som en værts collector, en netværksenheds egen SNMP-polling eller den discovery-scanning, der læste den, nævnes én gang, under oplysningerne. Enhver anden kilde, som en routers ARP-tabel eller en værdi gemt på enheden, nævnes under sin oplysning. En værdi, der er gemt på en netværksenhed, erstattes aldrig af det, discovery læser, og når de to er forskellige, viser kortet begge.

En netværksenheds kort har en knap **Opdater** for dem, der må redigere netværksenheder. Den læser enheden igen nu: dens sonde poller den inden for et minut, og dens Meraki-forbindelse læser organisationen igen. Kortet fortæller, hvornår den nye aflæsning er landet, eller at sonden ikke kunne nå enheden, og elementet kopieres fra enheden, så snart aflæsningen er landet.

De samme oplysninger er kolonner i listen **Alle elementer**, skjult indtil du slår dem til, og de kommer med i dens CSV-eksport. [Eksport til en CMDB](/docs/inventory/cmdb-sync#aktivdetaljer) viser deres nøgler.

### Forbindelser

Et elements side **Forbindelser** viser dets naboer i begge retninger, grupperet i **Kald**, **Kaldt af**, **Kører på** og **Relateret**. Hver gruppe viser sit samlede antal (en gruppe med mere end 100.000 forbindelser viser "100.000+"), og **Vis mere** bladrer gennem resten, så en travl klynge, et travlt navnerum eller en travl node viser hver forbindelse i stedet for kun de første. Siden er ikke begrænset til et tidsinterval: den indeholder relationer, der er tilføjet manuelt via API'et, og naboer, der er arkiveret. En nabo, der ikke længere er i inventaret, vises med sin nøgle.

## Importer enheder fra Esper

Forbind en Esper-lejer, og alle de Android-enheder, den tilmelder, er i inventaret, også de enheder, hvis app aldrig er startet. Hver enhed er én vært med det, kun Esper ved om den: dens gruppe, dens Android-version, build og sikkerhedspatchniveau, dens serienummer og IMEI, dens batteri og lagerplads og dens installerede apps. Esper sender intet af sig selv, så OneUptime læser lejeren efter en tidsplan: enhederne hvert 15. minut og hver enheds apps hver 6. time.

:::steps
### Opret en API-nøgle i Esper

Opret en nøgle i Esper-konsollen under API Key Management. OneUptime læser kun, så nøglen fra en bruger, hvis Esper-rolle kan læse enheder, grupper og apps, er nok. En nøgle holder op med at virke, når den bliver erstattet, eller når dens bruger bliver slettet.

### Forbind lejeren

Gå til **Produkter → Ressourcer → Inventar**, derefter **Administrerede enheder**, og klik på **Forbind Esper**. Angiv **Lejer**, navnet før `.esper.cloud` i adressen på din Esper-konsol (`acme` for `acme.esper.cloud`), og **API-nøgle**. **Flere felter** rummer forbindelsens navn, og hvor ofte den læses.

### Tjek den første læsning

**Forbind** tester nøglen, før noget gemmes: den fortæller, hvor mange Android-enheder en læsning vil importere, eller hvad der er galt, og hvordan det rettes. Den første læsning starter inden for et minut, og forbindelsens række viser, hvordan det gik.
:::

| Hvad Esper rapporterer | Hvor det vises |
| --- | --- |
| Model, producent, serienummer, Android-version, build samt IP- og MAC-adresser | Enhedens kort **Aktivdetaljer** og kolonnerne i **Alle elementer** |
| Status, seneste check-in, gruppe, sikkerhedspatchniveau, IMEI, batteri, lagerplads og Esper-agent | Enhedens kort **Esper** og listen **Enheder** under **Administrerede enheder** |
| Apps og deres versioner | Enhedens liste **Installerede apps** |

### Én enhed, ikke to

En app eller Android Agent, der sender telemetri fra en enhed, bliver ét element sammen med den enhed, Esper importerer, når den navngiver enheden på samme måde som Esper. Sæt disse ressourceattributter ud fra den administrerede konfiguration, som Esper udfylder på hver enhed:

| Ressourceattribut | Værdi i den administrerede konfiguration | Hvad det er |
| --- | --- | --- |
| `host.name` | `${esper.deviceName}` | Enhedens navn i Esper, f.eks. `ESP-ID-AAAAW`. Påkrævet. |
| `host.serial_number` | `${esper.serialNumber}` | Enhedens serienummer. Valgfri. |

OneUptime finder en enheds element ud fra dens navn i Esper og derefter ud fra dens serienummer og opretter kun et, når ingen passer. Android Agent sætter begge ud fra sine indstillinger `device_name` og `device_serial`, og [Android-opsætning](/docs/rum/android-setup#importer-flåden-fra-esper) viser en apps administrerede konfiguration.

### Når en enhed bliver stille eller forlader Esper

En enhed, der ikke har tjekket ind i 30 minutter, er **Offline** og viser, hvor længe siden den sidst gjorde det. Dens elements **Status** følger dens seneste check-in, eller dens telemetri, når den er nyere, så en enhed, der har været stille i et døgn, står på siden **Blevet stille**.

En enhed, der fjernes fra Esper, markeres som **Fjernet**, og dens element arkiveres: det forsvinder fra listen og venter under **Avanceret → Arkiveret**. En enhed, der kommer tilbage til Esper, kommer tilbage på listen. 30 dage efter at den forsvandt, slettes enheden, og det samme gør dens element, medmindre telemetri eller du har tilføjet noget til det.

### Få en advarsel, når en enhed holder op med at tjekke ind

Under **Administrerede enheder** klikker du på **Opsæt advarsler** i forbindelsens række og opretter **Esper Device Stopped Checking In**. Den åbner én advarsel for hver enhed, der ikke har tjekket ind hos Esper i mere end en time, opkaldt efter enheden, og løser den, så snart enheden tjekker ind igen.

Hver læsning af forbindelsen registrerer som metrikken `oneuptime.managed_device.check_in.age`, hvor mange minutter siden hver enhed sidst tjekkede ind, og monitoren tjekker hver enheds seneste værdi hvert 5. minut. En enhed, der også kører Android Agent, overlades til **Host Stopped Reporting**, så den aldrig advarer to gange, og en enhed, der er fjernet fra Esper, løser sin advarsel. En læsning, der fejler, registrerer intet, så ingen advarsel åbnes eller løses før den næste. Hæv monitorens tærskel for en flåde, der slukkes om natten.

## Tilføj noget manuelt

Tilføj et element for noget, OneUptime aldrig selv vil se, så en afhængighed ender et virkeligt sted, og tingen kan bære dine brugerdefinerede felter.

:::steps
### Åbn Alle elementer

Gå til **Produkter → Ressourcer → Inventar**, og derefter **Alle elementer**.

### Tilføj elementet

Klik på **Tilføj Element**. Vælg dets **Type**, giv det et **Navn** og eventuelt en **Beskrivelse**. Navn og type udgør tilsammen elementets identitet, så to elementer af samme type kan ikke have samme navn.

### Udfyld dets brugerdefinerede felter

Åbn det nye element. Dets kilde står som **Tilføjet af dig**, og dets side **Brugerdefinerede felter** tager imod de værdier, dit projekt følger.
:::

Tre typer kan du tilføje manuelt:

- `external.service` (**Ekstern tjeneste**): en tredjeparts-API eller en software-as-a-service-afhængighed.
- `external.database` (**Ekstern database**): en database, der ikke er en server, OneUptime kan modellere. En databaseserver, selvhostet eller administreret, fra PostgreSQL til Snowflake, hører i stedet hjemme under **Databaser → Opret Database** ([Databaser](/docs/telemetry/databases)): den post forbindes med de traces, containere og motormetrikker, der nævner samme adresse, hvilket et inventarelement aldrig gør, og tilføjer du samme server begge veje, står du med to uforbundne poster.
- `appliance` (**Appliance**): hardware eller software uden agent.

Begrænsningen forhindrer dubletter. Et manuelt oprettet element af en type, OneUptime kan observere, som en vært, ville blive nøglet på det navn, du skrev, mens det fundne element for samme maskine nøgles på de attributter, den rapporterer. De to ville aldrig smelte sammen, så den samme vært ville stå to gange i din liste for altid.

## Arkiver i stedet for at slette

Arkivering tager et element ud af listen, mens det beholder sin identitet, sin historik og sine værdier i brugerdefinerede felter. Det siger: Det her har jeg set, og jeg vil ikke have det i min liste. Et arkiveret element bliver ved med at indsamle telemetri.

| Kilde | Arkiver | Slet |
| --- | --- | --- |
| **Opdaget** | Forbliver arkiveret. | Kommer tilbage med næste batch af dets telemetri. |
| **Spejlet** | Forbliver arkiveret. | Kommer tilbage med næste kopi. Slet i stedet den oprindelige post. |
| **Tilføjet af dig** | Forbliver arkiveret. | Væk for altid. |

For at arkivere elementer markerer du dem i **Alle elementer** og arkiverer dem på én gang, eller du åbner et element og bruger kortet **Arkiver** på dets side **Indstillinger**. Arkiverede elementer ligger under **Inventar → Avanceret → Arkiveret**, hvor du kan markere dem og gendanne dem.

> [!NOTE]
> Når en spejlet enhed fjernes fra sin egen post, fjerner OneUptime også dens element, medmindre elementet bærer værdier i brugerdefinerede felter, som du har indtastet. De værdier er den eneste kopi, og der er ingen fortryd, så elementet arkiveres i stedet for at blive slettet. Du finder det under **Avanceret → Arkiveret** med alt, hvad du skrev, intakt.

## Relationer og topologi

OneUptime forbinder elementer med rettede relationer, efterhånden som det observerer dem. **Inventar → Topologikort** tegner dem, og et elements side **Forbindelser** viser dets egne. Se [Topologi](/docs/telemetry/topology).

| Relation | For eksempel |
| --- | --- |
| `runs-on` | En pod kører på en node; en virtuel maskine kører på sin vært. |
| `member-of` | En pod, node eller et navnerum er medlem af en klynge. |
| `hosted-on` | En tjeneste hostes på en vært. |
| `part-of` | En pod er en del af sit deployment. |
| `depends-on` | En tjeneste kalder en anden, ud fra de spans, der går imellem dem. |

## Næste trin

:::cards
- [Brugerdefinerede inventarfelter](/docs/inventory/custom-fields): Følg serienumre, garantidatoer, ejere og livscyklusstatus.
- [Eksport til en CMDB](/docs/inventory/cmdb-sync): Hent kataloget ind i dit eget styrende system.
- [Databaser](/docs/telemetry/databases): Overvåg de databaseservere, dine tjenester bruger.
:::
