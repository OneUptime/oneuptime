# Twilio-Integration für SMS und Sprachanrufe

Selbst gehostetes OneUptime verwendet Ihr Twilio-Konto für SMS- und Sprachanrufwarnungen. Sie bezahlen Twilio direkt. Konfigurieren Sie die Zugangsdaten im OneUptime-Dashboard: Der Benachrichtigungsversand liest die gespeicherte Konfiguration, und das Helm-Chart enthält keine Werte für Twilio-Zugangsdaten. Eine ältere Migration importierte `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` und `TWILIO_PHONE_NUMBER`; das Ändern dieser Variablen aktualisiert nicht die Zugangsdaten einer bestehenden Installation.

## 1. Twilio-Konto vorbereiten

1. Öffnen Sie die [Twilio-Konsole](https://console.twilio.com/) und rufen Sie Ihre **Account SID** und Ihr **Auth Token** ab.
2. Besorgen Sie eine Twilio-Telefonnummer mit den benötigten SMS- bzw. Sprachfunktionen. Verwenden Sie für Absender und Empfänger das E.164-Format einschließlich Ländervorwahl.
3. Prüfen Sie Kontoguthaben, Berechtigungen für Zielländer und geltende Anforderungen zur Absenderregistrierung. Testkonten unterliegen Empfänger-, geografischen und weiteren Einschränkungen, die echte OneUptime-Warnungen verhindern können. Lesen Sie vor dem Testen [Twilios Dokumentation zu Konten und Testkonten](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account). Verwenden Sie im Produktivbetrieb ein kostenpflichtiges Konto.

## 2. Zugangsdaten in OneUptime speichern

Für ein Projekt:

1. Gehen Sie zu **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen**.
2. Wählen Sie unter **Twilio-Konfiguration** die Option **Twilio-Konfiguration erstellen**.
3. Geben Sie einen Namen sowie **Twilio Account SID**, **Twilio Auth Token** und **Primäre Twilio-Telefonnummer** ein. Optional können Sie kommagetrennte **Sekundäre Twilio-Telefonnummern** für andere Länder hinzufügen.
4. Aktivieren Sie **Als Projektstandard festlegen**, damit SMS und Anrufe für Projektmitglieder, einschließlich Bereitschaftsbenachrichtigungen, diese Konfiguration verwenden. Ohne diesen Schalter wird eine neu erstellte Konfiguration nicht für diese Benachrichtigungen ausgewählt.
5. Speichern Sie. Nur eine Konfiguration kann Projektstandard sein. Statusseiten verwenden die ihnen jeweils ausdrücklich zugewiesene Konfiguration.

Für einen installationsweiten Standard kann ein Administrator stattdessen **Admin-Dashboard > Einstellungen > Anrufe und SMS** öffnen, die Twilio-Zugangsdaten und Telefonnummern bearbeiten und speichern. Mitgliederbenachrichtigungen verwenden diese globale Konfiguration, wenn ihr Projekt keinen Standard hat. Halten Sie das Auth Token geheim.

## 3. Netzwerkzugriff konfigurieren

Eine private Bereitstellung benötigt ausgehenden HTTPS-Zugriff auf Twilio, um SMS und Anrufe zu übermitteln. Twilio empfiehlt, ausgehendes HTTPS zu `*.twilio.com` zuzulassen, da sich seine API-Adressen ändern; siehe [Twilio-IP-Adressen](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Berücksichtigen Sie dabei den ausgehenden Datenverkehr der OneUptime-Anwendung, einschließlich Kubernetes NetworkPolicies und externer Firewalls. Erlauben Sie DNS-Auflösung und ausgehendes HTTPS (TCP 443) aus der OneUptime-Anwendung.

Der benötigte eingehende Zugriff hängt von der Funktion ab:

| Funktion | Muss Twilio OneUptime erreichen können? |
| --- | --- |
| SMS übermitteln | Nein. Aktualisierungen des Zustellstatus benötigen jedoch einen Callback. |
| Einfacher Testanruf | Nein. OneUptime liefert die gesprochenen Anweisungen mit der ausgehenden API-Anfrage. |
| Bereitschaftswarnung durch Drücken von 1 bestätigen | Ja. Twilio übermittelt die Tasteneingabe an OneUptime. |
| Richtlinien für eingehende Anrufe | Ja. Twilio fordert Anrufanweisungen an und meldet Wählergebnisse. |

Die folgenden externen Pfade führen durch das Nginx-Gateway von OneUptime; die Platzhalter variieren je nach Benachrichtigung:

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS-Zustellstatus |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bestätigung per Tasteneingabe |
| POST | `/notification/incoming-call/voice` | Optionale Anweisungen für eingehende Anrufe |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Optionale Ergebnisse der Weiterleitung eingehender Anrufe |

OneUptime erzeugt die SMS- und Bestätigungs-URLs automatisch. Ersetzen Sie deren Tokens nicht durch eine statische Webhook-URL. Befolgen Sie für eingehende Anrufe die Anleitung zu [Richtlinien für eingehende Anrufe](/docs/on-call/incoming-call-policy); beim Zuordnen einer Nummer wird deren Webhook konfiguriert.

Twilio benötigt [öffentlich erreichbare Webhook-URLs](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Verwenden Sie ein öffentlich vertrauenswürdiges TLS-Zertifikat und erhalten Sie beim Weiterleiten durch Proxys den ursprünglichen Host, das Protokoll, den Pfad, die Abfrageparameter, den Body und den Header `X-Twilio-Signature`. Handler für eingehende Anrufe prüfen Twilio-Signaturen; die SMS-Zustellung verwendet ein URL-Token pro Nachricht, und die Bestätigung per Tasteneingabe ein signiertes Abfrage-Token. Veröffentlichen Sie keine Tokens in gemeinsam genutzten Protokollen oder Screenshots. Siehe [Twilio-Webhook-Sicherheit](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Produktivbetrieb: Gateway zur privaten Bereitstellung veröffentlichen

1. **Wählen Sie einen Hostnamen**, beispielsweise `oneuptime.example.com`. Veröffentlichen Sie öffentliche DNS-Einträge, die auf ein über das Internet erreichbares Gateway zeigen. Private IP-Adressen und ausschließlich interne DNS-Namen sind für die Anbieter unerreichbar. Mit Split-DNS können Mitarbeiter denselben Hostnamen zum privaten Ingress auflösen und das Dashboard weiterhin über das VPN nutzen. Auch der private Ingress muss HTTPS mit einem für diesen Hostnamen gültigen Zertifikat bereitstellen.

2. **Verbinden Sie das Gateway mit OneUptime.** Platzieren Sie es in einer DMZ mit einer Route zum privaten Ingress oder verwenden Sie ein öffentliches Gateway, das über Ihr eigenes Site-to-Site-VPN bzw. eine private Verbindung angebunden ist. Erlauben Sie Datenverkehr vom Gateway zum Ingress am Port des vorgelagerten Dienstes. Für Kubernetes/Portainer reicht ein privater `ClusterIP`-Dienst allein nicht: Das Gateway benötigt einen Ingress/Controller oder ein anderes erreichbares Ziel. Halten Sie Datenbanken und andere interne Dienste privat.

3. **Terminieren Sie HTTPS auf Port 443** mit einem öffentlich vertrauenswürdigen Zertifikat und vollständiger Zwischenzertifikatskette. Erlauben Sie eingehendes TCP 443 zum Gateway. Die Installation eines Zertifikats oder eine DNS-Änderung allein erzeugt keine Route zum privaten Ziel.

4. Veröffentlichen Sie nur die Callback-Pfade aus der Tabelle oben über OneUptimes Nginx-Gateway, das `/notification` der Anwendung zuordnet. Behalten Sie `/api` beim Pfad für die Tastenbestätigung bei. Erhalten Sie Methode, Pfad, Abfragezeichenfolge, Body und Authentifizierungsheader (`X-Twilio-Signature`). Bewahren Sie den öffentlichen `Host` und setzen Sie vertrauenswürdige Header `X-Forwarded-Host` und `X-Forwarded-Proto: https`. Fügen Sie keine Weiterleitungen hinzu.

5. Nehmen Sie diese Pfade von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus. Lassen Sie OneUptimes Authentifizierung aktiviert. Beschränken Sie den Ursprungszugriff auf das Gateway und autorisierte interne Clients; maskieren Sie Token in Protokollen.

6. **Legen Sie die kanonische URL von OneUptime fest**:

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

   Ersetzen Sie das Beispiel durch Ihre Domain. Diese Einstellungen erzeugen URLs, aber keine DNS-Einträge, TLS-Konfiguration oder Firewall-Regeln. Wenden Sie die Compose-Konfiguration beziehungsweise das Helm-Update an und warten Sie auf den Neustart der Anwendung. OneUptime bietet keinen separaten Twilio-Callback-Hostnamen. Bei einer Änderung aktualisieren Sie auch die Webhooks vorhandener Twilio-Telefonnummern.

Die [Einstellungen für den Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) steuern ausgehende Anfragen von OneUptime an interne Dienste. Das Aktivieren von `ALLOW_PRIVATE_NETWORK_WEBHOOKS` macht OneUptime nicht für Twilio erreichbar.

### Ausgehender Zugriff und IP-Beschränkungen

Die Quelladressen gewöhnlicher Twilio-Webhooks ändern sich; verwenden Sie keine SIP- oder Medienbereiche als Callback-Freigabeliste. Berechtigte Editionen bieten [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Prüfen Sie Edition und unterstützte Produkte und konfigurieren Sie die Firewall anhand der aktuell veröffentlichten Bereiche. Authentifizieren Sie Callbacks weiterhin.

### Tests und Bereitstellungen ohne eingehenden Zugriff

Ohne eingehenden Zugriff können SMS-Versand und einfache Sprachwiedergabe mit ausgehendem HTTPS funktionieren. Zustellstatus, Tastenbestätigung und eingehendes Anrufrouting benötigen erreichbare Callbacks. Eine vollständig getrennte Installation kann Twilio nicht verwenden.

Für die Entwicklung beschreibt Twilios [Webhook-Testanleitung](https://www.twilio.com/docs/usage/webhooks/webhook-testing) einen öffentlichen Tunnel. Leiten Sie ihn an einen Proxy weiter, der nur die erforderlichen Pfade zulässt, konfigurieren Sie den resultierenden Hostnamen wie oben und beenden Sie den Tunnel nach dem Test. Ein Tunnel ermöglicht weiterhin eingehenden Zugriff.

## 4. Zustellung und Callbacks getrennt testen

1. Prüfen Sie außerhalb von Firmennetz und VPN, ob der Callback-Hostname zum öffentlichen Gateway aufgelöst wird und ein gültiges TLS-Zertifikat liefert. Ein Browser-GET testet diese POST-Callbacks nicht.
2. Verwenden Sie **Test-SMS senden** und **Testanruf senden** in der Twilio-Konfiguration des Projekts. Bestätigen Sie den Empfang auf dem Zieltelefon.
3. Konfigurieren Sie den verifizierten SMS-/Anrufkontakt und die Benachrichtigungsregeln des Benutzers und lösen Sie anschließend kontrolliert eine Bereitschaftswarnung aus. Drücken Sie 1 und prüfen Sie die Bestätigung in OneUptime. Wenn Sie Richtlinien für eingehende Anrufe verwenden, rufen Sie die konfigurierte Nummer an und prüfen Sie Routing und Anrufprotokoll.
4. Prüfen Sie den SMS-Zustellstatus in OneUptime und in Twilios Nachrichtenprotokollen. Ein angenommener Sendeauftrag beweist keine Zustellung; [Twilio meldet spätere Statusänderungen durch Callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Schlägt der Versand fehl, prüfen Sie Zugangsdaten, Nummernfunktionen, Kontobeschränkungen und ausgehende Konnektivität. Kommt eine Nachricht oder ein Anruf an, ohne dass Status oder Bestätigung aktualisiert werden, prüfen Sie Callback-URL und öffentliche Ingress-Protokolle. Twilios [Anleitung zu HTTP-Abruffehlern](https://www.twilio.com/docs/api/errors/11200) hilft bei unerreichbaren Callbacks, TLS-Problemen und HTTP-Fehlern. Ein erfolgreicher Testanruf allein bestätigt keinen Callback-Zugriff.
