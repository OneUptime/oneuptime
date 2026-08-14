# Synthetic Monitor

Synthetic monitoring is a way to proactively monitor your applications by simulating user interactions. You can create a synthetic monitor to check the availability and performance of your applications from different locations around the world.

#### Example

The following example shows how to use a Synthetic Monitor:

```javascript
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: OneUptime's secure Playwright-compatible page facade
// - browserType: Browser type in the current run context - Chromium or Firefox
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto("https://playwright.dev/");

// The commonly used Page, Locator, Frame, and BrowserContext APIs are supported.

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType); // This will list the browser type in the current run context - Chromium or Firefox

console.log(screenSizeType); // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots["screenshot-name"] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).

return {
  data: "Hello World",
};
```

### Use of Playwright

We use Playwright to simulate user interactions. The `page` value is a secure,
Playwright-compatible facade for the page created for this execution. Common
`Page`, `Locator`, `Frame`, `ElementHandle`, `JSHandle`, `Request`, `Response`,
keyboard, mouse, and browser-context methods are available. This includes
navigation, locators, clicks, form input, page evaluation, popups, additional
pages, response inspection, and screenshots.

Synthetic scripts do not run in the Probe's Node.js process. Values cross the
runtime boundary as copied data or opaque, execution-scoped capabilities. APIs
that would escape that boundary are intentionally unavailable: browser launch
or connection methods, CDP sessions, request routing, exposed bindings,
Playwright private fields, and any option that reads or writes a host filesystem
path. `page.context().browser()` is therefore unavailable. Evaluation functions
passed to methods such as `page.evaluate()` execute in the monitored browser
page, never in the Probe process.

Each execution can use up to eight pages. Full-page screenshots and PDF output
are unavailable; viewport screenshots remain supported and retain the failure
evidence behavior described below.

Function predicates for event, request, response, and URL wait methods do not
cross the isolation boundary. Use string or regular-expression matchers,
locators, or explicit polling instead.

Browser permissions are limited to geolocation and notifications. Clipboard,
camera, microphone, MIDI, local-font, and other host-device permissions are not
available to monitor scripts.

### Screenshots

A pre-declared `screenshots` object is available in the script context. Assign screenshots to it at any point in the script — these screenshots are captured **even if the script throws** (including assertion failures, timeouts, or unexpected errors), so you can see exactly what the page looked like when the run failed. Captured screenshots appear in the OneUptime Dashboard for that specific monitor run.

```javascript
// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Returning screenshots (legacy)

For backward compatibility, you can also return screenshots from the script as part of the return value. Screenshots returned this way are **only** captured when the script completes normally — they are lost if the script throws. Prefer the side-channel pattern above when you want evidence of failures.

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
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

- `name` (string, required): The metric name (e.g. `"dashboard.load.time"`). It will be stored with a `custom.monitor.` prefix automatically.
- `value` (number, required): The numeric metric value.
- `attributes` (object, optional): Key-value pairs for additional context.

#### Example

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Capture page load time as a custom metric
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

Once captured, these metrics appear in the Metric Explorer under names like `custom.monitor.dashboard.load.time`. You can add them to dashboard charts, set up alerts, and filter by monitor, probe, browser type, screen size, or any custom attributes you provided.

**Limits:**

- Maximum 100 metrics per script execution.
- Metric names are limited to 200 characters.
- Values must be numeric.

### Modules available in the script

- `page`: A secure Playwright-compatible facade for interacting with the browser. You can access the execution's browser context via `page.context()` to create pages or deal with popups, but browser launch/connect, CDP, routing, bindings, private fields, and host-path options are unavailable.
- `screenshots`: A pre-declared object that you assign screenshots to (e.g. `screenshots['login-page'] = await page.screenshot()`). Screenshots assigned here are captured even if the script later throws.
- `axios`: A promise-based HTTP client supporting callable Axios plus `request`, `get`, `head`, `options`, `post`, `put`, `patch`, `delete`, and `create`. Request size, response size, redirect, and timeout limits are enforced; custom transports, adapters, sockets, agents, and proxy overrides are unavailable.
- `crypto`: A browser-worker implementation of SHA-256 hashes, HMAC-SHA-256, `randomBytes`, `randomInt`, and `randomUUID`.
- `console.log`: You can use this module to log data to the console. This is useful for debugging purposes.
- `oneuptime.captureMetric`: You can use this to capture custom metrics from your script. See the Custom Metrics section above.
- `http`: A buffered, client-only compatibility facade supporting `request`, `get`, and `Agent`.
- `https`: The HTTPS equivalent of the client-only `http` facade.

### Things to consider

- The `page` object is the primary interface for interacting with the browser. It intentionally implements an allowlisted Playwright surface rather than exposing raw Playwright or Node.js objects.
- You can use `console.log` to log the data in the console. This will be available in the logs section of the monitor.
- You can return the data from the script using the `return` statement. Assign screenshots to the provided `screenshots` object so they are preserved even if the script throws.
- You can use `browserType` and `screenSizeType` variables to get the browser type and screen size type in the current run context. Feel free to use them in your script if you like.
- This is a JavaScript script, so you can use all the JavaScript features in the script.
- You can use `axios` module to make HTTP requests in the script. You can use it to make API calls from the script.
- If you are using oneuptime.com, you will always have the latest version of Playwright & browsers available in the context of the script. If you're self-hosting, please make sure you update the probes to have the latest version of Playwright and the browsers.
- The default script timeout is 60 seconds and can be configured by the Probe operator. Timed-out workers and all browser descendants are terminated.
- Each execution has bounded memory and writable browser storage. Exceeding either limit terminates that execution and removes its temporary profile; self-hosted operators can configure these ceilings on the Probe.
