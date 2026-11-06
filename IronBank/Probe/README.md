# OneUptime Probe

[OneUptime](https://oneuptime.com) is an open-source observability platform:
uptime and API monitoring, status pages, incident management, on-call
scheduling, logs, metrics and traces in one place.

This image is OneUptime's monitoring probe. It runs HTTP, TCP, ping, SSL, DNS,
SQL Server and synthetic (browser) monitors, from wherever it is deployed, and
reports to your OneUptime. It is the image every OneUptime release publishes
on Docker Hub as `oneuptime/probe`, on Iron Bank's Debian 12 image. It is
licensed under the Apache License 2.0 ([LICENSE](LICENSE)); it also contains
Microsoft's ODBC Driver 18 for SQL Server, under Microsoft's license.

## How it is built

The Dockerfile copies out of the release's image, which
`hardening_manifest.yaml` pins by digest:
- the probe in `/usr/src`;
- the Chromium and Firefox builds Playwright downloaded;
- the synthetic monitors' native helpers;
- the Node.js that runs it all.

These go onto Iron Bank's Debian 12 image, the Debian the release is built on.
It then installs the release's Debian packages, the browsers' libraries
(Playwright names them) and Microsoft's ODBC driver, whose package
`hardening_manifest.yaml` pins by checksum. It sets the release's environment,
entrypoint (`tini`) and start command. The source is
[IronBank/Probe](https://github.com/OneUptime/oneuptime/tree/master/IronBank/Probe)
in OneUptime's repository.

The container runs as root, as the release's does: ping, traceroute and
tcpdump open raw sockets.

## Running it

It is deployed with the rest of OneUptime by OneUptime's Helm chart, which can
run this image in place of the Docker Hub one:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime \
  --set host=oneuptime.example.com \
  --set image.overrides.probe=registry1.dso.mil/ironbank/oneuptime/probe:<tag> \
  --set "imagePullSecrets[0].name=<your Registry1 pull secret>"
```

Documentation: [oneuptime.com/docs/probe/custom-probe](https://oneuptime.com/docs/probe/custom-probe).

## Support

Questions and issues: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues),
or hello@oneuptime.com.
