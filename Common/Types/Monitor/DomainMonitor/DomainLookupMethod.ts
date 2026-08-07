/*
 * Which protocol the probe uses to read a domain's registration record.
 *
 * WHOIS is the legacy protocol and its server list is not authoritative:
 * clients ship a static map of TLD -> WHOIS host, and registries move. Every
 * Identity Digital TLD (.digital, .email, .life, .today, .zone, ~290 more)
 * still points at the retired whois.donuts.co in most of those maps, and that
 * host now answers every query with the literal text "TLD is not supported."
 * instead of a record. RDAP (RFC 9083) is the ICANN-mandated replacement and
 * is discovered from the IANA bootstrap registry (RFC 9224), so it stays
 * correct as registries move.
 *
 * Plenty of ccTLDs (.io, .co, .de, .ch, .jp, ...) publish no RDAP service at
 * all, which is why Auto - RDAP when the TLD has one, WHOIS otherwise - is
 * the default rather than RDAP.
 */
enum DomainLookupMethod {
  Auto = "Auto",
  RDAP = "RDAP",
  WHOIS = "WHOIS",
}

export default DomainLookupMethod;
