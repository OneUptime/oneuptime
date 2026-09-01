# Custom Code Monitor

Custom Code Monitor allows you to write custom scripts to monitor your applications. You can use this feature to monitor your applications in a way that is not possible with the existing monitors. For example, you can have multi-step API requests.

#### Example

The following example shows how to use a Custom Code Monitor:

```javascript
// You can use axios module.

await axios.get("https://api.example.com/");

// Axios Documentation here: https://axios-http.com/docs/intro

return {
  data: "Hello World", // return any data you like here.
};
```

### Using Monitor Secrets

#### Adding a secret

To add a secret, please go to OneUptime Dashboard -> Monitors -> Settings -> Secrets -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

You can select which monitors have access to the secret. In this case we added `ApiKey` secret and selected monitors to have access to it.

**Please note**: Secrets are encrypted and stored securely. If you lose the secret, you will need to create a new secret. You cannot view or update the secret after its saved.

#### Using a secret

To use Monitor Secrets in the script, you can use `monitorSecrets` object in the context of the script. You can use it to access the secrets that you have added to the monitor.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret);
```

### Custom Metrics

You can capture custom metrics from your script using the `oneuptime.captureMetric()` function. These metrics are stored in OneUptime and can be charted on dashboards using the Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, required): The metric name (e.g. `"api.response.time"`). It will be stored with a `custom.monitor.` prefix automatically.
- `value` (number, required): The numeric metric value.
- `attributes` (object, optional): Key-value pairs for additional context. String, number and boolean values are recorded (numbers and booleans are stored as text, because metric attributes are dimensions rather than measurements). Values of any other type are ignored.

#### Example

```javascript
const response = await axios.get("https://api.example.com/health");

// Capture a simple metric
oneuptime.captureMetric("api.response.time", response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

Once captured, these metrics appear in the Metric Explorer under names like `custom.monitor.api.response.time`. You can add them to dashboard charts, set up alerts, and filter by monitor, probe, or any custom attributes you provided.

**Limits:**

- Maximum 100 metrics per script execution.
- Metric names are limited to 200 characters.
- Values must be numeric.
- Maximum 50 attributes per metric. Attribute keys are limited to 200 characters and attribute values to 1000 characters.

**Reserved attribute keys:**

Some attribute names are OneUptime's own, and a script cannot write them. If your script sets one, the attribute is dropped — the metric itself is still recorded — and a warning naming the key is written to the OneUptime server logs. They are:

- The monitor's identity: `monitorId`, `projectId`, `monitorName`, `probeName`, `probeId`, `isCustomMetric`.
- Anything in the `oneuptime.` or `resource.` namespaces — these carry the identifiers OneUptime stamps at ingest.
- Resource identity attributes: `service.name`, `host.name`, `k8s.cluster.name`, `iot.fleet.name`, `proxmox.cluster.name`, `ceph.cluster.name` and `docker.swarm.cluster.name`.

The reason is that these names are not just labels — OneUptime reads them back as a claim about which resource a datapoint belongs to. A metric tagged `service.name: payments-api` would show up on that service's Metrics tab, and if you later built a metric monitor grouped by `service.name`, its alerts would be linked to that service, would page that service's owners, and would fall silent during a maintenance window on it. To associate a monitor with a service or host, use the monitor's own labels instead.

### Modules available in the script

- `axios`: You can use this module to make HTTP requests. It is a promise-based HTTP client for the browser and Node.js.
- `crypto`: You can use this module to perform cryptographic operations. It is a built-in Node.js module that provides cryptographic functionality that includes a set of wrappers for OpenSSL's hash, HMAC, cipher, decipher, sign, and verify functions.
- `console.log`: You can use this module to log data to the console. This is useful for debugging purposes.
- `oneuptime.captureMetric`: You can use this to capture custom metrics from your script. See the Custom Metrics section above.
- `http`: You can use this module to make HTTP requests. It is a built-in Node.js module that provides an HTTP client and server.
- `https`: You can use this module to make HTTPS requests. It is a built-in Node.js module that provides an HTTPS client and server.

### Things to consider

- You can use `console.log` to log the data in the console. This will be available in the logs section of the monitor (Probes > View Logs).
- You can return the data from the script using the `return` statement.
- This is a JavaScript script, so you can use all the JavaScript features in the script.
- Timeout for the script is 2 minutes. If the script takes more than 2 mins, it will be terminated.
