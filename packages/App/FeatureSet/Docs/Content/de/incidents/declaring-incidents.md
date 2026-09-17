# Einen Vorfall melden

Einen Vorfall zu melden ist der Moment, in dem OneUptime anfängt mitzuzählen. Ein Datensatz entsteht, eine Nummer wird daraufgestempelt, Bereitschaftsrichtlinien laufen los, und – sofern Sie nichts anderes sagen – erfahren Ihre Statusseiten-Abonnenten davon. Alles Weitere im Lebenszyklus des Vorfalls hängt an diesem ersten Schreibvorgang.

Es gibt vier Wege, wie ein Vorfall nach OneUptime kommt, und alle enden am selben Ort: einer Zeile in der Tabelle `Incident`, mit einem Schweregrad, einem aktuellen Status und einer Liste betroffener Ressourcen. Der Unterschied liegt allein darin, wer die Felder füllt – Sie um 3 Uhr nachts, eine gespeicherte Vorlage, die Kriterien eines Monitors oder Ihr eigener Code, der die API aufruft.

Diese Seite geht alle vier Wege durch, Feld für Feld, und erklärt anschließend, was der Server für Sie ergänzt und was in dem Moment losläuft, in dem der Vorfall existiert.

## Vier Wege, wie ein Vorfall gemeldet wird

| Wenn Sie …                                                              | Wählen Sie                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| einen Vorfall von Hand eröffnen und alles selbst ausfüllen wollen        | den Assistenten **Vorfall melden**                                              |
| eine wiederkehrende Art von Vorfall mit vorbelegten Feldern eröffnen wollen | **Aus Vorlage erstellen**                                                       |
| automatisch einen eröffnen wollen, wenn die Checks eines Monitors fehlschlagen | einen Monitor-Kriterienfilter mit **Wenn Filter übereinstimmen, einen Vorfall deklarieren.** |
| einen aus Ihrem eigenen Code, einem Skript oder einem anderen Tool eröffnen wollen | `POST /api/incident`                                                            |

Alle vier schreiben dasselbe Modell. Ein von einer Sonde eröffneter Vorfall sieht also genau aus wie einer, den ein Responder von Hand eröffnet hat – abgesehen von ein paar Buchhaltungsspalten, die der Server bei den automatischen setzt.

## Einen von Hand melden

Öffnen Sie **Vorfälle → Alle Vorfälle** und klicken Sie oben rechts in der Liste **Vorfälle** auf **Vorfall melden**. Das bringt Sie zu einer Karte mit dem Titel **Neuen Vorfall melden**, die das Formular auf fünf Schritte verteilt: **Vorfalldetails**, **Betroffene Ressourcen**, **Vorfallsrollen**, **Bereitschaft** und **Mehr**. Die Absende-Schaltfläche am Ende heißt ebenfalls **Vorfall melden**.

Nur der erste Schritt hat Pflichtfelder. Wenn es eilt, füllen Sie **Vorfalldetails** aus und senden ab – Ressourcen anhängen, Rollen vergeben und Bereitschaftsrichtlinien ergänzen können Sie anschließend auf den Seiten des Vorfalls selbst.

### Schritt 1 – Vorfalldetails

- **Titel** – Pflichtfeld. Die einzeilige Zusammenfassung, die alle in der Liste, in Slack und (wenn der Vorfall sichtbar ist) auf Ihrer Statusseite sehen. Platzhalter: `Incident Title`.
- **Beschreibung** – optional, in Markdown geschrieben. Dieses Feld erscheint auf der Statusseite, schreiben Sie es also für Kunden und nicht für Ihr Team. Später bearbeiten Sie es über **Beschreibung** im Seitenmenü des Vorfalls.
- **Erklärt am** – im Formular Pflicht, standardmäßig auf jetzt gesetzt. Von diesem Zeitstempel aus wird jede Dauer am Vorfall gemessen – datieren Sie ihn also zurück, wenn Sie etwas erfassen, das früher begonnen hat.
- **Vorfallsschweregrad** – Pflichtfeld. Einer der für Ihr Projekt konfigurierten Schweregrade; neue Projekte starten mit **Critical Incident**, **Major Incident** und **Minor Incident**.
- **Vorfallsstatus** – optional. Lassen Sie ihn unangetastet, landet der Vorfall in dem Status mit dem Flag `isCreatedState`, den neue Projekte als **Identified** anlegen. Setzen Sie ihn nur, wenn Sie einen Vorfall erfassen, der diesen Punkt schon hinter sich hatte.

**Falls das Status-Dropdown Ärger macht.** Trägt in Ihrem Projekt kein Status das Flag `isCreatedState`, schlägt der Erstellungsaufruf fehl und weist Sie an, in den Einstellungen einen Erstellungsstatus anzulegen. Das passiert normalerweise nur in Projekten, deren Status stark bearbeitet wurden – siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

### Schritt 2 – Betroffene Ressourcen

- **Betroffene Ressourcen** – ein einziges Suchfeld, das Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts und Dienste anhängt. Unter der Haube sind das getrennte Beziehungen am Vorfall (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` und weitere), aber das Formular fasst sie zu einem Auswahlfeld zusammen.
- **Überwachungsstatus ändern in** – optional. Wählt einen Monitor-Status, der auf jeden an diesem Vorfall hängenden Monitor angewendet wird, sodass den Vorfall zu melden und die Monitore als beeinträchtigt zu markieren ein Handgriff ist statt zwei.

**Hängen Sie Monitore an, auch wenn es überflüssig wirkt.** Die Verbindung zwischen einem Vorfall und einer Statusseite läuft über die Monitore des Vorfalls: Eine Statusseite zeigt einen Vorfall, wenn eine ihrer Ressourcen einer der Monitore des Vorfalls ist. Eine Statuswechsel-Benachrichtigung an Abonnenten unterbleibt vollständig, wenn am Vorfall keine Monitore hängen. Siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).

### Schritt 3 – Vorfallsrollen

- **Vorfallrollen zuweisen** – weisen Sie Teammitglieder den Rollen zu, die Ihr Projekt definiert. Manche Rollen nehmen mehr als einen Benutzer auf.

Die Rollen selbst konfigurieren Sie unter **Vorfälle → Einstellungen → Vorfallsrollen**, wo Sie festlegen, welche Rollen während der Reaktion vergeben werden können – Incident Commander, Responder und was Ihr Prozess sonst braucht. Überspringen Sie diesen Schritt, wird beim ersten Statuswechsel automatisch ein Incident Commander bestimmt, sofern die Rolle noch niemand innehat.

### Schritt 4 – Bereitschaft

- **Bereitschaftsrichtlinie** – eine Mehrfachauswahl der Bereitschaftsrichtlinien, die beim Anlegen dieses Vorfalls ausgeführt werden. Das entspricht `onCallDutyPolicies` am Vorfall.

Dies ist die einzige Stelle, an der eine Bereitschaftsrichtlinie direkt an einen Vorfall gehängt wird. Schweregrade tragen keine Bereitschaftsrichtlinie – ein Schweregrad ist eine Beschriftung und beeinflusst das Alarmieren nur als *Übereinstimmungskriterium* innerhalb einer Bereitschaftsregel. Regeln unter **Vorfälle → Regeln → Bereitschaftsregeln** legen ihre Richtlinien obendrauf; ausgeführt wird am Ende die dublettenfreie Vereinigung aus beidem.

### Schritt 5 – Mehr

- **Beschriftungen** – optional und eine fortgeschrittene Funktion: Teammitglieder mit Zugriff auf diese Beschriftungen sind diejenigen, die auf den Vorfall zugreifen können.
- **Statusseiten-Abonnenten benachrichtigen** – Kontrollkästchen, standardmäßig aktiv. Steuert, ob Abonnenten per E-Mail über die Erstellung des Vorfalls informiert werden (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Schalten Sie es ab für internes Rauschen, das Sie trotzdem festhalten wollen.
- **Privater Vorfall** – Kontrollkästchen, standardmäßig aus (`isPrivate`). Ein privater Vorfall ist nur für seine Eigentümer-Benutzer, die Mitglieder seiner Eigentümer-Teams, Projektadministratoren und Projekteigentümer sichtbar – und er ist auf jeder Statusseite ausgeblendet, unabhängig von jeder anderen Einstellung. Die Vorfallliste markiert diese mit einer roten **Private**-Pille.

Das Flag **Should be visible on status page?** (`isVisibleOnStatusPage`) steht nicht im Assistenten; es ist standardmäßig aktiv. Ändern Sie es danach über **Einstellungen** im Seitenmenü des Vorfalls, wo es **Auf Statusseite sichtbar** heißt.

## Aus einer Vorlage melden

Wenn Sie immer wieder denselben Zuschnitt von Vorfall melden – dasselbe Titelmuster, denselben Schweregrad, dieselbe Bereitschaftsrichtlinie –, speichern Sie ihn einmal als Vorlage.

Klicken Sie auf **Aus Vorlage erstellen** (die Umriss-Schaltfläche neben **Vorfall melden**), und ein Dialog **Vorfall aus Vorlage erstellen** öffnet sich, mit einem Dropdown **Vorfallvorlage auswählen**. Wählen Sie eine Vorlage, und das Erstellungsformular öffnet sich vorbelegt; vor dem Absenden können Sie noch alles ändern. Hat Ihr Projekt noch keine Vorlagen, erscheint stattdessen ein Dialog **No Incident Templates** mit einer Schaltfläche **Create Template**, die Sie zu **Vorfälle → Einstellungen → Vorfall-Vorlagen** bringt.

Vorlagen entstehen in einem eigenen sechsstufigen Assistenten – **Vorlageninformationen**, **Vorfalldetails**, **Betroffene Ressourcen**, **Bereitschaft**, **Eigentümer**, **Beschriftungen** – mit diesen Feldern:

| Feld                              | Zweck                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| **Vorlagenname**                  | Wie die Vorlage im Auswahlfeld erkennbar ist.                     |
| **Vorlagenbeschreibung**          | Eine Notiz an Ihr späteres Ich, wann Sie danach greifen sollten.  |
| **Titel**                         | Der Titel, der am Vorfall vorbelegt wird.                         |
| **Beschreibung**                  | Markdown-Beschreibung, die am Vorfall vorbelegt wird.             |
| **Vorfallsschweregrad**           | Schweregrad, der am Vorfall vorbelegt wird.                       |
| **Anfänglicher Vorfallstatus**    | Der Status, in dem Vorfälle aus dieser Vorlage starten.           |
| **Betroffene Ressourcen**         | Monitore, Hosts, Cluster und Dienste, die angehängt werden.       |
| **Überwachungsstatus ändern in**  | Monitor-Status, der auf die angehängten Monitore angewendet wird. |
| **Bereitschaftsrichtlinie**       | Richtlinien, die beim Anlegen des Vorfalls ausgeführt werden.     |
| **Eigentümer – Teams**            | Teams, denen aus dieser Vorlage erstellte Vorfälle gehören.       |
| **Eigentümer – Benutzer**         | Benutzer, denen aus dieser Vorlage erstellte Vorfälle gehören.    |
| **Beschriftungen**                | Beschriftungen, die auf den Vorfall angewendet werden.            |

Ein paar kurze Regeln:

- Vorlagen sind aus der Vorlagenliste heraus nicht bearbeitbar – Sie legen eine an und öffnen sie dann, um sie zu ändern.
- Eine Vorlage füllt nur ein Feld, das Sie leer gelassen haben. Auf der Erstellungsseite wird die Vorlage als überschreibbare Vorbelegung angewendet; in der API füllt der Server ein Feld nur dann aus der Vorlage, wenn die Anfrage es `undefined` gelassen hat. Was der Aufrufer geliefert hat, gewinnt immer.

## Automatisch aus Monitor-Kriterien melden

Die meisten Vorfälle sollten niemanden brauchen, der sie eintippt. Aktivieren Sie im Kriterien-Editor eines Monitors den Schalter **Wenn Filter übereinstimmen, einen Vorfall deklarieren.**, und ein Abschnitt **Vorfall erstellen** erscheint mit einer Schaltfläche **Vorfall hinzufügen** – ein Kriterienfilter kann mehr als einen Vorfall melden.

Jeder Eintrag hat:

- **Vorfalltitel** – unterstützt Vorlagen; der Platzhalter schlägt so etwas wie `{{monitorName}} is down` vor.
- **Schweregrad** – Pflichtfeld.
- **Vorfallbeschreibung** – ebenfalls mit Vorlagen.
- **Bereitschaft → Bereitschaftsrichtlinien** – Richtlinien, die beim Anlegen dieses Vorfalls ausgeführt werden.
- **Vorfallsrollen** – Teammitglieder vorab Rollen zuweisen.
- **Eigentümerschaft & Beschriftungen → Eigentümer-Teams**, **Eigentümer-Benutzer**, **Beschriftungen**.
- **Erweiterte Optionen → Vorfall automatisch beheben** (behebt den Vorfall automatisch, sobald die Kriterien nicht mehr greifen), **Vorfall auf der Statusseite anzeigen**, **Privater Vorfall** und **Behebungs-Notizen**.

Die vollständige Liste der `{{variable}}`-Platzhalter, die Sie in Titel, Beschreibung und Behebungs-Notizen verwenden können, steht unter [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).

So erzeugte Vorfälle kennzeichnet der Server: `isCreatedAutomatically` wird gesetzt, `createdCriteriaId` hält fest, welcher Kriterienfilter ausgelöst hat, und `createdByProbe`, welche Sonde es gesehen hat. In allem Übrigen verhalten sie sich genau wie ein von Hand gemeldeter Vorfall.

## Über die API melden

Das Vorfallmodell bietet einen standardmäßigen CRUD-Endpunkt, `POST /api/incident` legt also einen an. Authentifizieren Sie sich mit einem API-Schlüssel, den Sie unter **Projekteinstellungen → API-Schlüssel** erzeugen und im Header `apikey` mitsenden – der Schlüssel identifiziert das Projekt, Sie müssen also keine Projekt-ID separat übergeben.

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

- `title` – das einzige Feld, das Sie wirklich liefern müssen.
- `declaredAt` – hier optional, auch wenn das Formular es verlangt. Lassen Sie es weg, verwendet der Server die aktuelle Zeit.
- `incidentSeverityId` und `currentIncidentStateId` – der Server prüft, dass beide zum selben Projekt wie der API-Schlüssel gehören, und lehnt die Anfrage sonst ab. Dieselbe Prüfung gilt für den Monitor-Status hinter **Überwachungsstatus ändern in**.
- `createdIncidentTemplateId` – wendet eine gespeicherte Vorlage an. Jedes ausgelassene Feld wird aus der Vorlage gefüllt; jedes gesendete Feld bleibt, wie es ist.

Verwandte Endpunkte sind `/api/incident-state`, `/api/incident-severity` und `/api/incident-state-timeline`. Die generierte [API-Referenz](/reference) enthält die genauen Anfrage- und Antwortformen für jeden davon, samt der Frage, wie Beziehungsfelder wie Monitore ausgedrückt werden.

## Vorfallnummern und Präfixe

Jeder Vorfall erhält eine fortlaufende Nummer aus einem Zähler pro Projekt, die der Server beim Anlegen vergibt. Zwei Spalten halten sie: `incidentNumber` (die reine Ganzzahl) und `incidentNumberWithPrefix` (das, was Sie tatsächlich sehen). Ohne konfiguriertes Präfix lautet der Anzeigewert `#42`.

Um das zu ändern, gehen Sie zu **Vorfälle → Einstellungen → Weitere Einstellungen**. Die Karte **Nummernpräfix** enthält ein Feld **Vorfallnummern-Präfix** (bis zu 20 Zeichen, Platzhalter `INC-`) – setzen Sie es, und derselbe Vorfall erscheint als `INC-42`. Lassen Sie es leer, bleibt es beim voreingestellten `#`. Die Karte trägt außerdem **Nummernpräfix der Vorfall-Episode** für die Nummerierung von Episoden.

Die Nummer erscheint als erste Spalte der Vorfallliste, verlinkt auf den Vorfall und taucht als **Vorfallnummer** auf der **Übersicht** des Vorfalls auf.

## Was in dem Moment passiert, in dem ein Vorfall gemeldet wird

Der Erstellungsaufruf schreibt mehr als nur eine Zeile. Der Reihe nach:

1. **Der Server füllt die Lücken.** `declaredAt` fällt auf jetzt zurück, der aktuelle Status auf den Status des Projekts mit `isCreatedState`, und Vorfallnummer sowie präfigierte Nummer kommen aus dem Projektzähler.
2. **Eine Vorlage wird angewendet**, falls `createdIncidentTemplateId` mitgeliefert wurde – und füllt nur Felder, die der Aufrufer undefiniert gelassen hat.
3. **Datenschutzregeln laufen** und markieren den Vorfall als privat, wenn eine passende Regel das sagt. Das ist die erste Regel-Engine, damit alles Nachfolgende die richtige Datenschutz-Einstellung sieht.
4. **Eigentümerregeln laufen** und ergänzen die Eigentümer-Benutzer und -Teams, die passende Regeln benennen.
5. **Beschriftungsregeln laufen** und ergänzen Beschriftungen, die zum Vorfall passen.
6. **Bereitschaftsregeln laufen.** Jede aktivierte Regel unter **Vorfälle → Regeln → Bereitschaftsregeln**, deren Kriterien greifen, ergänzt ihre Richtlinien am Vorfall. Es gibt keine Prioritätsreihenfolge und keinen Abbruch – alle passenden Regeln greifen, und die Richtlinien werden dublettenfrei zusammengelegt.
7. **Runbook-Regeln laufen** und hängen passende Runbooks an und starten sie. Siehe [Runbooks](/docs/runbooks/index).
8. **Bereitschaftsrichtlinien werden ausgeführt.** Jede Richtlinie am Vorfall – im Assistenten gewählt, aus einer Vorlage geerbt oder von einer Regel ergänzt – läuft parallel mit dem Ereignistyp `IncidentCreated`. Scheitert eine Richtlinie, stoppt das die anderen nicht.
9. **Abonnenten werden eingereiht**, sofern **Statusseiten-Abonnenten benachrichtigen** aktiv blieb und der Vorfall auf der Statusseite sichtbar ist. Die Zustellung übernimmt ein Hintergrundjob, nicht Ihre Anfrage selbst.
10. **Workflows starten.** Der Trigger **On Create Incident** startet jeden darauf aufgebauten Workflow. Siehe [Workflows – Übersicht](/docs/workflows/index).

Ab da ist der Vorfall live: Er zählt für das Badge **Aktive Vorfälle** im Seitenmenü Vorfälle (jeder Status ohne das Flag `isResolvedState` gilt als aktiv), er erscheint auf den Statusseiten, die einen seiner Monitore führen, und seine **Zustands-Zeitachse** beginnt aufzuzeichnen.

## Wo Sie als Nächstes lesen sollten

- [Vorfälle – Übersicht](/docs/incidents/index) – wie das Vorfallmodell zusammenpasst.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was die Status-Flags bewirken und wie Sie eigene ergänzen.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche Notizen, private Notizen, Eigentümer und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Rollen, Regeln und Workflow-Trigger.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer von dem Vorfall erfährt, den Sie gerade gemeldet haben.
- [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating) – die Variablen, die automatisch gemeldeten Vorfällen zur Verfügung stehen.
