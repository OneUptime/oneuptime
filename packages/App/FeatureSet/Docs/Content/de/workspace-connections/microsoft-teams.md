# OneUptime mit Microsoft Teams verbinden

### Schritte zur Verbindung von OneUptime mit Microsoft Teams

1. **Ein Konto bei OneUptime erstellen**

   - Besuchen Sie [OneUptime.com](https://oneuptime.com) und erstellen Sie ein Konto.
   - Nach der Kontoerstellung erstellen Sie ein neues Projekt.

2. **Microsoft Teams mit dem OneUptime-Projekt verbinden**

   - Navigieren Sie innerhalb Ihres OneUptime-Projekts zu **Projekteinstellungen** > **Microsoft Teams**.
   - Folgen Sie den Anweisungen, um Ihr Microsoft Teams-Konto mit dem OneUptime-Projekt zu verbinden.

3. **Incident-Benachrichtigungen konfigurieren**

   - Gehen Sie nach der Verbindung Ihres Microsoft Teams-Kontos zur **Incidents-Seite** > **Microsoft Teams**.
   - Fügen Sie Regeln hinzu, um Incident-Benachrichtigungen an Microsoft Teams zu senden. Sie können beispielsweise eine Regel erstellen, die Nachrichten in einen Teams-Kanal postet, wenn ein Incident erstellt wird.

4. **Benachrichtigungen für Alerts und geplante Wartungen konfigurieren**
   - Ähnliche Regeln können für Alerts und Geplante Wartungen angewendet werden, indem Sie zu den jeweiligen Seiten navigieren und die gewünschten Regeln konfigurieren.

## Eine Regel testen

**Regel testen** in der Zeile einer Regel sendet eine Testnachricht dieser Regel an die Kanäle, die sie nennt, damit Sie sehen, dass sie ankommt. Legt die Regel für jedes Ereignis einen Kanal an, legt auch der Test einen an und lädt die Personen der Regel ein.

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Workspace** > **Microsoft Teams** braucht das die Berechtigung, Benachrichtigungsregeln anzulegen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** oder **Create Workspace Notification Rule** in einer eigenen Rolle. Wer die Regeln nur sehen darf, etwa ein **Viewer**, erfährt, dass er keine Testbenachrichtigungen senden darf. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer Regel.

## Netzwerkzugriff bei selbst gehosteten Bereitstellungen

Informationen zu ausgehenden Verbindungen, eingehenden Rückrufen und privaten Bereitstellungen finden Sie im Abschnitt zum Netzwerkzugriff in der [Microsoft Teams-Integration](/docs/self-hosted/microsoft-teams-integration).
