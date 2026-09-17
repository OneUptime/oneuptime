# Monitor-Geheimnisse

Sie können Geheimnisse verwenden, um sensible Informationen zu speichern, die Sie in Ihren Überwachungsprüfungen verwenden möchten. Geheimnisse werden verschlüsselt und sicher gespeichert.

### Ein Geheimnis hinzufügen

Um ein Geheimnis hinzuzufügen, gehen Sie bitte zum OneUptime-Dashboard -> Monitore -> Einstellungen -> Geheimnisse -> Monitor-Geheimnis erstellen.

![Geheimnis erstellen](/docs/static/images/CreateMonitorSecret.png)

Sie können auswählen, welche Monitore Zugriff auf das Geheimnis haben. In diesem Fall haben wir ein `ApiKey`-Geheimnis hinzugefügt und Monitore ausgewählt, die Zugriff darauf haben.

**Bitte beachten**: Geheimnisse werden verschlüsselt und sicher gespeichert. Der Wert wird nach dem Speichern nie wieder angezeigt — weder in der Tabelle noch im Bearbeitungsformular noch über die API. Wenn Sie den Wert verlieren, müssen Sie ihn erneut aus der Quelle holen und neu eintragen. Verwenden Sie zum Rotieren eines Geheimnisses die Schaltfläche **Geheimwert aktualisieren** in der Zeile; Sie müssen es nicht löschen und neu anlegen.

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
