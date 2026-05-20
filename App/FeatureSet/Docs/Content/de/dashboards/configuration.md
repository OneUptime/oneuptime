# Konfiguration & Berechtigungen

Diese Seite sammelt die Einstellungen und Zugriffskontroll-Stellschrauben, die Sie kennen sollten, sobald Sie ein Dashboard haben, das Sie tatsächlich behalten möchten.

## Ownership

Die **Owner** eines Dashboards sind die Benutzer und Teams, denen explizite Berechtigungen darauf gewährt werden (getrennt von der projektweiten Rolle).

Unter **Dashboard → Owners**:

- Fügen Sie einen **User-Owner** hinzu, um einer bestimmten Person zusätzlichen Zugriff auf dieses Dashboard zu gewähren.
- Fügen Sie einen **Team-Owner** hinzu, um dasselbe für jedes Mitglied eines Teams zu gewähren.

Verwenden Sie Ownership, wenn die projektweite Leserolle zu weit gefasst ist — z. B. ein Dashboard mit sensiblen Kundendetails, das nur für das Customer-Success-Team sichtbar sein soll.

## Labels

Labels sind Many-to-many-Tags zum Organisieren von Dashboards. Wenden Sie sie unter **Dashboard → Overview** an.

Häufige Label-Muster:

- **Nach Team**: `team:platform`, `team:checkout`, `team:growth`.
- **Nach Umgebung**: `env:prod`, `env:staging`.
- **Nach Zweck**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

Die **Dashboards**-Liste lässt Sie nach Label filtern, was der schnellste Weg ist, ein Dashboard in einem Projekt zu finden, das Dutzende angesammelt hat.

## Berechtigungen

Dashboards sind erstklassige Ressourcen in OneUptimes rollenbasierter Zugriffskontrolle. Die relevanten Berechtigungen:

| Berechtigung | Erlaubt |
| --- | --- |
| `CreateDashboard` | Neue Dashboards im Projekt erstellen. |
| `ReadDashboard` | Dashboards anzeigen (im privaten Modus). |
| `EditDashboard` | Widgets, Variablen, Einstellungen eines Dashboards ändern. |
| `DeleteDashboard` | Ein Dashboard löschen. |

Es gibt passende Berechtigungen für die unterstützenden Entitäten: Dashboard-Owner (Benutzer / Team) und benutzerdefinierte Domains haben ihre eigenen Create-/Read-/Edit-/Delete-Paare, sodass Sie „Owner verwalten" gewähren können, ohne „das Dashboard selbst bearbeiten" zu gewähren.

Weisen Sie diese auf Projektrollen unter **Project Settings → Teams & Roles** zu.

## Zugriffskontrolle im öffentlichen Modus

Der Zugriff im öffentlichen Modus (siehe [Teilen & öffentliche Dashboards](/docs/dashboards/sharing)) wird durch drei Schichten in dieser Reihenfolge geregelt:

1. **Public Dashboard**-Schalter — wenn aus, gibt die öffentliche URL ein 404 zurück.
2. **Master Password** — wenn gesetzt, müssen Besucher es eingeben, bevor das Dashboard gerendert wird.
3. **IP Whitelist** (Tarif Scale) — wenn gesetzt, erhalten Anfragen von nicht gelisteten IPs ein 403.

Ein Dashboard kann jede Kombination haben. Die defensivste Konfiguration ist „Public an, Passwort gesetzt, IP-Allowlist aktiv" — nützlich für Partnerportale, wo Sie alle drei wollen.

## Aufbewahrung

Dashboards selbst laufen nicht ab. Die Daten, die sie anzeigen, folgen der Telemetrie-Aufbewahrung des Projekts — Metriken, Logs und Traces sind so lange abfragbar, wie Ihr Tarif sie aufbewahrt. Ein Widget, das auf „die letzten 90 Tage" auf einem Tarif mit 30 Tagen Aufbewahrung verweist, rendert das, was noch im Speicher ist.

## Ein Dashboard klonen

Um ein bestehendes Dashboard zu duplizieren, öffnen Sie es und verwenden Sie die Aktion **Duplicate** aus der Dashboards-Liste. Die Kopie enthält jedes Widget, jede Variable und jede Einstellung außer der Konfiguration im öffentlichen Modus (die immer ausgeschaltet startet — Sie entscheiden, ob Sie sie auf der Kopie wieder aktivieren).

Dies ist das richtige Muster, wenn Sie ein Template („unser Bereitschafts-Dashboard") in eine service-spezifische Version forken möchten.

## Ein Dashboard löschen

Unter **Dashboard → Delete**. Dies ist unwiderruflich — die Arbeitsflächenkonfiguration und alle benutzerdefinierten Domain-Bindungen werden entfernt. Telemetriedaten sind nicht betroffen (sie leben in den Metrik-/Log-/Trace-Speichern, nicht auf dem Dashboard).

Wenn ein Dashboard öffentlich mit einer benutzerdefinierten Domain veröffentlicht ist, hört die öffentliche URL in dem Moment auf zu antworten, in dem Sie es löschen. Ziehen Sie die Domain zuerst ab, wenn Sie sie umleiten müssen.

## Migration und Backup

Für selbstgehostete Installationen: Die vollständige Konfiguration des Dashboards (Widgets, Variablen, Einstellungen) lebt in der `Dashboard`-Tabelle in Postgres. Ein regelmäßiges Datenbank-Backup ist ausreichend — es gibt kein separates Dashboard-Exportformat.

Für OneUptime Cloud: Regelmäßige Backups werden für Sie erledigt. Wenn Sie eine lokale Kopie der Konfiguration eines Dashboards wollen, verwenden Sie das [OneUptime-API](/docs/api-reference/api-reference), um den `Dashboard`-Datensatz zu lesen.

## Wo weiterlesen

- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing) — die öffentliche Seite der Zugriffskontrolle.
- [Variablen & Filter](/docs/dashboards/variables) — Templating.
- [Widgets](/docs/dashboards/widgets) — der Widget-Katalog.
- [Dashboards – Übersicht](/docs/dashboards/index) — die konzeptionelle Karte.
