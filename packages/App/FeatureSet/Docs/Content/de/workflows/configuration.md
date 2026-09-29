# Konfiguration & Sicherheit

Diese Seite behandelt die Einstellungen und Sicherheitsgrenzen, die Sie kennen sollten, bevor Sie einen Workflow auf echten Verkehr loslassen.

## Einen Workflow ein- oder ausschalten

Jeder Workflow hat unter **Einstellungen** einen Schalter **Aktiviert**. Ist er aus, läuft der Workflow nicht – Webhook-Aufrufe, geplante Zeitpunkte und OneUptime-Ereignisse werden allesamt ignoriert. Neue Workflows starten deaktiviert.

Nutzen Sie diesen Schalter als Ihr Tor mit der Aufschrift „startklar“:

1. Bauen Sie den Workflow.
2. Klicken Sie im **Builder** mit realistischen Werten auf **Arbeitsablauf ausführen**.
3. Prüfen Sie die **Protokolle** – vergewissern Sie sich, dass jeder Baustein dorthin gegangen ist, wo Sie ihn erwartet haben.
4. Schalten Sie **Aktiviert** ein.

Einen Workflow auszuschalten stoppt keine Ausführungen, die schon laufen; es verhindert nur, dass neue starten.

## Eigentümer und Beschriftungen

- **Eigentümer** – Benutzer und Teams, die als Eigentümer eingetragen sind, bekommen Zugriff auf den Workflow und können sich für Benachrichtigungen anmelden, wenn er fehlschlägt. Sie tragen sie unter **Einstellungen → Eigentümer** ein.
- **Beschriftungen** – Etiketten zum Gruppieren von Workflows. Die Workflow-Liste lässt sich nach Beschriftung filtern, was ein volles Projekt deutlich übersichtlicher macht. Praktisch, wenn Sie Workflows nach Team, Integration oder Umgebung ordnen.
- **Beschriftungsregeln** – unter **Arbeitsabläufe → Einstellungen → Beschriftungsregeln** vergeben Sie automatisch Beschriftungen an neue Workflows, anhand von Mustern in Name oder Beschreibung.
- **Eigentümerregeln** – unter **Arbeitsabläufe → Einstellungen → Eigentümerregeln** weisen Sie neuen Workflows automatisch Eigentümer zu.

## Geheimnisse

Markieren Sie eine globale Variable als **Geheimnis**, wenn sie etwas Sensibles enthält. Der Wert ist nach dem Speichern bei normalen API- und UI-Zugriffen verborgen, und das Workflow-Logging entfernt den aufgelösten Wert, bevor das Ausführungsprotokoll gespeichert wird.

Nehmen Sie geheime Variablen für:

- API-Schlüssel für externe Dienste.
- Authentifizierungs-Token.
- Signaturschlüssel für Webhooks.
- Alles, was jemand mit reinem Lesezugriff nicht sehen soll.

Fügen Sie ein Geheimnis nicht direkt in einen Baustein ein – Werte wie `Authorization: Bearer eyJh...` landen sichtbar im Workflow und in den Protokollen. Nehmen Sie stattdessen `{{global.variables.MY_SECRET}}`.

## Workflows exportieren und importieren

Sie können einen Workflow als JSON-Datei zwischen Projekten bewegen oder zwischen einer selbst gehosteten Installation und OneUptime Cloud.

- **Export** – öffnen Sie den Workflow und nutzen Sie **Export Workflow** unter **Einstellungen**. Aus der Workflow-Liste heraus können Sie auch mehrere Workflows auswählen und zusammen in eine einzige Datei exportieren.
- **Import** – klicken Sie in der Liste **Arbeitsabläufe** auf **Import JSON** und wählen Sie eine Datei, die aus irgendeinem OneUptime-Projekt exportiert wurde.

Die Datei enthält Name, Beschreibung, Aktivierungszustand und den Graphen des Workflows. Bewusst nicht enthalten sind:

- **Der geheime Webhook-Schlüssel.** Beim Anlegen des Workflows wird ein frischer erzeugt, ein importierter Workflow hat also eine andere Webhook-URL. Alles, was das Original aufruft, muss umgebogen werden.
- **Globale Variablen.** Ein Baustein, der `{{global.variables.MY_SECRET}}` liest, behält diese Referenz, aber der Wert steckt nicht in der Datei. Legen Sie die Variablen im Zielprojekt an, bevor Sie den importierten Workflow ausführen.
- **Eigentümer und Beschriftungen.** Die Beschriftungs- und Eigentümerregeln Ihres eigenen Projekts laufen über den importierten Workflow, genauso als hätten Sie ihn von Hand angelegt.

Ein importierter Workflow wird immer **deaktiviert** angelegt, selbst wenn er dort, wo er exportiert wurde, aktiviert war – sein Graph kann auf Monitore, Bereitschaftsrichtlinien oder andere Workflows zeigen, die es im Zielprojekt nicht gibt. Prüfen Sie ihn, aktivieren Sie ihn, testen Sie ihn mit **Arbeitsablauf ausführen**, und lassen Sie ihn dann eingeschaltet. Einen Workflow zu duplizieren verhält sich genauso, sodass eine Kopie nie neben dem Original zu feuern beginnt, bevor Sie sie bearbeitet haben.

Weil der Graph unverändert mitreist, reist auch alles mit, was direkt in einen Baustein getippt wurde. Das ist der praktische Grund, Zugangsdaten in geheimen Variablen zu halten: Wer einen Workflow mit fest eingetragenem Token exportiert, händigt dieses Token jedem aus, der die Datei bekommt.

## Wie lange eine Ausführung dauern darf

Jeder Ausführungsversuch hat eine Frist in echter Uhrzeit. Der Runner prüft sie vor und nach jeder Komponente und markiert eine überfällige Ausführung als **Timeout**, sobald die Kontrolle zurückkommt. Komponenten, die Netzwerk- oder Skriptarbeit erledigen, brauchen zusätzlich eigene Timeouts, weil der Runner beliebigen Komponentencode nicht mit Gewalt unterbrechen kann.

Die KI-Komponente leitet ihr Timeout für die Anbieteranfrage aus der verbleibenden Workflow-Zeit ab und deckelt es bei 60 Sekunden, mit einem kleinen Puffer für Protokollierung und Aufräumarbeiten.

## Grenze beim Aufrufen anderer Workflows

Mit der Komponente **Execute Workflow** kann ein Workflow einen anderen aufrufen. Damit nicht versehentlich Schleifen entstehen, in denen Workflow A B aufruft und B wieder A, gibt es eine Obergrenze dafür, wie tief die Kette gehen darf. Eine Ausführung, die darüber hinausgeht, endet mit einem klaren Fehler.

Wenn Sie eine lange Kette wirklich brauchen (etwa einen Job, der pro Ausführung ein Element abarbeitet), ist es meist einfacher, innerhalb eines einzigen Workflows mit **Custom Code** zu schleifen.

## Webhook-Sicherheit

Webhook-Trigger geben Ihnen eine eindeutige URL. Jeder, der die URL kennt, kann sie aufrufen. Zum Schutz vor versehentlichen oder unerwünschten Aufrufern:

- Behandeln Sie die URL wie ein Passwort. Teilen Sie sie nicht öffentlich und checken Sie sie nicht in ein öffentliches Repo ein.
- Lassen Sie bei sensiblen Workflows das aufrufende System ein gemeinsames Token als Header mitschicken (etwa `X-Webhook-Token`) und prüfen Sie es mit einem Baustein **Conditions**, bevor irgendetwas Wichtiges passiert. Speichern Sie das erwartete Token als geheime Variable.
- Ziehen Sie bei sehr sensiblen Workflows einen OneUptime-Ereignis-Trigger mit einem manuellen Importschritt einem öffentlichen Webhook vor.

## Ausgehender Netzwerkzugriff

API- und andere HTTP-Bausteine stellen ihre Anfragen von OneUptime aus. Wenn Sie selbst hosten, sorgen Sie dafür, dass Ihre Installation die Dienste erreicht, die Sie aufrufen. Wenn Sie OneUptime Cloud nutzen, sind unsere ausgehenden IP-Bereiche unter [IP-Adressen](/docs/configuration/ip-addresses) aufgeführt, sodass Sie sie auf der Gegenseite freigeben können.

## KI-Komponenten

**Generate Text with AI** schickt genau eine Anfrage durch das konfigurierte LLM-Gateway von OneUptime. Die Komponente nutzt den Standard-LLM-Anbieter des Projekts oder den globalen Anbieter der Installation, wenn das Projekt keinen hat. Anbieter konfigurieren Sie unter **Projekteinstellungen → KI → LLM-Anbieter**; tragen Sie niemals einen Anbieter-API-Schlüssel oder einen beliebigen Modell-Endpunkt in den Workflow selbst ein.

Die KI-Komponente hat eine ausdrückliche Grenze für ausgehende Daten:

- OneUptime schickt eine feste Sicherheitsanweisung für die Komponente sowie die aufgelösten **System Instructions**, den **Prompt** und den serialisierten **Context** an den konfigurierten Anbieter. Der Context wird nach einer ausdrücklichen Markierung ans Ende der Benutzernachricht gehängt; die feste Anweisung sagt, dass alles nach dieser Markierung nicht vertrauenswürdige Daten bleibt, auch wenn Tags oder Anweisungen darin stehen.
- Sie hängt weder die Trigger-Payload noch Workflow-Historie, Ausgaben anderer Komponenten, Projektdatensätze, Telemetrie oder Geheimnisse automatisch an. Daten gehen nur dann hinaus, wenn Sie sie in einem dieser drei Eingabefelder referenzieren.
- Sie schickt keine Tool-Definitionen und keine anbietereigenen Capability-Felder. Das Modell kann über diese Komponente weder OneUptime abfragen noch HTTP-Anfragen stellen noch Projektdaten ändern. Der konfigurierte Anbieter und das Modell bleiben eine Vertrauensgrenze, die Administratoren setzen; Installationen, die strikt offline erzeugen müssen, sollten deshalb ein Modell ohne eingebaute, vom Anbieter verwaltete Recherche wählen.
- Zusätzliche Parameter auf Anbieterebene sind auf eine Positivliste reiner Generierungs-Feineinstellungen beschränkt. Sie können die Workflow-Nachrichten nicht ersetzen, keine Tools und keine anbietereigene Websuche oder Datenquellen hinzufügen, keine nicht-textuellen Modalitäten aktivieren, keine mehreren Antwortvarianten anfordern, kein Streaming einschalten, die Anfrage nicht über Speicher-Flags des Anbieters aufbewahren und die Obergrenze für Ausgabe-Token dieser Komponente nicht anheben. Unbekannte künftige Capability-Felder werden standardmäßig verworfen.
- System Instructions, Prompt, Context und die erzeugten Response-Werte werden in den Argument- und Rückgabewert-Einträgen dieser KI-Komponente im automatischen Workflow-Ausführungsprotokoll geschwärzt. Während die Ausführung läuft, stehen sie nachgelagerten Komponenten weiterhin zur Verfügung. Setzen Sie einen davon in eine andere Komponente ein, gilt deren Protokollierungsregel, und sie kann den aufgelösten Wert festhalten; behandeln Sie eine solche Weiterverwendung als bewusste Offenlegung. Anbieter- und Modellnamen, Token-Zahlen, die LLM Log ID und unbedenkliche Fehlermeldungen bleiben für Betrieb und Abrechnung sichtbar. Rohe Fehlertexte des Anbieters sind aus Workflow-Protokollen, KI-Protokollen, Anwendungsprotokollen und Traces ausgeschlossen, weil ein Anbieter Inhalte der Anfrage zurückspiegeln kann.

Behandeln Sie jede referenzierte Variable als Daten, die Sie bewusst an den Anbieter schicken. Setzen Sie insbesondere keine geheime globale Variable in Prompt oder Context, es sei denn, diese Offenlegung ist nötig und der Anbieter darf sie empfangen. Ein selbst gehosteter lokaler Anbieter wie Ollama kann die Anfrage in Ihrer eigenen Infrastruktur halten; ein gehosteter Anbieter empfängt die Anfrage unter den Datenverarbeitungsbedingungen dieses Anbieters.

Jeder Aufruf wird unter **Projekteinstellungen → KI → KI-Protokolle** festgehalten, samt Anbieter, Modell, Status, Token, Kosten und Abrechnungsinformationen. Vorschauen von Prompt und Antwort sowie rohe Fehlerdetails des Anbieters werden im KI-Protokoll nicht gespeichert. Aufrufe über einen kostenpflichtigen globalen Anbieter verbrauchen das KI-Guthaben des Projekts. Workflow-KI zählt außerdem auf das tägliche Budget des Projekts für autonome KI-Token; ist das Budget aufgebraucht, nimmt die Komponente ihren Pfad **Fehler**, ohne das Modell zu kontaktieren. KI muss im Projekt aktiviert sein. Auf OneUptime Cloud muss das Abonnement bezahlt sein, und es ist der Growth-Plan nötig (oder ein Plan, der die Growth-Funktionen enthält); selbst gehostete Installationen mit deaktivierter Abrechnung haben diese Plan-Schranke nicht.

Eingebaute Grenzen halten unbeaufsichtigte Aufrufe endlich: System Instructions, Prompt und serialisierter Context sind zusammen auf 50.000 Zeichen begrenzt; Temperature muss zwischen `0` und `1` liegen; Maximum Output Tokens muss zwischen `1` und `4096` liegen (Standard `1024`); und die Anbieteranfrage wird genau einmal versucht und läuft nach höchstens 60 Sekunden ab. Pro Projekt laufen höchstens drei KI-Aufrufe aus Workflows gleichzeitig; weitere Aufrufe nehmen den Pfad **Fehler** und lassen sich von einer späteren Ausführung erneut versuchen. Fehler bei Validierung, Konfiguration, Zugriff, Budget, Guthaben, Parallelität, Anbieter und Timeout nehmen allesamt den Pfad **Fehler** und füllen die Ausgabe **Fehler**. Verbinden Sie diesen Pfad, bevor Sie einen produktiven Workflow aktivieren.

## Berechtigungen

Workflows richten sich nach der rollenbasierten Zugriffssteuerung Ihres Projekts. Die relevanten Berechtigungen:

- **Create / Read / Edit / Delete Workflow** – die Grundberechtigungen auf den Workflow selbst.
- **Run Workflow** – nötig, um einen Workflow von Hand auszuführen oder ihn über die API auszulösen.
- **Read Workflow Log** – nötig, um Ausführungen anzusehen.
- **Read / Create / Edit / Delete Workflow Variable** – Kontrolle über die Liste der globalen Variablen.

Die meisten Entwickler sollten auf Workflows Create/Edit/Read haben, auf Variablen aber nicht. Heben Sie den Schreibzugriff auf Variablen für die Leute auf, die die Geheimnisse Ihres Projekts verwalten.

## Plan-Grenzen

OneUptime Cloud deckelt in den kleineren Plänen die Zahl der Ausführungen pro Monat. Ihre aktuelle Grenze steht unter **Projekteinstellungen → Abrechnung**. Ist sie erreicht, werden neue Trigger abgelehnt, bis der nächste Abrechnungszeitraum beginnt. Selbst gehostete Installationen haben diese Grenze nicht.

## Wann Workflows nicht das richtige Werkzeug sind

Ein paar Fälle, in denen Sie zu etwas anderem greifen sollten:

- **Schwere Berechnungen oder große Datenmengen** – Workflows sind für leichte Verbindungsarbeit gedacht, nicht fürs Zahlenschaufeln. Lassen Sie schwere Arbeit in Ihrer eigenen Infrastruktur laufen und einen Workflow sie nur anstoßen.
- **Lang laufende aktive Berechnung** – ein einzelner Ausführungsversuch soll schnell fertig werden. Für eine passive Pause nach dem Muster „tu A, warte zwei Stunden, tu B“ nehmen Sie die Komponente **Sleep**; sie hält die Ausführung fest und setzt sie später fort, ohne einen Worker zu belegen.
- **Schrittweise Vorfallreaktion mit Menschen im Prozess** – dafür sind [Runbooks](/docs/runbooks/index) da. Workflows sind für unbeaufsichtigte Automatisierung.

## Weiterführende Themen

- [Workflows – Übersicht](/docs/workflows/index) – das große Ganze.
- [Workflow-Komponenten](/docs/workflows/components) – Referenz Baustein für Baustein.
- [Runbooks – Übersicht](/docs/runbooks/index) – wann Sie stattdessen ein Runbook nehmen.
