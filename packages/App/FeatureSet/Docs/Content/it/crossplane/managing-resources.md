# Gestire le risorse

Questa pagina tratta le risorse del provider una volta che le prime sono in funzione: come si chiamano i kind e i campi, come le risorse fanno riferimento l'una all'altra, come importare ciò che il tuo progetto ha già, i segreti che OneUptime genera, cosa succede alle modifiche fatte fuori da Kubernetes e cosa controllare quando una risorsa non è pronta. Per installare il provider e creare le prime risorse, parti dalla [Panoramica di Crossplane](/docs/crossplane/index).

:::cards
- [Kind e campi](#kind-e-campi): Le risorse Terraform da cui derivano, e come si chiamano.
- [Fare riferimento ad altre risorse](#fare-riferimento-ad-altre-risorse): Nomi al posto degli ID, a qualsiasi profondità dei passaggi di un monitor.
- [Importare ciò che hai già](#importare-ciò-che-hai-già): Osserva un record tramite il suo ID, poi prendine il controllo.
- [Risolvere i problemi di una risorsa](#risolvere-i-problemi-di-una-risorsa): Le sue condizioni, i suoi eventi e i log del provider.
:::

## Kind e campi

Ogni risorsa del [provider Terraform](/docs/terraform/index) è un kind, con il nome in CamelCase: `oneuptime_status_page` diventa `StatusPage`, e `oneuptime_on_call_policy` diventa `OnCallPolicy`. A un nome che finirebbe in Spec, Status o List si aggiunge Definition, quindi `oneuptime_monitor_status` diventa `MonitorStatusDefinition`. Alcuni dei kind:

| Kind | Rappresenta | Risorsa Terraform |
| --- | --- | --- |
| `Monitor` | Un monitor | `oneuptime_monitor` |
| `StatusPage` | Una pagina di stato | `oneuptime_status_page` |
| `OnCallPolicy` | Una politica di reperibilità | `oneuptime_on_call_policy` |
| `Team` | Un team | `oneuptime_team` |
| `Label` | Un'etichetta | `oneuptime_label` |
| `IncidentSeverity` | Una gravità di incidente | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Uno stato del monitor | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Una chiave di acquisizione della telemetria | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` elenca ogni kind attivato nel tuo cluster.

I campi di un kind sono gli argomenti della risorsa Terraform, in camelCase, sotto `spec.forProvider`: `monitoring_interval` diventa `monitoringInterval`. Un campo che Terraform scrive con `jsonencode()` accetta una stringa JSON. `kubectl explain` descrive ogni campo come fa il provider Terraform, e la [Guida completa di Terraform](/docs/terraform/complete-guide) mostra come si usano:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` mostra il record così come lo ha OneUptime, con il suo `id`. Un campo che lasci fuori e che OneUptime compila, come un valore predefinito, viene copiato in `spec.forProvider` dopo la creazione del record, così il controllo successivo non trova nulla da modificare.

## Fare riferimento ad altre risorse

Ogni campo che contiene l'ID di un altro record accetta anche un riferimento alla risorsa che lo rappresenta. `<field>Ref` indica una risorsa dello stesso namespace, e `<field>Selector` ne sceglie una in base alle sue etichette Kubernetes. Un elenco di ID, come `labels`, accetta `labelsRefs` e `labelsSelector`. Il provider attende che la risorsa a cui si fa riferimento esista in OneUptime, poi ne inserisce l'ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

I riferimenti arrivano anche dentro i passaggi di un monitor: lo stato di un criterio (`monitorStatusIdRef`), e la gravità, i team proprietari, le politiche di reperibilità e le etichette degli incidenti e degli avvisi che crea (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Non esiste un kind per una persona: un campo indica qualcuno tramite il suo ID utente, come fa `ownerUserIds`, e molti kind accettano accanto all'ID il suo indirizzo email, come fa `TeamMember` in `userEmail` ([Persone e team](/docs/terraform/people-and-teams)).

## Importare ciò che hai già

Una risorsa che osserva un record lo legge tramite il suo ID e non lo modifica né lo elimina mai. Imposta l'ID come nome esterno della risorsa, e `Observe` come sua unica politica di gestione:

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

L'ID del record si trova nel blocco `import` che la sua pagina **Sviluppatori → Terraform** scrive nella dashboard, e `oneuptime <resource> list` elenca gli ID di un tipo di record con la [CLI di OneUptime](/docs/cli/resource-operations#elencare-i-record). Quando la risorsa è pronta, `status.atProvider` mostra il record. Per gestirlo da quel momento in poi, scrivi i suoi campi in `spec.forProvider` e imposta `managementPolicies` su `["*"]`.

## Segreti

### Segreti generati da OneUptime

Alcuni record hanno un segreto generato da OneUptime, come quello di una chiave di acquisizione della telemetria. Il provider non lo mette mai nella risorsa: lo scrive in un Secret del namespace della risorsa, indicato da `writeConnectionSecretToRef`, sotto una chiave formata da `attribute.` e dal nome dell'attributo Terraform:

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

Eliminando la risorsa si elimina anche il Secret.

### Segreti che fornisci tu

Un campo che contiene un segreto, come la passphrase della chiave client TLS di un passaggio del monitor, accetta un Secret del namespace della risorsa al posto di un valore: `tlsClientKeyPassphraseSecretRef`, con il `name` e la `key` del Secret.

## Modifiche fatte fuori da Kubernetes

Il provider confronta ogni risorsa con il suo record ogni 10 minuti e ripristina tutto ciò che qualcuno ha cambiato in OneUptime. Per controllare più spesso, dai al provider una configurazione di runtime con `--poll`:

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

Per affidare un campo alla dashboard dopo la creazione del record, scrivilo in `spec.initProvider` invece che in `spec.forProvider`: viene usato per creare il record e non viene mai ripristinato. Per affidare alla dashboard l'intero record, togli `Update` dalle politiche di gestione della risorsa: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Eliminare una risorsa

Eliminare una risorsa elimina il suo record in OneUptime. Per conservare il record, togli `Delete` dalle politiche di gestione della risorsa prima di eliminarla: `["Observe", "Create", "Update", "LateInitialize"]`. Una risorsa che si limita a osservare non elimina mai il suo record.

## Risolvere i problemi di una risorsa

`kubectl -n team-a get managed` mostra `SYNCED` e `READY` di ogni risorsa. Quando uno dei due non è `True`, le condizioni e gli eventi della risorsa dicono perché, con la risposta di OneUptime quando l'API ha rifiutato una richiesta:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Messaggio | Cosa controllare |
| --- | --- |
| `cannot read the API key` | Il Secret indicato dal `ProviderConfig`, o la chiave al suo interno. |
| `cannot get referenced ProviderConfig` | La risorsa indica un `ProviderConfig` che il suo namespace non ha. Per uno a livello di cluster, usa `kind: ClusterProviderConfig`. |
| Un riferimento che non si può risolvere | La risorsa a cui punta manca dal namespace, oppure non è ancora pronta. |
| Un errore dall'API di OneUptime | Le autorizzazioni della chiave API, e il valore del campo indicato dall'errore. |

I log del provider dicono di più, e ancora di più con `--debug` aggiunto ai suoi `args`, come `--poll` qui sopra:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verificare il pacchetto

Ogni release firma il pacchetto con cosign di Sigstore, in modalità keyless, come firma le immagini di OneUptime. Per verificare un pacchetto prima di installarlo:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
