# Guide för självhosting

Följ den här sidan uppifrån och ned för att gå från en tom server till din egen OneUptime, som körs över HTTPS, har skickat ett testmejl till dig och kan larma dig. Varje steg slutar med hur du ser att det fungerade, och hänvisar till de längre sidorna för detaljerna.

:::cards
- [Installera OneUptime](#installera-oneuptime): Docker Compose på en server, eller Helm-diagrammet på Kubernetes.
- [Gör klart servern](#gör-klart-servern): E-post, sedan sms och samtal, var och en med ett test.
- [Kontrollera din installation](#kontrollera-din-installation): Ett kommando som säger vad som är fel.
- [Snabbstart](/docs/introduction/quickstart): Din första monitor, din första jourpolicy och din första statussida.
:::

## Det här behöver du

- **En server.** För Docker Compose en Linux-server med 8 GB minne, 4 kärnor och 20 GB disk för att prova OneUptime, eller 16 GB, 8 kärnor och 400 GB för ett team: se [Dimensionering och kapacitetsplanering](/docs/installation/sizing). För Helm-diagrammet ett Kubernetes-kluster.
- **Ett domännamn** som folk ska använda för att öppna OneUptime, som `oneuptime.example.com`, med en DNS-`A`-post som pekar på servern. Du kan börja med serverns IP-adress, men ett certifikat från Let's Encrypt kräver ett domännamn.
- **Portarna 80 och 443**, nåbara från internet, för HTTPS.
- **Ett sätt att skicka e-post**: en e-postserver, som ditt företags, Microsoft 365 eller Google Workspace, eller ett konto hos Amazon SES, SendGrid, Mailgun, Postmark eller Resend.
- **Ett Twilio-konto**, för att larmas via sms och telefonsamtal. E-post och push-aviseringar behöver inget.

**Det fungerade när** `dig +short oneuptime.example.com` skriver ut serverns IP-adress.

## Installera OneUptime

:::tabs
@tab Docker Compose
På en ny Ubuntu-, Debian- eller RHEL-baserad server installerar ett enda kommando Docker, Git och Node.js där de saknas, klonar OneUptime till en mapp `oneuptime`, frågar efter adressen folk ska använda och startar det:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

För att göra samma sak för hand, med Docker, Git och Node.js installerade:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Öppna `config.env` och sätt `HOST`, dess första inställning, till ditt domännamn eller din IP-adress, utan `http://`. Det är den enda inställning du måste ändra: e-post, sms och samtal ställs in i Admin Dashboard, och allt under `ADVANCED` fungerar som det är. Starta sedan OneUptime:

```bash
npm start
```

**Det fungerade när** `npm start` slutar med **OneUptime is up!** och adressen att öppna. Första starten tar flera minuter, medan Docker laddar ned avbildningarna. Om `npm start` stannar innan dess säger det vad som ska ändras. [Docker Compose](/docs/installation/docker-compose) har alla detaljer.
@tab Kubernetes
Skapa en `values.yaml` med ditt domännamn eller din IP-adress, utan `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Diagrammet sparar sina data på klustrets standardlagringsklass. Om `kubectl get storageclass` inte markerar någon som `(default)`, lägg till `global.storageClass` med namnet på en av dem. Installera sedan diagrammet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det fungerade när** `kubectl get pods` visar varje pod som `Running` och adressen som `helm install` skrev ut öppnar OneUptime. [Diagrammets installationsguide](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) har alla detaljer.
:::

## Slå på HTTPS

När ditt domännamn pekar på servern låter du OneUptime hämta ett gratis certifikat från Let's Encrypt. Det förnyar certifikatet själv.

:::tabs
@tab Docker Compose
Sätt de här värdena i `config.env` och kör sedan `npm start` igen:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Kör du redan en omvänd proxy, som Caddy, Nginx eller en lastbalanserare? Behåll `PROVISION_SSL=false`, sätt `HTTP_PROTOCOL=https` och `TRUSTED_PROXY_HOPS=2`, och läs [Använd din egen omvända proxy](/docs/installation/docker-compose#använd-din-egen-omvända-proxy).
@tab Kubernetes
Sätt de här värdena i `values.yaml` och tillämpa dem sedan:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

För att i stället avsluta TLS i en egen ingress controller låter du `ssl.provision` vara av och sätter bara `httpProtocol: https`.
:::

**Det fungerade när** `https://oneuptime.example.com` öppnas utan certifikatvarning. Det första certifikatet kommer oftast inom några minuter. Provar du OneUptime på `localhost`? Hoppa över det här steget: ett certifikat kräver ett domännamn.

## Skapa administratörskontot

Öppna din adress, som `https://oneuptime.example.com`, och registrera dig. Det första kontot på en ny server blir dess huvudadministratör, som kan öppna Admin Dashboard på `/admin`.

**Det fungerade när** `/admin` öppnar Admin Dashboard. Så länge e-post, HTTPS eller valet om registrering fortfarande är öppet öppnas det på **Gör klart inställningen av den här servern**.

## Gör klart servern

Sidan **Serverkonfiguration** i Admin Dashboard, på `/admin/setup`, listar vad en ny server behöver, det viktigaste först. E-post, HTTPS och vem som kan registrera sig krävs. Sms och samtal, en global probe, säkerhetskopior och uppdateringskontroller rekommenderas. Varje punkt har en knapp som öppnar platsen där den ställs in, och `npm start` slutar med att skriva ut sidans adress.

:::steps
### Ställ in e-post

Klicka på **Ställ in e-post**. Den öppnar **Inställningar > Aviseringar > E-postmeddelanden**, där du anger din e-postserver (de flesta använder port `587`) eller din e-postleverantör, och adressen som e-post kommer från. Spara, klicka sedan på **Skicka testmejl** och skicka ett till dig själv.

**Det fungerade när** mejlet kommer fram och checklistan markerar E-post som klar. När testet misslyckas visar det vad e-postservern svarade: se [SMTP](/docs/emails/smtp#felsökning).

### Välj vem som kan registrera sig

Alla som kan öppna din adress kan registrera sig. När ditt team har sina konton stänger du av **Tillåt registrering** under **Inställningar > Autentisering**: de du bjuder in till ett projekt kan ändå gå med. För att låta registreringen vara öppen klickar du på **Låt registreringen vara öppen**.

**Det fungerade när** checklistan markerar Registrering som klar.

### Konfigurera sms och samtal, eller använd bara e-post och push

För att larmas via sms och telefonsamtal klickar du på **Konfigurera sms och samtal** och lägger till ditt Twilio-konto under **Inställningar > Aviseringar > Samtal och SMS**: [Twilio-integration](/docs/self-hosted/twilio-integration) visar var du hittar varje värde. Klicka sedan på **Skicka test-sms** och **Ring testsamtal**. För att i stället skicka dem genom en egen gateway, se [SMS- och samtalsgateway](/docs/self-hosted/sms-and-call-gateway). Om e-post och push-aviseringar räcker klickar du på **Använd bara e-post och push**.

**Det fungerade när** sms:et kommer fram och telefonen ringer, eller checklistan visar ditt val.
:::

HTTPS-punkten är klar så snart [Slå på HTTPS](#slå-på-https) fungerar, och varje rekommenderad punkt säger vad du ska göra.

## Kontrollera din installation

:::tabs
@tab Docker Compose
Kör doctor i mappen `oneuptime`:

```bash
npm run doctor
```

Den kontrollerar varje container, `config.env`, att `HOST` når den här servern, certifikatet och ledigt diskutrymme, och frågar OneUptime vad det ser av sig självt, som e-post och prober. Varje problem kommer med sin lösning: se [Kontrollera din installation](/docs/installation/docker-compose#kontrollera-din-installation).
@tab Kubernetes
Kör diagrammets diagnosskript mot ditt kluster, som [diagrammets felsökningsguide](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) visar. Det läser bara, och slutar med en sammanfattning av vad det hittade, det värsta först.
:::

**Det fungerade när** doctor slutar med **Everything looks right.** och avslutas med `0`. Den avslutas med `1` när något behöver åtgärdas, och med `2` när den inte kunde köra sina kontroller. På Kubernetes har sammanfattningen inget fynd `CRITICAL`.

## Övervaka något och bli larmad

Din server kan nu skicka e-post och larma folk. [Snabbstart](/docs/introduction/quickstart) fortsätter i produkten: en monitor för din webbplats, en jourpolicy som larmar dig när den går ned, och en statussida, på ungefär en kvart. Den sista delen deklarerar en testincident, så att du ser larmet komma fram.

## Felsökning

:::details npm start stannar och säger att HOST ännu inte är en adress
`HOST` i `config.env` innehåller fortfarande en platshållare, som `<your-address>`. Sätt den till ditt domännamn eller din IP-adress, utan `http://`, och kör `npm start` igen.
:::

:::details Testmejlet misslyckas
Meddelandet under knappen är vad e-postservern svarade. Kontrollera värdnamnet, porten, användarnamnet och lösenordet, och att e-postservern låter dig skicka från adressen som e-post kommer från. Se [SMTP](/docs/emails/smtp#felsökning).
:::

:::details Webbläsaren varnar för certifikatet
Let's Encrypt behöver portarna 80 och 443 nåbara från internet, och ditt domännamn pekande på den här servern. Vänta några minuter och kör sedan `npm run doctor`: den kontrollerar certifikatet och säger vad som är fel.
:::

## Nästa steg

:::cards
- [Snabbstart](/docs/introduction/quickstart): En monitor, en jourpolicy och en statussida på en kvart.
- [Docker Compose](/docs/installation/docker-compose): Din egen proxy, säkerhetskopior, uppdateringar och checklistan för produktion.
- [Uppgradering](/docs/installation/upgrading): Byt till en ny version, en huvudversion i taget.
- [Arkitektur](/docs/self-hosted/architecture): Hur delarna av OneUptime hänger ihop.
:::
