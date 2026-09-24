import SendGridInboundProvider from "../../../../Server/Services/InboundEmail/Providers/SendGridInboundProvider";
import IncomingEmailMonitorAddress from "../../../../Utils/Monitor/IncomingEmailMonitorAddress";
import { describe, expect, it } from "@jest/globals";

/*
 * SendGridInboundProvider's address helpers now delegate to
 * IncomingEmailMonitorAddress, so the generated monitor-{secretKey} format is
 * defined in exactly one place. These pin that the provider still speaks it,
 * and that a custom address -- which carries no key -- yields none.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

const provider: SendGridInboundProvider = new SendGridInboundProvider({
  inboundDomain: DOMAIN,
});

describe("SendGridInboundProvider.generateMonitorEmailAddress", () => {
  it("builds the generated address", () => {
    expect(provider.generateMonitorEmailAddress(SECRET)).toBe(
      `monitor-${SECRET}@${DOMAIN}`,
    );
  });

  it("agrees with the address the dashboard shows", () => {
    expect(provider.generateMonitorEmailAddress(SECRET)).toBe(
      IncomingEmailMonitorAddress.getAddress({
        secretKey: SECRET,
        inboundDomain: DOMAIN,
      }),
    );
  });
});

describe("SendGridInboundProvider.extractSecretKeyFromEmail", () => {
  it("reads the key back out of a generated address", () => {
    expect(
      provider.extractSecretKeyFromEmail(`monitor-${SECRET}@${DOMAIN}`),
    ).toBe(SECRET);
  });

  it('reads it out of "Name <address>"', () => {
    expect(
      provider.extractSecretKeyFromEmail(
        `Backups Monitor <monitor-${SECRET}@${DOMAIN}>`,
      ),
    ).toBe(SECRET);
  });

  it("is case-insensitive", () => {
    expect(
      provider.extractSecretKeyFromEmail(
        `MONITOR-${SECRET.toUpperCase()}@${DOMAIN.toUpperCase()}`,
      ),
    ).toBe(SECRET);
  });

  it("round-trips generateMonitorEmailAddress", () => {
    expect(
      provider.extractSecretKeyFromEmail(
        provider.generateMonitorEmailAddress(SECRET),
      ),
    ).toBe(SECRET);
  });

  it.each([
    `nightly-backups@${DOMAIN}`,
    `monitor-backups@${DOMAIN}`,
    `monitor-${SECRET}@acme.example`,
    `monitor-${SECRET}@sub.${DOMAIN}`,
    "not-an-address",
    "",
  ])("finds no key in %p", (email: string) => {
    expect(provider.extractSecretKeyFromEmail(email)).toBeNull();
  });
});

describe("SendGridInboundProvider.parseInboundEmail", () => {
  it("normalizes the recipient the router resolves the monitor from", async () => {
    const parsed: { to: string } = await provider.parseInboundEmail({
      from: "Alerts <alerts@acme.example>",
      to: `Backups <Nightly-Backups@${DOMAIN}>`,
      subject: "Nightly backups completed",
      text: "ok",
    });

    expect(parsed.to).toBe(`nightly-backups@${DOMAIN}`);
  });
});
