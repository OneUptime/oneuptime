# Skykostnader og besparelser

En tilkoblet skykonto sier også hva den koster, og hvordan den kunne kostet mindre. OneUptime leser kostnadene for hver dag fra skyens egen fakturering og anbefalingene fra skyens egen anbefalingstjeneste, viser dem under **Sky → Forbruk → Kostnader** og **Sky → Forbruk → Besparelser**, og varsler før en måned koster mer enn budsjettet under **Sky → Forbruk → Budsjetter**.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer og Cost Optimization Hub, hver slått på én gang.
- [Microsoft Azure](#microsoft-azure): Cost Management og Azure Advisor, med én rolle til.
- [Google Cloud](#google-cloud): Fakturaeksporten din til BigQuery, og Recommender.
- [Budsjetter](#budsjetter): Et varsel når forbruket i en måned passerer en andel av budsjettet.
- [Påkrevde tagger](#påkrevde-tagger): Hvor mye av forbruket ditt som har taggene du krever, og nye ressurser uten dem.
:::

## Slik fungerer det

```mermaid title="Fra skyens fakturering til sidene i Sky"
flowchart TB
    bill["Skyens fakturering,<br/>lest to ganger om dagen"] --> costs["Kostnader"]
    rec["Skyens anbefalinger,<br/>lest én gang om dagen"] --> savings["Besparelser"]
    costs --> budgets["Budsjetter som varsler"]
    costs --> overview["Oversikten i Sky"]
    savings --> overview
```

- **Kostnadene kommer fra skyens egen fakturering.** AWS Cost Explorer, Azure Cost Management og Google Clouds fakturaeksport til BigQuery, før kreditter og refusjoner, i valutaen kontoen faktureres i. Hvert beløp er en dags, i UTC-dager, slik skyen fakturerer dem.
- **En sky rapporterer den siste dagen eller to for sent.** Hver lesing tar den siste uken på nytt, og hele forrige måned i de første dagene av en måned, så kostnaden for en dag faller på plass etter hvert som skyen avslutter den. Den første lesingen til en tilkobling går tilbake til starten av måneden før forrige måned.
- **Månedens prognose følger tempoet den siste uken.** Den er det måneden har kostet så langt, med hver gjenværende dag til gjennomsnittet av de siste sju hele dagene.
- **Besparelsene kommer fra skyens egen anbefalingstjeneste.** AWS Cost Optimization Hub, Azure Advisor og Google Clouds Recommender: en mindre størrelse, en ressurs som står ubrukt, en forpliktelse som lønner seg, hver med det den ville spart i måneden. En anbefaling du gjennomfører eller avviser i skyens konsoll, forsvinner ved neste lesing.

## Før du begynner

- **En tilkoblet konto.** [Koble til en skykonto](/docs/telemetry/cloud-accounts) med dagens oppsettkommando: Den lar tilkoblingen lese kostnader og anbefalinger. En tilkobling som ble laget før, leser ingen av delene før du kjører kommandoen på nytt.

## Amazon Web Services

Tilkoblingen leser kostnader med `ce:GetCostAndUsage`, forpliktelsene sine med `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetReservationCoverage` og `ce:GetReservationUtilization` og anbefalinger med `cost-optimization-hub:ListRecommendations`. Cost Explorer og Cost Optimization Hub må slås på i kontoen først:

:::steps
### Slå på Cost Explorer

Åpne Cost Explorer én gang i AWS-konsollen Billing and Cost Management: AWS forbereder kontoens kostnader innen en dag. Koble til organisasjonens administrasjonskonto for å lese kostnadene til hver medlemskonto.

### Meld deg på Cost Optimization Hub

Åpne Cost Optimization Hub i den samme konsollen og meld deg på, for organisasjonen fra administrasjonskontoen eller bare for kontoen. Anbefalingene kommer innen en dag.
:::

Cost Explorer tar $0.01 for hver forespørsel: en lesing av kostnadene gjør noen få, og forpliktelsene leses med fire om dagen. Cost Optimization Hub er gratis.

### Kostnader per ressurs

Cost Explorer oppgir også hva hver ressurs koster, for de siste 14 dagene, når data på ressursnivå er slått på. Åpne Cost Management-innstillingene i AWS-konsollen Billing and Cost Management, og slå på data på ressursnivå med daglig granularitet, for organisasjonen fra administrasjonskontoen dens. AWS klargjør dem innen 48 timer.

Rediger deretter tilkoblingen under **Sky → Koble til**, og slå på **Kostnader per ressurs** under **Flere felt**. Tilkoblingen leser dem med `ce:GetCostAndUsageWithResources` én gang om dagen: de 14 dagene første gang, deretter de siste tre på nytt, med noen få forespørsler hver gang. Det den leser, blir værende med kostnadene til kontoen etter at Cost Explorer har glemt det. En tilkobling som ble laget før, må få oppsettkommandoen sin kjørt på nytt, som legger til handlingen.

## Microsoft Azure

Appen leser kostnader med rollen **Cost Management Reader**, på samme område som **Monitoring Reader**: Oppsettkommandoen tildeler begge. Azure Advisors anbefalinger leses med **Monitoring Reader**, så det er ingenting å slå på. For å gi en app som ble laget før, rollen, kjører du:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management svarer for hvert abonnement, med ressursen hver kostnad gjelder, og det koster ingenting å lese. Når den ikke kan svare for et abonnement, sier kontoens **Kostnader** hvorfor.

Cost Management begrenser hvor raskt kostnadene til en leietaker leses, likt for alle som leser dem: hver spørring koster en spørringsbehandlingsenhet (QPU) for hver måned med data den leser, og en leietaker har 12 QPU hvert 10. sekund, 60 i minuttet og 600 i timen. OneUptime leser abonnementene til en leietaker ett om gangen innenfor to tredjedeler av hver kvote, venter så lenge Cost Management ber om når den avviser en spørring, og fortsetter ved neste lesing der den slapp. Et abonnement som ikke er lest ennå, sier **I kø** og når det leses; et som har beløp, beholder dem i mellomtiden.

## Google Cloud

Google Cloud har ikke noe API for kostnadene til et prosjekt: OneUptime leser dem fra faktureringskontoens eksport til BigQuery.

:::steps
### Eksporter faktureringen til BigQuery

Åpne Billing og deretter Billing export i Google Cloud-konsollen, og slå på eksporten av detaljerte brukskostnader til et BigQuery-datasett. Google skriver den noen timer på etterskudd, fra dagen du slår den på.

### La tjenestekontoen lese den

Gi tjenestekontoen til tilkoblingen **BigQuery Data Viewer** på eksportens datasett. Oppsettkommandoen har allerede gitt den **BigQuery Job User**, så den kan kjøre spørringen i sitt eget prosjekt.

### Oppgi eksportens tabell

Rediger tilkoblingen under **Sky → Koble til**, og sett under **Flere felt** **Tabell for fakturaeksport** til tabellens fulle navn: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

Den detaljerte eksporten nevner ressursen hver kostnad gjelder; standardeksporten sier bare tjenesten og regionen. BigQuery fakturerer spørringen: den første 1 TiB i måneden er gratis, deretter $6.25 per TiB, og en måned av en eksport er fra noen få megabyte til noen få gigabyte. Recommenders anbefalinger om maskintyper og ubrukte ressurser leses med **Compute Recommender Viewer**, som oppsettkommandoen tildeler, og koster ingenting.

## Måter å bruke mindre på

**Sky → Forbruk → Besparelser** lister hver anbefaling, den største besparelsen først: hva som skal gjøres, ved hvilken ressurs, hva som ville endret seg og hva den sparer i måneden. Stripen over legger dem sammen, totalt og etter type: en mindre størrelse, en ressurs som står ubrukt, en forpliktelse. En anbefaling lenker til siden til ressursen sin når OneUptime har ressursen.

### Størrelsestilpasning ut fra OneUptimes egne målinger

En ressurs som ingen anbefalingstjeneste uttaler seg om, fordi den ikke er slått på, ikke dekker typen eller finner ressursen for ny, får størrelsen vurdert av OneUptime ut fra CPU- og minnemålingene som tilkoblingen har tatt de siste 14 dagene. OneUptime vurderer EC2-instanser, RDS-databaser og ElastiCache-klynger på AWS, virtuelle maskiner, fleksible PostgreSQL- og MySQL-servere og App Service-planer på Azure, og Compute Engine-VM-er og Cloud SQL-instanser på Google Cloud:

- **Overprovisjonert** når størrelsen som er halvparten så stor, eller en firedel, fortsatt ville hatt plass: på den mindre størrelsen ville CPU-ens 95. persentil vært høyst 60 %, den høyeste CPU-målingen høyst 100 % og minnetoppen høyst 70 %, når minnet leses.
- **Underprovisjonert** når CPU-ens 95. persentil er 85 % eller mer, eller minnetoppen 90 % eller mer: størrelsen som er dobbelt så stor.

En ressurs vurderes så snart den har 6 dager med målinger. Siden dens viser **Størrelsestilpasning** ved siden av hva den koster, og en overprovisjonert står under **Sky → Forbruk → Besparelser** med OneUptime som kilde. Det en endring sparer, er dens andel av det ressursen kostet de siste 30 dagene, så det er kjent så snart skyen fakturerer ressursen ved navn: den detaljerte eksporten til Azure og Google Cloud gjør det, og AWS gjør det når Kostnader per ressurs er slått på. Burstable størrelser som t3, B-serien og e2-micro vurderes aldri.

Skyen din leser minnet til en VM bare med en egen agent inne i VM-en: CloudWatch-agenten på en EC2-instans, Ops Agent på en Compute Engine-VM og ingen for en Azure-VM, som rapporterer ledig minne i stedet for brukt minne. En VM som [OneUptimes vertsinnsamler](/docs/telemetry/hosts) kjører på, vurderes i stedet ut fra minnet vertsinnsamleren leser:

- **VM-en og verten er én maskin** når leverandør, konto, region og instans-ID alle stemmer: EC2-instans-ID-en, den numeriske ID-en til en Compute Engine-VM eller `vmId` til en Azure-VM. Et vertsnavn alene gir aldri treff, og en VM som to verter gjør krav på, som en klonet maskin, knyttes ikke til noen av dem. Siden til VM-en nevner verten, og siden til verten nevner VM-en, hver med en lenke til den andre.
- **Minne er vertens brukte minne, uten hurtigbuffer og buffere**, tallet vertens side viser i diagrammet, over de samme 14 dagene. En travel filhurtigbuffer leses aldri som en full maskin. Verten trenger også 6 dager med målinger.
- **Der begge leser minnet**, som på en Compute Engine-VM med Ops Agent og vertsinnsamleren, brukes den med flest målinger. CPU er alltid skyens måling.

**Størrelsestilpasning** for VM-en sier hvor minnet kom fra, og det gjør også linjen dens under **Sky → Forbruk → Besparelser**. En VM som bare vurderes ut fra CPU-en, sier det, med en lenke for å installere vertsinnsamleren. Vertsinnsamleren stempler skyens identitet med trinnet `resourcedetection/cloud`, som [konfigurasjonen i vertsveiledningen](/docs/telemetry/host-otel-collector) har med. En vert med OneUptimes standardkonfigurasjon får trinnet med OneUptimes neste utgivelse, og en vert med egen konfigurasjon må få det lagt til. Kubernetes-noder overlates til [Kubernetes-kostnadsobservability](/docs/telemetry/kubernetes-cost), som vurderer forespørslene til det som kjører på dem.

### Forpliktelser

**Sky → Forbruk → Besparelser** og **Kostnader** for en konto viser hvor mye av forbruket de siste 30 dagene forpliktelsene til hver konto betalte for, og hvor mye av dem som ble brukt, én linje for hver type:

- AWS: Savings Plans og Reserved Instances, fra Cost Explorer. Administrasjonskontoen til en organisasjon leser dem for hver konto i organisasjonen.
- Azure: spareplaner og reservasjoner, fra Cost Management, i amortisert kostnad.
- Google Cloud: rabatter for forpliktet bruk, fra fakturaeksporten din. Eksporten sier ikke hvor mye av en forpliktelse som ble stående ubrukt, så hvor mye som brukes, vises ikke.

En konto uten forpliktelser viser hva som kjørte til on demand-priser som en forpliktelse ville betalt billigere for. Tallene for hver type er skyens egne, og typer legges aldri sammen: en reservasjon og en Savings Plan kan begge telle forbruket til den samme maskinen som sitt å dekke.

## Budsjetter

:::steps
### Opprett et budsjett

Under **Sky → Forbruk → Budsjetter** oppretter du et budsjett: dets **Månedlig beløp** og den **Konto** det gjelder, eller ingen for alle kontoer.

### Velg når det varsler

**Varsle ved** tar andelene av budsjettet det skal varsles ved, i prosent: 80 og 100 til å begynne med. **Varsle når det ligger an til overskridelse** varsler også, én gang i måneden, når tempoet den siste uken ville tatt måneden over budsjettet. **Varsle ved uvanlige dager** varsler også dagen etter en dag som kostet langt mer enn vanlig: se [Uvanlige dager](#uvanlige-dager). **Varselsalvor** og **Vaktpolicyer** sier hvor alvorlige varslene er og hvem som tilkalles.
:::

Et budsjett kontrolleres etter hver lesing av kostnadene og hver time. Når månedens forbruk passerer en terskel, lages det ett varsel for den, den høyeste når en lesing passerer flere på én gang, og en ny måned løser forrige måneds varsler. Et budsjett teller bare kontoene som faktureres i valutaen sin.

AI-agenter kan opprette og endre budsjetter via [MCP-serveren](/docs/ai/mcp-server), og skript med CLI-ens kommando `oneuptime cloud-budget`: se [Ressursoperasjoner](/docs/cli/resource-operations).

### Uvanlige dager

Etter hver lesing holdes hver av en kontos siste 14 hele dager opp mot de 14 dagene før. En dag er uvanlig når en tjeneste kostet det dobbelte av sin vanlige dag eller mer, eller hele kontoen halvannen gang sin vanlige dag eller mer. I begge tilfeller må det være minst 10 mer enn vanlig i kontoens valuta og minst 5 % av kontoens vanlige dag, så noen få øre aldri teller som en topp. En dags vanlige verdi er medianen av de 14 dagene før, så én topp flytter den lite, og en konto vurderes først når den har en ukes kostnader.

**Sky → Forbruk → Kostnader** markerer de uvanlige dagene på det daglige forbruket, over søylene deres, og viser dem under. På tvers av alle kontoer åpner hver markering **Kostnader** for kontoen sin. Et budsjett som regner med kontoen, lager ett varsel for hver konto og dag, dagen etter, og nevner hver tjeneste som lå høyt. En topp som varer i flere dager, varsles den dagen den begynte, og en dag som er mer enn en uke gammel, varsles ikke. Et budsjett som ble opprettet før disse varslene fantes, lager dem ikke før du redigerer det og slår dem på.

## Hvor pengene går

**Sky → Forbruk → Kostnader** deler forbruket i en periode opp etter tjeneste, region, konto eller ressurs, og på tre måter til:

- Etter miljø i app-plattformer: plattformtjenesten til hvert miljø i kontoen og regionen dets, som Amazon ECS eller Cloud Run, og ressursene til et Elastic Beanstalk-miljø etter taggen AWS gir dem.
- Etter app: det en plattform fakturerer en app for ved navn, som en Cloud Run-tjeneste eller en Container App. Amazon ECS fakturerer oppgavene sine og App Service planene sine, så kostnadene til appene deres forblir miljøets.
- Etter tagg: hver verdi av taggen du velger. En kostnad beholder taggene den hadde da den ble lest: etikettene fra en fakturaeksport fra Google Cloud, ellers taggene til ressursen den faktureres til, som på AWS krever Kostnader per ressurs.

Under listen sier kortet hva resten utgjorde: det som ikke er i noe miljø, det som faktureres til et miljø som helhet, eller det som ikke har taggen. Kostnader som ble lest før tagger ble tatt vare på, leses på nytt én gang, så langt tilbake som en første lesing, slik at taggene deres fylles inn.

## Påkrevde tagger

Forbruk er bare så godt fordelt som taggene det har. Under **Sky → Forbruk → Tagger** angir du hvilke tagger alle ressurser må ha, for eksempel `team`, `env` og `cost-center`, og ser hvor mye av forbruket og ressursene dine som har dem, hvilke ressurser som ikke har det, og hvem som opprettet hver nye ressurs uten dem.

:::steps
### Krev en tagg

Velg **Krev en tagg** og skriv inn **Taggnøkkel**. Under **Tillatte verdier** lister du verdiene den kan ha, skilt med komma, eller lar feltet stå tomt for å tillate alle verdier. Velg en **Konto** for å kreve taggen bare i den kontoen. En **Beskrivelse** under **Flere felt** forteller i e-postene hva taggen er til.

### Les dekningen

Siden åpner med hvor mye av forbruket de siste 30 dagene og av ressursene dine som har alle påkrevde tagger. Under det står ressursene som mangler en tagg, de dyreste først, så hver tagg for seg, utviklingen de siste 12 ukene og hver konto.

### Tagg det som mangler

Hver ressurs som mangler en tagg, viser verdien OneUptime foreslår og kommandoen som setter den i skyen din. En ressurs som er deklarert i kode, sier hvilken kode som deklarerer den: legg til taggen der, ellers fjerner neste utrulling den igjen.
:::

- **Nøkler samsvarer uavhengig av store og små bokstaver.** `Team`, `team` og `TEAM` er én nøkkel, og en ressurs har taggen når en hvilken som helst skrivemåte av den har en tillatt verdi. Verdier samsvarer også uavhengig av store og små bokstaver, og en tom verdi er ingen verdi.
- **En tillatt verdi kan være et mønster.** `*` står for vilkårlige tegn og `?` for ett, så `prod-*` passer på `prod-eu` og `prod-us`. Mønstre er ikke regulære uttrykk.
- **En kontos egne tagger.** En tagg som kreves i én konto, erstatter der prosjektets tagg med samme nøkkel, og en konto kan kreve en egen nøkkel. **Tagger** for en konto viser begge.
- **Ingenting endres i skyen din.** OneUptime stopper eller tagger aldri en ressurs på grunn av en manglende tagg. Den gir personer beskjed og foreslår verdien.

### Dekning

- **Forbruk med tagger** er andelen av kostnadene de siste 30 dagene som har alle påkrevde tagger, etter taggene hver kostnad ble lest med. Den beregnes hver gang du åpner siden, så en tagg du krever i dag, måles også over de siste 30 dagene. AWS-kostnader har først tagger når [Kostnader per ressurs](#kostnader-per-ressurs) er slått på: til da viser forbruket til en AWS-konto **Ikke målt** i stedet for 0 %.
- **Ressurser med tagger** er andelen av ressursene tilkoblingene dine viser som har alle påkrevde tagger, slik de er tagget nå.
- **Dekning over tid** viser hver av de siste 12 ukene: forbruk fra kostnadene og ressurser fra tellingen OneUptime gjør hver dag.

### Nye ressurser

En ressurs som tilkoblingen din viser etter kontoens første fullstendige liste, er ny. Tilkoblingen lager en liste hvert 30. minutt, så en ny ressurs blir funnet innen den timen den opprettes. Om en som mangler en påkrevd tagg, gis det beskjed én gang:

- **Hvem som får beskjed.** Den som opprettet den, når endringsloggen til kontoen nevner et medlem av prosjektet ditt ved e-postadressen, og eierne av ressursen, ut fra eierregler og team. Kan ingen av dem få beskjed, får Prosjekteierne det. Hver av dem må kunne lese skyressursene dine.
- **Hvor ofte.** Én e-post i timen samler alt nytt for hver person. Under **Flere innstillinger** sender **Én e-post per ressurs** hver for seg, og **Utløs et varsel** utløser også et varsel for hver konto, med alvorlighetsgraden og vaktpolicyene under **Hvor varsler går**.
- **Når den blir tagget.** En ressurs som tagges før e-posten sendes, utelates fra den, og listen **Nye ressurser** markerer hver som **Tagget** så snart den har dem.

### Foreslåtte verdier

OneUptime foreslår bare en verdi når taggen tillater den:

- **En teamaktig nøkkel**, for eksempel `team`, `owner` eller `squad`: teamet som eier ressursen.
- **En miljøaktig nøkkel**, for eksempel `env`, `environment` eller `stage`: App Platforms-miljøet til en app som kjører som ressursen, eller for en VM utrullingsmiljøet verten rapporterer.
- **Enhver nøkkel**: verdien de fleste ressursene ved siden av har, i samme CloudFormation-stakk, samme Azure-ressursgruppe eller med samme navn før nummeret, for eksempel `web-1` og `web-2`. Minst to må være enige.
- **En tagg som tillater én verdi**: den verdien.

Kommandoen setter taggen i ett trinn, fra skyens eget skall: `aws resourcegroupstaggingapi tag-resources` på AWS, `az tag update --operation Merge` på Azure og `gcloud ... add-labels` eller `--update-labels` for Compute Engine-VM-er og -disker, Cloud Storage-bøtter og Cloud SQL-instanser på Google Cloud.

## Det du ser i OneUptime

- **Oversikten i Sky.** **Sky → Oversikt** viser månedens forbruk mot forrige måneds på samme dag, de dyreste tjenestene og de største måtene å bruke mindre på, ved siden av det som trenger oppmerksomhet.
- **Forbruket hver dag.** **Sky → Forbruk → Kostnader** tegner hver av de siste 30 dagene og markerer dagene som kostet langt mer enn vanlig, viser de dagene og deler en periode opp etter tjeneste, region, konto, ressurs, miljø i app-plattformer, app eller tagg. Kontoene der kostnadene ikke leses, er listet under, hver med årsaken.
- **Kostnadene til en konto.** **Kostnader** for en konto viser det samme for kontoen alene, med forpliktelsene og måtene den kan bruke mindre på.
- **Påkrevde tagger.** **Sky → Forbruk → Tagger** viser hvor mye av forbruket og ressursene som har de påkrevde taggene dine, og **Tagger** for en konto viser det samme for kontoen alene.
- **Kostnaden til en ressurs.** Siden til en ressurs viser hva den har kostet denne måneden og de siste 30 dagene når skyen fakturerer den ved navn, med måtene den kan bruke mindre på og størrelsestilpasningen sin.

## Feilsøking

:::details En konto sier Krever tillatelse
Tilkoblingen kan ikke lese kontoens kostnader ennå. Kjør oppsettkommandoen på nytt fra **Sky → Koble til**: Den legger til det lesingen av kostnader trenger. På Google Cloud gir du også tjenestekontoen **BigQuery Data Viewer** på eksportens datasett.
:::

:::details En konto sier Ikke satt opp
Skyen har ingen kostnader å gi ennå. På AWS slår du på Cost Explorer; på Google Cloud oppgir du eksportens tabell under **Tabell for fakturaeksport**. De første beløpene kommer med neste lesing, innen 12 timer.
:::

:::details En konto sier I kø
Kostnadene venter på tur: Azure Cost Management begrenser hvor raskt kostnadene til en leietaker leses. Kontoen sier når de leses, ved tilkoblingens første lesing fra da av, og ingenting må gjøres. En konto som allerede har beløp, beholder dem i mellomtiden.
:::

:::details Kostnader per ressurs sier Ikke satt opp
Data på ressursnivå er ikke slått på for kontoen. Slå det på med daglig granularitet i Cost Management-innstillingene i AWS-konsollen Billing and Cost Management, for medlemmene i en organisasjon fra administrasjonskontoen dens. AWS klargjør det innen 48 timer, og lesingen neste dag tar det med.
:::

:::details Forpliktelsene sier Krever tillatelse
Tilkoblingen får ennå ikke lese Savings Plans og reservasjoner for kontoen. Kjør oppsettkommandoen dens på nytt fra **Sky → Koble til**: den legger til de fire handlingene de leses med.
:::

:::details Beløpene utelater en konto
Beløpene er i valutaen de fleste kontoene dine faktureres i. En konto som faktureres i en annen, er listet under med valutaen sin, og et budsjett teller bare kontoene som faktureres i budsjettets egen.
:::

:::details Denne måneden er lavere enn i skyens konsoll
Skyen rapporterer den siste dagen eller to for sent, og beløpene er før kreditter og refusjoner. De neste lesingene tar det igjen.
:::

## Neste steg

:::cards
- [Koble til en skykonto](/docs/telemetry/cloud-accounts): Koble til en annen konto, eller kjør kommandoen på nytt.
- [Skyressurser](/docs/telemetry/cloud-resources): Målingene til hver ressurs, fra en egen collector.
- [Kubernetes-kostnadsobservability](/docs/telemetry/kubernetes-cost): Hva hver Kubernetes-arbeidslast koster.
:::
