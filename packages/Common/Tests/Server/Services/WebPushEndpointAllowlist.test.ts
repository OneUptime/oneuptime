import PushNotificationService from "../../../Server/Services/PushNotificationService";
import { describe, expect, test } from "@jest/globals";

/*
 * A Web Push subscription is a JSON blob the browser hands the client, which
 * OneUptime stores verbatim in UserPush.deviceToken and later passes to
 * web-push. web-push POSTs to whatever "endpoint" names — host, port and path
 * — so an attacker who can register a device controls the destination of a
 * request the server makes from inside its own network.
 *
 * Only the browser vendors' push services are legitimate destinations, so the
 * check is an allowlist. It parses with the WHATWG parser on purpose: that is
 * the parser web-push uses, so what is validated is what gets dialed.
 */

type Assert = (endpoint: unknown) => void;

const assertAllowed: Assert = (endpoint: unknown): void => {
  PushNotificationService.assertWebPushEndpointIsAllowed(endpoint);
};

describe("Web push endpoint allowlist accepts the real push services", () => {
  const allowedEndpoints: Array<string> = [
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com/wp/abc123",
    "https://android.googleapis.com/gcm/send/abc123",
    "https://web.push.apple.com/QLtc-abc123",
    "https://par02p.notify.windows.com/w/?token=abc",
    "https://notify.windows.com/w/?token=abc",
  ];

  test.each(allowedEndpoints)("allows %s", (endpoint: string) => {
    expect(() => {
      return assertAllowed(endpoint);
    }).not.toThrow();
  });
});

describe("Web push endpoint allowlist blocks internal targets", () => {
  const blockedEndpoints: Array<string> = [
    "http://127.0.0.1:8080/push",
    "https://127.0.0.1:8080/push",
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/",
    "http://localhost:9200/_search",
    "https://10.0.0.5/internal",
    "https://[::1]/push",
    "https://metadata.google.internal/computeMetadata/v1/",
  ];

  test.each(blockedEndpoints)("blocks %s", (endpoint: string) => {
    expect(() => {
      return assertAllowed(endpoint);
    }).toThrow();
  });
});

describe("Web push endpoint allowlist resists lookalike hosts", () => {
  const lookalikes: Array<string> = [
    // Suffix matching must be anchored on a dot.
    "https://evilfcm.googleapis.com/fcm/send/x",
    "https://notfcm.googleapis.com/fcm/send/x",
    // The allowed name as a prefix of an attacker's domain.
    "https://fcm.googleapis.com.attacker.example/fcm/send/x",
    "https://push.apple.com.attacker.example/x",
    // The allowed name in the path or the query, not the host.
    "https://attacker.example/fcm.googleapis.com",
    "https://attacker.example/?x=https://fcm.googleapis.com",
    // The allowed name as userinfo — the classic parser differential.
    "https://fcm.googleapis.com@attacker.example/x",
    "https://push.apple.com:443@attacker.example/x",
    "https://fcm.googleapis.com:80@169.254.169.254/latest/meta-data/",
  ];

  test.each(lookalikes)("blocks %s", (endpoint: string) => {
    expect(() => {
      return assertAllowed(endpoint);
    }).toThrow();
  });

  test("a userinfo lookalike is refused because the real host is read", () => {
    /*
     * Guard against a regression to a parser that splits on ":" before "@":
     * that reads the host as "push.apple.com" while the socket goes to
     * 169.254.169.254.
     */
    expect(() => {
      return assertAllowed(
        "https://push.apple.com:80@169.254.169.254/latest/meta-data/",
      );
    }).toThrow("169.254.169.254");
  });
});

describe("Web push endpoint allowlist rejects unusable endpoints", () => {
  test("requires https", () => {
    expect(() => {
      return assertAllowed("http://fcm.googleapis.com/fcm/send/x");
    }).toThrow("https");
  });

  test("rejects a non-http scheme", () => {
    expect(() => {
      return assertAllowed("file:///etc/passwd");
    }).toThrow();

    expect(() => {
      return assertAllowed("gopher://fcm.googleapis.com/x");
    }).toThrow();
  });

  test("rejects a missing or non-string endpoint", () => {
    expect(() => {
      return assertAllowed(undefined);
    }).toThrow();

    expect(() => {
      return assertAllowed("");
    }).toThrow();

    expect(() => {
      return assertAllowed({ endpoint: "https://fcm.googleapis.com/x" });
    }).toThrow();
  });

  test("rejects an unparseable endpoint", () => {
    expect(() => {
      return assertAllowed("not a url");
    }).toThrow();
  });
});
