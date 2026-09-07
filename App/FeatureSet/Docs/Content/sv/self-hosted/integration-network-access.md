# Integrationsåtkomst från privata nätverk

En egenhostad OneUptime-instans kan skicka begäranden till Twilio och Microsoft samtidigt som deras molntjänster inte kan nå den. En anställds VPN-anslutning ger inte någon av leverantörerna åtkomst till det privata nätverket. Använd [installationsguiden för Twilio](/docs/self-hosted/twilio-integration) och [installationsguiden för Teams](/docs/self-hosted/microsoft-teams-integration) tillsammans med nätverksstegen nedan.

## I vilken riktning behövs åtkomst?

| Funktion | OneUptime till leverantör | Leverantör till OneUptime |
| --- | --- | --- |
| Skicka ett SMS eller spela upp en enkel utgående röstvarning | HTTPS | Behövs inte för att begära SMS-utskick eller spela upp medskickade röstinstruktioner |
| SMS-leveransuppdateringar, knapptryckningar under samtal, routning av inkommande samtal | HTTPS | Återanrop krävs; se sökvägarna i Twilio-guiden |
| Teams-aviseringar | HTTPS till Microsofts API:er | Krävs för den fullständiga botintegrationen, inklusive upptäckt av konversationer |
| Teams-kommandon, kortknappar, installationshändelser i chattar | HTTPS | `POST /api/microsoft-bot/messages` |

[Inställningarna för privat nätverksåtkomst](/docs/self-hosted/private-network-access) styr OneUptimes utgående begäranden till interna tjänster. Att aktivera `ALLOW_PRIVATE_NETWORK_WEBHOOKS` gör inte OneUptime nåbart för Twilio eller Teams.

## Produktion: publicera en gateway till den privata installationen

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Offentlig gateway (omvänd proxy eller lastbalanserare)
          | Privat anslutning; endast återanropssökvägar
          v
Privat OneUptime-ingress -> OneUptime-applikation
```

1. **Välj ett värdnamn**, till exempel `oneuptime.example.com`. Publicera offentliga DNS-poster som pekar på en gateway mot internet. Privata IP-adresser och interna DNS-namn är inte nåbara för leverantörerna. Med delad DNS kan anställda låta samma värdnamn peka på den privata ingressen och fortsätta använda instrumentpanelen via VPN. Den privata ingressen måste också erbjuda HTTPS med ett certifikat som är giltigt för värdnamnet.
2. **Anslut gatewayen till OneUptime.** Placera den i en DMZ med en väg till den privata ingressen eller använd en offentlig gateway ansluten via din egen site-to-site-VPN/privata länk. Tillåt trafik från gateway till ingress på den bakomliggande tjänstens port. För Kubernetes/Portainer räcker inte en privat `ClusterIP`-tjänst: gatewayen behöver en ingress/controller eller en annan nåbar bakomliggande tjänst. Håll databaser och andra interna tjänster privata.
3. **Terminera HTTPS på port 443** med ett offentligt betrott certifikat och en fullständig kedja av mellanliggande certifikat. Tillåt inkommande TCP 443 till gatewayen. Att installera ett certifikat eller ändra DNS skapar inte i sig en väg till den privata bakomliggande tjänsten.
4. **Vidarebefordra endast de nödvändiga återanropssökvägarna** från tabellen i Twilio-guiden och `/api/microsoft-bot/messages` för Teams. Skicka dem genom OneUptimes ingress, som redan dirigerar `/notification` till applikationen. Bevara metoden, den ursprungliga sökvägen, frågesträngen, begärans innehåll, `Authorization` och `X-Twilio-Signature`. Bevara offentlig `Host` och ställ in betrodda `X-Forwarded-Host` och `X-Forwarded-Proto: https` på gatewayen. Ta inte bort `/api` och lägg inte till omdirigeringar. Neka andra sökvägar på den offentliga gatewayen; anställda kan använda den privata ingressen för instrumentpanelen och återanrop för webbläsarinloggning.
5. **Bevara autentiseringen av återanrop.** Undanta dessa sökvägar från webbläsar-SSO, CAPTCHA och proxyinloggningssidor eftersom leverantörerna inte kan slutföra dem. OneUptime validerar fortfarande återanropstoken, Twilio-signaturer för inkommande samtal och Bot Framework-autentisering. Ta inte bort dessa kontroller. Tillåt endast ursprungsåtkomst från din gateway och auktoriserade interna klienter och maskera återanropstoken i loggar. Twilio beskriver denna [DMZ-proxyarkitektur och webhook-säkerhet](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Ange OneUptimes kanoniska URL** innan du konfigurerar någon av integrationerna:

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

   Inställningarna styr genererade URL:er; de upprättar inte DNS, TLS eller brandväggsåtkomst. Tillämpa Compose-konfigurationen eller uppdateringen av Helm-versionen och vänta på att applikationen startar om. OneUptime har ingen separat inställning för värdnamnet för Twilio-återanrop. Om värdnamnet ändras uppdaterar du befintliga Twilio-webhooks för telefonnummer, Azure Bots meddelandeslutpunkt och appregistreringens omdirigerings-URI:er samt hämtar/laddar upp Teams-manifestet igen.

## Utgående åtkomst och IP-begränsningar

Tillåt DNS-uppslagning och utgående HTTPS från OneUptime-applikationen. Twilio rekommenderar åtkomst till `*.twilio.com` eftersom API-adresserna ändras; se [Twilios vägledning om IP-adresser](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams använder `graph.microsoft.com`, `login.microsoftonline.com`, Bot Frameworks autentiserings-/kanalslutpunkter och anslutningstjänstens URL för konversationen. Använd [Microsofts brandväggsvägledning](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) och undersök blockerad trafik vid testning; exemplen utgör ingen fullständig domänlista.

Använd inte Twilios SIP-/medieintervall eller Teams-klienters medieintervall som listor över tillåtna webhook-källor. Vanliga Twilio-webhook-adresser är dynamiska; berättigade Twilio-utgåvor erbjuder [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), vilket kräver separat konfiguration med Twilio. Microsofts brandväggsvägledning varnar för att fasta IP-listor för inkommande Bot Framework-trafik inte stöds. Autentisera återanrop i applikationen i stället för att anta att en fast käll-IP fastställer identiteten.

## Testning och installationer utan inkommande åtkomst

Kontrollera offentlig DNS och TLS från ett nätverk utanför din VPN och kontrollera sedan Teams-sökvägen:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

På aktuella OneUptime-versioner förväntas `405 Method Not Allowed` med `Allow: POST`. Det bekräftar att GET-begäran nådde sökvägen, men inte att en autentiserad POST-begäran från boten fungerar. Äldre versioner kan returnera OneUptimes JSON-404; granska svarsinnehållet och proxyloggarna. TLS-fel, tidsgränser som överskrids eller en proxys HTML-felsida tyder på certifikat- eller routningsproblem.

En GET-begäran i webbläsaren testar inte ett Twilio POST-återanrop. Skicka ett riktigt test-SMS, kontrollera leveransuppdateringen, besvara ett testsamtal för en incident och använd knapptryckningsåtgärden. Skicka sedan ett meddelande till Teams-boten och tryck på en kortknapp. Jämför leverantörens leveransdiagnostik med gatewayens och applikationens loggar och maskera token. Lyckad utgående leverans bevisar inte i sig att återanrop fungerar.

För utveckling dokumenterar Twilio [testning genom en tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview) och Microsoft [lokal Teams-felsökning](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Vidarebefordra en offentlig HTTPS-tunnel till en proxy som bara tillåter nödvändiga sökvägar, konfigurera det resulterande värdnamnet enligt ovan och stoppa tunneln efter testningen. En tunnel exponerar fortfarande en inkommande slutpunkt; den gör inte installationen helt nätverksisolerad.

Om policyn förbjuder all inkommande anslutning kan SMS-begäranden och enkel röstuppspelning med medskickade instruktioner fortfarande fungera med utgående HTTPS, men leveransåteranrop, knapptryckningsåtgärder, routning av inkommande samtal och den fullständiga Teams-botintegrationen kan inte göra det. Privata Azure Bot-slutpunkter för Direct Line löser inte Teams-anslutningen: Microsofts [guide om nätverksisolering](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) anger att andra kanaler, inklusive Teams, tas bort när offentlig åtkomst inaktiveras. En helt frånkopplad installation kan inte använda dessa molnintegrationer.
