## Setting up Custom Probes

You can set up custom probes inside your network to monitor resources in your private network or resources that are behind your firewall.

To begin with you need to create a custom probe in your Project Settings > Probe. Once you have created the custom probe on your OneUptime Dashboard. You should have the `PROBE_ID` and `PROBE_KEY`

### Deploy Probe

#### Docker

To run a probe, please make sure you have docker installed. You can run custom probe by:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.

#### Docker Compose

You can also run the probe using docker-compose. Create a `docker-compose.yml` file with the following content:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Then run the following command:

```
docker compose up -d
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.

#### Kubernetes

You can also run the probe using Kubernetes. Create a `oneuptime-probe.yaml` file with the following content:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
    template:
      metadata:
        labels:
          app: oneuptime-probe
        spec:
          containers:
            image: oneuptime/probe:release
            env:
              - name: PROBE_KEY
                value: "<probe-key>"
              - name: PROBE_ID
                value: "<probe-id>"
              - name: ONEUPTIME_URL
                value: "https://oneuptime.com"
```

Then run the following command:

```bash
kubectl apply -f oneuptime-probe.yaml
```

If you are self hosting OneUptime, you can change `ONEUPTIME_URL` to your custom self hosted instance.


### Verify

If the probe is running successfully. It should show as `Connected` on your OneUptime dashboard. If it does not show as connected. You need to check logs of the container. If you're still having trouble. Please create an issue on [GitHub](https://github.com/oneuptime/oneuptime) or [contact support](https://oneuptime.com/support)