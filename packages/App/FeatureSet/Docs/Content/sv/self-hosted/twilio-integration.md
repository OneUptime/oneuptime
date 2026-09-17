# Twilio-integration för SMS och röst

En egenhostad OneUptime-installation använder ditt Twilio-konto för att skicka SMS- och röstvarningar. Du betalar Twilio direkt. Konfigurera autentiseringsuppgifterna i OneUptimes instrumentpanel: aviseringsleveransen läser den sparade konfigurationen, och Helm-diagrammet har inga värden för Twilio-autentiseringsuppgifter. En äldre migrering importerade `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` och `TWILIO_PHONE_NUMBER`; att ändra dessa variabler är inte sättet att uppdatera autentiseringsuppgifterna i en befintlig installation.

## 1. Förbered ditt Twilio-konto

1. Öppna [Twilio Console](https://console.twilio.com/) och hämta ditt **Account SID** och **Auth Token**.
2. Skaffa ett Twilio-telefonnummer med de SMS- och/eller röstfunktioner du behöver. Använd E.164-format inklusive landskod för avsändarens och mottagarens nummer.
3. Kontrollera kontosaldot, behörigheter för destinationsländer och tillämpliga krav på avsändarregistrering. Provkonton har begränsningar för mottagare, geografiska områden och annat som kan hindra riktiga OneUptime-varningar från att fungera; läs [Twilios dokumentation om konton och provkonton](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) före testning. Använd ett uppgraderat konto i produktion.

## 2. Spara autentiseringsuppgifterna i OneUptime

För ett projekt:

1. Gå till **Project Settings > Notifications > Notification Settings**.
2. Välj **Create Twilio Config** under **Twilio Config**.
3. Ange ett namn, **Twilio Account SID**, **Twilio Auth Token** och **Twilio Primary Phone Number**. Du kan även ange kommaseparerade **Twilio Secondary Phone Numbers** för andra länder.
4. Aktivera **Set as Project Default** för att använda den här konfigurationen för SMS och samtal till projektmedlemmar, inklusive jouraviseringar. Om du skapar en konfiguration utan att aktivera inställningen väljs den inte för dessa aviseringar.
5. Spara. Endast en konfiguration kan vara projektets standard. Statussidor använder den konfiguration som uttryckligen tilldelats varje statussida.

För ett standardvärde för hela installationen kan en administratör i stället öppna **Admin Dashboard > Settings > Call and SMS**, redigera Twilio-autentiseringsuppgifterna och telefonnumren och spara. Medlemsaviseringar använder den här globala konfigurationen när projektet saknar en standard. Håll Auth Token hemlig.

## 3. Konfigurera nätverksåtkomst

En privat installation behöver utgående HTTPS-åtkomst till Twilio för att begära SMS och samtal. Twilio rekommenderar att tillåta utgående HTTPS till `*.twilio.com` eftersom API-adresserna är dynamiska; se [Twilios IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Tillämpa detta på OneUptime-applikationens utgående trafik, inklusive Kubernetes NetworkPolicies och externa brandväggar. Tillåt DNS-uppslagning och utgående HTTPS (TCP 443) från OneUptime-applikationen.

Behovet av inkommande åtkomst beror på funktionen:

| Funktion | Behöver Twilio nå OneUptime? |
| --- | --- |
| Begära SMS-utskick | Nej. Uppdateringar av leveransstatus kräver däremot ett återanrop. |
| Ett enkelt testsamtal | Nej. OneUptime skickar med röstinstruktionerna i den utgående API-begäran. |
| Trycka på 1 för att bekräfta en jourvarning | Ja. Twilio skickar knapptryckningen till OneUptime. |
| Policyer för inkommande samtal | Ja. Twilio begär samtalsinstruktioner och rapporterar uppringningsresultat. |

Följande är externa sökvägar genom OneUptimes Nginx-gateway; platshållarna varierar per avisering:

| Metod | Sökväg | Syfte |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS-leveransstatus |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bekräftelse med knapptryckning |
| POST | `/notification/incoming-call/voice` | Valfria instruktioner för inkommande samtal |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Valfria routningsresultat för inkommande samtal |

OneUptime genererar URL:erna för SMS och bekräftelse automatiskt. Ersätt inte deras token med en statisk webhook-URL. För inkommande samtal följer du [Policyer för inkommande samtal](/docs/on-call/incoming-call-policy), som konfigurerar numrets webhook när du kopplar ett nummer.

Twilio kräver [offentligt tillgängliga webhook-URL:er](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Använd ett offentligt betrott TLS-certifikat och bevara ursprunglig värd, protokoll, sökväg, frågeparametrar, begärans innehåll och `X-Twilio-Signature`-header genom proxyservrar. Hanterarna för inkommande samtal validerar Twilio-signaturer; SMS-leverans använder en URL-token per meddelande och knapptryckningsbekräftelse använder en signerad frågetoken. Exponera inte token i delade loggar eller skärmbilder. Se [Twilios webhook-säkerhet](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Produktion: publicera en gateway till den privata installationen

1. **Välj ett värdnamn**, till exempel `oneuptime.example.com`. Publicera offentliga DNS-poster som pekar på en gateway mot internet. Privata IP-adresser och interna DNS-namn är inte nåbara för leverantörerna. Med delad DNS kan anställda låta samma värdnamn peka på den privata ingressen och fortsätta använda instrumentpanelen via VPN. Den privata ingressen måste också erbjuda HTTPS med ett certifikat som är giltigt för värdnamnet.

2. **Anslut gatewayen till OneUptime.** Placera den i en DMZ med en väg till den privata ingressen eller använd en offentlig gateway ansluten via din egen site-to-site-VPN/privata länk. Tillåt trafik från gateway till ingress på den bakomliggande tjänstens port. För Kubernetes/Portainer räcker inte en privat `ClusterIP`-tjänst: gatewayen behöver en ingress/controller eller en annan nåbar bakomliggande tjänst. Håll databaser och andra interna tjänster privata.

3. **Terminera HTTPS på port 443** med ett offentligt betrott certifikat och en fullständig kedja av mellanliggande certifikat. Tillåt inkommande TCP 443 till gatewayen. Att installera ett certifikat eller ändra DNS skapar inte i sig en väg till den privata bakomliggande tjänsten.

4. Publicera endast callback-sökvägarna i tabellen ovan via OneUptimes Nginx-gateway, som kopplar `/notification` till applikationen. Behåll `/api` på sökvägen för kvittering med knapptryckning. Bevara metod, sökväg, frågesträng, innehåll och autentiseringshuvuden (`X-Twilio-Signature`). Behåll offentlig `Host` och ange betrodda huvuden `X-Forwarded-Host` och `X-Forwarded-Proto: https`. Lägg inte till omdirigeringar.

5. Undanta dessa sökvägar från webbläsar-SSO, CAPTCHA och proxyns inloggningssidor. Behåll OneUptimes autentisering aktiverad. Begränsa åtkomst till ursprungsservern till gatewayen och behöriga interna klienter; maskera token i loggar.

6. **Ange OneUptimes kanoniska URL**:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-värden:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Ersätt exemplet med din domän. Inställningarna genererar URL:er; de skapar inte DNS, TLS eller brandväggsregler. Tillämpa Compose-konfigurationen eller Helm-uppdateringen och vänta på att applikationen startas om. OneUptime har ingen separat inställning för Twilios callback-värdnamn. Om namnet ändras ska även webhooks för befintliga Twilio-telefonnummer uppdateras.

[Inställningarna för privat nätverksåtkomst](/docs/self-hosted/private-network-access) styr OneUptimes utgående begäranden till interna tjänster. Att aktivera `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gör inte OneUptime nåbart för Twilio.

### Utgående åtkomst och IP-begränsningar

Källadresserna för vanliga Twilio-webhooks ändras; använd inte SIP- eller medieintervall som tillåtelselista för callbacks. Berättigade utgåvor erbjuder [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Kontrollera behörighet och stödda produkter och konfigurera brandväggen med de aktuella publicerade intervallen. Fortsätt autentisera callbacks.

### Testning och installationer utan inkommande åtkomst

Utan inkommande åtkomst kan SMS-sändning och enkel röstuppspelning fungera med utgående HTTPS. Leveransstatus, kvittering med knapptryckning och dirigering av inkommande samtal kräver nåbara callbacks. En helt frånkopplad installation kan inte använda Twilio.

För utveckling beskriver Twilios [guide för webhook-testning](https://www.twilio.com/docs/usage/webhooks/webhook-testing) en offentlig tunnel. Vidarebefordra den till en proxy som endast tillåter nödvändiga sökvägar, konfigurera det resulterande värdnamnet enligt ovan och stoppa tunneln efter testningen. En tunnel exponerar fortfarande inkommande åtkomst.

## 4. Testa leverans och återanrop separat

1. Kontrollera utanför företagsnätverket och VPN att callback-värdnamnet pekar på den offentliga gatewayen och visar ett giltigt TLS-certifikat. En GET från webbläsaren testar inte dessa POST-callbacks.
2. Använd **Send Test SMS** och **Send Test Call** i projektets Twilio-konfiguration. Bekräfta mottagningen på mottagarens telefon.
3. Konfigurera användarens verifierade SMS-/samtalskontakt och aviseringsregler och utlös sedan en kontrollerad jourvarning. Tryck på 1 och kontrollera bekräftelsen i OneUptime. Om du använder policyer för inkommande samtal ringer du det konfigurerade numret och kontrollerar dirigering och samtalslogg.
4. Kontrollera SMS-leveransstatus i OneUptime och Twilios meddelandeloggar. Ett godkänt sändningsförsök bevisar inte leverans; [Twilio rapporterar senare statusändringar via återanrop](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Om sändningen misslyckas kontrollerar du autentiseringsuppgifter, numrets funktioner, kontobegränsningar och utgående anslutning. Om ett meddelande eller samtal kommer fram men status eller bekräftelse inte uppdateras undersöker du återanrops-URL:en och den offentliga ingressens loggar. Twilios [vägledning om HTTP-hämtningsfel](https://www.twilio.com/docs/api/errors/11200) hjälper till att diagnostisera onåbara återanrop, TLS-problem och HTTP-fel. Ett lyckat testsamtal verifierar inte i sig återanropsåtkomsten.
