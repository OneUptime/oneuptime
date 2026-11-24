import { JSONObject } from "../../../Types/JSON";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_ATTRIBUTE,
  SECURITY_LOG_OWNERS_MAX,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SecurityConnectionKind,
} from "../../../Types/SecurityCase/SecurityConnection";
import {
  MAX_RESOURCE_ID_LENGTH,
  isLogOfCloudResource,
  readSecurityEventLogOwners,
  readSecurityLogOwners,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CLOUD RESOURCE AND THE FUNCTION WHOSE OWN LOGS AN EVENT WAS READ FROM
 * (#10033).
 *
 * A cloud account's stream files a resource's logs under the connection's
 * service and stamps each line with the resource's ID; a Lambda's logs are
 * filed under the service of the function's name, each with its faas.name.
 * Every event read from such a line carries both (oneuptime.log.cloud.
 * resource_id, oneuptime.log.faas.name), and Connected Signals connects the
 * event to the cloud resource and the function they name - exactly, as
 * their own Security Events pages read them.
 */

const VAULT_ID: string =
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments";
const DB_ARN: string = "arn:aws:rds:us-east-1:111122223333:db:orders-primary";

describe("what an event carries of the records whose own logs it was read from", () => {
  test("the cloud resource its stream stamped, and the function the line was of", () => {
    expect(
      readSecurityEventLogOwners({
        [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: ` ${DB_ARN} `,
        [SECURITY_LOG_FUNCTION_ATTRIBUTE]: " checkout-handler ",
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          "0193c0de-1111-4aaa-8bbb-000000000001",
      }),
    ).toEqual([
      { kind: SecurityConnectionKind.CloudResource, value: DB_ARN },
      {
        kind: SecurityConnectionKind.ServerlessFunction,
        value: "checkout-handler",
      },
    ]);
  });

  test.each<[string, JSONObject | null | undefined]>([
    ["no attributes", undefined],
    ["null", null],
    ["empty values", { [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: "  " }],
    ["a value that is no text", { [SECURITY_LOG_FUNCTION_ATTRIBUTE]: 42 }],
    [
      "an ID longer than any cloud writes",
      {
        [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: `arn:aws:s3:::${"a".repeat(MAX_RESOURCE_ID_LENGTH)}`,
      },
    ],
    [
      "a function name longer than any",
      { [SECURITY_LOG_FUNCTION_ATTRIBUTE]: "f".repeat(256) },
    ],
  ])(
    "%s names none",
    (_case: string, attributes: JSONObject | null | undefined) => {
      expect(readSecurityEventLogOwners(attributes)).toEqual([]);
    },
  );

  test("an inherited key is never read as the event's", () => {
    const attributes: JSONObject = Object.create({
      [SECURITY_LOG_FUNCTION_ATTRIBUTE]: "checkout-handler",
    }) as JSONObject;

    expect(readSecurityEventLogOwners(attributes)).toEqual([]);
  });

  test("an event read from a streamed line carries what the line was of, an Azure ID by its key", () => {
    const [event] = SecurityLogParser.parse({
      body: "sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
      attributes: {
        "resource.cloud.resource_id": VAULT_ID.toUpperCase(),
        "resource.faas.name": "rotate-keys",
      },
      time: new Date("2026-11-18T09:30:00.000Z"),
      logId: "0193c0de-4444-4aaa-8bbb-000000000004",
    });

    expect(readSecurityEventLogOwners(event!.attributes)).toEqual([
      {
        kind: SecurityConnectionKind.CloudResource,
        value: VAULT_ID.toLowerCase(),
      },
      { kind: SecurityConnectionKind.ServerlessFunction, value: "rotate-keys" },
    ]);
  });
});

describe("the owners a request names, read from untrusted JSON", () => {
  test("each of a kind an event names that way, trimmed, each once", () => {
    expect(
      readSecurityLogOwners([
        { kind: "CloudResource", value: ` ${VAULT_ID} ` },
        // The same vault in capitals: one.
        { kind: "CloudResource", value: VAULT_ID.toUpperCase() },
        // Two ARNs of another case are two resources.
        { kind: "CloudResource", value: DB_ARN },
        { kind: "CloudResource", value: DB_ARN.toUpperCase() },
        { kind: "ServerlessFunction", value: "checkout" },
        { kind: "ServerlessFunction", value: "checkout" },
        // Not a kind named this way, not text, nothing.
        { kind: "Host", value: "web-1" },
        { kind: "CloudResource", value: 7 },
        { kind: "ServerlessFunction", value: "   " },
        null,
        "CloudResource",
        ["ServerlessFunction", "x"],
      ]),
    ).toEqual([
      { kind: SecurityConnectionKind.CloudResource, value: VAULT_ID },
      { kind: SecurityConnectionKind.CloudResource, value: DB_ARN },
      {
        kind: SecurityConnectionKind.CloudResource,
        value: DB_ARN.toUpperCase(),
      },
      { kind: SecurityConnectionKind.ServerlessFunction, value: "checkout" },
    ]);
  });

  test("bounded: at most a few, none longer than one can be", () => {
    expect(
      readSecurityLogOwners(
        Array.from({ length: 50 }, (_value: unknown, index: number) => {
          return { kind: "ServerlessFunction", value: `fn-${index}` };
        }),
      ),
    ).toHaveLength(SECURITY_LOG_OWNERS_MAX);
    expect(
      readSecurityLogOwners([
        { kind: "ServerlessFunction", value: "f".repeat(256) },
        {
          kind: "CloudResource",
          value: `/subscriptions/${"x".repeat(MAX_RESOURCE_ID_LENGTH)}`,
        },
      ]),
    ).toEqual([]);
    expect(readSecurityLogOwners(undefined)).toEqual([]);
    expect(readSecurityLogOwners({ kind: "CloudResource" })).toEqual([]);
  });
});

describe("whether the ID a line was stamped with is a cloud resource's", () => {
  test.each([
    ["the ID as its row keeps it", VAULT_ID, true],
    ["its key, as every event keeps it", VAULT_ID.toLowerCase(), true],
    [
      "in capitals, as the Activity Log's export writes it",
      VAULT_ID.toUpperCase(),
      true,
    ],
    ["with a trailing slash", `${VAULT_ID}/`, true],
    ["a vault whose name starts with this one's", `${VAULT_ID}2`, false],
    ["a secret in the vault", `${VAULT_ID}/secrets/db-password`, false],
    [
      "the same vault in another subscription",
      VAULT_ID.replace("6f1c2a3b", "0f1c2a3b"),
      false,
    ],
    ["nothing", "", false],
  ])(
    "an Azure resource: %s",
    (_case: string, stamped: string, expected: boolean) => {
      expect(
        isLogOfCloudResource({
          stampedId: stamped,
          providerResourceId: VAULT_ID,
        }),
      ).toBe(expected);
    },
  );

  test("an ARN, a Google Cloud name or a stand-in only as written", () => {
    expect(
      isLogOfCloudResource({ stampedId: DB_ARN, providerResourceId: DB_ARN }),
    ).toBe(true);
    expect(
      isLogOfCloudResource({
        stampedId: DB_ARN.toUpperCase(),
        providerResourceId: DB_ARN,
      }),
    ).toBe(false);
    expect(
      isLogOfCloudResource({
        stampedId:
          "//run.googleapis.com/projects/acme/locations/us-central1/services/Checkout",
        providerResourceId:
          "//run.googleapis.com/projects/acme/locations/us-central1/services/checkout",
      }),
    ).toBe(false);
    expect(
      isLogOfCloudResource({
        stampedId: "cloud_run_revision service_name=checkout",
        providerResourceId: "cloud_run_revision service_name=checkout",
      }),
    ).toBe(true);
    expect(
      isLogOfCloudResource({
        stampedId: DB_ARN,
        providerResourceId: undefined,
      }),
    ).toBe(false);
  });
});
