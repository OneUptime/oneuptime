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

Eine private Bereitstellung benötigt ausgehenden HTTPS-Zugriff auf Twilio, um SMS und Anrufe zu übermitteln. Twilio empfiehlt, ausgehendes HTTPS zu `*.twilio.com` zuzulassen, da sich seine API-Adressen ändern; siehe [Twilio-IP-Adressen](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Berücksichtigen Sie dabei den ausgehenden Datenverkehr der OneUptime-Anwendung, einschließlich Kubernetes NetworkPolicies und externer Firewalls.

Der benötigte eingehende Zugriff hängt von der Funktion ab:

| Funktion | Muss Twilio OneUptime erreichen können? |
| --- | --- |
| SMS übermitteln | Nein. Aktualisierungen des Zustellstatus benötigen jedoch einen Callback. |
| Einfacher Testanruf | Nein. OneUptime liefert die gesprochenen Anweisungen mit der ausgehenden API-Anfrage. |
| Bereitschaftswarnung durch Drücken von 1 bestätigen | Ja. Twilio übermittelt die Tasteneingabe an OneUptime. |
| Richtlinien für eingehende Anrufe | Ja. Twilio fordert Anrufanweisungen an und meldet Wählergebnisse. |

Befolgen Sie für Callbacks die Anleitung zum [Netzwerkzugriff für Twilio und Microsoft Teams](/docs/self-hosted/integration-network-access), um die erforderlichen HTTPS-Routen über einen Ingress oder Reverse-Proxy zu veröffentlichen und das Dashboard privat zu halten. Ein VPN auf dem Laptop eines Administrators stellt keine Verbindung für Twilio her.

Setzen Sie `HOST=oneuptime.example.com` und `HTTP_PROTOCOL=https` in der Docker-Compose-Datei `config.env` oder `host: oneuptime.example.com` und `httpProtocol: https` in den Helm-Werten und wenden Sie die Bereitstellungsänderung an. Ersetzen Sie die Beispieldomain durch Ihre Domain. Diese Einstellungen bestimmen die erzeugten URLs; sie erstellen keine DNS-Einträge, Zertifikate oder Firewall-Regeln. OneUptime besitzt keine separate Einstellung für einen Twilio-Callback-Hostnamen.

Die folgenden externen Pfade führen durch das Nginx-Gateway von OneUptime; die Platzhalter variieren je nach Benachrichtigung:

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS-Zustellstatus |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Bestätigung per Tasteneingabe |
| POST | `/notification/incoming-call/voice` | Optionale Anweisungen für eingehende Anrufe |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Optionale Ergebnisse der Weiterleitung eingehender Anrufe |

OneUptime erzeugt die SMS- und Bestätigungs-URLs automatisch. Ersetzen Sie deren Tokens nicht durch eine statische Webhook-URL. Befolgen Sie für eingehende Anrufe die Anleitung zu [Richtlinien für eingehende Anrufe](/docs/on-call/incoming-call-policy); beim Zuordnen einer Nummer wird deren Webhook konfiguriert.

Twilio benötigt [öffentlich erreichbare Webhook-URLs](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Verwenden Sie ein öffentlich vertrauenswürdiges TLS-Zertifikat und erhalten Sie beim Weiterleiten durch Proxys den ursprünglichen Host, das Protokoll, den Pfad, die Abfrageparameter, den Body und den Header `X-Twilio-Signature`. Handler für eingehende Anrufe prüfen Twilio-Signaturen; die SMS-Zustellung verwendet ein URL-Token pro Nachricht, und die Bestätigung per Tasteneingabe ein signiertes Abfrage-Token. Veröffentlichen Sie keine Tokens in gemeinsam genutzten Protokollen oder Screenshots. Siehe [Twilio-Webhook-Sicherheit](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Zustellung und Callbacks getrennt testen

1. Verwenden Sie **Test-SMS senden** und **Testanruf senden** in der Twilio-Konfiguration des Projekts. Bestätigen Sie den Empfang auf dem Zieltelefon.
2. Konfigurieren Sie den verifizierten SMS-/Anrufkontakt und die Benachrichtigungsregeln des Benutzers und lösen Sie anschließend kontrolliert eine Bereitschaftswarnung aus. Drücken Sie 1 und prüfen Sie die Bestätigung in OneUptime.
3. Prüfen Sie den SMS-Zustellstatus in OneUptime und in Twilios Nachrichtenprotokollen. Ein angenommener Sendeauftrag beweist keine Zustellung; [Twilio meldet spätere Statusänderungen durch Callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Schlägt der Versand fehl, prüfen Sie Zugangsdaten, Nummernfunktionen, Kontobeschränkungen und ausgehende Konnektivität. Kommt eine Nachricht oder ein Anruf an, ohne dass Status oder Bestätigung aktualisiert werden, prüfen Sie Callback-URL und öffentliche Ingress-Protokolle. Twilios [Anleitung zu HTTP-Abruffehlern](https://www.twilio.com/docs/api/errors/11200) hilft bei unerreichbaren Callbacks, TLS-Problemen und HTTP-Fehlern. Ein erfolgreicher Testanruf allein bestätigt keinen Callback-Zugriff.
