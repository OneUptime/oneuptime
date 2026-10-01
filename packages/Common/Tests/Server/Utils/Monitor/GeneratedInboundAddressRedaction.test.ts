import { redactGeneratedInboundAddressKeys } from "../../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * redactGeneratedInboundAddressKeys: the OTHER monitor and workflow addresses
 * on the inbound email domain, in an email that one receiver keeps a copy of.
 *
 * One email can go to a monitor (monitor-{key}@) and a workflow
 * (workflow-{key}@) at once. Each keeps the whole email - the monitor on its
 * row, the workflow in its run's log - and each is readable by people who may
 * not read the other. The keys have a fixed shape, so they are masked by it.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const MONITOR_KEY: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const WORKFLOW_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const MONITOR_ADDRESS: string = `monitor-${MONITOR_KEY}@${DOMAIN}`;
const WORKFLOW_ADDRESS: string = `workflow-${WORKFLOW_KEY}@${DOMAIN}`;

const EMAIL: JSONObject = {
  emailTo: `${MONITOR_ADDRESS}, ${WORKFLOW_ADDRESS.toUpperCase()}`,
  emailHeaders: {
    To: `Backups <${MONITOR_ADDRESS}>`,
    Cc: `Ops <${WORKFLOW_ADDRESS}>`,
    [`X-Note-${WORKFLOW_ADDRESS}`]: "a header named after the address",
  },
  emailBody: `Reply to ${WORKFLOW_ADDRESS} or ${MONITOR_ADDRESS}. Ticket ${MONITOR_KEY}.`,
  attachments: [{ filename: `${WORKFLOW_ADDRESS}.txt`, size: 4 }],
};

describe("redactGeneratedInboundAddressKeys", () => {
  test("masks the key of every address with a listed prefix, keeping the prefix and the domain", () => {
    const masked: JSONObject = redactGeneratedInboundAddressKeys(EMAIL, [
      "monitor",
      "workflow",
    ]);

    expect(masked["emailTo"]).toBe(
      `monitor-[REDACTED]@${DOMAIN}, WORKFLOW-[REDACTED]@${DOMAIN.toUpperCase()}`,
    );
    expect((masked["emailHeaders"] as JSONObject)["To"]).toBe(
      `Backups <monitor-[REDACTED]@${DOMAIN}>`,
    );
    expect((masked["emailHeaders"] as JSONObject)["Cc"]).toBe(
      `Ops <workflow-[REDACTED]@${DOMAIN}>`,
    );
    expect(JSON.stringify(masked)).not.toContain(WORKFLOW_KEY);
  });

  test("masks header names and nested values too", () => {
    const masked: JSONObject = redactGeneratedInboundAddressKeys(EMAIL, [
      "workflow",
    ]);

    expect(Object.keys(masked["emailHeaders"] as JSONObject)).toContain(
      `X-Note-workflow-[REDACTED]@${DOMAIN}`,
    );
    expect(
      ((masked["attachments"] as Array<JSONObject>)[0] as JSONObject)[
        "filename"
      ],
    ).toBe(`workflow-[REDACTED]@${DOMAIN}.txt`);
  });

  test("leaves the prefixes it is not given alone", () => {
    const masked: JSONObject = redactGeneratedInboundAddressKeys(EMAIL, [
      "workflow",
    ]);

    expect(masked["emailTo"]).toContain(MONITOR_ADDRESS);
    expect(masked["emailBody"]).toContain(MONITOR_ADDRESS);
  });

  test("leaves a bare UUID alone: only an address's key has the prefix", () => {
    const masked: JSONObject = redactGeneratedInboundAddressKeys(EMAIL, [
      "monitor",
      "workflow",
    ]);

    expect(masked["emailBody"]).toContain(`Ticket ${MONITOR_KEY}.`);
  });

  test("leaves names that only look like an address alone", () => {
    const text: JSONObject = {
      value: "workflow-backups@inbound.oneuptime.example monitor-123@x",
    };

    expect(
      redactGeneratedInboundAddressKeys(text, ["monitor", "workflow"]),
    ).toEqual(text);
  });

  test("does not change what it is handed", () => {
    const copy: string = JSON.stringify(EMAIL);

    redactGeneratedInboundAddressKeys(EMAIL, ["monitor", "workflow"]);

    expect(JSON.stringify(EMAIL)).toBe(copy);
  });

  test("with no prefixes, or nothing to mask, it changes nothing", () => {
    expect(redactGeneratedInboundAddressKeys(EMAIL, [])).toBe(EMAIL);
    expect(redactGeneratedInboundAddressKeys(null, ["workflow"])).toBeNull();
    expect(
      redactGeneratedInboundAddressKeys(undefined, ["workflow"]),
    ).toBeUndefined();
  });
});
