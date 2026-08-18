# Konfiguration & Sicherheit

Diese Seite behandelt die Einstellungen und Sicherheitsgrenzen, die Sie kennen sollten, bevor Sie einen Workflow auf echten Datenverkehr ansetzen.

## Einen Workflow ein- oder ausschalten

Jeder Workflow hat einen Schalter **Enabled** unter **Settings**. Wenn er aus ist, läuft der Workflow nicht – Webhook-Aufrufe, geplante Zeitpunkte und OneUptime-Ereignisse werden alle ignoriert. Neue Workflows starten deaktiviert.

Nutzen Sie diesen Schalter als Ihre „bereit zum Start"-Schwelle:

1. Bauen Sie den Workflow.
2. Klicken Sie im **Builder** mit realistischen Werten auf **Run Workflow**.
3. Prüfen Sie die **Logs** – stellen Sie sicher, dass jeder Baustein dorthin gelangt ist, wo Sie es erwartet haben.
4. Schalten Sie **Enabled** ein.

Das Ausschalten eines Workflows stoppt keine bereits laufenden Ausführungen; es verhindert nur, dass neue starten.

## Owners und Labels

- **Owners** – Benutzer und Teams, die als Eigentümer aufgeführt sind, erhalten Zugriff auf den Workflow und können sich für Benachrichtigungen entscheiden, wenn er fehlschlägt. Legen Sie diese unter **Settings → Owners** fest.
- **Labels** – Beschriftungen zum Gruppieren von Workflows. Die Workflow-Liste lässt Sie nach Beschriftung filtern, was ein umfangreiches Projekt deutlich übersichtlicher macht. Nützlich, wenn Ihre Workflows nach Team, Integration oder Umgebung organisiert sind.
- **Label rules** – unter **Workflows → Settings → Label Rules** werden neuen Workflows automatisch Beschriftungen zugewiesen, basierend auf Mustern im Namen oder in der Beschreibung.
- **Owner rules** – unter **Workflows → Settings → Owner Rules** werden neuen Workflows automatisch Eigentümer zugewiesen.

## Secrets

Markieren Sie eine globale Variable als **secret**, wenn sie etwas Sensibles enthält. Der Wert wird nach dem Speichern bei normalen API- und UI-Abfragen ausgeblendet, und das Workflow-Logging entfernt den aufgelösten Wert, bevor das Ausführungsprotokoll gespeichert wird.

Verwenden Sie geheime Variablen für:

- API-Schlüssel für externe Dienste.
- Authentifizierungs-Token.
- Webhook-Signierschlüssel.
- Alles, was jemand mit reinem Lesezugriff nicht sehen sollte.

Fügen Sie ein Geheimnis nicht direkt in einen Baustein ein – Werte wie `Authorization: Bearer eyJh...` landen dann sichtbar im Workflow und in den Protokollen. Verwenden Sie stattdessen `{{global.variables.MY_SECRET}}`.

## Workflows exportieren und importieren

Sie können einen Workflow als JSON-Datei zwischen Projekten oder zwischen einer selbst gehosteten Installation und OneUptime Cloud verschieben.

- **Export** – öffnen Sie den Workflow und verwenden Sie **Export Workflow** unter **Settings**. In der Workflow-Liste können Sie außerdem mehrere Workflows auswählen und sie in eine einzige Datei exportieren.
- **Import** – klicken Sie in der **Workflows**-Liste auf **Import JSON** und wählen Sie eine Datei, die aus einem beliebigen OneUptime-Projekt exportiert wurde.

Die Datei enthält den Namen, die Beschreibung, den aktivierten Zustand des Workflows und seinen Graphen. Absichtlich nicht enthalten sind:

- **Der Webhook-Geheimschlüssel.** Beim Erstellen des Workflows wird ein neuer generiert, sodass ein importierter Workflow eine andere Webhook-URL hat. Alles, was den ursprünglichen aufruft, muss auf die neue URL umgestellt werden.
- **Globale Variablen.** Ein Baustein, der `{{global.variables.MY_SECRET}}` liest, behält diese Referenz bei, aber der Wert ist nicht in der Datei enthalten. Legen Sie die Variablen im Zielprojekt an, bevor Sie den importierten Workflow ausführen.
- **Owners und Labels.** Die eigenen Label- und Owner-Regeln Ihres Projekts laufen gegen den importierten Workflow, genauso als hätten Sie ihn von Hand erstellt.

Ein importierter Workflow wird immer **deaktiviert** angelegt, selbst wenn er dort, wo er exportiert wurde, aktiviert war – sein Graph kann auf Monitore, Bereitschaftsrichtlinien oder andere Workflows verweisen, die im Zielprojekt nicht existieren. Prüfen Sie ihn, aktivieren Sie ihn, testen Sie ihn mit **Run Workflow**, und lassen Sie ihn dann eingeschaltet. Das Duplizieren eines Workflows verhält sich genauso, sodass eine Kopie niemals gleichzeitig mit dem Original auslöst, bevor Sie sie bearbeitet haben.

Da der Graph unverändert mitreist, reist auch alles mit, was direkt in einen Baustein eingetippt wurde. Das ist der praktische Grund, Zugangsdaten in geheimen Variablen zu halten: Der Export eines Workflows mit einem fest codierten Token gibt dieses Token an jeden weiter, der die Datei erhält.

## Wie lange eine Ausführung dauern darf

Jeder Ausführungsversuch hat eine feste Zeitgrenze. Der Runner prüft sie vor und nach jeder Komponente und markiert eine überfällige Ausführung als **Timeout**, sobald die Kontrolle zurückkehrt. Komponenten, die Netzwerk- oder Skriptarbeit verrichten, brauchen zusätzlich eigene Timeouts, weil der Runner beliebigen Komponentencode nicht zwangsweise unterbrechen kann.

Die AI-Komponente leitet ihr Timeout für die Anbieteranfrage aus der verbleibenden Workflow-Zeit ab und begrenzt es auf 60 Sekunden, wobei ein kleiner Puffer für Protokollierung und Aufräumarbeiten bleibt.

## Grenze beim Aufrufen anderer Workflows

Mit der Komponente **Execute Workflow** kann ein Workflow einen anderen aufrufen. Um versehentliche Schleifen zu verhindern, bei denen Workflow A den Workflow B aufruft, der wiederum A aufruft, gibt es eine Obergrenze dafür, wie tief die Kette gehen kann. Eine Ausführung, die diese Grenze überschreitet, endet mit einer klaren Fehlermeldung.

Wenn Sie einen echten Bedarf für eine lange Kette haben (etwa einen Job, der pro Ausführung ein Element verarbeitet), ist es meist einfacher, innerhalb eines einzigen Workflows mit **Custom Code** zu iterieren.

## Webhook-Sicherheit

Webhook-Trigger geben Ihnen eine eindeutige URL. Jeder, der die URL kennt, kann sie aufrufen. Zum Schutz vor versehentlichen oder unerwünschten Aufrufern:

- Behandeln Sie die URL wie ein Passwort. Teilen Sie sie nicht öffentlich und committen Sie sie nicht in ein öffentliches Repository.
- Bitten Sie bei sensiblen Workflows das aufrufende System, ein gemeinsames Token als Header zu senden (wie `X-Webhook-Token`), und prüfen Sie es mit einem **Conditions**-Baustein, bevor Sie etwas Wichtiges tun. Speichern Sie das erwartete Token als geheime Variable.
- Bevorzugen Sie bei sehr sensiblen Workflows einen OneUptime-Ereignis-Trigger und einen manuellen Importschritt anstelle eines öffentlichen Webhooks.

## Ausgehender Netzwerkzugriff

API- und andere HTTP-Bausteine stellen ihre Anfragen von OneUptime aus. Wenn Sie selbst hosten, stellen Sie sicher, dass Ihre Installation die Dienste erreichen kann, die Sie aufrufen. Wenn Sie OneUptime Cloud nutzen, sind unsere ausgehenden IP-Bereiche unter [IP Addresses](/docs/configuration/ip-addresses) aufgeführt, damit Sie sie auf der anderen Seite freigeben können.

## KI-Komponenten

**Generate Text with AI** sendet eine Anfrage über das konfigurierte LLM-Gateway von OneUptime. Sie verwendet den Standard-LLM-Anbieter des Projekts oder den globalen Anbieter der Installation, wenn das Projekt keinen eigenen hat. Konfigurieren Sie Anbieter unter **Project Settings → AI → LLM Providers**; geben Sie niemals einen API-Schlüssel eines Anbieters oder einen beliebigen Modell-Endpunkt direkt im Workflow ein.

Die AI-Komponente hat eine explizite Ausgangsgrenze:

- OneUptime sendet eine feste Komponenten-Sicherheitsanweisung sowie die aufgelösten Felder **System Instructions**, **Prompt** und den serialisierten **Context** an den konfigurierten Anbieter. Der Context wird nach einer expliziten Markierung am Ende der Benutzernachricht angehängt; die feste Anweisung besagt, dass alles nach dieser Markierung nicht vertrauenswürdige Daten bleibt, selbst wenn es Tags oder Anweisungen enthält.
- Sie hängt nicht automatisch die Trigger-Payload, den Workflow-Verlauf, Ausgaben anderer Komponenten, Projektdatensätze, Telemetriedaten oder Geheimnisse an. Daten verlassen das System nur, wenn Sie sie in einem dieser drei Eingabefelder referenzieren.
- Sie sendet keine Tool-Definitionen oder anbieter-native Fähigkeits-Felder. Das Modell kann über diese Komponente OneUptime nicht abfragen, keine HTTP-Anfragen stellen und keine Projektdaten verändern. Der konfigurierte Anbieter bzw. das konfigurierte Modell bleibt eine Vertrauensgrenze auf Administratorebene, sodass Installationen, die eine strikt offline laufende Generierung benötigen, ein Modell ohne intrinsische anbieterseitig verwaltete Suche wählen sollten.
- Zusätzliche Parameter auf Anbieterebene sind auf eine Positivliste rein generierungsbezogener Feineinstellungsfelder beschränkt. Sie können die Workflow-Nachrichten nicht ersetzen, keine Tools oder anbieter-native Websuche/Datenquellen hinzufügen, keine Nicht-Text-Modalitäten aktivieren, keine mehrfachen Auswahlmöglichkeiten anfordern, kein Streaming aktivieren, die Anfrage nicht über anbieterseitige Speicher-Flags aufbewahren oder die Obergrenze für Ausgabe-Token dieser Komponente anheben. Unbekannte künftige Fähigkeits-Felder werden standardmäßig verworfen.
- System Instructions, Prompt, Context und generierte Response-Werte werden in den eigenen Argument- und Rückgabewert-Einträgen dieser AI-Komponente im automatischen Workflow-Ausführungsprotokoll geschwärzt. Sie bleiben nachgelagerten Komponenten verfügbar, während die Ausführung läuft. Wenn Sie einen davon in eine andere Komponente einfügen, gilt die Protokollierungsrichtlinie dieser Komponente, die den aufgelösten Wert unter Umständen aufzeichnet; behandeln Sie eine solche Weiterverwendung als bewusste Offenlegung. Anbieter-/Modellnamen, Token-Zahlen, die LLM-Log-ID und sichere Fehlermeldungen bleiben für Betrieb und Abrechnung sichtbar. Rohe Fehlerinhalte des Anbieters werden aus Workflow-Protokollen, LLM-Protokollen, Anwendungsprotokollen und Traces ausgeschlossen, weil ein Anbieter Anfrageinhalte spiegeln kann.

Behandeln Sie jede referenzierte Variable als Daten, die Sie bewusst an den Anbieter senden. Fügen Sie insbesondere keine geheime globale Variable in den Prompt oder Context ein, es sei denn, diese Offenlegung ist erforderlich und der Anbieter ist dafür zugelassen, sie zu erhalten. Ein selbst gehosteter lokaler Anbieter wie Ollama kann die Anfrage innerhalb Ihrer eigenen Infrastruktur behalten; ein gehosteter Anbieter erhält die Anfrage gemäß den Datenverarbeitungsbedingungen dieses Anbieters.

Jeder Aufruf wird unter **Project Settings → AI → AI Logs** erfasst, einschließlich Anbieter, Modell, Status, Token, Kosten und Abrechnungsinformationen. Prompt- und Response-Vorschauen sowie rohe Fehlerdetails des Anbieters werden nicht im AI-Log gespeichert. Aufrufe über einen kostenpflichtigen globalen Anbieter verbrauchen das KI-Guthaben des Projekts. Workflow-KI zählt außerdem auf das tägliche autonome KI-Token-Budget des Projekts; ist das Budget aufgebraucht, nimmt die Komponente ihren **Error**-Pfad, ohne das Modell zu kontaktieren. Projekt-KI muss aktiviert sein. Auf OneUptime Cloud muss das Abonnement bezahlt sein, und der Growth-Plan (oder ein Plan mit Growth-Funktionen) ist erforderlich; selbst gehostete Installationen mit deaktivierter Abrechnung haben diese Plan-Sperre nicht.

Eingebaute Grenzwerte halten unbeaufsichtigte Aufrufe endlich: System Instructions, Prompt und der serialisierte Context sind zusammen auf 50.000 Zeichen begrenzt; Temperature muss zwischen `0` und `1` liegen; Maximum Output Tokens muss zwischen `1` und `4096` liegen (Standard `1024`); und die Anbieteranfrage wird einmal versucht und läuft nach höchstens 60 Sekunden ab. Pro Projekt laufen höchstens drei Workflow-KI-Aufrufe gleichzeitig; weitere Aufrufe nehmen den **Error**-Pfad und können bei einer späteren Workflow-Ausführung erneut versucht werden. Validierungs-, Konfigurations-, Zugriffs-, Budget-, Guthaben-, Gleichzeitigkeits-, Anbieter- und Timeout-Fehler nehmen alle den **Error**-Pfad und füllen die **Error**-Ausgabe. Verbinden Sie diesen Pfad, bevor Sie einen Produktions-Workflow aktivieren.

## Berechtigungen

Workflows respektieren die rollenbasierte Zugriffskontrolle Ihres Projekts. Die relevanten Berechtigungen:

- **Create / Read / Edit / Delete Workflow** – die grundlegenden Berechtigungen für den Workflow selbst.
- **Run Workflow** – erforderlich, um einen Workflow von Hand auszuführen oder ihn über die API auszulösen.
- **Read Workflow Log** – erforderlich, um Ausführungen anzusehen.
- **Read / Create / Edit / Delete Workflow Variable** – Kontrolle über die Liste der globalen Variablen.

Die meisten Ingenieure sollten Erstellungs-/Bearbeitungs-/Leserechte für Workflows haben, aber nicht für Variablen. Bewahren Sie Bearbeitungszugriff auf Variablen für die Personen auf, die die Geheimnisse Ihres Projekts verwalten.

## Plan-Grenzen

OneUptime Cloud begrenzt bei kleineren Plänen die Anzahl der Ausführungen pro Monat. Ihr aktuelles Limit wird unter **Project Settings → Billing** angezeigt. Wenn Sie es erreichen, werden neue Trigger bis zum nächsten Abrechnungszyklus abgelehnt. Selbst gehostete Installationen haben dieses Limit nicht.

## Wann Workflows nicht das richtige Werkzeug sind

Ein paar Fälle, in denen Sie zu etwas anderem greifen sollten:

- **Rechenintensive Aufgaben oder große Datenmengen** – Workflows sind für leichte Verbindungsarbeit gedacht, nicht für Zahlenverarbeitung. Führen Sie aufwendige Arbeit in Ihrer eigenen Infrastruktur aus und lassen Sie einen Workflow sie anstoßen.
- **Lang laufende aktive Berechnung** – ein einzelner Ausführungsversuch soll schnell abgeschlossen sein. Verwenden Sie für eine passive Verzögerung wie „mache A, warte zwei Stunden, mache B" die Komponente **Sleep**; sie speichert die Ausführung und setzt sie später fort, ohne einen Worker zu belegen.
- **Schrittweise Vorfallreaktion mit Menschen im Prozess** – dafür sind [Runbooks](/docs/runbooks/index) da. Workflows sind für unbeaufsichtigte Automatisierung.

## Weiterführende Themen

- [Workflows – Übersicht](/docs/workflows/index) – das große Bild.
- [Workflow-Komponenten](/docs/workflows/components) – Referenz Baustein für Baustein.
- [Runbooks](/docs/runbooks/index) – wann Sie stattdessen ein Runbook verwenden sollten.
