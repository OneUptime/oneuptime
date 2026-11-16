import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * VMRunner hands the sandbox the host's real axios, so its SSRF guard is the
 * one thing standing between workflow-authored JavaScript and the internal
 * network. VMRunnerSsrf.test.ts exercises that guard for real, but it can only
 * run where the isolated-vm native module loads — so these source-level checks
 * cover the one detail that behaviour test does not: the guard now takes a
 * policy argument, and getting that argument's plumbing wrong fails open.
 *
 * The guard lives in VMHttpBridge, which VMRunner builds once per run from
 * the caller's options, and which a global Runner also runs on a step's
 * behalf (packages/Runner/Utils/JavaScriptSandbox/SandboxHttp). So the checks
 * below read both: the bridge for the request, the runner for what it hands
 * the bridge.
 *
 * Three things must hold, and none is visible from the sandbox:
 *
 *  - The runner passes the CALLER's flag, not a literal `true` and not the
 *    instance configuration it could read itself. It also executes custom code
 *    monitors inside the Probe, which has no database to resolve a project
 *    from, so the decision cannot live here.
 *
 *  - A trusted caller can pass its already-resolved local policy separately;
 *    the eligibility flag above is still required before it has any effect.
 *
 *  - Absent, the resolved-policy override stays absent. Workflow callers that
 *    never heard of it continue to use the API server's webhook configuration.
 */

const VM_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Utils",
  "VM",
);

const runnerSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMRunner.ts"),
  "utf8",
);

const bridgeSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMHttpBridge.ts"),
  "utf8",
);

const apiSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMAPI.ts"),
  "utf8",
);

describe("VMRunner — private network policy plumbing", () => {
  test("the sandbox axios guard is called with the caller's flag", () => {
    expect(bridgeSource).toMatch(
      /validateAndResolveWebhookTarget\(\s*effectiveUrl,\s*\{[\s\S]{0,600}?allowPrivateNetworkTargets:\s*\n?\s*this\.policy\.allowPrivateNetworkRequests === true,/,
    );
    expect(runnerSource).toMatch(
      /new VMHttpBridge\(\{[\s\S]{0,300}?allowPrivateNetworkRequests:\s*options\.allowPrivateNetworkRequests,/,
    );
  });

  test("the sandbox axios guard receives the caller's resolved policy", () => {
    expect(bridgeSource).toMatch(
      /privateNetworkAccessIsAllowed:\s*\n?\s*this\.policy\.privateNetworkAccessIsAllowed/,
    );
    expect(runnerSource).toMatch(
      /new VMHttpBridge\(\{[\s\S]{0,300}?privateNetworkAccessIsAllowed:\s*options\.privateNetworkAccessIsAllowed,/,
    );
  });

  /*
   * "Webhook URL" is the guard's default noun and is wrong for both of this
   * runner's callers — one is a workflow script, the other is a monitor.
   */
  test("the guard is told this is a request, not a webhook", () => {
    expect(bridgeSource).toMatch(/targetLabel:\s*"Request URL"/);
  });

  /*
   * The sentence telling an operator how to permit a private target has to
   * come from the caller: the workflow component's setting lives on the API
   * server and the probe's lives on the probe, which is usually a different
   * machine owned by a different person.
   */
  test("the refusal hint is passed through from the caller", () => {
    expect(bridgeSource).toMatch(
      /privateNetworkHint:\s*this\.policy\.privateNetworkHint/,
    );
    expect(runnerSource).toMatch(
      /privateNetworkHint:\s*options\.privateNetworkHint/,
    );
    expect(runnerSource).toMatch(
      /privateNetworkHint\?:\s*string \| undefined;/,
    );
  });

  test("the caller decides how much a DNS-decided refusal says", () => {
    /*
     * The probe passes false; the workflow caller passes nothing and gets the
     * deployment default. Dropping it here would hand every script the
     * detailed refusal on a shared probe.
     */
    expect(bridgeSource).toMatch(
      /includeResolutionDetailInError:\s*\n?\s*this\.policy\.includeResolutionDetailInError/,
    );
    expect(runnerSource).toMatch(
      /includeResolutionDetailInError:\s*\n?\s*options\.includeResolutionDetailInError/,
    );
    expect(runnerSource).toMatch(
      /includeResolutionDetailInError\?:\s*boolean \| undefined;/,
    );
    expect(apiSource).toMatch(
      /includeResolutionDetailInError\?:\s*boolean \| undefined;/,
    );
  });

  test("there is exactly one call to the guard", () => {
    /*
     * A second, unguarded request path inside the runner would be invisible to
     * every test above — the sandbox would simply have two doors.
     */
    const calls: RegExpMatchArray | null = bridgeSource.match(
      /validateAndResolveWebhookTarget\(/g,
    );

    expect(calls).toHaveLength(1);
    expect(runnerSource).not.toContain("validateAndResolveWebhookTarget(");
    // The runner makes no request itself: it has no HTTP client to make one.
    expect(runnerSource).not.toMatch(/from "axios"/);
    expect(runnerSource).not.toMatch(/from "https?"/);
  });

  /*
   * A caller may hand the run a requester of its own (a global Runner's step,
   * whose process may open no socket, hands each request to the Runner): it
   * replaces only who makes the request. Every request is first held to the
   * run's limits here, and the default requester is the bridge with the
   * caller's policy.
   */
  test("every request is held to the run's limits, then made by the caller's requester or the run's bridge", () => {
    expect(runnerSource).toMatch(
      /httpRequester\?:\s*VMHttpRequester \| undefined;/,
    );
    expect(runnerSource).toMatch(
      /options\.httpRequester \|\|\s*\(\(call: VMHttpCall, signal: AbortSignal\): Promise<string> => \{\s*return httpBridge\.execute\(call, signal\);/,
    );

    const reserved: number = runnerSource.indexOf("httpBridge.reserve(call);");
    const requested: number = runnerSource.indexOf(
      "requestHttp(call, abortController.signal)",
    );

    expect(reserved).toBeGreaterThan(-1);
    expect(requested).toBeGreaterThan(reserved);
    expect(runnerSource.match(/requestHttp\(/g)).toHaveLength(1);
  });

  test("the runner never reads the instance configuration itself", () => {
    /*
     * It would work in the App and silently differ in the Probe, where there
     * is no project to resolve. The policy has to arrive from the caller.
     */
    for (const source of [runnerSource, bridgeSource]) {
      expect(source).not.toContain("PrivateNetworkWebhookConfig");
      expect(source).not.toContain("ProjectService");
      expect(source).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
    }
  });

  test("the bridge disables explicit and environment-configured Axios proxies", () => {
    expect(bridgeSource).toMatch(/safeConfig\["proxy"\]\s*=\s*false;/);
  });

  test("the bridge forces the HTTP/1 transport that uses its pinned agents", () => {
    expect(bridgeSource).toMatch(/delete safeConfig\["http2Options"\];/);
    expect(bridgeSource).toMatch(/delete safeConfig\["lookup"\];/);
    expect(bridgeSource).toMatch(/safeConfig\["httpVersion"\]\s*=\s*1;/);
  });

  test("the bridge pins the validation result into both socket agents", () => {
    expect(bridgeSource).toContain(
      "DataSourceEgressGuard.createPinnedLookup(validatedTarget.addresses)",
    );
    expect(bridgeSource.match(/lookup:\s*pinnedLookup as never/g)).toHaveLength(
      2,
    );
  });

  test("the validated canonical URL is authoritative at dispatch", () => {
    expect(bridgeSource).toMatch(/delete safeConfig\["baseURL"\];/);
    expect(bridgeSource).toMatch(/delete safeConfig\["url"\];/);
    expect(bridgeSource).toMatch(/delete safeConfig\["allowAbsoluteUrls"\];/);
    expect(
      bridgeSource.match(
        /axios\.(?:get|head|options|post|put|patch|delete)\(canonicalUrl/g,
      ),
    ).toHaveLength(7);
    expect(bridgeSource).toMatch(/config\["url"\]\s*=\s*canonicalUrl;/);
  });

  test("response and request bytes are bounded at the host bridge", () => {
    expect(bridgeSource).toContain(
      "new HTTPResponseBodyBudget(MAX_HTTP_RESPONSE_BYTES)",
    );
    expect(bridgeSource).toMatch(
      /safeConfig\["maxBodyLength"\]\s*=\s*effectiveMaxBodyLength;/,
    );
    expect(bridgeSource).toContain(
      "maximumResponseBytes: effectiveMaxContentLength",
    );
    expect(bridgeSource).toMatch(
      /safeConfig\["responseType"\]\s*=\s*"stream";/,
    );
    expect(bridgeSource).toContain("HTTPResponseBodyReader.read(responseData");
    expect(bridgeSource).toMatch(
      /this\.serializedRequestBytes \+ operationBytes >\s*MAX_HTTP_REQUEST_BYTES/,
    );
    // The isolate's own check, before a request leaves it.
    expect(runnerSource).toContain(
      "assertSerializedRequestLength(method, url, arg1, arg2)",
    );
    expect(bridgeSource).toContain('"base64-arraybuffer"');
    expect(bridgeSource).toContain(
      "body.length > MAX_BASE64_RESPONSE_SOURCE_BYTES",
    );
    expect(bridgeSource).toContain('"base64-json-or-text"');
    expect(bridgeSource).toContain('"base64-text"');
    expect(bridgeSource).toContain('data: body.toString("base64")');
    // The isolate decodes what the bridge encoded.
    expect(runnerSource).toContain("function decodeUtf8(bytes)");
  });

  test("untrusted Agent options cannot replace lookup or socket creation", () => {
    const safeAgentOptionSection: string = bridgeSource.slice(
      bridgeSource.indexOf("const pickAgentOptions"),
      bridgeSource.indexOf("const toPlainHeaders"),
    );

    expect(safeAgentOptionSection).not.toContain('"lookup"');
    expect(safeAgentOptionSection).not.toContain('"createConnection"');
    expect(safeAgentOptionSection).not.toContain('"socketPath"');
    expect(safeAgentOptionSection).not.toContain('"host"');
    expect(safeAgentOptionSection).not.toContain('"hostname"');
    expect(safeAgentOptionSection).not.toContain('"port"');
    expect(safeAgentOptionSection).not.toContain('"path"');
    expect(safeAgentOptionSection).not.toContain('"keepAlive"');
    expect(safeAgentOptionSection).toContain('"servername"');
  });

  test("both policy options are optional", () => {
    expect(runnerSource).toMatch(
      /allowPrivateNetworkRequests\?:\s*boolean \| undefined;/,
    );
    expect(runnerSource).toMatch(
      /privateNetworkAccessIsAllowed\?:\s*boolean \| undefined;/,
    );
  });

  test("VMAPI exposes and passes every policy option through", () => {
    expect(apiSource).toMatch(
      /allowPrivateNetworkRequests\?:\s*boolean \| undefined;/,
    );
    expect(apiSource).toMatch(
      /privateNetworkAccessIsAllowed\?:\s*boolean \| undefined;/,
    );
    expect(apiSource).toMatch(/privateNetworkHint\?:\s*string \| undefined;/);
    // VMAPI forwards `data` wholesale; anything else would silently drop it.
    expect(apiSource).toContain("return VMRunner.runCodeInSandbox(data);");
  });
});
