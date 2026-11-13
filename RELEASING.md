# Releasing OneUptime

How a OneUptime release is cut, made green and shipped - for the people and the
agents who do it. Releases run as a loop: as soon as one is out, the next one is
cut from `main`, once `main` has pull requests the last one did not ship.

The other release guides cover one part each:
[the mobile apps](packages/MobileApp/RELEASING.md),
[the infrastructure agent's package managers](agents/InfrastructureAgent/RELEASING.md),
[Slack](packages/Common/Server/Utils/Workspace/Slack/RELEASING.md) and
[Microsoft Teams](packages/Common/Server/Utils/Workspace/MicrosoftTeams/RELEASING.md),
[the GitHub Apps](packages/Common/Server/Utils/CodeRepository/GitHub/RELEASING.md),
[the cloud marketplaces](packages/Common/Server/Utils/Marketplace/RELEASING.md) and
[self-hosted marketplace editions](packages/Common/Server/Utils/Marketplace/SELF_HOSTED_RELEASING.md).
Release notes are written from pull request titles; AGENTS.md's "Release notes"
section says how to title a change.

## What a release is

- `VERSION` holds the version (`14.0.106`). Every internal `package.json` and the
  `package-lock.json` beside it carry the same version;
  `node Scripts/Install/SyncPackageVersions.js` writes them and
  `node Scripts/Install/SyncPackageVersions.js --check` (run by the commit hook
  and by the release run) fails on any drift.
- A push to the `release` branch starts the release run,
  `.github/workflows/release.yml` ("Push Release Images to Docker Hub and GitHub
  Container Registry"). It refuses a version that already has a GitHub release.
- The run builds and pushes every image (Docker Hub and GHCR), runs the release
  E2E suites (SaaS, self-hosted, enterprise) against those images, publishes the
  npm packages and the Terraform provider, then:
  - `push-release-tags` ("Push release tags before GitHub release") moves the
    images' `release` tags,
  - `helm-chart-deploy` publishes both Helm charts,
  - `draft-github-release` writes the notes (`Scripts/Release/GenerateReleaseNotes.js`)
    and `finalize-github-release` ("Publish GitHub release") publishes the
    GitHub release with its assets,
  - then the MCP Registry, the coding-agent plugin and the infrastructure
    agent's apt/yum, Homebrew and winget packages.
- A run takes 8 to 10 hours: its jobs queue behind the organization's
  concurrent-job limit.
- OneUptime has released when the GitHub release for the version is published
  (`gh release view 14.0.106`), the run's `push-release-tags`,
  `helm-chart-deploy` and `finalize-github-release` jobs succeeded, and every
  other job either succeeded or failed for a reason written down (see "When the
  release run fails").

`release` only ever moves by merging a release branch into it.

## The release loop

The example is 14.0.106; use the next patch version after the latest GitHub
release (`gh release list --limit 1`).


### Decide on the release version

If the release only has fixes, bump the patch version. If it has new features, bump the minor version. If we are releasing new products or breaking changes then bump up the major version. If you are bumping up the major version, please update the upgrading guide. 

### 1. Cut the release branch from `main`

```bash
git fetch origin main
git checkout -b release-14.0.106 origin/main
```

Name it `release-<version>`. (`release/<version>` cannot exist beside the
`release` branch: git keeps `release` as a file where `release/` would be a
folder.)

### 2. Bump the version

```bash
echo 14.0.106 > VERSION
node Scripts/Install/SyncPackageVersions.js
git add -A VERSION '*package.json' '*package-lock.json'
git commit -m "chore: bump version to 14.0.106"
```

The commit is `VERSION` and the package.json / package-lock.json pairs, about 55
files, nothing else.

### 3. Push it and open the release pull request into `release`

```bash
git push origin release-14.0.106
gh pr create --base release --head release-14.0.106 --title "Release 14.0.106"
```

Every workflow that runs on `pull_request` runs on it - Compile, Common Jobs,
Common Test, App Test (with its Dashboard Offline UI groups), Enterprise Edition
Test, Postgres Schema Drift, Ops Config Test, the Terraform workflows, Build, the
agents' tests, the OpenStack and eBPF E2E suites and the rest - on the merge of
the branch into `release`, which is exactly the tree the release run will build.
Its checks are the release's gate. In the description, say what the release is
(`main` at which commit), and keep a list of the fixes made in the branch.

Keep the title starting with "Release": the release notes leave a pull request
into `release` with such a title out (`RELEASE_GATE_TITLE` in
`Scripts/Release/GenerateReleaseNotes.js`) and list each fix made in the branch
as a commit of its own, under its title's type and area.

### 4. Give the release the runners

```bash
bash Scripts/Release/PrioritizeReleaseRuns.sh release-14.0.106
```

Leave it running (in its own terminal, or in the background with its output in a
log) until the release has shipped. Once a minute it cancels every queued or
running workflow run whose branch is neither `release-14.0.106` nor `release`:
pushes to `main`, other pull requests, scheduled runs. The organization's
concurrent-job limit is shared, and a full CI run on `main` after every merge
kept the release's own jobs queued for hours. Cancelled runs can be re-run once
the release is out; nobody waits on `main`'s CI while a release is in flight.

### 5. Fix every red check in the release branch

Each failure is fixed in `release-14.0.106` itself, at its root cause, and pushed
there as soon as it is verified locally - do not wait for CI between fixes; every
push restarts the pull request's checks with all fixes so far.

- Read a failure with `gh run view --job <job id> --log-failed` (save it to a
  file and grep it - they run to hundreds of thousands of lines).
- Find the commit that broke it (`git log -S`, `git log -p -- <file>`,
  `git blame`) and what it meant to do. Usually a change was right and a test,
  fixture, guard, translation or doc was not updated with it; sometimes the change
  itself is wrong. Fix whichever side is wrong.
- Never skip, delete, `.skip` or loosen a test, raise a limit or a timeout to get
  past it. A test changes only when it is out of date with an intended change,
  and then it checks the new behaviour.
- Commit each fix on its own, titled as a release-note line
  (`test(terraform): ...`, `fix(ci): ...`, `fix(incidents): ...`), then
  `git fetch origin release-14.0.106 && git rebase origin/release-14.0.106 && git push origin HEAD:release-14.0.106`.
- When many checks are red, split them by area (compile, lint, Postgres suites,
  Common Test, App Test, the browser suites, ...) between people or agents, each
  in a worktree of their own, all pushing to the release branch. Run single test
  files locally, not whole folders.
- After every push to the release branch, merge the branch into `main`:

  ```bash
  bash Scripts/Release/MergeReleaseBranchIntoMain.sh release-14.0.106
  ```

  It computes the merge without a checkout, pushes "Merge release-14.0.106 into
  main", and does nothing when `main` already has the branch. So `main` gets each
  fix as soon as it exists, and the pull requests merged into `main` meanwhile
  are built on them. On a conflict it pushes nothing and prints the files: merge
  those by hand, keeping both sides' intent. The merges only go this way - the
  release branch never takes `main`'s new commits; whatever `main` merges after
  the cut waits for the next release.

### 6. Merge the release pull request when every check is green

```bash
gh pr checks <number>          # every check passed or skipped
gh pr merge <number> --merge   # --admin if the code-owner review is still missing
```

Merge it with a merge commit (not squash, not rebase): the merge's push to
`release` starts the release run.

### 7. Merge the release branch into `main` right away

As soon as the pull request is merged - not once the release run has finished -
merge the branch into `main` one last time:

```bash
bash Scripts/Release/MergeReleaseBranchIntoMain.sh release-14.0.106
```

After the merges of step 5 this is usually only the last fixes, or nothing. Then
`main` has the version bump and every fix the release ships, and the next
release branch starts from them.

### 8. Follow the release run until OneUptime has released

```bash
gh run list --workflow release.yml --branch release --limit 1
gh run watch <run id>
gh release view 14.0.106
```

Keep `PrioritizeReleaseRuns.sh` running through it. The release is out when
"What a release is" above holds.

#### When the release run fails

- A job that failed for a transient reason (a registry timeout, a runner lost):
  `gh run rerun <run id> --failed`.
- A failure in the code, before anything was published: fix it in the release
  branch, as in step 5 (which merges it into `main` too), and merge the branch
  into `release` again. The version has no GitHub release yet, so the new run
  goes ahead.
- A failure after the GitHub release was published, in a job that only publishes
  elsewhere (a package manager): re-run it once its cause is fixed, or fix it in
  the next release. `Publish the infrastructure agent to winget` depends on
  Microsoft's review of the pull request it opens: see
  [agents/InfrastructureAgent/RELEASING.md](agents/InfrastructureAgent/RELEASING.md).
- `publish-android-to-play-store` and `publish-ios-to-app-store` are skipped
  unless the run is dispatched with them turned on:
  [packages/MobileApp/RELEASING.md](packages/MobileApp/RELEASING.md).

### 9. Start the next release - if `main` has something new

Once OneUptime has released, see whether any pull request has merged into `main`
since the release was cut:

```bash
git fetch origin main release
git log --oneline --no-merges origin/release..origin/main
```

These are the commits on `main` that `release` does not have; the merges of the
release branch into `main` add nothing of their own, so they are not listed.

- Something listed: go back to step 1 with the next patch version, cut from
  `main` as it is now, and restart `PrioritizeReleaseRuns.sh` with the new
  branch's name.
- Nothing listed: there is nothing to release. Stop `PrioritizeReleaseRuns.sh`,
  so `main` and pull requests get their CI again, and check again later; cut the
  next release when something has merged.
