# Releasing the OneUptime infrastructure agent

This is the release runbook for maintainers and AI agents. It covers the
infrastructure agent (`agents/InfrastructureAgent`, the agent of Server / VM
monitors): every place a release reaches, what happens by itself, what needs a
person, and how to tell whether a release is really out. Follow the
repository's [AGENTS.md](../../AGENTS.md) as well.
[Scripts/PackageManagers/README.md](../../Scripts/PackageManagers/README.md)
explains how the publishing works and how it was set up.

The agent has no release of its own. Every OneUptime release builds and
publishes it with the same version, from
[.github/workflows/release.yml](../../.github/workflows/release.yml). Nobody
builds or uploads anything by hand. The work for each release is checking
that it arrived everywhere and following up on what did not. The
"Infrastructure Agent Release Status" workflow does the checking.

## Release sequence

1. A push to `release` starts release.yml. Its `infrastructure-agent-build`
   job runs GoReleaser (`agents/InfrastructureAgent/.goreleaser.yaml`, with
   `--snapshot`), which makes the archives, the `.deb`, `.rpm`, `.apk` and
   Arch packages, the Homebrew cask and the winget manifests. The same job
   runs `build-msi.sh` for the two MSIs and makes an SBOM for each file.
2. Once the e2e jobs pass, `finalize-github-release` publishes the GitHub
   release. From then on the install script and the MSI downloads give the
   new version.
3. `publish-infrastructure-agent-apt-yum` adds the version to
   `OneUptime/packages`. GitHub Pages then deploys it to
   packages.oneuptime.com. Pages deploys wait for a runner behind the
   organization's other Actions jobs, so this can take from minutes to more
   than an hour.
4. `publish-infrastructure-agent-homebrew` commits the cask to
   `OneUptime/homebrew-tap`. `brew upgrade` sees it after the next
   `brew update`.
5. `publish-infrastructure-agent-winget` opens a pull request to
   `microsoft/winget-pkgs`, and closes the account's open ones for older
   versions, which it supersedes. It then waits up to 15 minutes for
   Microsoft's CLA bot to label the pull request `Needs-CLA`, agrees to the
   CLA for HackerBay, Inc., and waits up to 5 more for the label to go.
   Microsoft validates the pull request, and a moderator or a bot merges it.
   Only then does `winget upgrade` see it, which can take days.
6. "Infrastructure Agent Release Status" runs when the release run finishes,
   and again every day. It checks each place, and installs the agent from the
   live repositories once they have the version.

**A published GitHub release, a commit in `OneUptime/packages` and an open
winget pull request are separate milestones. A version is out only where the
status workflow says published.**

## Where it is published

| Where | What people run | Published by | Out when |
| --- | --- | --- | --- |
| GitHub release | download the archive for their OS | `finalize-github-release` | the release is published |
| Install script | `curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh \| sudo bash` | `packages/App/FeatureSet/Docs/Static/scripts/infrastructure-agent/install.sh`, served with the docs | always: it installs the latest GitHub release |
| MSI | Intune, Configuration Manager, Group Policy | `build-msi.sh`, attached to the release | the release is published |
| apt | `apt-get install oneuptime-infrastructure-agent` | `publish-infrastructure-agent-apt-yum`, then Pages | Pages has deployed it |
| yum and dnf | `dnf install oneuptime-infrastructure-agent` | the same job and deploy | Pages has deployed it |
| Homebrew | `brew install oneuptime/tap/oneuptime-infrastructure-agent` | `publish-infrastructure-agent-homebrew` | the tap has the commit |
| winget | `winget install --id OneUptime.InfrastructureAgent --exact --scope machine` | `publish-infrastructure-agent-winget` | Microsoft merges the pull request |

The `.apk` and Arch packages are on the GitHub release only: there is no
repository for them. The commands people follow are on the
[Server / VM Monitor](../../packages/App/FeatureSet/Docs/Content/en/monitor/server-monitor.md)
docs page.

## Accounts, keys and secrets

Do not create new repositories, keys or identifiers for a routine release.
Machines that installed the agent trust the key and the names below.

| Item | Value |
| --- | --- |
| Package, program and service name | `oneuptime-infrastructure-agent` |
| apt and yum site | `https://packages.oneuptime.com`, the GitHub Pages site of `OneUptime/packages` (branch `main`, one commit, replaced by each release). DNS: a CNAME to `oneuptime.github.io` |
| Signing key | `key@oneuptime.com`, RSA 4096, fingerprint `83F2 C1DD F58A 0524 64C4 A172 9D87 E494 AC01 6697`, published as `https://packages.oneuptime.com/gpg.key`. It can sign until 2099. Its encryption subkey expires in September 2027, but nothing here uses it |
| Homebrew tap | `OneUptime/homebrew-tap`, branch `main`, `Casks/oneuptime-infrastructure-agent.rb` |
| winget package | `OneUptime.InfrastructureAgent` (publisher OneUptime, author HackerBay, Inc.) in `microsoft/winget-pkgs` |
| winget fork | `OneUptime/winget-pkgs`, named by the repository variable `WINGET_FORK_OWNER=OneUptime`. Pull requests are opened by the account whose token is `WINGET_GITHUB_TOKEN`: `simlarsen` in October 2026 |
| Environment | `package-managers`. Only the `release` branch can deploy to it. It holds `PACKAGE_REPOSITORY_DEPLOY_KEY`, `HOMEBREW_TAP_DEPLOY_KEY` and `WINGET_GITHUB_TOKEN` |
| Signing secret | `GPG_PRIVATE_KEY`, an organization secret that the Helm charts and the Terraform provider are signed with too |

The deploy keys do not expire. The winget token is a classic personal access
token with the `public_repo` scope, and it expires on the date chosen when it
was made. When it expires, the winget job fails at its first request to
GitHub. Make a new token for the same account, and paste it in yourself:

```bash
gh secret set WINGET_GITHUB_TOKEN --repo OneUptime/oneuptime --env package-managers
```

Do not print tokens or private keys, put them in files in the repository, or
paste them into a conversation with an agent.

## 1. Read the release's status

Open the latest run of
[Infrastructure Agent Release Status](https://github.com/OneUptime/oneuptime/actions/workflows/infrastructure-agent-release-status.yml).
Its summary has one table per job:

- **status** (`Scripts/PackageManagers/ReleaseStatus.sh`) covers the GitHub
  release, apt, yum, Homebrew, winget, the signing key and the site's HTTPS
  certificate. It checks what each one serves against the release. Examples:
  the signature on the apt and yum indexes, the release's SHA-256 in the apt
  index, the cask and the winget manifest, and that every listed package
  downloads.
- **apt and dnf on x64 / Arm** (`InstallFromPackageRepository.sh`) runs the
  docs' apt and dnf commands, as written, on Debian 12 and 13, Ubuntu 22.04
  and 24.04, Rocky Linux 8 and 9, AlmaLinux 10, Fedora and Amazon Linux 2023.
  It checks the version installed and that the program runs. It runs once
  the site has the version.
- **Homebrew on macOS** (`InstallFromHomebrew.sh`) runs the docs' brew
  command and checks the version and that Gatekeeper's quarantine is off. It
  fails on anything brew calls deprecated in the cask. It runs once the tap
  has the version.

The run's summary is the release's record. GitHub keeps it for the
repository's retention period, 90 days by default.

| State | Meaning | What to do |
| --- | --- | --- |
| published | People get this version from it | Nothing |
| superseded | It has a newer release instead (only when checking an older version) | Nothing |
| waiting | Not yet, and nothing is wrong. For six hours after the release, the publish jobs and the Pages deploy may still be catching up. When a re-run of the publish job puts the version on `OneUptime/packages` later, the site gets six hours from its latest Pages deploy's start, unless that deploy failed. For winget, Microsoft may still be reviewing, however long that takes | Wait for the next run. The details say what it is waiting for |
| attention | Works, but not for long: the key or the HTTPS certificate expires soon | See below, before it expires |
| problem | Something people install is missing, wrong or broken, or a winget pull request needs us. The run fails | See the section for it below |

Check a release yourself, or another version than the latest:

```bash
bash Scripts/PackageManagers/ReleaseStatus.sh
bash Scripts/PackageManagers/ReleaseStatus.sh 14.0.74
gh workflow run infrastructure-agent-release-status.yml --repo OneUptime/oneuptime -f version=14.0.74
```

The script needs `gh` (signed in), `jq`, `gpg`, `python3`, `curl` and
`openssl`. It only reads. `InstallFromPackageRepository.sh <version> <image>...`
needs Docker. Do not run `InstallFromHomebrew.sh` on your own Mac: it
updates Homebrew, and its `brew uninstall` removes dependencies that nothing
else needs.

## 2. apt and yum: packages.oneuptime.com

- **Waiting: `OneUptime/packages` has it; its latest Pages deploy is
  queued.** Nothing is wrong: Pages is waiting for a runner. A deploy that a
  newer push cancelled is fine too. Check the deploys with
  `gh run list --repo OneUptime/packages --limit 3`. If the last one failed,
  ask Pages for another build:
  `gh api -X POST repos/OneUptime/packages/pages/builds`.
- **Problem: `OneUptime/packages` does not have it either.**
  `publish-infrastructure-agent-apt-yum` did not run, or it failed. Open the
  job in the release run, fix the cause, and re-run it. A re-run publishes
  only what the site lacks.
- **Problem: a signature, a SHA-256 or a download is wrong.** Something other
  than the publish job changed the site, or a publish broke it. Do not edit
  `OneUptime/packages` by hand. Find what changed with
  `gh api repos/OneUptime/packages/commits`, then re-run the publish job.
- **HTTPS certificate.** GitHub Pages issues and renews it. If Pages leaves it
  unissued (`gh api repos/OneUptime/packages/pages` shows
  `https_certificate.state` other than `approved`), remove the custom domain
  and add it again, then enforce HTTPS once the certificate is approved:

  ```bash
  gh api -X PUT repos/OneUptime/packages/pages -F cname=null
  gh api -X PUT repos/OneUptime/packages/pages -f cname=packages.oneuptime.com
  gh api -X PUT repos/OneUptime/packages/pages -F https_enforced=true
  ```

  In October 2026 the first certificate was never issued, because Pages
  checked DNS before the CNAME record existed. Adding the domain again fixed
  it.
- **Signing key, attention or problem.** Extend the key's expiry (it is the
  same key afterwards), update `GPG_PRIVATE_KEY`, and let a release publish
  its `gpg.key`. Machines hold a copy of `gpg.key` with the old expiry, so
  they must download it again: the first command in the docs. If you replace
  the key, every machine has to trust the new one. Change the fingerprint in
  `ReleaseStatus.sh` in the same change.

The site keeps the newest ten versions. Older versions remain on their GitHub
releases.

## 3. Homebrew

Published means the tap's cask names the version, with the release's
checksums for Apple silicon and Intel.

- **Problem: the tap has an older version.**
  `publish-infrastructure-agent-homebrew` did not run, or it failed. Re-run it
  from the release run.
- **The Homebrew job fails on a warning.** Homebrew deprecates parts of the
  cask language from time to time, and brew then prints the warning in every
  command that reads the cask. Homebrew 7 deprecated `postflight` and
  `verified:`, and the casks of 14.0.75 and earlier use `postflight`. Fix the
  cask in
  `homebrew_casks` in `agents/InfrastructureAgent/.goreleaser.yaml` (its
  `custom_block` is a Go template, so write `{{` as `{{ "{{" }}`). Then
  update `Tests/Ops/InfrastructureAgentPackageManagers.test.js`. The tap
  changes with the next release: the publish job leaves a version the tap
  already has as it is. For an urgent fix, make the same change in the tap's
  cask by hand, keeping its version.

## 4. winget

The first version of a package waits for a moderator's review (the
`New-Package` label), which can take days to weeks. Later versions usually
merge once validation passes, without a moderator.

Each release's pull request supersedes the ones before it. The publish job
closes the account's open pull requests for older versions, commenting
`Superseded by #<number> (OneUptime.InfrastructureAgent <version>).` on each,
so usually only the newest is open. It closes only pull requests titled as it
titles them and open from `OneUptime/winget-pkgs`'s own
`OneUptime.InfrastructureAgent-<version>` branches, and never a newer
version's, so re-running an older release's job closes nothing newer. One it
could not close is a warning on the job's run, and the status names the
others still open.

| Labels | Whose move | What to do |
| --- | --- | --- |
| `New-Package`, `Azure-Pipeline-Passed`, `Validation-Completed`, `Moderator-Approved`, `Internal-Error-*`, `Validation-Retry` | Microsoft's | Nothing. Internal errors are their pipeline's, and they retry |
| `Needs-CLA` | Ours | The bot asks on every pull request, and ignores an agreement posted before it has asked. So the publish job waits up to 15 minutes for this label on each pull request it opens, then comments `@microsoft-github-policy-service agree company="HackerBay, Inc."`, and waits up to 5 minutes for the bot to take the label off. A re-run does the same on an open pull request that has the label. If the label stays, the job warns but passes: post that comment by hand from the account that opened the pull request, or re-run the job. The bot takes the label off within a minute of an agreement it accepts |
| `Needs-Author-Feedback`, `Changes-Requested` | Ours | Read the moderator's comment and answer from the same account. The bot closes a pull request that waits on its author for too long |
| Any `...-Error` or `...-Failed` label, e.g. `Validation-Installation-Error`, `Error-Hash-Mismatch` | Ours | Read the validation comment, which links the logs. Fix the `winget` section of `.goreleaser.yaml`, then replace the pull request (below) or let the next release bring the fix |
| `Possible-Duplicate` | Ours | Two pull requests add the same new package. Keep the one a moderator is reviewing and close the other if asked |

To replace a version's pull request: close it, delete the branch
`OneUptime.InfrastructureAgent-<version>` in `OneUptime/winget-pkgs`, and
re-run `publish-infrastructure-agent-winget` in that release's run. The job
skips a version that winget-pkgs has, or that has a pull request open.

Do not approve, label or comment on other people's pull requests in
winget-pkgs. Accepting the CLA again for another organization, or changing
the account the pull requests come from, is a maintainer's decision.

## 5. MSI

`build-msi.sh` builds `oneuptime-infrastructure-agent-amd64.msi` and
`-arm64.msi` with wixl, from `windows/oneuptime-infrastructure-agent.wxs`. The
MSI installs per machine, into
`C:\Program Files\OneUptimeInfrastructureAgent`. A newer MSI upgrades the
agent in place and starts its service again. An older MSI refuses to install
over a newer one. MSIs from releases before 14.0.74 cannot be upgraded this
way: uninstall them once first. The "Infrastructure Agent MSI Test" workflow
installs, upgrades, downgrades and uninstalls the MSIs on Windows x64 and
Windows on Arm, for every pull request that changes `agents/InfrastructureAgent`.

## 6. Install script

The script is a static file of the docs, so a change reaches oneuptime.com
when the release deploys. Self-hosted installations serve their own copy. It
needs nothing per release: it asks GitHub for the latest release.

## Changing how the agent is packaged

Before merging a change to `.goreleaser.yaml`, `build-msi.sh`, the `.wxs`,
`Scripts/PackageManagers` or the publish jobs:

1. Run `npm test` in `Tests/Ops`. It covers the GoReleaser config, the
   publish jobs, the publish scripts against local stand-ins, and the status
   scripts.
2. Let the pull request's checks run: the "Ops Config Test" workflow runs
   `Tests/Ops/package-repository-e2e.sh`, which publishes to a stand-in site
   and installs from it with the docs' commands. "Infrastructure Agent MSI
   Test" covers the MSI. "Infrastructure Agent Release Status" runs for
   changes to its own scripts.
3. After the first release that has the change, read its status run. It is
   the first time the change meets the real tap, site and winget. A release
   run builds master as it was when the run started, and takes about four
   hours, so the release published next may not have it yet: 14.0.75
   was published four hours after the cask's fix was merged, without it.

## Troubleshooting

| Symptom | Next action |
| --- | --- |
| A publish job says it was skipped because a secret is not set | The `package-managers` environment lost the secret. Set it again (see [the setup](../../Scripts/PackageManagers/README.md#one-time-setup)) and re-run the job |
| The winget job fails with HTTP 401 | `WINGET_GITHUB_TOKEN` expired or was revoked. Make a new one for the same account |
| The winget job warns that the `Needs-CLA` label stayed | The bot has not accepted the agreement yet. If the pull request still has the label, post the comment the warning gives by hand, from the account that opened the pull request |
| The winget job warns that an older pull request was not closed | Close it by hand from the account that opened it, commenting `Superseded by #<number> (OneUptime.InfrastructureAgent <version>).` as the job does |
| The apt-yum job's push is refused | Another run pushed the site first. Re-run the job: it starts from the site as it is now |
| packages.oneuptime.com answers 404 for everything | The Pages deploy has not finished, or Pages lost the custom domain. Check `gh api repos/OneUptime/packages/pages` |
| apt says the repository is not signed, or `NO_PUBKEY` | The machine's `/etc/apt/keyrings/oneuptime.asc` is old or missing. Download `gpg.key` again, as the docs say |
| brew says the SHA-256 does not match | The tap's cask is not the release's. Re-run the Homebrew job, or check the tap's last commit |
| A release is missing from the status run | Runs check the latest release. Dispatch the workflow with `version` |

## Reference releases

The status workflow keeps the record of every release. List a release here
only when a person had to act on it, or when it is the first to carry a
change.

- **14.0.71** (18 October 2026): the release run came before the publishing
  secrets were set, so its publish jobs were skipped. Its winget pull request,
  [#455532](https://github.com/microsoft/winget-pkgs/pull/455532), was opened
  by hand from `OneUptime/winget-pkgs` with `PublishWingetManifests.sh`. The
  CLA was agreed there for HackerBay, Inc. On 19 October it was validated and
  waiting for a moderator.
- **14.0.74** (19 October 2026, 07:35 UTC): the first release that release.yml
  published everywhere by itself. Tap commit `9a63d33`, `OneUptime/packages`
  commit `86c7a17`, winget
  [#455758](https://github.com/microsoft/winget-pkgs/pull/455758). The Pages
  deploy waited for runners, so the site served 14.0.74 at 08:58 UTC, 75
  minutes after the push. It is the first release whose MSI upgrades an
  installed agent in place. Its cask still used `postflight`, so brew warned
  about a deprecation. The status workflow's first run, the same morning,
  found it published everywhere except winget. It installed it on all nine
  distributions on x64 and Arm, and failed the Homebrew job on that warning.
- **14.0.75** (19 October 2026, 12:05 UTC): built from master as it was at
  07:36 UTC, before the cask's fix (#5041) was merged. It is the first with the
  arm64 MSI built as an x64 package, so it installs in `C:\Program Files`
  (both MSIs are x64 packages that install per machine). Its cask still uses
  `postflight`. Its winget pull request,
  [#455948](https://github.com/microsoft/winget-pkgs/pull/455948), got
  `Needs-CLA` like the two before it, so the CLA agreement was posted by hand
  again, and the publish job now posts it on every pull request it opens.
- **14.0.76**: the first built with the cask Homebrew 7 does not warn about
  (`postflight_steps`). Its release run started at 12:07 UTC on 19 October,
  before the publish job posted the CLA agreement, so its winget pull
  request, [#456276](https://github.com/microsoft/winget-pkgs/pull/456276),
  kept `Needs-CLA`.
- **14.0.77** (20 October 2026): the publish job agreed to the CLA on its
  winget pull request,
  [#456419](https://github.com/microsoft/winget-pkgs/pull/456419), at 03:14:31
  UTC, a second after opening it. Microsoft's CLA bot asked for the agreement
  at 03:23:40 UTC and ignored the one posted before, so the pull request kept
  `Needs-CLA`. The publish job now waits for the bot's label before it agrees.
- **14.0.78** (20 October 2026): winget
  [#456494](https://github.com/microsoft/winget-pkgs/pull/456494). The five
  pull requests still open from the releases before it, #455532, #455758,
  #455948, #456276 and #456419, were closed by hand as superseded by it. The
  publish job now closes older pull requests itself.
