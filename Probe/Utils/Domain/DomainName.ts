import { domainToASCII } from "node:url";

const LABEL_PATTERN: RegExp = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ALL_DIGITS_PATTERN: RegExp = /^[0-9]+$/;

/*
 * People paste "https://example.com/pricing" into a field labelled "Domain
 * Name" often enough that it is worth accepting. Everything here is about
 * getting from what was pasted to the registrable name a WHOIS or RDAP
 * server will answer for.
 */
export default class DomainNameUtil {
  public static normalize(domainName: string): string {
    let normalized: string = (domainName || "").trim().toLowerCase();

    // Strip a scheme, if one was pasted along with the name.
    normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

    /*
     * Path, query and fragment go first: an "@" can legitimately appear in a
     * path, and stripping credentials before the path would take the wrong
     * side of it.
     */
    normalized = normalized.split("/")[0] || "";
    normalized = normalized.split("?")[0] || "";
    normalized = normalized.split("#")[0] || "";

    // Strip credentials.
    normalized = normalized.split("@").pop() || "";

    // Strip a port.
    normalized = normalized.split(":")[0] || "";

    // Strip the root label's trailing dot.
    normalized = normalized.replace(/\.+$/, "");

    /*
     * Registries, the IANA bootstrap registry and WHOIS servers all key on
     * A-labels ("xn--mnchen-3ya.de"), never the U-label an operator types.
     * whois-json used to do this conversion itself, so skipping it here
     * would break every IDN monitor. domainToASCII returns "" for input it
     * cannot map, in which case the original value is kept so the failure
     * message can name what was actually entered.
     */
    return domainToASCII(normalized) || normalized;
  }

  public static isValid(domainName: string): boolean {
    if (!domainName || domainName.length > 253) {
      return false;
    }

    const labels: Array<string> = domainName.split(".");

    if (labels.length < 2) {
      return false;
    }

    for (const label of labels) {
      if (!LABEL_PATTERN.test(label)) {
        return false;
      }
    }

    // The last label (the TLD) is never all-numeric - that would be an IP.
    return !ALL_DIGITS_PATTERN.test(labels[labels.length - 1] || "");
  }

  public static getTld(domainName: string): string {
    const labels: Array<string> = domainName.split(".");

    return labels[labels.length - 1] || "";
  }

  /*
   * RFC 9224 matches a bootstrap entry against the longest run of trailing
   * labels, so candidates are produced longest-first: "a.b.example.com" ->
   * ["a.b.example.com", "b.example.com", "example.com", "com"].
   */
  public static getSuffixCandidates(domainName: string): Array<string> {
    const labels: Array<string> = domainName
      .split(".")
      .filter((label: string) => {
        return label.length > 0;
      });

    const candidates: Array<string> = [];

    for (let i: number = 0; i < labels.length; i++) {
      candidates.push(labels.slice(i).join("."));
    }

    return candidates;
  }
}
