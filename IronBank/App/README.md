# OneUptime App

[OneUptime](https://oneuptime.com) is an open-source observability platform:
uptime and API monitoring, status pages, incident management, on-call
scheduling, logs, metrics and traces in one place.

This image is the OneUptime App, the server behind OneUptime's dashboard, API,
background workers and telemetry ingestion. It is the Community Edition
(Apache License 2.0), which every OneUptime release publishes on Docker Hub as
`oneuptime/app`, on Iron Bank's Node.js 26 image.

## How it is built

The Dockerfile copies `/usr/src` (the App, its shared code and its built web
frontends) out of the release's image, which `hardening_manifest.yaml` pins by
digest, onto Iron Bank's Node.js 26 image. Both images are Node.js 26 on Alpine
3.24. It then adds `bash` and `curl` from Alpine's repositories, and sets the
release's environment, user and start command. The source is
[IronBank/App](https://github.com/OneUptime/oneuptime/tree/master/IronBank/App)
in OneUptime's repository.

## Running it

The App needs PostgreSQL, Redis (or Valkey) and ClickHouse. It is usually
deployed with the rest of OneUptime by OneUptime's Helm chart, which can run
this image in place of the Docker Hub one:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime \
  --set host=oneuptime.example.com \
  --set image.overrides.app=registry1.dso.mil/ironbank/oneuptime/app:<tag> \
  --set "imagePullSecrets[0].name=<your Registry1 pull secret>"
```

| | |
| --- | --- |
| Port | 3002 (HTTP) |
| User | `node` (UID 1000) |
| Health | `GET /status/live` and `GET /status/ready` |
| Configuration | Environment variables: see OneUptime's [`config.example.env`](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) |

Documentation: [oneuptime.com/docs](https://oneuptime.com/docs).

## Support

Questions and issues: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues),
or hello@oneuptime.com.
