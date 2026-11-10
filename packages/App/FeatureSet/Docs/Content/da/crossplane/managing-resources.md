# Administrer ressourcer

Denne side handler om providerens ressourcer, når de første kører: hvordan typer og felter navngives, hvordan ressourcer refererer til hinanden, hvordan du henter det ind, dit projekt allerede har, de hemmeligheder, OneUptime genererer, hvad der sker med ændringer foretaget uden for Kubernetes, og hvad du skal se efter, når en ressource ikke er klar. For at installere provideren og oprette dine første ressourcer skal du starte med [Crossplane – Oversigt](/docs/crossplane/index).

:::cards
- [Typer og felter](#typer-og-felter): De Terraform-ressourcer, de er lavet ud fra, og hvordan de navngives.
- [Referér til andre ressourcer](#referér-til-andre-ressourcer): Navne i stedet for ID'er, uanset hvor dybt i en monitors trin.
- [Importér det, du allerede har](#importér-det-du-allerede-har): Observér en post via dens ID, og overtag den derefter.
- [Fejlfind en ressource](#fejlfind-en-ressource): Dens betingelser, dens events og providerens logs.
:::

## Typer og felter

Hver ressource i [Terraform-provideren](/docs/terraform/index) er en type, navngivet i CamelCase: `oneuptime_status_page` er `StatusPage`, og `oneuptime_on_call_policy` er `OnCallPolicy`. Et navn, der ville ende på Spec, Status eller List, får tilføjet Definition, så `oneuptime_monitor_status` er `MonitorStatusDefinition`. Nogle af typerne:

| Type | Står for | Terraform-ressource |
| --- | --- | --- |
| `Monitor` | En monitor | `oneuptime_monitor` |
| `StatusPage` | En statusside | `oneuptime_status_page` |
| `OnCallPolicy` | En vagtpolitik | `oneuptime_on_call_policy` |
| `Team` | Et team | `oneuptime_team` |
| `Label` | En etiket | `oneuptime_label` |
| `IncidentSeverity` | En hændelsesalvorlighed | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | En monitorstatus | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | En telemetri-indtagelsesnøgle | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` viser alle de typer, din klynge har aktiveret.

En types felter er Terraform-ressourcens argumenter, i camelCase, under `spec.forProvider`: `monitoring_interval` er `monitoringInterval`. Et felt, som Terraform skriver med `jsonencode()`, tager en JSON-streng. `kubectl explain` beskriver hvert felt, som Terraform-provideren gør, og [Komplet vejledning til Terraform](/docs/terraform/complete-guide) viser, hvordan de bruges:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` viser posten, som OneUptime har den, med dens `id`. Et felt, du udelader, og som OneUptime udfylder, såsom en standardværdi, kopieres ind i `spec.forProvider`, efter at posten er oprettet, så det næste tjek ikke finder noget at ændre.

## Referér til andre ressourcer

Hvert felt, der indeholder ID'et på en anden post, tager også en reference til den ressource, der står for posten. `<field>Ref` angiver en ressource i samme namespace, og `<field>Selector` vælger en ud fra dens Kubernetes-labels. En liste af ID'er, såsom `labels`, tager `labelsRefs` og `labelsSelector`. Provideren venter, til den ressource, der refereres til, findes i OneUptime, og udfylder derefter dens ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Referencer når også ind i en monitors trin: et kriteriums status (`monitorStatusIdRef`) og alvorligheden, ejerteamene, vagtpolitikkerne og etiketterne for de hændelser og advarsler, det opretter (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Der er ingen type for en person: et felt angiver en person med vedkommendes bruger-ID, som `ownerUserIds` gør, og mange typer tager e-mailadressen ved siden af, som `TeamMember` gør i `userEmail` ([Personer og teams](/docs/terraform/people-and-teams)).

## Importér det, du allerede har

En ressource, der observerer en post, læser den via dens ID og ændrer eller sletter den aldrig. Angiv ID'et som ressourcens eksterne navn, og `Observe` som dens eneste administrationspolitik:

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

Postens ID står i den `import`-blok, som dens side **Udvikler → Terraform** skriver i dashboardet, og `oneuptime <resource> list` viser ID'erne for en slags post med [OneUptime-CLI'en](/docs/cli/resource-operations#vis-poster). Når ressourcen er klar, viser `status.atProvider` posten. For at administrere den fra da af skal du skrive dens felter i `spec.forProvider` og sætte `managementPolicies` til `["*"]`.

## Hemmeligheder

### Hemmeligheder, som OneUptime genererer

Nogle poster har en hemmelighed, som OneUptime genererer, såsom hemmeligheden i en telemetri-indtagelsesnøgle. Provideren lægger aldrig en sådan i ressourcen: den skriver den til en Secret i ressourcens namespace, angivet i `writeConnectionSecretToRef`, under `attribute.` efterfulgt af Terraform-attributtens navn:

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

Sletter du ressourcen, slettes denne Secret også.

### Hemmeligheder, du selv angiver

Et felt, der indeholder en hemmelighed, såsom adgangsfrasen til TLS-klientnøglen i et monitortrin, tager en Secret i ressourcens namespace i stedet for en værdi: `tlsClientKeyPassphraseSecretRef`, med denne Secrets `name` og `key`.

## Ændringer foretaget uden for Kubernetes

Provideren tjekker hver ressource mod dens post hvert 10. minut og gendanner alt, hvad nogen har ændret i OneUptime. For at tjekke oftere skal du give provideren en runtime-konfiguration med `--poll`:

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

For at lade dashboardet eje et felt, efter at posten er oprettet, skal du skrive det i `spec.initProvider` i stedet for `spec.forProvider`: det bruges til at oprette posten, og provideren gendanner det aldrig. For at lade dashboardet eje hele posten skal du holde `Update` ude af ressourcens administrationspolitikker: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Slet en ressource

Sletter du en ressource, slettes dens post i OneUptime. For at beholde posten skal du holde `Delete` ude af ressourcens administrationspolitikker, før du sletter den: `["Observe", "Create", "Update", "LateInitialize"]`. En ressource, der kun observerer, sletter aldrig sin post.

## Fejlfind en ressource

`kubectl -n team-a get managed` viser hver ressources `SYNCED` og `READY`. Når en af dem ikke er `True`, fortæller ressourcens betingelser og events hvorfor, med OneUptimes svar, når API'et har afvist en anmodning:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Hvad der står | Hvad du skal tjekke |
| --- | --- |
| `cannot read the API key` | Den Secret, eller nøglen i den, som `ProviderConfig` angiver. |
| `cannot get referenced ProviderConfig` | Ressourcen angiver en `ProviderConfig`, som dens namespace ikke har. Brug `kind: ClusterProviderConfig` til en, der gælder for hele klyngen. |
| En reference, der ikke kan opløses | Den ressource, den angiver, mangler i namespacet eller er ikke klar endnu. |
| En fejl fra OneUptime-API'et | API-nøglens tilladelser og værdien af det felt, fejlen nævner. |

Providerens logs siger mere, og endnu mere med `--debug` tilføjet til dens `args`, ligesom `--poll` er ovenfor:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verificér pakken

Hver udgivelse signerer pakken med Sigstores cosign, nøgleløst, ligesom den signerer OneUptimes images. Sådan tjekker du en pakke, før du installerer den:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
