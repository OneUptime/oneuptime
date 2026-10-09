# OneUptime in Anthropic's OSS Scanner

[OSS Scanner](https://github.com/anthropics/oss-scanner) is Anthropic's
service that scans critical open-source projects for security
vulnerabilities. It clones this repository's default branch, builds
`.oss-scanner/Dockerfile` on a machine with network access, then studies the
finished image with no network, guided by `.oss-scanner/threat_model.md`. It
emails each finding, with a reproducer and a proposed patch where it has one,
to `security@oneuptime.com`. The reports are model-generated and not reviewed
by a person before they are sent; treat each one as a lead to confirm, like
any report under [`.github/SECURITY.md`](../.github/SECURITY.md).

## What is here

| File | What it is |
| --- | --- |
| `Dockerfile` | The image the scanner studies: the repository at `/src` with every dependency installed and everything built, plus Postgres, Valkey (Redis) and ClickHouse, so the tests and the App run with no network. Its header says what it builds and why. |
| `Dockerfile.dockerignore` | The build context for that Dockerfile. The root `.dockerignore` is written for the product images and leaves out `Scripts/`, `HelmChart/`, `ee/Tests` and more; BuildKit reads this file instead and keeps the whole repository. |
| `threat_model.md` | What OneUptime is, where untrusted input enters, the boundaries that must hold, how we rate severity, and how to use the image. The scanner reads it before it starts. |
| `project.yaml` | Our enrolment, as it sits in `projects/oneuptime/project.yaml` in anthropics/oss-scanner. |
| `run-in-parallel.sh` | Runs the Dockerfile's installs and builds several at a time. |
| `start-services.sh`, `start-app.sh` | Start the datastores, and the App on `http://localhost:3002`, inside the image. |

The scanner reads `Dockerfile` and `threat_model.md` from the default branch,
so a change to them takes effect on its next scan, without a change in
anthropics/oss-scanner. `Tests/Ops/OssScannerImage.test.js` (the "Ops Config
Test" workflow) keeps the image in step with the repository: the base images
and versions, every project with a lockfile, the settings the scripts and
`config.env` share, and what the threat model names.

## Checking the build

The scanner's own tools build the image exactly as it does. From a clone of
anthropics/oss-scanner, with Docker and `pip install pyyaml`:

```sh
mkdir -p projects/oneuptime
cp <this repository>/.oss-scanner/project.yaml projects/oneuptime/
python3 tools/validate.py
tools/check oneuptime            # build, then a shell in the image with no network
```

`tools/check` clones the default branch. To check a branch before it is
merged, push it and add `#<branch>` to `repo:` in the copied `project.yaml`.

Without their tools:

```sh
docker buildx build -f .oss-scanner/Dockerfile -t oneuptime-oss-scanner .
docker run --rm -it --network none oneuptime-oss-scanner
```

Inside, `threat_model.md` ("How to exercise it") lists the commands: single
test files in each package, `bash .oss-scanner/start-services.sh` for the
suites that need Postgres, Valkey or ClickHouse, and
`bash .oss-scanner/start-app.sh` for the running App. On 32 cores the build
takes about seven minutes (`tools/check`, with the clone and the scanner's
layer, about ten), and the image is about 9.5 GB (13 GB with the scanner's
layer and the git history); the scanner allows 45 minutes on 16 cores.

## Keeping it working

- **A new package or agent with a `package.json` or `go.mod`**: add it to the
  Dockerfile's install and build lists, or to its `not built:` lines with the
  reason. The Ops test fails until you do.
- **A new base image or version** (Node, Debian, ClickHouse, Postgres, Go):
  move the matching `FROM` and its digest
  (`docker buildx imagetools inspect <image>:<tag>` prints it). The Ops test
  compares them with the repository's own Dockerfiles, `docker-compose.base.yml`
  and `go.mod`.
- **A new service, entry point or boundary**: say so in `threat_model.md`.
- **Contacts**: change `primary_contact` (one address) or add `auto_ccs` here
  and in anthropics/oss-scanner, in the same week. To pause reports, set
  `disabled: true` there; to withdraw, remove `projects/oneuptime/` there.

## Enrolment

Enrolling is a pull request to anthropics/oss-scanner that adds only
`projects/oneuptime/project.yaml` (a copy of the one here), opened by a core
maintainer of OneUptime. Its description ticks the repository's checklist,
which accepts the [OSS Scanner terms](https://red.anthropic.com/oss-scanner/terms/),
and its CLA bot asks the author to sign their Contributor License Agreement
once. Anthropic reviews and merges it; the first scan follows.
