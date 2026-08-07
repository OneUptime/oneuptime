# Benutzer, Teams & Berechtigungen

Alles in OneUptime liegt innerhalb eines **Projekts**. Wer darin was tun darf, ergibt sich aus drei Dingen: den **Benutzern** im Projekt, den **Teams**, denen diese Benutzer angehören, und den **Berechtigungen**, die diesen Teams erteilt wurden.

Die eine Regel, die fast alles erklärt: **Benutzer besitzen niemals direkt Berechtigungen.** Der Zugriff eines Benutzers ist die Vereinigung der Berechtigungen aller Teams, denen er in diesem Projekt angehört. Wenn Sie ändern möchten, was jemand tun darf, ändern Sie seine Teamzugehörigkeit oder die Berechtigungen dieses Teams.

**Eigentümer** sind etwas anderes. Ein Eigentümer ist derjenige, der für eine bestimmte Ressource zuständig ist — einen Monitor, einen Vorfall, ein Dashboard. Eigentümer werden über ihre Ressourcen benachrichtigt, und Berechtigungen lassen sich optional auf „nur die Dinge, die mir gehören" eingrenzen.

## Das Modell auf einen Blick

```text
Projekt
  └── Team                       ← hier hängen die Berechtigungen
       ├── Erlaubt-Berechtigungen ← jeweils mit Geltungsbereich: Alle / Eigene / Labels
       ├── Sperr-Berechtigungen   ← haben immer Vorrang vor Erlaubt
       └── Teammitglieder         ← Benutzer, die die Einladung angenommen haben
```

| Begriff | Bedeutung |
| --- | --- |
| Benutzer | Ein einzelnes OneUptime-Konto. Eine Anmeldung, beliebig viele Projekte. |
| Projekt | Die Mandantengrenze. Monitore, Vorfälle, Teams und Daten gehören zu genau einem Projekt. |
| Team | Eine benannte Gruppe innerhalb eines Projekts, die Berechtigungen trägt. |
| Teammitglied | Ein Benutzer, der in ein Team eingeladen wurde und angenommen hat. |
| Berechtigung | Eine einzelne Fähigkeit, z. B. `CreateProjectMonitor`, oder eine Rolle, die viele bündelt, z. B. `MonitorAdmin`. |
| Geltungsbereich | Wie weit eine Erlaubt-Berechtigung reicht: alle Ressourcen, nur eigene oder nur gelabelte. |
| Eigentümer | Ein Benutzer oder Team, der bzw. das für eine konkrete Ressource verantwortlich ist. |
| Label | Eine Markierung an Ressourcen, mit der Berechtigungen eingeschränkt und Ressourcen organisiert werden. |

## Benutzer

Ein Benutzerkonto gilt für die gesamte OneUptime-Instanz — dieselbe Anmeldung funktioniert in jedem Projekt, in das der Benutzer eingeladen wurde.

Ein Benutzer ist „in" einem Projekt, sobald er Mitglied **mindestens eines Teams** darin ist. Es gibt keinen separaten Schritt „Benutzer zum Projekt hinzufügen": Wer in ein Projekt eingeladen wird, wird in ein Team eingeladen.

- Einladungen erzeugen ein ausstehendes Teammitglied. Der Benutzer zählt erst als Projektmitglied — und erhält erst dann irgendeine Berechtigung —, **nachdem er die Einladung angenommen hat.**
- Wird ein Benutzer aus allen Teams eines Projekts entfernt, verliert er den Zugriff darauf.
- Wenn Ihr Projekt SSO erzwingt und ein Benutzer sich noch nicht über den Identity Provider authentifiziert hat, gilt er als nicht autorisierter SSO-Benutzer und sieht nichts, bis er es tut. Siehe [SSO](/docs/identity/sso).
- Mit eingerichtetem SCIM kann Ihr Identity Provider Benutzer und deren Teamzugehörigkeiten automatisch anlegen, aktualisieren und entfernen. Siehe [SCIM](/docs/identity/scim).

Wo Sie es finden: **Einstellungen → Benutzer** listet alle Personen im Projekt samt Einladungsstatus auf.

## Teams

Über Teams gelangen Berechtigungen zu Personen. Jedes neue Projekt startet mit dreien:

| Team | Berechtigung | Bearbeitbar |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nein. Hat immer mindestens ein Mitglied. |
| Admin | `ProjectAdmin` | Nein |
| Members | `ProjectMember` | Ja — dieses Team ist ein Ausgangspunkt, ändern Sie es nach Bedarf |

Die Teams **Owners** und **Admin** sind bewusst gesperrt: Ihre Berechtigungen lassen sich nicht bearbeiten, und die Teams können weder gelöscht noch umbenannt werden. Genau das verhindert, dass sich ein Projekt versehentlich selbst aussperrt. Das Owners-Team muss immer mindestens ein Mitglied behalten.

`ProjectOwner` ist die höchste Zugriffsstufe: Abrechnung, Löschen des Projekts und alles, was ein Admin kann. `ProjectAdmin` umfasst alles außer Abrechnung und Löschen des Projekts.

Legen Sie beliebig viele weitere Teams an — „Frontend-Bereitschaft", „Support", „Nur-Lese-Prüfer" — und geben Sie jedem genau die Berechtigungen, die es braucht.

Wo Sie es finden: **Einstellungen → Teams**. Öffnen Sie ein Team, um zu **Members**, **Permissions** und **Block Permissions** zu gelangen.

## Berechtigungen

Eine Berechtigung ist eine einzelne Fähigkeit. Es gibt zwei Wege, sie zu vergeben, und beide liegen auf dem Tab **Permissions** des Teams.

### Rollen

Eine Rolle bündelt einen ganzen Produktbereich auf einer von drei Stufen:

- **Admin** — volle Kontrolle über den Bereich einschließlich seiner Konfiguration (Schweregrade, Zustände, Vorlagen).
- **Member** — die tägliche Arbeit: Ressourcen anlegen, bearbeiten und löschen, aber den Bereich nicht umkonfigurieren.
- **Viewer** — nur lesend.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` und so weiter. Rollen sind fast immer die richtige Wahl — sie bleiben korrekt, wenn OneUptime Funktionen ergänzt, weil eine neue monitorbezogene Tabelle den bestehenden Monitor-Rollen zugeordnet wird, statt eine neue Zuweisung von Ihnen zu verlangen.

Alle {{PERMISSION_ROLE_COUNT}} Rollen sind in der [Berechtigungsreferenz](/docs/permissions/reference) aufgeführt.

### Granulare Berechtigungen

Jede einzelne Fähigkeit ist auch für sich vergebbar — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` und {{PERMISSION_TOTAL_COUNT}} weitere. Nutzen Sie diese, wenn eine Rolle zu breit ist und Sie genau eine Sache vergeben möchten.

Es sind zugleich die Schlüssel, die Sie beim Anlegen von API-Schlüsseln verwenden, und die die API und der Terraform-Provider erwarten.

Die vollständige Liste steht in der [Berechtigungsreferenz](/docs/permissions/reference).

### Erlauben und sperren

Jedes Team hat zwei Listen:

- **Permissions** (erlauben) — was dieses Team tun darf.
- **Block Permissions** — was dieses Team niemals tun darf, unabhängig von jedem Erlaubt-Eintrag.

**Sperren gewinnt immer.** Ein Sperr-Eintrag ohne Labels entzieht dem Team die Fähigkeit vollständig. Ein Sperr-Eintrag mit Labels entzieht sie nur für Ressourcen mit diesen Labels — nützlich für „dieses Team darf Monitore bearbeiten, außer den mit Production gelabelten".

Eine Berechtigung kann nicht gleichzeitig in beiden Listen Einschränkungs-Labels tragen; OneUptime lehnt den zweiten Eintrag mit einer Erklärung ab.

Da der Zugriff eines Benutzers die Vereinigung über alle seine Teams ist, hebt eine Sperre in einem Team **keine** Erlaubnis in einem anderen Team auf. Sperren beschränken das Team, in dem sie gesetzt sind. Wenn jemand mehr Zugriff hat als erwartet, prüfen Sie alle Teams, denen er angehört.

## Geltungsbereich: wie weit eine Erlaubt-Berechtigung reicht

Jede Erlaubt-Berechtigung wird mit einem Geltungsbereich vergeben, den Sie beim Hinzufügen wählen:

| Geltungsbereich | Bedeutung |
| --- | --- |
| Alle Ressourcen im Projekt | Die Voreinstellung. Die Berechtigung gilt für jede passende Ressource. |
| Im Besitz dieses Teams oder seiner Mitglieder | Die Berechtigung gilt nur für Ressourcen, bei denen dieses Team oder der handelnde Benutzer als Eigentümer eingetragen ist. |
| Nach Labels einschränken (fortgeschritten) | Die Berechtigung gilt nur für Ressourcen, die mindestens eines der gewählten Labels tragen. |

**Eigene** ist der einfachste Weg zu einem Modell nach dem Motto „Ihr kümmert euch um eure eigenen Dienste": Geben Sie einem Team `MonitorAdmin` mit Geltungsbereich „Eigene" und machen Sie dieses Team zum Eigentümer der Monitore, für die es zuständig ist. Eingegrenzt werden nur Ressourcen, die überhaupt Eigentümer haben können — Monitore, Vorfälle, Dashboards, Services und Ähnliches. Projektkonfiguration (Vorfallzustände, Labels, die Teams selbst) hat keine Eigentümer, dort verhält sich eine „Eigene"-Rolle also ganz normal.

**Labels** ist die manuellere Variante derselben Idee: Ressourcen markieren und Berechtigungen auf diese Markierungen beschränken.

Manche Rollen sind per Definition projektweit und bieten überhaupt keinen Geltungsbereich, weil eine Eingrenzung sinnlos wäre — „Billing Admin, aber nur für die Abrechnung, die mir gehört" beschreibt nichts:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Eigentümer

Ein Eigentümer ist ein Benutzer oder ein Team, das einer konkreten Ressource zugeordnet ist. Die meisten Ressourcen, die etwas Betriebliches darstellen — Monitore, Vorfälle, Alarme, geplante Wartungen, Bereitschaftsrichtlinien, Dashboards, Services, Statusseiten, Workflows, Runbooks und SLOs — haben einen Tab **Owners**.

Eigentümer erfüllen zwei Aufgaben:

1. **Benachrichtigung.** Eigentümer sind diejenigen, die OneUptime informiert, wenn mit der Ressource etwas passiert — ein Monitor fällt aus, ein Vorfall wird erstellt, ein SLO beginnt sein Fehlerbudget aufzubrauchen.
2. **Zugriff, wenn Sie es so einrichten.** Der Geltungsbereich „Eigene" wird gegen die Eigentümerschaft aufgelöst. Ein Benutzer passt, wenn er persönlich Eigentümer ist oder wenn eines seiner Teams Eigentümer ist.

Eigentümerschaft allein gewährt nichts. Eigentümer eines Monitors zu sein erlaubt dessen Bearbeitung nur dann, wenn eines Ihrer Teams zusätzlich eine Monitor-Berechtigung hält. Eigentümerschaft grenzt Zugriff ein; sie erweitert ihn nie.

## Labels

Labels sind projektweite Markierungen, die Sie an Ressourcen anbringen. Sie dienen zwei Zwecken: Filtern und Gruppieren im Dashboard sowie dem Einschränken von Berechtigungen wie oben beschrieben.

Eine Label-Einschränkung ist erfüllt, wenn die Ressource **mindestens eines** der Labels der Berechtigung trägt. Eine Ressource ganz ohne Labels erfüllt keine label-eingeschränkte Berechtigung.

Wo Sie es finden: **Einstellungen → Labels**.

## API-Schlüssel

API-Schlüssel erhalten Berechtigungen direkt am Schlüssel — sie gehören keinem Team an und sind von Teamzugehörigkeiten unberührt.

- Weisen Sie dieselben granularen Berechtigungen und Rollen zu, die Sie einem Team geben würden.
- Schlüssel unterstützen **Sperr-Berechtigungen** und **Label-Einschränkungen** genauso wie Teams.
- Schlüssel unterstützen **keinen** Geltungsbereich „Eigene". Eigentümerschaft wird gegen einen Benutzer aufgelöst, und ein Schlüssel ist kein Benutzer — geben Sie Schlüsseln den benötigten Zugriff daher ausdrücklich.

Geben Sie jeder Integration einen eigenen Schlüssel mit dem engstmöglichen Berechtigungssatz, damit Sie einen widerrufen können, ohne die anderen zu stören.

Wo Sie es finden: **Einstellungen → API-Schlüssel**. Siehe auch die [API-Referenz](/docs/api-reference/api-reference).

## Wie OneUptime entscheidet, ob eine Anfrage erlaubt ist

Für einen angemeldeten Benutzer, der Reihe nach:

1. Die Teams ermitteln, denen der Benutzer in diesem Projekt angehört — nur angenommene Einladungen zählen.
2. Alle Berechtigungszeilen dieser Teams sammeln — erlauben und sperren, jeweils mit Labels und Geltungsbereich.
3. Zuerst die Sperrliste prüfen. Eine passende Sperre ohne Labels weist die Anfrage sofort ab.
4. Die Erlaubt-Liste prüfen. Die Anfrage braucht mindestens eine Berechtigung, die die Zieltabelle für diese Operation akzeptiert.
5. Geltungsbereich anwenden. „Eigene" grenzt die Abfrage auf eigene Ressourcen ein, „Labels" auf passende Labels. Gibt es für dieselbe Operation eine breitere Zuweisung, gewinnt die breitere.
6. Label-Sperren anwenden. Eine Sperre mit Labels weist die Anfrage ab, wenn die Zielressource eines davon trägt.

Jeder angemeldete Benutzer hält zusätzlich einen kleinen Satz automatischer Berechtigungen, die etwa das Lesen des eigenen Profils und der eigenen Benachrichtigungsregeln abdecken. Das sind keine Admin-Berechtigungen und sie geben keinen Zugriff auf fremde Daten.

Aufgelöste Berechtigungen werden pro Benutzer und Projekt zwischengespeichert und aktualisiert, wenn sich Teamzugehörigkeit oder Teamberechtigungen ändern. Sieht ein Benutzer eine Änderung nicht sofort, lassen Sie ihn neu laden.

## Rezepte

**Ein Team, das nur zuschaut.** Team anlegen und die Rolle `Viewer` hinzufügen — oder die bereichsbezogenen `*Viewer`-Rollen für genau die Bereiche, die es sehen soll.

**Bereitschaftsingenieure, die ihre eigenen Dienste betreuen.** Geben Sie dem Team `MonitorAdmin`, `IncidentMember` und `OnCallMember` mit Geltungsbereich **Eigene** und tragen Sie das Team als Eigentümer der Monitore ein, die es betreibt.

**Externe von der Produktion fernhalten.** Geben Sie dem Team die nötigen Rollen im Geltungsbereich **Alle** und fügen Sie dann eine **Sperr-Berechtigung** für die sensiblen Fähigkeiten hinzu, eingeschränkt auf das Label `Production`.

**Eine CI-Pipeline, die nur Deployments meldet.** Legen Sie einen API-Schlüssel mit genau den granularen Berechtigungen an, die sie braucht — keine Rollen.

**Jemand, der die Abrechnung nicht sehen soll.** Nehmen Sie ihn nicht ins Owners-Team auf. `ProjectAdmin` schließt die Abrechnung bereits aus.

## Weiter

- [Berechtigungsreferenz](/docs/permissions/reference) — jede Rolle und jede granulare Berechtigung, erzeugt aus dem OneUptime-Quellcode.
- [SSO](/docs/identity/sso) und [SCIM](/docs/identity/scim) — Authentifizierung und automatisches Bereitstellen von Benutzern.
- [API-Referenz](/docs/api-reference/api-reference) — Berechtigungen über die API nutzen.
