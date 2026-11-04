# Iron Bank

[Iron Bank](https://docs-ironbank.dso.mil) is the US Department of Defense's
registry of hardened container images (registry1.dso.mil), run by Platform One.
DoD programs pull images from it instead of from Docker Hub. To be listed, an
image has to be rebuilt by Iron Bank's own pipeline from a project on Repo1
(repo1.dso.mil, Platform One's GitLab), and every finding of Iron Bank's scans
has to be fixed or justified in VAT (vat.dso.mil), its vulnerability tracker.

Each folder here holds exactly the files of one of OneUptime's Iron Bank
projects. Together they are the four OneUptime images the Helm chart runs; the
worker and the telemetry writer run the App's image.

| Folder | Image | Copies the release's | Iron Bank base image | Repo1 project |
| --- | --- | --- | --- | --- |
| [App](App) | the App, Enterprise Edition | `oneuptime/app:enterprise-<version>` | `opensource/nodejs/nodejs26`: Node.js 26, Alpine 3.24 | `dsop/oneuptime/app` |
| [Ingress](Ingress) | the nginx ingress | `oneuptime/nginx:<version>` | `opensource/nginx/nginx-alpine`: nginx 1.30, Alpine 3.24 | `dsop/oneuptime/ingress` |
| [Runner](Runner) | the runner | `oneuptime/runner:<version>` | `opensource/nodejs/debian/nodejs`: Node.js 26, Debian 13 | `dsop/oneuptime/runner` |
| [Probe](Probe) | the probe | `oneuptime/probe:<version>` | `opensource/debian/debian`: Debian 12 | `dsop/oneuptime/probe` |

Iron Bank's onboarding team picks the final Repo1 paths; keep each manifest's
`name` the same as its path. PostgreSQL, ClickHouse, Valkey and kubectl are
already in Iron Bank, so the chart can run those from Registry1 as they are.

[Justifications](Justifications) is not pushed to Repo1. It records, per
project, the findings OneUptime has justified in VAT.

## How the images are built

Iron Bank builds each project's Dockerfile without internet access. The image
must start from one of Iron Bank's own images, and anything else the build
reads must be a resource that `hardening_manifest.yaml` pins by digest or
checksum. Iron Bank's pipeline can still reach Alpine's and Debian's package
repositories through its proxy.

So nothing is built from source here. Each manifest pins its image of a
OneUptime release (linux/amd64, on Docker Hub) by digest. Each Dockerfile
copies what that image adds onto an Iron Bank base image of the same
distribution. It then installs the same Alpine or Debian packages and sets the
release's environment, user, entrypoint and start command again. Because the
distributions match, what the release compiled runs unchanged.

`/usr/src` is copied from a `shipped` stage: the release with its test
directories (`/usr/src/Common/Tests`, `/usr/src/app/Tests`) removed, so that no
layer of the image carries them. No image runs its tests, and one of Common's
test fixtures (an SVG data URI with a script in it) is what ClamAV calls
phishing. Iron Bank's pipeline fails an image on any ClamAV detection.
`Tests/Ops/IronBankApp.test.js` and `IronBankProjects.test.js` hold each
Dockerfile to the Dockerfile its release is built from
(`packages/<Service>/Dockerfile.tpl`). When one of those changes what its image
sets, those suites say what to change here.

- **App.** It copies `/usr/src` and installs `bash`, `curl` and the PostgreSQL
  clients that backups use. Only the Enterprise Edition is on Iron Bank, as a
  "commercial" image. Production use of it needs an Enterprise license
  (`ee/LICENSE`). Without one it runs a 14-day trial, for evaluation. After
  that, SCIM and audit logging stop and enterprise configuration becomes
  read-only, while core monitoring carries on. Activating a license turns the
  enterprise features back on without a restart.
- **Ingress.** It copies the nginx configuration, the certificate sidecar in
  `/usr/src` and the Node.js that runs it. Iron Bank's nginx image already has
  nginx 1.30's modules, `njs` included, so this adds only `libxml2`, which
  `njs` links.
- **Runner.** It copies `/usr/src`, kubectl (which the release downloads and
  checks against its sha256) and the release's CA certificates.
- **Probe.** It copies `/usr/src`, the Node.js that runs it, the Chromium and
  Firefox that Playwright downloaded, and the synthetic monitors' native
  helpers. Playwright's own `install-deps` installs the browsers' libraries.
  Microsoft's ODBC Driver 18 for SQL Server comes from Microsoft's repository,
  which Iron Bank's pipeline cannot reach. So the manifest pins its package by
  URL and sha256. Update both values from Microsoft's
  [package index](https://packages.microsoft.com/debian/12/prod/dists/bookworm/main/binary-amd64/Packages).

### Running as root

Iron Bank asks for a justification for an image that runs as root. The App and
the runner run as `node`. The ingress and the probe run as root, as their
releases do:

- **Ingress:** its start script renders nginx's configuration into
  `/etc/nginx/conf.d` and provisions certificates, then starts nginx, whose
  worker processes run as the `nginx` user, as with the official nginx image.
- **Probe:** ping, traceroute and tcpdump open raw sockets.

`Scripts/IronBank/lint.sh` accepts root for those two only, and the workflow
lists them.

`Scripts/IronBank/PinRelease.js` moves a project to another release. It
updates the tag, the version label, the resource's digest, the release stage,
`APP_VERSION`, `GIT_SHA` and the revision label together, from the release's
image on Docker Hub:

```bash
node Scripts/IronBank/PinRelease.js --project Probe --version 14.0.102
```

## What CI does: the Iron Bank Preflight workflow

[`.github/workflows/iron-bank.yml`](../.github/workflows/iron-bank.yml) runs
daily, on pull requests that change `IronBank/` or `Scripts/IronBank/`, and by
hand (Actions → Iron Bank Preflight → Run workflow, optionally with a
version). It runs one job per project, and does to each what Iron Bank will
do, so the findings are known before a merge request reaches Repo1:

1. Pins the project to the latest published release, or the one asked for. On
   a pull request, it instead checks that the committed pin matches the release
   on Docker Hub.
2. Runs `Tests/Ops/IronBank*.test.js`.
3. Lints the project with Iron Bank's own schema and semgrep rules, fetched
   from Repo1 (`Scripts/IronBank/lint.sh`).
4. With Registry1 credentials, it also:
   - fetches the manifest's resources as Iron Bank's pipeline does;
   - builds the image on Iron Bank's base image with the manifest's labels;
   - for the App, checks it is the Enterprise Edition and boots it with
     PostgreSQL, ClickHouse and Valkey (`Tests/Ops/AppImageRuntime.test.js`);
   - for the others, runs their smoke tests (`Scripts/IronBank/smoke_test.sh`):
     nginx loads its configuration, the runner's tools run, the probe's SQL
     Server driver and browsers work;
   - scans the image and its base image with Grype and Trivy, and its files
     with ClamAV.
5. Writes the findings into the run's summary (`Scripts/IronBank/NewFindings.js`).
   Each finding is sorted into one of three groups:
   - **inherited**: the base image has it too, so Iron Bank answers for it;
   - **justified**: it is in `Justifications/<Project>.yaml`;
   - **new**: it needs a fix in the release, or a justification.

   A new high or critical finding fails the App's and the ingress's jobs. The
   runner's and the probe's report theirs with a warning for now, because they
   have hundreds to work through: remove `report_only` from the workflow's
   matrix once they are dealt with. Each job uploads an artifact,
   `iron-bank-<Project>-<version>`, holding `repo1/` (the files to push) and
   `scans/` (the reports).

Registry1 credentials are two repository secrets, `REGISTRY1_USERNAME` and
`REGISTRY1_PASSWORD`. Use a Registry1 robot account: open a "Robot Account"
issue in [dccscr](https://repo1.dso.mil/dsop/dccscr/-/issues/new), and Iron
Bank emails the credentials. Without the secrets, the workflow runs steps 1 to
3 and warns.

## Shipping a release to Iron Bank

For each project:

1. Take the `iron-bank-<Project>-<version>` artifact of a green run for the
   release. The daily run checks the latest release; run the workflow by hand
   for another one.
2. Fix or justify every new finding. A justification is written in VAT. Add
   the same text to `Justifications/<Project>.yaml`, so later runs count the
   finding as answered.
3. Push the contents of `repo1/` to a feature branch of the Repo1 project, and
   open a merge request to `development`. Iron Bank's pipeline runs on it.
   Justify anything its scans add in VAT, then add the `Status::Review` label
   to the project's issue.
4. Iron Bank's Container Hardening Team reviews the image and the
   justifications. Once the image is merged to `master`, Iron Bank publishes it
   at `registry1.dso.mil/ironbank/oneuptime/<image>:<version>`.

Each base image's tag (`BASE_TAG`) moves on Repo1 through Renovate (each
project's `renovate.json`). When Renovate moves it, update it here too:
`IronBankProjects.test.js` expects the Dockerfile and the manifest to agree.

## Onboarding, once

1. Create a Platform One account (login.dso.mil).
2. Submit the "Platform One Iron Bank Onboarding Requests" form
   ([forms.osi.apps.mil/r/s8rtWD1eCP](https://forms.osi.apps.mil/r/s8rtWD1eCP);
   the older form linked from
   [Onboarding Services](https://docs-ironbank.dso.mil/reference/cso/customer-services-and-onboarding/)
   points there), choosing "Vendor & Contributor Onboarding". It asks for:
   - a main point of contact and a technical one (the technical one by their
     Platform One username);
   - a **Government point of contact**: a DoD military or civilian user (not a
     contractor) who will use or support OneUptime and can validate the mission
     need. This person does not have to fund it, but Iron Bank requires one: they
     give the initial approval, and are the one requesting the onboarding
     ([dccscr #6531](https://repo1.dso.mil/dsop/dccscr/-/work_items/6531)).

   It also asks for commitments: public images and scan results, updates on
   the day of each release, timely justifications, and builds and runs without
   internet access.
3. Iron Bank's onboarding team creates the project on Repo1, emails the
   contacts, and assigns an initial issue to the engineers. Its onboarding
   checklist (the dccscr "Onboarding" template) mentions a quote, but Iron Bank
   says there is currently no cost to onboard or host an application (same
   issue).
4. Keep the maintainers in each `hardening_manifest.yaml` the same as the
   engineers the onboarding request names, by their Repo1 usernames.
5. Push the first feature branch. Then open a "VAT Pipeline Access Request" in
   dccscr: the pipeline fails at lint until the onboarding team approves the
   project.
6. After a green feature-branch pipeline, open a "VAT User Access Request" in
   dccscr. It gives write access to VAT, which you need to justify findings.
7. Request the robot account for CI (above).

For questions, comment on the project's issue (add
`/cc @ironbank-notifications/onboarding` if nobody answers). Iron Bank also
runs a working session, "IB Weekly", every Wednesday from 16:00 to 17:00
Eastern. Registration is linked from the project's initial issue.
