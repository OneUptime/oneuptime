# Twilio-integratie voor sms en spraak

Een zelfgehoste OneUptime-installatie gebruikt uw Twilio-account om sms- en spraakmeldingen te versturen. U betaalt Twilio rechtstreeks. Configureer de inloggegevens in het dashboard van OneUptime: voor de aflevering van meldingen wordt de opgeslagen configuratie gebruikt en de Helm-chart heeft geen waarden voor Twilio-inloggegevens. Een oudere migratie importeerde `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` en `TWILIO_PHONE_NUMBER`; door deze variabelen te wijzigen werkt u de inloggegevens van een bestaande installatie niet bij.

## 1. Bereid uw Twilio-account voor

1. Open de [Twilio Console](https://console.twilio.com/) en zoek uw **Account SID** en **Auth Token** op.
2. Neem een Twilio-telefoonnummer met de benodigde sms- en/of spraakmogelijkheden. Gebruik de E.164-notatie, inclusief landcode, voor de nummers van afzender en ontvanger.
3. Controleer het accountsaldo, de machtigingen voor bestemmingslanden en de toepasselijke vereisten voor afzenderregistratie. Proefaccounts hebben beperkingen voor ontvangers, geografische gebieden en andere zaken die echte OneUptime-meldingen kunnen blokkeren; lees vóór het testen [Twilio's documentatie over accounts en proefaccounts](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account). Gebruik een opgewaardeerd account voor productie.

## 2. Sla de inloggegevens op in OneUptime

Voor een project:

1. Ga naar **Project Settings > Notifications > Notification Settings**.
2. Selecteer bij **Twilio Config** de optie **Create Twilio Config**.
3. Voer een naam, **Twilio Account SID**, **Twilio Auth Token** en **Twilio Primary Phone Number** in. Voer desgewenst door komma's gescheiden **Twilio Secondary Phone Numbers** voor andere landen in.
4. Schakel **Set as Project Default** in om deze configuratie te gebruiken voor sms-berichten en oproepen aan projectleden, inclusief bereikbaarheidsmeldingen. Een configuratie aanmaken zonder deze schakelaar in te schakelen selecteert deze niet voor die meldingen.
5. Sla op. Slechts één configuratie kan de projectstandaard zijn. Statuspagina's gebruiken de configuratie die expliciet aan elke statuspagina is toegewezen.

Voor een standaard voor de hele installatie kan een beheerder ook **Admin Dashboard > Settings > Call and SMS** openen, de Twilio-inloggegevens en telefoonnummers bewerken en opslaan. Meldingen aan leden gebruiken deze algemene configuratie als hun project geen standaard heeft. Houd het Auth Token geheim.

## 3. Configureer netwerktoegang

Een privé-installatie heeft uitgaande HTTPS-toegang tot Twilio nodig om sms-berichten en oproepen aan te vragen. Twilio raadt aan uitgaande HTTPS naar `*.twilio.com` toe te staan, omdat de API-adressen dynamisch zijn; zie [IP-adressen van Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Pas dit toe op het uitgaande verkeer van de OneUptime-applicatie, inclusief Kubernetes NetworkPolicies en externe firewalls.

De behoefte aan inkomende toegang hangt af van de functie:

| Functie | Moet Twilio OneUptime kunnen bereiken? |
| --- | --- |
| Sms-verzending aanvragen | Nee. Voor updates van de afleverstatus is wel een callback nodig. |
| Een eenvoudige testoproep | Nee. OneUptime levert de gesproken instructies mee met het uitgaande API-verzoek. |
| Op 1 drukken om een bereikbaarheidsmelding te bevestigen | Ja. Twilio stuurt de toetsinvoer naar OneUptime. |
| Beleid voor inkomende oproepen | Ja. Twilio vraagt oproepinstructies op en rapporteert de belresultaten. |

Volg voor callbacks de instructies voor [netwerktoegang voor Twilio en Microsoft Teams](/docs/self-hosted/integration-network-access) om de benodigde HTTPS-routes via een ingress of reverse proxy openbaar beschikbaar te maken terwijl het dashboard privé blijft. Een VPN op de laptop van een beheerder biedt Twilio geen verbinding.

Stel `HOST=oneuptime.example.com` en `HTTP_PROTOCOL=https` in het bestand `config.env` van Docker Compose in, of `host: oneuptime.example.com` en `httpProtocol: https` in de Helm-waarden, en pas vervolgens de implementatiewijziging toe. Vervang het voorbeeld door uw domein. Deze instellingen bepalen de gegenereerde URL's; ze maken geen DNS-records, certificaten of firewallregels aan. OneUptime heeft geen afzonderlijke instelling voor de hostnaam van Twilio-callbacks.

Dit zijn de externe paden via de Nginx-gateway van OneUptime; tijdelijke aanduidingen verschillen per melding:

| Methode | Pad | Doel |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Afleverstatus van sms-berichten |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bevestiging via toetsinvoer |
| POST | `/notification/incoming-call/voice` | Optionele instructies voor inkomende oproepen |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Optionele routeringsresultaten van inkomende oproepen |

OneUptime genereert de URL's voor sms en bevestiging automatisch. Vervang hun tokens niet door een statische webhook-URL. Volg voor inkomende oproepen [Beleid voor inkomende oproepen](/docs/on-call/incoming-call-policy); hierbij wordt de webhook van het nummer geconfigureerd wanneer u een nummer koppelt.

Twilio vereist [openbaar bereikbare webhook-URL's](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Gebruik een publiek vertrouwd TLS-certificaat en behoud de oorspronkelijke host, het protocol, het pad, de queryparameters, de body en de header `X-Twilio-Signature` bij doorgifte door proxies. De handlers voor inkomende oproepen valideren Twilio-handtekeningen; sms-aflevering gebruikt een URL-token per bericht en toetsbevestiging gebruikt een ondertekend querytoken. Maak tokens niet zichtbaar in gedeelde logs of schermafbeeldingen. Zie [Webhookbeveiliging van Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Test aflevering en callbacks afzonderlijk

1. Gebruik **Send Test SMS** en **Send Test Call** in de Twilio-configuratie van het project. Controleer de ontvangst op de telefoon van de ontvanger.
2. Configureer het geverifieerde sms-/oproepcontact en de meldingsregels van de gebruiker en activeer daarna een gecontroleerde bereikbaarheidsmelding. Druk op 1 en controleer de bevestiging in OneUptime.
3. Controleer de sms-afleverstatus in OneUptime en in de berichtenlogs van Twilio. Een geaccepteerd verzendverzoek bewijst niet dat het bericht is afgeleverd; [Twilio rapporteert latere statuswijzigingen via callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Als verzending mislukt, controleer dan de inloggegevens, nummermogelijkheden, accountbeperkingen en uitgaande verbinding. Als een bericht of oproep aankomt maar de status of bevestiging niet wordt bijgewerkt, controleer dan de callback-URL en de logs van de openbare ingress. Twilio's [instructies bij HTTP-ophaalfouten](https://www.twilio.com/docs/api/errors/11200) helpen bij het onderzoeken van onbereikbare callbacks, TLS-problemen en HTTP-fouten. Een geslaagde testoproep alleen verifieert de callback-toegang niet.
