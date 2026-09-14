# Twilio-integration til SMS og tale

En selvhostet OneUptime-installation bruger din Twilio-konto til at sende SMS- og talealarmer. Du betaler Twilio direkte. Konfigurer legitimationsoplysningerne i OneUptimes dashboard: levering af notifikationer bruger den gemte konfiguration, og Helm-chartet har ingen værdier til Twilio-legitimationsoplysninger. En ældre migrering importerede `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` og `TWILIO_PHONE_NUMBER`; disse variabler bruges ikke til at opdatere legitimationsoplysningerne i en eksisterende installation.

## 1. Forbered din Twilio-konto

1. Åbn [Twilio Console](https://console.twilio.com/), og find dit **Account SID** og **Auth Token**.
2. Få et Twilio-telefonnummer med de SMS- og/eller talefunktioner, du har brug for. Brug E.164-formatet med landekode til afsender- og modtagernumre.
3. Kontroller kontosaldoen, tilladelser for destinationslande og gældende krav til afsenderregistrering. Prøvekonti har begrænsninger for modtagere, geografi og andet, som kan forhindre rigtige OneUptime-alarmer i at fungere; læs [Twilios dokumentation om konti og prøvekonti](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account), før du tester. Brug en opgraderet konto til produktion.

## 2. Gem legitimationsoplysningerne i OneUptime

For et projekt:

1. Gå til **Project Settings > Notifications > Notification Settings**.
2. Vælg **Create Twilio Config** under **Twilio Config**.
3. Indtast et navn, **Twilio Account SID**, **Twilio Auth Token** og **Twilio Primary Phone Number**. Du kan også indtaste kommaseparerede **Twilio Secondary Phone Numbers** til andre lande.
4. Aktivér **Set as Project Default** for at bruge konfigurationen til SMS'er og opkald til projektmedlemmer, herunder vagtalarmer. Oprettelse af en konfiguration uden at aktivere denne indstilling vælger den ikke til disse notifikationer.
5. Gem. Kun én konfiguration kan være projektets standard. Statussider bruger den konfiguration, der udtrykkeligt er tildelt hver statusside.

For en standard for hele installationen kan en administrator i stedet åbne **Admin Dashboard > Settings > Call and SMS**, redigere Twilio-legitimationsoplysningerne og telefonnumrene og gemme. Medlemsnotifikationer bruger denne globale konfiguration, når projektet ikke har en standard. Hold Auth Token fortroligt.

## 3. Konfigurer netværksadgang

En privat installation kræver udgående HTTPS-adgang til Twilio for at indsende SMS'er og opkald. Twilio anbefaler at tillade udgående HTTPS til `*.twilio.com`, fordi API-adresserne er dynamiske; se [Twilio-IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Anvend dette på OneUptime-applikationens udgående trafik, herunder Kubernetes NetworkPolicies og eksterne firewalls. Tillad DNS-opslag og udgående HTTPS (TCP 443) fra OneUptime-applikationen.

Behovet for indgående adgang afhænger af funktionen:

| Funktion | Skal Twilio kunne nå OneUptime? |
| --- | --- |
| Indsendelse af SMS | Nej. Opdateringer af leveringsstatus kræver dog et callback. |
| Et enkelt testopkald | Nej. OneUptime leverer taleinstruktionerne i den udgående API-anmodning. |
| Tryk på 1 for at bekræfte en vagtalarm | Ja. Twilio sender tastaturinput til OneUptime. |
| Politikker for indgående opkald | Ja. Twilio anmoder om opkaldsinstruktioner og rapporterer opkaldsresultater. |

Følgende er eksterne stier gennem OneUptimes Nginx-gateway; pladsholderne varierer fra notifikation til notifikation:

| Metode | Sti | Formål |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS-leveringsstatus |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bekræftelse via tastaturinput |
| POST | `/notification/incoming-call/voice` | Valgfrie instruktioner til indgående opkald |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Valgfrie resultater af routing af indgående opkald |

OneUptime genererer automatisk URL'erne til SMS og bekræftelse. Erstat ikke deres tokens med en statisk webhook-URL. For indgående opkald skal du følge [Politikker for indgående opkald](/docs/on-call/incoming-call-policy), som konfigurerer nummerets webhook, når du tilknytter et nummer.

Twilio kræver [offentligt tilgængelige webhook-URL'er](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Brug et offentligt betroet TLS-certifikat, og bevar den oprindelige vært, protokol, sti, forespørgselsparametre, anmodningens indhold og `X-Twilio-Signature`-header gennem proxyer. Håndteringen af indgående opkald validerer Twilio-signaturer; SMS-levering bruger et URL-token pr. besked, og tastaturbekræftelse bruger et signeret token i forespørgslen. Eksponer ikke tokens i delte logfiler eller skærmbilleder. Se [Twilios webhook-sikkerhed](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Produktion: offentliggør en gateway til den private installation

1. **Vælg et værtsnavn**, for eksempel `oneuptime.example.com`. Offentliggør DNS-poster, der peger på en gateway mod internettet. Private IP-adresser og interne DNS-navne er ikke tilgængelige for udbyderne. Med split-DNS kan medarbejdere lade samme værtsnavn pege på den private ingress og fortsætte med at bruge dashboardet via VPN. Den private ingress skal også tilbyde HTTPS med et certifikat, der er gyldigt for dette værtsnavn.

2. **Forbind gatewayen til OneUptime.** Placer den i en DMZ med en rute til den private ingress, eller brug en offentlig gateway forbundet via din egen site-to-site-VPN/private forbindelse. Tillad trafik fra gateway til ingress på den bagvedliggende tjenestes port. For Kubernetes/Portainer er en privat `ClusterIP`-tjeneste alene utilstrækkelig: gatewayen kræver en ingress/controller eller en anden tilgængelig bagvedliggende tjeneste. Hold databaser og andre interne tjenester private.

3. **Terminér HTTPS på port 443** med et offentligt betroet certifikat og en komplet kæde af mellemliggende certifikater. Tillad indgående TCP 443 til gatewayen. Installation af et certifikat eller ændring af DNS opretter ikke i sig selv en rute til den private bagvedliggende tjeneste.

4. Offentliggør kun callback-stierne fra tabellen ovenfor gennem OneUptimes Nginx-gateway, som sender `/notification` til applikationen. Bevar `/api` på stien til kvittering med tastetryk. Bevar metode, sti, query-streng, indhold og godkendelsesheadere (`X-Twilio-Signature`). Bevar den offentlige `Host`, og angiv betroede headere `X-Forwarded-Host` og `X-Forwarded-Proto: https`. Tilføj ikke omdirigeringer.

5. Undtag disse stier fra browser-SSO, CAPTCHA og proxyens login-sider. Hold OneUptimes godkendelse aktiveret. Begræns adgang til oprindelsesserveren til gatewayen og autoriserede interne klienter; skjul tokens i logfiler.

6. **Indstil OneUptimes kanoniske URL**:

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

   Erstat eksemplet med dit domæne. Disse indstillinger genererer URL'er; de opretter ikke DNS, TLS eller firewallregler. Anvend Compose-konfigurationen eller Helm-opdateringen, og vent på, at applikationen genstarter. OneUptime har ingen separat indstilling for Twilios callback-værtsnavn. Hvis navnet ændres, skal webhooks for eksisterende Twilio-telefonnumre også opdateres.

[Indstillingerne for adgang til private netværk](/docs/self-hosted/private-network-access) styrer OneUptimes udgående anmodninger til interne tjenester. Aktivering af `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gør ikke OneUptime tilgængelig for Twilio.

### Udgående adgang og IP-begrænsninger

Kildeadresserne for almindelige Twilio-webhooks ændres; brug ikke SIP- eller medieområder som callback-tilladelsesliste. Berettigede udgaver tilbyder [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Kontrollér udgave og understøttede produkter, og konfigurér firewallen med de aktuelt offentliggjorte områder. Fortsæt med at godkende callbacks.

### Test og installationer uden indgående adgang

Uden indgående adgang kan SMS-afsendelse og enkel stemmeafspilning fungere med udgående HTTPS. Leveringsstatus, kvittering med tastetryk og indgående opkaldsrouting kræver tilgængelige callbacks. En helt frakoblet installation kan ikke bruge Twilio.

Til udvikling beskriver Twilios [vejledning til webhook-test](https://www.twilio.com/docs/usage/webhooks/webhook-testing) en offentlig tunnel. Videresend den til en proxy, som kun tillader de nødvendige stier, konfigurér det resulterende værtsnavn som ovenfor, og stop tunnelen efter test. En tunnel giver stadig indgående adgang.

## 4. Test levering og callbacks hver for sig

1. Kontrollér uden for virksomhedens netværk og VPN, at callback-værtsnavnet peger på den offentlige gateway og leverer et gyldigt TLS-certifikat. En GET fra browseren afprøver ikke disse POST-callbacks.
2. Brug **Send Test SMS** og **Send Test Call** i projektets Twilio-konfiguration. Bekræft modtagelsen på modtagerens telefon.
3. Konfigurer brugerens bekræftede SMS-/opkaldskontakt og notifikationsregler, og udløs derefter en kontrolleret vagtalarm. Tryk på 1, og kontroller bekræftelsen i OneUptime. Hvis du bruger politikker for indgående opkald, skal du ringe til det konfigurerede nummer og kontrollere routing og opkaldslog.
4. Kontroller SMS-leveringsstatus i OneUptime og Twilios beskedlogfiler. En accepteret afsendelse er ikke bevis på levering; [Twilio rapporterer senere statusændringer via callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Hvis afsendelsen mislykkes, skal du kontrollere legitimationsoplysninger, nummerets funktioner, kontobegrænsninger og udgående forbindelse. Hvis en besked eller et opkald ankommer, men status eller bekræftelse ikke opdateres, skal du undersøge callback-URL'en og den offentlige ingress' logfiler. Twilios [vejledning om fejl ved HTTP-hentning](https://www.twilio.com/docs/api/errors/11200) hjælper med at diagnosticere utilgængelige callbacks, TLS-problemer og HTTP-fejl. Et vellykket testopkald alene verificerer ikke callback-adgang.
