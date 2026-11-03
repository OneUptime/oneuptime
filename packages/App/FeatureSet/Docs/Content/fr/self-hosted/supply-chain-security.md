# Supply Chain Security

Check what you install before it runs: every OneUptime release signs its images and its Helm chart, and publishes what each image contains and the vulnerabilities known in it. Check them on a machine that reaches the internet, before anything crosses into an air-gapped network.

:::cards
- [Image signatures](#verify-an-images-signature): Sigstore cosign, tied to OneUptime's release workflow.
- [Chart signature](#verify-the-charts-signature): OneUptime's key, checked with `helm verify`.
- [SBOMs and provenance](#read-an-images-sbom-and-provenance): What each image contains, and how it was built.
- [Vulnerability reports](#vulnerability-reports): What was known in each image on the day it shipped.
:::

## What each release publishes

| What | Where | How to check it |
| --- | --- | --- |
| A signature for every image, community and Enterprise Edition, on Docker Hub and the GitHub Container Registry | Beside each image in the registry | `cosign verify` |
| The Helm chart, signed with OneUptime's key | The chart repository, with its `.prov` file | `helm verify` |
| An SPDX SBOM and SLSA provenance attestation on each image | Inside each image's manifest in the registry | `docker buildx imagetools inspect` |
| A CycloneDX SBOM for each image and architecture | The release on [GitHub](https://github.com/OneUptime/oneuptime/releases) | Read it, or load it into a tool such as Dependency-Track |
| A Grype vulnerability report for each of those SBOMs, and a summary by severity | The release on GitHub | Read it |

## Verify an image's signature

Each image is signed with [cosign](https://docs.sigstore.dev/cosign/system_config/installation/), keyless: the signing certificate names OneUptime's release workflow, which GitHub vouches for, and the signature is recorded in Sigstore's public transparency log. There is no key to download.

```bash
cosign verify docker.io/oneuptime/app:14.0.102 \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It prints the verified signature and exits with `0`; any other image, or one changed after it was signed, fails. The same command checks `ghcr.io/oneuptime/app`, the Enterprise Edition's `enterprise-14.0.102` tags and every other image. The image of each platform is signed as well as the multi-platform index, so an image saved for one platform, as `air-gap.sh save` saves them, verifies by its digest too.

## Verify the chart's signature

Every release signs the chart with OneUptime's key, whose fingerprint is `83F2 C1DD F58A 0524 64C4 A172 9D87 E494 AC01 6697`.

:::steps
### Import the key

```bash
curl -fsSL https://keybase.io/oneuptime/pgp_keys.asc | gpg --import
gpg --export > oneuptime-keyring.gpg
```

Check that `gpg --list-keys` shows the fingerprint above.

### Verify the chart

`air-gap.sh save` keeps the chart and its `.prov` file side by side in the bundle's `chart` folder:

```bash
helm verify oneuptime-14.0.102.tgz --keyring oneuptime-keyring.gpg
```

It prints the signing key and the chart's hash, and fails if the chart was changed.
:::

## Read an image's SBOM and provenance

Each image carries an SPDX SBOM and a SLSA provenance attestation, written when it was built:

```bash
docker buildx imagetools inspect docker.io/oneuptime/app:14.0.102 --format '{{ json .SBOM }}'
docker buildx imagetools inspect docker.io/oneuptime/app:14.0.102 --format '{{ json .Provenance }}'
```

Each release on GitHub also attaches a CycloneDX SBOM for each image and architecture, named like `app-14.0.102-linux-amd64.cdx.json`, so you can read what an image contains without reaching a registry.

## Vulnerability reports

Each release on GitHub attaches a Grype report for each CycloneDX SBOM, named like `app-14.0.102-linux-amd64.grype.json`, and `vulnerability-summary.md`, which counts each image's findings by severity. They show what was known on the day the release shipped. To see what is known today, scan the same SBOM again with your own scanner, for example:

```bash
grype sbom:app-14.0.102-linux-amd64.cdx.json
```

Security fixes ship in new releases. OneUptime publishes its advisories on [GitHub](https://github.com/OneUptime/oneuptime/security/advisories), and the [update check](/docs/self-hosted/update-checks) tells your master admins when one affects the version you run.

## Check a bundle after it crosses

`air-gap.sh push` checks every file of a bundle against its `SHA256SUMS` before it pushes anything, so a file changed on its way across is caught. To check by hand:

```bash
cd oneuptime-air-gap-14.0.102 && sha256sum --check SHA256SUMS
```

## Next steps

:::cards
- [Air-Gapped Installation](/docs/installation/air-gapped): Carry a release into a network with no internet.
- [Hardening Guide](/docs/self-hosted/hardening): Lock the install down for a regulated network.
- [NIST SP 800-53 Control Mapping](/docs/self-hosted/nist-800-53): What OneUptime covers, and what stays yours.
:::
