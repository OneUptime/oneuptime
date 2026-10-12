# Zooma in på ett tidsintervall

Dra över ett diagram för att zooma in sidan på det ögonblicket, och dubbelklicka för att gå tillbaka. Den här sidan förklarar gesterna, hur en zoom beter sig och vilka diagram som zoomar vad.

:::cards
- [Zooma in och ut igen](#zooma-in-och-ut-igen): De två gesterna och knappen Reset zoom.
- [Så beter sig zoomning](#så-beter-sig-zoomning): Kapslade zoomningar, automatisk uppdatering, klick och dragningar.
- [Var det fungerar](#var-det-fungerar): Sidorna och diagrammen vars intervall en dragning ändrar.
- [Diagram utan zoom](#diagram-utan-zoom): Remsor, mätare och sparklines.
:::

## Zooma in och ut igen

Varje tidsseriediagram i OneUptime fungerar också som väljare av tidsintervall. När ett diagram visar en topp som du vill titta närmare på behöver du inte öppna väljaren och skriva in datum:

:::steps
1. **Dra över toppen** i vilket diagram som helst. Sidans tidsintervall flyttas till fönstret du drog upp, precis som om du hade valt det i väljaren av tidsintervall. Varje diagram, och varje ruta eller tabell som räknas fram ur sidans tidsintervall, hämtar data på nytt för det, så att du läser ett och samma ögonblick i alla.
2. **Dubbelklicka på vilket diagram som helst** för att gå tillbaka. Sidan återgår till det tidsintervall den hade innan du började zooma.
:::

Paneler som visar det aktuella läget stannar på nu, precis som när du själv väljer ett intervall: antal i inventariet, hälsa, de största resursförbrukarna, senaste varningar, öppna incidenter och larm och en instrumentpanels livelistor.

Medan en zoom är aktiv visas knappen **Reset zoom** bredvid sidans väljare av tidsintervall. Den gör samma sak som ett dubbelklick och är vägen tillbaka för tangentbordsanvändare och på pekskärmar.

```mermaid title="Vad en dragning, ett dubbelklick och väljaren gör med sidans tidsintervall"
stateDiagram-v2
    state "Intervall från väljaren" as Picked
    state "Inzoomat fönster" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: dra över ett diagram
    Zoomed --> Zoomed: dra igen
    Zoomed --> Picked: dubbelklick eller Reset zoom
    Zoomed --> Picked: välj ett intervall
```

## Så beter sig zoomning

- **Zooma så djupt du vill; en återställning går hela vägen ut.** När du har zoomat från "Past 1 Hour" in till tio minuter och sedan till en, ger ett enda dubbelklick (eller **Reset zoom**) tillbaka hela timmen i stället för en nivå i taget.
- **Vilket diagram som helst kan återställa vilken zoom som helst.** Dra i CPU-diagrammet, dubbelklicka i minnesdiagrammet: det är sidan som är inzoomad, inte diagrammet.
- **Att själv välja ett intervall börjar om.** En förinställning eller ett eget intervall i väljaren är en ny utgångspunkt: zoomen är över och **Reset zoom** försvinner.
- **Ett inzoomat fönster ligger fast.** "Past 30 Minutes" följer klockan; en zoom är ett fast fönster, så det står still medan automatisk uppdatering är på. Återställ zoomen för att följa klockan igen.
- **En zoom går aldrig förbi nu.** Ett diagrams nyaste bucket fylls oftast fortfarande på; en dragning som slutar på den kapas vid aktuell tid.
- **Du kan släppa musen utanför diagrammet**: dragningen räknas ändå.
- **Du behöver inte vänta på att diagrammen laddas för att gå tillbaka.** Direkt efter en zoom, medan diagrammen fortfarande hämtar fönstret du drog upp, eller när fönstret visar sig vara tomt, återställer ett dubbelklick på ett diagram zoomen direkt.
- **Att dubbelklicka på en sida som inte är inzoomad gör ingenting.**

### Klick och dragningar

- **I linje-, yt- och stapeldiagram är ett vanligt klick ingen zoom.** Det gäller de flesta diagram: måttkort och måttutforskaren, resursöversikter, SLO:er, övervakare och alla diagram på en instrumentpanel. Bara en dragning över flera buckets zoomar, så ett klick på en punkt, en stapel eller en förklaring gör fortfarande det det gjorde förut. Medan en zoom är aktiv får ett klick i diagrammets ritområde effekt ett ögonblick senare, så att det kan skiljas från dubbelklicket som återställer. Tidslinjen för felmönster i logginsikterna och ett undantags Occurrence Trend zoomar också bara vid dragning.
- **I utforskarnas volymdiagram zoomar ett klick på en stapel in på den stapeln.** Volymdiagrammen i utforskarna för loggar, spår, undantag och säkerhetshändelser, samt analysdiagrammen för loggar och spår, zoomar in på staplarna du drar över, eller på den enda stapel du klickar på. De här diagrammen visar **Click or drag to zoom**.

### Tips på diagrammen

De flesta diagram som zoomar anger gesten ovanför ritområdet, **Drag to zoom** eller **Click or drag to zoom**, och lägger till påminnelsen **double-click to reset** medan en zoom är aktiv. Måttkort, måttutforskaren och utforskarnas volymdiagram visar alltid tipset. På diagramkorten i resursöversikter och SLO:er, och på vissa widgetar i instrumentpaneler, visas det bara medan du pekar på kortet eller tabbar in i det.

## Var det fungerar

Zoomning ändrar hela sidans intervall på:

- resursöversikter och deras insiktssidor: Kubernetes-kluster, Docker-, Podman- och Docker Swarm-värdar, värdar och deras processer, tjänster och systemd-enheter, VMware, Proxmox, Ceph, lagringsmatriser, databaser, molnresurser och serverlösa funktioner;
- tjänster och RUM-applikationer;
- nätverksenheters mätvärden och trafik;
- måttkort, inklusive en resurs flik Mätvärden och en övervakares mätvärden;
- måttutforskaren;
- SLO-historikdiagram;
- logginsikter, inklusive tidslinjen "När det hände" för ett felmönster, vars panel har en egen **Reset zoom** eftersom den täcker sidans väljare;
- volymdiagram för loggar, spår, undantag och säkerhetshändelser, samt analysdiagrammen för loggar och spår, som ändrar intervallet i utforskaren de hör till;
- [instrumentpaneler](/docs/dashboards/authoring), där en dragning ändrar hela instrumentpanelens intervall.

Diagram med ett eget fönster zoomar bara det fönstret och ändrar därför aldrig något annat på sidan. Det gäller en förhandsvisning av ett mått i en övervakares formulär (övervakaren fortsätter att utvärdera sitt eget rullande fönster), ett undantags Occurrence Trend, ett diagram som öppnats i ett popupfönster eller i undersökningspanelen och diagram i svar från AI-chatten. Ett dubbelklick på något av dem, eller dess knapp **Reset zoom**, ställer tillbaka dess eget fönster.

Telemetriögonblicksbilden på en incidents, ett larms eller en episods sida har också ett eget fönster. En dragning i dess diagram (måttdiagrammet, eller volymdiagrammet för loggar, spår eller undantag när det är det ögonblicksbilden visar) zoomar hela ögonblicksbilden, så att flikarna Mätvärden, Loggar, Spår och Undantag alla visar utsnittet du drog upp. **Reset zoom** bredvid ögonblicksbildens märke, eller ett dubbelklick på det diagrammet, ställer tillbaka ögonblicksbildens fönster.

## Diagram utan zoom

Några få visualiseringar har ingen tidsaxel att dra över, är för små att dra på eller visar alltid ett fast eget fönster, så de zoomar inte:

- remsor med drifttidshistorik (en stapel per dag), som inte kan visa något finare än en dag;
- andels- och proportionsstaplar, mätare och förloppsindikatorer;
- flamdiagram, tjänstkartor och flödesdiagram;
- de små trend-sparklines i måttlistor, där ett klick öppnar måttet: öppna det för att få ett diagram du kan zooma;
- små sparklines med ett fast eget fönster, som en nätverksenhets tur och retur-tid under den senaste timmen: deras länk **Open metrics** leder till diagram du kan zooma.

## Nästa steg

:::cards
- [Skapa en instrumentpanel](/docs/dashboards/authoring): Zoom fungerar i alla diagram på en instrumentpanel.
- [Söksyntax](/docs/telemetry/search-syntax): Filtrera utforskarna när du har hittat ögonblicket.
- [Metrikövervakning](/docs/monitor/metrics-monitor): Få larm på måttet du tittade på.
:::
