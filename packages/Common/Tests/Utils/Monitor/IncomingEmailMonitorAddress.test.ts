import IncomingEmailMonitorAddress, {
  CUSTOM_LOCAL_PART_MAX_LENGTH,
  CUSTOM_LOCAL_PART_MIN_LENGTH,
  GENERATED_LOCAL_PART_PREFIX,
  IncomingEmailRecipient,
  IncomingEmailRecipientKind,
  RESERVED_CUSTOM_LOCAL_PARTS,
} from "../../../Utils/Monitor/IncomingEmailMonitorAddress";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * An Incoming Email monitor has exactly one live inbound address: its custom
 * name while one is set, otherwise the generated monitor-{secretKey} one. This
 * util is the single definition of both shapes, shared by the dashboard (to
 * show and validate), MonitorService (to store) and the ingest path (to
 * route). These tests pin the contract all three rely on.
 */

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const DOMAIN: string = "inbound.example.com";

type NormalizeFunction = (value: string, inboundDomain?: string) => string;

const normalize: NormalizeFunction = (
  value: string,
  inboundDomain: string = DOMAIN,
): string => {
  return IncomingEmailMonitorAddress.normalizeCustomLocalPart({
    value: value,
    inboundDomain: inboundDomain,
  });
};

type ParseFunction = (
  emailAddress: string,
  inboundDomain?: string | null | undefined,
) => IncomingEmailRecipient | null;

const parse: ParseFunction = (
  emailAddress: string,
  inboundDomain: string | null | undefined = DOMAIN,
): IncomingEmailRecipient | null => {
  return IncomingEmailMonitorAddress.parseRecipient({
    emailAddress: emailAddress,
    inboundDomain: inboundDomain,
  });
};

describe("IncomingEmailMonitorAddress.getGeneratedLocalPart", () => {
  it("prefixes the secret key", () => {
    expect(
      IncomingEmailMonitorAddress.getGeneratedLocalPart(new ObjectID(SECRET)),
    ).toBe(`monitor-${SECRET}`);
  });

  it("accepts the key as a plain string", () => {
    expect(IncomingEmailMonitorAddress.getGeneratedLocalPart(SECRET)).toBe(
      `monitor-${SECRET}`,
    );
  });

  it("lowercases the key, because the ingest path lowercases the recipient", () => {
    expect(
      IncomingEmailMonitorAddress.getGeneratedLocalPart(SECRET.toUpperCase()),
    ).toBe(`monitor-${SECRET}`);
  });

  it("uses the exported prefix", () => {
    expect(GENERATED_LOCAL_PART_PREFIX).toBe("monitor-");
  });
});

describe("IncomingEmailMonitorAddress.getLocalPart / getAddress", () => {
  it("uses the generated address when there is no custom name", () => {
    expect(
      IncomingEmailMonitorAddress.getAddress({
        secretKey: new ObjectID(SECRET),
        inboundDomain: DOMAIN,
      }),
    ).toBe(`monitor-${SECRET}@${DOMAIN}`);
  });

  it("uses the custom name instead of the generated address when one is set", () => {
    expect(
      IncomingEmailMonitorAddress.getAddress({
        secretKey: new ObjectID(SECRET),
        customLocalPart: "nightly-backups",
        inboundDomain: DOMAIN,
      }),
    ).toBe(`nightly-backups@${DOMAIN}`);
  });

  it("shows a custom address even when the secret key is unknown", () => {
    expect(
      IncomingEmailMonitorAddress.getAddress({
        customLocalPart: "nightly-backups",
        inboundDomain: DOMAIN,
      }),
    ).toBe(`nightly-backups@${DOMAIN}`);
  });

  it.each([null, undefined, ""])(
    "falls back to the generated address when the custom name is %p",
    (customLocalPart: string | null | undefined) => {
      expect(
        IncomingEmailMonitorAddress.getLocalPart({
          secretKey: SECRET,
          customLocalPart: customLocalPart,
        }),
      ).toBe(`monitor-${SECRET}`);
    },
  );

  it("has no local part when neither the key nor a custom name is known", () => {
    /*
     * The shape a Viewer's read comes back in: both credential columns are
     * withheld, so there is nothing to show.
     */
    expect(IncomingEmailMonitorAddress.getLocalPart({})).toBeNull();
    expect(
      IncomingEmailMonitorAddress.getAddress({ inboundDomain: DOMAIN }),
    ).toBeNull();
  });

  it.each([null, undefined, ""])(
    "has no address when the inbound domain is %p",
    (inboundDomain: string | null | undefined) => {
      expect(
        IncomingEmailMonitorAddress.getAddress({
          secretKey: SECRET,
          customLocalPart: "nightly-backups",
          inboundDomain: inboundDomain,
        }),
      ).toBeNull();
    },
  );
});

describe("IncomingEmailMonitorAddress.isGeneratedLocalPart", () => {
  it("recognizes a generated local part", () => {
    expect(
      IncomingEmailMonitorAddress.isGeneratedLocalPart(`monitor-${SECRET}`),
    ).toBe(true);
  });

  it("recognizes it in upper case", () => {
    expect(
      IncomingEmailMonitorAddress.isGeneratedLocalPart(
        `MONITOR-${SECRET.toUpperCase()}`,
      ),
    ).toBe(true);
  });

  it.each([
    "monitor-backups",
    "monitor-",
    "monitor",
    `monitor-${SECRET}-extra`,
    `x-monitor-${SECRET}`,
    SECRET,
    "monitor-b1946ac9-2492-4b0f-9b2f",
  ])("does not treat %p as generated", (localPart: string) => {
    expect(IncomingEmailMonitorAddress.isGeneratedLocalPart(localPart)).toBe(
      false,
    );
  });
});

describe("IncomingEmailMonitorAddress.getCustomLocalPartError", () => {
  it.each([
    "abc",
    "nightly-backups",
    "nightly.backups",
    "nightly_backups",
    "backup-2026",
    "0day",
    "a1b",
    "monitor-backups",
    "a".repeat(CUSTOM_LOCAL_PART_MAX_LENGTH),
  ])("accepts %p", (localPart: string) => {
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError(localPart),
    ).toBeNull();
  });

  it("asks for a name when it is empty", () => {
    expect(IncomingEmailMonitorAddress.getCustomLocalPartError("")).toBe(
      "Please enter a name for the email address.",
    );
  });

  it("rejects a name shorter than the minimum", () => {
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError(
        "a".repeat(CUSTOM_LOCAL_PART_MIN_LENGTH - 1),
      ),
    ).toBe(
      `The email address name must be at least ${CUSTOM_LOCAL_PART_MIN_LENGTH} characters long.`,
    );
  });

  it("rejects a name longer than the RFC 5321 local-part limit", () => {
    expect(CUSTOM_LOCAL_PART_MAX_LENGTH).toBe(64);
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError(
        "a".repeat(CUSTOM_LOCAL_PART_MAX_LENGTH + 1),
      ),
    ).toBe(
      `The email address name cannot be longer than ${CUSTOM_LOCAL_PART_MAX_LENGTH} characters.`,
    );
  });

  it.each([
    "Backups",
    "night backups",
    "backups+prod",
    "backups@x",
    "back/ups",
    "backüps",
    "-backups",
    "backups-",
    ".backups",
    "backups.",
    "_backups",
    "backups_",
    '"quoted"',
  ])("rejects the characters or shape of %p", (localPart: string) => {
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError(localPart),
    ).toContain("can only contain lowercase letters, numbers");
  });

  it("rejects consecutive dots, which RFC 5322 does not allow unquoted", () => {
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError("nightly..backups"),
    ).toBe("The email address name cannot contain two dots in a row.");
  });

  it("rejects the generated shape, so the two namespaces cannot collide", () => {
    /*
     * If a custom name could be "monitor-{someone else's key}", mail to that
     * monitor's generated address would have two possible owners.
     */
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError(`monitor-${SECRET}`),
    ).toContain("reserved for generated addresses");
  });

  it.each([...RESERVED_CUSTOM_LOCAL_PARTS])(
    "rejects the reserved mailbox %p",
    (localPart: string) => {
      expect(
        IncomingEmailMonitorAddress.getCustomLocalPartError(localPart),
      ).toBe(
        `"${localPart}" is reserved and cannot be used as a monitor email address. Please choose a different name.`,
      );
    },
  );

  it("reserves the mailboxes certificate authorities use for domain validation", () => {
    /*
     * CA/Browser Forum constructed addresses. Mail to these is stored on the
     * claiming monitor, so letting a user claim one would hand them a CA's
     * validation link for the inbound domain.
     */
    for (const mailbox of [
      "admin",
      "administrator",
      "webmaster",
      "hostmaster",
      "postmaster",
    ]) {
      expect(RESERVED_CUSTOM_LOCAL_PARTS).toContain(mailbox);
    }
  });

  it("only reserves exact names, not names that contain them", () => {
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError("admin-backups"),
    ).toBeNull();
    expect(
      IncomingEmailMonitorAddress.getCustomLocalPartError("security-scan"),
    ).toBeNull();
  });
});

describe("IncomingEmailMonitorAddress.normalizeCustomLocalPart", () => {
  it("returns a valid name unchanged", () => {
    expect(normalize("nightly-backups")).toBe("nightly-backups");
  });

  it("trims and lowercases what the user typed", () => {
    expect(normalize("  Nightly-Backups  ")).toBe("nightly-backups");
  });

  it("accepts the whole address on the inbound domain and keeps the name", () => {
    expect(normalize(`nightly-backups@${DOMAIN}`)).toBe("nightly-backups");
  });

  it("matches the inbound domain case-insensitively", () => {
    expect(normalize(`Nightly-Backups@${DOMAIN.toUpperCase()}`)).toBe(
      "nightly-backups",
    );
  });

  it("refuses an address on another domain", () => {
    /*
     * Mail only reaches OneUptime on its inbound domain, so accepting
     * "backups@acme.com" would store a name the user thinks is somewhere else.
     */
    expect(() => {
      return normalize("backups@acme.com");
    }).toThrow(
      `Monitor email addresses must use the inbound email domain @${DOMAIN}. Please enter only the part before the @.`,
    );
  });

  it("refuses a full address when the inbound domain is not known", () => {
    expect(() => {
      return normalize(`backups@${DOMAIN}`, "");
    }).toThrow("Please enter only the part of the email address before the @.");
  });

  it("still accepts a bare name when the inbound domain is not known", () => {
    expect(normalize("backups", "")).toBe("backups");
  });

  it("throws a BadDataException, which the API returns as a 400", () => {
    expect(() => {
      return normalize("no");
    }).toThrow(BadDataException);
  });

  it.each([
    ["", "Please enter a name for the email address."],
    ["   ", "Please enter a name for the email address."],
    [`@${DOMAIN}`, "Please enter a name for the email address."],
    ["postmaster", "reserved"],
    [`monitor-${SECRET}`, "reserved for generated addresses"],
    [`monitor-${SECRET.toUpperCase()}@${DOMAIN}`, "reserved for generated"],
    ["a b", "can only contain"],
  ])("rejects %p", (value: string, message: string) => {
    expect(() => {
      return normalize(value);
    }).toThrow(message);
  });
});

describe("IncomingEmailMonitorAddress.parseRecipient", () => {
  it("reads the secret key out of a generated address", () => {
    expect(parse(`monitor-${SECRET}@${DOMAIN}`)).toEqual({
      kind: IncomingEmailRecipientKind.Generated,
      secretKey: SECRET,
    });
  });

  it("reads a generated address whatever the case, and lowercases the key", () => {
    expect(
      parse(`MONITOR-${SECRET.toUpperCase()}@${DOMAIN.toUpperCase()}`),
    ).toEqual({
      kind: IncomingEmailRecipientKind.Generated,
      secretKey: SECRET,
    });
  });

  it("reads a custom address", () => {
    expect(parse(`nightly-backups@${DOMAIN}`)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "nightly-backups",
    });
  });

  it("lowercases a custom address, matching how it is stored", () => {
    expect(parse(`Nightly-Backups@${DOMAIN}`)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "nightly-backups",
    });
  });

  it('reads the address out of "Name <address>"', () => {
    expect(parse(`Backups Bot <nightly-backups@${DOMAIN}>`)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "nightly-backups",
    });
    expect(parse(`<monitor-${SECRET}@${DOMAIN}>`)).toEqual({
      kind: IncomingEmailRecipientKind.Generated,
      secretKey: SECRET,
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parse(`  nightly-backups@${DOMAIN}  `)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "nightly-backups",
    });
  });

  it("treats a monitor- name that is not a key as a custom name", () => {
    /*
     * Custom names may start with "monitor-" -- only the exact generated
     * shape is reserved -- so this must route by name, not by key.
     */
    expect(parse(`monitor-backups@${DOMAIN}`)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "monitor-backups",
    });
  });

  it.each([
    `nightly-backups@acme.com`,
    `nightly-backups@sub.${DOMAIN}`,
    `nightly-backups@${DOMAIN}.evil.com`,
    `monitor-${SECRET}@acme.com`,
  ])("ignores %p, which is not on the inbound domain", (address: string) => {
    expect(parse(address)).toBeNull();
  });

  it.each([
    "",
    "not-an-address",
    `@${DOMAIN}`,
    `a b@${DOMAIN}`,
    `back+ups@${DOMAIN}`,
    `.backups@${DOMAIN}`,
    `back..ups@${DOMAIN}`,
    `${"a".repeat(CUSTOM_LOCAL_PART_MAX_LENGTH + 1)}@${DOMAIN}`,
  ])("rejects %p, which no monitor could own", (address: string) => {
    expect(parse(address)).toBeNull();
  });

  it.each([null, undefined, ""])(
    "rejects everything when the inbound domain is %p",
    (inboundDomain: string | null | undefined) => {
      // Called directly: parse()'s default parameter would replace undefined.
      expect(
        IncomingEmailMonitorAddress.parseRecipient({
          emailAddress: `nightly-backups@${DOMAIN}`,
          inboundDomain: inboundDomain,
        }),
      ).toBeNull();
    },
  );

  it("still routes names that the write-time policy would now refuse", () => {
    /*
     * Minimum length and reserved names are checked when a name is CHOSEN.
     * Routing only checks structure, so tightening that policy later cannot
     * silently stop mail to a name that is already in use.
     */
    expect(parse(`ab@${DOMAIN}`)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "ab",
    });
  });

  it("round-trips every address getAddress produces", () => {
    const generated: string | null = IncomingEmailMonitorAddress.getAddress({
      secretKey: SECRET,
      inboundDomain: DOMAIN,
    });
    const custom: string | null = IncomingEmailMonitorAddress.getAddress({
      secretKey: SECRET,
      customLocalPart: normalize("Nightly.Backups_01"),
      inboundDomain: DOMAIN,
    });

    expect(parse(generated!)).toEqual({
      kind: IncomingEmailRecipientKind.Generated,
      secretKey: SECRET,
    });
    expect(parse(custom!)).toEqual({
      kind: IncomingEmailRecipientKind.Custom,
      localPart: "nightly.backups_01",
    });
  });
});
