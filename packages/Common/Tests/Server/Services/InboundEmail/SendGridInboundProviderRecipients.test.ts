import {
  ParsedInboundEmail,
  getInboundEmailRecipientAddresses,
} from "../../../../Server/Services/InboundEmail/InboundEmailProvider";
import SendGridInboundProvider from "../../../../Server/Services/InboundEmail/Providers/SendGridInboundProvider";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * Who an inbound email is for.
 *
 * Incoming Email monitors were reached through the To header alone, read as
 * one address. A workflow's address is as likely to be copied in, sent as a
 * blind copy, or reached through a forwarding rule - none of which leaves it
 * alone in To, or in To at all. SendGrid says who each delivery is for in its
 * `envelope` field (the SMTP RCPT TO), and posts one webhook per recipient, so
 * that is what counts when it is there; without it, everyone in To and Cc
 * does.
 *
 * `to` itself is unchanged: monitors evaluate it in their "Email To" criteria.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const WORKFLOW: string = `workflow-7c9e6679-7425-40de-944b-e07fc1f90ae7@${DOMAIN}`;
const MONITOR: string = `monitor-b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba@${DOMAIN}`;

const provider: SendGridInboundProvider = new SendGridInboundProvider({
  inboundDomain: DOMAIN,
});

type ParseFunction = (fields: JSONObject) => Promise<ParsedInboundEmail>;

// The multipart fields SendGrid Inbound Parse posts.
const parse: ParseFunction = async (
  fields: JSONObject,
): Promise<ParsedInboundEmail> => {
  return await provider.parseInboundEmail({
    from: "Vendor Alerts <alerts@vendor.example>",
    subject: "Disk space low",
    text: "Only 4% left.",
    ...fields,
  });
};

describe("SendGridInboundProvider.parseInboundEmail recipients", () => {
  it("lists every address in To", async () => {
    const parsed: ParsedInboundEmail = await parse({
      to: `"Ops, Night" <ops@acme.example>, Workflow <${WORKFLOW}>`,
    });

    expect(parsed.toAddresses).toEqual(["ops@acme.example", WORKFLOW]);
  });

  it("keeps `to` as monitors have always read it", async () => {
    const parsed: ParsedInboundEmail = await parse({
      to: `Monitor <${MONITOR.toUpperCase()}>`,
    });

    expect(parsed.to).toBe(MONITOR);
  });

  it("lists every address in Cc", async () => {
    const parsed: ParsedInboundEmail = await parse({
      to: "ops@acme.example",
      cc: `${WORKFLOW}, Bob <bob@acme.example>`,
    });

    expect(parsed.ccAddresses).toEqual([WORKFLOW, "bob@acme.example"]);
  });

  it("an email with no Cc has none", async () => {
    expect((await parse({ to: "ops@acme.example" })).ccAddresses).toEqual([]);
  });

  it("reads the envelope's recipients from SendGrid's JSON", async () => {
    const parsed: ParsedInboundEmail = await parse({
      to: "ops@acme.example",
      envelope: JSON.stringify({
        to: [WORKFLOW.toUpperCase()],
        from: "bounces@vendor.example",
      }),
    });

    expect(parsed.envelopeRecipients).toEqual([WORKFLOW]);
  });

  it("reads an envelope whose `to` is a single string", async () => {
    const parsed: ParsedInboundEmail = await parse({
      to: "ops@acme.example",
      envelope: JSON.stringify({ to: WORKFLOW }),
    });

    expect(parsed.envelopeRecipients).toEqual([WORKFLOW]);
  });

  it.each([
    "not json",
    "[]",
    "{}",
    JSON.stringify({ to: 42 }),
    JSON.stringify({ to: [42, null] }),
  ])("an envelope like %p has no recipients", async (envelope: string) => {
    expect(
      (await parse({ to: "ops@acme.example", envelope })).envelopeRecipients,
    ).toEqual([]);
  });
});

describe("getInboundEmailRecipientAddresses", () => {
  const email: (
    overrides: Partial<ParsedInboundEmail>,
  ) => ParsedInboundEmail = (
    overrides: Partial<ParsedInboundEmail>,
  ): ParsedInboundEmail => {
    return {
      from: "alerts@vendor.example",
      to: "ops@acme.example",
      subject: "Disk space low",
      body: "Only 4% left.",
      ...overrides,
    };
  };

  it("the envelope wins: a Bcc or a forwarding rule appears nowhere else", () => {
    expect(
      getInboundEmailRecipientAddresses(
        email({
          toAddresses: ["ops@acme.example"],
          ccAddresses: [MONITOR],
          envelopeRecipients: [WORKFLOW],
        }),
      ),
    ).toEqual([WORKFLOW]);
  });

  it("without an envelope, everyone in To and Cc counts, once each", () => {
    expect(
      getInboundEmailRecipientAddresses(
        email({
          toAddresses: ["ops@acme.example", WORKFLOW],
          ccAddresses: [WORKFLOW, MONITOR],
          envelopeRecipients: [],
        }),
      ),
    ).toEqual(["ops@acme.example", WORKFLOW, MONITOR]);
  });

  it("with no lists at all, the one `to` address counts, as it always did", () => {
    expect(
      getInboundEmailRecipientAddresses(email({ to: MONITOR.toUpperCase() })),
    ).toEqual([MONITOR]);
  });

  it("an email with no recipients at all has none", () => {
    expect(getInboundEmailRecipientAddresses(email({ to: "" }))).toEqual([]);
  });

  it("works on what the SendGrid provider parses, end to end", async () => {
    const parsed: ParsedInboundEmail = await provider.parseInboundEmail({
      from: "alerts@vendor.example",
      to: "Team <team@acme.example>",
      cc: `Workflow <${WORKFLOW}>`,
      subject: "Disk space low",
      text: "Only 4% left.",
    });

    expect(getInboundEmailRecipientAddresses(parsed)).toEqual([
      "team@acme.example",
      WORKFLOW,
    ]);
  });
});
