# Nettverkstrafikk (NetFlow, IPFIX og sFlow)

Rutere, brannmurer og svitsjer kan beskrive trafikken som går gjennom dem, som **flytposter**: hvem som snakket med hvem, over hvilken protokoll og hvilke porter, gjennom hvilke grensesnitt og med hvor mange bytes. Pek eksporten mot en OneUptime-sonde, så viser **Trafikk**-sidene hvor trafikken din går: de travleste adressene, samtalene, applikasjonene og grensesnittene, over et hvilket som helst tidsrom.

Det finnes en Trafikk-side tre steder:

- **Nettverk** -> **Trafikk**: hele nettverket, flytene til alle enheter på én side, og alle adresser som sender flyter uten ennå å være en enhet.
- **Trafikk**-siden til en lokasjon: enhetene på den lokasjonen.
- **Trafikk**-fanen til en enhet: den ene enheten med grensesnittene sine. Pakkeopptak som kjøres på enhetens sonde, står under flytene, for når du trenger selve pakkene.

Et Cisco Meraki-miljø kan også leses uten å eksportere noe: koble til Meraki-dashbordet, så viser Trafikk-sidene uplinkene, applikasjonene og klientene til appliancene slik Meraki rapporterer dem. Se [Cisco Meraki uten NetFlow](#cisco-meraki-uten-netflow).

## Hva Trafikk-siden viser

- Fire tall for tidsrommet: **Trafikk** (bytes), **Gjennomsnitt**- og **Topp**-raten, og **Flyter** (hvor mange flytposter enhetene sendte).
- **Trafikk over tid**, i biter per sekund. Dra over grafen for å zoome inn på en del; dobbeltklikk på den, eller bruk **Tilbakestill zoom**, for å gå tilbake.
- **Toppkilder** og **Toppmål**: de ti adressene som sendte og mottok mest.
- **Toppapplikasjoner**: trafikk etter protokoll og tjenesteport, oppkalt etter tjenesten som vanligvis kjører på porten (HTTPS er TCP-port 443).
- **Toppgrensesnitt** på siden til en enhet: hva som kom inn og gikk ut gjennom hvert grensesnitt, med navn og hastighet fra enhetens SNMP-walk. **Toppenheter** på siden til en lokasjon og på nettverkets side.
- **Toppsamtaler**: de ti travleste adresseparene, tegnet som et diagram fra avsendere til mottakere, eller som en liste.

Klikk på en rad - en adresse, en applikasjon, et grensesnitt, en enhet, et bånd i diagrammet - så snevres hele siden inn til den trafikken. En brikke over siden sier hva den er snevret inn til; klikk på x-en for å utvide siden igjen. **Finn en IP-adresse** snevrer siden inn til trafikken til eller fra én adresse. Tidsrommet og filtrene lagres i adressen til siden, så en lenke åpner nøyaktig samme visning.

## Slik kommer flytene hit

Hver sonde kjører en flytinnsamler. Den lytter på tre UDP-porter, og hver port leser alle formater:

| Port     | Brukes vanligvis til        |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

Sonden dekoder postene, ganger samplede tall opp igjen med samplingsraten, summerer postene for én samtale med noen sekunders mellomrom og sender dem til OneUptime. Hver post knyttes til en enhet etter adressen enheten sender den fra - for sFlow agentadressen i datagrammet:

1. en enhet sonden poller der vertsnavnet er den adressen (eller slås opp til den), eller som har den under **Andre adresser** på **Innstillinger**-siden sin;
2. på din egen (egendefinerte) sonde, en hvilken som helst enhet i prosjektet med adressen som vertsnavn eller blant de andre adressene sine;
3. ellers lagres flytene på din egen sonde for nettverkets Trafikk-side, under **Avsendere av flyter**, til du sier hvilken enhet de hører til. En global sonde forkaster dem.

Flyter lagres i 30 dager, og én side viser høyst 31 dager.

## Oppsett

1. **Bruk en sonde på enhetens nettverk.** Flyter er UDP-datagrammer som enhetene dine sender, så de trenger en [egendefinert sonde](/docs/probe/custom-probe) de kan nå. En global sonde på det offentlige internettet mottar dem ikke.
2. **La datagrammene nå sonden.** Tillat UDP 2055, 4739 og 6343 fra enhetene til sonden. En sonde i Docker som er startet med vertsnettverket (`--network host`), slik siden om den egendefinerte sonden viser, mottar dem som den er; uten vertsnettverket publiserer du portene med `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Slå på flyteksport på enheten**, og send den til sondens IP-adresse. Kommandoene for vanlige enheter står nedenfor. Enhetens egen **Trafikk**-fane viser de samme trinnene med sondens porter til den første flyten kommer.
4. **Sjekk adressen til enheten.** Poster knyttes etter adressen enheten sender fra. Hvis den sender fra en loopback eller et administrasjonsgrensesnitt som ikke er vertsnavnet, legger du den adressen til enhetens **Andre adresser**.

Innsamleren er slått på som standard. Innstillingene er miljøvariabler på sonden:

| Variabel                            | Hva den gjør                                                        | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Sett til `false` for å slå av flytinnsamleren                       | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow-porten; `0` slutter å lytte på den                          | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX-porten; `0` slutter å lytte på den                            | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow-porten; `0` slutter å lytte på den                            | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Godtatte datagrammer per minutt, på tvers av alle enheter og porter | 6000    |

Disse 6 000 datagrammene i minuttet deles av alle enhetene som eksporterer til sonden. Med hundrevis av enheter bør du øke `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` eller fordele enhetene på flere sonder: datagrammer over grensen forkastes, og sondens logg sier hvor mange (se [Feilsøking](#feilsøking)). Et Meraki-miljø trenger ingen eksport i det hele tatt: se [Cisco Meraki uten NetFlow](#cisco-meraki-uten-netflow).

### Cisco IOS XE (Flexible NetFlow)

Eksporterer IPFIX til UDP 4739. Legg den siste linjen til hvert grensesnitt du vil se trafikken til: når trafikken måles idet den kommer inn på hvert grensesnitt, telles hver samtale én gang.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Eksporterer NetFlow v9 til UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Eksporterer sFlow til UDP 6343. sFlow sampler én pakke av N (her 16384), og Trafikk-sidene ganger prøvene opp igjen, så tallene er anslag.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX og Z

MX-appliances og hjemmekontor-gatewayer i Z-serien eksporterer NetFlow v9 fra Meraki-dashbordet:

1. Åpne **Network-wide** > **General**, og finn **Reporting**.
2. Sett **NetFlow traffic reporting** til **Enabled: send NetFlow traffic statistics**.
3. Skriv inn sondens IP-adresse som **NetFlow collector IP** og `2055` som **NetFlow collector port**, og lagre.

En MX eller Z ser bare trafikken som går gjennom den. Trafikk som en svitsj holder innenfor et VLAN, når den aldri, så den er ikke med i eksporten.

For å lese hver lokasjon uten å sette opp hver MX kobler du heller til Meraki-dashbordet: se [Cisco Meraki uten NetFlow](#cisco-meraki-uten-netflow). Den trafikken har ingen samtaler, så de to utfyller hverandre godt.

### Juniper (inline J-Flow)

Eksporterer IPFIX til UDP 4739 fra MX-rutere; bruk FPC-en som bærer grensesnittene du sampler.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Eksporterer NetFlow v9 til UDP 2055. På FortiOS 7.2 og nyere er innsamleren en oppføring under `config collectors` inne i `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Under **Device** > **Server Profiles** > **NetFlow** legger du til en profil med sondens IP-adresse og port `2055`, og setter **Active Timeout** til 1 minutt.
2. Under **Network** > **Grensesnitt** åpner du hvert grensesnitt du vil se trafikken til, og velger profilen som **NetFlow Profile** på fanen **Advanced**.
3. Utfør commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense og Linux-verter

På pfSense installerer du pakken **softflowd**, og under **Services** > **softflowd** velger du grensesnittene, skriver inn sondens IP-adresse og port `2055` og velger NetFlow versjon 9. På en Linux-vert kjører du softflowd på grensesnittet du vil se trafikken til:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Andre enheter

Send NetFlow v5, NetFlow v9 eller IPFIX til sondens IP-adresse på UDP 2055 (eller 4739), eller sFlow v5 på UDP 6343. Sett enhetens aktive flyttidsavbrudd til 60 sekunder, og send for NetFlow v9 og IPFIX malene hvert 60. sekund. [Veiledningene for nettverksleverandører](/docs/monitor/network-vendor-guides) dekker Sophos og Extreme Networks.

## Cisco Meraki uten NetFlow

Et Meraki-miljø har en annen vei inn, uten noe å sette opp på enhetene og uten en sonde i veien: OneUptime leser organisasjonens trafikk fra Meraki-dashbordets API. Det passer for hundrevis eller tusenvis av lokasjoner, der det vanskelige er å sette opp NetFlow på hver MX.

Velg **Koble til Meraki** på **Nettverk** -> **Trafikk**:

1. **API-nøkkel.** Lag en i Meraki-dashbordet under **Organization** > **API & Webhooks** > **API keys and access**. Nøkkelen til en skrivebeskyttet administrator holder. OneUptime lagrer den kryptert, viser den aldri igjen og sender den ikke til noe annet enn Meraki-dashbordets API i nøkkelens region. Hvis du logger inn på Meraki et annet sted enn dashboard.meraki.com, velger du **Dashbordregion** under **Flere felt**: dashbordet for Canada, Kina, India eller USAs FedRAMP-dashbord.
2. **Organisasjon.** Nøkkelen testes så snart trinnet åpnes: organisasjonene den kan lese, listes opp, og for den du velger, teller dialogen nettverkene og MX- og Z-appliancene en lesing vil dekke, før noe lagres.

Den første lesingen starter innen ett minutt og henter det siste døgnet. Etter det har Trafikk-sidene en bryter **Flows** | **Meraki** i toppen: en side med flytposter åpner på dem som før, og en side med bare Meraki-trafikk åpner på Meraki.

| På siden | Hva Meraki rapporterer | Hvor ofte det leses |
| --- | --- | --- |
| De fire tallene, diagrammet, **Toppnettverk** og **Uplinker** | Uplinkbruken til hver MX- og Z-appliance (wan1, wan2, cellular), for hele organisasjonen i ett kall | Hvert 5. minutt som standard, opptil hver time, i femminuttersvinduer |
| **Toppapplikasjoner** og **Toppmål** | Trafikkanalysene til hvert nettverk | Annenhver time: Meraki summerer dem over to timer eller mer |
| **Toppklienter** | Klientene i hvert nettverk og hva de brukte | Annenhver time, sammen med applikasjonene |

Et klikk på et nettverk begrenser siden til det og viser uplinkene. Trafikken til en appliance hører til enheten dens i OneUptime når en enhet har serienummeret eller MAC-adressen til appliancen: den vises da også på Trafikk-sidene til den enheten og lokasjonen dens. Trafikken til en appliance som ikke er en enhet i OneUptime, vises på nettverkets side.

Meraki gir hver organisasjon 10 API-forespørsler i sekundet, delt av alle applikasjonene som leser den. OneUptime bruker høyst 3 av dem, senker farten når Meraki ber om det, og stopper en lesing etter 900 forespørsler eller 6 minutter; den neste fortsetter ett minutt senere. En organisasjon med 1 200 nettverk får uplinkene lest med ett kall per vindu, og nettverkenes applikasjoner og klienter over noen få lesinger.

Tilkoblingene står nederst på nettverkets Trafikk-side under **Meraki**, hver med hvordan det går og hva den siste lesingen dekket. Hver har én knapp for neste steg: **Les nå** leser den med en gang, **Slå på** slår den på igjen når den er slått av, og **Oppdater API-nøkkel** erstatter en nøkkel Meraki avviste, og tester den nye nøkkelen før den lagres. Menyen har **Rediger** (navnet, hvor ofte uplinkene leses, en ny nøkkel), **Slå av** og **Slett**. En lesing som feiler, sier hvorfor, der og over trafikken: en avvist nøkkel, en nøkkel som ikke kan lese organisasjonen, Meraki som ber OneUptime senke farten, eller nettverk med trafikkanalyse slått av. Over trafikken fører **Gå gjennom** til tilkoblingen. Bare prosjekteiere og prosjektadministratorer kan koble til Meraki og endre eller lese en tilkobling.

Meraki-dashbordets API rapporterer totaler, aldri hvem som snakket med hvem, så Meraki-siden har ingen samtaler. For å se dem sender du også NetFlow fra MX-appliancene ([Cisco Meraki MX og Z](#cisco-meraki-mx-og-z)): siden har da begge, én bryter unna.

## Adresser som ennå ikke er enheter

Flyter kan komme før enheten som sender dem, er lagt til i OneUptime. På din egen sonde lagres de, og nettverkets Trafikk-side viser adressen deres under **Avsendere av flyter**, merket **Ennå ikke en enhet**:

- **Legg til som enhet** åpner Legg til enhet med adressen og sonden fylt inn. Flytene som allerede har kommet, blir værende på nettverkets side; nye går til enheten.
- **Det er en av enhetene mine** legger adressen til en enhets **Andre adresser**: bruk det når en enhet du allerede har lagt til, sender fra en annen adresse, for eksempel en loopback. Flytene går til den enheten fra neste minutt.

Flere enheter bak én NAT-adresse deler den adressen, så flytene deres går til den ene enheten som har den.

## Slik leser du tallene

- **Sampling.** En enhet som sampler - sFlow gjør det alltid, og NetFlow eller IPFIX kan gjøre det - rapporterer én pakke av N. Sonden ganger tallene med N, så siden viser anslag og sier det under de fire tallene. De er nøyaktige for mye trafikk og grove for noen få pakker.
- **Talt to ganger.** Trafikk som går gjennom to eksporterende enheter, rapporteres av begge. Siden til en enhet teller den én gang; siden til en lokasjon eller nettverket teller den én gang per enhet som rapporterte den.
- **Applikasjoner.** En applikasjon er protokollen og tjenesteporten, oppkalt etter tjenesten som vanligvis kjører på porten. Det er ikke dyp pakkeinspeksjon: HTTPS på port 9443 vises som TCP-port 9443. Klientens kortlivede port utelates, så tusen nettleserforbindelser til én server er én applikasjon.
- **Topp** er raten for den travleste delen av grafen, så et kortere tidsrom med kortere deler viser en skarpere topp. **Gjennomsnitt** er bytene over hele tidsrommet.
- **Tid.** En flyt teller i delen den startet i. En lang nedlasting rapporteres som flere flyter, én for hvert minutt den varer, og derfor bør enhetenes aktive tidsavbrudd være 60 sekunder.

## Hva som ikke er med

- **Varsler på flyter.** Det finnes ennå ingen flytbasert monitor. For å få varsel om en travel lenke bruker du varslene for grensesnittutnyttelse i [nettverksenhetsmonitoren](/docs/monitor/network-device-monitor), som leser SNMP.
- **Applikasjonsnavn utover porten.** Det finnes ingen dyp pakkeinspeksjon, og Cisco NBAR-applikasjonsnavn leses ikke.
- **Samtaler fra Meraki-dashbordets API.** Det rapporterer totaler, ikke hvem som snakket med hvem: send også NetFlow fra MX-appliancene for å se samtaler.
- **Avviksdeteksjon** i trafikken.
- **Grensesnittnavn fra flytposter.** Navn og hastigheter for grensesnitt kommer fra enhetens SNMP-walk; en enhet uten walk viser grensesnittnumre.

## Feilsøking

Hvis Trafikk-siden fortsatt viser oppsettstrinnene sine:

- **Mottar sonden noe i det hele tatt?** Nettverkets Trafikk-side viser under **Avsendere av flyter** alle adresser som har sendt flyter den siste timen. Står enheten der som **Ennå ikke en enhet**, sender den fra en adresse som ikke er vertsnavnet: legg den adressen til enhetens **Andre adresser**.
- **Brannmurer og Docker.** Tillat UDP 2055, 4739 og 6343 fra enheten til sonden, og publiser portene hvis sonden kjører i Docker.
- **Sondens logg.** Én gang i minuttet logger sonden det den ikke kunne lese: datagrammer i et format som ikke støttes (NetFlow v1, v6, v7 eller v8, eller sFlow før versjon 5), ugyldige datagrammer, data som venter på en mal, og datagrammer som ble forkastet over `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Maler.** NetFlow v9 og IPFIX sender oppbygningen av postene sine som maler. Sonden holder data som kommer før malen, i opptil 10 minutter; still inn enheten til å sende malene hvert 60. sekund, så fylles siden innen ett minutt.
- **En global sonde.** En enhet som polles av en global sonde, kan ikke sende flyter til den fra et privat nettverk. Kjør en egendefinert sonde på enhetens nettverk, og velg den i enhetens innstillinger.

Hvis en Meraki-tilkobling sier at den ikke kan lese:

- **Nøkkelen avvises.** Kopier den på nytt fra Meraki-dashbordet, og sjekk **Dashbordregion**: en nøkkel leser bare dashbordet den ble laget i. Lim inn den nye nøkkelen med **Oppdater API-nøkkel** på tilkoblingen.
- **Nøkkelen kan ikke lese organisasjonen.** Slå på API-tilgang for organisasjonen under **Organization** > **API & Webhooks**, eller bruk nøkkelen til en av administratorene.
- **Ingen applikasjoner på noen nettverk.** Trafikkanalysen deres er slått av: slå den på under **Network-wide** > **General** > **Traffic analysis**.
- **Meraki ba OneUptime senke farten.** Andre applikasjoner bruker organisasjonens API-budsjett. OneUptime leser saktere og fortsetter.
- **Denne OneUptime når ikke API-et.** Tillat HTTPS (port 443) fra OneUptimes servere til `api.meraki.com`, eller API-verten for regionen din.
