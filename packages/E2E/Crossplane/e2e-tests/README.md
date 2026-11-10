# Crossplane Provider E2E Tests

End-to-end tests of the OneUptime Crossplane provider (`Scripts/CrossplaneProvider`): the package
`Scripts/CrossplaneProvider/build-package.sh` builds, installed by Crossplane in a kind cluster, managing a project of a
running OneUptime through its API.

The `Crossplane Provider` workflow (`.github/workflows/crossplane-provider.yml`) runs them on pull requests that change
the generators, this test or the English Crossplane docs pages, on main every night, and in every release before the
package is published (`release.yml`, `publish-crossplane-provider`).

## Directory structure

```
e2e-tests/
├── scripts/
│   ├── run-tests.sh      # The whole test: cluster, package, Crossplane, every check, cleanup
│   └── lib.sh            # Helpers run-tests.sh sources (kubectl, the API, waits, checks)
└── manifests/
    ├── provider.yaml     # A DeploymentRuntimeConfig (--poll=20s) and the Provider
    ├── credentials.yaml  # A ProviderConfig in the test namespace, and a ClusterProviderConfig whose
    │                     # Secret is JSON that names the URL
    ├── observed.yaml     # The project's Offline/Operational statuses and Critical Incident severity, observed by ID
    ├── resources.yaml    # A Label, a Team, a StatusPage, a TelemetryIngestionKey and a Monitor that refers to them
    └── imported.yaml     # A Label made outside Kubernetes, observed by its ID
```

The manifests hold `${NAME}` placeholders, which `run-tests.sh` fills in (`render` in `lib.sh`); one it does not fill
fails the test.

## What it checks

1. A kind cluster with a registry it pulls from; the package pushed there; Crossplane installed with Helm, and the
   package installed by Crossplane: `Installed` and `Healthy`, with every kind of the package established.
2. Every manifest of the English docs pages `packages/App/FeatureSet/Docs/Content/en/crossplane/*.md` (each YAML block
   with an `apiVersion`, the package's tag filled in) is checked by the API server against the installed kinds
   (`kubectl apply --dry-run=server --validate=strict`): a field the provider does not have fails the test.
3. The API key through a namespace's `ProviderConfig`, and through a `ClusterProviderConfig` that reads JSON
   credentials from a Secret of another namespace.
4. Statuses and a severity the project has, observed by their IDs; a label, a team, a status page, a telemetry
   ingestion key and a monitor created, each checked in OneUptime through the API: references resolved to IDs (two
   and three levels into the monitor's steps too), the telemetry key's secret in its connection Secret and not in the
   resource.
5. A steady state: no update for a while after everything is ready. Then an update, a change made in OneUptime put
   back by the provider, a label imported by its ID and dropped without deleting it, and every created record deleted
   (404 from the API), its connection Secret with it, while observed records stay.

## Running it

It needs docker, kind, kubectl, helm, the crossplane CLI, curl and jq, a running OneUptime, and an API key of a test
project with the ProjectOwner permission. `.github/actions/setup-crossplane-tools` pins the crossplane CLI and kind
CI uses.

```bash
# Generate the Terraform provider and the Crossplane provider from it, then build the package
npm run generate-terraform-provider
npm run generate-crossplane-provider
bash Scripts/CrossplaneProvider/build-package.sh --version "$(head -n 1 VERSION)" --platforms linux/amd64

# A test user, project and API key, written to the Terraform suite's test-env.sh
bash packages/E2E/Terraform/e2e-tests/scripts/setup-test-account.sh
source packages/E2E/Terraform/e2e-tests/test-env.sh

bash packages/E2E/Crossplane/e2e-tests/scripts/run-tests.sh
```

When OneUptime runs on this machine (`ONEUPTIME_URL` is `localhost` or `127.0.0.1`), the cluster reaches it through
the gateway of kind's Docker network, at the same port.

### Settings

| Variable | Default | What it is |
| --- | --- | --- |
| `ONEUPTIME_URL` | (required) | The OneUptime this machine reaches, such as `http://localhost`. |
| `ONEUPTIME_API_KEY` | (required) | An API key of the test project, with the ProjectOwner permission. |
| `CROSSPLANE_E2E_ONEUPTIME_URL` | `ONEUPTIME_URL`, through kind's gateway for localhost | The OneUptime as the cluster reaches it. |
| `CROSSPLANE_E2E_PACKAGE` | `Crossplane/packages/provider-oneuptime-<arch>.xpkg` | The package to install. |
| `CROSSPLANE_E2E_VERSION` | `Crossplane/provider-oneuptime/VERSION`, else `VERSION` | The package's version, tagged `v<version>`. |
| `CROSSPLANE_E2E_CLUSTER` | `oneuptime-crossplane-e2e` | The kind cluster's name; the registry is `<cluster>-registry`. |
| `CROSSPLANE_E2E_CROSSPLANE_VERSION` | `2.4.3` | The Crossplane Helm chart's version. |
| `CROSSPLANE_E2E_REGISTRY_IMAGE` | `registry:2.8.3` | The registry the cluster pulls the package from. |
| `CROSSPLANE_E2E_RUN_ID` | the time | A suffix for the names it makes in OneUptime. |
| `CROSSPLANE_E2E_WORK_DIR` | a new temporary directory | Where the kubeconfig, Helm's cache and the logs go. |
| `KEEP_CLUSTER` | `false` | `true` keeps the cluster and the registry after the run, to look around. |

A cluster or registry of the same name that is already there fails the run rather than being reused, and the run
removes only what it made. On a failure it prints the provider's logs, the managed resources and their events.
