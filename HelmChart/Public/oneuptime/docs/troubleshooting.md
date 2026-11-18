# Troubleshooting Performance Issues

If your OneUptime deployment is slow or unhealthy, run the bundled diagnostic
script. It inspects pods, databases (PostgreSQL, ClickHouse, Valkey), storage,
logs, autoscaling, and the ingress, then prints a ranked list of findings with
concrete action steps.

It also prints what OneUptime says is wrong with itself, asked from inside the
app pod: PostgreSQL, ClickHouse and Valkey answer, the migrations, ClickHouse's
disks, the queues, the version, and the server's setup steps such as email and
probes. These are the same findings `npm run doctor` prints on Docker Compose
and the Admin Dashboard shows at the top of **OneUptime Health**.

Then it checks the address people open, the `host` in your values, as the
doctor does on Docker Compose:

- From inside the cluster: whether `host` resolves, the certificate it
  presents (who issued it, which names it covers, until when, and whether it
  is trusted), and whether a request to it reaches this OneUptime rather than
  another server or a default backend. If the ingress or load balancer in
  front of OneUptime changes the host name or drops `X-Forwarded-Proto`, it
  says so.
- From the computer you run it on, with `curl` when it is installed: whether a
  browser there would reach it and accept its certificate.

Every request gives up within seconds, and each problem comes with its fix,
such as `kubectl describe certificate -A` when cert-manager did not issue or
renew the certificate.

The script is **read-only** — it only runs `SELECT` queries and
`kubectl get/logs/exec` commands. It does not modify any cluster state.

## Run it

```console
curl -sLO https://raw.githubusercontent.com/OneUptime/oneuptime/main/HelmChart/Public/diagnose.sh
chmod +x diagnose.sh

# Auto-detects namespace and helm release name
./diagnose.sh

# Or specify them explicitly
./diagnose.sh --namespace my-namespace --release my-oneuptime
```

## Output

The script prints findings as it runs and ends with a summary grouped by
severity (CRITICAL / WARNING / INFO). Each finding includes the affected
component, the symptom, and a specific action — usually the `values.yaml` key to
change and the `helm upgrade` command to apply it.

A full report is saved to `oneuptime-diagnostic-<timestamp>.txt` in your current
directory. Attach this file to support tickets at
[oneuptime.com/support](https://oneuptime.com/support) so we can help diagnose
faster.

## Options

```console
./diagnose.sh --help              # show all flags
./diagnose.sh --no-color          # plain text (for piping/logging)
./diagnose.sh --output report.txt # custom report file path to send to OneUptime support
```
