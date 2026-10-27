import SendGridInboundProvider from "../../../../Server/Services/InboundEmail/Providers/SendGridInboundProvider";
import { ParsedInboundEmail } from "../../../../Server/Services/InboundEmail/InboundEmailProvider";
import IncomingEmailMonitorAddress, {
  IncomingEmailRecipient,
  IncomingEmailRecipientKind,
} from "../../../../Utils/Monitor/IncomingEmailMonitorAddress";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * AN INBOUND EMAIL'S ADDRESSES ARE READ IN TIME IN LINE WITH THE HEADER'S
 * LENGTH.
 *
 * The From and To of an email that reaches the inbound domain are written
 * by whoever sent it, and any length. The address of "Name <address>" is
 * read with a pattern whose bracketed part holds no "<" either, so a match
 * tried from each "<" of a header reads only up to the next one - a header
 * of 400,000 characters is read in well under two seconds - and where
 * several "<" open before a ">", the address is what follows the last one.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;
const DOMAIN: string = "inbound.oneuptime.example";
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const provider: SendGridInboundProvider = new SendGridInboundProvider({
  inboundDomain: DOMAIN,
});

const HEADER_WORST_CASES: Array<[string, string]> = [
  ["opening brackets with no close", repeat("<a", LENGTH)],
  ["opening brackets alone", repeat("<", LENGTH)],
  ["a name and an open bracket", "Alice " + repeat("<alice@", LENGTH)],
  ["brackets around nothing but more brackets", repeat("<<>", LENGTH)],
];

describe("an inbound email's headers are read in time in line with their length", () => {
  test.each(HEADER_WORST_CASES)(
    "From and To of %s",
    async (_label: string, header: string) => {
      const startedAt: number = Date.now();

      await provider.parseInboundEmail({
        from: header,
        to: header,
        subject: "s",
        text: "t",
      });

      expect(Date.now() - startedAt).toBeLessThan(2000);
    },
  );

  test.each(HEADER_WORST_CASES)(
    "a recipient of %s",
    (_label: string, header: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          IncomingEmailMonitorAddress.parseRecipient({
            emailAddress: header,
            inboundDomain: DOMAIN,
          });
          provider.extractSecretKeyFromEmail(header);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});

describe("the address of a header is the one it names", () => {
  test("a name and a bracketed address", async () => {
    const parsed: ParsedInboundEmail = await provider.parseInboundEmail({
      from: "Alerts <Alerts@Acme.example>",
      to: `Backups <monitor-${SECRET}@${DOMAIN}>`,
      subject: "s",
      text: "t",
    });

    expect(parsed.from).toBe("alerts@acme.example");
    expect(parsed.to).toBe(`monitor-${SECRET}@${DOMAIN}`);
  });

  test("a bare address", async () => {
    const parsed: ParsedInboundEmail = await provider.parseInboundEmail({
      from: "alerts@acme.example",
      to: `monitor-${SECRET}@${DOMAIN}`,
      subject: "s",
      text: "t",
    });

    expect(parsed.from).toBe("alerts@acme.example");
    expect(parsed.to).toBe(`monitor-${SECRET}@${DOMAIN}`);
  });

  test("several brackets opened before one closes: the address after the last", async () => {
    const parsed: ParsedInboundEmail = await provider.parseInboundEmail({
      from: "Alerts <<alerts@acme.example>",
      to: `x <y <monitor-${SECRET}@${DOMAIN}>`,
      subject: "s",
      text: "t",
    });

    expect(parsed.from).toBe("alerts@acme.example");
    expect(parsed.to).toBe(`monitor-${SECRET}@${DOMAIN}`);
  });

  test("a monitor's generated address is still read out of a recipient", () => {
    const recipient: IncomingEmailRecipient | null =
      IncomingEmailMonitorAddress.parseRecipient({
        emailAddress: `Backups <monitor-${SECRET}@${DOMAIN}>`,
        inboundDomain: DOMAIN,
      });

    expect(recipient).toEqual({
      kind: IncomingEmailRecipientKind.Generated,
      secretKey: SECRET,
    });
    expect(
      provider.extractSecretKeyFromEmail(
        `Backups <monitor-${SECRET}@${DOMAIN}>`,
      ),
    ).toBe(SECRET);
  });

  test("an address on another domain is still nobody's", () => {
    expect(
      IncomingEmailMonitorAddress.parseRecipient({
        emailAddress: `Backups <monitor-${SECRET}@acme.example>`,
        inboundDomain: DOMAIN,
      }),
    ).toBeNull();
  });
});
