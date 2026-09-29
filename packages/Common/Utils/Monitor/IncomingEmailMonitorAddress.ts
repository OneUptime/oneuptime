import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

/*
 * The inbound address of an Incoming Email monitor.
 *
 * Every monitor's address lives on the server's one inbound domain
 * (INBOUND_EMAIL_DOMAIN), so only the part before the @ -- the local part --
 * tells monitors apart. A monitor's local part is one of two things:
 *
 *   - generated: `monitor-{incomingEmailSecretKey}`. Minted when the monitor
 *     is created, and replaced by a new random one when the address is reset.
 *   - custom: `incomingEmailCustomLocalPart`, a name the user picked. While it
 *     is set it REPLACES the generated address; mail to the generated address
 *     is no longer accepted.
 *
 * So exactly one address is live per monitor. The two namespaces cannot
 * collide, because a custom name may not take the generated shape -- an
 * inbound recipient therefore resolves to at most one monitor.
 *
 * Shared by the dashboard (to show the address and validate the form), the
 * monitor service (to validate and store a custom name) and the ingest path
 * (to route mail to a monitor).
 */

export const GENERATED_LOCAL_PART_PREFIX: string = "monitor-";

export const CUSTOM_LOCAL_PART_MIN_LENGTH: number = 3;

// RFC 5321 caps a local part at 64 octets.
export const CUSTOM_LOCAL_PART_MAX_LENGTH: number = 64;

/*
 * Names a custom address may never take.
 *
 * The inbound domain is shared by every project on the server, and whatever
 * arrives at a monitor's address is stored on that monitor where its owners
 * can read it. Several mailbox names carry meaning for the DOMAIN rather than
 * for a monitor: certificate authorities send domain-control validation mail
 * to admin@, administrator@, webmaster@, hostmaster@ and postmaster@, and
 * RFC 2142 reserves abuse@, noc@ and security@ for the domain operator.
 * Letting a user claim one of those would hand them mail meant for whoever
 * runs the server -- a CA's validation link included.
 */
export const RESERVED_CUSTOM_LOCAL_PARTS: ReadonlyArray<string> = [
  "abuse",
  "admin",
  "administrator",
  "hostmaster",
  "mailer-daemon",
  "noc",
  "postmaster",
  "root",
  "security",
  "webmaster",
];

/*
 * Lowercase letters, digits, and `.`, `_`, `-` between them. Deliberately a
 * subset of what RFC 5322 allows: no `+` (plenty of relays treat it as a
 * sub-address and strip what follows), no quoting, nothing that needs
 * escaping when the address is pasted into a cron job or a config file.
 */
const CUSTOM_LOCAL_PART_PATTERN: RegExp = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

const UUID_PATTERN: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const GENERATED_LOCAL_PART_PATTERN: RegExp = new RegExp(
  `^${GENERATED_LOCAL_PART_PREFIX}(${UUID_PATTERN})$`,
  "i",
);

export enum IncomingEmailRecipientKind {
  Generated = "Generated",
  Custom = "Custom",
}

export type IncomingEmailRecipient =
  | { kind: IncomingEmailRecipientKind.Generated; secretKey: string }
  | { kind: IncomingEmailRecipientKind.Custom; localPart: string };

export default class IncomingEmailMonitorAddress {
  public static getGeneratedLocalPart(secretKey: ObjectID | string): string {
    return `${GENERATED_LOCAL_PART_PREFIX}${secretKey.toString().toLowerCase()}`;
  }

  /*
   * The local part mail to this monitor must be sent to right now, or null
   * when neither a custom name nor a secret key is known (for example, the
   * caller may not read them).
   */
  public static getLocalPart(data: {
    secretKey?: ObjectID | string | null | undefined;
    customLocalPart?: string | null | undefined;
  }): string | null {
    if (data.customLocalPart) {
      return data.customLocalPart;
    }

    if (data.secretKey) {
      return this.getGeneratedLocalPart(data.secretKey);
    }

    return null;
  }

  /*
   * The full address, or null when there is no local part or the server has
   * no inbound domain configured (so there is nowhere to send mail).
   */
  public static getAddress(data: {
    secretKey?: ObjectID | string | null | undefined;
    customLocalPart?: string | null | undefined;
    inboundDomain: string | null | undefined;
  }): string | null {
    if (!data.inboundDomain) {
      return null;
    }

    const localPart: string | null = this.getLocalPart(data);

    if (!localPart) {
      return null;
    }

    return `${localPart}@${data.inboundDomain}`;
  }

  public static isGeneratedLocalPart(localPart: string): boolean {
    return GENERATED_LOCAL_PART_PATTERN.test(localPart);
  }

  /*
   * Structural validity only -- the characters and the RFC length limit. This
   * is what the ingest path checks, because it decides whether a recipient
   * could be a custom address at all. Policy (minimum length, reserved names)
   * applies when a name is chosen, not when mail arrives: tightening a policy
   * later must not silently stop routing mail to names already in use.
   */
  public static isStructurallyValidLocalPart(localPart: string): boolean {
    return (
      localPart.length > 0 &&
      localPart.length <= CUSTOM_LOCAL_PART_MAX_LENGTH &&
      CUSTOM_LOCAL_PART_PATTERN.test(localPart) &&
      !localPart.includes("..")
    );
  }

  /*
   * Why a custom name cannot be used, or null when it can. Expects a value
   * that has already been through `normalizeCustomLocalPart`'s trimming and
   * lowercasing -- the dashboard form and the server both call this, so the
   * messages are written for the person typing the name.
   */
  public static getCustomLocalPartError(localPart: string): string | null {
    if (!localPart) {
      return "Please enter a name for the email address.";
    }

    if (localPart.length < CUSTOM_LOCAL_PART_MIN_LENGTH) {
      return `The email address name must be at least ${CUSTOM_LOCAL_PART_MIN_LENGTH} characters long.`;
    }

    if (localPart.length > CUSTOM_LOCAL_PART_MAX_LENGTH) {
      return `The email address name cannot be longer than ${CUSTOM_LOCAL_PART_MAX_LENGTH} characters.`;
    }

    if (!CUSTOM_LOCAL_PART_PATTERN.test(localPart)) {
      return "The email address name can only contain lowercase letters, numbers, dots (.), hyphens (-) and underscores (_), and must start and end with a letter or number.";
    }

    if (localPart.includes("..")) {
      return "The email address name cannot contain two dots in a row.";
    }

    if (this.isGeneratedLocalPart(localPart)) {
      return `Names in the form "${GENERATED_LOCAL_PART_PREFIX}<id>" are reserved for generated addresses. Please choose a different name.`;
    }

    if (RESERVED_CUSTOM_LOCAL_PARTS.includes(localPart)) {
      return `"${localPart}" is reserved and cannot be used as a monitor email address. Please choose a different name.`;
    }

    return null;
  }

  /*
   * Turns what a user typed into the stored local part, or throws a
   * BadDataException explaining why it cannot be used.
   *
   * Accepts either the bare name ("nightly-backups") or the whole address
   * ("nightly-backups@inbound.example.com") -- people paste the latter -- as
   * long as the domain is this server's inbound domain. Addresses are
   * case-insensitive in practice, and the ingest path lowercases the
   * recipient, so the stored name is lowercased too; that also makes the
   * column's unique index case-insensitive in effect.
   */
  public static normalizeCustomLocalPart(data: {
    value: string;
    inboundDomain?: string | null | undefined;
  }): string {
    let localPart: string = data.value.trim().toLowerCase();

    const atIndex: number = localPart.lastIndexOf("@");

    if (atIndex !== -1) {
      const domain: string = localPart.substring(atIndex + 1);
      const inboundDomain: string = (data.inboundDomain || "").toLowerCase();

      if (!inboundDomain) {
        throw new BadDataException(
          "Please enter only the part of the email address before the @.",
        );
      }

      if (domain !== inboundDomain) {
        throw new BadDataException(
          `Monitor email addresses must use the inbound email domain @${inboundDomain}. Please enter only the part before the @.`,
        );
      }

      localPart = localPart.substring(0, atIndex);
    }

    const error: string | null = this.getCustomLocalPartError(localPart);

    if (error) {
      throw new BadDataException(error);
    }

    return localPart;
  }

  /*
   * Which monitor address an inbound recipient names, or null when it cannot
   * be a monitor address at all (another domain, or a local part no monitor
   * could have). Resolving it to an actual monitor is the caller's job.
   *
   * Accepts "addr@domain" and "Name <addr@domain>".
   */
  public static parseRecipient(data: {
    emailAddress: string;
    inboundDomain: string | null | undefined;
  }): IncomingEmailRecipient | null {
    if (!data.inboundDomain || !data.emailAddress) {
      return null;
    }

    const bracketed: RegExpMatchArray | null =
      data.emailAddress.match(/<([^>]+)>/);

    const address: string = (
      bracketed && bracketed[1] ? bracketed[1] : data.emailAddress
    )
      .trim()
      .toLowerCase();

    const atIndex: number = address.lastIndexOf("@");

    if (atIndex <= 0) {
      return null;
    }

    const localPart: string = address.substring(0, atIndex);
    const domain: string = address.substring(atIndex + 1);

    if (domain !== data.inboundDomain.trim().toLowerCase()) {
      return null;
    }

    const generated: RegExpMatchArray | null = localPart.match(
      GENERATED_LOCAL_PART_PATTERN,
    );

    if (generated && generated[1]) {
      return {
        kind: IncomingEmailRecipientKind.Generated,
        secretKey: generated[1],
      };
    }

    if (!this.isStructurallyValidLocalPart(localPart)) {
      return null;
    }

    return {
      kind: IncomingEmailRecipientKind.Custom,
      localPart: localPart,
    };
  }
}
