# Troubleshooting Performance Issues

If your OneUptime deployment is slow or unhealthy, run the bundled diagnostic
script. It inspects pods, databases (PostgreSQL, ClickHouse, Redis), storage,
logs, autoscaling, and the ingress, then prints a ranked list of findings with
concrete action steps.

The script is **read-only** — it only runs `SELECT` queries and
`kubectl get/logs/exec` commands. It does not modify any cluster state.

## Run it

```console
curl -sLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/diagnose.sh
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
