# Monitor-Geheimnisse

Sie können Geheimnisse verwenden, um sensible Informationen zu speichern, die Sie in Ihren Überwachungsprüfungen verwenden möchten. Geheimnisse werden verschlüsselt und sicher gespeichert.

### Ein Geheimnis hinzufügen

Um ein Geheimnis hinzuzufügen, gehen Sie bitte zum OneUptime-Dashboard -> Monitore -> Einstellungen -> Geheimnisse -> Monitor-Geheimnis erstellen.

![Geheimnis erstellen](/docs/static/images/CreateMonitorSecret.png)

Geben Sie dem Geheimnis einen Namen und einen Wert und wählen Sie dann im Schritt **Zugriff** aus, welche Monitore es verwenden dürfen. In diesem Fall haben wir ein `ApiKey`-Geheimnis hinzugefügt.

**Bitte beachten**: Geheimnisse werden verschlüsselt und sicher gespeichert. Der Wert wird nach dem Speichern nie wieder angezeigt — weder in der Tabelle noch im Bearbeitungsformular noch über die API. Wenn Sie den Wert verlieren, müssen Sie ihn erneut aus der Quelle holen und neu eintragen. Verwenden Sie zum Rotieren eines Geheimnisses die Schaltfläche **Geheimwert aktualisieren** in der Zeile; Sie müssen es nicht löschen und neu anlegen.

### Festlegen, welche Monitore ein Geheimnis verwenden dürfen

Jedes Geheimnis hat eine von drei Zugriffsoptionen:

- **Alle Monitore**: Jeder Monitor im Projekt darf das Geheimnis verwenden, auch Monitore, die Sie später erstellen. Verwenden Sie diese Option für Zugangsdaten, die viele Monitore gemeinsam nutzen.
- **Bestimmte Monitore**: Nur die Monitore, die Sie auswählen, dürfen das Geheimnis verwenden. Das ist die Standardeinstellung, und Geheimnisse, die vor der Einführung dieser Optionen erstellt wurden, funktionieren auf diese Weise.
- **Monitore mit Beschriftungen**: Monitore, die mindestens eine der ausgewählten Beschriftungen tragen, dürfen das Geheimnis verwenden. Wenn Sie einem Monitor eine dieser Beschriftungen hinzufügen, erhält er Zugriff; entfernen Sie die Beschriftung, verliert er den Zugriff bei seiner nächsten Ausführung.

Sie können die Option jederzeit über **Bearbeiten** in der Zeile des Geheimnisses ändern. Es wird nur die Liste der gewählten Option behalten: Ein Wechsel zu **Alle Monitore** leert die Monitor- und die Beschriftungsliste des Geheimnisses, und ein Wechsel zwischen **Bestimmte Monitore** und **Monitore mit Beschriftungen** leert die Liste, von der Sie wegwechseln.

Ein Geheimnis steht Monitoren in einem anderen Projekt nie zur Verfügung.

Wer einen Monitor bearbeiten kann, der ein Geheimnis verwenden darf, kann dieses Geheimnis an jedes Ziel senden, mit dem sich der Monitor verbindet. Bei **Alle Monitore** ist das jeder, der im Projekt Monitore erstellen oder bearbeiten kann. Bei **Monitore mit Beschriftungen** gehört auch jeder dazu, der einem Monitor eine dieser Beschriftungen hinzufügen kann.

Über die API ist die Zugriffsoption das Feld `monitorAccess`: `All Monitors`, `Specific Monitors` oder `Monitors With Labels`. Die Felder `monitors` und `labels` enthalten die Listen. Ein Geheimnis, das ohne `monitorAccess` erstellt wird, erhält `Specific Monitors`.

### Ein Geheimnis verwenden

Sie können Geheimnisse in den folgenden Überwachungstypen verwenden:

- API (in Anfrage-Headern, Anfragetext und URL)
- Website, IP, Port, Ping, SSL-Zertifikat (in der URL)
- Synthetischer Monitor, Benutzerdefinierter Code-Monitor (im Code)
- SNMP-Monitor (in Community-String, SNMPv3-Auth-Schlüssel und Priv-Schlüssel)

![Geheimnis verwenden](/docs/static/images/UsingMonitorSecret.png)

Um ein Geheimnis zu verwenden, fügen Sie `{{monitorSecrets.SECRET_NAME}}` in das Feld ein, in dem Sie das Geheimnis verwenden möchten. In diesem Fall haben wir zum Beispiel `{{monitorSecrets.ApiKey}}` im Feld Anfrage-Header hinzugefügt.

Geheimnisse werden auf der Probe injiziert, bevor Synthetische oder Benutzerdefinierte Code-Monitor-Skripte ausgeführt werden, sodass Referenzen wie `{{monitorSecrets.ApiKey}}` zum entschlüsselten Wert innerhalb des laufenden Skripts aufgelöst werden.

Wenn ein Monitor auf ein Geheimnis verweist, das er nicht verwenden darf, bleibt der Verweis unverändert und wird nicht durch den Wert ersetzt.

Wenn Sie einen Monitor vor dem Speichern testen, werden nur Geheimnisse mit der Option **Alle Monitore** eingesetzt, da ein neuer Monitor in keiner Liste steht und noch keine Beschriftungen hat. Nach dem Speichern verwenden Tests alle Geheimnisse, die der Monitor verwenden darf.
