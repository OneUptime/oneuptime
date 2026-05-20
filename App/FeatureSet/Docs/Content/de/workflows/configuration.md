# Konfiguration & Sicherheit

Diese Seite sammelt die Einstellungen und Sicherheitslimits, die Sie kennen sollten, bevor Sie einen Workflow auf Produktions-Traffic richten.

## Aktivieren / Deaktivieren

Jeder Workflow hat ein **isEnabled**-Flag in **Settings**. Deaktivierte Workflows feuern nie — Modellereignisse, Webhooks und geplante Ausführungen werden ignoriert. Neue Workflows werden deaktiviert ausgeliefert.

Behandeln Sie dies als Ihren „bereit für die Produktion"-Schalter:

1. Workflow bauen.
2. Auf **Manuell ausführen** mit einem repräsentativen Payload klicken.
3. **Logs** prüfen — bestätigen, dass jeder Knoten den erwarteten Port genommen hat.
4. **isEnabled** einschalten.

Das Deaktivieren eines Workflows beeinflusst keine bereits laufenden Ausführungen; es stoppt nur, dass neue erstellt werden.

## Ownership und Labels

- **Owners** — Benutzer und Teams, die als Owner aufgelistet sind, erhalten berechtigungsbasierten Zugriff und (optional) Benachrichtigungen, wenn der Workflow fehlschlägt. Konfigurieren unter **Settings → Owners**.
- **Labels** — Many-to-many-Tags zum Organisieren von Workflows. Filtern Sie die Workflow-Liste nach Label. Nützlich, wenn ein Projekt Dutzende von Workflows hat, die nach Team, Integration oder Umgebung organisiert sind.
- **Label rules** — unter **Workflows → Settings → Label Rules** Labels automatisch auf neue Workflows anwenden, basierend auf Regex-Übereinstimmungen im Namen oder in der Beschreibung.
- **Owner rules** — unter **Workflows → Settings → Owner Rules** Owner automatisch neuen Workflows zuweisen.

## Geheimnisse

Globale Variablen können als **geheim** markiert werden. Der Wert wird im Ruhezustand verschlüsselt, ist nach dem Speichern in der UI nur beschreibbar und wird aus Ausführungsprotokollen redigiert (ersetzt durch `[REDACTED]`).

Verwenden Sie geheime Variablen für:

- API-Schlüssel für ausgehende Integrationen.
- Bearer-Tokens.
- Webhook-Signaturschlüssel.
- Jeden Wert, den ein Angreifer mit Lesezugriff auf einen Workflow nicht sehen sollte.

Fügen Sie kein Geheimnis direkt in das Argument einer Komponente ein — Referenzen wie `Authorization: Bearer eyJh...` erscheinen im Workflow-JSON und in den Ausführungsprotokollen im Klartext. Referenzieren Sie stattdessen `{{variable.MY_SECRET}}`.

## Ausführungs-Timeout

Jede Ausführung hat eine maximale Dauer. Wenn eine Ausführung nicht innerhalb des Timeouts beendet ist, wird sie als `Timeout` markiert und jede in-flight Komponente wird abgebrochen. Der Standardwert ist großzügig (Minuten, keine Sekunden) — siehe die Umgebungskonfiguration des Workers für den exakten Wert in Ihrer Installation.

Die meisten Komponenten haben ihre eigenen Pro-Aufruf-Timeouts innerhalb des Ausführungs-Timeouts — z. B. wird die API-Komponente bei einer hängenden ausgehenden Anfrage deutlich vor dem gesamten Lauf aufgeben.

## Rekursionslimit

Die **Execute Workflow**-Komponente lässt einen Workflow einen anderen aufrufen. Um Endlosschleifen zu verhindern, in denen A B aufruft und B wieder A unbegrenzt, verfolgt der Worker die Aufrufkette und stoppt eine Kette, die eine feste Tiefe überschreitet (typischerweise eine kleine Zahl wie 5). Die abbrechende Ausführung wird als `Error` mit einer klaren Nachricht über das Rekursionslimit markiert.

Wenn Sie einen legitimen Bedarf für eine lange Kette haben (z. B. einen rekursiven Ordner-Walk, der eine Ebene pro Lauf verarbeitet), refaktorieren Sie ihn in einen einzigen Workflow, der intern via **Custom Code** iteriert — dieses Muster unterliegt nicht dem Kettenlimit.

## Webhook-Sicherheit

Webhook-Trigger stellen eine eindeutige HTTPS-URL bereit. Jeder, der die URL kennt, kann sie aufrufen. Um sich gegen versehentliche oder feindliche Aufrufer zu verteidigen:

- Behandeln Sie die URL als geteiltes Geheimnis. Fügen Sie sie nicht in öffentliche Chats ein oder committen Sie sie in ein öffentliches Repo.
- Für wertvolle Workflows bitten Sie das aufrufende System, ein geteiltes Geheimnis als Header (z. B. `X-Webhook-Token`) einzuschließen, und validieren Sie es in einem **Conditions**-Knoten, bevor Sie etwas Zerstörerisches tun. Definieren Sie das erwartete Token als geheime globale Variable.
- Für sehr wertvolle Workflows bevorzugen Sie einen Modellereignis-Trigger und einen manuellen Importschritt anstelle eines öffentlichen Webhooks.

## Ausgehender Netzwerk-Egress

Die API- und andere HTTP-artige Komponenten senden Anfragen aus dem Netzwerk des OneUptime-Workflow-Workers. Wenn Sie OneUptime selbst hosten, ist das ausgehende Netzwerk des Workers Ihre Sache — stellen Sie sicher, dass es die Drittanbieter-APIs erreichen kann, die Sie aufrufen. Wenn Sie OneUptime Cloud verwenden, ist unser IP-Egress-Bereich in [IP-Adressen](/docs/configuration/ip-addresses) veröffentlicht, sodass Sie auf der Empfängerseite eine Allowlist setzen können.

## Berechtigungen

Workflows sind erstklassige Ressourcen, die der projektweiten rollenbasierten Zugriffskontrolle unterliegen:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — die vier CRUD-Berechtigungen auf Workflow-Vorlagen.
- `RunWorkflow` — benötigt, um auf **Manuell ausführen** zu klicken oder einen Workflow per API zu starten.
- `ReadWorkflowLog` — benötigt, um die Seite **Runs & Logs** anzuzeigen.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — Kontrolle über die Liste der globalen Variablen.

Die meisten Engineers sollten Create/Edit/Read auf Workflows haben, aber nicht auf Variablen. Reservieren Sie Variablen-Bearbeitungsrechte für die Personen, die die Geheimnisse Ihres Projekts verwalten.

## Kontingente

OneUptime Cloud begrenzt die Anzahl der Ausführungen pro Monat und Projekt in kleineren Tarifen. Die Obergrenze wird unter **Project Settings → Billing** angezeigt. Wenn Sie sie erreichen, werden neue Trigger abgewiesen (und mit einem Grund „quota exceeded" auf dem betroffenen Workflow aufgezeichnet), bis der nächste Abrechnungszyklus beginnt. Selbstgehostete Installationen unterliegen keinem Kontingent.

## Wozu Workflows *nicht* gut sind

Ein paar Muster, bei denen Sie zu einem anderen Tool greifen sollten:

- **Lang laufende Berechnungen** — Workflows sind auf Klebelogik zwischen Systemen ausgerichtet, nicht auf das Crunchen großer Datensätze. Führen Sie schwere Arbeit in Ihrer eigenen Infrastruktur aus und verwenden Sie einen Workflow, um sie anzustoßen.
- **Zustandsbehaftete Workflows, die sich über Minuten/Stunden erstrecken** — eine einzelne Ausführung soll schnell beendet werden. Wenn Sie „tue A, warte zwei Stunden, tue B" benötigen, modellieren Sie die Wartezeit als externen Scheduler, der an einen Webhook-Trigger zurückpostet.
- **Schrittweise Vorfallreaktion mit menschlichen Checkpoints** — dafür sind [Runbooks](/docs/runbooks/index) gedacht. Verwenden Sie einen Workflow, wenn kein Mensch im Spiel ist; verwenden Sie ein Runbook, wenn doch.

## Wo weiterlesen

- [Workflows – Übersicht](/docs/workflows/index) — die konzeptionelle Karte.
- [Komponenten](/docs/workflows/components) — Argument-Details für jede Aktion.
- [Runbooks](/docs/runbooks/index) — wann ein Runbook stattdessen zu verwenden ist.
