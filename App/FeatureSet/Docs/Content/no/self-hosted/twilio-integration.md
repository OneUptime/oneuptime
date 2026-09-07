# Twilio-integrasjon for SMS og tale

En selvhostet OneUptime-installasjon bruker Twilio-kontoen din til å sende SMS- og talevarsler. Du betaler Twilio direkte. Konfigurer påloggingsinformasjonen i OneUptime-dashbordet: levering av varsler bruker lagret konfigurasjon, og Helm-chartet har ingen verdier for Twilio-påloggingsinformasjon. En eldre migrering importerte `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` og `TWILIO_PHONE_NUMBER`; endring av disse variablene er ikke måten å oppdatere påloggingsinformasjonen i en eksisterende installasjon på.

## 1. Klargjør Twilio-kontoen

1. Åpne [Twilio Console](https://console.twilio.com/), og finn **Account SID** og **Auth Token**.
2. Skaff et Twilio-telefonnummer med SMS- og/eller talefunksjonene du trenger. Bruk E.164-format med landskode for avsender- og mottakernumre.
3. Kontroller kontosaldo, tillatelser for mottakerland og gjeldende krav til avsenderregistrering. Prøvekontoer har begrensninger for mottakere, geografi og andre forhold som kan hindre faktiske OneUptime-varsler i å fungere; les [Twilios dokumentasjon for kontoer og prøvekontoer](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) før testing. Bruk en oppgradert konto i produksjon.

## 2. Lagre påloggingsinformasjonen i OneUptime

For et prosjekt:

1. Gå til **Project Settings > Notifications > Notification Settings**.
2. Velg **Create Twilio Config** under **Twilio Config**.
3. Skriv inn et navn, **Twilio Account SID**, **Twilio Auth Token** og **Twilio Primary Phone Number**. Du kan også angi kommaseparerte **Twilio Secondary Phone Numbers** for andre land.
4. Aktiver **Set as Project Default** for å bruke denne konfigurasjonen til SMS-er og anrop til prosjektmedlemmer, inkludert vaktvarsler. Hvis du oppretter en konfigurasjon uten å aktivere denne innstillingen, velges den ikke for disse varslene.
5. Lagre. Bare én konfigurasjon kan være prosjektets standard. Statussider bruker konfigurasjonen som er uttrykkelig tilordnet hver statusside.

For en standard for hele installasjonen kan en administrator i stedet åpne **Admin Dashboard > Settings > Call and SMS**, redigere Twilio-påloggingsinformasjonen og telefonnumrene og lagre. Medlemsvarsler bruker denne globale konfigurasjonen når prosjektet ikke har en standard. Hold Auth Token hemmelig.

## 3. Konfigurer nettverkstilgang

En privat installasjon trenger utgående HTTPS-tilgang til Twilio for å sende inn SMS-er og anrop. Twilio anbefaler å tillate utgående HTTPS til `*.twilio.com` fordi API-adressene er dynamiske; se [Twilio-IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Bruk dette for den utgående trafikken til OneUptime-applikasjonen, inkludert Kubernetes NetworkPolicies og eksterne brannmurer.

Behovet for innkommende tilgang avhenger av funksjonen:

| Funksjon | Må Twilio kunne nå OneUptime? |
| --- | --- |
| Innsending av SMS | Nei. Oppdateringer av leveringsstatus krever imidlertid et tilbakekall. |
| Et enkelt testanrop | Nei. OneUptime sender taleinstruksjonene med den utgående API-forespørselen. |
| Trykke på 1 for å bekrefte et vaktvarsel | Ja. Twilio sender tastetrykket til OneUptime. |
| Retningslinjer for innkommende anrop | Ja. Twilio ber om anropsinstruksjoner og rapporterer oppringingsresultater. |

For tilbakekall følger du [nettverkstilgang for Twilio og Microsoft Teams](/docs/self-hosted/integration-network-access) for å publisere de nødvendige HTTPS-rutene gjennom en ingress eller omvendt proxy, samtidig som dashbordet forblir privat. En VPN på en administrators bærbare datamaskin gir ikke Twilio tilkobling.

Angi `HOST=oneuptime.example.com` og `HTTP_PROTOCOL=https` i Docker Composes `config.env`, eller `host: oneuptime.example.com` og `httpProtocol: https` i Helm-verdiene, og bruk deretter endringen i installasjonen. Erstatt eksempelet med domenet ditt. Disse innstillingene bestemmer de genererte URL-ene; de oppretter ikke DNS-poster, sertifikater eller brannmurregler. OneUptime har ingen egen innstilling for vertsnavnet til Twilio-tilbakekall.

Følgende er eksterne stier gjennom OneUptimes Nginx-gateway; plassholderne varierer per varsel:

| Metode | Sti | Formål |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS-leveringsstatus |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bekreftelse med tastetrykk |
| POST | `/notification/incoming-call/voice` | Valgfrie instruksjoner for innkommende anrop |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Valgfrie rutingsresultater for innkommende anrop |

OneUptime genererer URL-ene for SMS og bekreftelse automatisk. Ikke erstatt tokenene deres med en statisk webhook-URL. For innkommende anrop følger du [Retningslinjer for innkommende anrop](/docs/on-call/incoming-call-policy), som konfigurerer nummerets webhook når du tilknytter et nummer.

Twilio krever [offentlig tilgjengelige webhook-URL-er](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Bruk et offentlig betrodd TLS-sertifikat, og bevar opprinnelig vert, protokoll, sti, spørreparametere, forespørselsinnhold og `X-Twilio-Signature`-header gjennom proxyer. Håndtererne for innkommende anrop validerer Twilio-signaturer; SMS-levering bruker et URL-token per melding, og tastetrykkbekreftelse bruker et signert spørringstoken. Ikke eksponer tokener i delte logger eller skjermbilder. Se [Twilios webhook-sikkerhet](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Test levering og tilbakekall hver for seg

1. Bruk **Send Test SMS** og **Send Test Call** i prosjektets Twilio-konfigurasjon. Bekreft mottak på mottakerens telefon.
2. Konfigurer brukerens bekreftede SMS-/anropskontakt og varslingsregler, og utløs deretter et kontrollert vaktvarsel. Trykk på 1, og kontroller bekreftelsen i OneUptime.
3. Kontroller SMS-leveringsstatus i OneUptime og Twilios meldingslogger. En akseptert sending er ikke bevis på levering; [Twilio rapporterer senere statusendringer gjennom tilbakekall](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Hvis sendingen mislykkes, kontrollerer du påloggingsinformasjon, nummerets funksjoner, kontobegrensninger og utgående tilkobling. Hvis en melding eller et anrop kommer frem, men status eller bekreftelse ikke oppdateres, undersøker du tilbakekalls-URL-en og loggene til den offentlige ingressen. Twilios [veiledning om HTTP-hentefeil](https://www.twilio.com/docs/api/errors/11200) hjelper med å diagnostisere utilgjengelige tilbakekall, TLS-problemer og HTTP-feil. Et vellykket testanrop alene verifiserer ikke tilbakekallstilgangen.
