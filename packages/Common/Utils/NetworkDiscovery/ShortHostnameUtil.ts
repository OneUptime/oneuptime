import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";

/*
 * The short form of a fully qualified hostname: "wb-0660-kds01.wbhq.com"
 * becomes "wb-0660-kds01" (OneUptime issue #3678).
 *
 * Reverse DNS names a discovered host by its FQDN, and on an estate with one
 * corporate domain that suffix is the same on every device in the list — it
 * is noise, and it pushes the part an operator recognises to the far left of
 * a truncated column. This is the one rule every piece of the short-name
 * feature shares: the scan setting that names new imports, the Review dialog
 * that previews them, and the bulk action that fixes devices imported before
 * the setting existed. One function, so the three cannot disagree about what
 * "short" means.
 *
 * WHY THE FIRST LABEL, AND NOT A SUFFIX THE OPERATOR TYPES. The issue asked
 * for a configurable suffix (".wbhq.com"). A suffix list is strictly more
 * work for the same answer on the reporter's estate, and it fails silently:
 * a typo, a missing leading dot, or a second domain nobody listed leaves
 * names unchanged with nothing to say why. The first label needs no
 * configuration and behaves the same on every domain. The cost is on estates
 * that put meaning in a middle label ("web.prod.example.com" and
 * "web.stage.example.com" both become "web"), which is why the scan setting
 * is opt-in and why import still falls back to an address-qualified name
 * when a short name is already taken.
 */

/*
 * A top-level label is letters (or an IDNA "xn--" label). Checked so that a
 * dotted string which merely PASSES as a DNS name is not mistaken for one:
 * "ubuntu-22.04" is a legal label sequence and a common sysName, and cutting
 * it at the dot would rename a device "ubuntu-22".
 */
const TOP_LEVEL_LABEL_PATTERN: RegExp =
  /^(?:[A-Za-z]+|[Xx][Nn]--[A-Za-z0-9-]+)$/;

/*
 * The short name has to NAME something. A first label with no letter in it —
 * "10-18-167-31.dhcp.corp.com", "51.corp.example" — is an address spelled
 * with dashes, and shortening it would present an address as though it were
 * a hostname.
 */
const HAS_LETTER_PATTERN: RegExp = /[A-Za-z]/;

/**
 * The first label of `value` when it is a fully qualified hostname worth
 * shortening, or undefined when it is not.
 *
 * Undefined — rather than the value unchanged — so a caller can tell "this is
 * already as short as it gets" from "this was shortened", which the bulk
 * action needs in order to skip a device honestly rather than rewrite it with
 * its own name.
 *
 * Accepts `unknown` for the same reason normalizeReverseDnsName does: names
 * reach here out of jsonb and out of API rows, and a number or null must
 * return undefined rather than throw inside a render. Case is preserved.
 */
export function getShortHostname(value: unknown): string | undefined {
  /*
   * The full reverse-DNS rules first. A name with a space, markup, a
   * control character, an in-addr.arpa echo, or nothing but digits is not a
   * hostname, so it has no "short form" either — "Core Switch 1.5" stays
   * exactly as it is.
   */
  const normalized: string | undefined = normalizeReverseDnsName(value);

  if (!normalized) {
    return undefined;
  }

  const labels: Array<string> = normalized.split(".");

  if (labels.length < 2) {
    return undefined;
  }

  const topLevelLabel: string = labels[labels.length - 1]!;
  const firstLabel: string = labels[0]!;

  if (!TOP_LEVEL_LABEL_PATTERN.test(topLevelLabel)) {
    return undefined;
  }

  if (!HAS_LETTER_PATTERN.test(firstLabel)) {
    return undefined;
  }

  return firstLabel;
}

export default getShortHostname;
