# Cloud-Kostenzuordnung

Kostengruppen beantworten die erste Frage jeder monatlichen Cloud-Rechnung: Wer hat das Geld ausgegeben? Eine **Kostenansicht** wie „Nach Team“ oder „Nach Kostenstelle“ ordnet die Ausgaben Ihrer verbundenen Konten nach Regeln **Kostengruppen** zu, ohne etwas doppelt zu zählen. Was keine Regel erfasst, bleibt als nicht zugeordnete Ausgaben sichtbar, und gemeinsame Kosten werden auf die Gruppen aufgeteilt. Sie finden sie unter **Cloud → Ausgaben → Kostengruppen**.

:::cards
- [Eine Ansicht erstellen](#eine-ansicht-erstellen): Nach Team aus den bereits festgelegten Eigentümern, nach einem Tag oder mit eigenen Gruppen.
- [Die Regeln einer Gruppe schreiben](#die-regeln-einer-gruppe-schreiben): Konten, Dienste, Tags, Eigentümer-Teams, Beschriftungen und mehr.
- [Nicht zugeordnete Ausgaben](#nicht-zugeordnete-ausgaben): Was keine Regel erfasst, und ein Klick, um es zuzuordnen.
- [Gemeinsame Kosten](#gemeinsame-kosten): Ein Supportplan oder ein gemeinsamer Cluster, auf die Gruppen aufgeteilt.
:::

## So funktioniert es

```mermaid title="Von den Kosten Ihrer Clouds zu den Ausgaben jeder Gruppe"
flowchart TB
    costs["Tägliche Kosten<br/>Ihrer Clouds"] --> rules{"Die erste Gruppe,<br/>deren Regeln auf<br/>jeden Posten zutreffen"}
    rules --> groups["Ausgaben jeder Gruppe"]
    rules --> unallocated["Nicht zugeordnet"]
    groups --> shared["Gemeinsame Gruppen,<br/>auf die anderen verteilt"]
    items["Eigene Positionen"] --> groups
    shared --> charged["Was jeder Gruppe<br/>berechnet wird"]
```

- **Die erste passende Gruppe übernimmt die Kosten.** Die Gruppen einer Ansicht haben eine Reihenfolge, und jeder Kostenposten fällt in die erste Gruppe, deren Regeln auf ihn zutreffen, sodass nichts doppelt gezählt wird. Die Gruppen und die nicht zugeordneten Ausgaben ergeben zusammen immer die Summe des Zeitraums.
- **Regeln lesen alles, was ein Kostenposten trägt.** Das Konto, die Cloud, den Dienst, die Region, die Ressource und ihre Tags sowie das, was OneUptime über die Ressource weiß: ihre Eigentümer-Teams, ihre Beschriftungen, ihre App-Platforms-Umgebung und App.
- **Alles wird beim Ansehen berechnet.** Pro Kostenposten wird nichts gespeichert. Eine geänderte Regel ordnet jeden Monat, den OneUptime aufbewahrt, neu zu, bis zu 400 Tage zurück, ohne Wartezeit.
- **Mehrere Ansichten können dieselben Ausgaben ordnen.** „Nach Team“ und „Nach Kostenstelle“ ordnen jeweils alles, jede auf ihre Weise.

## Bevor Sie beginnen

- **Kosten, die gelesen werden.** [Verbinden Sie ein Cloud-Konto](/docs/telemetry/cloud-accounts) und lassen Sie es [seine Kosten lesen](/docs/telemetry/cloud-costs).
- **Tags oder Eigentümer, wenn Sie sie nutzen möchten.** Regeln auf Tags brauchen Kosten, die sie tragen; schalten Sie bei AWS [Kosten pro Ressource](/docs/telemetry/cloud-costs#kosten-pro-ressource) ein. Eigentümer-Teams stammen von den Eigentümern jeder Ressource, von Hand oder per [Eigentümerregeln](/docs/configuration/label-and-owner-rules) gesetzt.

## Eine Ansicht erstellen

Öffnen Sie **Cloud → Ausgaben → Kostengruppen**. Einem Projekt ohne Ansicht werden drei Wege zum Start angeboten:

| Start | Was entsteht |
| --- | --- |
| **Nach Team, aus Eigentümern** | Eine Gruppe für jedes Team, dem Cloud-Ressourcen gehören, mit dem Team verknüpft. |
| **Nach einem Tag** | Eine Gruppe für jeden Wert eines Tags, das Ihre Kosten tragen, etwa `team` oder `cost-center`. |
| **Eigene Gruppen** | Eine leere Ansicht. Sie schreiben die Regeln jeder Gruppe. |

OneUptime erstellt die Gruppen einer Ansicht nach Tag oder nach Eigentümer-Team beim Speichern und danach stündlich, sobald neue Tag-Werte und Eigentümer auftauchen. Sie können diese Gruppen umbenennen, mit einem Team verknüpfen oder gemeinsam machen. Ihre Regeln bleiben die von OneUptime. Um fehlende Gruppen sofort zu erstellen, öffnen Sie die Ansicht und klicken Sie auf **Gruppen jetzt erstellen**.

## Die Regeln einer Gruppe schreiben

Öffnen Sie eine Ansicht und dann **Kostengruppe erstellen** unter **Gruppen**. Ein Kostenposten gehört zur Gruppe, wenn **eine** ihrer Regeln auf ihn zutrifft, und eine Regel trifft zu, wenn **alle** ihre Bedingungen zutreffen. Eine Bedingung vergleicht etwas, das ein Kostenposten trägt, mit den Werten, die Sie auswählen oder eingeben:

| Feld | Was es liest |
| --- | --- |
| **Tag** | Den Wert eines Tags, über den Schlüssel des Tags. **ist gesetzt** und **ist nicht gesetzt** fragen, ob der Kostenposten es trägt. |
| **Konto** | Das verbundene Konto, dem der Kostenposten berechnet wird. |
| **Eigentümer-Team** | Die Teams, denen die Ressource in OneUptime gehört. |
| **Dienst** | Der Dienst, wie die Abrechnung Ihrer Cloud ihn nennt. |
| **Beschriftung** | Die Beschriftungen der Ressource oder ihres Kontos in OneUptime. |
| **Region** | Die Region. Lassen Sie den Wert für einen globalen Dienst leer. |
| **Cloud** | AWS, Azure oder Google Cloud. |
| **Ressource** | Die Ressource, wie Ihre Cloud sie nennt. |
| **App-Platforms-Umgebung** und **App** | Was einer Umgebung oder einer App berechnet wird, so wie **Cloud → Ausgaben → Kosten** es zählt. |
| **Kubernetes-Namespace** und **Kubernetes-Cluster** | Die Namespaces eines Clusters, wenn eine gemeinsame Gruppe nach ihnen aufgeteilt wird. Siehe [Kubernetes-Cluster](#kubernetes-cluster). |

Text wird ohne Rücksicht auf Groß- und Kleinschreibung verglichen: `Payments` und `payments` sind ein Team. Der Schlüssel eines Tags wird so verglichen, wie er geschrieben ist, so wie Ihre Clouds ihn speichern.

Zum Beispiel übernimmt eine Gruppe **Zahlungen** mit drei Regeln einen Kostenposten, der mit `team: payments` getaggt ist, **oder** dem Konto payments berechnet wird, **oder** dem Team Zahlungen gehört.

### Die Reihenfolge der Gruppen

Ziehen Sie die Gruppen unter **Gruppen**, um ihre Reihenfolge zu ändern. Eine Gruppe, deren Regeln eine frühere Gruppe bereits abdeckt, kann nie Kosten übernehmen, und ihre Zeile nennt die Gruppe, die alles übernimmt. Eine Gruppe, deren Regeln auch Kosten erfassen, die eine frühere Gruppe übernimmt, sagt, wie viel davon sie bekommt.

### Ressourcen mit mehreren Eigentümer-Teams

Eine Ressource, die zwei Teams gehört, wird gleichmäßig zwischen ihnen aufgeteilt: Die Hälfte jedes Teams durchläuft die Regeln für sich. Eine Regel, die nicht nach Eigentümern fragt, etwa ein Tag oder ein Konto, übernimmt weiterhin die ganzen Kosten. Eine Hälfte, deren Team keine Gruppe hat, bleibt nicht zugeordnet.

## Nicht zugeordnete Ausgaben

Die Seite einer Ansicht listet auf, was noch keine Regel erfasst: die Dienste, Konten, Tag-Werte und Eigentümer-Teams, aus denen es besteht, die teuersten zuerst. Klicken Sie daneben auf **Zur Gruppe hinzufügen**, um einer Gruppe oder einer neuen Gruppe eine Regel dafür hinzuzufügen. Die Kosten wandern sofort in die Gruppe, auch die vergangener Monate.

## Gemeinsame Kosten

Ein Supportplan, ein gemeinsamer Cluster oder ein Netzwerk-Hub gehört allen. Machen Sie daraus eine eigene Gruppe, schalten Sie dann unter **Weitere Felder** die Option **Gemeinsam** ein und wählen Sie, wie ihre Kosten auf die anderen Gruppen der Ansicht aufgeteilt werden:

| Aufteilung | Wie |
| --- | --- |
| **Nach Anteil an den Ausgaben aufteilen** | Jede Gruppe übernimmt ihren Anteil an den Cloud-Ausgaben der anderen Gruppen in diesem Monat. Ein Monat, in dem sie nichts ausgegeben haben, wird gleichmäßig aufgeteilt. |
| **Gleichmäßig aufteilen** | Derselbe Betrag für jede Gruppe. |
| **Nach festen Prozentsätzen aufteilen** | Die Prozentsätze, die Sie für jede Gruppe festlegen, zusammen 100. |
| **Nach Kubernetes-Namespaces aufteilen** | Was jeder Namespace eines Clusters in diesem Monat gekostet hat. Siehe unten. |

Die Kosten einer gemeinsamen Gruppe werden Tag für Tag mit den Anteilen jedes Monats aufgeteilt, sodass ein Monat dieselben Zahlen ergibt, ob er nach Tagen oder nach Monaten gelesen wird. Nicht zugeordnete Ausgaben erhalten nie einen Anteil.

### Kubernetes-Cluster

Die Knoten eines Clusters berechnet Ihre Cloud, während die eigene Kosten-Engine des Clusters sagt, was jeder Namespace genutzt hat. So belasten Sie jedes Team für seine Workloads in einem gemeinsamen Cluster:

1. Erstellen Sie eine Gruppe, deren Regeln auf die Knoten des Clusters zutreffen, zum Beispiel **Tag** `eks:cluster-name` **ist eines von** `prod`.
2. Schalten Sie **Gemeinsam** ein, wählen Sie **Nach Kubernetes-Namespaces aufteilen** und dann den **Kubernetes-Cluster**.
3. Geben Sie den Gruppen der Teams Regeln, die die Labels der Namespaces lesen, die als Tags zählen. Zum Beispiel **Tag** `team` **ist eines von** `payments` oder **Kubernetes-Namespace** **beginnt mit** `payments-`.

Jeden Monat werden die Kosten der Knoten nach dem aufgeteilt, was jeder Namespace in der [Kosten-Engine](/docs/telemetry/kubernetes-cost) des Clusters gekostet hat, und der Anteil jedes Namespace geht an die erste Gruppe, deren Regeln auf ihn zutreffen. Ungenutzte Kapazität und ein Namespace, den keine Gruppe übernimmt, bleiben bei der Gruppe des Clusters. Die eigenen bepreisten Kosten des Clusters werden nie zu Ihrer Rechnung addiert, sodass nichts doppelt gezählt wird.

## Eigene Positionen

Fügen Sie unter **Cloud → Ausgaben → Kostengruppen → Eigene Positionen** eine Belastung oder Gutschrift hinzu, die die Rechnungen Ihrer Clouds nicht enthalten: einen Anteil an einem Supportvertrag, einen Unternehmensrabatt, einen internen Aufschlag oder eine Plattformgebühr.

- **Einmalig oder jeden Monat.** Eine monatliche Position wird auf die Tage jedes Monats verteilt, sodass ein angebrochener Monat seinen Anteil trägt.
- **Auf einem Konto oder einer Gruppe.** Eine einem Konto hinzugefügte Position durchläuft die Regeln jeder Ansicht wie die Kosten des Kontos. Eine einer Gruppe hinzugefügte geht direkt an sie.
- **Immer getrennt.** Jede Zahl hält Positionen getrennt von dem, was die Clouds berechnet haben, sodass die eigenen Zahlen der Clouds weiterhin zu ihren Konsolen passen.

## Die Ausgaben jeder Gruppe ansehen

- **Cloud → Ausgaben → Kosten**: Wählen Sie unter **Wohin das Geld fließt** **Kostengruppen** und eine Ansicht. Die Ausgaben jeder Gruppe, verglichen mit dem Zeitraum davor.
- **Die Seite einer Ansicht**: was jeder Gruppe berechnet wurde, mit ihren gemeinsamen Kosten, was keine Regel erfasst, und **CSV herunterladen** für die Weiterverrechnung des Monats.
- **Die Seite einer Gruppe**: ihre Ausgaben Tag für Tag, die Dienste, Ressourcen und Konten, die ihr am meisten berechnet werden, und ihre Regeln. Sie zeigt nur die Ausgaben dieser Gruppe; verknüpfen Sie die Gruppe also mit ihrem **Team** und senden Sie dem Team ihre Seite: Jeder, der die Cloud-Ausgaben lesen darf, kann sie öffnen.

## API, CLI und MCP

Ansichten, Gruppen und Positionen sind API-Ressourcen (`cloud-cost-view`, `cloud-cost-group`, `cloud-cost-line-item`), mit CLI-Befehlen und MCP-Tools wie jede Ressource. Die Regeln einer Gruppe sind JSON:

```json
[
  { "conditions": [{ "field": "tag", "key": "team", "operator": "is", "values": ["payments"] }] },
  { "conditions": [{ "field": "ownerTeam", "operator": "is", "values": ["<team ID>"] }] }
]
```

Um zu lesen, was eine Ansicht zuordnet, für ganze UTC-Tage von `startDate` bis `endDate`:

```bash
curl -X POST "https://oneuptime.com/api/cloud-cost-view/<view ID>/allocation" \
  -H "apikey: <API key>" -H "tenantid: <project ID>" -H "Content-Type: application/json" \
  -d '{"startDate": "2026-11-01", "endDate": "2026-11-30", "currency": "USD"}'
```

Die Antwort enthält die `total` jeder Gruppe und woraus sie besteht (`cloud`, `lineItems`, `sharedIn`, `sharedOut`), ihre Zahlen nach Tag oder Monat, den Zeitraum davor und woraus die nicht zugeordneten Ausgaben bestehen. `POST /cloud-cost-group/<group ID>/spend` antwortet für eine Gruppe.

## Grenzen

- Eine Ansicht enthält höchstens 500 Gruppen. Eine Ansicht nach Tag erstellt Gruppen für die 500 teuersten Werte.
- Eine Gruppe hat höchstens 25 Regeln, eine Regel 20 Bedingungen und eine Bedingung 200 Werte.
- Kosten werden 400 Tage aufbewahrt, daher liest eine Ansicht höchstens 400 Tage.

## Fehlerbehebung

:::details Eine Gruppe erhält nichts
Ihre Regeln erfassen vielleicht noch keine Kosten, oder eine frühere Gruppe übernimmt alle Kosten, die sie erfassen. Ihre Zeile unter **Gruppen** nennt dann diese Gruppe: Ziehen Sie diese hier darüber oder grenzen Sie die Regeln der früheren Gruppe ein.
:::

:::details Ein Kostenposten liegt in der falschen Gruppe
Ein Kostenposten fällt in die erste Gruppe, deren Regeln auf ihn zutreffen. Ziehen Sie die Gruppe, zu der er gehört, über die Gruppe, die ihn übernimmt, oder grenzen Sie deren Regeln ein.
:::

:::details Eine Regel auf ein Tag erfasst nichts
Ein Kostenposten behält die Tags, die er beim Lesen hatte: die Labels eines Google-Cloud-Abrechnungsexports, sonst die Tags der Ressource, der er berechnet wird, was bei AWS [Kosten pro Ressource](/docs/telemetry/cloud-costs#kosten-pro-ressource) erfordert. Der Schlüssel eines Tags wird so verglichen, wie er geschrieben ist.
:::

:::details Einer Ansicht nach Tag oder nach Eigentümer-Team fehlt eine Gruppe
OneUptime erstellt fehlende Gruppen stündlich: eine für jeden Tag-Wert der Kosten der letzten 400 Tage oder für jedes Team, dem Cloud-Ressourcen gehören, bis zu 500 Gruppen. Klicken Sie auf der Seite der Ansicht auf **Gruppen jetzt erstellen**, um sie sofort zu erstellen.
:::

:::details Die Zahlen lassen ein Konto aus
Die Zahlen einer Ansicht sind in der Währung, in der die meisten Ihrer Konten abgerechnet werden. Ein in einer anderen Währung abgerechnetes Konto bleibt außen vor, ebenso eine Position in einer anderen Währung.
:::

## Nächste Schritte

:::cards
- [Cloud-Kosten und Einsparungen](/docs/telemetry/cloud-costs): Was Ihre verbundenen Konten kosten und wie Sie weniger ausgeben.
- [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules): Ressourcen Eigentümer-Teams und Beschriftungen geben, die die Regeln lesen.
- [Kubernetes-Kosten-Observability](/docs/telemetry/kubernetes-cost): Was jeder Kubernetes-Workload kostet.
:::
