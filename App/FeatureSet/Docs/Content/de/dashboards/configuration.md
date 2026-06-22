# Konfiguration & Berechtigungen

Diese Seite behandelt die Einstellungen und Zugriffskontrollen, die Sie kennen sollten, sobald Sie ein Dashboard haben, das Sie behalten möchten.

## Eigentümer

Die **Eigentümer** eines Dashboards sind Benutzer und Teams, denen Sie zusätzlich zu ihrer projektweiten Rolle expliziten Zugriff gewährt haben.

Unter **Dashboard → Eigentümer**:

- Fügen Sie einen **Benutzer-Eigentümer** hinzu, um einer einzelnen Person zusätzlichen Zugriff auf dieses Dashboard zu geben.
- Fügen Sie einen **Team-Eigentümer** hinzu, um das Gleiche jedem Mitglied eines Teams zu geben.

Verwenden Sie Eigentümer, wenn die projektweite Leserolle zu breit ist – zum Beispiel ein Dashboard mit kundenspezifischen Details, das nur das Customer-Success-Team sehen soll.

## Labels

Labels sind Schlagworte zum Organisieren von Dashboards. Sie wenden sie unter **Dashboard → Übersicht** an.

Übliche Muster:

- **Nach Team**: `team:platform`, `team:checkout`, `team:growth`.
- **Nach Umgebung**: `env:prod`, `env:staging`.
- **Nach Zweck**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

In der Liste **Dashboards** können Sie nach Label filtern – der schnellste Weg, ein Dashboard in einem Projekt zu finden, in dem sich viele angesammelt haben.

## Berechtigungen

Dashboards arbeiten mit der rollenbasierten Zugriffskontrolle Ihres Projekts. Die relevanten Berechtigungen:

| Berechtigung             | Was sie erlaubt                              |
| ------------------------ | -------------------------------------------- |
| **Dashboard erstellen**  | Neue Dashboards anlegen.                     |
| **Dashboard lesen**      | Dashboards anzeigen (im privaten Modus).     |
| **Dashboard bearbeiten** | Widgets, Variablen und Einstellungen ändern. |
| **Dashboard löschen**    | Ein Dashboard löschen.                       |

Es gibt passende Berechtigungen für Dashboard-Eigentümer und eigene Domains, sodass Sie „Eigentümer verwalten" vergeben können, ohne „Dashboard bearbeiten" zu erteilen.

Vergeben Sie diese in den Projektrollen unter **Projekteinstellungen → Teams & Rollen**.

## Zugriff für öffentliche Dashboards

Wenn Sie ein Dashboard öffentlich machen (siehe [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing)), steuern drei Einstellungen, wer es sehen kann:

1. **Schalter „Öffentliches Dashboard"** – ist er aus, liefert die öffentliche URL einen 404.
2. **Master-Passwort** – ist es gesetzt, geben Besucher ein Passwort ein, bevor das Dashboard erscheint.
3. **IP-Whitelist** (Scale-Tarif) – ist sie gesetzt, werden Anfragen von anderen IPs abgelehnt.

Sie können diese beliebig kombinieren. Die strengste Kombination ist „Öffentlich an, Passwort gesetzt, IP-Zugriffsliste aktiv" – nützlich für Partnerportale, in denen Sie alle drei Schichten wollen.

## Datenaufbewahrung

Dashboards selbst laufen nicht ab. Die angezeigten Daten richten sich nach den Aufbewahrungseinstellungen Ihres Projekts – Metriken, Logs und Traces sind so lange abfragbar, wie Ihr Tarif sie aufbewahrt. Ein Widget mit „letzte 90 Tage" in einem Tarif, der 30 Tage aufbewahrt, zeigt das, was tatsächlich noch gespeichert ist.

## Ein Dashboard duplizieren

Um ein vorhandenes Dashboard zu kopieren, öffnen Sie die Dashboard-Liste und wählen Sie **Duplizieren**. Die Kopie enthält jedes Widget, jede Variable und jede Einstellung, mit Ausnahme der öffentlichen Freigabe – diese startet immer ausgeschaltet, damit Sie entscheiden können, ob Sie sie wieder einschalten möchten.

Das ist der richtige Schritt, wenn Sie eine Vorlage (zum Beispiel „unser Rufbereitschafts-Dashboard") in eine servicespezifische Kopie verzweigen möchten.

## Ein Dashboard löschen

Unter **Dashboard → Löschen**. Das kann nicht rückgängig gemacht werden – das Layout des Dashboards und alle daran angehängten eigenen Domains werden entfernt. Ihre Telemetriedaten sind davon nicht betroffen.

Ist das Dashboard öffentlich auf einer eigenen Domain, hört die URL sofort nach dem Löschen auf zu funktionieren. Verschieben Sie die Domain vorher auf ein anderes Dashboard, wenn Sie die URL erhalten möchten.

## Sicherung

Wenn Sie OneUptime selbst hosten, reicht eine regelmäßige Datenbank-Sicherung – die Konfiguration des Dashboards wird neben dem Rest Ihres Projekts gespeichert.

Bei OneUptime Cloud werden Sicherungen für Sie erledigt. Wenn Sie eine eigene Kopie wünschen, können Sie das Dashboard über die [OneUptime-API](/docs/api-reference/api-reference) auslesen.

## Weiterführende Themen

- [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing) – Steuerungen im öffentlichen Modus.
- [Variablen & Filter](/docs/dashboards/variables) – Vorlagenbildung.
- [Widgets](/docs/dashboards/widgets) – der Widget-Katalog.
- [Dashboards – Überblick](/docs/dashboards/index) – das große Ganze.
