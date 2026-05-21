# Konfiguration & Sicherheit

Diese Seite behandelt die Einstellungen und Sicherheitsgrenzen, die Sie kennen sollten, bevor Sie einen Workflow auf echten Datenverkehr loslassen.

## Einen Workflow ein- oder ausschalten

Jeder Workflow hat einen Schalter **Aktiviert** in den **Einstellungen**. Solange er aus ist, läuft der Workflow nicht – Webhook-Aufrufe, geplante Zeiten und OneUptime-Ereignisse werden ignoriert. Neue Workflows starten deaktiviert.

Nutzen Sie diesen Schalter als „startbereit"-Schranke:

1. Bauen Sie den Workflow.
2. Klicken Sie mit einer realistischen Payload auf **Manuell ausführen**.
3. Prüfen Sie die **Logs** – stellen Sie sicher, dass jeder Baustein dorthin geführt hat, wo Sie ihn erwartet haben.
4. Schalten Sie **Aktiviert** ein.

Das Ausschalten eines Workflows stoppt keine bereits laufenden Ausführungen; es verhindert lediglich das Starten neuer.

## Eigentümer und Labels

- **Eigentümer** – Benutzer und Teams, die als Eigentümer aufgeführt sind, erhalten Zugriff auf den Workflow und können sich für Benachrichtigungen bei Fehlern eintragen. Sie legen sie unter **Einstellungen → Eigentümer** fest.
- **Labels** – Schlagworte zum Gruppieren von Workflows. In der Workflow-Liste können Sie nach Label filtern, was die Navigation in einem geschäftigen Projekt deutlich erleichtert. Praktisch, wenn Sie Workflows nach Team, Integration oder Umgebung organisieren.
- **Label-Regeln** – unter **Workflows → Einstellungen → Label-Regeln** können Sie neuen Workflows automatisch Labels anhand von Namens- oder Beschreibungsmustern zuweisen.
- **Eigentümer-Regeln** – unter **Workflows → Einstellungen → Eigentümer-Regeln** können Sie neuen Workflows automatisch Eigentümer zuweisen.

## Geheimnisse

Markieren Sie eine globale Variable als **Geheimnis**, wenn sie sensible Inhalte enthält. Der Wert wird verschlüsselt, nach dem Speichern in der Oberfläche ausgeblendet und in den Ausführungslogs verborgen (dort als `[REDACTED]` angezeigt).

Verwenden Sie geheime Variablen für:

- API-Schlüssel externer Dienste.
- Authentifizierungs-Token.
- Webhook-Signierungsschlüssel.
- Alles, was Sie jemandem mit Lesezugriff lieber nicht zeigen möchten.

Fügen Sie ein Geheimnis nicht direkt in einen Baustein ein – Werte wie `Authorization: Bearer eyJh...` wären sonst im Workflow und in den Logs sichtbar. Verwenden Sie stattdessen `{{variable.MY_SECRET}}`.

## Wie lange eine Ausführung dauern darf

Jede Ausführung hat eine maximale Dauer. Wenn eine Ausführung nicht rechtzeitig abgeschlossen ist, wird sie als **Zeitüberschreitung** markiert und der gerade laufende Baustein abgebrochen. Die Voreinstellung ist großzügig – ausreichend für übliche HTTP-Aufrufe und Ketten von Bausteinen.

Einzelne Bausteine haben innerhalb dessen eigene Zeitlimits – ein API-Baustein gibt zum Beispiel bei einer hängenden ausgehenden Anfrage deutlich vor der gesamten Ausführung auf.

## Limit für das Aufrufen anderer Workflows

Die Komponente **Workflow ausführen** erlaubt es einem Workflow, einen anderen aufzurufen. Damit es keine versehentlichen Schleifen gibt, in denen Workflow A B aufruft, der wiederum A aufruft, gibt es eine Obergrenze für die Tiefe der Kette. Eine Ausführung, die das Limit überschreitet, endet mit einer eindeutigen Fehlermeldung.

Wenn Sie tatsächlich eine lange Kette benötigen (zum Beispiel einen Job, der pro Ausführung ein Element verarbeitet), ist es meist einfacher, innerhalb eines einzigen Workflows mit **Benutzerdefiniertem Code** zu schleifen.

## Webhook-Sicherheit

Webhook-Auslöser stellen Ihnen eine eindeutige URL bereit. Jeder, der diese URL kennt, kann sie aufrufen. Schutz gegen versehentliche oder unerwünschte Aufrufer:

- Behandeln Sie die URL wie ein Passwort. Veröffentlichen Sie sie nicht und legen Sie sie nicht in ein öffentliches Repository.
- Bitten Sie bei sensiblen Workflows das aufrufende System, ein gemeinsames Token als Header (zum Beispiel `X-Webhook-Token`) mitzusenden, und prüfen Sie es vor jeder wichtigen Aktion mit einem **Bedingungen**-Baustein. Speichern Sie das erwartete Token als geheime Variable.
- Bei besonders sensiblen Workflows greifen Sie lieber zu einem OneUptime-Ereignis-Auslöser und einem manuellen Importschritt statt zu einem öffentlichen Webhook.

## Ausgehender Netzwerkzugriff

API- und andere HTTP-Bausteine stellen ihre Anfragen aus OneUptime heraus. Wenn Sie selbst hosten, stellen Sie sicher, dass Ihre Installation die gewünschten Dienste erreichen kann. Bei OneUptime Cloud finden Sie unsere ausgehenden IP-Bereiche unter [IP-Adressen](/docs/configuration/ip-addresses), damit Sie sie auf der Gegenseite freigeben können.

## Berechtigungen

Workflows respektieren die rollenbasierte Zugriffskontrolle Ihres Projekts. Die relevanten Berechtigungen:

- **Workflow erstellen / lesen / bearbeiten / löschen** – die Grundberechtigungen am Workflow selbst.
- **Workflow ausführen** – wird benötigt, um **Manuell ausführen** anzuklicken oder einen Workflow per API auszulösen.
- **Workflow-Logs lesen** – wird benötigt, um Ausführungen einzusehen.
- **Workflow-Variable lesen / erstellen / bearbeiten / löschen** – Kontrolle über die Liste der globalen Variablen.

Die meisten Engineers sollten Workflows erstellen/bearbeiten/lesen dürfen, aber keine Variablen. Vergeben Sie die Bearbeitung der Variablen nur an Personen, die die Geheimnisse Ihres Projekts verwalten.

## Tariflimits

OneUptime Cloud begrenzt die monatliche Anzahl der Ausführungen in kleineren Tarifen. Ihr aktuelles Limit finden Sie unter **Projekteinstellungen → Abrechnung**. Sobald es erreicht ist, werden neue Auslöser bis zum nächsten Abrechnungszyklus abgelehnt. Selbst gehostete Installationen unterliegen diesem Limit nicht.

## Wann Workflows nicht das richtige Werkzeug sind

Ein paar Fälle, in denen Sie zu etwas anderem greifen sollten:

- **Schwere Berechnungen oder große Datensätze** – Workflows sind als leichtes Bindeglied gedacht, nicht zum Zahlen-Knacken. Führen Sie schwere Arbeiten in Ihrer eigenen Infrastruktur aus und lassen Sie sie durch einen Workflow anstoßen.
- **Lang laufende Prozesse über Stunden hinweg** – eine einzelne Ausführung soll zügig enden. Wenn Sie „mache A, warte zwei Stunden, mache B" brauchen, nutzen Sie einen externen Scheduler, der zum richtigen Zeitpunkt einen Webhook an OneUptime schickt.
- **Schritt-für-Schritt-Vorfallreaktion mit menschlicher Beteiligung** – dafür sind [Runbooks](/docs/runbooks/index) gedacht. Workflows sind für unbeaufsichtigte Automatisierung.

## Weiterführende Themen

- [Workflows – Überblick](/docs/workflows/index) – das große Ganze.
- [Komponenten](/docs/workflows/components) – Referenz pro Baustein.
- [Runbooks](/docs/runbooks/index) – wann lieber ein Runbook eingesetzt wird.
