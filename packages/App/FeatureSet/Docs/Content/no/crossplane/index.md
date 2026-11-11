# Crossplane – Oversikt

OneUptimes Crossplane-provider administrerer OneUptime-prosjektet ditt fra Kubernetes. Beskriv monitorer, statussider, vaktpolicyer, team, etiketter og de andre postene i prosjektet ditt som Kubernetes-ressurser, så sørger Crossplane for at prosjektet ditt er slik de beskriver det: den oppretter det som er nytt, endrer det du redigerer, setter tilbake det noen har endret et annet sted, og sletter det du fjerner. Argo CD, Flux og alle andre verktøy som tar i bruk manifester, tar i bruk disse også. Den virker med OneUptime Cloud og med en selv-hostet OneUptime.

:::cards
- [Slik virker provideren](#slik-virker-provideren): Ressurstyper, navnerom og API-nøkkelen bak dem.
- [Installer provideren](#installer-provideren): Pakken, og hvilken versjon du skal velge.
- [Gi provideren API-nøkkelen din](#gi-provideren-api-nøkkelen-din): En Secret og en ProviderConfig i navnerommet ditt.
- [Opprett de første ressursene dine](#opprett-de-første-ressursene-dine): En monitor, etiketten den har, og statusene den setter.
:::

## Slik virker provideren

Provideren er en Crossplane-pakke. Når den er installert, legger den til en ressurstype i API-gruppen `crossplane.oneuptime.com` for hver type post i OneUptime-API-et: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` og over 400 til. Hver ressurs av disse typene ligger i et navnerom og står for én post i prosjektet ditt. Provideren leser og endrer posten via OneUptimes REST API, med en API-nøkkel til prosjektet ditt, og skriver det den finner, inn i ressursens status.

Provideren er laget fra [Terraform-provideren](/docs/terraform/index), utgivelse for utgivelse: ressurstypene er Terraform-providerens ressurser, med de samme feltene og de samme API-forespørslene bak seg.

## Før du begynner

- **Crossplane 2.0 eller nyere.** Providerens ressurser ligger i navnerom, noe som kom med Crossplane 2. Crossplanes egen dokumentasjon viser hvordan du installerer Crossplane i klyngen din.
- **En API-nøkkel til prosjektet ditt.** [Hurtigstart](/docs/terraform/quick-start#opprett-en-api-nøkkel-til-prosjektet) for Terraform viser hvordan du oppretter en under **Prosjektinnstillinger → Avansert → API-nøkler**. Nøkkelen avgjør hvilket prosjekt ressursene hører til, og hva provideren kan endre i det.
- **På OneUptime Cloud abonnementet Growth eller høyere.** Et prosjekts API-nøkler virker bare på det.

## Installer provideren

Installer pakken med en `Provider`:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

Når både `INSTALLED` og `HEALTHY` viser `True`, kjører provideren. Den samme pakken ligger på Docker Hub, som `docker.io/oneuptime/provider-oneuptime`.

### Velg en versjon

Pakkens versjoner følger OneUptimes: `{{CROSSPLANE_PROVIDER_VERSION}}` er laget fra den utgivelsen av OneUptime som leverer denne siden. På OneUptime Cloud bruker du den nyeste. På en selv-hostet OneUptime bruker du versjonen til OneUptime-en din, slik at provideren kjenner de samme feltene som API-et til OneUptime-en din.

### Aktiver bare ressurstypene du bruker

Crossplanes Helm-chart aktiverer som standard alle ressurstyper fra alle providere (chartets verdi `provider.defaultActivations`), og for denne provideren er det over 400 egendefinerte ressursdefinisjoner. For å aktivere bare ressurstypene du bruker, installerer du Crossplane med `--set provider.defaultActivations={}` og nevner ressurstypene i en policy:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## Gi provideren API-nøkkelen din

Legg nøkkelen i en Secret i navnerommet som ressursene dine skal ligge i, og la en `ProviderConfig` i det samme navnerommet peke på den. Når du oppretter Secreten med `kubectl`, holdes nøkkelen utenfor filene dine:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

En `ProviderConfig` leser bare Secrets i sitt eget navnerom, så nøkkelen i ett navnerom kan ikke brukes fra et annet. Hver ressurs nevner sin `ProviderConfig` i `spec.providerConfigRef`.

### Bruk en selv-hostet OneUptime

Gi `ProviderConfig`-en adressen til OneUptime-en din som `url`, uten `/api`:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### Del én nøkkel mellom navnerom

En `ClusterProviderConfig` leser en Secret i et hvilket som helst navnerom, og ressurser i alle navnerom kan nevne den. Bruk en når ett enkelt team tar seg av nøkkelen for hele klyngen:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

En ressurs nevner den med `kind: ClusterProviderConfig` i sin `providerConfigRef`. Secreten inneholder bare nøkkelen, eller JSON som også oppgir adressen: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. En `url` i `ClusterProviderConfig`-en går foran adressen i JSON-en. En `ClusterProviderConfig` kan også lese nøkkelen fra en miljøvariabel eller en fil i providerens pod, med `source: Environment` eller `source: Filesystem`.

## Opprett de første ressursene dine

En monitor for startsiden din, med en etikett, som setter prosjektets statuser **Frakoblet** og **I drift**.

:::steps
### Observer statusene den setter

OneUptime opprettet prosjektets statuser sammen med prosjektet, så de observeres i stedet for å bli opprettet: provideren leser dem via ID-ene deres og endrer eller sletter dem aldri. `oneuptime monitor-status list --fields _id,name` lister ID-ene, med [OneUptime-CLI-en](/docs/cli/resource-operations#list-poster).

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### Opprett etiketten og monitoren

Monitoren nevner etiketten og statusene ved Kubernetes-navnene deres, og provideren fyller inn ID-ene deres:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### Se dem i OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Når `SYNCED` og `READY` viser `True`, er posten i prosjektet ditt. `EXTERNAL-NAME` er ID-en dens i OneUptime.
:::

## Neste steg

- [Administrere ressurser](/docs/crossplane/managing-resources) forklarer ressurstypene og feltene deres, referanser, import av det du allerede har, hemmelighetene som OneUptime lager, og hva du skal se på når en ressurs ikke er klar.
- [Komplett guide](/docs/terraform/complete-guide) for Terraform beskriver ressursene og feltene deres, som er de samme for providerens ressurstyper.
