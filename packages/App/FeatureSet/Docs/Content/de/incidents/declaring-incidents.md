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

Öffnen Sie **Vorfälle → Alle Vorfälle** und klicken Sie oben rechts in der Liste **Vorfälle** auf **Vorfall melden**. Das bringt Sie zu einer Karte mit dem Titel **Neuen Vorfall melden**, die das Formular auf drei Schritte verteilt: **Vorfalldetails**, **Betroffene Ressourcen** und **Bereitschaft & Rollen**, danach eine Zusammenfassung zum Prüfen. Fragt Ihr Projekt beim Erstellen einige seiner benutzerdefinierten Vorfallfelder ab, folgt direkt nach **Betroffene Ressourcen** ein vierter Schritt, **Details**.

Nur der erste Schritt hat Pflichtfelder, dazu jedes benutzerdefinierte Feld, das Ihre Administratoren als **Beim Erstellen erforderlich** markiert haben. Ressourcen anhängen, Bereitschaftsrichtlinien ergänzen und Rollen vergeben können Sie auch anschließend auf den Seiten des Vorfalls selbst. Jeder Schritt vor der Zusammenfassung hat ein einfaches **Weiter**, und **Vorfall melden** steht in der Zusammenfassung, dem letzten Schritt.

**Erweitert.** Optionen, die die meisten Vorfälle nie brauchen, warten eingeklappt unter einer Überschrift **Erweitert** am Ende ihres Schritts; ein Klick darauf öffnet sie. Solange sie eingeklappt ist, zeigt die Überschrift **Konfiguriert**, wenn darin etwas gesetzt ist – etwa durch eine Vorlage –, und sie öffnet sich von selbst, wenn darin etwas korrigiert werden muss. Die Zusammenfassung führt eine eingeklappte Option nur auf, wenn sie gesetzt ist – außer **Statusseiten-Abonnenten benachrichtigen**, das sie immer aufführt, zusammen mit der Angabe, wer benachrichtigt wird.

### Schritt 1 – Vorfalldetails

- **Titel** – Pflichtfeld. Die einzeilige Zusammenfassung, die alle in der Liste, in Slack und (wenn der Vorfall sichtbar ist) auf Ihrer Statusseite sehen.
- **Vorfallsschweregrad** – Pflichtfeld. Einer der für Ihr Projekt konfigurierten Schweregrade.
- **Beschreibung** – optional, in Markdown geschrieben. Dieses Feld erscheint auf der Statusseite, schreiben Sie es also für Kunden und nicht für Ihr Team.

Unter **Erweitert**:

- **Erklärt am** – beginnt mit dem Zeitpunkt, zu dem Sie die Seite geöffnet haben. Von ihm aus wird jede Dauer am Vorfall gemessen; datieren Sie ihn zurück, um einen Vorfall zu erfassen, der früher begonnen hat.
- **Anfangsstatus** – optional und zunächst leer. Bleibt es leer, startet der Vorfall in dem Status mit dem Flag `isCreatedState` oder im Anfangsstatus der Vorlage. Wählen Sie einen späteren Status nur, um einen bereits bestätigten oder behobenen Vorfall zu erfassen.
- **Beschriftungen** – optional. Beschriftungen gruppieren zusammengehörige Vorfälle, und ein auf Beschriftungen beschränktes Team sieht nur die Vorfälle mit einer seiner Beschriftungen.
- **Privater Vorfall** – standardmäßig aus (`isPrivate`). Ein privater Vorfall ist nur für seine Eigentümer, Projektadministratoren und Projekteigentümer sichtbar und auf jeder Statusseite ausgeblendet.

**Falls das Status-Dropdown Ärger macht.** Trägt in Ihrem Projekt kein Status das Flag `isCreatedState`, schlägt der Erstellungsaufruf fehl und weist Sie an, in den Einstellungen einen Erstellungsstatus anzulegen. Das passiert normalerweise nur in Projekten, deren Status stark bearbeitet wurden – siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

### Schritt 2 – Betroffene Ressourcen

Die Monitore kommen zuerst und für sich: Statusseiten sehen einen Vorfall über seine Monitore, und der Status, in den die Monitore wechseln, steht direkt darunter.

- **Monitore** – ein Suchfeld, das die vom Vorfall betroffenen Monitore anhängt (`monitors`). Eine Statusseite zeigt den Vorfall und benachrichtigt ihre Abonnenten, wenn sie einen dieser Monitore auflistet.
- **Monitor-Status ändern in** – optional und erst sichtbar, sobald mindestens ein Monitor ausgewählt ist. Setzt jeden Monitor des Vorfalls auf einen Monitor-Status, sodass den Vorfall zu melden und seine Monitore als beeinträchtigt zu markieren ein Handgriff ist. Der Status einer Vorlage erscheint, sobald Sie einen Monitor auswählen; ohne ausgewählten Monitor wird kein Status gespeichert.
- **Andere betroffene Ressourcen** – ein zweites Suchfeld für alles andere, was der Vorfall betrifft: Hosts, Kubernetes-Cluster, Docker- und Podman-Hosts, Proxmox-, Ceph- und Docker-Swarm-Cluster, vCenter, IoT-Flotten, Datenbanken und Dienste. Es sind getrennte Beziehungen am Vorfall (`hosts`, `kubernetesClusters`, `services` und weitere).

Die Karte **Betroffene Ressourcen** des Vorfalls fragt beim späteren Bearbeiten genauso.

Unter **Erweitert**:

- **Auf diese Statusseiten beschränken** – optional. Bleibt es leer, erscheint der Vorfall auf jeder Statusseite, die seine Monitore auflistet, und benachrichtigt deren Abonnenten; mit ausgewählten Seiten nur auf diesen Seiten unter ihnen. Siehe [Eine Statusseite pro Zielgruppe](/docs/status-pages/one-status-page-per-audience).
- **Statusseiten-Abonnenten benachrichtigen** – Kontrollkästchen, standardmäßig aktiv (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Darunter und noch einmal in der Zusammenfassung zeigt das Formular, welche Statusseiten benachrichtigt werden und wie viele Abonnenten jede hat; in der Zusammenfassung zeigt **Benachrichtigung ansehen** die E-Mail, die sie erhalten. Schalten Sie es ab für internes Rauschen, das Sie trotzdem festhalten wollen.

**Hängen Sie Monitore an, auch wenn es überflüssig wirkt.** Die Verbindung zwischen einem Vorfall und einer Statusseite läuft über die Monitore des Vorfalls: Eine Statusseite zeigt einen Vorfall, wenn eine ihrer Ressourcen einer der Monitore des Vorfalls ist. Eine Statuswechsel-Benachrichtigung an Abonnenten unterbleibt vollständig, wenn am Vorfall keine Monitore hängen. Siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).

### Schritt 3 – Bereitschaft & Rollen

- **Bereitschaftsrichtlinie** – eine Mehrfachauswahl der Bereitschaftsrichtlinien, die beim Anlegen dieses Vorfalls ausgeführt werden (`onCallDutyPolicies`).
- **Vorfallrollen zuweisen** – wer welche Rolle übernimmt, die Ihr Projekt definiert. Eine als **Primär** markierte Rolle, die Sie leer lassen, übernehmen Sie selbst, wenn der Vorfall gemeldet wird.

Dies ist die einzige Stelle, an der eine Bereitschaftsrichtlinie direkt an einen Vorfall gehängt wird. Schweregrade tragen keine Bereitschaftsrichtlinie – ein Schweregrad ist eine Beschriftung und beeinflusst das Alarmieren nur als *Übereinstimmungskriterium* innerhalb einer Bereitschaftsregel. Regeln unter **Vorfälle → Regeln → Bereitschaftsregeln** legen ihre Richtlinien obendrauf; ausgeführt wird am Ende die dublettenfreie Vereinigung aus beidem.

Die Rollen selbst konfigurieren Sie unter **Vorfälle → Einstellungen → Vorfallsrollen**. Ein neues Projekt hat eine, Incident Commander; legen Sie dort an, was Ihr Prozess sonst braucht.

Das Flag **Should be visible on status page?** (`isVisibleOnStatusPage`) steht nicht im Assistenten; es ist standardmäßig aktiv. Ändern Sie es danach über **Einstellungen** im Seitenmenü des Vorfalls, wo es **Auf Statusseite sichtbar** heißt.

## Aus einer Vorlage melden

Wenn Sie immer wieder denselben Zuschnitt von Vorfall melden – dasselbe Titelmuster, denselben Schweregrad, dieselbe Bereitschaftsrichtlinie –, speichern Sie ihn einmal als Vorlage.

Klicken Sie auf **Aus Vorlage erstellen** (die Umriss-Schaltfläche neben **Vorfall melden**), und ein Dialog **Vorfall aus Vorlage erstellen** öffnet sich, mit einem Dropdown **Vorfallvorlage auswählen**. Wählen Sie eine Vorlage, und das Erstellungsformular öffnet sich vorbelegt; vor dem Absenden können Sie noch alles ändern. Hat Ihr Projekt noch keine Vorlagen, erscheint stattdessen ein Dialog **No Incident Templates** mit einer Schaltfläche **Create Template**, die Sie zu **Vorfälle → Einstellungen → Vorfall-Vorlagen** bringt.

Vorlagen entstehen in einem eigenen Assistenten – **Vorlageninformationen**, **Vorfalldetails**, **Betroffene Ressourcen**, **Bereitschaft** –, dazu Schritte für benutzerdefinierte Felder, wenn Ihr Projekt welche hat. Eigentümer und Beschriftungen stehen unter **Erweitert** am Ende von **Vorfalldetails**. **Betroffene Ressourcen** fragt wie das Meldeformular – **Monitore**, dann **Monitor-Status ändern in**, dann **Andere betroffene Ressourcen**, mit **Auf diese Statusseiten beschränken** unter **Erweitert** –, nur fragt eine Vorlage den Monitor-Status immer ab: Er gilt auch für die Monitore, die beim Melden eines Vorfalls aus der Vorlage ausgewählt werden. Das sind die Felder:

| Feld                              | Zweck                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| **Vorlagenname**                  | Wie die Vorlage im Auswahlfeld erkennbar ist.                     |
| **Vorlagenbeschreibung**          | Eine Notiz an Ihr späteres Ich, wann Sie danach greifen sollten.  |
| **Titel**                         | Der Titel, der am Vorfall vorbelegt wird.                         |
| **Beschreibung**                  | Markdown-Beschreibung, die am Vorfall vorbelegt wird.             |
| **Vorfallsschweregrad**           | Schweregrad, der am Vorfall vorbelegt wird.                       |
| **Anfänglicher Vorfallstatus**    | Der Status, in dem Vorfälle aus dieser Vorlage starten.           |
| **Monitore** | Monitore, die angehängt werden. |
| **Monitor-Status ändern in** | Monitor-Status für die Monitore des Vorfalls, auch für die beim Melden ausgewählten. |
| **Andere betroffene Ressourcen** | Hosts, Cluster und Dienste, die angehängt werden. |
| **Auf diese Statusseiten beschränken** | Statusseiten, auf die der Vorfall beschränkt ist. |
| **Bereitschaftsrichtlinie**       | Richtlinien, die beim Anlegen des Vorfalls ausgeführt werden.     |
| **Eigentümer** | Personen und Teams, denen aus dieser Vorlage erstellte Vorfälle gehören, ausgewählt aus einer Liste. |
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

Um das zu ändern, gehen Sie zu **Vorfälle → Einstellungen → Nummernpräfix** und klicken Sie auf **Aktualisieren**. Das Feld **Vorfallnummern-Präfix** zeigt beim Tippen eine Vorschau der Nummer: Mit `INC-` wird daraus `INC-42`. Lassen Sie es leer, bleibt es beim voreingestellten `#`. Ein neues Präfix gilt für Vorfälle, die danach gemeldet werden; bestehende Vorfälle behalten ihre Nummer. Im selben Dialog steht **Nummernpräfix der Vorfall-Episode** für die Nummerierung von Episoden.

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
