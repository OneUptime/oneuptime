# Iron Bank

[Iron Bank](https://docs-ironbank.dso.mil) is the US Department of Defense's
registry of hardened container images (registry1.dso.mil), run by Platform One.
DoD programs pull images from it instead of from Docker Hub. To be listed, an
image has to be rebuilt by Iron Bank's own pipeline from a project on Repo1
(repo1.dso.mil, Platform One's GitLab), and every finding of Iron Bank's scans
has to be fixed or justified in VAT (vat.dso.mil), its vulnerability tracker.

Each folder here holds exactly the files of one of OneUptime's Iron Bank
projects:

| Folder | Image | Repo1 project |
| --- | --- | --- |
| [App](App) | the App, Enterprise Edition | `dsop/oneuptime/app` (Iron Bank's onboarding team picks the final path) |

[Justifications](Justifications) is not pushed to Repo1. It records the
findings OneUptime has justified in VAT.

## How the image is built

Iron Bank builds `App/Dockerfile` without internet access. The image must start
from one of Iron Bank's own images, and anything else the build reads must be a
resource that `hardening_manifest.yaml` pins by digest or checksum. Iron Bank's
pipeline can still reach Alpine's package repositories through its proxy.

So the App is not built from source here. The manifest pins the Enterprise
Edition image of a OneUptime release (`oneuptime/app:enterprise-<version>` on
Docker Hub, linux/amd64) by digest. The Dockerfile copies its `/usr/src` onto
Iron Bank's Node.js 26 image (`ironbank/opensource/nodejs/nodejs26`). It
installs `bash`, `curl` and the PostgreSQL clients that backups use, and sets
the release's environment, user and start command again. Both images are
Node.js 26 on Alpine 3.24, so the native modules the release built load
unchanged. `Tests/Ops/IronBankApp.test.js` holds the Dockerfile to the
enterprise stage of `packages/App/Dockerfile.tpl`. When the App's Dockerfile
changes what its image sets, that suite says what to change here.

Only the Enterprise Edition is on Iron Bank, as a "commercial" image. Production
use of it needs an Enterprise license (`ee/LICENSE`). Without one it runs a
14-day trial, for evaluation. After that, SCIM and audit logging stop and
enterprise configuration becomes read-only, while core monitoring carries on.
Activating a license turns the enterprise features back on without a restart.

`Scripts/IronBank/PinRelease.js` moves the project to another release. It
updates the tag, the version label, the resource's digest, the release stage,
`APP_VERSION`, `GIT_SHA` and the revision label together, from the release's
image on Docker Hub:

```bash
node Scripts/IronBank/PinRelease.js --version 14.0.101
```

## What CI does: the Iron Bank Preflight workflow

[`.github/workflows/iron-bank.yml`](../.github/workflows/iron-bank.yml) runs
daily, on pull requests that change `IronBank/` or `Scripts/IronBank/`, and by
hand (Actions → Iron Bank Preflight → Run workflow, optionally with a
version). It does to the project what Iron Bank will do, so the findings are
known before a merge request reaches Repo1:

1. Pins the project to the latest published release, or the one asked for. On
   a pull request, it instead checks that the committed pin matches the release
   on Docker Hub.
2. Runs `Tests/Ops/IronBank*.test.js`.
3. Lints the project with Iron Bank's own schema and semgrep rules, fetched
   from Repo1 (`Scripts/IronBank/lint.sh`).
4. With Registry1 credentials, it also:
   - fetches the manifest's resources as Iron Bank's pipeline does;
   - builds the image on Iron Bank's base image with the manifest's labels;
   - checks it is the Enterprise Edition;
   - boots it with PostgreSQL, ClickHouse and Valkey
     (`Tests/Ops/AppImageRuntime.test.js`);
   - scans the image and its base image with Grype and Trivy, and its files
     with ClamAV.
5. Writes the findings into the run's summary (`Scripts/IronBank/NewFindings.js`).
   Each finding is sorted into one of three groups:
   - **inherited**: the base image has it too, so Iron Bank answers for it;
   - **justified**: it is in `Justifications/App.yaml`;
   - **new**: it needs a fix in the release, or a justification.

   A new high or critical finding fails the run. The run uploads an artifact,
   `iron-bank-app-<version>`, holding `repo1/` (the files to push) and
   `scans/` (the reports).

Registry1 credentials are two repository secrets, `REGISTRY1_USERNAME` and
`REGISTRY1_PASSWORD`. Use a Registry1 robot account: open a "Robot Account"
issue in [dccscr](https://repo1.dso.mil/dsop/dccscr/-/issues/new), and Iron
Bank emails the credentials. Without the secrets, the workflow runs steps 1 to
3 and warns.

## Shipping a release to Iron Bank

1. Take the `iron-bank-app-<version>` artifact of a green run for the release.
   The daily run checks the latest release; run the workflow by hand for
   another one.
2. Fix or justify every new finding. A justification is written in VAT. Add
   the same text to `Justifications/App.yaml`, so later runs count the finding
   as answered.
3. Push the contents of `repo1/` to a feature branch of the Repo1 project, and
   open a merge request to `development`. Iron Bank's pipeline runs on it.
   Justify anything its scans add in VAT, then add the `Status::Review` label
   to the project's issue.
4. Iron Bank's Container Hardening Team reviews the image and the
   justifications. Once the image is merged to `master`, Iron Bank publishes it
   at `registry1.dso.mil/ironbank/oneuptime/app:<version>`.

The base image's tag (`BASE_TAG`) moves on Repo1 through Renovate
(`App/renovate.json`). When Renovate moves it, update it here too:
`IronBankApp.test.js` expects the Dockerfile and the manifest to agree.

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
     need. This person does not have to fund it.

   It also asks for commitments: public images and scan results, updates on
   the day of each release, timely justifications, and builds and runs without
   internet access.
3. Iron Bank's onboarding team creates the project on Repo1, emails the
   contacts, and assigns an initial issue to the engineers. Its own
   onboarding checklist (the dccscr "Onboarding" template) lists a quote that
   is "completed and signed" before the project is created. Ask Iron Bank what
   it covers.
4. Replace the `FIXME` maintainers in `App/hardening_manifest.yaml` with those
   engineers' names and Repo1 usernames. Iron Bank's pipeline refuses the
   manifest until then, and `lint.sh` warns about it.
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
