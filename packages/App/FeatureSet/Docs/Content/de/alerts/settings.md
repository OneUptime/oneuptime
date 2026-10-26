# Warnungsregeln & Einstellungen

Die Konfiguration von Warnungen liegt unter **Warnungen**, nicht in den **Projekteinstellungen**: die Regeln, die auf jede neue Warnung wirken, und die Einstellungen, die jede Warnung im Projekt prägen. Diese Seite ist die Referenz für jede davon und dafür, was beim Erstellen einer Warnung von selbst läuft.

:::cards
- [Die Regeln, die eine neue Warnung durchläuft](#die-regeln-die-eine-neue-warnung-durchläuft): Der Reihe nach, und was jede bewirkt.
- [Bereitschaftsregeln](#bereitschaftsregeln): Die richtigen Personen alarmieren, ohne jedes Mal eine Richtlinie zu wählen.
- [Erinnerungsregeln](#erinnerungsregeln): Eigentümer erinnern, solange eine Warnung offen bleibt.
- [Einstellungen](#einstellungen): Notiz-Vorlagen, benutzerdefinierte Felder, Messungen, Episodenzugehörigkeit und Nummerierung.
:::

## Wo die Warnungseinstellungen liegen

Öffnen Sie **Warnungen** über das Menü **Produkte** in der oberen Leiste. Die Bereiche **Regeln** und **Einstellungen** im Seitenmenü sind zunächst eingeklappt, klappen Sie sie also zuerst auf. Jede Seite hier gilt projektweit, unter Adressen, die mit `/dashboard/{projectId}/alerts/settings/` beginnen.

| Regelseite              | Was sie tut                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| **Gruppierungsregeln**  | Fasst zusammengehörige Warnungen in Episoden zusammen. Siehe [Warnungsepisoden & Gruppierungsregeln](/docs/alerts/episodes). |
| **Bereitschaftsregeln** | Führt Bereitschaftsrichtlinien für passende Warnungen und Episoden aus.                         |
| **Eigentümerregeln**    | Fügt passenden Warnungen und Episoden Eigentümer hinzu.                                         |
| **Runbook-Regeln**      | Startet Runbooks für passende Warnungen.                                                        |
| **Datenschutzregeln**   | Macht passende Warnungen und Episoden privat.                                                   |
| **Beschriftungsregeln** | Fügt passenden Warnungen und Episoden Beschriftungen hinzu.                                     |
| **Erinnerungsregeln**   | Erinnert Eigentümer in einem Intervall, solange eine Warnung offen ist.                         |

Der Bereich **Einstellungen** enthält **Warnungsstatus** und **Warnungsschweregrad**, beschrieben unter [Warnungsstatus & Schweregrade](/docs/alerts/states-and-severities), dann **Notiz-Vorlagen**, **Benutzerdefinierte Felder**, **Messungen**, **Episodenzugehörigkeit** und **Nummerierung**, beschrieben weiter unten.

Zwei weitere Bereiche wirken auf Warnungen. **Warnungen → KI → Einstellungen** entscheidet, was OneUptime AI von selbst tut: **Neue Warnungen untersuchen**, in neuen Projekten eingeschaltet, und **Neue Warnungen automatisch beheben**, aus, bis Sie es einschalten. Siehe [AI SRE](/docs/ai/ai-sre). **Warnungen → Arbeitsbereich** enthält die Slack- und Microsoft-Teams-Regeln, die Warnungen und Episoden in Kanäle posten, und seinen Tab **Zusammenfassung**. Siehe [Slack](/docs/workspace-connections/slack).

## Die Regeln, die eine neue Warnung durchläuft

```mermaid title="Die Regeln, die eine neue Warnung durchläuft, der Reihe nach"
flowchart TB
    subgraph shape["Wer sie sieht und besitzt"]
        direction LR
        privacy["Datenschutzregeln"] --> owner["Eigentümerregeln"]
    end
    subgraph more["Was sie bekommt"]
        direction LR
        label["Beschriftungsregeln"] --> oncall["Bereitschaftsregeln"]
    end
    subgraph page["Was sie startet"]
        direction LR
        runbook["Runbook-Regeln"] --> execute["Richtlinien laufen"]
    end
    subgraph follow["Danach"]
        direction LR
        grouping["Gruppierungsregeln"] --> reminder["Erinnerungsregeln"]
    end
    shape --> more
    more --> page
    page --> follow
```

Die Regeln unterscheiden sich darin, wie mehrere Treffer aufgelöst werden:

- **Gruppierungsregeln** und **Erinnerungsregeln** werden von oben nach unten in ihrer Liste geprüft, und der erste Treffer gewinnt. Ziehen Sie eine Regel, um ihren Platz zu ändern; eine neue Regel kommt ans Ende.
- **Bereitschaftsregeln**, **Eigentümerregeln**, **Beschriftungsregeln**, **Datenschutzregeln** und **Runbook-Regeln** wirken alle, wenn sie zutreffen. Bereitschaftsrichtlinien, Eigentümer und Beschriftungen, die mehrere Regeln hinzufügen, werden einmal hinzugefügt.

**Bereitschaftsregeln**, **Eigentümerregeln**, **Beschriftungsregeln** und **Datenschutzregeln** haben zwei Tabs: **Warnungsregeln** für Warnungen und **Episodenregeln**, die auf jede neue Warnungsepisode genauso wirken. Eine neue Regel beginnt aktiviert; schalten Sie **Aktiviert** im Bearbeitungsformular aus, um sie zu pausieren, und die Liste zeigt für jede Regel ein grünes **Aktiviert** oder ein rotes **Deaktiviert**.

Die meisten Regeln wirken auf Warnungen und Episoden, die nach dem Speichern erstellt werden. Um eine Eigentümer-, Beschriftungs- oder Datenschutzregel auf bereits vorhandene anzuwenden, nutzen Sie **Jetzt ausführen**: siehe [Regeln für bestehende Ressourcen ausführen](/docs/configuration/run-rules-now). Erinnerungsregeln sind die Ausnahme: Das Speichern einer solchen gleicht jede offene Warnung neu ab.

### Bedingungen

Die Bedingungen einer Regel entscheiden, auf welche Warnungen sie wirkt, und lesen sich wie Sätze: „Wenn **Warnungstitel** `database` enthält“, „Und **Überwachungs-Beschriftungen** eines von *Production* hat“. Eine Regel ohne Bedingungen trifft auf jede Warnung zu.

| Bedingung                                                     | Vergleicht mit                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Monitore**, **Warnungsschweregrade**, **Warnungsbeschriftungen**, **Überwachungs-Beschriftungen** | **Hat eines von**, **Hat alle von** oder **Hat keines von** den Werten, die Sie wählen.   |
| **Warnungstitel**, **Warnungsbeschreibung**, **Überwachungsname**, **Überwachungsbeschreibung** | **Enthält**, **Enthält nicht**, **Gleich**, **Ungleich**, **Beginnt mit**, **Endet mit**, ohne Beachtung der Groß-/Kleinschreibung, oder **Entspricht Muster** und **Entspricht nicht dem Muster**, für einen regulären Ausdruck oder einen Platzhalter `*`. |

Bei zwei oder mehr Bedingungen wählen Sie **Alle müssen zutreffen**, wobei jede gelten muss, oder **Eine muss zutreffen**, wobei eine genügt. Episodenregeln prüfen stattdessen Schweregrad, Beschriftungen, Titel und Beschreibung einer Episode.

## Bereitschaftsregeln

**Warnungen → Regeln → Bereitschaftsregeln** macht das Alarmieren automatisch. Jede passende Regel fügt der neuen Warnung ihre Richtlinien hinzu, und die Warnung führt sie zusammen mit den Richtlinien aus, die sie schon hatte, jede einmal.

:::steps
### Die Warnungen wählen

Klicken Sie auf **Bereitschaftsregel für Warnungen erstellen**. Unter **Übereinstimmung** trifft **Alle Warnungen**, womit eine neue Regel beginnt, auf jede neue Warnung zu. Um sie einzugrenzen, wählen Sie **Nur Warnungen, die den Bedingungen entsprechen** und fügen die Bedingungen hinzu, die eine Warnung erfüllen muss.

### Die Richtlinien wählen

Wählen Sie unter **Bereitschaftsrichtlinien** die **Bereitschaftsrichtlinien**, über die die Regel alarmiert. Ihr **Name** folgt ihnen, etwa „Platform on-call alarmieren“, bis Sie einen eigenen eingeben, und eine **Beschreibung** wartet unter **Weitere Felder**. Erstellen Sie dann die Regel.
:::

Ein Schweregrad alarmiert für sich niemanden: Eine Bereitschaftsregel, die auf **Warnungsschweregrade** prüft, ist der Weg, „bei jeder Warnung mit Schweregrad Hoch das Datenbankteam alarmieren“ einzurichten. Um zu sehen, was für eine Warnung lief, öffnen Sie ihre Seite **Bereitschaftsausführungen**. Jede Person wird dann so erreicht, wie sie es unter **Benutzereinstellungen → Bereitschaftsregeln** auf dem Tab **Warnungen** eingerichtet hat; siehe [Eskalationsregeln](/docs/on-call/escalation-rules).

Eine Regel alarmiert, sobald eine Warnung zu ihr passt. Damit sie stattdessen auf die Arbeitszeiten wartet, beantworten Sie **Wann soll diese Regel alarmieren?** unter **Weitere Felder** mit **Nur während der Arbeitszeiten**. Die **Arbeitszeiten** beginnen mit Montag bis Freitag, 09:00 bis 17:00, in Ihrer eigenen Zeitzone: Wählen Sie andere Tage, eine andere **Startzeit** oder **Endzeit** oder eine andere **Zeitzone**, und ein Satz unter der Auswahl sagt, was passiert. In der Liste zeigt die Regel ihre Zeiten unter ihrem Namen. Eine Warnung, die außerhalb dieser Zeiten passt, bekommt einen Lauf, der wartet und niemanden alarmiert; sobald die Arbeitszeiten beginnen, alarmiert die Richtlinie über ihre erste Eskalationsregel und eskaliert wie gewohnt. Wird die Warnung vorher bestätigt oder behoben, wird niemand alarmiert. Ändert sich die Warnung, während sie wartet, und passt sie nun zu einer Regel, die sofort alarmiert, etwa weil ihr Schweregrad erhöht wurde, beginnt der Lauf umgehend zu alarmieren, und der Feed der Warnung sagt, warum. Zwei Regeln, die dieselbe Richtlinie auslösen, lösen sie aus, sobald eine von beiden es zulässt: Eine Regel für Ihre höchsten Schweregrade, die sofort alarmiert, neben einer Regel für den Rest, die auf die Arbeitszeiten wartet, hält die Nächte ruhig.

## Eigentümer- und Beschriftungsregeln

**Eigentümerregeln** fügen passenden neuen Warnungen Eigentümer-Benutzer und -Teams hinzu, und **Beschriftungsregeln** fügen Beschriftungen hinzu. Das Erstellen hat zwei Schritte: **Übereinstimmung**, die Bedingungen, dann **Eigentümer** oder **Beschriftungen**, was die Regel hinzufügt. Der **Name** der Regel folgt Ihrer Auswahl, bis Sie einen eigenen eingeben.

- **Eine Regel kann erben.** Unter **Eigentümer erben** oder **Beschriftungen erben** eingeklappt, geben sechs Schalter die Eigentümer oder Beschriftungen des Monitors, der Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts und Dienste der Warnung weiter. Episodenregeln haben keine solchen Schalter. Der Abschnitt **Eigentümer erben** einer Eigentümerregel endet mit **Team des Erstellers**: Von den dort aufgeführten Teams wird jedes, in dem die Person ist, die die Warnung erstellt, ebenfalls Eigentümer.
- **Eine neue Regel muss etwas hinzufügen**: Wählen Sie mindestens einen Eigentümer oder eine Beschriftung, oder schalten Sie einen Schalter ein. Bei einer Eigentümerregel für Vorfälle oder Warnungen genügt auch ein Team unter **Team des Erstellers**.
- **Eigentümer benachrichtigen**, unter **Weitere Felder** einer Eigentümerregel, entscheidet, ob die hinzugefügten Personen informiert werden.

[Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules) beschreibt das Formular Schritt für Schritt, für jede Art von Ressource.

## Datenschutz- und Runbook-Regeln

**Datenschutzregeln** machen passende neue Warnungen privat, bevor irgendetwas anderes läuft: Nur ihre Eigentümer sowie die Admins und Eigentümer des Projekts können sie sehen. Eine Regel hat zwei Schritte: **Übereinstimmung**, die Warnungen, die sie privat macht, dann **Name**, schon ausgefüllt mit „Warnungen privat machen“. Siehe [Private Warnungen](/docs/alerts/index#private-warnungen).

**Runbook-Regeln** starten ein Runbook, wenn eine neue Warnung zutrifft, es sei denn, die Warnung wurde behoben erstellt. Siehe [Runbook-Regeln](/docs/runbooks/rules).

## Erinnerungsregeln

**Warnungen → Regeln → Erinnerungsregeln** erinnert die Eigentümer einer Warnung, solange sie offen bleibt. Jede neue Warnung bekommt die erste Regel, die auf sie zutrifft, von oben nach unten in der Liste.

:::steps
### Wählen, an welche Warnungen erinnert wird

Klicken Sie auf **Erinnerungsregel für Warnungen erstellen**. Lassen Sie unter **Übereinstimmung** die Auswahl **Alle Warnungen** stehen, um an jede Warnung zu erinnern, oder wählen Sie **Nur Warnungen, die den Bedingungen entsprechen** und dann die **Warnungsschweregrade** und **Beschriftungen**, für die sie gilt.

### Das Intervall festlegen

Legen Sie unter **Erinnerungen** das **Erinnerungsintervall (Minuten)** fest, wie oft Eigentümer erinnert werden, und **Erinnerungen beenden, wenn**: **Behoben**, die Vorgabe, oder **Bestätigt**. Ihr **Name** folgt beidem, etwa „Alle 30 Minuten erinnern, bis behoben“, bis Sie einen eigenen eingeben. Erstellen Sie dann die Regel.
:::

Eigentümer erhalten jede Erinnerung als **Warnungserinnerung**, die standardmäßig per E-Mail eingeschaltet ist. Die Regel einer Warnung wird neu abgeglichen, wenn sich ihr Schweregrad oder ihre Beschriftungen ändern. Um die Erinnerungen für eine Warnung zu beenden, schalten Sie **Erinnerungen senden** auf ihrer Seite **Einstellungen** aus; das speichert, sobald Sie den Schalter umlegen.

## Einstellungen

### Notiz-Vorlagen

**Warnungen → Einstellungen → Notiz-Vorlagen** enthält fertigen Text für private Notizen. Die Karte **Vorlagen für private Notizen für Warnungen** listet sie; **Notizvorlage für Warnungen erstellen** fragt nach **Vorlagenname**, **Vorlagenbeschreibung** und **Notiz**. Eine Vorlage wird angeboten, wenn jemand eine private Notiz zu einer Warnung oder Episode schreibt und wenn jemand eine bestätigt oder behebt, und ihr Text lässt sich vor dem Veröffentlichen bearbeiten. Notizvorlagen für Warnungen sind reiner Text: Anders als Notizvorlagen für Vorfälle füllen sie keine Variablen aus.

### Benutzerdefinierte Felder

**Warnungen → Einstellungen → Benutzerdefinierte Felder** fügt jeder Warnung eigene Felder hinzu, etwa eine Kundenstufe oder eine Ticketreferenz. Füllen Sie sie auf der Seite **Benutzerdefinierte Felder** einer Warnung aus oder über die API als `customFields`. Ein Feld kann seinen Wert aus einem benutzerdefinierten Feld des Monitors übernehmen, statt eingetippt zu werden: siehe [Von einem Monitor kopierte Felder](/docs/incidents/settings#von-einem-monitor-kopierte-felder), was für Warnungen genauso funktioniert.

### Messungen

**Warnungen → Einstellungen → Messungen** misst, wie lange Dinge bei jeder Warnung dauern. Wählen Sie **Zeit bis zur Bestätigung** oder **Zeit bis zur Behebung** oder zwei eigene Zeitpunkte, etwa wenn **Die Warnung wird erstellt** und wenn sie einen Status erreicht, den Sie wählen. Jede Messung wird auf der Seite der Warnung angezeigt und als `oneuptime.alert.measurement.<key>` in Diagrammen dargestellt. Siehe [Messungen](/docs/incidents/settings#messungen), was für Warnungen genauso funktioniert.

Die **Zeit bis zur Bestätigung nach der Alarmierung** zählt ab **Jemand wird zum ersten Mal alarmiert**, wenn eine Bereitschaftsrichtlinie oder eine direkte Alarmierung zum ersten Mal jemanden über die Warnung benachrichtigt hat, statt ab ihrer Erstellung: Einer Warnung, die nachts ausgelöst wird und zu der erst morgens jemand alarmiert wird, wird die Nacht nicht angerechnet. Eine Warnung, zu der niemand alarmiert wurde, hat keinen Wert. Siehe [Zeit bis zur Bestätigung nach der Alarmierung](/docs/incidents/settings#zeit-bis-zur-bestätigung-nach-der-alarmierung).

### Episodenzugehörigkeit

**Warnungen → Einstellungen → Episodenzugehörigkeit** legt fest, ob eine Warnung in mehr als einer Episode sein kann. Schalten Sie **Eine Warnung kann nur in einer Episode sein** ein, wird eine Warnung, die in einer Episode ist, keiner anderen hinzugefügt, weder im Dashboard noch über die API, einen Workflow oder eine Gruppierungsregel, bis sie aus dieser Episode entfernt ist. Der Schalter ist aus, bis Sie ihn einschalten, und nur Project Owners und Project Admins können ihn ändern. Das Einschalten nimmt keine Warnung aus einer Episode heraus. Siehe [Eine Episode pro Vorfall](/docs/incidents/episodes#eine-episode-pro-vorfall), was für Warnungen genauso funktioniert.

### Nummerierung

**Warnungen → Einstellungen → Nummerierung** legt den Text vor Warnungs- und Episodennummern fest: `ALT-` und `AE-` in einem neuen Projekt, oder `#` ohne Präfix. **Aktualisieren** öffnet **Warnungsnummernpräfix** und **Warnungs-Episoden-Nummernpräfix**, mit einer Vorschau beim Tippen. Nur danach erstellte Warnungen und Episoden bekommen das neue Präfix. Die Regeln für ein Präfix stehen unter [Nummernpräfixe](/docs/incidents/settings#nummernpräfixe).

Die Karte **Nächste Nummer** darunter legt die Nummer fest, die die nächste Warnung und die nächste Episode bekommen, um die Nummern eines anderen Tools fortzusetzen: **Aktualisieren** öffnet **Nächste Warnungsnummer** und **Nächste Nummer der Warnungsepisode**, jede höher als die bisher höchste. Siehe [Nächste Nummern](/docs/incidents/settings#nächste-nummern).

> [!NOTE]
> In OneUptime Cloud brauchen Notiz-Vorlagen und benutzerdefinierte Felder den Plan **Growth** oder höher.

## Workflows

Jedes Warnungsmodell hat Workflow-Auslöser und -Aktionen, nach ihm benannt: **On Create Alert**, **On Update Alert**, **On Create or Update Alert** und **On Delete Alert**, dasselbe für **Warnungsepisode**, **Statuszeitachse der Warnung** und die anderen, sowie Aktionen wie **Create One Alert** und **Update One Alert**. Die Definitionen benutzerdefinierter Felder für Warnungen sind die einzige Ausnahme: Sie haben keine Workflow-Auslöser. Siehe [Workflows – Übersicht](/docs/workflows/index).

## Wer das ändern kann

Regeln, benutzerdefinierte Felder und Messungen brauchen einen Project Owner oder Project Admin oder eine eigene Rolle mit der eigenen Berechtigung dieser Regel. **Warnungs-Mitglied** arbeitet mit Warnungen und Episoden, ihren Notizen, Eigentümern und Statuszeitachsen sowie mit Notiz-Vorlagen, und **Warnungs-Administrator** verwaltet zusätzlich Warnungsstatus und Schweregrade. Siehe [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

## Nächste Schritte

:::cards
- [Warnungsepisoden & Gruppierungsregeln](/docs/alerts/episodes): Die Gruppierungsregeln im Detail.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Was passiert, sobald eine Bereitschaftsregel eine Richtlinie ausführt.
- [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules): Das Regelformular, Schritt für Schritt.
- [AI SRE](/docs/ai/ai-sre): Neue Warnungen von selbst untersuchen und beheben.
:::
