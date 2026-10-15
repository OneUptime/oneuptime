import { ParsedInboundEmail } from "../../../../Server/Services/InboundEmail/InboundEmailProvider";
import SendGridInboundProvider from "../../../../Server/Services/InboundEmail/Providers/SendGridInboundProvider";
import { JSONObject } from "../../../../Types/JSON";
import EmailThreadHeaders from "../../../../Utils/Email/EmailThreadHeaders";
import { describe, expect, it } from "@jest/globals";

/*
 * The headers of an inbound email, as SendGrid Inbound Parse posts them: one
 * block of text, a header per line.
 *
 * A long header is folded over several lines, every line after its first
 * starting with a space or a tab (RFC 5322 section 2.2.3). Long threads fold
 * their References, Outlook starts some Message-IDs on the line after the
 * name, and every relay folds its Received header. Read line by line, the
 * folded lines were dropped - a thread's newer emails and some emails' whole
 * Message-ID with them - or, when one held a colon, read as a header of its
 * own. An Incoming Email monitor that opens an incident for every email tells
 * emails apart, and finds the email a reply answers, by exactly those
 * headers.
 */

const DOMAIN: string = "inbound.oneuptime.example";

const provider: SendGridInboundProvider = new SendGridInboundProvider({
  inboundDomain: DOMAIN,
});

type HeadersFunction = (
  raw: string,
) => Promise<Record<string, string> | undefined>;

// The headers SendGrid's `headers` field parses to.
const headersOf: HeadersFunction = async (
  raw: string,
): Promise<Record<string, string> | undefined> => {
  const fields: JSONObject = {
    from: "Reporter <reporter@acme.example>",
    to: `support@${DOMAIN}`,
    subject: "Printer on floor 3 is down",
    text: "It shows error 41.",
    headers: raw,
  };

  const parsed: ParsedInboundEmail = await provider.parseInboundEmail(fields);

  return parsed.headers;
};

describe("SendGridInboundProvider.parseInboundEmail headers", () => {
  it("reads one header per line, as it always has", async () => {
    expect(
      await headersOf(
        [
          "Message-ID: <a1@mail.acme.example>",
          "Subject: Printer on floor 3 is down",
          "X-Mailer: Acme Mail 7",
        ].join("\r\n"),
      ),
    ).toEqual({
      "Message-ID": "<a1@mail.acme.example>",
      Subject: "Printer on floor 3 is down",
      "X-Mailer": "Acme Mail 7",
    });
  });

  it("joins a References header folded over several lines", async () => {
    const headers: Record<string, string> | undefined = await headersOf(
      [
        "References: <root@mail.acme.example>",
        " <second@mail.acme.example>",
        "\t<third@mail.acme.example>",
        "In-Reply-To: <third@mail.acme.example>",
      ].join("\r\n"),
    );

    expect(headers?.["References"]).toBe(
      "<root@mail.acme.example> <second@mail.acme.example> <third@mail.acme.example>",
    );
    expect(headers?.["In-Reply-To"]).toBe("<third@mail.acme.example>");
  });

  it("reads a Message-ID written on the line after its name", async () => {
    const headers: Record<string, string> | undefined = await headersOf(
      [
        "Message-ID:",
        " <BY5PR04MB7123ABCD@BY5PR04MB7123.namprd04.prod.outlook.com>",
        "Subject: Help",
      ].join("\r\n"),
    );

    expect(headers?.["Message-ID"]).toBe(
      "<BY5PR04MB7123ABCD@BY5PR04MB7123.namprd04.prod.outlook.com>",
    );
    expect(EmailThreadHeaders.getMessageId(headers)).toBe(
      "BY5PR04MB7123ABCD@BY5PR04MB7123.namprd04.prod.outlook.com",
    );
  });

  it("does not read a folded line with a colon in it as a header of its own", async () => {
    const headers: Record<string, string> | undefined = await headersOf(
      [
        "Received: from mail.acme.example (mail.acme.example [203.0.113.5])",
        "\tby mx.oneuptime.example with ESMTPS id 4f2a;",
        "\tWed, 14 Oct 2026 10:00:00 +0000 (UTC)",
        "Subject: Printer on floor 3 is down",
      ].join("\r\n"),
    );

    expect(Object.keys(headers || {})).toEqual(["Received", "Subject"]);
    expect(headers?.["Received"]).toBe(
      "from mail.acme.example (mail.acme.example [203.0.113.5]) by mx.oneuptime.example with ESMTPS id 4f2a; Wed, 14 Oct 2026 10:00:00 +0000 (UTC)",
    );
  });

  it("reads LF line ends as it reads CRLF", async () => {
    const crlf: Record<string, string> | undefined = await headersOf(
      "References: <a@x>\r\n <b@x>\r\nSubject: Hi",
    );
    const lf: Record<string, string> | undefined = await headersOf(
      "References: <a@x>\n <b@x>\nSubject: Hi",
    );

    expect(lf).toEqual(crlf);
    expect(lf).toEqual({ References: "<a@x> <b@x>", Subject: "Hi" });
  });

  it("an empty line ends folding, and a folded line with no header above it is read as before", async () => {
    expect(
      await headersOf(
        [" X-First: one", "Subject: Hi", "", " stray: line"].join("\r\n"),
      ),
    ).toEqual({ "X-First": "one", Subject: "Hi", stray: "line" });
  });

  it("a blank folded line adds nothing", async () => {
    expect(
      await headersOf(["Subject: Hello", "   ", "X-Other: 1"].join("\r\n")),
    ).toEqual({ Subject: "Hello", "X-Other": "1" });
  });

  it("an email with no headers has none", async () => {
    expect(await headersOf("")).toBeUndefined();
  });

  it("gives the thread headers a reply's own mail program wrote, whole, to the reader that finds its incident", async () => {
    const headers: Record<string, string> | undefined = await headersOf(
      [
        "Message-ID: <reply-3@mail.acme.example>",
        "In-Reply-To:",
        " <reply-2@mail.acme.example>",
        "References: <report@mail.acme.example>",
        " <reply-1@mail.acme.example>",
        " <reply-2@mail.acme.example>",
      ].join("\r\n"),
    );

    expect(EmailThreadHeaders.getMessageId(headers)).toBe(
      "reply-3@mail.acme.example",
    );
    expect(EmailThreadHeaders.getReferencedMessageIds(headers)).toEqual([
      "reply-2@mail.acme.example",
      "report@mail.acme.example",
      "reply-1@mail.acme.example",
    ]);
  });
});
