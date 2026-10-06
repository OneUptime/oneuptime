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

Wie **Test senden** neben einem Kanal unter **Projekteinstellungen** > **Workspace** > **Microsoft Teams** braucht das die Berechtigung, Benachrichtigungsregeln anzulegen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** oder **Create Workspace Notification Rule** und **Read Workspace Notification Rule** in einer eigenen Rolle. Wer die Regeln nur sehen darf, etwa ein **Viewer**, findet **Regel testen** gesperrt, und der Tooltip sagt, was es braucht; die API lehnt den Test mit „You do not have permission to send test notifications in this project.“ ab. In OneUptime Cloud braucht das Testen einer Regel den Tarif **Growth**, wie das Anlegen einer Regel.

## Zusammenfassungen

Der Tab **Zusammenfassung** unter **Vorfälle** > **Workspace** > **Microsoft Teams** (und unter **Warnungen**) sendet regelmäßig eine Übersicht an die Kanäle, die Sie angeben: wie viele Vorfälle oder Warnungen es gab, wie schnell sie bestätigt und gelöst wurden, und eine Liste mit Links. Eine neue Zusammenfassung wird jede Woche gesendet und umfasst die letzten 7 Tage. Lassen Sie **Ersten Bericht senden um** leer, dann wird die erste um 09:00 Uhr zu Beginn der nächsten Woche, des nächsten Tages oder Monats gesendet; das Formular zeigt, wann.

Eine Zusammenfassung richtet sich nach der Uhr ihrer **Zeitzone**, die mit Ihrer eigenen beginnt. Dort behält sie das ganze Jahr ihre Uhrzeit: Eine für 09:00 Uhr in Berlin eingerichtete Zusammenfassung wird auch nach der Zeitumstellung um 09:00 Uhr Berliner Zeit gesendet, und auch die Daten in ihrer Nachricht sind die Berliner. Über die API senden Sie `timezone` als IANA-Zeitzonennamen, etwa `Europe/Berlin`. Eine ohne Zeitzone angelegte Zusammenfassung übernimmt die Zeitzone aus dem Profil ihres Erstellers, oder UTC, wenn ein API-Schlüssel sie anlegt.

## Netzwerkzugriff bei selbst gehosteten Bereitstellungen

Informationen zu ausgehenden Verbindungen, eingehenden Rückrufen und privaten Bereitstellungen finden Sie im Abschnitt zum Netzwerkzugriff in der [Microsoft Teams-Integration](/docs/self-hosted/microsoft-teams-integration).
