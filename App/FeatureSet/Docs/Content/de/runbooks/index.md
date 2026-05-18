# Runbooks – Übersicht

Runbooks sind wiederverwendbare Reaktionsverfahren — geordnete Listen aus manuellen oder automatisierten Schritten — die Sie an Vorfälle, Warnmeldungen oder geplante Wartungsereignisse anhängen. Sie machen aus ad-hoc „Was tun wir jetzt?"-Slack-Threads etwas, das ein Teammitglied um 3 Uhr morgens kalt aufnehmen kann.

## Auf einen Blick

- **Top-Level-Feature** im OneUptime-Dashboard unter **Analytics & Automation → Runbooks**.
- **Vier Schritttypen**: Manuelle Checkliste, JavaScript (in Sandbox) und Bash (beide laufen auf einem [Runbook-Agent](/docs/runbooks/agents) in Ihrer eigenen Infrastruktur), HTTP-Anfrage.
- **Drei Auslösepfade**: Regeln, die auf Vorfälle/Warnmeldungen/geplante Wartung passen, oder ein manueller „Runbook ausführen"-Button auf jedem Ereignis.
- **Snapshot-Semantik**: Wenn ein Runbook startet, werden seine Schritte auf die Ausführung kopiert. Späteres Bearbeiten der Vorlage verändert nie einen laufenden Ablauf.
- **Vollständiger Audit-Trail**: Status, Ausgabe, Fehlermeldung und Dauer jedes Schritts werden für immer auf der Ausführung festgehalten.

## Warum Runbooks?

Vorfallreaktion entscheidet oft zwischen einem einminütigen Hänger und einem mehrstündigen Ausfall. Runbooks helfen Ihnen dabei:

- **Implizites Wissen festhalten** — das „Was tun, wenn die Queue voll läuft" liegt dort, wo Ihr Team es finden kann.
- **Mean Time to Recovery (MTTR) senken** — automatisierte Schritte laufen in Sekunden; manuelle Schritte entfernen Entscheidungslähmung.
- **Reaktionsmaßnahmen prüfen** — jeder ausgeführte Schritt, jede Ausgabe, jeder Klick einer reagierenden Person wird auf der Ausführung protokolliert.
- **Junior-Engineers schnell ans Werk bringen** — sie können ein Runbook mit Vertrauen ausführen, anstatt um 3 Uhr morgens einen Senior anzupiepen.
- **Post-Mortems aus Daten schreiben, nicht aus dem Gedächtnis** — die festgehaltene Ausführung ist ein eingefrorenes Protokoll dessen, was genau passiert ist.

## Schlüsselbegriffe

Ein paar Begriffe tauchen in den restlichen Runbook-Docs immer wieder auf. Klären Sie diese zuerst:

| Begriff | Bedeutung |
| --- | --- |
| **Runbook** | Die Vorlage. Eine benannte, wiederverwendbare Prozedur mit einer geordneten Schrittliste und einem `isEnabled`-Flag. |
| **Schritt** | Ein Eintrag in einem Runbook. Hat einen Typ (Manuell / JavaScript / HTTP / Bash), einen Titel, eine Beschreibung und typspezifische Konfiguration. |
| **Runbook-Regel** | Ein Muster, das eines oder mehrere Runbooks automatisch an Vorfälle, Warnmeldungen oder geplante Wartungsereignisse anhängt, wenn deren Titel oder Beschreibung einem Regex entspricht. |
| **Ausführung** | Ein Lauf eines Runbooks. Wird erstellt, wenn eine Regel feuert, jemand „Runbook ausführen" auf einem Ereignis klickt oder jemand „Jetzt ausführen" auf dem Runbook selbst klickt. Enthält einen Snapshot der Schritte und den Status / die Ausgabe pro Schritt. |
| **Snapshot** | Die eingefrorene Kopie der Runbook-Schritte, die auf jeder Ausführung lebt. Damit können Sie die Vorlage später bearbeiten, ohne die Historie umzuschreiben. |

## Der Lebenszyklus eines Runbooks

1. **Verfassen** — Erstellen Sie ein Runbook und legen Sie eine Mischung aus manuellen, JavaScript-, HTTP- und Bash-Schritten an. Speichern.
2. **(Optional) Eine Regel hinzufügen** — Sagen Sie OneUptime in den Einstellungen von Vorfällen, Warnmeldungen oder geplanter Wartung, dieses Runbook zu starten, sobald der Titel oder die Beschreibung eines Ereignisses einem Regex entspricht.
3. **Auslösen** — Entweder feuert die Regel automatisch, wenn ein passendes Ereignis erstellt wird, oder eine reagierende Person klickt manuell auf **Runbook ausführen**.
4. **Ausführen** — Eine neue Ausführung wird mit einem Snapshot der Schritte erstellt. Automatisierte Schritte laufen inline auf dem Runbook-Worker; die Ausführung pausiert an jedem manuellen Schritt, bis jemand ihn abhakt.
5. **Prüfen** — Die Ausführung bleibt für immer im **Runbooks**-Tab des Ereignisses und in der **Ausführungen**-Liste des Runbooks. Ausgaben, Fehler und Zeiten pro Schritt werden für das Post-Mortem aufbewahrt.

## Wann welcher Schritttyp?

Ein schneller Entscheidungsguide. Die längere Erklärung steht in [Ein Runbook verfassen](/docs/runbooks/authoring).

| Schritttyp | Greifen Sie hierzu, wenn… | Beispiel |
| --- | --- | --- |
| **Manuell** | Ein Mensch muss etwas verifizieren, ein Urteil fällen oder eine Aktion ausführen, die OneUptime nicht beobachten kann. | „Sekundären Region-Traffic auf dem Load-Balancer-Dashboard bestätigen." |
| **JavaScript** | Sie brauchen eine kleine, abgeschlossene Berechnung — einen Config-Service abfragen, ein Payload transformieren, vor dem nächsten Schritt Logik laufen lassen. Läuft sandboxed auf einem [Runbook-Agent](/docs/runbooks/agents) in Ihrer eigenen Infrastruktur. | Aktuelles Replica-Lag berechnen und entscheiden, ob weitergemacht wird. |
| **HTTP-Anfrage** | Sie rufen ein bestehendes API auf — Ihren eigenen Admin-Endpoint, einen Cloud-Provider, PagerDuty, Slack. | `POST` an Ihren Failover-Orchestrator. |
| **Bash** | Sie müssen Shell-Befehle in Ihrer eigenen Infrastruktur ausführen — einen Dienst neu starten, `kubectl` aufrufen, ein Deploy-Skript aufrufen. Benötigt einen [Runbook-Agent](/docs/runbooks/agents), der in Ihrer Umgebung installiert ist. | Einen Dienst neu starten, `kubectl rollout restart` ausführen, ein Recovery-Skript aufrufen. |

Sie können alle vier in einem einzigen Runbook mischen — die Stärke von Runbooks liegt darin, menschliche Verifizierung mit Automatisierung zu verschränken.

## Wo Runbooks im Dashboard leben

| Seite | Was Sie dort tun |
| --- | --- |
| **Analytics & Automation → Runbooks** | Runbook-Vorlagen durchsuchen, erstellen und bearbeiten. |
| **Steps-Tab eines Runbooks** | Schrittliste verfassen und sortieren. |
| **Executions-Tab eines Runbooks** | Jeden Lauf dieses Runbooks mit Statusfiltern sehen. |
| **„Jetzt ausführen"-Button eines Runbooks** | Eine Ad-hoc-Ausführung starten, die an kein Ereignis gekoppelt ist. |
| **Incidents / Alerts / Scheduled Maintenance → Settings → Runbook Rules** | Auto-Trigger-Regeln pro Entitätstyp erstellen. |
| **Vorfall / Warnmeldung / Wartungsereignis → Runbooks-Tab** | Ausführungen sehen, die an dieses Ereignis angehängt sind, und **Runbook ausführen** für einen manuellen Lauf klicken. |

## Häufige Anwendungsfälle

Ein paar Muster, für die wir Teams Runbooks nutzen sehen:

- **Datenbank-Failover** — Aktuellen Zustand mit JavaScript erfassen, den diensthabenden DBA bitten, die Replica-Gesundheit zu bestätigen (Manuell), das Orchestrator-API aufrufen (HTTP), „DNS aktualisiert" abhaken (Manuell), Entwarnung in Slack posten (HTTP).
- **Cache leeren** — Ein einziger HTTP-Schritt plus ein manueller „Bestätigen, dass die Cache-Hit-Rate sich auf dem Dashboard erholt".
- **Kundenrelevanter Vorfall** — Manuell: „Statusseiten-Update posten." HTTP: „CS-Team in #customer-incidents benachrichtigen." JavaScript: „Liste betroffener Accounts aus dem internen API holen."
- **Pre-Flight für geplante Wartung** — JavaScript: Snapshot der aktuellen Metriken. Manuell: „Wartungsfenster mit Stakeholdern bestätigen." HTTP: Wartungsmodus auf dem Load Balancer aktivieren.
- **Always-Run-Hygiene** — Eine Regel mit leerem Titelmuster, die bei jedem Vorfall den Systemzustand erfasst, egal welchem — ideal für Post-Mortems.

## Ein durchgespieltes Beispiel

Angenommen, Sie möchten, dass jeder Vorfall mit „db-primary" im Titel automatisch ein fünfstufiges DB-Failover-Runbook anstößt.

**1. Runbook erstellen.** Unter **Runbooks → Runbook erstellen** nennen Sie es „DB-Primary-Failover" und fügen diese Schritte hinzu:

| # | Typ | Titel |
| --- | --- | --- |
| 1 | JavaScript | Replica-Lag vor dem Failover erfassen |
| 2 | Manuell | Replica-Gesundheit im DBA-Dashboard bestätigen |
| 3 | HTTP | `POST` an den Failover-Orchestrator |
| 4 | Manuell | Bestätigen, dass Writes nun an den neuen Primary gehen |
| 5 | HTTP | Entwarnung an `#db-incidents` Slack posten |

**2. Regel hinzufügen.** Unter **Incidents → Settings → Runbook Rules** erstellen Sie:

```
Title Pattern:  ^db-primary
Runbooks:       [DB-Primary-Failover]
```

**3. Auslösen.** Eine Monitor-Warnmeldung öffnet den Vorfall `INC-4821 · db-primary connection timeout`. Die Regel passt, eine Ausführung wird erstellt, und:

- Schritt 1 (JavaScript) läuft sofort auf dem Worker — sein `return { lagMs: 412 }`-Wert wird festgehalten.
- Schritt 2 (Manuell) pausiert den Lauf. Der Diensthabende sieht ein „Wartet auf Sie"-Etikett auf der Vorfallseite, klickt auf das Dashboard und hakt den Schritt ab.
- Schritt 3 (HTTP) läuft, sobald Schritt 2 abgehakt ist — der `POST`-Response-Body wird festgehalten.
- Schritt 4 (Manuell) pausiert erneut.
- Schritt 5 (HTTP) läuft, und die Ausführung endet.

**4. Prüfen.** Die Ausführung bleibt im **Runbooks**-Tab des Vorfalls. Die Ausgabe jedes Schritts ist einen Klick entfernt. Wenn Sie nächste Woche das Post-Mortem schreiben, müssen Sie nicht fragen „Was hat dieses Skript zurückgegeben?" — es steht direkt dort.

## Wie Runbooks ins restliche OneUptime passen

- **Monitore** öffnen Vorfälle und Warnmeldungen; **Runbook-Regeln** verwandeln diese Ereignisse in Runbook-Ausführungen. Zusammen bilden sie eine geschlossene Schleife: erkennen → auslösen → reagieren → protokollieren.
- **Workspace-Verbindungen** (Slack, Microsoft Teams) sind ein natürliches Ziel für Runbook-HTTP-Schritte — Status-Updates posten, Kanäle benachrichtigen.
- **Statusseiten** werden häufig als manueller Schritt in einem kundenrelevanten Runbook aktualisiert.
- **Bereitschaftspläne** entscheiden, wer gepiept wird; Runbooks entscheiden, was diese Person tut, sobald sie wach ist.

## Wo weiterlesen

- [Ein Runbook verfassen](/docs/runbooks/authoring) — Runbooks erstellen, die vier Schritttypen und was jeder tut.
- [Runbook-Regeln](/docs/runbooks/rules) — Runbooks automatisch an Vorfälle, Warnmeldungen und geplante Wartungsereignisse anhängen.
- [Ein Runbook ausführen](/docs/runbooks/running) — manuelle Auslöser, die Ausführungsansicht und wie manuelle Schritte mit automatisierten interagieren.
- [Runbook-Agents](/docs/runbooks/agents) — die Agents installieren, die Bash-Schritte in Ihrer eigenen Infrastruktur ausführen.
- [Runbook-Konfiguration & Sicherheit](/docs/runbooks/configuration) — Ausgabe-Limits, Berechtigungen, Härtungshinweise.
