# Episoden

Eine Episode fasst zusammengehörige Vorfälle oder zusammengehörige Warnungen zusammen, damit Ihr Team sie als Einheit bearbeitet: ein Ort, an dem man sie sieht, ein Kreis von Eigentümern, ein Status, der bestätigt und behoben wird. Gruppierungsregeln eröffnen Episoden und fügen ihnen Vorfälle und Warnungen hinzu, sobald diese eintreffen (siehe [Gruppierungsregeln für Vorfälle](/docs/incidents/settings#gruppierungsregeln-für-vorfälle)). Sie können Vorfälle auch selbst einer Episode hinzufügen, mehrere auf einmal: von der Episode aus oder aus den Vorfalllisten.

Alles auf dieser Seite funktioniert für Warnungsepisoden genauso: Lesen Sie „Warnung“, wo „Vorfall“ steht. Vorfallepisoden finden Sie unter **Vorfälle → Episoden**, Warnungsepisoden unter **Warnungen → Episoden**.

## Vorfälle von einer Episode aus hinzufügen

Öffnen Sie die Episode, wählen Sie im Seitenmenü **Mitglieder-Vorfälle** (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`) und klicken Sie auf **Vorfälle hinzufügen**. Der Dialog listet die 50 neuesten Vorfälle auf, die Sie sehen können und die noch nicht in der Episode sind, jeweils mit Nummer, Titel, Status und Schweregrad. Ältere finden Sie über die Suche nach Titel oder Nummer: `INC-42`, `42` und `#42` finden alle den Vorfall 42.

- Haken Sie so viele an, wie Sie brauchen, bis zu 100 auf einmal. Die Schaltfläche zählt mit: **3 Vorfälle hinzufügen**.
- Ein Vorfall, der schon in einer anderen Episode ist, sagt das unter seinem Titel, mit der Nummer dieser Episode. Fügen Sie ihn hier hinzu, bleibt er auch dort: Ein Vorfall kann in mehreren Episoden sein. In einem Projekt, in dem ein Vorfall nur in einer Episode sein kann, lässt er sich nicht auswählen: siehe [Eine Episode pro Vorfall](#eine-episode-pro-vorfall).
- Lassen sich einige nicht hinzufügen, bleibt der Dialog offen und listet sie mit dem Grund auf; die übrigen werden hinzugefügt.

## Vorfälle aus den Vorfalllisten hinzufügen

Wählen Sie Vorfälle in der Liste **Vorfälle** aus, oder in jeder anderen Vorfallliste, etwa der eines Monitors, und öffnen Sie **Massenaktionen**:

| Aktion | Was sie tut |
| --- | --- |
| **Zu bestehender Episode hinzufügen** | Wählen Sie eine Episode. Laufende Episoden stehen zuerst, die neuesten oben, danach die kürzlich behobenen; jede andere finden Sie über die Suche nach Titel oder Nummer. Vor dem Hinzufügen sagt der Dialog, wie viele der ausgewählten Vorfälle schon in dieser Episode sind, die bleiben, wie sie sind, und wie viele in einer anderen Episode sind, wo sie bleiben. |
| **Zu neuer Episode hinzufügen** | Erstellt eine Episode mit den ausgewählten Vorfällen darin. Gefragt werden nur Titel und Schweregrad, beide vorausgefüllt aus dem schwersten ausgewählten Vorfall; der Titel eines privaten Vorfalls wird nie übernommen. Eigentümer, Bereitschaftsrichtlinien und Notizen fügen Sie auf der Seite der Episode hinzu. |

Beide nehmen bis zu 100 ausgewählte Vorfälle. Das Ergebnis sagt, wie viele hinzugefügt wurden, wie viele schon in der Episode waren und welche nicht hinzugefügt wurden und warum, mit einem Link, der die Episode öffnet.

## Was das Hinzufügen bewirkt

- **Ein Eintrag im Feed der Episode** nennt jeden hinzugefügten Vorfall: die ersten 20 mit Nummer und Titel, dann wie viele noch. Er wird einmal in den Slack- oder Microsoft-Teams-Kanal der Episode gepostet, nicht einmal pro Vorfall. Ein privater Vorfall wird nur mit seiner Nummer genannt.
- **Der eigene Feed jedes Vorfalls** sagt, zu welcher Episode er hinzugefügt wurde.
- **Der Schweregrad der Episode** wird auf den schwersten Vorfall angehoben, der einer bestehenden Episode hinzugefügt wird, und nie gesenkt. Eine neue Episode beginnt mit dem Schweregrad, den Sie wählen.
- **Eine behobene Episode bleibt behoben.** Hinzufügen öffnet sie nicht wieder, und Hinzufügen ändert nie den Status eines Vorfalls.
- **Die Eigentümer der Episode werden benachrichtigt**, dass Vorfälle hinzugefügt wurden, wie wenn einer allein hinzugefügt wird. Wird die Episode mit ihnen erstellt, deckt ihre eigene Benachrichtigung über die Erstellung sie ab.

## Einen Vorfall herausnehmen

Unter **Mitglieder-Vorfälle** nimmt **Entfernen** in einer Zeile, oder für die ausgewählten Zeilen über **Massenaktionen**, den Vorfall nur aus dieser Episode heraus. Der Vorfall selbst wird nicht gelöscht und bleibt in jeder anderen Episode, in der er ist.

## Eine Episode pro Vorfall

Ein Vorfall kann gleichzeitig in mehreren Episoden sein. Damit jeder Vorfall in höchstens einer Episode ist, schalten Sie **Ein Vorfall kann nur in einer Episode sein** unter **Vorfälle → Einstellungen → Episodenzugehörigkeit** ein. Für Warnungen heißt der Schalter **Eine Warnung kann nur in einer Episode sein**, unter **Warnungen → Einstellungen → Episodenzugehörigkeit**. Beide sind aus, bis Sie sie einschalten, und nur Project Owners und Project Admins können sie ändern.

Solange er an ist, wird ein Vorfall, der in einer Episode ist, keiner anderen hinzugefügt:

- **Vorfälle hinzufügen** listet nur die Vorfälle auf, die in keiner Episode sind. Die Suche findet auch die anderen, aber einen Vorfall, der in einer anderen Episode ist, können Sie nicht ankreuzen, und er sagt das.
- **Zu bestehender Episode hinzufügen** sagt, wie viele der ausgewählten Vorfälle in einer anderen Episode sind, und fügt nur die übrigen hinzu. Sind alle schon in einer Episode, sagt der Dialog, dass es nichts hinzuzufügen gibt.
- **Zu neuer Episode hinzufügen** lässt die ausgewählten Vorfälle weg, die schon in einer Episode sind, und sagt, wie viele. Sind es alle, sagt der Dialog, dass es nichts hinzuzufügen gibt.
- **Gruppierungsregeln** lassen einen Vorfall, der schon in einer Episode ist, wo er ist.
- **Die API, Workflows und Terraform** halten sich an dieselbe Regel: Einen Vorfall hinzuzufügen, der in einer anderen Episode ist, wird mit Begründung abgelehnt.

Das Einschalten nimmt keinen Vorfall aus einer Episode heraus: Ein Vorfall, der schon in mehreren ist, bleibt in ihnen. Um einen Vorfall zu verschieben, nehmen Sie ihn mit **Entfernen** auf der Seite **Mitglieder-Vorfälle** seiner Episode heraus und fügen ihn dann der anderen Episode hinzu.

## Wer hinzufügen darf

Zum Hinzufügen braucht man die Berechtigung, Vorfälle zu einer Episode hinzuzufügen. Die Rollen Project Owner, Project Admin, Project Member, Incident Admin und Incident Member haben sie, ebenso eine eigene Rolle mit Create Incident Episode Member. Sie können nur Vorfälle hinzufügen, die Sie sehen können: Einen privaten Vorfall können nur seine Eigentümer und die Eigentümer und Admins des Projekts hinzufügen. Zu neuer Episode hinzufügen braucht außerdem die Berechtigung, eine Episode zu erstellen. Können Sie eine Aktion nicht nutzen, ist sie gesperrt, und ihr Tooltip nennt die fehlende Berechtigung.

## Mit der API

Mehrere Vorfälle in einer Anfrage zu einer Episode hinzufügen:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

Die Antwort nennt jeden gesendeten Vorfall genau einmal: hinzugefügt, schon in der Episode oder nicht hinzugefügt und warum. Eine Anfrage mit mehr als 100 IDs wird abgelehnt.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

In einem Projekt, in dem ein Vorfall nur in einer Episode sein kann, kommt ein Vorfall, der in einer anderen Episode ist, unter `notAdded` zurück, mit `Already in another episode. An incident can be in only one episode in this project.` als Begründung.

Für Warnungen senden Sie `alertEpisodeId` und `alertIds` an `/api/alert-episode-member/add-alerts`. Um eine Episode mit Vorfällen darin zu erstellen, senden Sie deren IDs mit der Anfrage, die die Episode erstellt, `POST /api/incident-episode`, als `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; für eine Warnungsepisode `POST /api/alert-episode` mit `alertIdsToAdd`. Lässt sich einer davon nicht hinzufügen, wird keine Episode erstellt.
