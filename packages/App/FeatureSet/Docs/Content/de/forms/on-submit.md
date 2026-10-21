# Was eine Einreichung erstellt

Jede Einreichung über ein Formular erstellt einen Datensatz in Ihrem Projekt: einen **Vorfall** oder ein **geplantes Wartungsereignis**. Die Seite **Beim Absenden** eines Formulars zeigt, welches, und wie jedes Feld des neuen Datensatzes gefüllt wird — aus einer Antwort, aus einem Standardwert, aus einer Einstellung, die immer gilt, oder aus der Vorfallsvorlage. **Einstellungen bearbeiten** ändert die Standardwerte und das, was immer gilt.

:::cards
- [Wie aus einer Einreichung ein Vorfall wird](#wie-aus-einer-einreichung-ein-vorfall-wird): Jedes Feld des neuen Vorfalls und woher sein Wert kommt.
- [Wie aus einer Einreichung ein geplantes Wartungsereignis wird](#wie-aus-einer-einreichung-ein-geplantes-wartungsereignis-wird): Dasselbe für eine Wartungsanfrage.
- [Die Einstellungen Beim Absenden](#die-einstellungen-beim-absenden): Standardwerte, was immer angehängt wird, Eigentümer und Veröffentlichung.
- [Die private Notiz](#die-private-notiz): Wer eingereicht hat, und die Antworten, die kein Feld aufnimmt.
:::

## Was beim Absenden passiert

```mermaid title="Von einer Einreichung zu einem Vorfall oder einem Wartungsereignis"
flowchart TB
    submit["Absenden"] --> checks["Schutzmaßnahmen und<br/>Prüfung der Antworten"]
    checks --> fields["Jedes Feld: die Antwort,<br/>sonst die Einstellungen,<br/>sonst die Vorfallsvorlage"]
    fields --> record["Der Vorfall oder das<br/>Wartungsereignis"]
    record --> note["Eine private Notiz: wer eingereicht hat,<br/>und die übrigen Antworten"]
    record --> runs["Regeln, Bereitschaftsrichtlinien<br/>und Workflows laufen"]
```

Eine Einreichung, die eine Prüfung nicht besteht, erstellt nichts. Siehe [Was ein Formular schützt](/docs/forms/sharing-and-security#was-ein-formular-schützt).

## Was jede Einreichung erstellt

Die Karte **Was jede Einreichung erstellt** enthält die Wahl, die Sie beim Anlegen des Formulars getroffen haben:

- **Vorfall** — jede Einreichung meldet einen Vorfall, sodass Ihr Bereitschaftsteam sofort Bescheid bekommt. Nutzen Sie es für Problemmeldungen.
- **Geplante Wartung** — jede Einreichung plant ein Wartungsereignis. Nutzen Sie es für Änderungs- und Wartungsanfragen.

Die andere zu wählen verlangt eine Bestätigung, weil sich das Formular damit ändert:

- Titel, Beschreibung, Monitore und Beschriftungen bleiben verknüpft: Beide Arten von Datensätzen haben sie.
- Jede andere verknüpfte Frage — ein Schweregrad, eine Statusseiten-Auswahl, ein benutzerdefiniertes Feld der alten Art — wird zu einer eigenen Frage des Formulars, mit demselben Wortlaut, deren Antwort auf der privaten Notiz steht.
- Die Einstellungen Beim Absenden beginnen von vorn, denn die Einstellungen eines Vorfalls und eines Ereignisses sind verschieden.
- Ein Formular, das nun Wartungsereignisse erstellt, fragt, wann die Wartung beginnt und endet.

Die Fragen werden sofort gespeichert, zusammen mit der Änderung. Prüfen Sie sie auf der Seite **Erstellen**.

## Wie aus einer Einreichung ein Vorfall wird

Die Karte listet jedes Feld des neuen Vorfalls und woher sein Wert kommt:

| Feld | Kommt aus |
| --- | --- |
| **Titel** | Der Antwort auf die Frage **Titel**. Fragt das Formular sie nicht oder bleibt sie leer: dem **Standardtitel**, sonst dem Namen des Formulars. |
| **Beschreibung** | Der Antwort auf die Frage **Beschreibung**. Wird sie nicht gefragt oder bleibt leer, der Beschreibung der Vorfallsvorlage, falls das Formular eine Vorlage hat. |
| **Schweregrad** | Der Wahl der einreichenden Person, wenn das Formular danach fragt. Sonst der Einstellung **Schweregrad** des Formulars, sonst dem Schweregrad der Vorfallsvorlage. |
| **Monitore** | Den Monitoren, die die einreichende Person gewählt hat, zusammen mit denen, die die Einstellungen immer anhängen. Ohne beides denen der Vorfallsvorlage. |
| **Beschriftungen** | Den Beschriftungen, die die einreichende Person gewählt hat, zusammen mit denen, die die Einstellungen immer hinzufügen. Ohne beides denen der Vorfallsvorlage. |
| **Beginn der Auswirkung** | Der Antwort auf **Beginn der Auswirkung**, wenn das Formular sie fragt. |
| **Vorfallsvorlage** | Der Einstellung **Vorfallsvorlage** des Formulars. Sie füllt aus, was die Antworten und die Einstellungen offen lassen. |
| **Bereitschaftsrichtlinien** | Den Richtlinien, die die Einstellungen nennen, ausgeführt für jeden Vorfall, den das Formular meldet. Ohne welche denen der Vorfallsvorlage. |
| **Eigentümer** | Den Personen und Teams, die die Einstellungen nennen, zusammen mit den Eigentümern der Vorlage. Sie erfahren von jedem Vorfall. |
| **Benutzerdefinierte Felder** | Der Antwort jeder Frage eines benutzerdefinierten Felds — außer das Feld übernimmt seinen Wert aus einem benutzerdefinierten Monitorfeld und die Monitore des Vorfalls haben einen; den Rest füllt die Vorlage. |
| **Statusseiten** | Nie auf Statusseiten gezeigt, und Abonnenten erfahren nichts, bis jemand aus Ihrem Team ihn veröffentlicht. |
| **Weitere Antworten** | Auf einer privaten Notiz am Vorfall aufgeführt, mit der Person, die eingereicht hat. |

> [!IMPORTANT]
> **Kein Schweregrad, kein Vorfall.** Ein Vorfall braucht einen Schweregrad. Fragt das Formular nach keinem, nennen seine Einstellungen keinen — oder wurde der genannte gelöscht — und setzt auch seine Vorlage keinen, warnt Sie die Zeile **Schweregrad**, und jede Einreichung wird mit "Über dieses Formular kann kein Vorfall erstellt werden, weil ihm kein Schweregrad zugewiesen ist. Bitte informieren Sie das Team, das es geteilt hat." abgelehnt. Wählen Sie unter **Einstellungen bearbeiten** einen Schweregrad oder eine Vorlage, die einen setzt.

### Die Vorfallsvorlage

Wählen Sie in den Einstellungen eine **Vorfallsvorlage**, und jeder Vorfall, den das Formular meldet, wird aus ihr gemeldet, so wie der Server eine Vorlage überall anwendet — siehe [Wie eine Vorlage angewendet wird](/docs/incidents/settings#wie-eine-vorlage-angewendet-wird). Die Antworten und die Einstellungen des Formulars haben Vorrang, und die Vorlage füllt alles andere: den Anfangsstatus, die Beschreibung, den Schweregrad, die betroffenen Ressourcen, Bereitschaftsrichtlinien, Eigentümer, Beschriftungen, Werte benutzerdefinierter Felder und eine Änderung des Monitorstatus.

> [!WARNING]
> **Achten Sie auf die Monitore.** Einen Vorfall über ein Formular auf einem Monitor zu melden wirkt auf den Monitor genauso, wie einen Vorfall von Hand auf ihm zu melden: Die aktive Überwachung des Monitors pausiert, bis der Vorfall behoben ist, und **Monitor-Status ändern in** einer Vorlage ändert den Status des Monitors sofort — auf jeder Statusseite, die den Monitor listet, auch solange der Vorfall selbst verborgen ist. Mit einem Formular kann das jeder, der den Link hat. Hängen Sie Monitore über ein Formular nur an, wenn jede Einreichung sie pausieren soll.

### Wie der Vorfall aussieht

Ein über ein Formular gemeldeter Vorfall ist ein gewöhnlicher Vorfall, mit ein paar eigenen Einstellungen:

- **Auf Statusseiten verborgen.** **Auf Statusseite sichtbar** ist aus, ebenso **Statusseiten-Abonnenten benachrichtigen**. Bis ein Responder ihn veröffentlicht, erreicht nichts über den Vorfall eine Statusseite oder einen Abonnenten — außer der Änderung des Monitorstatus durch eine Vorlage, siehe oben.
- **Von niemandem gemeldet.** Die einreichende Person ist kein OneUptime-Benutzer, daher wird kein Benutzer als meldende Person des Vorfalls festgehalten.
- **Seine Eigentümer erfahren davon.** Die Eigentümer, die die Einstellungen und die Vorlage nennen, werden hinzugefügt, sobald die Slack- und Microsoft-Teams-Kanäle des Vorfalls existieren, und benachrichtigt — die Benachrichtigung **Vorfall erstellt** des Vorfalls wartet, bis sie seine Eigentümer sind, und geht so an sie statt an die Eigentümer des Projekts.
- **Eine private Notiz hält die Einreichung fest** — siehe [Die private Notiz](#die-private-notiz).

Alles, was für einen neuen Vorfall läuft, läuft auch für diese: Datenschutz-, Eigentümer-, Beschriftungs-, Bereitschafts- und Runbook-Regeln, Bereitschaftsrichtlinien und Workflows **On Create Incident**. Bereitschaftsregeln treffen auf die Vorfälle eines Formulars wie auf alle anderen zu — auch über ihren Titel und ihre Beschreibung, die die einreichende Person geschrieben hat.

:::steps
#### Lesen, was die einreichende Person geschrieben hat

Titel und Beschreibung erscheinen auf Statusseiten, sobald der Vorfall veröffentlicht ist.

#### Den Vorfall veröffentlichen

Schalten Sie auf der Seite **Einstellungen** des Vorfalls **Auf Statusseite sichtbar** ein.

#### Abonnenten informieren, wenn sie es wissen sollen

Weil der Vorfall mit ausgeschaltetem **Statusseiten-Abonnenten benachrichtigen** gemeldet wurde, sendet seine Veröffentlichung nicht die Benachrichtigung "Vorfall erstellt". Um Abonnenten zu informieren, posten Sie eine öffentliche Notiz mit angehaktem **Statusseiten-Abonnenten benachrichtigen** — siehe [Eine öffentliche Notiz posten](/docs/incidents/notes-owners-and-feed#eine-öffentliche-notiz-posten).
:::

## Wie aus einer Einreichung ein geplantes Wartungsereignis wird

| Feld | Kommt aus |
| --- | --- |
| **Titel** | Der Antwort auf die Frage **Titel**. Fragt das Formular sie nicht oder bleibt sie leer: dem **Standardtitel**, sonst dem Namen des Formulars. |
| **Beschreibung** | Der Antwort auf die Frage **Beschreibung**. |
| **Beginnt am**, **Endet am** | Den Antworten auf **Beginnt am** und **Endet am**, die jedes Wartungsformular fragt und verlangt. Das Ende muss nach dem Beginn liegen. |
| **Monitore** | Den Monitoren, die die einreichende Person gewählt hat, zusammen mit denen, die die Einstellungen immer anhängen. |
| **Statusseiten** | Den Statusseiten, die die einreichende Person gewählt hat, zusammen mit denen, die die Einstellungen nennen. |
| **Beschriftungen** | Den Beschriftungen, die die einreichende Person gewählt hat, zusammen mit denen, die die Einstellungen immer hinzufügen. |
| **Eigentümer** | Den Personen und Teams, die die Einstellungen nennen. Ihnen gehört jedes Ereignis, das das Formular plant. |
| **Auf Statusseiten anzeigen** | **Nein**, außer die Einstellungen schalten es ein. |
| **Abonnenten benachrichtigen** | **Nein**, außer die Einstellungen schalten es ein. |
| **Benutzerdefinierte Felder** | Der Antwort jeder Frage eines benutzerdefinierten Felds — außer das Feld übernimmt seinen Wert aus einem benutzerdefinierten Monitorfeld und die Monitore des Ereignisses haben einen. |
| **Weitere Antworten** | Auf einer privaten Notiz am Ereignis aufgeführt, mit der Person, die eingereicht hat. |

Das Ereignis beginnt im Status **Scheduled** Ihres Projekts und geht weiter wie jedes andere: Es wird laufend, wenn es beginnt, und endet, wenn es endet.

Eine Einreichung ist die Anfrage von jemandem, und eine Anfrage wird geprüft, bevor sie veröffentlicht wird. Daher bleibt das Ereignis, solange Sie es nicht ändern, von seinen Statusseiten fern, bis jemand aus Ihrem Team es zeigt, und seine Abonnenten erfahren nicht, wann es erstellt wird, beginnt oder endet. **Auf Statusseiten anzeigen** und **Abonnenten benachrichtigen** im Schritt **Veröffentlichung** der Einstellungen ändern das für jedes Ereignis, das das Formular plant — schalten Sie sie nur ein, wenn Sie allen mit dem Link vertrauen.

## Die Einstellungen Beim Absenden

**Einstellungen bearbeiten** öffnet die Einstellungen in Schritten: **Weiter** geht weiter, und **Änderungen speichern** ist im letzten Schritt. Jeder Schritt ist schon ausgefüllt, daher öffnet die Schrittliste neben dem Formular jeden davon, auch den letzten: Ändern Sie eine Einstellung in ihrem Schritt, öffnen Sie dann den letzten Schritt und speichern Sie.

| Schritt | Vorfallsformular | Wartungsformular |
| --- | --- | --- |
| **Standardwerte** | **Standardtitel**, **Schweregrad**, **Vorfallsvorlage** | **Standardtitel** |
| **Immer zuordnen** | **Monitore**, **Beschriftungen**, **Bereitschaftsrichtlinien** | **Monitore**, **Statusseiten**, **Beschriftungen** |
| **Eigentümer** | **Eigentümer** | **Eigentümer** |
| **Veröffentlichung** | — | **Auf Statusseiten anzeigen**, **Abonnenten benachrichtigen** |

**Eigentümer** ist eine Auswahl für Personen und Teams: **Eigentümer hinzufügen** öffnet eine Suchliste mit beiden, und jede Wahl erscheint als Chip, den Sie entfernen können. Alles, was die Einstellungen nennen, muss zum Projekt des Formulars gehören, und Eigentümer müssen Mitglieder davon sein. Ein Datensatz, der nach seiner Wahl gelöscht wurde, wird beim Erstellen einer Einreichung übersprungen, und der Rest gilt weiter.

## Die private Notiz

Jede Einreichung hinterlässt eine private Notiz an dem, was sie erstellt hat:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Sie nennt das Formular und die einreichende Person — "Submitted anonymously through the form **Report a Problem**.", wenn das Formular nicht gefragt hat, wer sie ist —, dann, wenn die Einreichung mit einer der Vorlagen des Formulars begann, welche: "Started from the template **Application Outage**." — und listet dann die Antworten auf die eigenen Fragen des Formulars, jede unter ihrer Frage, in der Reihenfolge des Formulars. Die Antworten auf verknüpfte Fragen stehen schon am Datensatz: sein Titel, sein Schweregrad, seine benutzerdefinierten Felder. Weil sie privat ist, erreicht die Notiz nie eine Statusseite, wird aber wie jede andere Notiz in die Slack- und Microsoft-Teams-Kanäle des Datensatzes gepostet.

Die Adresse ist ein Link, der genau an diese Adresse schreibt — im Dashboard, in Slack und in der E-Mail an die Eigentümer.

## Ausgeblendete Fragen und Vorlagen

Eine [ausgeblendete Frage](/docs/forms/building#ausgeblendete-fragen) wird aus der [Vorlage](/docs/forms/building#vorlagen) beantwortet, mit der die Einreichung begann — nie aus der Anfrage —, und ihre Antwort geht genau dorthin, wohin eine getippte ginge: Eine ausgeblendete **Beschreibung** wird zur Beschreibung des Vorfalls, ein ausgeblendetes benutzerdefiniertes Feld zu dessen Wert, eine ausgeblendete eigene Frage des Formulars zu einer Zeile der privaten Notiz. Eine Einreichung, die ohne Vorlage begann, lässt ausgeblendete Fragen unbeantwortet, und ihre Felder werden aus den Einstellungen Beim Absenden gefüllt, wie bei jeder leer gelassenen Frage. Eine Vorlage, die gelöscht wird, während jemand das Formular offen hat, hält dessen Einreichung nicht auf: Sie wird so erstellt, wie die Person geantwortet hat, ohne die ausgeblendeten Antworten der Vorlage.

Eine Vorlage kann die Fragen des Formulars [auf ihre eigene Art](/docs/forms/building#wie-eine-vorlage-jede-frage-stellt) stellen, und der Server bindet die Einreichung an die Fragen so, wie die genannte Vorlage sie stellt. Eine Frage, die die Vorlage ausblendet, wird aus der Vorlage beantwortet, wie eine ausgeblendete Frage, auch wenn das Formular sie stellt; eine, die die Vorlage stellt, wird aus der Anfrage gelesen, auch wenn das Formular sie ausblendet; und eine, die die Vorlage verlangt, muss beantwortet werden, sonst wird die Einreichung abgelehnt und nichts erstellt.

Die Antworten, die eine Vorlage auf der Seite ausgefüllt hat, gehören der einreichenden Person, sobald sie einreicht: Der Server übernimmt die Antworten, die die Anfrage für die Fragen der Seite sendet, was auch immer die Vorlage sagte.

## Text, den eine einreichende Person schreibt

Eine Einreichung geht direkt an Orte, an denen Text von selbst wirken kann — Slack- und Microsoft-Teams-Kanäle, den Browser jedes Responders, die E-Mails der Eigentümer —, und niemand liest ihn vorher. Daher, bevor der Datensatz erstellt wird:

| Was die einreichende Person schreibt | Was gespeichert wird |
| --- | --- |
| Eine Erwähnung, etwa \<!channel\>, \<!here\> oder \<@U0123ABC\>, im Titel, in der Beschreibung oder in einer Textantwort | **Erwähnungen benachrichtigen niemanden.** Alles, was Slack als Erwähnung liest, bekommt nach seiner öffnenden Klammer ein unsichtbares Zeichen. Es liest sich überall gleich, aber kein Chat-Werkzeug reagiert darauf. |
| Ein Bild, in der Beschreibung oder einer Antwort vom Typ **Formatierter Text** | **Bilder werden zu Links.** Jedes Bild wird zu einem Link auf dieselbe Adresse, sodass nichts von wo auch immer die einreichende Person wählte geladen wird, bis ein Responder darauf klickt. |
| Ein Codeblock, dessen Sprache `mermaid` ist, in jeder Schreibweise | **Diagramme werden zu Code.** Er wird als einfacher Code gespeichert und zeigt so seinen Text, statt ein Diagramm zu zeichnen. |
| Bildsyntax oder ein Diagramm-Codeblock im Titel | **Der Titel ist reiner Text.** Auch sie bekommen das unsichtbare Zeichen, sodass der Titel, wo immer er landet — eine Episode, eine Chatnachricht, eine Notizvorlage —, nichts lädt und nichts zeichnet. Die unsichtbaren Zeichen zählen zur Grenze des Titels. |

Alles andere — Links, der Rest des Markdowns, Auswahlen in Auswahllisten, Zahlen, Datumsangaben, ein angehaktes Kästchen — wird so gespeichert, wie die einreichende Person es angegeben hat, und die Einreichung behält Namen und E-Mail der einreichenden Person wie getippt.

## Nächste Schritte

:::cards
- [Ein Formular erstellen](/docs/forms/building): Die Fragen, die diese Felder füllen, ausgeblendete Fragen und Vorlagen.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings): Vorfallsvorlagen und benutzerdefinierte Felder.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed): Private Notizen, öffentliche Notizen und Eigentümer.
- [Teilen & Sicherheit](/docs/forms/sharing-and-security): Wer einreichen kann, und wie oft.
:::
