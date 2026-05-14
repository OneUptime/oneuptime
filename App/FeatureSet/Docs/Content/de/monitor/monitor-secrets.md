# Monitor-Geheimnisse

Sie können Geheimnisse verwenden, um sensible Informationen zu speichern, die Sie in Ihren Überwachungsprüfungen verwenden möchten. Geheimnisse werden verschlüsselt und sicher gespeichert.

### Ein Geheimnis hinzufügen

Um ein Geheimnis hinzuzufügen, gehen Sie bitte zum OneUptime-Dashboard -> Projekteinstellungen -> Monitor-Geheimnisse -> Monitor-Geheimnis erstellen.

![Geheimnis erstellen](/docs/static/images/CreateMonitorSecret.png)

Sie können auswählen, welche Monitore Zugriff auf das Geheimnis haben. In diesem Fall haben wir ein `ApiKey`-Geheimnis hinzugefügt und Monitore ausgewählt, die Zugriff darauf haben.

**Bitte beachten**: Geheimnisse werden verschlüsselt und sicher gespeichert. Wenn Sie das Geheimnis verlieren, müssen Sie ein neues erstellen. Sie können das Geheimnis nach dem Speichern weder anzeigen noch aktualisieren.

### Ein Geheimnis verwenden

Sie können Geheimnisse in den folgenden Überwachungstypen verwenden:

- API (in Anfrage-Headern, Anfragetext und URL)
- Website, IP, Port, Ping, SSL-Zertifikat (in der URL)
- Synthetischer Monitor, Benutzerdefinierter Code-Monitor (im Code)
- SNMP-Monitor (in Community-String, SNMPv3-Auth-Schlüssel und Priv-Schlüssel)


![Geheimnis verwenden](/docs/static/images/UsingMonitorSecret.png)

Um ein Geheimnis zu verwenden, fügen Sie `{{monitorSecrets.SECRET_NAME}}` in das Feld ein, in dem Sie das Geheimnis verwenden möchten. In diesem Fall haben wir zum Beispiel `{{monitorSecrets.ApiKey}}` im Feld Anfrage-Header hinzugefügt.

Geheimnisse werden auf der Probe injiziert, bevor Synthetische oder Benutzerdefinierte Code-Monitor-Skripte ausgeführt werden, sodass Referenzen wie `{{monitorSecrets.ApiKey}}` zum entschlüsselten Wert innerhalb des laufenden Skripts aufgelöst werden.


### Monitor-Geheimnis-Berechtigungen

Sie können auswählen, welche Monitore Zugriff auf das Geheimnis haben. Sie können die Berechtigungen auch jederzeit aktualisieren. Wenn Sie also einen neuen Monitor hinzufügen möchten, der Zugriff auf das Geheimnis haben soll, können Sie dies tun, indem Sie die Berechtigungen aktualisieren.


