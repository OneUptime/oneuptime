# Marketplace editions of the OneUptime chart

Self-hosted OneUptime Enterprise, sold as a Kubernetes application on three
cloud marketplaces and billed per user by the hour through each of them:

| Marketplace | Product | Billing | Built here |
| --- | --- | --- | --- |
| AWS Marketplace | Container product, Helm chart delivery on Amazon EKS | MeterUsage, dimension `users`, signed with IRSA | the chart, for `helm push` to the product's Marketplace ECR |
| Microsoft Marketplace | Azure Container offer, Kubernetes application plan on AKS | custom meter `users`, sent with the extension's managed identity | the CNAB layout (`manifest.yaml`, `createUIDefinition.json`, `mainTemplate.json`, chart) for `container-package-app` |
| Google Cloud Marketplace | Kubernetes app on GKE | Service Control metric `users`, with the reporting secret | the deployer image's build context (`Dockerfile`, `schema.yaml`, chart, tester) |

The billing itself is the Enterprise Edition's usage job
(`ee/Server/Marketplace`): every 15 minutes it notes how many users the
installation has, reports each hour to the marketplace at the most users seen,
and the marketplace accepting the reports is what licenses the Enterprise
features - no license key.

## Files

| File | What it is |
| --- | --- |
| `build.py` | Builds one edition: `python3 build.py --marketplace aws\|azure\|google-cloud --version X.Y.Z --out DIR` |
| `images.json` | The images every edition ships, by the key the chart resolves them by, with the third-party versions pinned |
| `editions.json` | Each marketplace's registry and its own settings. Replace a placeholder as soon as the portal shows the real value |
| `mirror-images.sh` | Copies an edition's images into its marketplace's registry (`crane`) |
| `azure/` | The CNAB manifest template, the Azure portal's create experience and the ARM template |
| `google-cloud/` | The deployer's Dockerfile (`deployer.Dockerfile`, written out as `Dockerfile`), `schema.yaml`, the `Application` resource and the tester |
| `test_build.py` | Unit tests of `build.py` |

The chart tests' `marketplace` suite (`bash HelmChart/Tests/run.sh marketplace`)
runs the unit tests, builds every edition from the chart as it is now, and
renders and checks each one the way its marketplace does at submission.

How to release, test and submit each edition - and which steps only a
maintainer may take - is in the runbook:
[SELF_HOSTED_RELEASING.md](../../packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).
