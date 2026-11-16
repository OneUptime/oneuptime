import {
  STATUS_CALLBACK_RETRY_COUNT,
  STATUS_CALLBACK_RETRY_POLICY,
  withRetryOnServerError,
} from "../../FeatureSet/Notification/Utils/StatusCallbackRetry";
import {
  getProviderConfigOfCallback,
  withProviderConfig,
} from "../../FeatureSet/Notification/Utils/StatusCallbackProviderConfig";
import { NotificationProviderConfig } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/*
 * TWILIO SENDS A STATUS CALLBACK AGAIN WHEN THIS SERVER COULD NOT TAKE IT
 * (issue #6874).
 *
 * Twilio sends a webhook again only when it could not connect, by default.
 * A status callback answered with a 5xx - the database failed - was lost.
 * So every SMS's and call's status callback names, in its fragment,
 * Twilio's connection overrides that send it again on a 5xx too: rc, how
 * many times (0 to 5), and rp, on what (ct: a connection that failed, as by
 * default; 5xx: our server's error). Never on a 4xx: a refused token is not
 * worth sending again.
 *
 * A request never carries a fragment, so the route reads the path and the
 * query as before - the log's id, its token, whose account it went out on.
 */

const URL_OF_A_CALLBACK: string =
  "https://oneuptime.example.com/notification/sms/status-callback/5e5e0000-0000-4000-8000-0000000000a1/5e5e0000-0000-4000-8000-0000000000f1";

// What Twilio reads of a callback's fragment: its connection overrides.
function overridesOf(url: string): Record<string, string> {
  return Object.fromEntries(
    new URLSearchParams(new globalThis.URL(url).hash.slice(1)),
  );
}

describe("withRetryOnServerError", () => {
  test("names, in the fragment, a retry count and a retry policy Twilio reads", () => {
    expect(withRetryOnServerError(URL_OF_A_CALLBACK)).toBe(
      `${URL_OF_A_CALLBACK}#rc=3&rp=ct,5xx`,
    );
    expect(overridesOf(withRetryOnServerError(URL_OF_A_CALLBACK))).toEqual({
      rc: "3",
      rp: "ct,5xx",
    });
  });

  test("a few times, within Twilio's range of 0 to 5", () => {
    expect(STATUS_CALLBACK_RETRY_COUNT).toBe(3);
    expect(Number.isInteger(STATUS_CALLBACK_RETRY_COUNT)).toBe(true);
    expect(STATUS_CALLBACK_RETRY_COUNT).toBeGreaterThanOrEqual(1);
    expect(STATUS_CALLBACK_RETRY_COUNT).toBeLessThanOrEqual(5);
  });

  test("on a connection that failed, as Twilio does by default, and on our 5xx - never on a 4xx, a refused callback", () => {
    expect([...STATUS_CALLBACK_RETRY_POLICY]).toEqual(["ct", "5xx"]);

    for (const policy of STATUS_CALLBACK_RETRY_POLICY) {
      // Twilio's own names for what it retries on.
      expect(["4xx", "5xx", "ct", "rt", "all"]).toContain(policy);
    }

    expect(STATUS_CALLBACK_RETRY_POLICY).not.toContain("4xx");
    expect(STATUS_CALLBACK_RETRY_POLICY).not.toContain("all");
  });

  test("keeps the path and the query the route reads: the log's id, its token, whose account", () => {
    const url: globalThis.URL = new globalThis.URL(
      withRetryOnServerError(
        withProviderConfig(
          URL_OF_A_CALLBACK,
          NotificationProviderConfig.Project,
        ),
      ),
    );

    expect(url.host).toBe("oneuptime.example.com");
    expect(url.pathname).toBe(new globalThis.URL(URL_OF_A_CALLBACK).pathname);
    expect([...url.searchParams.entries()]).toEqual([
      ["providerConfig", "project"],
    ]);
    expect(
      getProviderConfigOfCallback(Object.fromEntries(url.searchParams)),
    ).toBe(NotificationProviderConfig.Project);
    expect(url.hash).toBe("#rc=3&rp=ct,5xx");
  });

  test("on the server's own account, adds nothing to the query", () => {
    const url: globalThis.URL = new globalThis.URL(
      withRetryOnServerError(
        withProviderConfig(
          URL_OF_A_CALLBACK,
          NotificationProviderConfig.Global,
        ),
      ),
    );

    expect(url.search).toBe("");
    expect(url.hash).toBe("#rc=3&rp=ct,5xx");
  });
});

describe("every status callback Twilio is handed asks for it", () => {
  /*
   * The two addresses Twilio is told to call back on: an SMS's delivery
   * status (SmsService) and how a call ended (CallService). Each is built
   * once, and each asks to be sent again.
   */
  const SERVICES: Array<[string, string]> = [
    ["SmsService", "/notification/sms/status-callback/"],
    ["CallService", "/notification/call/status-callback/"],
  ];

  test.each(SERVICES)(
    "%s builds its callback's address once, and wraps it",
    (service: string, route: string) => {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Notification",
          "Services",
          `${service}.ts`,
        ),
        "utf8",
      );

      const built: number = source.split(route).length - 1;

      expect(built).toBe(1);

      // The address is built inside withRetryOnServerError(withProviderConfig(...)).
      const at: number = source.indexOf(route);
      const before: string = source.slice(Math.max(0, at - 300), at);

      expect(before).toMatch(
        /withRetryOnServerError\(\s*withProviderConfig\(\s*`\$\{HttpProtocol\}\$\{Host\}$/,
      );
    },
  );
});
