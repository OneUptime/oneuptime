# Cloud-Kosten und Einsparungen

Ein verbundenes Cloud-Konto sagt auch, was es kostet und wie es weniger kosten könnte. OneUptime liest die Kosten jedes Tages aus der eigenen Abrechnung Ihrer Cloud und die Empfehlungen des eigenen Empfehlungsdienstes Ihrer Cloud, zeigt sie unter **Cloud → Ausgaben → Kosten** und **Cloud → Ausgaben → Einsparungen** und warnt, bevor ein Monat mehr kostet als sein Budget unter **Cloud → Ausgaben → Budgets**.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer und Cost Optimization Hub, jeweils einmal eingeschaltet.
- [Microsoft Azure](#microsoft-azure): Cost Management und Azure Advisor, mit einer weiteren Rolle.
- [Google Cloud](#google-cloud): Ihr Abrechnungsexport nach BigQuery und der Recommender.
- [Budgets](#budgets): Eine Warnung, sobald die Ausgaben eines Monats einen Anteil seines Budgets überschreiten.
:::

## So funktioniert es

```mermaid title="Von der Abrechnung Ihrer Cloud zu den Seiten von Cloud"
flowchart TB
    bill["Abrechnung Ihrer Cloud,<br/>zweimal täglich gelesen"] --> costs["Kosten"]
    rec["Empfehlungen Ihrer Cloud,<br/>einmal täglich gelesen"] --> savings["Einsparungen"]
    costs --> budgets["Budgets, die warnen"]
    costs --> overview["Übersicht von Cloud"]
    savings --> overview
```

- **Die Kosten kommen aus der eigenen Abrechnung Ihrer Cloud.** AWS Cost Explorer, Azure Cost Management und der Abrechnungsexport von Google Cloud nach BigQuery, vor Gutschriften und Erstattungen, in der Währung, in der das Konto abgerechnet wird. Jeder Wert gilt für einen Tag, in UTC-Tagen, wie Ihre Cloud sie abrechnet.
- **Eine Cloud meldet die letzten ein, zwei Tage verspätet.** Jeder Lesevorgang liest die letzte Woche erneut, in den ersten Tagen eines Monats den ganzen letzten Monat, sodass sich die Kosten eines Tages festigen, während Ihre Cloud ihn abschließt. Der erste Lesevorgang einer Verbindung reicht bis zum Anfang des vorletzten Monats zurück.
- **Die Hochrechnung des Monats folgt dem Tempo der letzten Woche.** Sie ist, was der Monat bisher gekostet hat, und jeder noch kommende Tag mit dem Durchschnitt der letzten sieben vollen Tage.
- **Die Einsparungen kommen aus dem eigenen Empfehlungsdienst Ihrer Cloud.** AWS Cost Optimization Hub, Azure Advisor und der Recommender von Google Cloud: eine kleinere Größe, eine Ressource im Leerlauf, eine lohnende Zusage, jeweils mit dem, was sie im Monat einsparen würde. Eine Empfehlung, die Sie in der Konsole Ihrer Cloud umsetzen oder verwerfen, verschwindet beim nächsten Lesevorgang.

## Bevor Sie beginnen

- **Ein verbundenes Konto.** [Ein Cloud-Konto verbinden](/docs/telemetry/cloud-accounts) mit dem heutigen Einrichtungsbefehl: Er erlaubt der Verbindung, Kosten und Empfehlungen zu lesen. Eine früher erstellte Verbindung liest keins von beiden, bis Sie ihren Befehl erneut ausführen.

## Amazon Web Services

Die Verbindung liest Kosten mit `ce:GetCostAndUsage` und Empfehlungen mit `cost-optimization-hub:ListRecommendations`. Für beides muss im Konto zuerst etwas eingeschaltet werden:

:::steps
### Cost Explorer einschalten

Öffnen Sie Cost Explorer einmal in der AWS-Konsole Billing and Cost Management: AWS bereitet die Kosten des Kontos innerhalb eines Tages vor. Verbinden Sie das Verwaltungskonto der Organisation, um die Kosten jedes Mitgliedskontos zu lesen.

### Cost Optimization Hub aktivieren

Öffnen Sie Cost Optimization Hub in derselben Konsole und aktivieren Sie ihn, für die Organisation von ihrem Verwaltungskonto aus oder nur für das Konto. Seine Empfehlungen kommen innerhalb eines Tages.
:::

Cost Explorer berechnet $0.01 pro Anfrage, und ein Lesevorgang der Kosten stellt einige. Cost Optimization Hub ist kostenlos.

## Microsoft Azure

Die App liest Kosten mit der Rolle **Cost Management Reader**, für denselben Bereich wie **Monitoring Reader**: Der Einrichtungsbefehl vergibt beide. Die Empfehlungen von Azure Advisor werden mit **Monitoring Reader** gelesen, es gibt also nichts einzuschalten. Um einer früher erstellten App die Rolle zu geben, führen Sie aus:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management antwortet für jedes Abonnement, mit der Ressource, für die jede Kostenposition anfällt, und das Lesen kostet nichts. Wenn es für ein Abonnement nicht antworten kann, sagt die Seite **Kosten** des Kontos, warum.

## Google Cloud

Google Cloud hat keine API für die Kosten eines Projekts: OneUptime liest sie aus dem Export Ihres Rechnungskontos nach BigQuery.

:::steps
### Ihre Abrechnung nach BigQuery exportieren

Öffnen Sie in der Google-Cloud-Konsole Billing, dann Billing export, und schalten Sie den Export der detaillierten Nutzungskosten in ein BigQuery-Dataset ein. Google schreibt ihn mit einigen Stunden Verzug, ab dem Tag, an dem Sie ihn einschalten.

### Das Dienstkonto ihn lesen lassen

Geben Sie dem Dienstkonto der Verbindung **BigQuery Data Viewer** für das Dataset des Exports. Der Einrichtungsbefehl hat ihm bereits **BigQuery Job User** gegeben, um die Abfrage in seinem eigenen Projekt auszuführen.

### Die Tabelle des Exports angeben

Bearbeiten Sie die Verbindung unter **Cloud → Verbinden** und setzen Sie unter **Weitere Felder** die **Tabelle des Abrechnungsexports** auf den vollständigen Namen der Tabelle: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

Der detaillierte Export nennt die Ressource, für die jede Kostenposition anfällt; der Standardexport nennt nur Dienst und Region. BigQuery berechnet die Abfrage: die ersten 1 TiB pro Monat sind kostenlos, danach $6.25 pro TiB, und ein Monat eines Exports umfasst einige Megabyte bis einige Gigabyte. Die Empfehlungen des Recommenders zu Maschinentypen und ungenutzten Ressourcen werden mit **Compute Recommender Viewer** gelesen, den der Einrichtungsbefehl vergibt, und kosten nichts.

## Wege, weniger auszugeben

**Cloud → Ausgaben → Einsparungen** listet jede Empfehlung auf, die größte Einsparung zuerst: was zu tun ist, bei welcher Ressource, was sich ändern würde und was sie im Monat einspart. Die Leiste darüber zählt sie zusammen, insgesamt und nach Art: eine kleinere Größe, eine Ressource im Leerlauf, eine Zusage. Eine Empfehlung verlinkt auf die Seite ihrer Ressource, wenn OneUptime die Ressource führt.

### Größenanpassung nach den eigenen Messwerten von OneUptime

Eine Ressource, für die kein Empfehlungsdienst spricht, weil er nicht eingeschaltet ist, ihren Typ nicht abdeckt oder sie für zu neu hält, bemisst OneUptime nach den CPU- und Speichermesswerten, die ihre Verbindung in den letzten 14 Tagen erfasst hat. OneUptime bemisst EC2-Instanzen, RDS-Datenbanken und ElastiCache-Cluster auf AWS, virtuelle Maschinen, flexible PostgreSQL- und MySQL-Server und App-Service-Pläne auf Azure sowie Compute-Engine-VMs und Cloud-SQL-Instanzen auf Google Cloud:

- **Überdimensioniert**, wenn die halb so große Größe oder ein Viertel davon noch Luft hätte: Auf der kleineren Größe läge das 95. Perzentil ihrer CPU bei höchstens 60 %, ihr höchster CPU-Messwert bei höchstens 100 % und die Spitze ihres Speichers bei höchstens 70 %, wenn ihr Speicher gelesen wird.
- **Unterdimensioniert**, wenn das 95. Perzentil ihrer CPU bei 85 % oder mehr liegt oder die Spitze ihres Speichers bei 90 % oder mehr: dann die doppelt so große Größe.

Eine Ressource wird bemessen, sobald sie 6 Tage an Messwerten hat. Ihre Seite zeigt ihre **Größenanpassung** neben dem, was sie kostet, und eine überdimensionierte steht unter **Cloud → Ausgaben → Einsparungen**, mit OneUptime als Quelle. Was eine Änderung einspart, ist ihr Anteil an dem, was die Ressource in den letzten 30 Tagen gekostet hat; bekannt ist es also, sobald Ihre Cloud die Ressource namentlich abrechnet: Der detaillierte Export von Azure und Google Cloud tut das, AWS Cost Explorer nicht. Eine EC2-Instanz meldet ihren Speicher nur mit dem CloudWatch-Agent und eine Compute-Engine-VM nur mit dem Ops Agent: Ohne ihn wird sie allein nach ihrer CPU bemessen. Burstable-Größen wie t3, die B-Serie und e2-micro werden nie bemessen.

## Budgets

:::steps
### Ein Budget erstellen

Erstellen Sie unter **Cloud → Ausgaben → Budgets** ein Budget: seinen **Monatlicher Betrag** und das **Konto**, für das es gilt, oder keins für alle Konten.

### Wählen, wann es warnt

**Warnen bei** nimmt die Anteile des Budgets in Prozent, bei denen gewarnt wird: anfangs 80 und 100. **Warnen, wenn eine Überschreitung absehbar ist** warnt außerdem einmal im Monat, wenn das Tempo der letzten Woche den Monat über das Budget brächte. **Bei ungewöhnlichen Tagen warnen** warnt außerdem am Tag nach einem Tag, der weit mehr gekostet hat als üblich: siehe [Ungewöhnliche Tage](#ungewöhnliche-tage). **Warnungsschweregrad** und **Bereitschaftsrichtlinien** legen fest, wie schwer die Warnungen sind und wer alarmiert wird.
:::

Ein Budget wird nach jedem Lesevorgang der Kosten und jede Stunde geprüft. Sobald die Ausgaben des Monats einen Schwellenwert überschreiten, wird dafür eine Warnung ausgelöst, die höchste, wenn ein Lesevorgang mehrere auf einmal überschreitet, und ein neuer Monat löst die Warnungen des letzten auf. Ein Budget zählt nur die Konten, die in seiner Währung abgerechnet werden.

KI-Agenten können Budgets über den [MCP-Server](/docs/ai/mcp-server) anlegen und ändern, Skripte mit dem Befehl `oneuptime cloud-budget` der CLI: siehe [Ressourcenoperationen](/docs/cli/resource-operations).

### Ungewöhnliche Tage

Nach jedem Lesevorgang wird jeder der letzten 14 vollen Tage eines Kontos an den 14 Tagen davor gemessen. Ein Tag ist ungewöhnlich, wenn ein Dienst das Doppelte seines üblichen Tages oder mehr gekostet hat oder das ganze Konto das Anderthalbfache seines üblichen Tages oder mehr. In beiden Fällen muss es mindestens 10 mehr als üblich sein, in der Währung des Kontos, und mindestens 5 % des üblichen Tages des Kontos, damit ein paar Cent nie als Ausreißer gelten. Der übliche Wert eines Tages ist der Median der 14 Tage davor, sodass ein einzelner Ausreißer ihn kaum bewegt, und ein Konto wird erst beurteilt, wenn es eine Woche an Kosten hat.

**Cloud → Ausgaben → Kosten** listet die ungewöhnlichen Tage unter den täglichen Ausgaben auf. Ein Budget, das das Konto einbezieht, löst für jedes Konto und jeden Tag eine Warnung aus, am Tag danach, und nennt jeden Dienst, der zu hoch lag. Ein Ausreißer, der tagelang anhält, wird am Tag seines Beginns gemeldet, und ein Tag, der älter als eine Woche ist, wird nicht gemeldet.

## Was Sie in OneUptime sehen

- **Die Übersicht von Cloud.** **Cloud → Übersicht** zeigt die Ausgaben des Monats im Vergleich zu denen des letzten Monats am selben Tag, die teuersten Dienste und die größten Wege, weniger auszugeben, neben dem, was Aufmerksamkeit braucht.
- **Die Ausgaben jedes Tages.** **Cloud → Ausgaben → Kosten** zeichnet jeden der letzten 30 Tage, listet die Tage auf, die weit mehr gekostet haben als üblich, und schlüsselt einen Zeitraum nach Dienst, Region, Konto oder Ressource auf. Die Konten, deren Kosten nicht gelesen werden, sind darunter aufgeführt, jeweils mit dem Grund.
- **Die Kosten eines Kontos.** Die Seite **Kosten** eines Kontos zeigt dasselbe nur für das Konto, mit seinen Wegen, weniger auszugeben.
- **Die Kosten einer Ressource.** Die Seite einer Ressource zeigt, was sie in diesem Monat und in den letzten 30 Tagen gekostet hat, wenn ihre Cloud sie namentlich abrechnet, mit ihren Wegen, weniger auszugeben, und ihrer Größenanpassung.

## Fehlerbehebung

:::details Ein Konto zeigt Benötigt Berechtigung
Die Verbindung darf die Kosten des Kontos noch nicht lesen. Führen Sie ihren Einrichtungsbefehl unter **Cloud → Verbinden** erneut aus: Er fügt hinzu, was das Lesen der Kosten braucht. Geben Sie bei Google Cloud dem Dienstkonto außerdem **BigQuery Data Viewer** für das Dataset des Exports.
:::

:::details Ein Konto zeigt Nicht eingerichtet
Seine Cloud hat noch keine Kosten zu liefern. Schalten Sie bei AWS Cost Explorer ein; geben Sie bei Google Cloud die Tabelle des Exports unter **Tabelle des Abrechnungsexports** an. Die ersten Werte kommen mit dem nächsten Lesevorgang, innerhalb von 12 Stunden.
:::

:::details Die Werte lassen ein Konto aus
Die Werte stehen in der Währung, in der die meisten Ihrer Konten abgerechnet werden. Ein Konto, das in einer anderen abgerechnet wird, ist darunter mit seiner Währung aufgeführt, und ein Budget zählt nur die Konten, die in seiner eigenen abgerechnet werden.
:::

:::details Dieser Monat ist niedriger als in der Konsole Ihrer Cloud
Ihre Cloud meldet die letzten ein, zwei Tage verspätet, und die Werte gelten vor Gutschriften und Erstattungen. Die nächsten Lesevorgänge holen auf.
:::

## Nächste Schritte

:::cards
- [Ein Cloud-Konto verbinden](/docs/telemetry/cloud-accounts): Ein weiteres Konto verbinden oder seinen Befehl erneut ausführen.
- [Cloud-Ressourcen](/docs/telemetry/cloud-resources): Die Metriken jeder Ressource, aus einem eigenen Collector.
- [Kubernetes-Kosten-Observability](/docs/telemetry/kubernetes-cost): Was jeder Kubernetes-Workload kostet.
:::
