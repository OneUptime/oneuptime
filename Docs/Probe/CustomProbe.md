## Setting up Custom Probes

You can set up custom probes inside your network to monitor resources in your private network or resources that are behind your firewall. 

To begin with you need to create a custom probe in your Project Settings > Probe. Once you have created the custom probe on your OneUptime Dashboard. You should have the `PROBE_ID` and `PROBE_KEY`


### Run the probe

To run a probe, please make sure you have docker installed. You can run custom probe by: 

```
docker run --name oneuptime-probe -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e PROBE_API_URL=https://oneuptime.com/probe-api -d oneuptime/probe

```

If you are self hosting OneUptime, you can change `PROBE_API_URL` to your custom self hosted instance. 

### Verify 

If the probe is running successfully. It should show as `Connected` on your OneUptime dashboard. If it does not show as connected. You need to check logs of the container. If you're still having trouble. Please create an issue on [GitHub](https://github.com/oneuptime/oneuptime) or [contact support](https://oneuptime.com/support)