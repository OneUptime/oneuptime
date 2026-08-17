import VMRunner from "../../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * GHSA-v5xh-rw9h-77fv fixed the API workflow components, but the Custom
 * JavaScript component hands user-authored code the HOST process's axios
 * (VMRunner bridges it into the isolate as `_axiosRef`), and the component docs
 * say "you can use axios module". That is the same SSRF with more capability:
 * arbitrary method, headers and body, with the response marshalled back to the
 * author. Guarding only the API components would have been theatre.
 *
 * These tests drive the REAL isolate, so they prove the guard from the position
 * an attacker actually occupies - inside the sandbox - rather than by calling a
 * helper directly. Nothing here needs a network: every assertion is that the
 * request was refused before a socket was opened.
 */

jest.setTimeout(60000);

async function runInSandbox(code: string): Promise<ReturnResult> {
  return VMRunner.runCodeInSandbox({
    code,
    options: { timeout: 15000 },
  });
}

/*
 * The sandbox surfaces a rejected request as a thrown error. Either the promise
 * rejects or the returned result carries the message - accept both, and assert
 * on the SSRF wording so a mere "connection refused" cannot pass for a block.
 */
async function errorFromSandbox(code: string): Promise<string> {
  try {
    const result: ReturnResult = await runInSandbox(code);
    if (result.scriptError) {
      return result.scriptError.message;
    }
    return JSON.stringify(result.returnValue ?? result.logMessages ?? "");
  } catch (err) {
    return (err as Error).message || String(err);
  }
}

const REFUSAL: RegExp =
  /not allowed|private, loopback, or link-local|absolute http|could not be resolved/i;

describe("VMRunner sandbox axios bridge — SSRF guard", () => {
  const internalTargets: Array<[string, string]> = [
    ["AWS metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    [
      "AWS metadata credentials path",
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    ],
    ["GCP metadata by name", "http://metadata.google.internal/"],
    ["loopback", "http://127.0.0.1:8080/"],
    ["localhost", "http://localhost:9200/_cluster/health"],
    ["RFC-1918", "http://10.0.0.5/internal"],
    ["IPv6 loopback", "http://[::1]:5432/"],
    ["IPv4-mapped metadata endpoint", "http://[::ffff:169.254.169.254]/"],
  ];

  test.each(internalTargets)(
    "refuses axios.get to the %s",
    async (_label: string, url: string) => {
      const message: string = await errorFromSandbox(
        `return await axios.get(${JSON.stringify(url)});`,
      );
      expect(message).toMatch(REFUSAL);
    },
  );

  test.each(internalTargets)(
    "refuses axios.post to the %s",
    async (_label: string, url: string) => {
      const message: string = await errorFromSandbox(
        `return await axios.post(${JSON.stringify(url)}, { a: 1 });`,
      );
      expect(message).toMatch(REFUSAL);
    },
  );

  test("refuses axios.request, where the URL lives in the config", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.request({ method: 'get', url: 'http://169.254.169.254/latest/meta-data/' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a target assembled from baseURL and a relative path", async () => {
    // The positional url is harmless on its own; baseURL is where it goes.
    const message: string = await errorFromSandbox(
      `return await axios.get('/latest/meta-data/', { baseURL: 'http://169.254.169.254' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a baseURL-only request()", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.request({ method: 'get', baseURL: 'http://127.0.0.1:8080', url: '/admin' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test.each(["head", "options", "put", "patch", "delete"])(
    "refuses axios.%s to an internal address",
    async (method: string) => {
      const call: string =
        method === "put" || method === "patch"
          ? `axios.${method}('http://169.254.169.254/', {})`
          : `axios.${method}('http://169.254.169.254/')`;
      const message: string = await errorFromSandbox(`return await ${call};`);
      expect(message).toMatch(REFUSAL);
    },
  );

  test("refuses a non-http scheme", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.get('file:///etc/passwd');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a relative URL with no baseURL rather than guessing", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.get('/latest/meta-data/');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  /*
   * A proxy or a unix socket steers the connection somewhere the validated URL
   * never named — /var/run/docker.sock being the memorable one — so the guard
   * strips them rather than trusting the URL alone.
   */
  test("a proxy in the config cannot steer a public URL at an internal host", async () => {
    /*
     * A public IP literal (no DNS) with a 1ms timeout, so this settles offline
     * and instantly. The point is only that the metadata endpoint named in
     * `proxy` is never what gets dialled.
     */
    const message: string = await errorFromSandbox(
      `try { return await axios.get('http://8.8.8.8/', { timeout: 1, proxy: { host: '169.254.169.254', port: 80 } }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(/169\.254\.169\.254/);
  });

  test("still lets an ordinary public URL past the guard", async () => {
    /*
     * 8.8.8.8 is never actually reached - the 1ms timeout sees to that. The
     * assertion is that the failure is a TRANSPORT failure, not the SSRF guard,
     * i.e. the block above is not simply refusing everything.
     */
    const message: string = await errorFromSandbox(
      `try { return await axios.get('http://8.8.8.8/', { timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });
});

/*
 * The "is this already an absolute URL?" decision is what tells the guard
 * whether to fold in baseURL before validating, so it has to be scheme
 * case-insensitive and slash-tolerant — otherwise HTTP:// (uppercase) or a
 * baseURL with stray slashes could be mis-classified and skip the check.
 */
describe("VMRunner sandbox axios bridge — URL absolutization", () => {
  test("an uppercase scheme is still recognised as absolute and its host checked", async () => {
    // HTTP:// (uppercase) must not slip past the loopback block.
    const message: string = await errorFromSandbox(
      `return await axios.get('HTTP://127.0.0.1:8080/admin');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("a mixed-case scheme on a public host passes the guard, failing only at transport", async () => {
    const message: string = await errorFromSandbox(
      `try { return await axios.get('HtTpS://8.8.8.8/', { timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });

  test("stray slashes joining baseURL and a relative path do not evade the block", async () => {
    // baseURL trailing slashes + a leading-slash relative path, internal host.
    const message: string = await errorFromSandbox(
      `return await axios.get('//latest/meta-data/', { baseURL: 'http://169.254.169.254//' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("a baseURL + relative path resolving to a public host clears the guard", async () => {
    const message: string = await errorFromSandbox(
      `try { return await axios.get('/path', { baseURL: 'http://8.8.8.8', timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });
});
