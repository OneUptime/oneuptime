# Einen Monitor erstellen

Ein Monitor prüft etwas, das Sie betreiben, etwa eine Website, eine API, einen Host oder einen Kubernetes-Cluster, und meldet sich, wenn es nicht mehr funktioniert. **Monitor erstellen** fragt zuerst, was überwacht werden soll, dann, was geprüft wird, und dann, wie oft. Bis auf den Typ, den Namen und das Prüfziel beginnt alles mit Standardwerten, die für die meisten Monitore passen.

Für eine Website oder API führt Sie stattdessen eine geführte Einrichtung von ihrer Adresse bis zu einer Test-Alarmierung: Klicken Sie in der leeren Liste **Monitore** oder unter **So funktioniert es** auf **Geführte Einrichtung**. **Monitor erstellen** bietet sie auch an, sobald Sie **Website** oder **API** wählen. Siehe [Erfahren, wenn Ihre Website oder API ausfällt](/docs/guides/website-down).

> [!NOTE]
> Um einen Monitor zu erstellen, brauchen Sie die Rolle Projektinhaber, Projektadministrator, Projektmitglied, Monitor-Administrator oder Monitor-Mitglied oder eine benutzerdefinierte Rolle mit der Berechtigung Create Monitor.

## Was überwacht wird

Der erste Schritt fragt, was überwacht werden soll, wo es zu finden ist und wie der Monitor heißt.

:::steps
### Monitor erstellen öffnen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**. Das Formular öffnet sich auf seinem ersten Schritt, **Was überwacht wird**.

### Den Monitortyp wählen

Die erste Frage ist der **Monitortyp**: Was möchten Sie überwachen?

- Die sechs Typen, die am häufigsten erstellt werden, stehen ganz oben: **Website**, **API**, **Ping**, **Port**, **SSL-Zertifikat** und **Eingehende Anfrage** für Heartbeats von Cronjobs und Webhooks.
- **Weitere Monitortypen** listet alle anderen Typen unter ihrer Kategorie auf, etwa **Infrastruktur** (Kubernetes, Docker, Host) und **Telemetrie** (Protokolle, Metriken, Traces). **Manuell**, ein Monitor, dessen Status Sie selbst setzen, und **Sondenstatus**, der Ihnen meldet, wenn eine Sonde getrennt wird, stehen unter **Sonstige**.
- Oder tippen Sie in das Suchfeld. Es kennt die Wörter, die Sie ohnehin verwenden, etwa `k8s`, `postgres`, `heartbeat` oder `tls`, und **Enter** wählt den ersten Treffer.

Der gewählte Typ schrumpft auf eine Zeile. Klicken Sie auf **Ändern**, um einen anderen zu wählen; drücken Sie während der Auswahl **Escape**, um den bisherigen Typ zu behalten.

### Eingeben, wo es zu finden ist

Ein Typ, dessen Prüfung einer Adresse gilt, fragt direkt nach dem Typ danach: die **Website-URL** einer Website oder eines SSL-Zertifikats, die **API-URL** einer API, der Host oder die IP-Adresse für einen Ping, ein Host mit seinem **Port** oder ein NTP-Server. Das Feld zeigt ein Beispiel. Unter der Adresse einer Website oder API zeigt **Caches bei jeder Prüfung umgehen**, wie Sie einen Wert einfügen, der sich bei jeder Prüfung ändert. Andere Typen fragen im nächsten Schritt, wo nachgesehen wird, etwa nach der Domain eines DNS-Monitors oder der Verbindung einer Datenbank.

### Den Monitor benennen

Tragen Sie unter **Name** einen Namen ein. Nach einer Adresse füllt er sich von selbst aus, etwa mit `example.com`, bis Sie einen eigenen schreiben. Er wird in Warnungen und in den Titeln von Vorfällen verwendet. **Beschreibung** und **Beschriftungen** sind optional und warten unter **Weitere Felder**.

Ein Monitor vom Typ **Manuell** braucht nichts weiter, deshalb steht **Monitor erstellen** schon auf diesem Schritt. Klicken Sie bei jedem anderen Typ auf **Weiter**.
:::

## Kriterien

Der zweite Schritt fragt, was geprüft wird, und legt fest, was als Problem zählt.

:::steps
### Eingeben, was geprüft wird

Dieser Schritt beginnt mit dem, was die Prüfung sonst noch liest. Ein Monitor für eine Adresse zeigt sie unter **Monitor-Ziel**, mit dem, was er sonst noch braucht, etwa der Anfragemethode einer API; andere Typen fragen hier nach einer Domain, einer Abfrage, einem Cluster oder einem Log-Filter. Einstellungen, die die meisten Monitore nie ändern, etwa Zeitlimits und Wiederholungen, sind unter **Weitere Felder** eingeklappt.

Bei einem Monitor, den Sonden prüfen, führt **Monitor testen** die Prüfung einmal aus, bevor Sie speichern, und zwar auf einer Sonde, die den Monitor prüft: Klicken Sie auf **Test ausführen**, oder wählen Sie vorher unter **Sonde auswählen** eine andere Sonde. **Überwachungs-Testergebnis** sagt, welches Kriterium die Antwort erfüllt und was folgen würde (der Status, der Vorfall oder die Warnung und wer benachrichtigt wird), und zeigt dann, was die Sonde gefunden hat.

### Die Kriterien prüfen

Darunter legen die **Kriterien** fest, wann der Monitor seinen Status ändert, einen Vorfall meldet oder eine Warnung erstellt. Ein neuer Monitor beginnt mit Kriterien, die für die meisten Monitore passen, jedes auf eine Zeile eingeklappt, die sagt, was es prüft und was es tut. Ein neuer Website-Monitor wird zum Beispiel als offline markiert und meldet einen Vorfall, wenn die Website nicht antwortet oder mit einem Fehlerstatuscode antwortet.

Klicken Sie auf ein Kriterium, um es zu öffnen und zu ändern. **Kriterien hinzufügen** fügt eines hinzu, geöffnet und bereit zum Ausfüllen. Um die Reihenfolge zu ändern, ziehen Sie ein Kriterium am Griff links davon.

Ein Logs-, Traces-, Ausnahmen- oder Metriken-Monitor fragt stattdessen, worüber er Sie informieren soll, und richtet eine Regel in einfachen Worten ein: was überwacht wird, **Wann alarmieren** und **Was passiert**, über einem Diagramm dessen, was die Regel erfasst hätte. Siehe [Logs-Monitor](/docs/monitor/logs-monitor#einen-logs-monitor-erstellen).

### Zum nächsten Schritt gehen

Klicken Sie auf **Weiter**. Auf diesem Schritt wird nichts als fehlend markiert, bevor Sie auf **Weiter** klicken.
:::

### Wie Kriterien ausgewertet werden

Das Ergebnis jeder Prüfung durchläuft die Kriterien von oben nach unten, und das erste zutreffende entscheidet, was passiert. Dieses Kriterium kann den Status des Monitors ändern, einen Vorfall melden, eine Warnung erstellen oder alles in beliebiger Kombination. Trifft keines zu, zeigt der Monitor seinen **Standard-Überwachungsstatus**, der unter **Weitere Felder** unterhalb der Kriterien eingestellt wird (**Betriebsbereit**, sofern Sie keinen anderen wählen).

```mermaid title="Von einer Prüfung zu einem Status, einem Vorfall oder einer Warnung"
flowchart TB
    check["Ergebnis einer Prüfung"] --> criteria{"Erstes zutreffendes<br/>Kriterium"}
    criteria -->|"Keines trifft zu"| fallback["Standard-Überwachungsstatus"]
    criteria -->|"Eines trifft zu"| actions
    subgraph actions["Was dieses Kriterium tut"]
        direction LR
        status["Den Status<br/>ändern"]
        incident["Einen Vorfall<br/>melden"]
        alert["Eine Warnung<br/>erstellen"]
    end
```

Vorfälle und Warnungen, die sich automatisch auflösen sollen, wie die der Standardkriterien, lösen sich von selbst auf, sobald ihr Kriterium nicht mehr zutrifft. Ein Monitor, den mehr als eine Sonde prüft, ändert sich nur, wenn seine Sonden übereinstimmen: Standardmäßig muss jede eingeschaltete und verbundene Sonde zum selben Ergebnis kommen. Um weniger zu verlangen, stellen Sie **Sondenübereinstimmung** auf der Seite **Konfiguration → Sonden & Intervall** des Monitors ein. Alles, was ein Kriterium enthalten kann, und die Status, die ein Monitor zeigen kann, finden Sie unter [Kriterien & Status](/docs/monitor/criteria-and-statuses).

## Sonden & Intervall

Monitore, die von Sonden geprüft werden, enden mit diesem Schritt: Website, API, Ping, IP, Port, SSL-Zertifikat, DNS, DNSSEC, NTP, Domäne, SQL-Abfrage, Datenbank-Integrität, Synthetischer Monitor, Benutzerdefinierter JavaScript-Code und Externe Statusseite. **Sonden** sind die Maschinen, die die Prüfungen ausführen; die Standardsonden Ihres Projekts sind bereits ausgewählt. Das **Überwachungsintervall** beginnt bei **Alle 5 Minuten**.

:::steps
### Die Sonden wählen

Behalten Sie die ausgewählten **Sonden** oder wählen Sie andere. Ein Monitor ohne Sonden wird nie geprüft. Um etwas in einem privaten Netzwerk zu prüfen, betreiben Sie eine [benutzerdefinierte Sonde](/docs/probe/custom-probe) in diesem Netzwerk und wählen Sie sie hier aus.

### Wählen, wie oft geprüft wird

Wählen Sie ein **Überwachungsintervall**, von **Jede Minute** bis **Jede Woche**. Monitoren vom Typ Synthetischer Monitor, Benutzerdefinierter JavaScript-Code und SSL-Zertifikat werden Intervalle von 5 Minuten oder länger angeboten.

### Den Monitor erstellen

Klicken Sie auf **Monitor erstellen**. Die Seite des neuen Monitors öffnet sich. Um seine Sonden oder sein Intervall später zu ändern, öffnen Sie auf dieser Seite **Konfiguration → Sonden & Intervall**.
:::

Alle anderen Typen außer Manuell werden auf dem Schritt **Kriterien** erstellt.

## Von einer Vorlage oder einem Link aus starten

Eine Monitorvorlage und die Links, die an anderen Stellen in OneUptime einen Monitor erstellen (an einem Metrikdiagramm, einem Netzwerkgerät oder einer Erkennungsregel), öffnen **Monitor erstellen** mit bereits gewähltem Typ und ausgefüllten übrigen Angaben. Klicken Sie auf **Ändern**, um einen anderen Typ zu wählen. Das Formular einer Vorlage verwendet dieselbe Typauswahl: siehe [Monitorvorlagen](/docs/monitor/monitor-templates).

Jeder Monitortyp hat eine eigene Seite mit seinen Einstellungen, seinen Standardkriterien und Beispielen. Gute nächste Ziele:

:::cards
- [Website-Überwachung](/docs/monitor/website-monitor): Prüfen, ob eine Seite lädt und was sie antwortet.
- [API-Überwachung](/docs/monitor/api-monitor): Einen Endpunkt mit Methode, Headern und Body aufrufen.
- [Kriterien & Status](/docs/monitor/criteria-and-statuses): Was den Status jedes Monitors setzt.
- [Monitorvorlagen](/docs/monitor/monitor-templates): Viele Monitore aus einer Konfiguration erstellen und gleich halten.
- [Monitor-Gruppen](/docs/monitor/monitor-groups): Mehrere Monitore zu einem Status zusammenfassen.
- [Vorfälle](/docs/incidents/index): Was passiert, nachdem ein Monitor einen Vorfall gemeldet hat.
:::
