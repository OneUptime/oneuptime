# Integrationsadgang fra private netværk

En selvhostet OneUptime-instans kan sende anmodninger til Twilio og Microsoft, selvom deres cloudtjenester ikke kan nå den. En medarbejders VPN-forbindelse giver ikke nogen af udbyderne adgang til det private netværk. Brug [Twilio-opsætningsvejledningen](/docs/self-hosted/twilio-integration) og [Teams-opsætningsvejledningen](/docs/self-hosted/microsoft-teams-integration) sammen med netværkstrinnene nedenfor.

## I hvilken retning kræves der adgang?

| Funktion | OneUptime til udbyder | Udbyder til OneUptime |
| --- | --- | --- |
| Send en SMS eller afspil en enkel udgående talealarm | HTTPS | Ikke nødvendigt for at indsende SMS'en eller afspille medsendte taleinstruktioner |
| SMS-leveringsopdateringer, tastaturhandlinger under opkald, routing af indgående opkald | HTTPS | Callbacks er påkrævet; se ruterne i Twilio-vejledningen |
| Teams-notifikationer | HTTPS til Microsoft-API'er | Påkrævet til den fulde botintegration, herunder registrering af samtaler |
| Teams-kommandoer, kortknapper, installationshændelser i chats | HTTPS | `POST /api/microsoft-bot/messages` |

[Indstillingerne for adgang til private netværk](/docs/self-hosted/private-network-access) styrer OneUptimes udgående anmodninger til interne tjenester. Aktivering af `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gør ikke OneUptime tilgængelig for Twilio eller Teams.

## Produktion: offentliggør en gateway til den private installation

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Offentlig gateway (reverse proxy eller load balancer)
          | Privat forbindelse; kun callback-ruter
          v
Privat OneUptime-ingress -> OneUptime-applikation
```

1. **Vælg et værtsnavn**, for eksempel `oneuptime.example.com`. Offentliggør DNS-poster, der peger på en gateway mod internettet. Private IP-adresser og interne DNS-navne er ikke tilgængelige for udbyderne. Med split-DNS kan medarbejdere lade samme værtsnavn pege på den private ingress og fortsætte med at bruge dashboardet via VPN. Den private ingress skal også tilbyde HTTPS med et certifikat, der er gyldigt for dette værtsnavn.
2. **Forbind gatewayen til OneUptime.** Placer den i en DMZ med en rute til den private ingress, eller brug en offentlig gateway forbundet via din egen site-to-site-VPN/private forbindelse. Tillad trafik fra gateway til ingress på den bagvedliggende tjenestes port. For Kubernetes/Portainer er en privat `ClusterIP`-tjeneste alene utilstrækkelig: gatewayen kræver en ingress/controller eller en anden tilgængelig bagvedliggende tjeneste. Hold databaser og andre interne tjenester private.
3. **Terminér HTTPS på port 443** med et offentligt betroet certifikat og en komplet kæde af mellemliggende certifikater. Tillad indgående TCP 443 til gatewayen. Installation af et certifikat eller ændring af DNS opretter ikke i sig selv en rute til den private bagvedliggende tjeneste.
4. **Videresend kun de nødvendige callback-stier** fra tabellen i Twilio-vejledningen og `/api/microsoft-bot/messages` til Teams. Send dem gennem OneUptimes ingress, som allerede sender `/notification` til applikationen. Bevar metoden, den oprindelige sti, forespørgselsstrengen, anmodningens indhold, `Authorization` og `X-Twilio-Signature`. Bevar den offentlige `Host`, og indstil betroede `X-Forwarded-Host` og `X-Forwarded-Proto: https` på gatewayen. Fjern ikke `/api`, og tilføj ikke omdirigeringer. Afvis andre stier på den offentlige gateway; medarbejdere kan bruge den private ingress til dashboardet og callbacks ved browserlogin.
5. **Bevar callback-godkendelsen.** Undtag disse ruter fra browser-SSO, CAPTCHA og proxyloginsider, fordi udbyderne ikke kan gennemføre dem. OneUptime validerer fortsat sine callback-tokens, Twilio-signaturer på ruter for indgående opkald og Bot Framework-godkendelse. Fjern ikke disse kontroller. Tillad kun adgang til oprindelsesserveren fra din gateway og autoriserede interne klienter, og masker callback-tokens i logfiler. Twilio beskriver denne [DMZ-proxyarkitektur og webhook-sikkerhed](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Indstil OneUptimes kanoniske URL**, før du konfigurerer nogen af integrationerne:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-værdier:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Disse indstillinger styrer genererede URL'er; de opretter ikke DNS, TLS eller firewalladgang. Anvend Compose-konfigurationen eller Helm-releaseopdateringen, og vent på, at applikationen genstarter. OneUptime har ingen særskilt indstilling for Twilio-callbacks' værtsnavn. Hvis værtsnavnet ændres, skal du opdatere eksisterende Twilio-webhooks for telefonnumre, Azure Bots meddelelsesendepunkt og appregistreringens omdirigerings-URI'er samt downloade/uploade Teams-manifestet igen.

## Udgående adgang og IP-begrænsninger

Tillad DNS-opslag og udgående HTTPS fra OneUptime-applikationen. Twilio anbefaler adgang til `*.twilio.com`, fordi API-adresserne ændres; se [Twilios vejledning om IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams bruger `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks godkendelses-/kanalendepunkter og samtalens connector-service-URL. Brug [Microsofts firewallvejledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0), og undersøg blokeret trafik under test; disse eksempler er ikke en udtømmende domæneliste.

Brug ikke Twilios SIP-/medieintervaller eller Teams-klienters medieintervaller som tilladelseslister for webhook-kilder. Almindelige Twilio-webhook-adresser er dynamiske; relevante Twilio-udgaver tilbyder [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), som kræver særskilt opsætning med Twilio. Microsofts firewallvejledning advarer om, at faste IP-tilladelseslister til indgående Bot Framework-trafik ikke understøttes. Godkend callbacks i applikationen frem for at antage, at en fast kilde-IP fastslår identiteten.

## Test og installationer uden indgående adgang

Kontroller offentlig DNS og TLS fra et netværk uden for din VPN, og kontroller derefter Teams-ruten:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På aktuelle OneUptime-versioner skal du forvente `405 Method Not Allowed` med `Allow: POST`. Det bekræfter, at GET-anmodningen nåede ruten, men ikke at en godkendt POST-anmodning fra botten vil fungere. Ældre versioner kan returnere OneUptimes JSON-404; undersøg svarets indhold og proxylogfilerne. TLS-fejl, timeouts eller en proxys HTML-fejlside tyder på certifikat- eller routingproblemer.

Et GET-kald i browseren tester ikke et Twilio POST-callback. Send en rigtig test-SMS, kontroller leveringsopdateringen, besvar et testopkald om en hændelse, og brug tastaturhandlingen. Send derefter en besked til Teams-botten, og tryk på en kortknap. Sammenhold udbyderens leveringsdiagnostik med gatewayens og applikationens logfiler, og masker tokens. Vellykket udgående levering alene beviser ikke, at callbacks fungerer.

Til udvikling beskriver Twilio [test via en tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview), og Microsoft beskriver [lokal Teams-fejlfinding](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Videresend en offentlig HTTPS-tunnel til en proxy, der kun tillader de nødvendige ruter, konfigurer det resulterende værtsnavn som ovenfor, og stop tunnelen efter testen. En tunnel eksponerer stadig et indgående endepunkt; den gør ikke installationen netværksisoleret.

Hvis politikken forbyder alle indgående forbindelser, kan SMS-indsendelse og enkel taleafspilning med medsendte instruktioner stadig fungere via udgående HTTPS, men leveringscallbacks, tastaturhandlinger, routing af indgående opkald og den fulde Teams-botintegration kan ikke. Azure Bots private endepunkter til Direct Line løser ikke Teams-forbindelsen: Microsofts [vejledning om netværksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) angiver, at deaktivering af offentlig adgang fjerner andre kanaler, herunder Teams. En helt frakoblet installation kan ikke bruge disse cloudintegrationer.
