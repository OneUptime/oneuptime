# Azure Monitor-metrieken en -logboeken streamen

Een gekoppeld Azure-abonnement kan zijn Azure Monitor-metrieken en resourcelogboeken naar OneUptime streamen. Diagnostische instellingen sturen ze naar Event Hubs in uw abonnement, en OneUptime leest de Event Hubs elke minuut: de meeste belangrijke metrieken komen enkele minuten nadat Azure Monitor ze heeft binnen, in plaats van pas bij de volgende leesactie van de koppeling, en resourcelogboeken komen binnen als OneUptime-logboeken, elk gearchiveerd onder de resource waar het over gaat. Eén opdracht in Azure Cloud Shell zet alles op, en er hoeft niets te draaien.

:::cards
- [Zo werkt het](#zo-werkt-het): Diagnostische instellingen sturen naar een Event Hub in elke regio, en OneUptime leest ze.
- [Streamen instellen](#streamen-instellen): Kies wat er gestreamd wordt, zet het lezen aan en voer één opdracht uit.
- [Wat er binnenkomt](#wat-er-binnenkomt): Metrieken bij de resources die ze meten, en logboeken bij de resources waar ze vandaan komen.
- [Wat de opdracht aanmaakt](#wat-de-opdracht-aanmaakt): Elke resource en elke machtiging die de opdracht in uw abonnement aanmaakt.
- [Streamen stoppen](#streamen-stoppen): Stop het lezen en verwijder daarna wat de opdracht heeft aangemaakt.
:::

## Zo werkt het

```mermaid title="Van Azure Monitor naar OneUptime"
flowchart TB
    metrics["Platformmetrieken"] --> settings["Diagnostische<br/>instellingen"]
    logs["Resourcelogboeken"] --> settings
    settings --> hubs["Een Event Hub<br/>in elke regio"]
    ou["OneUptime"] -->|"leest elke minuut,<br/>Kafka op poort 9093"| hubs
```

- **Een Event Hub in elke regio.** Een diagnostische instelling stuurt alleen naar een Event Hub in de eigen regio van haar resource, dus de opdracht maakt een Event Hubs-namespace in elke regio waar uw resources staan, allemaal in één resourcegroep, en richt de diagnostische instelling van elke resource op die van haar regio.
- **OneUptime leest ze.** Azure Monitor stuurt alleen naar een Event Hub, een opslagaccount of een Log Analytics-werkruimte, nooit naar een adres van u: een Event Hub die OneUptime leest, is de manier waarbij u niets hoeft te draaien. OneUptime meldt zich aan als de eigen app van de koppeling, die die Event Hubs mag lezen en verder niets.
- **De leesacties laten gestreamde metrieken aan de stream over.** Zolang de stream de belangrijke metrieken van een resourcetype in een regio levert, schrijven de leesacties van de koppeling de metrieken die hij draagt niet meer, zodat geen datapunt dubbel telt, en blijven ze [de metrieken die hij niet kan dragen](#wat-er-binnenkomt) schrijven. De leesacties blijven resources, hun status en hun wijzigingen vinden, en nemen de metrieken terug na 15 minuten zonder event.
- **Er gaat niets verloren zolang OneUptime niet kan lezen.** Events wachten in de Event Hubs tot OneUptime ze leest, zolang de Event Hubs ze bewaren, en OneUptime onthoudt tot waar het elke partitie heeft gelezen, zodat het verdergaat waar het was gebleven.

## Voordat u begint

- **Een gekoppeld Azure-abonnement.** Koppel het eerst onder **Cloud → Koppelen**: zie [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts).
- **Een Projecteigenaar of Projectbeheerder.** Alleen zij kunnen het lezen aanzetten en het streamen stoppen.
- **Azure Cloud Shell**, aangemeld als **Owner** van de abonnementen, of als **Contributor** die ook **User Access Administrator** is: de opdracht maakt een resourcegroep en een roltoewijzing aan, en wijzigt diagnostische instellingen.
- **Voor de logboeken van Microsoft Entra ID, een Security Administrator** van de tenant die ook **Owner** of **Contributor** is van de resourcegroep die de opdracht aanmaakt: alleen die mag de logboeken van de tenant naar een Event Hub sturen.
- **Een weg naar Azure, bij een zelf gehoste OneUptime.** OneUptime leest elke namespace op `<namespace>.servicebus.windows.net` via poort 9093, en de namespaces nemen verbindingen vanaf internet aan.

## Streamen instellen

:::steps
### Het streamvenster openen

Ga naar **Cloud → Koppelen** en kies in de rij van het Azure-abonnement **Metrieken en logboeken streamen**.

### Kiezen wat er gestreamd wordt

**Metrieken** streamt de belangrijke metrieken van elke resource, per minuut, de metrieken waarmee OneUptime elke resource in grafieken toont en beoordeelt, behalve [de metrieken die een diagnostische instelling niet kan sturen](#wat-er-binnenkomt), die de koppeling blijft lezen. **Metrieken en logboeken** voegt de eigen logboeken van elke resource toe, elke categorie die Azure ervoor bijhoudt, en **Logboeken** streamt alleen resourcelogboeken.

Onder **Voor Beveiligingsgebeurtenissen** laat **Activiteitenlogboek van elk abonnement** de opdracht de wijzigingen, de waarschuwingen van Defender for Cloud en de weigeringen door Azure Policy van elk abonnement naar de Event Hub van de eerste regio sturen, en voegt **Aanmeld- en auditlogboeken van Microsoft Entra ID** een tweede opdracht toe, voor een Security Administrator van uw tenant. [Beveiligingsgebeurtenissen](/docs/telemetry/security-events#beveiligingsgebeurtenissen-in-uw-logs-vinden) leest ze allebei.

### Het lezen aanzetten

Kies **Lezen aanzetten**. OneUptime zoekt elke minuut naar de Event Hubs, en wacht erop tot de opdracht ze heeft aangemaakt.

### De opdracht uitvoeren in Azure Cloud Shell

Kopieer de opdracht, voer hem uit in Azure Cloud Shell en wacht tot hij klaar is. Hij noemt elke regio waarin hij een Event Hub heeft aangemaakt, hoeveel resources ernaar sturen en welke resources hij heeft overgeslagen, met de reden van Azure.

### De opdracht voor Microsoft Entra ID uitvoeren, als u die hebt gekozen

Zodra de eerste opdracht klaar is, voert een Security Administrator van de tenant de tweede uit in Azure Cloud Shell. Die geeft de tenant een diagnostische instelling die de aanmeldings-, audit- en risicologboeken van Microsoft Entra ID naar de Event Hub van de eerste regio stuurt, en zegt wat Azure vroeg als het weigert.

### Wachten op de eerste events

Het venster vraagt om de paar seconden wat er binnenkwam. Azure begint enkele minuten nadat de opdracht klaar is te sturen; het venster zegt dan wat er van waar kwam, en de rij van de koppeling zegt **Streamt**.
:::

**Meer velden** bevat de rest:

| Veld | Wat het doet |
| --- | --- |
| **Abonnementen** | De abonnementen om uit te streamen: eerst de abonnementen die de koppeling leest. Het eerste bevat de Event Hubs, en OneUptime leest ze daar. Maximaal 50 |
| **Op een andere manier instellen** | De namen die de opdracht gebruikt, om het met Terraform of de portal in te stellen |

Als de koppeling nog geen abonnement heeft gelezen, of meer dan 50, vraagt het venster in plaats daarvan vóór zijn stappen om **Abonnementen**.

Als het eerste abonnement niet het abonnement is waarin OneUptime de Event Hubs leest, zegt het venster dat: kies **Daar lezen** voordat u de opdracht uitvoert.

## Wat er binnenkomt

| Wat | Waar het terechtkomt |
| --- | --- |
| Belangrijke metrieken | Bij de cloudresources die ze meten, in dezelfde reeksen die de leesacties van de koppeling schrijven |
| Resourcelogboeken | In de logboekverkenner, onder de telemetrieservice van de koppeling, met het abonnement, de regio en de categorie als attributen |
| Logboeken van een resource die OneUptime kent | Ook bij die resource: haar pagina in Cloud krijgt een tabblad **Logboeken** |

De stream draagt de belangrijke metrieken die de koppeling per minuut leest. De leesacties blijven de rest volgens hun schema schrijven: een metriek die ze grover lezen, zoals de gebruikte opslag van een containerregister, en elke belangrijke metriek die een diagnostische instelling niet kan sturen, die de lijst met ondersteunde metrieken van Azure Monitor in de kolom DS Export als niet exporteerbaar markeert:

{{AZURE_STREAM_KEPT_METRICS}}

Een Service Bus- of Event Hubs-namespace streamt geen metrieken. De leesacties lezen zijn belangrijke metrieken voor elke wachtrij, elk topic en elke Event Hub, en de eigen totalen van de namespace tellen die op, terwijl een diagnostische instelling alleen de totalen van de namespace stuurt, en 4 van de 6 belangrijke metrieken van een Service Bus-namespace of 2 van de 4 van een Event Hubs-namespace helemaal niet. Dus schrijven de leesacties ze allemaal, met of zonder stream, en telt geen bericht dubbel.

Een logboekregel wordt onder zijn resource gearchiveerd via de ARM-ID van de resource, meegegeven als `cloud.resource_id`, en houdt zijn categorie, bewerking, resultaat en eigenschappen als attributen, zoals `azure.category`.

Een record van het activiteitenlogboek in de categorie `Administrative`, `Security` of `Policy`, en een aanmeldings-, audit- of risicorecord van Microsoft Entra ID, komen in hun geheel aan, als de tekst van hun logboekregel, ook een over een resourcegroep, een abonnement of de tenant in plaats van een resource. Met [Beveiligingsgebeurtenissen in uw logboeken vinden](/docs/telemetry/security-events#beveiligingsgebeurtenissen-in-uw-logs-vinden) aan wordt elk record gelezen als een beveiligingsgebeurtenis, net als een uit een logpijplijn, en één keer opgeslagen, langs hoeveel wegen het OneUptime ook bereikt. Met **Activiteitenlogboek van elk abonnement** aan geeft de opdracht elk abonnement een diagnostische instelling die het activiteitenlogboek naar de Event Hub van de eerste regio stuurt, en de opdracht voor Microsoft Entra ID geeft de tenant er een.

De `AuditEvent` van een Key Vault, de `StorageRead`, `StorageWrite` en `StorageDelete` van een opslagaccount en de `SQLSecurityAuditEvents` van een Azure SQL-database komen ook in hun geheel aan, elk gearchiveerd onder zijn resource, en Beveiligingsgebeurtenissen leest de records die voor de beveiliging tellen: zie [Eigen auditlogs van Azure-resources](/docs/telemetry/security-events#eigen-auditlogs-van-azure-resources). Een Azure SQL-database stuurt zijn audit pas als auditing erop aanstaat, met Azure Monitor als bestemming.

Virtuele machines, schaalsets, schijven, netwerkinterfaces, virtuele netwerken, privé-eindpunten, NAT-gateways, DNS-zones en App Service-plannen sturen geen eigen resourcelogboeken, dus hun pagina's hebben geen tabblad **Logboeken**. De logboeken van een container-app zijn die van haar omgeving.

De logboeken van een opslagaccount zijn die van zijn blob-, bestands-, wachtrij- en tabelservices: de opdracht geeft elke service een eigen diagnostische instelling, en hun logboeken worden onder het account gearchiveerd, op het tabblad **Logboeken** ervan. Het zijn alle verzoeken die het account beantwoordt, dus een druk account stuurt er veel.

## Wat de opdracht aanmaakt

De resourcegroep heet `oneuptime-stream-` gevolgd door de eerste 8 tekens van de ID van de koppeling. Hij geeft OneUptime geen toegang tot uw resources: de app van de koppeling mag de Event Hubs lezen, en meer niet.

| Resource | Wat ze mag |
| --- | --- |
| Een resourcegroep, `oneuptime-stream-<suffix>`, in het eerste abonnement | Bevat de Event Hubs, getagd met de ID van de koppeling als `oneuptime-connection` |
| Een Event Hubs-namespace in elke regio, `oneuptime-<suffix>-<region>`, in de laag Standard met 1 doorvoereenheid | Neemt aan wat de diagnostische instellingen van haar regio sturen |
| Een Event Hub in elke namespace, `oneuptime`, met 2 partities | Bewaart de events tot OneUptime ze leest |
| De rol **Azure Event Hubs Data Receiver** voor de app van de koppeling, alleen op de resourcegroep | Laat de app de Event Hubs lezen, en verder niets |
| Een diagnostische instelling op elke resource, `OneUptime-<suffix>` | Stuurt de metrieken, de logboeken of beide van de resource naar de Event Hub van haar regio |
| Met logboeken, een diagnostische instelling op elk van de blob-, bestands-, wachtrij- en tabelservices van een opslagaccount, `OneUptime-<suffix>` | Stuurt de logboeken van de services naar de Event Hub van de regio van het account |
| Met **Activiteitenlogboek van elk abonnement**, een diagnostische instelling op elk abonnement, `OneUptime-<suffix>` | Stuurt de records `Administrative`, `Security` en `Policy` ervan naar de Event Hub van de eerste regio |
| Met de opdracht voor Microsoft Entra ID, de diagnostische instelling van de tenant, `OneUptime-<suffix>` | Stuurt de aanmeldings-, audit- en risicologboeken ervan naar de Event Hub van de eerste regio |

Een resource van een globale regio, zoals Front Door, stuurt naar de Event Hub van de eerste regio. Een resource waarvan Azure alleen metrieken of alleen logboeken bijhoudt, wordt ingesteld met wat ze heeft, en een die al 5 diagnostische instellingen heeft, het maximum dat Azure toestaat, wordt overgeslagen. Azure brengt de doorvoereenheid van elke namespace per uur in rekening, en de events die de diagnostische instellingen sturen.

## Streamen stoppen

:::steps
### Het lezen stoppen

Kies in de rij van het abonnement onder **Cloud → Koppelen** **Streamen stoppen**. OneUptime stopt direct met het lezen van de Event Hubs, en de koppeling leest al haar metrieken weer volgens schema. Wat is gelezen, blijft.

### Verwijderen wat de opdracht heeft aangemaakt

De Event Hubs en de diagnostische instellingen blijven in Azure, en Azure brengt ze in rekening, totdat ze worden verwijderd. Het venster toont de opdracht: die verwijdert de diagnostische instelling van elke resource, die van de services van de opslagaccounts en die van elk abonnement, en daarna de resourcegroep, in welk abonnement die ook staat. Hij verwijdert ook de instelling van Microsoft Entra ID als u dat mag, en zegt anders wie het mag.

```bash
oneuptime_stream_stop() {
  local SUB ID TYPE SERVICE N=0
  for SUB in '11111111-aaaa-4aaa-8aaa-111111111111' '22222222-bbbb-4bbb-8bbb-222222222222'; do
    while IFS=$'\t' read -r ID TYPE; do
      if [ -z "$ID" ]; then continue; fi
      az monitor diagnostic-settings delete --name OneUptime-6f1c3a2e --resource "$ID" --output none 2> /dev/null &
      N=$((N + 1))
      if [ $((N % 4)) -eq 0 ]; then wait; fi
      if [ "${TYPE,,}" = microsoft.storage/storageaccounts ]; then
        for SERVICE in blobServices fileServices queueServices tableServices; do
          az monitor diagnostic-settings delete --name OneUptime-6f1c3a2e --resource "$ID/$SERVICE/default" --output none 2> /dev/null &
          N=$((N + 1))
          if [ $((N % 4)) -eq 0 ]; then wait; fi
        done
      fi
    done < <(az resource list --subscription "$SUB" --query "[].[id, type]" --output tsv)
    az monitor diagnostic-settings subscription delete --subscription "$SUB" --name OneUptime-6f1c3a2e --yes --output none 2> /dev/null
  done
  wait
  if az rest --method get --url "/providers/microsoft.aadiam/diagnosticSettings/OneUptime-6f1c3a2e?api-version=2017-04-01" --output none 2> /dev/null; then
    az rest --method delete --url "/providers/microsoft.aadiam/diagnosticSettings/OneUptime-6f1c3a2e?api-version=2017-04-01" --output none 2> /dev/null && echo "Deleted Microsoft Entra ID's diagnostic setting OneUptime-6f1c3a2e." || echo "Microsoft Entra ID's diagnostic setting OneUptime-6f1c3a2e is left: a Security Administrator of the tenant deletes it, under Diagnostic settings in the Microsoft Entra admin center."
  fi
  for SUB in '11111111-aaaa-4aaa-8aaa-111111111111' '22222222-bbbb-4bbb-8bbb-222222222222'; do
    if [ "$(az group exists --subscription "$SUB" --name oneuptime-stream-6f1c3a2e 2> /dev/null)" = true ]; then
      az group delete --subscription "$SUB" --name oneuptime-stream-6f1c3a2e --yes --no-wait && echo "Deleting oneuptime-stream-6f1c3a2e in $SUB."
    fi
  done
}
oneuptime_stream_stop
```
:::

Om te wijzigen wat er gestreamd wordt, opent u opnieuw **Metrieken en logboeken streamen**, kiest u wat er gestreamd wordt en voert u de nieuwe opdracht uit: die werkt bij wat de eerste keer is aangemaakt, en maakt niets dubbel aan.

## Op een andere manier instellen

Maak met Terraform of de portal aan wat de opdracht aanmaakt, met deze namen:

| Instelling | Waarde |
| --- | --- |
| Resourcegroep | `oneuptime-stream-<suffix>`, in het abonnement waarin OneUptime de Event Hubs leest |
| Event Hubs-namespace | `oneuptime-<suffix>-<region>`, één in elke regio van een resource om te streamen |
| Event Hub | `oneuptime`, in elke namespace |
| Diagnostische instelling | `OneUptime-<suffix>` op elke resource, naar de Event Hub van haar regio, met de regel `RootManageSharedAccessKey` van de namespace |
| Rol | **Azure Event Hubs Data Receiver** voor de app van de koppeling, op de resourcegroep |

Zet daarna het lezen aan, met dat abonnement als eerste onder **Abonnementen**.

## Problemen oplossen

:::details Het venster blijft wachten op de eerste events
Controleer of de opdracht klaar is en heeft gezegd dat de Event Hub van een regio klaarstaat: `az eventhubs namespace list --resource-group oneuptime-stream-6f1c3a2e` toont de namespaces. Een diagnostische instelling stuurt alleen wat Azure Monitor heeft, dus een resource die niets doet, stuurt weinig. Een nieuwe rol kan een paar minuten nodig hebben om van kracht te worden: tot dan zien de leesacties de events niet.
:::

:::details De koppeling zegt Stream mislukt
Het venster en de tooltip van de rij zeggen waarom. Als de app de Event Hubs niet mag lezen, voert u de opdracht opnieuw uit: die geeft de app haar rol opnieuw. Als OneUptime ze niet kon bereiken, controleert u of de namespaces verbindingen vanaf internet aannemen, en of een zelf gehoste OneUptime poort 9093 mag bereiken.
:::

:::details De opdracht heeft resources overgeslagen
Hij somt ze op, elk met de reden van Azure. Een resource van een type zonder diagnostische instellingen stuurt niets, en bij een resource die al 5 diagnostische instellingen heeft, moet er eerst een worden verwijderd. Voer de opdracht daarna opnieuw uit.
:::

:::details Het activiteitenlogboek of de logboeken van Microsoft Entra ID zijn overgeslagen
De opdracht zegt wat Azure vroeg. De diagnostische instelling van een abonnement vereist `Microsoft.Insights/diagnosticSettings/write` op het abonnement, een recht dat de Owner, Contributor en Monitoring Contributor ervan hebben, en die van de tenant vereist een Security Administrator van de tenant. Beide vereisen `Microsoft.EventHub/namespaces/authorizationRules/listKeys/action` op de resourcegroep die de opdracht aanmaakt, een recht dat de Owner en Contributor ervan hebben. Voer de opdracht daarna opnieuw uit.
:::

## Volgende stappen

:::cards
- [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts): Wat een koppeling leest, en hoe vaak.
- [Google Cloud-logboeken streamen](/docs/telemetry/cloud-streaming-google-cloud): De logboeken van een Google Cloud-project, gepusht via Pub/Sub.
- [CloudWatch-metrieken en -logboeken streamen](/docs/telemetry/cloud-streaming): Die van een AWS-account, geleverd door Amazon Data Firehose.
- [Logboekverkenner](/docs/telemetry/logs-explorer): Doorzoek en filter wat de streams hebben geleverd.
:::
