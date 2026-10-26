# Postmortem-Analysen

Ein Postmortem ist die Aufarbeitung nach einem Vorfall: was passiert ist, warum, was es Ihre Nutzer gekostet hat und was sich jetzt ändert. In OneUptime schreiben Sie es direkt am Vorfall. Es kann mit Ihrer eigenen Vorlage oder einem Entwurf von OneUptime AI beginnen, und es kann auf Ihrer Statusseite als abschließendes Update des Vorfalls veröffentlicht werden. Jedes Postmortem hat außerdem einen Status, und **Vorfälle → Postmortem-Analysen** listet das Postmortem jedes Vorfalls auf, damit Sie sehen, welche noch ausstehen.

:::cards
- [Ein Postmortem schreiben](#ein-postmortem-schreiben): Auf der Postmortem-Seite des Vorfalls, in fünf Schritten.
- [Mit einer Vorlage oder einem KI-Entwurf beginnen](#mit-einer-vorlage-oder-einem-ki-entwurf-beginnen): Ihre Gliederung oder eine, die OneUptime AI ausfüllt.
- [Es auf Ihrer Statusseite veröffentlichen](#es-auf-ihrer-statusseite-veröffentlichen): Es Kunden zeigen und Abonnenten einmal informieren.
- [Verfolgen, wo jedes Postmortem steht](#verfolgen-wo-jedes-postmortem-steht): Nicht gestartet, Entwurf, Abgeschlossen oder ein eigener Status.
- [Alle Postmortems sehen](#alle-postmortems-sehen): Nach Eigentümer, Schweregrad und Status filtern, um die noch ausstehenden zu finden.
- [Postmortems von Episoden](#postmortems-von-episoden): Eine Aufarbeitung für eine Gruppe von Vorfällen.
:::

## Wie ein Postmortem entsteht

Ein Postmortem hat drei Teile, alle am Vorfall: die Notiz, in Markdown geschrieben; ihre Anhänge, etwa Screenshots und Berichte; und ob es auf Ihrer Statusseite steht. Sie finden sie auf der Seite **Postmortem** des Vorfalls, unter **Untersuchung** in seinem Seitenmenü. Ein Postmortem hat außerdem einen Status, der sagt, wie weit es ist, und Eigentümer: die Eigentümer des Vorfalls.

```mermaid title="Von einem behobenen Vorfall zu einem veröffentlichten Postmortem"
flowchart TB
    R["Der Vorfall ist behoben"] --> A["OneUptime AI entwirft es,<br/>wenn Entwürfe an sind"]
    R --> W["Oder Sie beginnen: leer,<br/>mit Vorlage oder KI"]
    A --> E["Ihr Team bearbeitet es"]
    W --> E
    E --> P{"Auf der Statusseite<br/>veröffentlichen?"}
    P -->|"Ja"| S["Die Statusseite zeigt es"]
    S --> N["Abonnenten erfahren<br/>es einmal"]
    P -->|"Nein"| K["Es bleibt bei Ihrem Team"]
```

## Ein Postmortem schreiben

:::steps
### Das Postmortem öffnen

Öffnen Sie den Vorfall und klicken Sie in seinem Seitenmenü unter **Untersuchung** auf **Postmortem**. Die Karte **Postmortem** zeigt **Status** und **Eigentümer** des Postmortems, die Notiz, die Anhänge und ob das Postmortem auf der Statusseite steht. **Eigentümer hinzufügen** neben den Eigentümern macht eine Person oder ein Team Ihres Projekts direkt dort zum Eigentümer des Vorfalls.

### Auf Postmortem schreiben klicken

Der Dialog **Postmortem schreiben** öffnet sich mit seinem ersten Schritt, **Postmortem**. Sobald das Postmortem geschrieben ist, heißt die Schaltfläche der Karte **Postmortem-Notiz bearbeiten** und öffnet dieselben Schritte.

### Die Notiz schreiben und Dateien anhängen

Schreiben Sie die **Postmortem-Notiz** in Markdown: was passiert ist, die Auswirkungen, wie es behoben wurde und die Folgemaßnahmen. Fügen Sie Screenshots, Berichte oder Zeitleisten unter **Postmortem-Anhänge** hinzu.

### Entscheiden, ob es veröffentlicht wird

Klicken Sie auf **Weiter**. Im Schritt **Statusseite** ist **Auf Statusseite veröffentlichen** aus, das Postmortem bleibt also bei Ihrem Team. Um es Kunden zu zeigen, siehe [Es auf Ihrer Statusseite veröffentlichen](#es-auf-ihrer-statusseite-veröffentlichen).

### Das Postmortem speichern

Klicken Sie auf **Änderungen speichern**. Die Karte zeigt die Notiz und die Anhänge. Der Status des Postmortems wechselt von **Nicht gestartet** zu **Entwurf**: siehe [Wie sich ein Postmortem bewegt](#wie-sich-ein-postmortem-bewegt).
:::

Jede Änderung der Notiz wird im Feed des Vorfalls festgehalten und im Slack- oder Microsoft Teams-Kanal des Vorfalls gepostet, wenn er einen hat. Solange das Postmortem nicht veröffentlicht ist, erfährt kein Abonnent der Statusseite davon.

Ein Postmortem schreiben können die Rollen Project Owner, Project Admin, Project Member, Incident Admin oder Incident Member oder eine benutzerdefinierte Rolle mit der Berechtigung Edit Incident. Wer den Vorfall lesen kann, kann auch sein Postmortem lesen.

## Mit einer Vorlage oder einem KI-Entwurf beginnen

Zwei Schaltflächen füllen die Notiz für Sie aus. Solange nichts geschrieben ist, stehen sie neben **Postmortem schreiben**: **Mit Vorlage beginnen**, sobald das Projekt eine Postmortem-Vorlage hat, und **Mit KI generieren**. Sobald das Postmortem geschrieben ist, finden Sie sie im Menü **⋯** neben **Postmortem-Notiz bearbeiten**, als **Vorlage anwenden** und **Mit KI generieren**. Beide öffnen denselben Editor, mit ausgefüllter Notiz und dem Rest des Postmortems unverändert. Nichts wird gespeichert, bis Sie auf **Änderungen speichern** klicken, lesen und ändern Sie die Notiz also vorher.

### Eine Vorlage anwenden

**Vorlage anwenden** erscheint, sobald das Projekt eine Postmortem-Vorlage hat. Vorlagen legen Sie unter **Vorfälle → Einstellungen → Postmortem-Vorlagen** an: siehe [Postmortem-Vorlagen](/docs/incidents/settings#postmortem-vorlagen). In OneUptime Cloud erfordern Vorlagen den Growth-Plan.

Klicken Sie auf **Mit Vorlage beginnen** oder auf **Vorlage anwenden** im Menü **⋯**, wählen Sie im Dialog **Postmortem-Vorlage anwenden** unter **Vorlage auswählen** eine aus und klicken Sie auf **Vorlage anwenden**. Hat das Projekt nur eine Vorlage, ist sie bereits ausgewählt.

### Mit KI generieren

Klicken Sie auf **Mit KI generieren**. Der Dialog **Postmortem mit KI generieren** bietet unter **Vorlage auswählen** eine Gliederung an: **Standard Postmortem**, **Detailed Technical Postmortem** oder **Brief Postmortem**, danach Ihre eigenen Postmortem-Vorlagen. **Vorlagenvorschau** zeigt die Gliederung, und Sie können sie vor dem Generieren ändern.

Klicken Sie unten im Dialog auf **Mit KI generieren**. OneUptime AI liest den Vorfall (seine Beschreibung, Ursache und Behebung, seine Status-Zeitachse, seine öffentlichen und privaten Notizen, die Nachrichten in seinem Slack- oder Microsoft Teams-Kanal und was in [seinen Anrufen](/docs/workspace-connections/video-calls#anruf-transkripte) gesagt wurde) und schreibt das Postmortem in Ihrer Gliederung. Danach öffnet sich der Editor damit.

Das Generieren erfordert, dass KI für das Projekt eingeschaltet ist, unter **Projekteinstellungen → KI → KI-Funktionen**, und einen LLM-Anbieter: siehe [LLM-Anbieter](/docs/ai/llm-provider). Außerdem erfordert es die Rolle Project Owner oder Project Admin oder eine benutzerdefinierte Rolle mit der Berechtigung Edit Incident: Andere Rollen können das Postmortem schreiben, aber nicht generieren.

### OneUptime AI den Entwurf schreiben lassen, wenn ein Vorfall behoben wird

Ist **Postmortem entwerfen, wenn ein Vorfall gelöst wird** eingeschaltet, entwirft OneUptime AI das Postmortem jedes Mal, wenn ein Vorfall behoben wird, speichert es als Notiz und postet es zur Prüfung durch Ihr Team im Feed des Vorfalls. Der Schalter ist unter **Vorfälle → KI → Einstellungen**, und er ist bei neuen Projekten eingeschaltet.

- Er ersetzt nie eine Notiz, die schon geschrieben ist.
- Er schreibt nie in ein Postmortem, das schon veröffentlicht ist, wo der Entwurf ungeprüft auf die Statusseite käme.
- Er erfordert, dass KI für das Projekt eingeschaltet ist, und hält für den Tag an, sobald das Projekt seine täglichen KI-Limits erreicht. Siehe [Auto-Postmortem](/docs/ai/ai-sre#automatisches-postmortem).
- Ist das Transkript des Anrufs zum Vorfall noch unterwegs, wenn der Vorfall behoben wird, wartet er, bis OneUptime AI es gelesen hat, damit der Entwurf berücksichtigt, was im Anruf gesagt wurde: bis zu sechs Stunden, während der Anbieter das Transkript vorbereitet. Siehe [Jeden Anruf aufzeichnen und transkribieren](/docs/workspace-connections/video-calls#jeden-anruf-aufzeichnen-und-transkribieren).

#### Festlegen, welche Vorfälle einen Entwurf erhalten, und mit welcher Vorlage

Ohne Regel erhält jeder gelöste Vorfall einen Entwurf in der Standardgliederung von OneUptime AI. **Postmortem-Regeln** unter **Weitere Einstellungen** auf derselben Seite ändern das:

- Eine Regel passt auf **Alle Vorfälle** oder auf **Nur Vorfälle, die den Bedingungen entsprechen** zu Monitoren, Schweregraden, Labels, Monitor-Labels, Titel und Beschreibung, so wie eine KI-Regel.
- Ihre **Vorlagen** sind die Postmortem-Vorlagen, denen der Entwurf folgen darf. Ohne Vorlage folgt der Entwurf der Standardgliederung; mit einer dieser Vorlage; mit mehreren der, die nach Einschätzung von OneUptime AI am besten zum Vorfall passt. Der Beitrag des Entwurfs im Feed nennt die Vorlage, der er gefolgt ist.
- Ihr **LLM-Anbieter** unter **Weitere Felder** ist der Anbieter, mit dem OneUptime AI den Entwurf schreibt und seine Vorlage wählt. Ist keiner ausgewählt, ist es der Standardanbieter des Projekts, sonst der globale. Der Beitrag des Entwurfs im Feed nennt den Anbieter, den eine Regel gewählt hat, oder den, der stattdessen genutzt wurde, und warum. Siehe [Welchen LLM-Anbieter eine Regel nutzt](/docs/ai/ai-sre#welchen-llm-anbieter-eine-regel-nutzt).
- Es entscheidet die erste aktivierte Regel, die auf den Vorfall passt, von oben in der Liste gezählt: Ziehen Sie eine Regel, um ihre Position zu ändern. Ein Vorfall, auf den keine Regel passt, erhält keinen Entwurf, und solange sich die Regeln nicht lesen lassen, erhält ihn kein Vorfall.
- **Postmortem entwerfen, wenn ein Vorfall gelöst wird** bleibt der einzige Schalter, der Entwürfe ausschaltet. Regeln entscheiden nur über die Entwürfe, die OneUptime AI von sich aus schreibt: **Mit KI generieren** bietet jede Gliederung an, was auch immer sie sagen.
- Regeln anlegen, bearbeiten und umsortieren erfordert die Rolle Project Owner oder Project Admin. In OneUptime Cloud erfordern Vorlagen den Growth-Plan: Darunter entscheiden Regeln weiterhin, welche Vorfälle einen Entwurf erhalten, und jeder Entwurf folgt der Standardgliederung.

## Es auf Ihrer Statusseite veröffentlichen

Ein veröffentlichtes Postmortem ist das abschließende Update des Vorfalls für Ihre Kunden: Die Statusseite zeigt die Notiz, hervorgehoben in der Zeitleiste des Vorfalls, mit ihren Anhängen zum Herunterladen.

:::steps
### Den Schritt Statusseite öffnen

Klicken Sie auf **Postmortem-Notiz bearbeiten**, dann auf **Weiter**, um zum Schritt **Statusseite** zu gelangen.

### Auf Statusseite veröffentlichen einschalten

Schalten Sie **Auf Statusseite veröffentlichen** ein. Zwei weitere Felder erscheinen: **Abonnenten benachrichtigen**, das eingeschaltet ist, und **Postmortem veröffentlicht am**, das auf jetzt steht.

### Entscheiden, wer informiert wird und wann es erscheint

Schalten Sie **Abonnenten benachrichtigen** aus, um zu veröffentlichen, ohne Abonnenten zu informieren. Ändern Sie **Postmortem veröffentlicht am**, um neben dem Postmortem eine andere Zeit anzuzeigen.

### Veröffentlichen

Klicken Sie auf **Änderungen speichern**. Die Karte zeigt jetzt **Postmortem auf der Statusseite sichtbar?**, **Abonnenten benachrichtigen**, **Abonnenten-Benachrichtigungsstatus** und **Postmortem veröffentlicht am**.
:::

Was entscheidet, ob Kunden es sehen und davon erfahren:

- **Der Vorfall muss auf der Statusseite stehen.** Eine Statusseite zeigt ein Postmortem nur bei einem Vorfall, den sie anzeigt: **Auf Statusseite sichtbar** eingeschaltet, und der Vorfall nicht privat.
- **Die Notiz muss etwas sagen.** Ein Postmortem, das mit leerer Notiz veröffentlicht wird, wird nicht angezeigt, und niemand wird informiert.
- **Abonnenten werden einmal informiert**, wenn die Statusseite das Postmortem zum ersten Mal zeigt. Erneutes Speichern oder Bearbeiten, während es veröffentlicht ist, aktualisiert die Seite und informiert niemanden. Wird es von der Seite genommen und erneut veröffentlicht, werden sie erneut informiert. Eines, das veröffentlicht wird, während sein Vorfall verborgen ist, wird gesendet, wenn der Vorfall sichtbar gemacht wird.
- **Abonnenten benachrichtigen wird gelesen, wenn die Benachrichtigung hinausgeht.** Es nach der Veröffentlichung einzuschalten, sendet nichts.

**Abonnenten-Benachrichtigungsstatus** zeigt, ob die Benachrichtigung hinausgegangen ist, und bietet **Wiederholen** an, wenn sie fehlgeschlagen ist. Siehe [Das Postmortem](/docs/status-pages/subscribers#das-postmortem) für jeden Fall und [Erneut versuchen und erneut senden](/docs/status-pages/subscribers#wiederholen-und-erneut-senden).

**Postmortem veröffentlicht am** ist auch der Zeitpunkt, zu dem das Postmortem für die Messung **Zeit bis zum Postmortem** als veröffentlicht gilt: siehe [Vorgefertigte Messungen](/docs/incidents/settings#vorgefertigte-messungen).

## Verfolgen, wo jedes Postmortem steht

Das Postmortem jedes Vorfalls hat einen der Postmortem-Status des Projekts, angezeigt unter **Status** oben auf seiner Karte **Postmortem**. Ein neues Projekt hat vier. Ein Postmortem in **Nicht gestartet** oder **Entwurf** steht noch aus, eines in **Abgeschlossen** oder **Nicht erforderlich** nicht:

| Status | Was er bedeutet | Steht noch aus |
| --- | --- | --- |
| **Nicht gestartet** | Dieses Postmortem hat noch niemand geschrieben. | Ja |
| **Entwurf** | Das Postmortem wird geschrieben. | Ja |
| **Abgeschlossen** | Das Postmortem ist geschrieben und fertig. | Nein |
| **Nicht erforderlich** | Dieser Vorfall braucht kein Postmortem. | Nein |

### Wie sich ein Postmortem bewegt

OneUptime verschiebt ein Postmortem in drei Momenten von selbst:

- Das Postmortem eines neuen Vorfalls beginnt in **Nicht gestartet**, in **Entwurf**, wenn der Vorfall mit einer Notiz gemeldet wird, oder in **Abgeschlossen**, wenn diese Notiz gleich mit veröffentlicht wird.
- Die erste Notiz eines Postmortems in **Nicht gestartet** verschiebt es nach **Entwurf**, ob jemand sie schreibt, eine Vorlage anwendet oder OneUptime AI sie entwirft.
- Die Veröffentlichung auf der Statusseite verschiebt es nach **Abgeschlossen**, sofern es nicht schon fertig ist.

Es bewegt sich nie zurück: Die Notiz zu leeren oder das Postmortem von der Statusseite zu nehmen, lässt seinen Status, wo er ist. Ein Status, den jemand im selben Speichervorgang wählt, gilt immer.

### Selbst verschieben

Klicken Sie auf den Status, auf der Seite **Postmortem** des Vorfalls oder in seiner Zeile der Postmortem-Liste, und wählen Sie einen unter **Postmortem verschieben nach**. Das Postmortem wird sofort verschoben. Ein Postmortem zu verschieben erfordert die Rollen, die eines schreiben, und jeder, der den Vorfall lesen kann, sieht, wo sein Postmortem steht.

### Eigene Status anlegen

Hat Ihr Prozess einen eigenen Schritt, etwa eine Prüfung, legen Sie einen Status dafür an. Öffnen Sie **Vorfälle → Einstellungen → Postmortem-Status**, klicken Sie auf **Postmortem-Status erstellen** und geben Sie ihm einen Namen, etwa **In Prüfung**, eine Farbe und eine Beschreibung. Ein neuer Status kommt direkt über **Abgeschlossen**; ziehen Sie einen Status, um seine Position zu ändern.

Die Position eines Status bestimmt, als was er zählt, angezeigt unter **Zählt als**: über **Entwurf** als **Nicht gestartet**, ab **Entwurf** abwärts als **Läuft gerade**, ab **Abgeschlossen** abwärts als **Fertig**, und dann steht er nicht mehr aus. **In Prüfung**, dazwischen, steht noch aus; **Nicht erforderlich**, unter **Abgeschlossen**, nicht.

**Nicht gestartet**, **Entwurf** und **Abgeschlossen** sind vordefiniert, weil OneUptime Postmortems in sie verschiebt: Sie können sie umbenennen und umfärben, aber nicht löschen oder archivieren, und sie behalten ihre Reihenfolge. Archivieren Sie einen Status, den Sie nicht mehr nutzen, über das Menü **⋯** seiner Zeile: Niemand kann ein Postmortem mehr dorthin verschieben, die Postmortems darin bleiben, bis jemand sie verschiebt, und die Liste filtert weiterhin danach. **Archivierte Postmortem-Status**, eingeklappt unter der Tabelle, listet sie auf, mit **Aus Archiv entfernen**, um einen zurückzuholen. Status anzulegen, zu bearbeiten und zu löschen erfordert die Rolle Project Owner, Project Admin oder Incident Admin oder eine benutzerdefinierte Rolle mit der passenden Berechtigung für Postmortem-Status.

## Alle Postmortems sehen

**Vorfälle → Postmortem-Analysen** listet das Postmortem jedes Vorfalls im Projekt auf, das neueste zuerst, mit den Spalten **Vorfall**, **Titel**, **Postmortem-Status**, **Schweregrad**, **Eigentümer** und **Erklärt**. **Anzeigen** in einer Zeile öffnet die Seite **Postmortem** des Vorfalls.

Über der Liste zählt eine Kachel pro Status die Postmortems darin. Klicken Sie auf eine Kachel, um nur diese aufzulisten, und erneut, um wieder alle aufzulisten.

Filtern Sie die Liste mit den Chips darüber: **Eigentümer**, eine Person oder ein Team; **Schweregrad**; **Postmortem-Status**; **Vorfallsstatus**; **Beschriftungen**; und **Betroffene Ressourcen**. Um zu sehen, welche Postmortems ein Team für Ihre schwersten Vorfälle noch schuldet, wählen Sie das Team unter **Eigentümer**, den Schweregrad unter **Schweregrad** und **Nicht gestartet** und **Entwurf** unter **Postmortem-Status**. Die Filter stehen in der Adresse der Seite, sodass Sie die Liste als Lesezeichen speichern oder teilen können.

Um viele auf einmal zu ändern, wählen Sie sie aus und öffnen Sie **Massenaktionen**: **Postmortem-Status ändern** verschiebt sie alle in einen Status, etwa **Nicht erforderlich** für Vorfälle, die keines brauchen, und **Eigentümer hinzufügen** und **Eigentümer entfernen** ändern, wem sie gehören.

## Postmortems von Episoden

Eine Vorfallepisode hat ebenfalls eine Seite **Postmortem**, unter **Untersuchung**: eine Aufarbeitung für jeden Vorfall der Episode. Klicken Sie auf **Postmortem bearbeiten**, um sie zu schreiben. **Vorlage anwenden** und **Mit KI generieren** funktionieren wie bei einem Vorfall, und die KI liest die Episode und ihre zugehörigen Vorfälle.

Das Postmortem einer Episode ist nur die Notiz: Es hat keine Anhänge, und keine Statusseite zeigt es. OneUptime AI entwirft keines von selbst, wenn eine Episode behoben wird. Das Generieren erfordert die Rolle Project Owner oder Project Admin oder eine benutzerdefinierte Rolle mit der Berechtigung Edit Incident Episode. Es hat auch keinen Status, und die Postmortem-Liste lässt es aus.

Warnungen und geplante Wartungsereignisse haben kein Postmortem.

## Über die API

Ein Postmortem ist eine Gruppe von Feldern am Vorfall, gelesen und geschrieben über `/api/incident` wie der Rest des Vorfalls:

| Feld | Was es ist |
| --- | --- |
| `postmortemNote` | Die Notiz, in Markdown. |
| `showPostmortemOnStatusPage` | Ob das Postmortem auf Ihren Statusseiten veröffentlicht ist. Beginnt mit `false`. |
| `notifySubscribersOnPostmortemPublished` | Ob Abonnenten informiert werden, wenn es veröffentlicht wird. Beginnt mit `true`. |
| `postmortemPostedAt` | Die Zeit, die die Statusseite daneben anzeigt. |
| `postmortemStatusId` | Der Status des Postmortems: einer der Status des Projekts, unter `/api/incident-postmortem-status`. |

`showPostmortemOnStatusPage` als `true` über eine geschriebene `postmortemNote` zu schreiben, veröffentlicht das Postmortem, wie es der Dialog tut. Das verschiebt das Postmortem außerdem nach **Abgeschlossen**, sofern derselbe Schreibvorgang nicht `postmortemStatusId` setzt.

## Fehlerbehebung

:::details Vorlage anwenden fehlt auf der Karte
Das Projekt hat noch keine Postmortem-Vorlage, oder Ihre Rolle kann sie nicht lesen. Legen Sie eine unter **Vorfälle → Einstellungen → Postmortem-Vorlagen** an. In OneUptime Cloud erfordern Vorlagen den Growth-Plan.
:::

:::details Mit KI generieren meldet, dass KI aus ist oder Ihnen die Berechtigung fehlt
Schalten Sie KI unter **Projekteinstellungen → KI → KI-Funktionen** ein. Das Generieren erfordert die Rolle Project Owner oder Project Admin oder eine benutzerdefinierte Rolle mit der Berechtigung Edit Incident, auch für jemanden, der das Postmortem bearbeiten kann.
:::

:::details Das Postmortem steht nicht auf der Statusseite
Prüfen Sie drei Dinge: **Auf Statusseite veröffentlichen** ist eingeschaltet, die Notiz ist nicht leer, und der Vorfall wird auf der Statusseite angezeigt (**Auf Statusseite sichtbar** eingeschaltet, und nicht privat).
:::

:::details Abonnenten wurden über das Postmortem nicht informiert
**Abonnenten benachrichtigen** war bei der Veröffentlichung aus, oder der Vorfall ist verborgen: Dann wird es gesendet, sobald der Vorfall sichtbar gemacht wird. **Abonnenten-Benachrichtigungsstatus** auf der Karte sagt, was zutrifft.
:::

:::details Kein KI-Entwurf erschien, als der Vorfall behoben wurde
Der Vorfall hatte bereits eine Notiz, das Postmortem war schon veröffentlicht, keine Postmortem-Regel passte auf ihn, oder **Postmortem entwerfen, wenn ein Vorfall gelöst wird** ist aus. KI muss für das Projekt eingeschaltet sein, und das Projekt darf seine täglichen KI-Limits nicht erreicht haben. Ist das Transkript des Anrufs zum Vorfall noch unterwegs, kommt der Entwurf, sobald OneUptime AI es gelesen hat.
:::

:::details Der Status eines Postmortems hat sich nicht bewegt, als seine Notiz geschrieben wurde
Nur ein Postmortem in **Nicht gestartet** oder in einem eigenen Status über **Entwurf** bewegt sich von selbst, bei seiner ersten Notiz. Eines, das schon in Arbeit oder fertig ist, bleibt, wo es ist, ebenso ein Status, den jemand im selben Speichervorgang gewählt hat. Verschieben Sie es selbst über seinen Status: siehe [Selbst verschieben](#selbst-verschieben).
:::

## Nächste Schritte

:::cards
- [Vorfälle – Übersicht](/docs/incidents/index): Die übrigen Seiten des Vorfalls, vom Deklarieren bis zum Beheben.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings): Postmortem-Vorlagen und die Messung der Zeit bis zum Postmortem.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers): Alles, was eine Statusseite ihren Abonnenten mitteilt.
- [AI SRE](/docs/ai/ai-sre): Was OneUptime AI nach einem Vorfall von selbst tut.
:::
