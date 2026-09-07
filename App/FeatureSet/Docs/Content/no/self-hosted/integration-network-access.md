# Integrasjonstilgang fra private nettverk

En selvhostet OneUptime-instans kan sende forespørsler til Twilio og Microsoft selv om skytjenestene deres ikke kan nå den. En ansatts VPN-tilkobling gir ingen av leverandørene tilgang til det private nettverket. Bruk [oppsettsveiledningen for Twilio](/docs/self-hosted/twilio-integration) og [oppsettsveiledningen for Teams](/docs/self-hosted/microsoft-teams-integration) sammen med nettverkstrinnene nedenfor.

## I hvilken retning kreves tilgang?

| Funksjon | OneUptime til leverandør | Leverandør til OneUptime |
| --- | --- | --- |
| Sende en SMS eller spille av et enkelt utgående talevarsel | HTTPS | Ikke nødvendig for å sende inn SMS-en eller spille av medsendte taleinstruksjoner |
| SMS-leveringsoppdateringer, tastetrykk under anrop, ruting av innkommende anrop | HTTPS | Tilbakekall kreves; se rutene i Twilio-veiledningen |
| Teams-varsler | HTTPS til Microsoft-API-er | Påkrevd for hele botintegrasjonen, inkludert oppdagelse av samtaler |
| Teams-kommandoer, kortknapper, installasjonshendelser i chatter | HTTPS | `POST /api/microsoft-bot/messages` |

[Innstillingene for tilgang til private nettverk](/docs/self-hosted/private-network-access) styrer OneUptimes utgående forespørsler til interne tjenester. Aktivering av `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gjør ikke OneUptime tilgjengelig for Twilio eller Teams.

## Produksjon: publiser en gateway til den private installasjonen

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Offentlig gateway (omvendt proxy eller lastbalanserer)
          | Privat tilkobling; bare tilbakekallsruter
          v
Privat OneUptime-ingress -> OneUptime-applikasjon
```

1. **Velg et vertsnavn**, for eksempel `oneuptime.example.com`. Publiser offentlige DNS-poster som peker til en internettvendt gateway. Private IP-adresser og interne DNS-navn er ikke tilgjengelige for leverandørene. Med delt DNS kan ansatte la samme vertsnavn peke til den private ingressen og fortsette å bruke dashbordet via VPN. Den private ingressen må også tilby HTTPS med et sertifikat som er gyldig for dette vertsnavnet.
2. **Koble gatewayen til OneUptime.** Plasser den i en DMZ med en rute til den private ingressen, eller bruk en offentlig gateway koblet til via din egen site-to-site-VPN/private forbindelse. Tillat trafikk fra gateway til ingress på porten til den bakenforliggende tjenesten. For Kubernetes/Portainer er ikke en privat `ClusterIP`-tjeneste alene tilstrekkelig: gatewayen trenger en ingress/controller eller en annen tilgjengelig bakenforliggende tjeneste. Hold databaser og andre interne tjenester private.
3. **Terminer HTTPS på port 443** med et offentlig betrodd sertifikat og en fullstendig kjede av mellomsertifikater. Tillat innkommende TCP 443 til gatewayen. Å installere et sertifikat eller endre DNS oppretter ikke i seg selv en rute til den private bakenforliggende tjenesten.
4. **Videresend bare de nødvendige tilbakekallsstiene** fra tabellen i Twilio-veiledningen og `/api/microsoft-bot/messages` for Teams. Send dem gjennom OneUptimes ingress, som allerede sender `/notification` til applikasjonen. Bevar metoden, den opprinnelige stien, spørringsstrengen, forespørselsinnholdet, `Authorization` og `X-Twilio-Signature`. Bevar offentlig `Host`, og sett betrodde `X-Forwarded-Host` og `X-Forwarded-Proto: https` på gatewayen. Ikke fjern `/api` eller legg til omdirigeringer. Avvis andre stier på den offentlige gatewayen; ansatte kan bruke den private ingressen til dashbordet og tilbakekall ved nettleserpålogging.
5. **Bevar autentiseringen av tilbakekall.** Unnta disse rutene fra nettleser-SSO, CAPTCHA og proxy-påloggingssider fordi leverandørene ikke kan fullføre dem. OneUptime validerer fortsatt tilbakekallstokenene, Twilio-signaturer på ruter for innkommende anrop og Bot Framework-autentisering. Ikke fjern disse kontrollene. Tillat tilgang til opprinnelsesserveren bare fra gatewayen din og autoriserte interne klienter, og skjul tilbakekallstokener i logger. Twilio beskriver denne [DMZ-proxyarkitekturen og webhook-sikkerheten](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Angi OneUptimes kanoniske URL** før du konfigurerer noen av integrasjonene:

   Docker Compose, i `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-verdier:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Disse innstillingene styrer genererte URL-er; de oppretter ikke DNS, TLS eller brannmurtilgang. Bruk Compose-konfigurasjonen eller Helm-utgivelsesoppdateringen, og vent på at applikasjonen starter på nytt. OneUptime har ingen egen innstilling for vertsnavnet til Twilio-tilbakekall. Hvis vertsnavnet endres, må du oppdatere eksisterende Twilio-webhooks for telefonnumre, Azure Bots meldingsendepunkt og appregistreringens omdirigerings-URI-er, og laste ned/laste opp Teams-manifestet på nytt.

## Utgående tilgang og IP-begrensninger

Tillat DNS-oppslag og utgående HTTPS fra OneUptime-applikasjonen. Twilio anbefaler tilgang til `*.twilio.com` fordi API-adressene endres; se [Twilios veiledning om IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams bruker `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks autentiserings-/kanalendepunkter og connector-tjeneste-URL-en for samtalen. Bruk [Microsofts brannmurveiledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0), og undersøk blokkert trafikk under testing; disse eksemplene er ikke en uttømmende domeneliste.

Ikke bruk Twilios SIP-/medieområder eller Teams-klientenes medieområder som tillatelseslister for webhook-kilder. Vanlige Twilio-webhook-adresser er dynamiske; aktuelle Twilio-utgaver tilbyr [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), som krever eget oppsett med Twilio. Microsofts brannmurveiledning advarer om at faste IP-tillatelseslister for innkommende Bot Framework-trafikk ikke støttes. Autentiser tilbakekall i applikasjonen i stedet for å anta at en fast kilde-IP fastslår identiteten.

## Testing og installasjoner uten innkommende tilgang

Kontroller offentlig DNS og TLS fra et nettverk utenfor VPN-en, og kontroller deretter Teams-ruten:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På gjeldende OneUptime-versjoner forventer du `405 Method Not Allowed` med `Allow: POST`. Dette bekrefter at GET-forespørselen nådde ruten, men ikke at en autentisert POST-forespørsel fra boten vil fungere. Eldre versjoner kan returnere OneUptimes JSON-404; undersøk svarinnholdet og proxyloggene. TLS-feil, tidsavbrudd eller en HTML-feilside fra en proxy tyder på sertifikat- eller rutingsproblemer.

En GET-forespørsel i nettleseren tester ikke et Twilio POST-tilbakekall. Send en ekte test-SMS, kontroller leveringsoppdateringen, besvar et testanrop for en hendelse og bruk tastetrykkhandlingen. Send deretter Teams-boten en melding, og trykk på en kortknapp. Sammenhold leverandørens leveringsdiagnostikk med gateway- og applikasjonslogger, og skjul tokener. Vellykket utgående levering alene beviser ikke at tilbakekall fungerer.

For utvikling dokumenterer Twilio [testing gjennom en tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview), og Microsoft dokumenterer [lokal Teams-feilsøking](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Videresend en offentlig HTTPS-tunnel til en proxy som bare tillater nødvendige ruter, konfigurer det resulterende vertsnavnet som ovenfor, og stopp tunnelen etter testing. En tunnel eksponerer fortsatt et innkommende endepunkt; den gjør ikke installasjonen helt nettverksisolert.

Hvis retningslinjene forbyr alle innkommende tilkoblinger, kan SMS-innsending og enkel taleavspilling med medsendte instruksjoner fortsatt fungere med utgående HTTPS, men leveringstilbakekall, tastetrykkhandlinger, ruting av innkommende anrop og hele Teams-botintegrasjonen kan ikke. Private Azure Bot-endepunkter for Direct Line løser ikke Teams-tilkoblingen: Microsofts [veiledning om nettverksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) sier at deaktivering av offentlig tilgang fjerner andre kanaler, inkludert Teams. En helt frakoblet installasjon kan ikke bruke disse skyintegrasjonene.
