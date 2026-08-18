# Einen Vorfall melden

Einen Vorfall zu melden ist der Moment, in dem OneUptime anfängt mitzuzählen. Ein Datensatz wird erstellt, eine Nummer daraufgestempelt, Bereitschaftsrichtlinien lösen aus – und sofern Sie nichts anderes sagen, erfahren es die Abonnenten Ihrer Statusseite. Alles andere im Vorfalls-Lebenszyklus hängt an diesem ersten Schreibvorgang.

Es gibt vier Wege, auf denen ein Vorfall nach OneUptime gelangt, und sie enden alle an derselben Stelle: einem Datensatz in der Tabelle `Incident` mit einem Schweregrad, einem aktuellen Status und einer Liste betroffener Ressourcen. Der Unterschied liegt nur darin, wer die Felder ausfüllt – Sie um 3 Uhr nachts, eine gespeicherte Vorlage, die Kriterien eines Monitors oder Ihr eigener Code, der die API aufruft.

Diese Seite geht alle vier Wege Feld für Feld durch und behandelt anschließend, was der Server für Sie ausfüllt und was in dem Moment ausgelöst wird, in dem der Vorfall existiert.

## Vier Wege, einen Vorfall zu melden

| Wenn Sie … möchten                                                    | Wählen Sie                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Einen Vorfall von Hand eröffnen und alles selbst ausfüllen            | Den Assistenten **Vorfall melden**                                                  |
| Eine wiederkehrende Art von Vorfall mit vorbelegten Feldern eröffnen  | **Aus Vorlage erstellen**                                                           |
| Automatisch einen eröffnen, wenn die Prüfungen eines Monitors fehlschlagen | Einen Monitor-Kriterienfilter mit **Wenn Filter übereinstimmen, einen Vorfall deklarieren.** |
| Einen aus Ihrem eigenen Code, einem Skript oder einem anderen Tool eröffnen | `POST /api/incident`                                                                |

Alle vier schreiben dasselbe Modell, sodass ein von einer Sonde eröffneter Vorfall genauso aussieht wie einer, den ein Reagierender von Hand eröffnet hat – abgesehen von ein paar Buchhaltungsspalten, die der Server bei automatischen setzt.

## Einen von Hand melden

Öffnen Sie **Vorfälle → Alle Vorfälle** und klicken Sie oben rechts in der Liste **Vorfälle** auf **Vorfall melden**. Das bringt Sie zu einer Karte mit dem Titel **Neuen Vorfall melden**, die das Formular über fünf Schritte verteilt: **Vorfalldetails**, **Betroffene Ressourcen**, **Vorfallsrollen**, **Bereitschaft** und **Mehr**. Die Absende-Schaltfläche am Ende trägt ebenfalls die Aufschrift **Vorfall melden**.

Nur der erste Schritt hat Pflichtfelder. Wenn Sie es eilig haben, füllen Sie **Vorfalldetails** aus und senden ab – Ressourcen anhängen, Rollen zuweisen und Bereitschaftsrichtlinien hinzufügen können Sie danach von den Seiten des Vorfalls aus.

### Schritt 1 – Vorfalldetails

- **Titel** – erforderlich. Die einzeilige Zusammenfassung, die alle in der Liste, in Slack und (wenn der Vorfall sichtbar ist) auf Ihrer Statusseite sehen. Platzhalter: `Incident Title`.
- **Beschreibung** – optional, in Markdown geschrieben. Das ist das Feld, das auf der Statusseite erscheint – schreiben Sie es also für Kunden und nicht für Ihr Team. Sie können es später über **Beschreibung** im Seitenmenü des Vorfalls bearbeiten.
- **Erklärt am** – im Formular erforderlich, standardmäßig auf jetzt gesetzt. Das ist der Zeitstempel, von dem aus jede Dauer des Vorfalls gemessen wird – datieren Sie ihn also zurück, wenn Sie etwas erfassen, das früher begonnen hat.
- **Vorfallsschweregrad** – erforderlich. Einer der für Ihr Projekt konfigurierten Schweregrade; neue Projekte werden mit **Critical Incident**, **Major Incident** und **Minor Incident** angelegt.
- **Vorfallsstatus** – optional. Lassen Sie es unangetastet, und der Vorfall landet im Status mit dem Flag `isCreatedState`, den neue Projekte als **Identified** anlegen. Setzen Sie ihn nur, wenn Sie einen Vorfall erfassen, der diesen Punkt bereits hinter sich hatte.

**Wenn das Status-Dropdown Ihnen Ärger macht.** Trägt in Ihrem Projekt kein Status das Flag `isCreatedState`, schlägt der Erstellungsaufruf fehl und weist Sie an, in den Einstellungen einen Erstellungsstatus für Vorfälle hinzuzufügen. Das passiert normalerweise nur in einem Projekt, dessen Status stark bearbeitet wurden – siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

### Schritt 2 – Betroffene Ressourcen

- **Betroffene Ressourcen** – ein einziges Suchfeld, das Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts und Dienste anhängt. Unter der Haube sind das getrennte Beziehungen am Vorfall (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` und weitere), doch das Formular fasst sie zu einer einzigen Auswahl zusammen.
- **Überwachungsstatus ändern in** – optional. Wählt einen Monitorstatus aus, der auf jeden an diesen Vorfall angehängten Monitor angewendet wird, sodass das Melden des Vorfalls und das Markieren der Monitore als beeinträchtigt eine Aktion statt zweier ist.

**Hängen Sie Monitore auch dann an, wenn es überflüssig wirkt.** Die Verbindung zwischen einem Vorfall und einer Statusseite verläuft über die Monitore des Vorfalls: Eine Statusseite zeigt einen Vorfall, wenn eine ihrer Ressourcen einer der Monitore des Vorfalls ist. Eine Statuswechsel-Benachrichtigung an Abonnenten wird schlicht übersprungen, wenn am Vorfall keine Monitore hängen. Siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).

### Schritt 3 – Vorfallsrollen

- **Vorfallrollen zuweisen** – weisen Sie Teammitglieder den in Ihrem Projekt definierten Rollen zu. Manche Rollen akzeptieren mehr als einen Benutzer.

Die Rollen selbst werden unter **Vorfälle → Einstellungen → Vorfallsrollen** konfiguriert, wo Sie die Rollen definieren, die während der Reaktion vergeben werden können – Incident Commander, Responder und was Ihr Prozess sonst braucht. Überspringen Sie diesen Schritt, wird beim ersten Statuswechsel automatisch ein Incident Commander zugewiesen, sofern die Rolle noch niemand innehat.

### Schritt 4 – Bereitschaft

- **Bereitschaftsrichtlinie** – eine Mehrfachauswahl der Bereitschaftsdienst-Richtlinien, die beim Erstellen dieses Vorfalls ausgeführt werden sollen. Das entspricht `onCallDutyPolicies` am Vorfall.

Das ist die einzige Stelle, an der eine Bereitschaftsrichtlinie direkt an einen Vorfall gehängt wird. Schweregrade tragen keine Bereitschaftsrichtlinie – der Schweregrad ist eine Bezeichnung und beeinflusst das Alarmieren nur als *Übereinstimmungskriterium* innerhalb einer Bereitschaftsregel. Unter **Vorfälle → Regeln → Bereitschaftsregeln** konfigurierte Regeln legen ihre Richtlinien zusätzlich zu dem, was Sie hier auswählen, obendrauf; die letztlich ausgeführte Menge ist die deduplizierte Vereinigung von beidem.

### Schritt 5 – Mehr

- **Beschriftungen** – optional und eine erweiterte Funktion: Teammitglieder mit Zugriff auf diese Beschriftungen sind diejenigen, die auf den Vorfall zugreifen können.
- **Statusseiten-Abonnenten benachrichtigen** – Kontrollkästchen, standardmäßig aktiviert. Steuert, ob Abonnenten per E-Mail über die Erstellung des Vorfalls informiert werden (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Schalten Sie es für internes Rauschen ab, das Sie dennoch festhalten wollen.
- **Privater Vorfall** – Kontrollkästchen, standardmäßig deaktiviert (`isPrivate`). Ein privater Vorfall ist nur für seine Eigentümer-Benutzer, die Mitglieder seiner Eigentümer-Teams, Projektadministratoren und Projekteigentümer sichtbar – und er ist unabhängig von jeder anderen Einstellung von jeder Statusseite ausgeblendet. Die Vorfallsliste markiert diese mit einer roten Plakette **Private**.

Das Flag **Should be visible on status page?** (`isVisibleOnStatusPage`) steht nicht im Assistenten; es ist standardmäßig aktiviert. Ändern Sie es danach über **Einstellungen** im Seitenmenü des Vorfalls, wo es als **Auf Statusseite sichtbar** bezeichnet wird.

## Aus einer Vorlage melden

Wenn Sie immer wieder dieselbe Art von Vorfall melden – dasselbe Titelmuster, denselben Schweregrad, dieselbe Bereitschaftsrichtlinie –, speichern Sie das einmal als Vorlage.

Klicken Sie auf **Aus Vorlage erstellen** (die Umriss-Schaltfläche neben **Vorfall melden**), und es öffnet sich ein Dialog **Vorfall aus Vorlage erstellen** mit einem Dropdown **Vorfallvorlage auswählen**. Wählen Sie eine Vorlage, und das Erstellungsformular öffnet sich vorbelegt; Sie können vor dem Absenden weiterhin alles ändern. Hat Ihr Projekt noch keine Vorlagen, erhalten Sie stattdessen einen Dialog **No Incident Templates** mit einer Schaltfläche **Create Template**, die Sie zu **Vorfälle → Einstellungen → Vorfall-Vorlagen** führt.

Vorlagen werden mit ihrem eigenen sechsstufigen Assistenten erstellt – **Vorlageninformationen**, **Vorfalldetails**, **Betroffene Ressourcen**, **Bereitschaft**, **Eigentümer**, **Beschriftungen** – mit diesen Feldern:

| Feld                              | Zweck                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| **Vorlagenname**                  | Wie die Vorlage in der Auswahl identifiziert wird.                 |
| **Vorlagenbeschreibung**          | Eine Notiz an Ihr künftiges Ich, wann Sie danach greifen sollten.  |
| **Titel**                         | Der Titel, der in den Vorfall vorbelegt wird.                      |
| **Beschreibung**                  | Markdown-Beschreibung, die in den Vorfall vorbelegt wird.          |
| **Vorfallsschweregrad**           | Schweregrad, der in den Vorfall vorbelegt wird.                    |
| **Anfänglicher Vorfallstatus**    | Der Status, in dem Vorfälle aus dieser Vorlage starten.            |
| **Betroffene Ressourcen**         | Anzuhängende Monitore, Hosts, Cluster und Dienste.                 |
| **Überwachungsstatus ändern in**  | Monitorstatus, der auf die angehängten Monitore angewendet wird.   |
| **Bereitschaftsrichtlinie**       | Richtlinien, die beim Erstellen des Vorfalls ausgeführt werden.    |
| **Eigentümer – Teams**            | Teams, denen aus dieser Vorlage erstellte Vorfälle gehören.        |
| **Eigentümer – Benutzer**         | Benutzer, denen aus dieser Vorlage erstellte Vorfälle gehören.     |
| **Beschriftungen**                | Beschriftungen, die auf den Vorfall angewendet werden.             |

Ein paar kurze Regeln:

- Vorlagen sind aus der Vorlagenliste heraus nicht bearbeitbar – Sie erstellen eine und öffnen sie dann, um sie zu ändern.
- Eine Vorlage füllt nur ein Feld, das Sie leer gelassen haben. Auf der Erstellungsseite wird die Vorlage als überschreibbare Vorbelegung angewendet; über die API füllt der Server ein Feld nur dann aus der Vorlage, wenn die Anfrage dieses Feld auf `undefined` belassen hat. Was der Aufrufer geliefert hat, gewinnt immer.

## Automatisch aus Monitor-Kriterien melden

Die meisten Vorfälle sollten keinen Menschen zum Eintippen brauchen. Aktivieren Sie im Kriterien-Editor eines Monitors den Schalter **Wenn Filter übereinstimmen, einen Vorfall deklarieren.**, und es erscheint ein Abschnitt **Vorfall erstellen** mit einer Schaltfläche **Vorfall hinzufügen** – ein einzelner Kriterienfilter kann mehr als einen Vorfall melden.

Jeder Eintrag hat:

- **Vorfalltitel** – unterstützt Vorlagen; der Platzhalter schlägt so etwas wie `{{monitorName}} is down` vor.
- **Schweregrad** – erforderlich.
- **Vorfallbeschreibung** – ebenfalls mit Vorlagen.
- **Bereitschaft → Bereitschaftsrichtlinien** – Richtlinien, die beim Erstellen dieses Vorfalls ausgeführt werden.
- **Vorfallsrollen** – Teammitglieder vorab Rollen zuweisen.
- **Eigentümerschaft & Beschriftungen → Eigentümer-Teams**, **Eigentümer-Benutzer**, **Beschriftungen**.
- **Erweiterte Optionen → Vorfall automatisch beheben** (behebt den Vorfall automatisch, wenn die Kriterien nicht mehr zutreffen), **Vorfall auf der Statusseite anzeigen**, **Privater Vorfall** und **Behebungs-Notizen**.

Die vollständige Liste der `{{variable}}`-Platzhalter, die Sie in Titel, Beschreibung und Behebungsnotizen verwenden können, finden Sie unter [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).

Auf diesem Weg erstellte Vorfälle werden vom Server gekennzeichnet: `isCreatedAutomatically` wird gesetzt, `createdCriteriaId` hält fest, welcher Kriterienfilter ausgelöst hat, und `createdByProbe` hält fest, welche Sonde es gesehen hat. In allem Übrigen verhalten sie sich genau wie ein von Hand gemeldeter Vorfall.

## Über die API melden

Das Vorfallsmodell stellt einen Standard-CRUD-Endpunkt bereit, `POST /api/incident` erstellt also einen Vorfall. Authentifizieren Sie sich mit einem API-Schlüssel, der unter **Projekteinstellungen → API-Schlüssel** erzeugt wird und im Header `apikey` gesendet wird – der Schlüssel identifiziert das Projekt, Sie müssen also keine Projekt-ID separat übergeben.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Nützliche Felder im Anfragetext:

- `title` – das einzige Feld, das Sie wirklich angeben müssen.
- `declaredAt` – hier optional, obwohl das Formular es verlangt. Lassen Sie es weg, und der Server verwendet die aktuelle Zeit.
- `incidentSeverityId` und `currentIncidentStateId` – der Server prüft, dass beide zu demselben Projekt wie der API-Schlüssel gehören, und weist die Anfrage andernfalls zurück. Dieselbe Prüfung gilt für den Monitorstatus hinter **Überwachungsstatus ändern in**.
- `createdIncidentTemplateId` – wendet eine gespeicherte Vorlage an. Jedes Feld, das Sie weglassen, wird aus der Vorlage gefüllt; jedes Feld, das Sie senden, bleibt unverändert.

Verwandte Endpunkte sind `/api/incident-state`, `/api/incident-severity` und `/api/incident-state-timeline`. Die generierte [API-Referenz](/reference) enthält die genauen Anfrage- und Antwortformen für jeden davon, einschließlich der Frage, wie Beziehungsfelder wie Monitore ausgedrückt werden.

## Vorfallnummern und Präfixe

Jeder Vorfall erhält eine fortlaufende Nummer aus einem Zähler je Projekt, die der Server zum Erstellungszeitpunkt vergibt. Zwei Spalten halten sie: `incidentNumber` (die reine Ganzzahl) und `incidentNumberWithPrefix` (das, was Sie tatsächlich sehen). Ohne konfiguriertes Präfix ist der Anzeigewert `#42`.

Um das zu ändern, gehen Sie zu **Vorfälle → Einstellungen → Weitere Einstellungen**. Die Karte **Nummernpräfix** hat ein Feld **Vorfallnummern-Präfix** (bis zu 20 Zeichen, Platzhalter `INC-`) – setzen Sie es, und derselbe Vorfall erscheint als `INC-42`. Lassen Sie es leer, um das voreingestellte `#` beizubehalten. Die Karte trägt außerdem **Nummernpräfix der Vorfall-Episode** für die Episodennummerierung.

Die Nummer erscheint als erste Spalte der Vorfallsliste, verlinkt auf den Vorfall und taucht als **Vorfallnummer** auf der **Übersicht** des Vorfalls auf.

## Was in dem Moment passiert, in dem ein Vorfall gemeldet wird

Der Erstellungsaufruf schreibt mehr als nur einen Datensatz. Der Reihe nach:

1. **Der Server füllt die Lücken.** `declaredAt` wird standardmäßig auf jetzt gesetzt, der aktuelle Status standardmäßig auf den `isCreatedState`-Status des Projekts, und Vorfallnummer sowie präfigierte Nummer werden aus dem Projektzähler vergeben.
2. **Eine Vorlage wird angewendet**, falls `createdIncidentTemplateId` übergeben wurde – und füllt nur Felder, die der Aufrufer undefiniert gelassen hat.
3. **Datenschutzregeln laufen** und markieren den Vorfall als privat, wenn eine passende Regel das sagt. Das ist das erste Regelwerk, das läuft, sodass alles danach die richtige Datenschutzeinstellung sieht.
4. **Eigentümerregeln laufen** und fügen die Eigentümer-Benutzer und -Teams hinzu, die passende Regeln benennen.
5. **Beschriftungsregeln laufen** und fügen Beschriftungen hinzu, die auf den Vorfall passen.
6. **Bereitschaftsregeln laufen.** Jede aktivierte Regel unter **Vorfälle → Regeln → Bereitschaftsregeln**, deren Kriterien passen, fügt ihre Richtlinien zum Vorfall hinzu. Es gibt keine Prioritätsreihenfolge und keinen Kurzschluss – alle passenden Regeln lösen aus, und die Richtlinien werden dedupliziert.
7. **Runbook-Regeln laufen** und hängen passende Runbooks an und starten sie. Siehe [Runbooks](/docs/runbooks/index).
8. **Bereitschaftsrichtlinien werden ausgeführt.** Jede Richtlinie am Vorfall – im Assistenten gewählt, aus einer Vorlage geerbt oder von einer Regel hinzugefügt – wird parallel mit dem Ereignistyp `IncidentCreated` ausgeführt. Schlägt eine Richtlinie fehl, stoppt das die anderen nicht.
9. **Abonnenten werden eingereiht**, sofern **Statusseiten-Abonnenten benachrichtigen** aktiviert blieb und der Vorfall auf der Statusseite sichtbar ist. Die Zustellung übernimmt ein Hintergrundjob, nicht Ihre Anfrage selbst.
10. **Arbeitsabläufe lösen aus.** Der Auslöser **On Create Incident** startet jeden darauf aufgebauten Workflow. Siehe [Workflows – Übersicht](/docs/workflows/index).

Von da an ist der Vorfall aktiv: Er zählt zum Badge **Aktive Vorfälle** im Seitenmenü Vorfälle (jeder Status ohne das Flag `isResolvedState` zählt als aktiv), er erscheint auf den Statusseiten, die einen seiner Monitore führen, und seine **Zustands-Zeitachse** beginnt aufzuzeichnen.

## Weiterführende Themen

- [Vorfälle – Übersicht](/docs/incidents/index) – wie das Vorfallsmodell zusammenpasst.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was die Status-Flags tun und wie Sie eigene hinzufügen.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche Notizen, private Notizen, Eigentümer und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Rollen, Regeln und Workflow-Auslöser.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer von dem Vorfall erfährt, den Sie gerade gemeldet haben.
- [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating) – die Variablen, die automatisch gemeldeten Vorfällen zur Verfügung stehen.
