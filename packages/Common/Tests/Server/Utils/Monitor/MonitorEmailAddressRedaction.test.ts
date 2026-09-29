import {
  redactMonitorEmailAddress,
  redactMonitorSecret,
} from "../../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * An Incoming Email monitor with a custom address receives mail at
 * `{name}@{inboundDomain}` rather than at `monitor-{secretKey}@...`. That name
 * is now the credential: whoever reads it can send mail the monitor counts. It
 * reaches the stored payload the same way the generated address did -- in
 * `emailTo`, `To:`, `Delivered-To:` and `Received:` -- and from there columns a
 * Viewer can select.
 *
 * `redactMonitorEmailAddress` masks it. The hard part is what it must NOT
 * touch: a custom name is an ordinary word, so a naive substring sweep would
 * eat subjects, bodies and the sender's own address -- which is evidence, and
 * which the "Email from" criteria evaluate.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const NAME: string = "backups";
const ADDRESS: string = `${NAME}@${DOMAIN}`;
const MASKED: string = `${REDACTED}@${DOMAIN}`;

type EmailPayloadFunction = () => JSONObject;

const emailPayload: EmailPayloadFunction = (): JSONObject => {
  return {
    emailFrom: "backups@acme.example",
    emailTo: ADDRESS,
    emailSubject: "Nightly backups completed",
    emailBody: `Backups finished. Replies go to ${ADDRESS}.`,
    emailHeaders: {
      To: `Backups Bot <${ADDRESS}>`,
      From: "Backups <backups@acme.example>",
      "Delivered-To": ADDRESS,
      Received: `by mx.sendgrid.net with SMTP id xW9 for <${ADDRESS}>; Sun, 23 Aug 2026 10:00:00 +0000`,
    },
    attachments: [
      { filename: "backups.log", contentType: "text/plain", size: 2048 },
    ],
  };
};

type RedactFunction = (payload: JSONObject) => JSONObject;

const redact: RedactFunction = (payload: JSONObject): JSONObject => {
  return redactMonitorEmailAddress(payload, {
    localPart: NAME,
    domain: DOMAIN,
  });
};

describe("redactMonitorEmailAddress - the custom address is masked", () => {
  it("leaves the full address nowhere in the payload", () => {
    const result: JSONObject = redact(emailPayload());

    expect(JSON.stringify(result).toLowerCase()).not.toContain(ADDRESS);
  });

  it("masks the recipient but keeps the inbound domain readable", () => {
    const result: JSONObject = redact(emailPayload());

    expect(result["emailTo"]).toBe(MASKED);
  });

  it("masks the To:, Delivered-To: and Received: copies", () => {
    const headers: JSONObject = redact(emailPayload())[
      "emailHeaders"
    ] as JSONObject;

    expect(headers["To"]).toBe(`Backups Bot <${MASKED}>`);
    expect(headers["Delivered-To"]).toBe(MASKED);
    expect(headers["Received"]).toBe(
      `by mx.sendgrid.net with SMTP id xW9 for <${MASKED}>; Sun, 23 Aug 2026 10:00:00 +0000`,
    );
  });

  it("masks a copy in the body", () => {
    expect(redact(emailPayload())["emailBody"]).toBe(
      `Backups finished. Replies go to ${MASKED}.`,
    );
  });

  it("masks the address whatever case a relay used", () => {
    const result: JSONObject = redact({
      emailTo: ADDRESS.toUpperCase(),
      emailHeaders: { To: `BaCkUpS@${DOMAIN.toUpperCase()}` },
    });

    expect(JSON.stringify(result).toLowerCase()).not.toContain(ADDRESS);
    expect(result["emailTo"]).toBe(`${REDACTED}@${DOMAIN.toUpperCase()}`);
  });

  it("masks every occurrence in one string", () => {
    expect(
      redact({ emailBody: `${ADDRESS}, ${ADDRESS};${ADDRESS}` })["emailBody"],
    ).toBe(`${MASKED}, ${MASKED};${MASKED}`);
  });

  it("masks header names too, which are no more trustworthy than values", () => {
    const result: JSONObject = redact({
      emailHeaders: { [`rfc822;${ADDRESS}`]: "1" },
    });

    expect(JSON.stringify(result)).not.toContain(ADDRESS);
  });
});

describe("redactMonitorEmailAddress - the evidence survives", () => {
  it("keeps the sender's own address, even when it shares the name", () => {
    /*
     * backups@acme.example sending to backups@<inbound> is exactly the setup a
     * customer is likely to pick. The sender is evidence, and "Email from"
     * criteria read it.
     */
    const result: JSONObject = redact(emailPayload());
    const headers: JSONObject = result["emailHeaders"] as JSONObject;

    expect(result["emailFrom"]).toBe("backups@acme.example");
    expect(headers["From"]).toBe("Backups <backups@acme.example>");
  });

  it("keeps the name where it is just a word", () => {
    const result: JSONObject = redact(emailPayload());

    expect(result["emailSubject"]).toBe("Nightly backups completed");
    expect(result["attachments"]).toEqual([
      { filename: "backups.log", contentType: "text/plain", size: 2048 },
    ]);
  });

  it("leaves a longer mailbox that merely ends in the name alone", () => {
    // nightly-backups@ is a different mailbox (maybe another monitor's).
    const other: string = `nightly-${ADDRESS}`;

    expect(redact({ emailTo: other })["emailTo"]).toBe(other);
    expect(redact({ emailTo: `x.${ADDRESS}` })["emailTo"]).toBe(`x.${ADDRESS}`);
  });

  it("does not mutate the payload it was given", () => {
    const payload: JSONObject = emailPayload();
    const before: string = JSON.stringify(payload);

    redact(payload);

    expect(JSON.stringify(payload)).toBe(before);
  });

  it("passes live Dates and ObjectIDs through untouched", () => {
    const receivedAt: Date = new Date("2026-08-23T10:00:00.000Z");
    const monitorId: ObjectID = new ObjectID(
      "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c",
    );

    const result: JSONObject = redactMonitorEmailAddress(
      {
        emailTo: ADDRESS,
        emailReceivedAt: receivedAt,
        monitorId: monitorId,
      } as unknown as JSONObject,
      { localPart: NAME, domain: DOMAIN },
    );

    expect(result["emailTo"]).toBe(MASKED);

    expect(result["emailReceivedAt"]).toBe(receivedAt);
    expect(result["monitorId"]).toBe(monitorId);
  });
});

describe("redactMonitorEmailAddress - edges", () => {
  it.each([null, undefined, ""])(
    "is a no-op when the monitor has no custom name (%p)",
    (localPart: string | null | undefined) => {
      const payload: JSONObject = emailPayload();

      expect(
        redactMonitorEmailAddress(payload, {
          localPart: localPart,
          domain: DOMAIN,
        }),
      ).toBe(payload);
    },
  );

  it("passes null and undefined payloads through", () => {
    expect(
      redactMonitorEmailAddress(null, { localPart: NAME, domain: DOMAIN }),
    ).toBeNull();
    expect(
      redactMonitorEmailAddress(undefined, {
        localPart: NAME,
        domain: DOMAIN,
      }),
    ).toBeUndefined();
  });

  it("over-redacts rather than leaks when the inbound domain is unknown", () => {
    const result: JSONObject = redactMonitorEmailAddress(emailPayload(), {
      localPart: NAME,
      domain: undefined,
    });

    expect(JSON.stringify(result).toLowerCase()).not.toContain(ADDRESS);
    expect(result["emailTo"]).toBe(MASKED);
  });
});

describe("redactMonitorSecret - unchanged by the shared sweep", () => {
  /*
   * redactMonitorEmailAddress reuses the walker behind redactMonitorSecret.
   * These pin that the generated-address path still behaves exactly as before.
   */
  const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
  const GENERATED: string = `monitor-${SECRET}@${DOMAIN}`;

  it("masks the key inside the generated address, keeping the rest", () => {
    const result: JSONObject = redactMonitorSecret(
      {
        emailTo: GENERATED,
        emailHeaders: { [`X-${SECRET}`]: GENERATED.toUpperCase() },
      },
      SECRET,
    );

    expect(result["emailTo"]).toBe(`monitor-${REDACTED}@${DOMAIN}`);
    expect(JSON.stringify(result).toLowerCase()).not.toContain(SECRET);
  });

  it("still ignores a secret too short to be one we minted", () => {
    const payload: JSONObject = { emailSubject: "abc" };

    expect(redactMonitorSecret(payload, "abc")).toBe(payload);
  });

  it("composes with the custom-address redaction", () => {
    const result: JSONObject = redactMonitorEmailAddress(
      redactMonitorSecret(
        { emailTo: ADDRESS, emailBody: `old address ${GENERATED}` },
        SECRET,
      ),
      { localPart: NAME, domain: DOMAIN },
    );

    expect(result["emailTo"]).toBe(MASKED);
    expect(result["emailBody"]).toBe(
      `old address monitor-${REDACTED}@${DOMAIN}`,
    );
  });
});
