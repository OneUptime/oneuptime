# Einen Monitor erstellen

Ein Monitor prüft etwas, das Sie betreiben, etwa eine Website, eine API, einen Host oder einen Kubernetes-Cluster, und meldet sich, wenn es nicht mehr funktioniert. **Monitor erstellen** fragt zuerst, was überwacht werden soll, dann, was geprüft wird, und dann, wie oft. Bis auf den Typ, den Namen und das Prüfziel beginnt alles mit Standardwerten, die für die meisten Monitore passen.

## Überwachungsinformationen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**. Die erste Frage ist der **Monitortyp**: Was möchten Sie überwachen?

- Die sechs Typen, die am häufigsten erstellt werden, stehen ganz oben: **Website**, **API**, **Ping**, **Port**, **SSL-Zertifikat** und **Eingehende Anfrage** für Heartbeats von Cronjobs und Webhooks.
- **Weitere Monitortypen** listet alle anderen Typen unter ihrer Kategorie auf, etwa **Infrastruktur** (Kubernetes, Docker, Host) und **Telemetrie** (Protokolle, Metriken, Traces). **Manuell**, ein Monitor, dessen Status Sie selbst setzen, steht unter **Sonstige**.
- Oder tippen Sie in das Suchfeld. Es kennt die Wörter, die Sie ohnehin verwenden, etwa `k8s`, `postgres`, `heartbeat` oder `tls`, und **Enter** wählt den ersten Treffer.

Der gewählte Typ schrumpft auf eine Zeile. Klicken Sie auf **Ändern**, um einen anderen zu wählen; drücken Sie während der Auswahl **Escape**, um den bisherigen Typ zu behalten.

Tragen Sie dann unter **Name** einen Namen ein. Er wird in Warnungen und in den Titeln von Vorfällen verwendet. **Beschreibung** und **Beschriftungen** sind optional und warten unter **Weitere Felder**.

Ein Monitor vom Typ **Manuell** braucht nichts weiter, deshalb steht **Monitor erstellen** schon auf diesem Schritt.

## Kriterien

Dieser Schritt beginnt mit dem, was geprüft wird. Bei einer Website ist das ihre URL, mit einem Beispiel im Feld; andere Typen fragen nach einem Host, einer Abfrage, einem Cluster oder einem Log-Filter. **Monitor testen** führt die Prüfung einmal aus, bevor Sie speichern.

Darunter legen die **Monitor-Kriterien** fest, wann der Monitor seinen Status ändert, einen Vorfall meldet oder eine Warnung erstellt. Ein neuer Monitor beginnt mit Kriterien, die für die meisten Monitore passen, jedes auf eine Zeile eingeklappt, die sagt, was es prüft und was es tut. Ein neuer Website-Monitor wird zum Beispiel als offline markiert und meldet einen Vorfall, wenn die Website nicht antwortet oder mit einem Fehlerstatuscode antwortet. Klicken Sie auf ein Kriterium, um es zu öffnen und zu ändern. **Kriterien hinzufügen** fügt eines hinzu, geöffnet und bereit zum Ausfüllen.

Auf diesem Schritt wird nichts als fehlend markiert, bevor Sie auf **Weiter** klicken.

## Sonden & Intervall

Monitore, die von Sonden geprüft werden, enden mit diesem Schritt: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code und External Status Page. **Sonden** sind die Maschinen, die die Prüfungen ausführen; die Standardsonden Ihres Projekts sind bereits ausgewählt. Das **Überwachungsintervall** beginnt bei **Alle 5 Minuten**. Klicken Sie auf **Monitor erstellen**.

Alle anderen Typen werden auf dem Schritt **Kriterien** erstellt.

## Von einer Vorlage oder einem Link aus starten

Eine Monitorvorlage und die Links, die an anderen Stellen in OneUptime einen Monitor erstellen (an einem Metrikdiagramm, einem Netzwerkgerät oder einer Erkennungsregel), öffnen **Monitor erstellen** mit bereits gewähltem Typ und ausgefüllten übrigen Angaben. Klicken Sie auf **Ändern**, um einen anderen Typ zu wählen. Das Formular einer Vorlage verwendet dieselbe Typauswahl: siehe [Monitorvorlagen](/docs/monitor/monitor-templates).
