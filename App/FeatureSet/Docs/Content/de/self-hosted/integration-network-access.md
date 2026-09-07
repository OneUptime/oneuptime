# Integrationszugriff aus privaten Netzwerken

Eine selbst gehostete OneUptime-Instanz kann Anfragen an Twilio und Microsoft senden und dennoch für deren Cloud-Dienste unerreichbar sein. Die VPN-Verbindung eines Mitarbeiters gewährt keinem der Anbieter Zugriff auf das private Netzwerk. Verwenden Sie die [Twilio-Einrichtungsanleitung](/docs/self-hosted/twilio-integration) und die [Teams-Einrichtungsanleitung](/docs/self-hosted/microsoft-teams-integration) zusammen mit den folgenden Netzwerkschritten.

## In welche Richtung wird Zugriff benötigt?

| Funktion | OneUptime zum Anbieter | Anbieter zu OneUptime |
| --- | --- | --- |
| SMS senden oder einfache ausgehende Sprachwarnung abspielen | HTTPS | Zum Übermitteln der SMS oder Abspielen direkt mitgelieferter Sprachanweisungen nicht erforderlich |
| SMS-Zustellupdates, Tasteneingaben bei Anrufen, Weiterleitung eingehender Anrufe | HTTPS | Callbacks erforderlich; Routen stehen in der Twilio-Anleitung |
| Teams-Benachrichtigungen | HTTPS zu Microsoft-APIs | Für die vollständige Bot-Integration einschließlich Unterhaltungserkennung erforderlich |
| Teams-Befehle, Kartenschaltflächen, Chat-Installationsereignisse | HTTPS | `POST /api/microsoft-bot/messages` |

Die [Einstellungen für den Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) steuern ausgehende Anfragen von OneUptime an interne Dienste. Das Aktivieren von `ALLOW_PRIVATE_NETWORK_WEBHOOKS` macht OneUptime nicht für Twilio oder Teams erreichbar.

## Produktivbetrieb: Gateway zur privaten Bereitstellung veröffentlichen

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Öffentliches Gateway (Reverse-Proxy oder Loadbalancer)
          | Private Verbindung; nur Callback-Routen
          v
Privater OneUptime-Ingress -> OneUptime-Anwendung
```

1. **Wählen Sie einen Hostnamen**, beispielsweise `oneuptime.example.com`. Veröffentlichen Sie öffentliche DNS-Einträge, die auf ein über das Internet erreichbares Gateway zeigen. Private IP-Adressen und ausschließlich interne DNS-Namen sind für die Anbieter unerreichbar. Mit Split-DNS können Mitarbeiter denselben Hostnamen zum privaten Ingress auflösen und das Dashboard weiterhin über das VPN nutzen. Auch der private Ingress muss HTTPS mit einem für diesen Hostnamen gültigen Zertifikat bereitstellen.
2. **Verbinden Sie das Gateway mit OneUptime.** Platzieren Sie es in einer DMZ mit einer Route zum privaten Ingress oder verwenden Sie ein öffentliches Gateway, das über Ihr eigenes Site-to-Site-VPN bzw. eine private Verbindung angebunden ist. Erlauben Sie Datenverkehr vom Gateway zum Ingress am Port des vorgelagerten Dienstes. Für Kubernetes/Portainer reicht ein privater `ClusterIP`-Dienst allein nicht: Das Gateway benötigt einen Ingress/Controller oder ein anderes erreichbares Ziel. Halten Sie Datenbanken und andere interne Dienste privat.
3. **Terminieren Sie HTTPS auf Port 443** mit einem öffentlich vertrauenswürdigen Zertifikat und vollständiger Zwischenzertifikatskette. Erlauben Sie eingehendes TCP 443 zum Gateway. Die Installation eines Zertifikats oder eine DNS-Änderung allein erzeugt keine Route zum privaten Ziel.
4. **Leiten Sie nur die erforderlichen Callback-Pfade weiter**, die in der Tabelle der Twilio-Anleitung stehen, sowie `/api/microsoft-bot/messages` für Teams. Führen Sie diese durch den OneUptime-Ingress, der `/notification` bereits auf die Anwendung abbildet. Erhalten Sie Methode, ursprünglichen Pfad, Abfragezeichenfolge, Body, `Authorization` und `X-Twilio-Signature`. Erhalten Sie den öffentlichen `Host` und setzen Sie am Gateway vertrauenswürdige Header `X-Forwarded-Host` und `X-Forwarded-Proto: https`. Entfernen Sie weder `/api` noch fügen Sie Weiterleitungen hinzu. Sperren Sie andere Pfade am öffentlichen Gateway; Mitarbeiter können den privaten Ingress für Dashboard und browserbasierte Anmelde-Callbacks verwenden.
5. **Erhalten Sie die Callback-Authentifizierung.** Nehmen Sie diese Routen von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus, da die Anbieter diese nicht durchlaufen können. OneUptime prüft weiterhin seine Callback-Tokens, Twilio-Signaturen auf Routen für eingehende Anrufe und die Bot-Framework-Authentifizierung. Entfernen Sie diese Prüfungen nicht. Erlauben Sie Zugriff auf den Ursprungsserver nur von Ihrem Gateway und autorisierten internen Clients und schwärzen Sie Callback-Tokens in Protokollen. Twilio beschreibt diese [DMZ-Proxy-Architektur und Webhook-Sicherheit](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Legen Sie die kanonische URL von OneUptime fest**, bevor Sie eine der Integrationen konfigurieren:

   Docker Compose, in `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm-/Portainer-Werte:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Diese Einstellungen steuern erzeugte URLs; sie richten weder DNS noch TLS oder Firewall-Zugriff ein. Wenden Sie die Compose-Konfiguration oder die Helm-Release-Aktualisierung an und warten Sie auf den Neustart der Anwendung. OneUptime bietet keine separate Einstellung für einen Twilio-Callback-Hostnamen. Wenn sich der Hostname ändert, aktualisieren Sie bestehende Twilio-Telefonnummern-Webhooks, den Azure-Bot-Messaging-Endpunkt und die Umleitungs-URIs der App-Registrierung und laden Sie das Teams-Manifest erneut herunter und hoch.

## Ausgehender Zugriff und IP-Beschränkungen

Erlauben Sie DNS-Auflösung und ausgehendes HTTPS aus der OneUptime-Anwendung. Twilio empfiehlt Zugriff auf `*.twilio.com`, weil sich seine API-Adressen ändern; siehe [Twilios Hinweise zu IP-Adressen](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams verwendet `graph.microsoft.com`, `login.microsoftonline.com`, Authentifizierungs-/Kanalendpunkte des Bot Framework und die Connector-Dienst-URL der Unterhaltung. Nutzen Sie [Microsofts Firewall-Anleitung](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) und untersuchen Sie beim Testen blockierten Datenverkehr; diese Beispiele sind keine vollständige Domainliste.

Verwenden Sie weder Twilio-SIP-/Medienbereiche noch Teams-Client-Medienbereiche als Zulassungslisten für Webhook-Quellen. Gewöhnliche Twilio-Webhook-Adressen sind dynamisch; berechtigte Twilio-Editionen bieten [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), wofür eine separate Einrichtung mit Twilio erforderlich ist. Microsofts Firewall-Anleitung warnt, dass feste IP-Zulassungslisten für eingehenden Bot-Framework-Verkehr nicht unterstützt werden. Authentifizieren Sie Callbacks in der Anwendung, statt anzunehmen, dass eine feste Quell-IP die Identität beweist.

## Tests und Bereitstellungen ohne eingehenden Zugriff

Prüfen Sie öffentliches DNS und TLS von einem Netzwerk außerhalb Ihres VPN und prüfen Sie anschließend die Teams-Route:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Auf aktuellen OneUptime-Versionen erwarten Sie `405 Method Not Allowed` mit `Allow: POST`. Dies bestätigt, dass die GET-Anfrage die Route erreicht hat, nicht, dass eine authentifizierte Bot-POST-Anfrage funktioniert. Ältere Versionen können den JSON-404-Fehler von OneUptime zurückgeben; prüfen Sie den Antwort-Body und die Proxy-Protokolle. TLS-Fehler, Zeitüberschreitungen oder eine HTML-Fehlerseite des Proxys weisen auf Zertifikats- oder Routingprobleme hin.

Ein Browser-GET testet keinen Twilio-POST-Callback. Senden Sie eine echte Test-SMS, prüfen Sie deren Zustellupdate, beantworten Sie einen Testanruf zu einem Vorfall und verwenden Sie dessen Tasteneingabe. Senden Sie anschließend dem Teams-Bot eine Nachricht und drücken Sie eine Kartenschaltfläche. Gleichen Sie die Zustelldiagnose des Anbieters mit Gateway- und Anwendungsprotokollen ab und schwärzen Sie Tokens. Erfolgreiche ausgehende Zustellung allein beweist nicht, dass Callbacks funktionieren.

Für die Entwicklung dokumentiert Twilio [Tests über einen Tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview), Microsoft das [lokale Teams-Debugging](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Leiten Sie einen öffentlichen HTTPS-Tunnel an einen Proxy weiter, der nur die erforderlichen Routen erlaubt, konfigurieren Sie den entstehenden Hostnamen wie oben und beenden Sie den Tunnel nach dem Test. Ein Tunnel veröffentlicht weiterhin einen eingehenden Endpunkt; er macht eine Bereitstellung nicht physisch vom Netzwerk getrennt.

Verbietet Ihre Richtlinie jegliche eingehende Verbindung, können SMS-Übermittlung und einfache, direkt mitgelieferte Sprachausgabe über ausgehendes HTTPS weiterhin funktionieren. Zustell-Callbacks, Tasteneingaben, Weiterleitung eingehender Anrufe und die vollständige Teams-Bot-Integration können es dagegen nicht. Private Azure-Bot-Endpunkte für Direct Line lösen die Teams-Konnektivität nicht: Laut Microsofts [Anleitung zur Netzwerkisolation](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) entfernt das Deaktivieren des öffentlichen Zugriffs andere Kanäle einschließlich Teams. Eine vollständig getrennte Bereitstellung kann diese Cloud-Integrationen nicht nutzen.
