# OneUptime Ingress

[OneUptime](https://oneuptime.com) is an open-source observability platform:
uptime and API monitoring, status pages, incident management, on-call
scheduling, logs, metrics and traces in one place.

This image is OneUptime's ingress: nginx in front of the OneUptime App and its
status pages. It terminates TLS, routes requests, and provisions Let's Encrypt
certificates for custom status page domains with a small Node.js sidecar. It
is the image every OneUptime release publishes on Docker Hub as
`oneuptime/nginx`, on Iron Bank's nginx 1.30 image. It is licensed under the
Apache License 2.0 ([LICENSE](LICENSE)).

## How it is built

The Dockerfile copies the release's nginx configuration, the certificate
sidecar in `/usr/src` and the Node.js that runs it out of the release's image,
which `hardening_manifest.yaml` pins by digest, onto Iron Bank's nginx 1.30
image. Both images are nginx 1.30 from nginx.org on Alpine 3.24, with the same
modules, `njs` included. It then adds the release's Alpine packages, and sets
the release's environment and start command. The source is
[IronBank/Ingress](https://github.com/OneUptime/oneuptime/tree/master/IronBank/Ingress)
in OneUptime's repository.

The container runs as root, as the release's does: its start script renders
nginx's configuration and provisions certificates before it starts nginx,
whose worker processes run as the `nginx` user.

## Running it

It is deployed with the rest of OneUptime by OneUptime's Helm chart, which can
run this image in place of the Docker Hub one:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime \
  --set host=oneuptime.example.com \
  --set image.overrides.nginx=registry1.dso.mil/ironbank/oneuptime/ingress:<tag> \
  --set "imagePullSecrets[0].name=<your Registry1 pull secret>"
```

Documentation: [oneuptime.com/docs](https://oneuptime.com/docs).

## Support

Questions and issues: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues),
or hello@oneuptime.com.
