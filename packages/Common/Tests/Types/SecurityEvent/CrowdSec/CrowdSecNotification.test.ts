import { describe, expect, test } from "@jest/globals";
import yaml from "js-yaml";
import { JSONObject } from "../../../../Types/JSON";
import {
  PUSHED_CONNECTION_QUERY_PARAM,
  SECURITY_EVENTS_INGEST_PATH,
  getPushedConnectionAddress,
} from "../../../../Types/SecurityEvent/Connectors/PushedConnectionAddress";
import { getSecurityEventConnectorDefinition } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CROWDSEC_NOTIFICATION_FILE,
  CROWDSEC_NOTIFICATION_NAME,
  CROWDSEC_PROFILE_NOTIFICATIONS,
  CROWDSEC_PROFILES_FILE,
  CROWDSEC_RELOAD_COMMAND,
  CROWDSEC_TEST_COMMAND,
  getCrowdSecAlertsAddress,
  getCrowdSecNotificationYaml,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecNotification";
import SecurityEventFormat from "../../../../Types/SecurityEvent/SecurityEventFormat";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventNormalizer from "../../../../Utils/SecurityEvent/SecurityEventNormalizer";
import { CROWDSEC_DOCS_SSH_BF_NOTIFICATION } from "../../../Utils/SecurityEvent/Connectors/CrowdSecFixtures";

/*
 * The notification a CrowdSec connection hands out (#11158): the file that
 * makes CrowdSec's http plugin send its alerts to that connection. It is
 * checked against what CrowdSec v1.8.2 reads - the plugin's own settings
 * (cmd/notification-http) and the broker's (pkg/csplugin) - and against
 * what OneUptime's ingest reads back: the connection in the address, the
 * key in a header, and the plugin's body as CrowdSec's alerts.
 *
 * Not run here: CrowdSec itself. Its Go template `{{.|toJson}}` renders the
 * list of alerts as JSON, which is the recorded notification body these
 * tests post through the normalizer (CrowdSecFixtures).
 */

const INGEST_URL: string = `https://oneuptime.example.com${SECURITY_EVENTS_INGEST_PATH}`;
const CONNECTION_ID: string = "3f6b1d2e-8a4c-4f0e-9b7d-2c5a6e1f0a9b";
const TOKEN: string = "6d1f3e0c-ingestion-key";

/*
 * Every setting a notification may hold in CrowdSec v1.8.2: the broker's
 * (type, name, the grouping and retry ones, format, log_level) and the
 * http plugin's (its PluginConfig's yaml tags).
 */
const CROWDSEC_NOTIFICATION_SETTINGS: ReadonlyArray<string> = [
  "type",
  "name",
  "log_level",
  "group_wait",
  "group_threshold",
  "max_retry",
  "timeout",
  "format",
  "url",
  "unix_socket",
  "headers",
  "skip_tls_verification",
  "method",
  "cert_path",
  "key_path",
  "ca_cert_path",
];

function notification(): JSONObject {
  return yaml.load(
    getCrowdSecNotificationYaml({
      address: getCrowdSecAlertsAddress({
        ingestUrl: INGEST_URL,
        connectionId: CONNECTION_ID,
      }),
      token: TOKEN,
    }),
  ) as JSONObject;
}

describe("the address CrowdSec sends a connection's alerts to", () => {
  test("is the ingest, naming the connection and CrowdSec's format", () => {
    expect(
      getCrowdSecAlertsAddress({
        ingestUrl: INGEST_URL,
        connectionId: CONNECTION_ID,
      }),
    ).toBe(
      `https://oneuptime.example.com/security-events/v1/ingest?connection=${CONNECTION_ID}&format=crowdsec`,
    );
  });

  test("is read back as the ingest reads it: the connection, and a format it knows", () => {
    const address: URL = new URL(
      getCrowdSecAlertsAddress({
        ingestUrl: INGEST_URL,
        connectionId: CONNECTION_ID,
      }),
    );

    expect(address.pathname).toBe(SECURITY_EVENTS_INGEST_PATH);
    expect(address.searchParams.get(PUSHED_CONNECTION_QUERY_PARAM)).toBe(
      CONNECTION_ID,
    );
    expect(
      SecurityEventNormalizer.parseFormat(
        address.searchParams.get("format") || "",
      ),
    ).toBe(SecurityEventFormat.CrowdSec);
  });

  test("keeps what it names whole, whatever it holds", () => {
    expect(
      getPushedConnectionAddress({
        ingestUrl: INGEST_URL,
        connectionId: "a b&c",
        format: "crowdsec",
      }),
    ).toBe(`${INGEST_URL}?connection=a%20b%26c&format=crowdsec`);
  });
});

describe("the notification a CrowdSec connection hands out", () => {
  test("is an http notification named oneuptime, which profiles name to send their alerts", () => {
    expect(notification()).toMatchObject({
      type: "http",
      name: CROWDSEC_NOTIFICATION_NAME,
      method: "POST",
    });
    expect(CROWDSEC_NOTIFICATION_NAME).toBe("oneuptime");
  });

  test("holds only settings CrowdSec reads", () => {
    for (const key of Object.keys(notification())) {
      expect({
        key,
        isRead: CROWDSEC_NOTIFICATION_SETTINGS.includes(key),
      }).toEqual({ key, isRead: true });
    }
  });

  test("sends the alerts as CrowdSec's own JSON, with the template its http.yaml starts from", () => {
    expect(notification()["format"]).toBe("{{.|toJson}}\n");
  });

  test("posts to the connection's address, with the key in a header and never in the address", () => {
    const settings: JSONObject = notification();

    expect(settings["url"]).toBe(
      getCrowdSecAlertsAddress({
        ingestUrl: INGEST_URL,
        connectionId: CONNECTION_ID,
      }),
    );
    expect(settings["headers"]).toEqual({
      "Content-Type": "application/json",
      "x-oneuptime-token": TOKEN,
    });
    expect(String(settings["url"])).not.toContain(TOKEN);
  });

  test("logs at info, so CrowdSec's log never holds the key: at debug the plugin logs each request's headers", () => {
    expect(notification()["log_level"]).toBe("info");
  });

  test("says how a key not yet picked goes in, as the other guides' placeholders do", () => {
    const settings: JSONObject = yaml.load(
      getCrowdSecNotificationYaml({
        address: getCrowdSecAlertsAddress({
          ingestUrl: INGEST_URL,
          connectionId: CONNECTION_ID,
        }),
        token: "<YOUR_ONEUPTIME_TOKEN>",
      }),
    ) as JSONObject;

    expect((settings["headers"] as JSONObject)["x-oneuptime-token"]).toBe(
      "<YOUR_ONEUPTIME_TOKEN>",
    );
  });

  test("what the plugin then posts - the recorded alerts, as toJson renders them - is read as CrowdSec's alerts", () => {
    const body: Array<JSONObject> = JSON.parse(
      JSON.stringify(CROWDSEC_DOCS_SSH_BF_NOTIFICATION),
    ) as Array<JSONObject>;

    expect(body).toHaveLength(1);

    const event: NormalizedSecurityEvent | null =
      SecurityEventNormalizer.normalize(
        body[0]!,
        SecurityEventNormalizer.parseFormat("crowdsec") || undefined,
      );

    expect(event?.classUid).toBe(2004);
    expect(event?.attributes["crowdsec.scenario"]).toBe("crowdsecurity/ssh-bf");
  });
});

describe("the rest of the setup, in CrowdSec's words", () => {
  test("a profile sends its alerts to the notification by naming it", () => {
    expect(yaml.load(CROWDSEC_PROFILE_NOTIFICATIONS)).toEqual({
      notifications: [CROWDSEC_NOTIFICATION_NAME],
    });
  });

  test("the files are a package install's, and a reload reads them again", () => {
    expect(CROWDSEC_NOTIFICATION_FILE).toBe(
      "/etc/crowdsec/notifications/oneuptime.yaml",
    );
    expect(CROWDSEC_PROFILES_FILE).toBe("/etc/crowdsec/profiles.yaml");
    expect(CROWDSEC_RELOAD_COMMAND).toBe("sudo systemctl reload crowdsec");
  });

  test("the test alert goes through this notification alone, as the connection's Test connection says", () => {
    expect(CROWDSEC_TEST_COMMAND).toBe(
      "sudo cscli notifications test oneuptime",
    );
    expect(
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.CrowdSec,
      )?.howToSendTestAlert,
    ).toContain(CROWDSEC_TEST_COMMAND);
  });
});
