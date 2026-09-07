# Toegang tot integraties vanuit privénetwerken

Een zelfgehoste OneUptime-instantie kan verzoeken naar Twilio en Microsoft sturen terwijl hun clouddiensten de instantie niet kunnen bereiken. De VPN-verbinding van een medewerker geeft geen van beide aanbieders toegang tot het privénetwerk. Gebruik de [Twilio-installatiehandleiding](/docs/self-hosted/twilio-integration) en de [Teams-installatiehandleiding](/docs/self-hosted/microsoft-teams-integration) samen met de onderstaande netwerkstappen.

## In welke richting is toegang nodig?

| Functie | OneUptime naar aanbieder | Aanbieder naar OneUptime |
| --- | --- | --- |
| Een sms versturen of een eenvoudige uitgaande spraakmelding afspelen | HTTPS | Niet nodig om de sms aan te vragen of meegestuurde spraakinstructies af te spelen |
| Sms-afleverupdates, toetsacties tijdens oproepen, routering van inkomende oproepen | HTTPS | Callbacks vereist; zie de Twilio-handleiding voor de routes |
| Teams-meldingen | HTTPS naar Microsoft-API's | Vereist voor de volledige botintegratie, inclusief het ontdekken van gesprekken |
| Teams-opdrachten, kaartknoppen, installatiegebeurtenissen in chats | HTTPS | `POST /api/microsoft-bot/messages` |

De [instellingen voor toegang tot privénetwerken](/docs/self-hosted/private-network-access) regelen uitgaande verzoeken van OneUptime naar interne diensten. Het inschakelen van `ALLOW_PRIVATE_NETWORK_WEBHOOKS` maakt OneUptime niet bereikbaar voor Twilio of Teams.

## Productie: publiceer een gateway naar de privé-installatie

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Openbare gateway (reverse proxy of load balancer)
          | Privéverbinding; alleen callback-routes
          v
Privé-ingress van OneUptime -> OneUptime-applicatie
```

1. **Kies een hostnaam**, bijvoorbeeld `oneuptime.example.com`. Publiceer openbare DNS-records die naar een internetgerichte gateway verwijzen. Privé-IP-adressen en uitsluitend interne DNS-namen zijn niet bereikbaar voor de aanbieders. Met split-DNS kunnen medewerkers dezelfde hostnaam naar de privé-ingress laten verwijzen en het dashboard via de VPN blijven gebruiken. De privé-ingress moet ook HTTPS aanbieden met een certificaat dat geldig is voor die hostnaam.
2. **Verbind de gateway met OneUptime.** Plaats deze in een DMZ met een route naar de privé-ingress, of gebruik een openbare gateway die via uw eigen site-to-site-VPN/privéverbinding is verbonden. Sta verkeer van de gateway naar de ingress toe op de poort van de achterliggende dienst. Voor Kubernetes/Portainer volstaat een privéservice van het type `ClusterIP` niet: de gateway heeft een ingress/controller of een andere bereikbare achterliggende dienst nodig. Houd databases en andere interne diensten privé.
3. **Beëindig HTTPS op poort 443** met een publiek vertrouwd certificaat en een volledige keten van tussencertificaten. Sta inkomend TCP 443 naar de gateway toe. Alleen een certificaat installeren of DNS wijzigen maakt nog geen route naar de privé-infrastructuur aan.
4. **Stuur alleen de vereiste callback-paden door** uit de tabel in de Twilio-handleiding en `/api/microsoft-bot/messages` voor Teams. Stuur ze via de ingress van OneUptime, die `/notification` al naar de applicatie doorstuurt. Behoud de methode, het oorspronkelijke pad, de querystring, de body, `Authorization` en `X-Twilio-Signature`. Behoud de openbare `Host` en stel vertrouwde `X-Forwarded-Host` en `X-Forwarded-Proto: https` in op de gateway. Verwijder `/api` niet en voeg geen omleidingen toe. Weiger andere paden op de openbare gateway; medewerkers kunnen de privé-ingress gebruiken voor het dashboard en de callbacks voor browseraanmelding.
5. **Behoud de callback-authenticatie.** Stel deze routes vrij van browser-SSO, CAPTCHA en proxy-aanmeldpagina's, omdat aanbieders deze niet kunnen doorlopen. OneUptime valideert nog steeds de callback-tokens, de Twilio-handtekeningen op routes voor inkomende oproepen en de Bot Framework-authenticatie. Verwijder deze controles niet. Sta toegang tot de oorsprong alleen toe vanaf uw gateway en geautoriseerde interne clients en maskeer callback-tokens in logs. Twilio beschrijft deze [DMZ-proxyarchitectuur en webhookbeveiliging](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Stel de canonieke URL van OneUptime in** voordat u een van beide integraties configureert:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-waarden:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Deze instellingen bepalen de gegenereerde URL's; ze richten geen DNS, TLS of firewalltoegang in. Pas de Compose-configuratie of de Helm-release-update toe en wacht tot de applicatie opnieuw is gestart. OneUptime biedt geen afzonderlijke instelling voor de hostnaam van Twilio-callbacks. Als de hostnaam verandert, werk dan bestaande Twilio-webhooks voor telefoonnummers, het Azure Bot-berichteneindpunt en de omleidings-URI's van de appregistratie bij, en download en upload het Teams-manifest opnieuw.

## Uitgaande toegang en IP-beperkingen

Sta DNS-resolutie en uitgaand HTTPS-verkeer vanuit de OneUptime-applicatie toe. Twilio raadt toegang tot `*.twilio.com` aan omdat zijn API-adressen veranderen; zie [Twilio's richtlijnen voor IP-adressen](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams gebruikt `graph.microsoft.com`, `login.microsoftonline.com`, authenticatie-/kanaaleindpunten van Bot Framework en de connectorservice-URL voor het gesprek. Gebruik [Microsofts firewallrichtlijnen](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) en controleer geblokkeerd verkeer tijdens het testen; deze voorbeelden vormen geen volledige domeinlijst.

Gebruik geen Twilio SIP-/mediabereiken of mediabereiken van Teams-clients als bronallowlists voor webhooks. Gewone Twilio-webhookadressen zijn dynamisch; geschikte Twilio-edities bieden [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), waarvoor afzonderlijke configuratie met Twilio vereist is. Microsofts firewallrichtlijnen waarschuwen dat vaste IP-allowlists voor inkomend Bot Framework-verkeer niet worden ondersteund. Authenticeer callbacks in de applicatie in plaats van aan te nemen dat een vast bron-IP de identiteit bewijst.

## Testen en installaties zonder inkomende toegang

Controleer openbare DNS en TLS vanuit een netwerk buiten uw VPN en controleer vervolgens de Teams-route:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Verwacht bij huidige OneUptime-versies `405 Method Not Allowed` met `Allow: POST`. Dit bevestigt dat het GET-verzoek de route heeft bereikt, maar niet dat een geauthenticeerd POST-verzoek van de bot zal werken. Oudere versies kunnen de JSON-404 van OneUptime teruggeven; controleer de inhoud van het antwoord en de proxylogs. TLS-fouten, time-outs of een HTML-foutpagina van een proxy wijzen op certificaat- of routeringsproblemen.

Een GET-verzoek in een browser test geen Twilio POST-callback. Verstuur een echte test-sms, controleer de afleverupdate, beantwoord een testoproep voor een incident en gebruik de toetsactie, stuur daarna de Teams-bot een bericht en druk op een kaartknop. Vergelijk de afleverdiagnostiek van de aanbieder met de gateway- en applicatielogs en maskeer tokens. Alleen succesvolle uitgaande aflevering bewijst niet dat callbacks werken.

Voor ontwikkeling documenteert Twilio [testen via een tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview) en Microsoft [lokaal debuggen van Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Stuur een openbare HTTPS-tunnel door naar een proxy die alleen de vereiste routes toestaat, configureer de resulterende hostnaam zoals hierboven en stop de tunnel na het testen. Een tunnel maakt nog steeds een inkomend eindpunt beschikbaar; de installatie is daardoor niet volledig van netwerken geïsoleerd.

Als het beleid alle inkomende verbindingen verbiedt, kunnen sms-aanvragen en eenvoudige spraakweergave met meegestuurde instructies nog steeds werken via uitgaand HTTPS, maar aflevercallbacks, toetsacties, routering van inkomende oproepen en de volledige Teams-botintegratie niet. Privé-eindpunten van Azure Bot voor Direct Line lossen de Teams-connectiviteit niet op: Microsofts [handleiding voor netwerkisolatie](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) stelt dat het uitschakelen van openbare toegang andere kanalen verwijdert, waaronder Teams. Een volledig losgekoppelde installatie kan deze cloudintegraties niet gebruiken.
