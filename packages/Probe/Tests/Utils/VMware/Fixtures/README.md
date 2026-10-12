# vSphere fixtures

Answers recorded from the govmomi vSphere simulator (`vmware/vcsim`), and what the
VMware agent's own collector sent for the same simulator. The probe's VMware tests
replay them, so the SOAP client, the inventory collector and the metrics builder are
tested against real vSphere answers without a vCenter.

| File | What it is |
|---|---|
| `vcsim-vcenter-collect.json` | One full collection of a simulated vCenter: one datacenter, two clusters of two hosts, a standalone host, resource pools, vApps, ten VMs, a folder |
| `vcsim-esx-collect.json` | One full collection of a simulated standalone ESXi host |
| `vcsim-vcenter-test.json` | One connection test of the simulated vCenter |
| `vcsim-invalid-login.json` | A login with a wrong password |
| `vcenterreceiver-0.161.0-vcsim-vcenter.json` | The first export of the VMware agent's collector (`otel/opentelemetry-collector-contrib:0.161.0`, its `vcenter` receiver) for the same simulated vCenter |
| `vcenterreceiver-0.161.0-vcsim-esx.json` | The same for the simulated ESXi host |

Each recorded exchange keeps the HTTP method, the path, the SOAP method the probe called
and vSphere's answer. Request bodies are not kept. The PerformanceManager's counter list
is trimmed to the counters the collector asks for and two it does not.

## Recording them again

```bash
docker run -d --name vcsim -p 8989:8989 vmware/vcsim -l 0.0.0.0:8989 \
  -username oneuptime -password secret \
  -pool 1 -app 1 -folder 1 -cluster 2 -host 2 -standalone-host 1 -dc 1
docker run -d --name vcsim-esx vmware/vcsim -l 0.0.0.0:8989 \
  -username oneuptime -password secret -esx
```

The collector's golden output comes from `otel/opentelemetry-collector-contrib:0.161.0`
with the `vcenter` receiver (`insecure_skip_verify: true`,
`vcenter.host.memory.capacity` on, as the agent's `otel-collector-config.yaml` has it)
and a `file` exporter, run in the simulator's network namespace. The simulator's
metric values are random, so the parity tests compare names, kinds, units, value types
and attribute keys, not values.
