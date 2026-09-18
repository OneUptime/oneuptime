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

const apiSource: string = fs.readFileSync(
  path.join(VM_DIR, "VMAPI.ts"),
  "utf8",
);

describe("VMRunner — private network policy plumbing", () => {
  test("the sandbox axios guard is called with the caller's flag", () => {
    expect(runnerSource).toMatch(
      /validateAndResolveWebhookTarget\(\s*effectiveUrl,\s*\{[\s\S]{0,600}?allowPrivateNetworkTargets:\s*\n?\s*options\.allowPrivateNetworkRequests === true,/,
    );
  });

  test("the sandbox axios guard receives the caller's resolved policy", () => {
    expect(runnerSource).toMatch(
      /privateNetworkAccessIsAllowed:\s*\n?\s*options\.privateNetworkAccessIsAllowed/,
    );
  });

  /*
   * "Webhook URL" is the guard's default noun and is wrong for both of this
   * runner's callers — one is a workflow script, the other is a monitor.
   */
  test("the guard is told this is a request, not a webhook", () => {
    expect(runnerSource).toMatch(/targetLabel:\s*"Request URL"/);
  });

  /*
   * The sentence telling an operator how to permit a private target has to
   * come from the caller: the workflow component's setting lives on the API
   * server and the probe's lives on the probe, which is usually a different
   * machine owned by a different person.
   */
  test("the refusal hint is passed through from the caller", () => {
    expect(runnerSource).toMatch(
      /privateNetworkHint:\s*options\.privateNetworkHint/,
    );
    expect(runnerSource).toMatch(
      /privateNetworkHint\?:\s*string \| undefined;/,
    );
  });

  test("there is exactly one call to the guard", () => {
    /*
     * A second, unguarded request path inside the runner would be invisible to
     * every test above — the sandbox would simply have two doors.
     */
    const calls: RegExpMatchArray | null = runnerSource.match(
      /validateAndResolveWebhookTarget\(/g,
    );

    expect(calls).toHaveLength(1);
  });

  test("the runner never reads the instance configuration itself", () => {
    /*
     * It would work in the App and silently differ in the Probe, where there
     * is no project to resolve. The policy has to arrive from the caller.
     */
    expect(runnerSource).not.toContain("PrivateNetworkWebhookConfig");
    expect(runnerSource).not.toContain("ProjectService");
    expect(runnerSource).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
  });

  test("the bridge disables explicit and environment-configured Axios proxies", () => {
    expect(runnerSource).toMatch(/safeConfig\["proxy"\]\s*=\s*false;/);
  });

  test("the bridge forces the HTTP/1 transport that uses its pinned agents", () => {
    expect(runnerSource).toMatch(/delete safeConfig\["http2Options"\];/);
    expect(runnerSource).toMatch(/delete safeConfig\["lookup"\];/);
    expect(runnerSource).toMatch(/safeConfig\["httpVersion"\]\s*=\s*1;/);
  });

  test("the bridge pins the validation result into both socket agents", () => {
    expect(runnerSource).toContain(
      "DataSourceEgressGuard.createPinnedLookup(validatedTarget.addresses)",
    );
    expect(runnerSource.match(/lookup:\s*pinnedLookup as never/g)).toHaveLength(
      2,
    );
  });

  test("the validated canonical URL is authoritative at dispatch", () => {
    expect(runnerSource).toMatch(/delete safeConfig\["baseURL"\];/);
    expect(runnerSource).toMatch(/delete safeConfig\["url"\];/);
    expect(runnerSource).toMatch(/delete safeConfig\["allowAbsoluteUrls"\];/);
    expect(
      runnerSource.match(
        /axios\.(?:get|head|options|post|put|patch|delete)\(canonicalUrl/g,
      ),
    ).toHaveLength(7);
    expect(runnerSource).toMatch(/config\["url"\]\s*=\s*canonicalUrl;/);
  });

  test("response and request bytes are bounded at the host bridge", () => {
    expect(runnerSource).toContain(
      "new HTTPResponseBodyBudget(MAX_HTTP_RESPONSE_BYTES)",
    );
    expect(runnerSource).toMatch(
      /safeConfig\["maxBodyLength"\]\s*=\s*effectiveMaxBodyLength;/,
    );
    expect(runnerSource).toContain(
      "maximumResponseBytes: effectiveMaxContentLength",
    );
    expect(runnerSource).toMatch(
      /safeConfig\["responseType"\]\s*=\s*"stream";/,
    );
    expect(runnerSource).toContain("HTTPResponseBodyReader.read(responseData");
    expect(runnerSource).toMatch(
      /serializedHttpRequestBytes \+ operationBytes >\s*MAX_HTTP_REQUEST_BYTES/,
    );
    expect(runnerSource).toContain(
      "assertSerializedRequestLength(method, url, arg1, arg2)",
    );
    expect(runnerSource).toContain('"base64-arraybuffer"');
    expect(runnerSource).toContain(
      "body.length > MAX_BASE64_RESPONSE_SOURCE_BYTES",
    );
    expect(runnerSource).toContain('"base64-json-or-text"');
    expect(runnerSource).toContain('"base64-text"');
    expect(runnerSource).toContain('data: body.toString("base64")');
    expect(runnerSource).toContain("function decodeUtf8(bytes)");
  });

  test("untrusted Agent options cannot replace lookup or socket creation", () => {
    const safeAgentOptionSection: string = runnerSource.slice(
      runnerSource.indexOf("const pickAgentOptions"),
      runnerSource.indexOf("const toPlainHeaders"),
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
