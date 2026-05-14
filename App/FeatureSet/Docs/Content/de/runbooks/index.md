# Runbooks – Übersicht

Runbooks sind wiederverwendbare Reaktionsprozeduren — geordnete Listen aus manuellen oder automatisierten Schritten — die Sie an Vorfälle, Warnmeldungen oder geplante Wartungsereignisse anhängen. Sie verwandeln ad-hoc-Slack-Diskussionen vom Typ „Was tun wir jetzt?" in etwas, das ein Teammitglied um 3 Uhr morgens ohne Vorwissen aufnehmen kann.

## Auf einen Blick

- **Top-Level-Funktion** im OneUptime-Dashboard unter **Analyse & Automatisierung → Runbooks**.
- **Vier Schritttypen**: Manuelle Checkliste, JavaScript (Sandbox), HTTP-Anfrage, Bash (läuft auf einem [Runbook-Agent](/docs/runbooks/agents) in Ihrer eigenen Infrastruktur).
- **Drei Auslöserpfade**: Regeln, die auf Vorfälle/Warnmeldungen/geplante Wartung passen, oder die manuelle Schaltfläche „Runbook ausführen" bei jedem Ereignis.
- **Snapshot-Semantik**: Beim Start eines Runbooks werden seine Schritte in die Ausführung kopiert. Späteres Bearbeiten der Vorlage verändert eine laufende Ausführung nie.
- **Vollständiger Audit-Trail**: Status, Ausgabe, Fehlermeldung und Dauer jedes Schritts werden dauerhaft in der Ausführung festgehalten.

## Warum Runbooks?

Die Reaktion auf Vorfälle entscheidet oft darüber, ob ein Problem nur einen Moment dauert oder zu einem mehrstündigen Ausfall wird. Runbooks helfen Ihnen:

- **Spezialwissen festhalten** — die Antwort auf „Was tun, wenn sich die Queue staut?" liegt dort, wo Ihr Team sie findet.
- **Mean Time to Recovery (MTTR) senken** — automatisierte Schritte laufen in Sekunden; manuelle Schritte beseitigen Entscheidungslähmung.
- **Reaktionen prüfbar machen** — jeder Schritt, jede Ausgabe, jeder Klick eines Bearbeiters wird in der Ausführung protokolliert.
- **Junioren handlungsfähig machen** — sie können ein Runbook mit Selbstvertrauen ausführen, statt um 3 Uhr morgens einen Senior anzurufen.
- **Postmortems aus Daten schreiben, nicht aus Erinnerungen** — die erfasste Ausführung ist eine eingefrorene Aufzeichnung dessen, was tatsächlich passiert ist.

## Schlüsselkonzepte

Einige Begriffe tauchen in der restlichen Runbook-Dokumentation immer wieder auf. Klären wir sie zuerst:

| Begriff | Bedeutung |
| --- | --- |
| **Runbook** | Die Vorlage. Eine benannte, wiederverwendbare Prozedur mit einer geordneten Liste von Schritten und einem `isEnabled`-Flag. |
| **Schritt** | Ein Element in einem Runbook. Hat einen Typ (Manuell / JavaScript / HTTP / Bash), einen Titel, eine Beschreibung und typspezifische Konfiguration. |
| **Runbook-Regel** | Ein Muster, das ein oder mehrere Runbooks automatisch an Vorfälle, Warnmeldungen oder geplante Wartungsereignisse anhängt, wenn deren Titel oder Beschreibung auf einen regulären Ausdruck passt. |
| **Ausführung** | Ein Lauf eines Runbooks. Wird erstellt, wenn eine Regel auslöst, jemand „Runbook ausführen" bei einem Ereignis klickt oder jemand „Jetzt ausführen" auf dem Runbook selbst klickt. Enthält einen Snapshot der Schritte und den Status / die Ausgabe jedes einzelnen Schritts. |
| **Snapshot** | Die eingefrorene Kopie der Schritte des Runbooks, die in jeder Ausführung lebt. Erlaubt Ihnen, die Vorlage später zu bearbeiten, ohne die Historie umzuschreiben. |

## Der Lebenszyklus eines Runbooks

1. **Verfassen** — Erstellen Sie ein Runbook, kombinieren Sie manuelle, JavaScript-, HTTP- und Bash-Schritte. Speichern.
2. **(Optional) Eine Regel hinzufügen** — In den Einstellungen von Vorfällen, Warnmeldungen oder geplanter Wartung weisen Sie OneUptime an, dieses Runbook zu starten, sobald Titel oder Beschreibung eines Ereignisses auf einen regulären Ausdruck passt.
3. **Auslösen** — Entweder die Regel feuert automatisch bei einem passenden Ereignis, oder ein Bearbeiter klickt manuell **Runbook ausführen** beim Ereignis.
4. **Ausführen** — Eine neue Ausführung wird mit einem Snapshot der Schritte erstellt. Automatisierte Schritte laufen im Runbook-Worker; die Ausführung pausiert bei jedem manuellen Schritt, bis jemand ihn abhakt.
5. **Auditieren** — Die Ausführung bleibt dauerhaft im **Runbooks**-Tab des Ereignisses und in der **Ausführungs**-Liste des Runbooks. Ausgabe, Fehler und Zeitstempel pro Schritt bleiben für das Postmortem erhalten.

## Wann welcher Schritttyp?

Eine schnelle Entscheidungshilfe. Die ausführliche Erklärung steht in [Ein Runbook verfassen](/docs/runbooks/authoring).

| Schritttyp | Greifen Sie zu, wenn… | Beispiel |
| --- | --- | --- |
| **Manuell** | Ein Mensch muss etwas prüfen, eine Einschätzung treffen oder eine Aktion durchführen, die OneUptime nicht beobachten kann. | „Im Load-Balancer-Dashboard bestätigen, dass der Traffic in die Sekundärregion geschwenkt wurde." |
| **JavaScript** | Sie brauchen eine kleine, gekapselte Berechnung — einen Config-Service abfragen, einen Payload transformieren, Logik vor dem nächsten Schritt ausführen. | Aktuelle Replikationsverzögerung berechnen und entscheiden, ob weiter ausgeführt wird. |
| **HTTP-Anfrage** | Sie rufen eine bestehende API auf — Ihr eigenes Admin-Endpunkt, einen Cloud-Anbieter, PagerDuty, Slack. | `POST` an Ihren Failover-Orchestrator. |
| **Bash** | Sie müssen Shell-Befehle auf Ihrer eigenen Infrastruktur ausführen — einen Dienst neu starten, `kubectl` ausführen, ein Deploy-Skript aufrufen. Erfordert einen in Ihrer Umgebung installierten [Runbook-Agent](/docs/runbooks/agents). | Dienst neu starten, `kubectl rollout restart`, ein Recovery-Skript ausführen. |

Sie können alle vier Typen in einem einzigen Runbook mischen — die Stärke von Runbooks liegt in der Verschränkung menschlicher Bestätigung mit Automatisierung.

## Wo Runbooks im Dashboard leben

| Seite | Was Sie dort tun |
| --- | --- |
| **Analyse & Automatisierung → Runbooks** | Runbook-Vorlagen durchsuchen, erstellen und bearbeiten. |
| **Schritte-Tab eines Runbooks** | Schrittliste verfassen und neu ordnen. |
| **Ausführungs-Tab eines Runbooks** | Jeden Lauf dieses Runbooks mit Statusfiltern einsehen. |
| **„Jetzt ausführen"-Schaltfläche eines Runbooks** | Eine Ad-hoc-Ausführung anstoßen, die an kein Ereignis gebunden ist. |
| **Vorfälle / Warnmeldungen / Geplante Wartung → Einstellungen → Runbook-Regeln** | Die automatischen Auslöseregeln pro Entitätstyp anlegen. |
| **Vorfall / Warnmeldung / Wartungsereignis → Runbooks-Tab** | An dieses Ereignis angehängte Ausführungen ansehen und **Runbook ausführen** für einen manuellen Lauf klicken. |

## Häufige Anwendungsfälle

Einige Muster, für die Teams gerne zu Runbooks greifen:

- **Datenbank-Failover** — Aktuellen Zustand mit JavaScript erfassen, on-call DBA per Manuell bestätigen lassen, Orchestrator-API per HTTP aufrufen, „DNS aktualisiert" per Manuell abhaken, Entwarnung per HTTP an Slack posten.
- **Cache-Flush** — Ein einzelner HTTP-Schritt plus ein manueller „Cache-Trefferquote im Dashboard wieder steigend bestätigen".
- **Kundenwirksamer Vorfall** — Manuell: „Statuspage-Update posten". HTTP: „CS-Team in #customer-incidents benachrichtigen". JavaScript: „Liste betroffener Accounts von interner API abrufen".
- **Pre-Flight für geplante Wartung** — JavaScript: aktuelle Metriken snapshotten. Manuell: „Änderungsfenster mit Stakeholdern bestätigen". HTTP: Wartungsmodus am Load Balancer aktivieren.
- **Always-Run-Hygiene** — Eine Regel mit leerem Titelmuster, die bei jedem Vorfall den Systemzustand erfasst — perfekt für Postmortems.

## Ein durchgespieltes Beispiel

Angenommen, jeder Vorfall mit „db-primary" im Titel soll automatisch ein fünfstufiges DB-Failover-Runbook anstoßen.

**1. Runbook erstellen.** Unter **Runbooks → Runbook erstellen** „DB Primary Failover" benennen und folgende Schritte hinzufügen:

| # | Typ | Titel |
| --- | --- | --- |
| 1 | JavaScript | Replikationsverzögerung vor Failover erfassen |
| 2 | Manuell | Replikat-Gesundheit im DBA-Dashboard bestätigen |
| 3 | HTTP | `POST` an Failover-Orchestrator |
| 4 | Manuell | Bestätigen, dass Schreibvorgänge zum neuen Primary gehen |
| 5 | HTTP | Entwarnung in `#db-incidents` auf Slack posten |

**2. Regel hinzufügen.** Unter **Vorfälle → Einstellungen → Runbook-Regeln** anlegen:

```
Titelmuster: ^db-primary
Runbooks:    [DB Primary Failover]
```

**3. Auslösen.** Eine Monitor-Warnung öffnet den Vorfall `INC-4821 · db-primary connection timeout`. Die Regel passt, eine Ausführung wird erstellt, und:

- Schritt 1 (JavaScript) läuft sofort im Worker — sein `return { lagMs: 412 }` wird erfasst.
- Schritt 2 (Manuell) pausiert den Lauf. Die on-call-Person sieht ein „Wartet auf Sie"-Etikett auf der Vorfallseite, prüft das Dashboard und hakt den Schritt ab.
- Schritt 3 (HTTP) läuft, sobald Schritt 2 abgehakt ist — der Response-Body des `POST` wird erfasst.
- Schritt 4 (Manuell) pausiert erneut.
- Schritt 5 (HTTP) läuft und die Ausführung endet.

**4. Auditieren.** Die Ausführung bleibt im **Runbooks**-Tab des Vorfalls. Die Ausgabe jedes Schritts ist einen Klick entfernt. Wenn Sie nächste Woche das Postmortem schreiben, müssen Sie nicht fragen „Was hat das Skript zurückgegeben?" — es steht direkt da.

## Wie Runbooks in den Rest von OneUptime passen

- **Monitore** öffnen Vorfälle und Warnmeldungen; **Runbook-Regeln** verwandeln diese Ereignisse in Runbook-Ausführungen. Zusammen bilden sie einen geschlossenen Kreislauf: erkennen → auslösen → reagieren → aufzeichnen.
- **Workspace-Verbindungen** (Slack, Microsoft Teams) sind ein natürliches Ziel für HTTP-Schritte in Runbooks — Status-Updates posten, Kanäle benachrichtigen.
- **Statuspages** werden häufig als manueller Schritt in einem kundenwirksamen Runbook aktualisiert.
- **On-Call-Pläne** entscheiden, wer geweckt wird; Runbooks entscheiden, was diese Person danach tut.

## Wo Sie weiterlesen sollten

- [Ein Runbook verfassen](/docs/runbooks/authoring) — Runbooks erstellen, die vier Schritttypen und was jeder davon macht.
- [Runbook-Regeln](/docs/runbooks/rules) — Runbooks automatisch an Vorfälle, Warnmeldungen und geplante Wartungsereignisse anhängen.
- [Ein Runbook ausführen](/docs/runbooks/running) — manuelle Trigger, die Ausführungsansicht und wie manuelle Schritte mit automatisierten zusammenspielen.
- [Runbook-Agents](/docs/runbooks/agents) — die Agents installieren, die Bash-Schritte in Ihrer eigenen Infrastruktur ausführen.
- [Konfiguration & Sicherheit](/docs/runbooks/configuration) — Ausgabelimits, Berechtigungen, Härtungs-Hinweise.
