# Formulare – Übersicht

Ein Formular ist eine Seite, die jeder mit ihrem Link ausfüllen kann, ohne OneUptime-Konto. Jede Einreichung legt etwas in Ihrem Projekt an: einen **Vorfall** für Problemmeldungen oder ein **Ereignis geplanter Wartung** für Änderungs- und Wartungsanfragen. Sie bauen die Fragen des Formulars in einem Drag-and-Drop-Editor, legen fest, wie aus den Antworten der Datensatz wird, und teilen den Link mit den Personen, die es nutzen sollen.

Verwenden Sie ein Formular, wenn die Menschen, die ein Problem bemerken – oder eine Änderung brauchen –, nicht die sind, die Ihre Vorfälle und Wartungen bearbeiten: Support-Mitarbeiter, Kollegen aus einer anderen Abteilung, eine Filialleitung, das Betriebsteam eines Kunden. Sie öffnen den Link, beantworten Ihre Fragen und klicken auf **Senden**. Ihr Team erhält einen gewöhnlichen Vorfall oder ein gewöhnliches Ereignis, mit den Antworten in seinen Feldern und einer privaten Notiz, die festhält, wer es geschickt hat.

:::cards
- [Ihr erstes Formular anlegen](#ihr-erstes-formular-anlegen): Von einem leeren Formular zu einem Link, den Sie teilen können.
- [Ein Formular erstellen](/docs/forms/building): Fragen, Antworttypen, ausgeblendete Fragen, Vorlagen und Branding.
- [Was eine Einreichung erstellt](/docs/forms/on-submit): Wie aus den Antworten und den Einstellungen ein Vorfall oder ein Wartungsereignis wird.
- [Teilen & Sicherheit](/docs/forms/sharing-and-security): Der Link, die IP-Zulassungsliste, Ratenbegrenzungen und Fehlerbehebung.
:::

## So funktioniert ein Formular

```mermaid title="Vom ausgefüllten Formular zum Vorfall oder Wartungsereignis"
flowchart TB
    submitter["Jemand mit dem Link,<br/>ohne Konto"] --> page["Die Seite des Formulars"]
    page -->|Senden| checks["Schutzmaßnahmen und<br/>Prüfung der Antworten"]
    checks --> submission["Einreichung, beim<br/>Formular aufbewahrt"]
    submission --> target{"Jede Einreichung erstellt"}
    target -->|Vorfall| incident["Vorfall, auf Statusseiten<br/>ausgeblendet"]
    target -->|Geplante Wartung| event["Wartungsereignis, ausgeblendet,<br/>sofern nicht anders eingestellt"]
    incident --> response["Bereitschaftsrichtlinien<br/>und Regeln laufen"]
    incident --> note["Private Notiz: wer es geschickt hat,<br/>weitere Antworten"]
    event --> note
```

Jede Anfrage durchläuft zuerst die Schutzmaßnahmen des Formulars: seine eigene Seite, Ratenbegrenzungen, die IP-Zulassungsliste und das Captcha. Eine Einreichung, deren Antworten passen, wird aufbewahrt und legt einen Datensatz an, ausgefüllt aus den Antworten, den Einstellungen unter **Beim Absenden** des Formulars und, bei einem Vorfall, seiner Vorfallsvorlage. Nichts, was sie anlegt, erreicht eine Statusseite, bis Ihr Team es so entscheidet.

## Auf einen Blick

- **Ein eigenes Produkt** – **Formulare** steht im Produktmenü, unter `/dashboard/{projectId}/forms`. Jedes Formular hat einen eigenen Link, etwa `https://oneuptime.com/accounts/form/<share-key>` in OneUptime Cloud.
- **Kein Konto nötig** – jeder mit dem Link kann das Formular öffnen und absenden, ohne sich anzumelden.
- **Ein Editor, keine Einstellungsseite** – fügen Sie eigene Fragen hinzu (kurze Antworten, Absätze, Auswahllisten, Daten, Kontrollkästchen und mehr), die Felder dessen, was das Formular anlegt (Titel, Beschreibung, Schweregrad, Monitore, Beschriftungen, Beginn und Ende), Ihre benutzerdefinierten Felder sowie Namen und E-Mail-Adresse der einreichenden Person. Ziehen Sie sie in die richtige Reihenfolge, sehen Sie sich das Formular in der Vorschau an, speichern Sie.
- **Sie entscheiden, woher jeder Wert kommt** – die Seite **Beim Absenden** listet jedes Feld des neuen Vorfalls oder Ereignisses neben seiner Quelle: einer Antwort, einem Standardwert, einer Einstellung, die immer gilt, oder der Vorfallsvorlage.
- **Ausgeblendet, bis jemand es veröffentlicht** – Vorfälle aus einem Formular werden beim Melden nie auf Statusseiten gezeigt oder an Abonnenten gesendet; Wartungsereignisse ebenfalls nicht, es sei denn, das Formular sagt es.
- **Mehrfach geschützt** – ein Schalter **Nimmt Einreichungen an**, eine optionale **IP-Zulassungsliste**, die Ablehnung von Anfragen anderer Websites, Ratenbegrenzungen, das Captcha der Instanz und Größenbegrenzungen für jede Antwort.
- **Jede Einreichung bleibt erhalten** – die Seite **Einreichungen** jedes Formulars und **Formulare → Einreichungen** für alle Formulare listen die Antworten und verlinken auf das, was jede Einreichung angelegt hat.
- **Ihr eigenes Branding** – laden Sie im Abschnitt **Branding** der Seite **Erstellen** ein Logo für den Kopf der Formularseite und ein Favicon für den Browser-Tab hoch. Bis dahin zeigt das Formular die von OneUptime.
- **Vorlagen für häufige Fälle** – speichern Sie benannte Sätze von Antworten, etwa **Anwendungsausfall** oder **Geplante Wartung**, und die Personen wählen oben im Formular eine aus, um es auszufüllen, oder öffnen ihren eigenen Link. Jede Vorlage kann eine Frage für ihren Fall außerdem erforderlich, optional oder ausgeblendet machen. Ein Formular, und ein Lesezeichen, dient so einem ganzen Team.
- **Ausgeblendete Fragen** – blenden Sie eine Frage aus, die niemand beantworten müssen sollte, etwa die Beschreibung des Vorfalls, und lassen Sie stattdessen jede Vorlage sie beantworten – oder sie stellen, in den Fällen, die sie brauchen.
- **Formular duplizieren** – beginnen Sie ein Formular für ein anderes Team mit einem, das funktioniert, samt Fragen, Vorlagen und Einstellungen.

## Was ein Formular anlegen kann

Wenn Sie ein Formular anlegen, wählen Sie, was **Jede Einreichung erstellt**. Sie können es später auf der Seite **Beim Absenden** des Formulars ändern.

| Jede Einreichung erstellt | Wofür | Was passiert |
| --- | --- | --- |
| **Vorfall** | Problemmeldungen | Ein Vorfall wird sofort gemeldet, sodass Ihre Bereitschaftsrichtlinien und Regeln laufen und die Personen in Bereitschaft informiert werden. Er bleibt von Statusseiten fern, bis ein Bearbeiter ihn veröffentlicht. |
| **Geplante Wartung** | Änderungs- und Wartungsanfragen | Ein Wartungsereignis wird für das Zeitfenster geplant, das die einreichende Person angibt. Sofern das Formular nichts anderes sagt, bleibt es von seinen Statusseiten fern und benachrichtigt keine Abonnenten. |

Formulare beginnen mit diesen beiden, weitere Arten von Datensätzen folgen.

## Bevor Sie beginnen

- **Ein Tarif, der Formulare enthält.** In OneUptime Cloud brauchen Formulare den Tarif **Growth** oder höher. Siehe [Tarif](#tarif).
- **Die Berechtigung, Formulare anzulegen.** **Create Form** haben Projektinhaber und -administratoren sowie die Rollen, denen Sie es geben. Siehe [Berechtigungen](#berechtigungen).
- **Für ein Vorfallsformular einen Schweregrad.** Jeder Vorfall braucht einen: aus einer Frage, aus den Einstellungen des Formulars oder aus seiner Vorfallsvorlage. Ohne ihn wird jede Einreichung abgelehnt. Siehe [Was eine Einreichung erstellt](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Ihr erstes Formular anlegen

:::steps
### Das Formular anlegen

Öffnen Sie **Formulare** im Produktmenü und klicken Sie auf **Formular erstellen**. Geben Sie dem Formular einen Namen – die Überschrift seiner öffentlichen Seite, eindeutig im Projekt –, wählen Sie, was **Jede Einreichung erstellt**, und optional eine Beschreibung in Markdown, die oben auf der öffentlichen Seite erscheint.

### Seine Fragen bauen

Das Formular öffnet sich auf seiner Seite **Erstellen** und fragt bereits nach einem Titel, einer Beschreibung und danach, wer einreicht – und bei einem Wartungsformular, wann die Wartung beginnt und endet. Fügen Sie Fragen hinzu, entfernen und ordnen Sie sie, und klicken Sie dann auf **Änderungen speichern**. Siehe [Ein Formular erstellen](/docs/forms/building).

### Festlegen, was eine Einreichung anlegt

Prüfen Sie unter **Beim Absenden**, wie aus einer Einreichung ein Vorfall oder Ereignis wird, und klicken Sie auf **Einstellungen bearbeiten**, um Standardwerte vorzugeben – einen Schweregrad, eine Vorfallsvorlage, Monitore und Beschriftungen, die immer angehängt werden, Eigentümer, die informiert werden. Siehe [Was eine Einreichung erstellt](/docs/forms/on-submit).

### Vorlagen hinzufügen, wenn dieselben Fälle oft gemeldet werden

Speichern Sie unter **Vorlagen** eine Vorlage für jeden Fall, der oft gemeldet wird: Das Formular listet sie über seinen Fragen, füllt sich aus der gewählten aus und stellt die Fragen so, wie diese Vorlage es sagt – eine Frage, die ein Fall braucht, kann in seiner Vorlage erforderlich und in den anderen ausgeblendet sein. Siehe [Vorlagen](/docs/forms/building#templates).

### Den Link teilen

Kopieren Sie unter **Teilen** den Link und senden Sie ihn an die Personen, die das Formular nutzen sollen. Siehe [Teilen & Sicherheit](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Ein neues Formular **Nimmt Einreichungen an**, sobald es angelegt ist, aber niemand erreicht es, bis Sie seinen Link teilen. Richten Sie zuerst seine Fragen und Schutzmaßnahmen ein.

## Die Seiten eines Formulars

| Seite | Was sie enthält |
| --- | --- |
| **Erstellen** | Name und Beschreibung des Formulars, sein **Branding** – Logo und Favicon, eingeklappt – und den Editor: seine Fragen, die Fragenpalette und **Vorschau**. |
| **Vorlagen** | Benannte Sätze von Antworten, mit denen man das Formular beginnen kann, wie jede die Fragen stellt, die, mit der es sich öffnet, und der eigene Link jeder Vorlage. |
| **Beim Absenden** | Was jede Einreichung anlegt und wie jedes ihrer Felder ausgefüllt wird. **Einstellungen bearbeiten** ändert die Standardwerte und das, was immer gilt. |
| **Teilen** | **Nimmt Einreichungen an**, der **Link zum Teilen**, die Meldung nach dem Absenden und die **IP-Zulassungsliste**. |
| **Einreichungen** | Jede Einreichung über das Formular, die neueste zuerst, mit ihren Antworten und dem, was sie angelegt hat. |
| **Formular duplizieren** | Unter **Erweitert**: eine Kopie des Formulars, für Sie benannt, mit seinen Fragen, Vorlagen, Einstellungen unter Beim Absenden, Branding, Dankesmeldung und IP-Zulassungsliste und einem eigenen Link. Die Kopie ist zunächst ausgeschaltet und öffnet sich in ihrem Editor. |
| **Formular löschen** | Das Löschen des Formulars, unter **Erweitert**. Seine Einreichungen werden mit ihm gelöscht; die Vorfälle und Ereignisse, die es angelegt hat, nicht. |

Der Abschnitt **Entwickler** im Menü des Formulars enthält seine Seiten für Terraform, die API und KI-Assistenten, wie bei jeder anderen Ressource.

## Formulare und Vorfallsvorlagen

Eine Vorlage und ein Formular ersparen Ihnen beide, denselben Vorfall zweimal einzutippen, aber sie dienen unterschiedlichen Menschen:

| | Vorfallsvorlage | Formular |
| --- | --- | --- |
| Wer es nutzt | Ihr Team, bei OneUptime angemeldet | Jeder mit dem Link, ohne Konto |
| Wo | **Aus Vorlage erstellen** in der Vorfallsliste | Eine eigene Seite, unter dem Link des Formulars |
| Was man ändern kann | Jedes Feld des Vorfalls, bevor man ihn meldet | Nur die Antworten auf die Fragen, die Sie gewählt haben |
| Was man sieht | Ihre Monitore, Richtlinien, Eigentümer und jedes Feld | Name, Beschreibung und Fragen des Formulars – und nur die Optionen, die Sie anbieten |
| Statusseiten | Was die Vorlage und das Meldeformular sagen | Ausgeblendet, bis ein Bearbeiter den Vorfall veröffentlicht |

Sie arbeiten zusammen. Geben Sie einem Vorfallsformular auf seiner Seite **Beim Absenden** eine **Vorfallsvorlage**, und jeder Vorfall, den es meldet, wird aus dieser Vorlage gemeldet: Bauen Sie die Vorlage für das, was Ihr Team am Vorfall braucht, und das Formular für das, was Sie die einreichende Person fragen möchten.

## Einreichungen

Die Seite **Einreichungen** eines Formulars listet jede Einreichung darüber, die neueste zuerst, mit **Eingereicht am**, **Eingereicht von** – Name und E-Mail-Adresse, die die einreichende Person angegeben hat, oder **Anonym** – und **Erstellt**, einem Link zum Vorfall oder Ereignis, das sie angelegt hat. **Antworten anzeigen** zeigt jede Antwort so, wie die einreichende Person sie gegeben hat. **Formulare → Einreichungen** listet die Einreichungen aller Formulare im Projekt.

Einreichungen schreibt das Formular, nie eine Person, und sie lassen sich nicht bearbeiten. Das Löschen einer Einreichung entfernt ihre Antworten sowie Namen und E-Mail-Adresse der einreichenden Person aus der Liste; der Vorfall oder das Ereignis, das sie angelegt hat, bleibt, ebenso die private Notiz daran, die die Angaben der einreichenden Person und die Antworten wiederholt. Wird der Vorfall oder das Ereignis gelöscht, bleibt seine Einreichung, und ihre Spalte **Erstellt** zeigt **Inzwischen gelöscht**.

> [!WARNING]
> Wenn Sie personenbezogene Daten von jemandem entfernen, reicht es nicht, die Einreichung zu löschen: Bearbeiten oder löschen Sie auch die private Notiz am Vorfall oder Ereignis, das sie angelegt hat.

## Berechtigungen

Formulare erlauben Menschen außerhalb Ihres Teams, Vorfälle und Wartungsereignisse in Ihrem Projekt anzulegen, daher verwalten sie Projektinhaber und -administratoren sowie die Rollen, denen Sie die Berechtigungen **Form** geben. Sie stehen in der Gruppe **Form** der [Berechtigungsreferenz](/docs/permissions/reference):

| Berechtigung | Was sie erlaubt | Wer sie standardmäßig hat |
| --- | --- | --- |
| **Create Form** | Formulare anlegen und duplizieren. | Project Owner, Project Admin |
| **Edit Form** | Ein Formular ändern: seine Fragen, sein Branding, seine Vorlagen, seine Einstellungen unter Beim Absenden, **Nimmt Einreichungen an**, seinen Link und die **IP-Zulassungsliste**. | Project Owner, Project Admin |
| **Delete Form** | Ein Formular löschen und mit ihm seine Einreichungen. | Project Owner, Project Admin |
| **Read Form** | Formulare, ihre Fragen, ihre Einstellungen und ihre Links sehen. | Die oben genannten sowie Project Member, Viewer und die Rollen für Vorfälle und geplante Wartung |
| **Read Form Submission** | Die Einreichungen und ihre Antworten sehen. | Project Owner, Project Admin |
| **Delete Form Submission** | Einreichungen löschen. | Project Owner, Project Admin |

Einreichungen enthalten, was Fremde eingetippt haben – Namen, E-Mail-Adressen und Antworten, die vielleicht nie im Datensatz landen –, daher sehen sie nur Projektinhaber und -administratoren, es sei denn, Sie gewähren **Read Form Submission**. Wer ein Formular lesen kann, kann seinen Link sehen und teilen. Ein Formular abzusenden braucht überhaupt keine Berechtigung. Wie Rollen und granulare Berechtigungen zusammenwirken, lesen Sie unter [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

## Tarif

In OneUptime Cloud brauchen Formulare den Tarif **Growth** oder höher, und die **IP-Zulassungsliste** eines Formulars braucht **Scale**, ob sie beim Anlegen des Formulars oder später beim Bearbeiten gesetzt wird. Die Links eines Projekts unter dem Tarif **Growth** oder mit unbezahltem Abonnement zeigen die Meldung „nicht verfügbar“, und nichts wird angelegt.

## Formulare über die API

Formulare sind eine gewöhnliche API-Ressource unter `/api/form` und ihre Einreichungen unter `/api/form-submission`, die Sie lesen und löschen, aber nicht anlegen oder bearbeiten können. Die [API-Referenz](/reference) enthält die vollständigen Formen von Anfragen und Antworten.

### Fragen und Einstellungen

Die Fragen eines Formulars sind seine Spalte `fields`, eine JSON-Liste in der Reihenfolge, in der das Formular sie stellt, und seine Einstellungen unter Beim Absenden sind `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Jede Frage hat eine eigene `id` – Buchstaben, Ziffern, `-` und `_` –, eine `source`, ein `label`, optional `helpText` und `isRequired`:

| `source` | Was sie fragt |
| --- | --- |
| `Question` | Eine eigene Frage des Formulars, beantwortet gemäß `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` oder `DateTime`. Eine Auswahlliste listet ihre `dropdownOptions`, eine pro Zeile. |
| `TargetField` | Ein Feld dessen, was das Formular anlegt, benannt durch `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` und `impactStartedAt` für einen Vorfall; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` und `labels` für ein Wartungsereignis. Ein Feld, das durch Auswahl beantwortet wird, listet die angebotenen Datensätze in `allowedOptionIds`. |
| `TargetCustomField` | Eines der benutzerdefinierten Felder des Vorfalls oder Ereignisses, benannt durch `customFieldId`. |
| `Submitter` | `Name` oder `Email` der einreichenden Person, benannt durch `submitterField`. |

Eine Frage mit `isHidden` auf `true` wird auf der öffentlichen Seite nicht gezeigt, ist nie erforderlich und wird nur aus der Vorlage beantwortet, die eine Einreichung nennt – es sei denn, diese Vorlage stellt sie. `isRequired` und `isHidden` sind der Standard des Formulars; jede Vorlage kann eine Frage auf ihre eigene Weise stellen.

### Vorlagen in der API

Die Vorlagen eines Formulars sind seine Spalte `templates`, eine JSON-Liste in der Reihenfolge, in der das Formular sie listet. Jede Vorlage hat eine eigene `id` – Buchstaben, Ziffern, `-` und `_` –, einen `name` von bis zu 100 Zeichen, eindeutig im Formular, und `answers`, nach Frage-ID geordnet, jeweils so, wie eine Einreichung sie sendet: Text, eine Zahl, `true` oder `false`, der Wert einer Option oder eine Liste von Werten bei Mehrfachauswahl. `isDefault` auf `true` macht sie zur Vorlage, mit der sich das Formular öffnet; ein Formular hat höchstens eine und bis zu 50 Vorlagen.

`fieldSettings`, ebenfalls nach Frage-ID geordnet, sagt, wie die Vorlage eine Frage stellt: `Required`, `Optional` oder `Hidden`. Eine Frage, die sie nicht aufführt – oder als `null` aufführt –, wird so gestellt, wie das Formular sie stellt, und die Fragen `startsAt` und `endsAt` eines Wartungsereignisses können nur `Required` sein:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Fragen, Vorlagen und Einstellungen werden bei jedem Speichern geprüft – aus dem Dashboard, über die API, Terraform oder einen Workflow –, und eine Liste, die gegen eine Regel verstößt, wird mit einer Meldung abgelehnt, die nennt, was falsch ist. `shareKey`, der Schlüssel im Link des Formulars, wird von OneUptime beim Anlegen des Formulars gesetzt, und ihn zu ändern ist das, was **Link zurücksetzen** tut.

### Branding in der API

Das Branding eines Formulars sind seine `logoFileId`, `logoAltText` und `faviconFileId`. Laden Sie das Bild zuerst mit `POST /api/file` im Projekt des Formulars hoch – mit einem API-Schlüssel dieses Projekts oder angemeldet als dessen Mitglied mit seiner ID im Header `tenantid` –, senden Sie dabei seinen `name`, seinen `fileType`, etwa `image/png`, und die Bytes base64-kodiert in `file`, und setzen Sie die zurückgegebene `_id`. Ein Upload in ein Projekt, dessen Mitglied Sie nicht sind, wird mit "You can upload files only to a project you are a member of." abgelehnt. Jeder Upload ist privat: `isPublic` setzt OneUptime, was auch immer die Anfrage sagt. Jedes Bild wird beim Speichern des Formulars geprüft: Es muss im Projekt des Formulars hochgeladen worden sein, und ein Logo muss ein PNG-, JPEG-, GIF-, WebP- oder SVG-Bild von höchstens 512 KB sein, ein Favicon eines davon oder ein ICO von höchstens 128 KB. Setzen Sie eine ID auf `null`, um zu denen von OneUptime zurückzukehren. Siehe [Branding](/docs/forms/building#branding).

### Einreichungen lesen

So listen Sie die Einreichungen eines Formulars auf:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Formulare haben die erzeugten Workflow-Komponenten – **On Create Form**, **On Update Form** und so weiter. Um auf das zu reagieren, was ein Formular angelegt hat, verwenden Sie **On Create Incident** oder **On Create Scheduled Maintenance**.

### Die eigenen Endpunkte der öffentlichen Seite

Die öffentliche Seite spricht mit zwei Routen, die keinen API-Schlüssel brauchen: `GET /api/form/public/<shareKey>`, die Name, Beschreibung und Fragen des Formulars zurückgibt – und, wenn vorhanden, sein Logo, den Alternativtext des Logos und sein Favicon, die Bilder base64-kodiert, sowie seine Vorlagen mit ihren Antworten auf die Fragen, die die Seite stellt –, und `POST /api/form/public/<shareKey>/submit`, die es absendet und in `templateId` die Vorlage nennt, mit der die einreichende Person begonnen hat. Es sind die eigenen Endpunkte der Seite, keine API, auf der man aufbauen sollte: Jeder Aufruf durchläuft die Schutzmaßnahmen des Formulars – siehe [Teilen & Sicherheit](/docs/forms/sharing-and-security) –, und sie ändern sich mit der Seite. Um Vorfälle aus Ihrem eigenen Code anzulegen, verwenden Sie `POST /api/incident` mit einem API-Schlüssel – siehe [Einen Vorfall melden](/docs/incidents/declaring-incidents).

## Wo Ihre Vorfallsformulare geblieben sind

Formulare ersetzen die **Incident Forms**, die unter **Vorfälle → Einstellungen → Formulare** lagen. Jedes Vorfallsformular wurde beim Upgrade übernommen, mit demselben Link und denselben Einreichungen:

- Seine Fragen wurden die des Editors: der Titel, die Beschreibung, sofern sie nicht ausgeblendet war, der Schweregrad, wenn die einreichende Person ihn wählen konnte, jedes benutzerdefinierte Feld, das es abfragte – in der Reihenfolge der benutzerdefinierten Felder –, und **Your Name** und **Your Email**, erforderlich, sofern das Formular keine anonymen Meldungen erlaubte.
- Sein Schweregrad und seine Vorfallsvorlage wurden seine Standardwerte unter **Beim Absenden**.
- Sein Schalter **Aktiviert**, seine Erfolgsmeldung und seine **IP-Zulassungsliste** sind unverändert, ebenso sein Link: Alte Links `/accounts/incident-form/<share-key>` öffnen das Formular unter seiner neuen Adresse.
- Die Berechtigungen **Incident Form** wurden die Berechtigungen **Form**, für jedes Team und jeden API-Schlüssel, die sie hatten.

Die alten Dashboard-Seiten leiten auf die neuen weiter.

## Nächste Schritte

:::cards
- [Ein Formular erstellen](/docs/forms/building): Fragen, Antworttypen, verknüpfte Felder, benutzerdefinierte Felder und die Vorschau.
- [Was eine Einreichung erstellt](/docs/forms/on-submit): Wie aus den Antworten und den Einstellungen unter Beim Absenden ein Vorfall oder ein Wartungsereignis wird.
- [Teilen & Sicherheit](/docs/forms/sharing-and-security): Der Link, die IP-Zulassungsliste, Ratenbegrenzungen, Captcha und Fehlerbehebung.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents): Die anderen Wege, Vorfälle zu melden.
:::
