# Wartungsregeln & Einstellungen

Die Konfiguration der Wartung liegt in **Geplante Wartung**, nicht in den **Projekteinstellungen**: die Regeln, die auf jedes neue Ereignis wirken, und die Einstellungen, die jedes Ereignis im Projekt prägen. Diese Seite ist die Referenz für jede davon und dafür, wer sie ändern darf.

:::cards
- [Die Regeln, die ein neues Ereignis durchläuft](#die-regeln-die-ein-neues-ereignis-durchläuft): In Reihenfolge, und was jede tut.
- [Erinnerungsregeln](#erinnerungsregeln): Eigentümer erinnern, bis ein Ereignis abgeschlossen ist.
- [Einstellungen](#einstellungen): Notizvorlagen, benutzerdefinierte Felder, Messungen und Nummerierung.
- [Wer sie ändern darf](#wer-sie-ändern-darf): Die Wartungsrollen und die Pläne.
:::

## Wo die Wartungseinstellungen liegen

Öffnen Sie **Geplante Wartung** über das Menü **Produkte** in der oberen Leiste. Die Abschnitte **Regeln** und **Einstellungen** seines Seitenmenüs sind zunächst eingeklappt, klappen Sie sie also zuerst auf. Jede Seite hier gilt projektweit, unter einer Adresse, die mit `/dashboard/{projectId}/scheduled-maintenance-events/settings/` beginnt.

| Regelseite         | Was sie tut                                                         |
| ------------------ | ------------------------------------------------------------------- |
| **Eigentümerregeln** | Fügt passenden Ereignissen Eigentümer hinzu.                      |
| **Runbook-Regeln** | Startet Runbooks für passende Ereignisse.                           |
| **Beschriftungsregeln** | Fügt passenden Ereignissen Beschriftungen hinzu.               |
| **Erinnerungsregeln** | Erinnert Eigentümer in einem Intervall, bis ein Ereignis abgeschlossen ist. |

Der Abschnitt **Einstellungen** enthält **Ereignisstatus**, behandelt unter [Wartungsstatus](/docs/scheduled-maintenance/states), **Ereignis-Vorlagen**, behandelt unter [Vorlagen & wiederkehrende Ereignisse](/docs/scheduled-maintenance/templates), dann **Notiz-Vorlagen**, **Benutzerdefinierte Felder**, **Messungen**, **Kalendereinstellungen** und **Nummerierung**. **Kalendereinstellungen** wird unter [Wartungskalender](/docs/scheduled-maintenance/calendar#externe-kalender) behandelt, der Rest unten.

Der Abschnitt **Arbeitsbereich** enthält die Slack- und Microsoft-Teams-Regeln, die Ereignisse in Kanäle posten. Siehe [Slack](/docs/workspace-connections/slack#benachrichtigungsregeln) und [Microsoft Teams](/docs/workspace-connections/microsoft-teams#benachrichtigungsregeln).

## Die Regeln, die ein neues Ereignis durchläuft

```mermaid title="Die Regeln, die ein neues Ereignis durchläuft, in Reihenfolge"
flowchart TB
    created["Ein neues Ereignis"] --> owners["Eigentümerregeln<br/>fügen Eigentümer hinzu"]
    owners --> labels["Beschriftungsregeln<br/>fügen Beschriftungen<br/>hinzu"]
    labels --> runbooks["Runbook-Regeln<br/>starten Runbooks"]
    runbooks --> reminders["Erinnerungsregeln<br/>planen Erinnerungen"]
```

Die Regeln unterscheiden sich darin, wie mehrere Treffer aufgelöst werden:

- **Eigentümerregeln**, **Beschriftungsregeln** und **Runbook-Regeln** wirken alle, wenn sie passen. Eigentümer und Beschriftungen, die mehrere Regeln hinzufügen, werden einmal hinzugefügt.
- **Erinnerungsregeln** werden von oben nach unten in ihrer Liste geprüft, und der erste Treffer gewinnt. Ziehen Sie eine Regel, um ihren Platz zu ändern; eine neue Regel kommt ans Ende.

Eine neue Regel beginnt aktiviert; schalten Sie **Aktiviert** in ihrem Bearbeitungsformular aus, um sie zu pausieren, und die Liste zeigt für jede Regel ein grünes **Aktiviert** oder ein rotes **Deaktiviert**. Eigentümer-, Beschriftungs- und Runbook-Regeln wirken auf Ereignisse, die nach dem Speichern erstellt werden. Um eine Eigentümer- oder Beschriftungsregel auf die Ereignisse anzuwenden, die Sie schon haben, nutzen Sie **Jetzt ausführen**: siehe [Regeln für bestehende Ressourcen ausführen](/docs/configuration/run-rules-now).

## Eigentümer- und Beschriftungsregeln

**Eigentümerregeln** fügen neuen passenden Ereignissen Eigentümer-Benutzer und -Teams hinzu, und **Beschriftungsregeln** fügen Beschriftungen hinzu. Das Erstellen braucht zwei Schritte: **Übereinstimmung**, die Bedingungen, dann **Eigentümer** oder **Beschriftungen**, was die Regel hinzufügt.

| Bedingung                                                       | Passt auf                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Monitore**, **Ereignis-Beschriftungen**, **Überwachungs-Beschriftungen** | Ereignisse mit einem der gewählten Monitore oder einer der gewählten Beschriftungen. |
| **Ereignistitel**, **Ereignisbeschreibung**, **Überwachungsname**, **Überwachungsbeschreibung** | Ein Muster, als regulärer Ausdruck, ohne Beachtung der Groß- und Kleinschreibung. |

Eine Regel passt nur, wenn jede ausgefüllte Bedingung zutrifft; eine leer gelassene Bedingung wird übersprungen.

- **Eine Regel kann erben.** Eingeklappt unter **Eigentümer erben** oder **Beschriftungen erben** geben sechs Schalter die Eigentümer oder Beschriftungen der Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts und Dienste des Ereignisses weiter.
- **Eine neue Regel muss etwas hinzufügen**: Wählen Sie mindestens einen Eigentümer oder eine Beschriftung, oder schalten Sie einen Schalter ein.
- **Eigentümer benachrichtigen**, unter **Weitere Felder** einer Eigentümerregel, entscheidet, ob die hinzugefügten Personen informiert werden.

[Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules) behandelt das Formular Schritt für Schritt, für jede Art von Ressource.

## Runbook-Regeln

**Runbook-Regeln** starten ein Runbook, wenn ein neues Ereignis passt, etwa eine Checkliste vor jedem Datenbank-Upgrade. Sie passen auf dieselben Dinge wie Eigentümer- und Beschriftungsregeln; Ereignisse haben keinen Schweregrad, deshalb bieten Runbook-Regeln für die Wartung keinen an. Der Lauf wird dem Ereignis zugeordnet, auf seiner Seite **Runbooks**. Siehe [Runbook-Regeln](/docs/runbooks/rules).

## Erinnerungsregeln

**Geplante Wartung → Regeln → Erinnerungsregeln** erinnert die Eigentümer eines Ereignisses, bis die Arbeit abgenommen ist. Jedes Ereignis erhält die erste passende Regel, von oben nach unten in der Liste.

:::steps
### Wählen, an welche Ereignisse erinnert wird

Klicken Sie auf **Erinnerungsregel für geplante Wartungen erstellen**. Lassen Sie unter **Übereinstimmung** die Auswahl **Alle geplanten Wartungsereignisse** stehen, um an jedes Ereignis zu erinnern, oder wählen Sie **Nur geplante Wartungsereignisse, die den Bedingungen entsprechen** und dann die **Beschriftungen**, für die sie gilt.

### Das Intervall festlegen

Legen Sie unter **Erinnerungen** das **Erinnerungsintervall (Minuten)** fest, wie oft die Eigentümer erinnert werden, und wählen Sie unter **Eigentümer erinnern**, wann erinnert wird. Ihr **Name** folgt beidem, etwa „Alle 30 Minuten erinnern, solange es läuft“, bis Sie einen eigenen eingeben, und eine **Beschreibung** wartet unter **Weitere Felder**. Erstellen Sie dann die Regel.
:::

| Antwort | Wann die Eigentümer erinnert werden |
| --- | --- |
| **Während es läuft** | Vom Beginn des Ereignisses bis zu seinem Ende. Eine neue Regel beginnt mit dieser Antwort. |
| **Vor dem Beginn** | Ab der Planung des Ereignisses bis zu seinem Beginn. |
| **Vor dem Beginn und während es läuft** | Ab der Planung des Ereignisses bis zu seinem Ende. |

Die API und Terraform lehnen eine Regel ab, die auf den Beginn des Ereignisses warten und beim Beginn aufhören würde: Sie würde nie eine Erinnerung senden. Eine ältere, so gespeicherte Regel ist in der Liste mit **Erinnert nie** markiert, und ihr Formular bittet Sie zu wählen, wann erinnert werden soll.

Eigentümer erhalten jede Erinnerung als **Wartungserinnerung**, die für jedes neue Mitglied per E-Mail eingeschaltet ist. Das Speichern, Ändern oder Löschen einer Erinnerungsregel ordnet jedes noch nicht abgeschlossene Ereignis neu zu. Um die Erinnerungen für ein Ereignis zu stoppen, schalten Sie **Erinnerungen senden** auf seiner Seite **Einstellungen** aus; es speichert, sobald Sie den Schalter umlegen.

Diese Erinnerungen sind für Ihr Team. Die Erinnerungen, die die Abonnenten Ihrer Statusseiten vor dem Beginn eines Ereignisses erhalten, legen Sie am Ereignis selbst fest, unter **Erinnerungen vor dem Ereignis**.

## Einstellungen

### Notizvorlagen

**Geplante Wartung → Einstellungen → Notiz-Vorlagen** enthält vorgefertigte Texte für Wartungs-Updates. Die Karte **Vorlagen für öffentliche oder private Notizen für geplante Wartungsereignisse** listet sie auf; **Notizvorlage für geplante Wartungen erstellen** fragt nach einem **Vorlagenname**, einer **Vorlagenbeschreibung** und der **Notiz**. Eine Vorlage wird angeboten, wenn jemand eine öffentliche oder private Notiz zu einem Ereignis schreibt und wenn jemand seinen Status ändert, und ihr Text lässt sich vor dem Posten bearbeiten. Anders als Notizvorlagen für Vorfälle füllen Notizvorlagen für Wartungen keine Variablen aus.

### Benutzerdefinierte Felder

**Geplante Wartung → Einstellungen → Benutzerdefinierte Felder** fügt jedem Ereignis eigene Felder hinzu, etwa ein Änderungsticket oder eine Kundenstufe. Füllen Sie sie auf der Seite **Benutzerdefinierte Felder** eines Ereignisses aus oder über die API als `customFields`. Ein Feld kann seinen Wert aus einem benutzerdefinierten Feld eines Monitors übernehmen, statt eingetippt zu werden: siehe [Aus einem Monitor kopierte Felder](/docs/incidents/settings#von-einem-monitor-kopierte-felder), was für Ereignisse genauso funktioniert.

### Messungen

**Geplante Wartung → Einstellungen → Messungen** misst, wie lange Dinge bei jedem Ereignis dauern. Wählen Sie **Startverzögerung**, vom geplanten Beginn bis zum tatsächlichen Beginn, **Überziehung**, vom geplanten Ende bis zum tatsächlichen Ende, oder **Wartungsdauer**, vom Beginn bis zum Ende; oder zwei eigene Momente mit **Etwas anderes**. Jede Messung wird auf der Seite des Ereignisses angezeigt und als `oneuptime.scheduled-maintenance.measurement.<key>` als Diagramm dargestellt. Siehe [Messungen](/docs/incidents/settings#messungen), was für Ereignisse genauso funktioniert.

### Nummerierung

**Geplante Wartung → Einstellungen → Nummerierung** legt den Text vor den Ereignisnummern fest: `SM-` in einem neuen Projekt, oder `#` ohne Präfix. **Aktualisieren** fragt nach dem **Nummernpräfix der geplanten Wartung** und zeigt die Nummer während der Eingabe in einer Vorschau. Nur danach erstellte Ereignisse erhalten das neue Präfix; bestehende behalten ihre Nummern. Die Regeln für ein Präfix stehen unter [Nummernpräfixe](/docs/incidents/settings#nummernpräfixe).

Die Karte **Nächste Nummer** darunter legt die Nummer fest, die das nächste Ereignis bekommt, um die Nummern eines anderen Tools fortzusetzen: **Aktualisieren** öffnet **Nächste Nummer der geplanten Wartung**, die höher sein muss als die bisher höchste. Siehe [Nächste Nummern](/docs/incidents/settings#nächste-nummern).

> [!NOTE]
> In OneUptime Cloud erfordern benutzerdefinierte Felder den Plan **Growth** oder höher, ebenso das Hinzufügen und Ändern von Wartungsstatus und Vorlagen.

## Workflows

Jedes Wartungsmodell hat Workflow-Trigger und -Aktionen, nach ihm benannt: **On Create Scheduled Maintenance Event**, **On Update Scheduled Maintenance Event**, **On Create or Update Scheduled Maintenance Event** und **On Delete Scheduled Maintenance Event**, dasselbe für **Scheduled Maintenance State Timeline** und die anderen, und Aktionen wie **Create One Scheduled Maintenance Event** und **Update One Scheduled Maintenance Event**. Definitionen benutzerdefinierter Felder und Messwerte sind die Ausnahmen: Sie haben keine Workflow-Schritte. Siehe [Workflows – Übersicht](/docs/workflows/index).

## Wer sie ändern darf

| Rolle                             | Was sie darf                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Wartungs-Betrachter**  | Liest Ereignisse und ändert nichts.                                                                  |
| **Wartungs-Mitglied**  | Erstellt, ändert und löscht Ereignisse mit ihren Notizen, Zustands-Zeitachsen und Eigentümern sowie beide Arten von Vorlagen. |
| **Wartungs-Administrator**   | Alles, was ein Mitglied darf, und erstellt, ändert und löscht zusätzlich Wartungsstatus.             |

Regeln, benutzerdefinierte Felder und Messungen erfordern **Projektinhaber** oder **Projektadministrator** oder eine benutzerdefinierte Rolle mit der eigenen Berechtigung dieser Seite, etwa **Create Scheduled Maintenance Owner Rule**. Runbook-Regeln akzeptieren auch **Runbook-Administrator**. **Projektmitglied** arbeitet mit Ereignissen und Vorlagen, wie **Wartungs-Mitglied**. Siehe [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

## Fehlerbehebung

:::details Eine Eigentümerregel hat einem neuen Ereignis niemanden hinzugefügt
Öffnen Sie die Regel und prüfen Sie ihre Bedingungen: Jede ausgefüllte Bedingung muss zutreffen. Ein Titelmuster ist ein regulärer Ausdruck, daher passt `db upgrade` nicht auf „DB-Upgrade“; schreiben Sie `db.upgrade`. Eine Regel wirkt außerdem nur auf Ereignisse, die nach ihrem Speichern erstellt werden: Nutzen Sie **Jetzt ausführen** für die, die Sie schon haben.
:::

:::details Eigentümer haben keine Erinnerung erhalten
Prüfen Sie, ob eine Erinnerungsregel auf die Beschriftungen des Ereignisses passt, ob **Erinnerungen senden** beim Ereignis eingeschaltet ist und ob **Wartungserinnerung** in den Benachrichtigungseinstellungen der Eigentümer eingeschaltet ist. Eine Regel mit **Während es läuft** sendet vor dem Beginn des Ereignisses nichts.
:::

## Nächste Schritte

:::cards
- [Wartungsstatus](/docs/scheduled-maintenance/states): Die Seite Ereignisstatus und was jeder Status bewirkt.
- [Vorlagen & wiederkehrende Ereignisse](/docs/scheduled-maintenance/templates): Die Seite Ereignis-Vorlagen im Detail.
- [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules): Das Regelformular, Schritt für Schritt.
- [Benachrichtigungseinstellungen](/docs/notifications/notification-settings): Wie jeder Eigentümer wählt, was ihn erreicht.
:::
