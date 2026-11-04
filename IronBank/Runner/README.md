# OneUptime Runner

[OneUptime](https://oneuptime.com) is an open-source observability platform:
uptime and API monitoring, status pages, incident management, on-call
scheduling, logs, metrics and traces in one place.

This image is OneUptime's runner: a self-hosted agent that executes runbook
steps in your own infrastructure, runs `kubectl` for OneUptime AI on the
clusters it is given access to, and, when enabled, opens AI code-fix pull
requests in your repositories. It is the image every OneUptime release
publishes on Docker Hub as `oneuptime/runner`, on Iron Bank's Node.js 26
image. It is licensed under the Apache License 2.0 ([LICENSE](LICENSE)).

## How it is built

The Dockerfile copies the runner in `/usr/src`, `kubectl` (which the release
downloads from Kubernetes and checks against its sha256) and the CA
certificates the release trusts out of the release's image, which
`hardening_manifest.yaml` pins by digest, onto Iron Bank's Node.js 26 image.
Both images are Node.js 26 on Debian 13. It then installs the release's Debian
packages, and sets the release's environment, entrypoint (`tini`), user and
start command. The source is
[IronBank/Runner](https://github.com/OneUptime/oneuptime/tree/master/IronBank/Runner)
in OneUptime's repository.

## Running it

It runs as the `node` user (UID 1000) and connects to your OneUptime. It is
deployed with the rest of OneUptime by OneUptime's Helm chart, which can run
this image in place of the Docker Hub one:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime \
  --set host=oneuptime.example.com \
  --set image.overrides.runner=registry1.dso.mil/ironbank/oneuptime/runner:<tag> \
  --set "imagePullSecrets[0].name=<your Registry1 pull secret>"
```

Documentation: [oneuptime.com/docs](https://oneuptime.com/docs).

## Support

Questions and issues: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues),
or hello@oneuptime.com.
