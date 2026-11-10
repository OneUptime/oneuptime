# Administrere ressurser

Denne siden handler om providerens ressurser når de første er i gang: hvordan ressurstyper og felt navngis, hvordan ressurser refererer til hverandre, hvordan du tar inn det prosjektet ditt allerede har, hemmelighetene som OneUptime lager, hva som skjer med endringer som gjøres utenfor Kubernetes, og hva du skal se på når en ressurs ikke er klar. For å installere provideren og opprette de første ressursene dine starter du med [Crossplane – Oversikt](/docs/crossplane/index).

:::cards
- [Ressurstyper og felt](#ressurstyper-og-felt): Terraform-ressursene de er laget fra, og hvordan de navngis.
- [Referer til andre ressurser](#referer-til-andre-ressurser): Navn i stedet for ID-er, på alle nivåer i en monitors trinn.
- [Importer det du allerede har](#importer-det-du-allerede-har): Observer en post via ID-en, og ta den deretter over.
- [Feilsøk en ressurs](#feilsøk-en-ressurs): Betingelsene og hendelsene dens, og providerens logger.
:::

## Ressurstyper og felt

Hver ressurs i [Terraform-provideren](/docs/terraform/index) blir en ressurstype, navngitt i CamelCase: `oneuptime_status_page` blir `StatusPage`, og `oneuptime_on_call_policy` blir `OnCallPolicy`. Et navn som ville ende på Spec, Status eller List, får Definition lagt til, så `oneuptime_monitor_status` blir `MonitorStatusDefinition`. Noen av ressurstypene:

| Ressurstype | Står for | Terraform-ressurs |
| --- | --- | --- |
| `Monitor` | En monitor | `oneuptime_monitor` |
| `StatusPage` | En statusside | `oneuptime_status_page` |
| `OnCallPolicy` | En vaktpolicy | `oneuptime_on_call_policy` |
| `Team` | Et team | `oneuptime_team` |
| `Label` | En etikett | `oneuptime_label` |
| `IncidentSeverity` | En alvorlighetsgrad for hendelser | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | En monitorstatus | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | En inntaksnøkkel for telemetri | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` lister alle ressurstypene klyngen din har aktivert.

Feltene til en ressurstype er Terraform-ressursens argumenter, i camelCase, under `spec.forProvider`: `monitoring_interval` blir `monitoringInterval`. Et felt som Terraform skriver med `jsonencode()`, tar en JSON-streng. `kubectl explain` beskriver hvert felt slik Terraform-provideren gjør, og [Komplett guide](/docs/terraform/complete-guide) for Terraform viser hvordan de brukes:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` viser posten slik OneUptime har den, med `id`-en dens. Et felt du utelater, men som OneUptime fyller ut, for eksempel en standardverdi, kopieres inn i `spec.forProvider` etter at posten er opprettet, slik at neste sjekk ikke finner noe å endre.

## Referer til andre ressurser

Hvert felt som inneholder ID-en til en annen post, tar også en referanse til ressursen som står for den posten. `<field>Ref` nevner en ressurs i det samme navnerommet, og `<field>Selector` velger en ut fra Kubernetes-etikettene dens. En liste med ID-er, som `labels`, tar `labelsRefs` og `labelsSelector`. Provideren venter til ressursen det refereres til, finnes i OneUptime, og fyller deretter inn ID-en dens.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Referanser når også inn i en monitors trinn: statusen til et kriterium (`monitorStatusIdRef`), og alvorlighetsgraden, eierteamene, vaktpolicyene og etikettene til hendelsene og varslene det oppretter (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Det finnes ingen ressurstype for en person: et felt nevner noen ved bruker-ID-en deres, slik `ownerUserIds` gjør, og mange ressurstyper tar e-postadressen ved siden av, slik `TeamMember` gjør i `userEmail` ([Personer og team](/docs/terraform/people-and-teams)).

## Importer det du allerede har

En ressurs som observerer en post, leser den via ID-en og endrer eller sletter den aldri. Sett ID-en som ressursens eksterne navn, og `Observe` som den eneste administrasjonspolicyen:

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

Postens ID står i `import`-blokken som postens side **Utvikler → Terraform** skriver i dashbordet, og `oneuptime <resource> list` lister ID-ene til en type post med [OneUptime-CLI-en](/docs/cli/resource-operations#list-poster). Når ressursen er klar, viser `status.atProvider` posten. For å administrere den fra da av skriver du feltene dens i `spec.forProvider` og setter `managementPolicies` til `["*"]`.

## Hemmeligheter

### Hemmeligheter som OneUptime lager

Noen poster kommer med en hemmelighet som OneUptime lager, for eksempel den til en inntaksnøkkel for telemetri. Provideren legger den aldri i ressursen: den skriver den til en Secret i ressursens navnerom, angitt med `writeConnectionSecretToRef`, under `attribute.` fulgt av navnet på Terraform-attributtet:

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

Når du sletter ressursen, slettes også Secreten.

### Hemmeligheter du gir

Et felt som inneholder en hemmelighet, for eksempel passfrasen til TLS-klientnøkkelen i et monitortrinn, tar en Secret i ressursens navnerom i stedet for en verdi: `tlsClientKeyPassphraseSecretRef`, med Secretens `name` og `key`.

## Endringer gjort utenfor Kubernetes

Provideren sjekker hver ressurs mot posten sin hvert 10. minutt og setter tilbake det noen har endret i OneUptime. For å sjekke oftere gir du provideren en kjøretidskonfigurasjon med `--poll`:

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

For å la dashbordet bestemme over et felt etter at posten er opprettet, skriver du det i `spec.initProvider` i stedet for `spec.forProvider`: det brukes til å opprette posten og settes aldri tilbake. For å la dashbordet bestemme over hele posten utelater du `Update` fra administrasjonspolicyene dens: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Slett en ressurs

Når du sletter en ressurs, slettes posten dens i OneUptime. For å beholde posten utelater du `Delete` fra ressursens administrasjonspolicyer før du sletter den: `["Observe", "Create", "Update", "LateInitialize"]`. En ressurs som bare observerer, sletter aldri posten sin.

## Feilsøk en ressurs

`kubectl -n team-a get managed` viser `SYNCED` og `READY` for hver ressurs. Når en av dem ikke er `True`, forteller ressursens betingelser og hendelser hvorfor, med OneUptimes svar når API-et avviste en forespørsel:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Hva som står | Hva du bør sjekke |
| --- | --- |
| `cannot read the API key` | Secreten, eller nøkkelen i den, som `ProviderConfig`-en nevner. |
| `cannot get referenced ProviderConfig` | Ressursen nevner en `ProviderConfig` som navnerommet dens ikke har. Bruk `kind: ClusterProviderConfig` for en som gjelder hele klyngen. |
| En referanse som ikke kan løses opp | Ressursen den nevner, mangler i navnerommet eller er ikke klar ennå. |
| En feil fra OneUptime-API-et | API-nøkkelens tillatelser, og verdien i feltet som feilen nevner. |

Providerens logger sier mer, og enda mer når `--debug` legges til i `args`, slik `--poll` er lagt til ovenfor:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verifiser pakken

Ved hver utgivelse signeres pakken nøkkelløst med cosign fra Sigstore, slik OneUptimes images også signeres. For å sjekke en pakke før du installerer den:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
