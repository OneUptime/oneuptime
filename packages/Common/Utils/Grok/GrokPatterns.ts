/*
 * Built-in grok pattern library.
 *
 * Grok is regex with names: `%{IPV4:client_ip}` is just the IPv4 regex
 * plus "put what it matched in client_ip". This file holds the named
 * regex halves; Grok.ts does the naming.
 *
 * Two rules every entry here must follow:
 *
 *   1. NO capturing groups. Use `(?:...)`. Grok.ts injects its own
 *      named groups around the pattern it is asked to capture and reads
 *      results back through `match.groups`, so a stray `(...)` in a
 *      definition would silently shift nothing but still cost a capture
 *      slot on every record.
 *
 *   2. JavaScript-compatible syntax only. The upstream Logstash
 *      definitions are Oniguruma and use possessive quantifiers (`++`)
 *      and atomic groups (`(?>...)`), neither of which V8 accepts —
 *      those have been rewritten here rather than copied.
 *
 * Every repetition of a group consumes at least one character, which is
 * what keeps `(?:/[\w]*)+`-shaped patterns linear instead of
 * exponential. Keep it that way when adding patterns: these run once
 * per ingested log record against attacker-supplied text.
 */

const GrokPatterns: Record<string, string> = {
  /* --- Primitives --- */
  USERNAME: String.raw`[a-zA-Z0-9._-]+`,
  USER: String.raw`%{USERNAME}`,
  INT: String.raw`(?:[+-]?(?:[0-9]+))`,
  BASE10NUM: String.raw`(?:[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))`,
  NUMBER: String.raw`(?:%{BASE10NUM})`,
  BASE16NUM: String.raw`(?:0[xX])?(?:[0-9A-Fa-f]+)`,
  POSINT: String.raw`\b(?:[1-9][0-9]*)\b`,
  NONNEGINT: String.raw`\b(?:[0-9]+)\b`,
  WORD: String.raw`\b\w+\b`,
  NOTSPACE: String.raw`\S+`,
  SPACE: String.raw`\s*`,
  DATA: String.raw`.*?`,
  GREEDYDATA: String.raw`.*`,
  QUOTEDSTRING: String.raw`(?:"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*')`,
  QS: String.raw`%{QUOTEDSTRING}`,
  UUID: String.raw`[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}`,

  /* --- Network --- */
  IPV4: String.raw`(?<![0-9])(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?![0-9])`,
  /*
   * Alternation is first-match, not longest-match, so order carries
   * meaning here: the IPv4-embedded forms come first (a generic hex form
   * would otherwise stop before the dotted quad), and the "::"-elision
   * forms are ordered so a shape that can only match a prefix never sits
   * ahead of one that matches the whole address.
   */
  IPV6: String.raw`(?:::(?:[Ff]{4}(?::0{1,4})?:)?%{IPV4}|(?:[0-9A-Fa-f]{1,4}:){1,4}:%{IPV4}|(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?:(?::[0-9A-Fa-f]{1,4}){1,7}|:))`,
  IP: String.raw`(?:%{IPV6}|%{IPV4})`,
  HOSTNAME: String.raw`\b(?:[0-9A-Za-z][0-9A-Za-z-]{0,62})(?:\.(?:[0-9A-Za-z][0-9A-Za-z-]{0,62}))*\.?`,
  IPORHOST: String.raw`(?:%{IP}|%{HOSTNAME})`,
  HOSTPORT: String.raw`%{IPORHOST}:%{POSINT}`,
  COMMONMAC: String.raw`(?:(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2})`,
  CISCOMAC: String.raw`(?:(?:[A-Fa-f0-9]{4}\.){2}[A-Fa-f0-9]{4})`,
  WINDOWSMAC: String.raw`(?:(?:[A-Fa-f0-9]{2}-){5}[A-Fa-f0-9]{2})`,
  MAC: String.raw`(?:%{CISCOMAC}|%{WINDOWSMAC}|%{COMMONMAC})`,
  EMAILLOCALPART: String.raw`[a-zA-Z0-9!#$%&'*+\-/=?^_{|}~]{1,64}(?:\.[a-zA-Z0-9!#$%&'*+\-/=?^_{|}~]{1,62}){0,63}`,
  EMAILADDRESS: String.raw`%{EMAILLOCALPART}@%{HOSTNAME}`,

  /* --- Paths and URIs --- */
  UNIXPATH: String.raw`(?:/[\w_%!$@:.,+~-]*)+`,
  WINPATH: String.raw`(?:[A-Za-z]+:|\\)(?:\\[^\\?*]*)+`,
  PATH: String.raw`(?:%{UNIXPATH}|%{WINPATH})`,
  URIPROTO: String.raw`[A-Za-z][A-Za-z0-9+.-]+`,
  URIHOST: String.raw`%{IPORHOST}(?::%{POSINT})?`,
  URIPATH: String.raw`(?:/[A-Za-z0-9$.+!*'(){},~:;=@#%&_-]*)+`,
  URIPARAM: String.raw`\?[A-Za-z0-9$.+!*'|(){},~@#%&/=:;_?<>\[\]-]*`,
  URIPATHPARAM: String.raw`%{URIPATH}(?:%{URIPARAM})?`,
  URI: String.raw`%{URIPROTO}://(?:%{USER}(?::[^@]*)?@)?(?:%{URIHOST})?(?:%{URIPATHPARAM})?`,

  /* --- Dates and times --- */
  MONTH: String.raw`\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b`,
  MONTHNUM: String.raw`(?:0?[1-9]|1[0-2])`,
  MONTHNUM2: String.raw`(?:0[1-9]|1[0-2])`,
  MONTHDAY: String.raw`(?:0[1-9]|[12][0-9]|3[01]|[1-9])`,
  DAY: String.raw`(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)`,
  YEAR: String.raw`(?:\d\d){1,2}`,
  HOUR: String.raw`(?:2[0123]|[01]?[0-9])`,
  MINUTE: String.raw`(?:[0-5][0-9])`,
  SECOND: String.raw`(?:(?:[0-5]?[0-9]|60)(?:[:.,][0-9]+)?)`,
  TIME: String.raw`(?:%{HOUR}:%{MINUTE}(?::%{SECOND})?)`,
  DATE_US: String.raw`%{MONTHNUM}[/-]%{MONTHDAY}[/-]%{YEAR}`,
  DATE_EU: String.raw`%{MONTHDAY}[./-]%{MONTHNUM}[./-]%{YEAR}`,
  DATE: String.raw`(?:%{DATE_US}|%{DATE_EU})`,
  ISO8601_TIMEZONE: String.raw`(?:Z|[+-]%{HOUR}(?::?%{MINUTE})?)`,
  TIMESTAMP_ISO8601: String.raw`%{YEAR}-%{MONTHNUM2}-%{MONTHDAY}[T ]%{HOUR}:?%{MINUTE}(?::?%{SECOND})?(?:%{ISO8601_TIMEZONE})?`,
  DATESTAMP: String.raw`%{DATE}[- ]%{TIME}`,
  TZ: String.raw`(?:[APMCE][SD]T|UTC|GMT)`,
  HTTPDATE: String.raw`%{MONTHDAY}/%{MONTH}/%{YEAR}:%{TIME} %{INT}`,
  SYSLOGTIMESTAMP: String.raw`%{MONTH} +%{MONTHDAY} %{TIME}`,

  /* --- Log shapes --- */
  LOGLEVEL: String.raw`(?:[Aa]lert|ALERT|[Tt]race|TRACE|[Dd]ebug|DEBUG|[Nn]otice|NOTICE|[Ii]nfo(?:rmation)?|INFO(?:RMATION)?|[Ww]arn(?:ing)?|WARN(?:ING)?|[Ee]rr(?:or)?|ERR(?:OR)?|[Cc]rit(?:ical)?|CRIT(?:ICAL)?|[Ff]atal|FATAL|[Ss]evere|SEVERE|[Ee]merg(?:ency)?|EMERG(?:ENCY)?)`,
  PROG: String.raw`[\x21-\x5a\x5c\x5e-\x7e]+`,
  SYSLOGPROG: String.raw`%{PROG:program}(?:\[%{POSINT:pid}\])?`,
  SYSLOGFACILITY: String.raw`<%{NONNEGINT:facility}\.%{NONNEGINT:priority}>`,
  SYSLOGBASE: String.raw`%{SYSLOGTIMESTAMP:timestamp} (?:%{SYSLOGFACILITY} )?%{IPORHOST:logsource} %{SYSLOGPROG}:`,
  JAVACLASS: String.raw`(?:[a-zA-Z$_][a-zA-Z$_0-9]*\.)*[a-zA-Z$_][a-zA-Z$_0-9]*`,
  COMMONAPACHELOG: String.raw`%{IPORHOST:clientip} %{USER:ident} %{USER:auth} \[%{HTTPDATE:timestamp}\] "(?:%{WORD:verb} %{NOTSPACE:request}(?: HTTP/%{NUMBER:httpversion})?|%{DATA:rawrequest})" %{NUMBER:response} (?:%{NUMBER:bytes}|-)`,
  COMBINEDAPACHELOG: String.raw`%{COMMONAPACHELOG} %{QS:referrer} %{QS:agent}`,
};

/*
 * Names only, sorted — the pattern picker in the processor form lists
 * these so a user can see what is available without leaving the page.
 */
export function getGrokPatternNames(): Array<string> {
  return Object.keys(GrokPatterns).sort();
}

export default GrokPatterns;
