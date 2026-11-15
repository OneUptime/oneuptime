/*
 * UrlScrubber's rules in ClickHouse SQL, for the data migrations that scrub
 * what was stored before the scrubber caught it: a page, a route, or a
 * property value that is an address. Every expression reads a column or a
 * lambda argument the caller names, never a request's value.
 *
 * WHICH SEGMENT IS AN IDENTIFIER (isIdentifierSegmentSql) is
 * UrlScrubber.scrubPath's rule, segment by segment: a uuid, a 24-hex object
 * id, an email, nine digits or more, a token of 32 or more letters, digits,
 * "_" and "-" (or standard base64's "+" and "/", padded, #8489), or a JSON
 * Web Token (#8385) - read decoded, and decoded once
 * more, for an address an application escaped twice (#8385). It is written
 * so it never takes for an identifier a segment the scrubber keeps: that
 * segment is one a recorder sent, and a migration deletes or rewrites what
 * it takes.
 *
 *  - Decoding is the scrubber's decodeURIComponent: a segment with an escape
 *    cut short ("%zz", "%4"), or whose escapes are not UTF-8 - one cut
 *    short, written too long, a surrogate - is read as written, where
 *    decodeURIComponent throws. ClickHouse's decodeURLComponent never
 *    throws, so both are checked first. Read as written, the scrubber's
 *    segment is in its one spelling, every letter beyond ASCII escaped and
 *    so longer than the stored one, so such a segment with a letter beyond
 *    ASCII is never taken here (decodedFirstSql).
 *  - The email's parts are any character but "@", "/" and the whitespace
 *    JavaScript's \s names, at the lengths the scrubber allows. ClickHouse
 *    26.7 matches in characters; the scrubber counts UTF-16 units, which is
 *    the same for every character but those beyond U+FFFF, so a segment with
 *    one of those is never taken for an email here (the scrubber still
 *    redacts it in what it stores from now on). RE2's \s knows only ASCII
 *    spaces, and not \v, so the class names them and the rest are looked
 *    for apart (JAVASCRIPT_ONLY_SPACES).
 *  - A ClickHouse that counted bytes instead would allow fewer characters,
 *    never more, so it could only miss an email beyond ASCII, never take
 *    one the scrubber keeps.
 *
 * What a migration then writes is the scrubber's result for the parts that
 * name someone; it does not re-spell escapes or lower-case a host, as the
 * URL parser would, so a value with nothing to scrub is left exactly as it
 * is.
 */

// JavaScript's \s beyond RE2's (\t \n \f \r and space): \v, and the Unicode spaces.
const JAVASCRIPT_ONLY_SPACES: ReadonlyArray<number> = [
  0x0b, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
];

// A ClickHouse string literal of one code point's UTF-8 bytes: '\xC2\xA0'.
function utf8Literal(codePoint: number): string {
  const bytes: Array<string> = Array.from(
    new TextEncoder().encode(String.fromCodePoint(codePoint)),
  ).map((byte: number): string => {
    return `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  });

  return `'${bytes.join("")}'`;
}

const JAVASCRIPT_ONLY_SPACE_LITERALS: string = `[${JAVASCRIPT_ONLY_SPACES.map(
  utf8Literal,
).join(", ")}]`;

/*
 * The lead bytes of a character beyond U+FFFF in UTF-8. Searched as bytes,
 * so whatever a ClickHouse's regular expressions count, they find one.
 */
const BEYOND_BMP_LEAD_BYTES: string =
  "['\\xF0', '\\xF1', '\\xF2', '\\xF3', '\\xF4']";

/*
 * The ASCII whitespace JavaScript's \s names, as a ClickHouse string
 * literal's escapes: space, \t, \n, \v (\x0B), \f and \r.
 */
const ASCII_SPACES: string = " \\t\\n\\x0B\\f\\r";

// A character of an email's parts: not "@", "/" or ASCII whitespace.
const EMAIL_CHARACTER: string = `[^@/${ASCII_SPACES}]`;

/*
 * The scrubber's identifier shapes but the email, decoded: a uuid, an
 * object id, nine digits or more, a token in base64url or standard base64
 * with up to two "=" of padding (#8489), a JSON Web Token. All ASCII.
 */
export const IDENTIFIER_SEGMENT_PATTERN: string =
  "^(?:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9A-Fa-f]{24}|[0-9]{9,}|[A-Za-z0-9_+/-]{32,}={0,2}|eyJ[A-Za-z0-9_-]{8,}(?:[.][A-Za-z0-9_-]*){1,4})$";

// The scrubber's email shape, decoded (EMAIL_SEGMENT).
export const EMAIL_SEGMENT_PATTERN: string = `^${EMAIL_CHARACTER}{1,64}@${EMAIL_CHARACTER}{1,253}[.]${EMAIL_CHARACTER}{1,63}$`;

// Whether decodeURIComponent throws on `text`: an escape cut short, or bytes that are not UTF-8.
function decodeThrowsSql(text: string): string {
  return `(match(${text}, '%[0-9A-Fa-f]?([^0-9A-Fa-f]|$)') OR NOT isValidUTF8(decodeURLComponent(${text})))`;
}

/*
 * `text` decoded once more, as the scrubber's second decodeURIComponent
 * reads it: decoded, unless decodeURIComponent throws, where the scrubber
 * matches the text as its first decoding left it.
 */
export function decodedSegmentSql(text: string): string {
  return `if(${decodeThrowsSql(text)}, ${text}, decodeURLComponent(${text}))`;
}

/*
 * A stored segment as the scrubber's first decodeURIComponent reads it. When
 * that throws, the scrubber matches the segment as written in its one
 * spelling (UrlScrubber.normalizePathSpelling), where each letter beyond
 * ASCII is escaped: longer than the stored segment, so an email's lengths
 * could differ. Such a segment with a letter beyond ASCII is read as ''
 * here, which no rule takes; one in ASCII is read as written.
 */
function decodedFirstSql(segment: string): string {
  return `if(${decodeThrowsSql(segment)}, if(length(${segment}) = lengthUTF8(${segment}), ${segment}, ''), decodeURLComponent(${segment}))`;
}

// Whether `decoded`, a lambda argument, is one of the scrubber's identifiers.
function isIdentifierTextSql(decoded: string): string {
  return `(match(${decoded}, '${IDENTIFIER_SEGMENT_PATTERN}') OR (match(${decoded}, '${EMAIL_SEGMENT_PATTERN}') AND NOT multiSearchAny(${decoded}, ${JAVASCRIPT_ONLY_SPACE_LITERALS}) AND NOT multiSearchAny(${decoded}, ${BEYOND_BMP_LEAD_BYTES})))`;
}

/*
 * Whether the path segment `segment` (a lambda argument) is one the
 * scrubber redacts, read decoded and decoded once more.
 */
export function isIdentifierSegmentSql(segment: string): string {
  return `arrayExists(paDecoded -> ${isIdentifierTextSql("paDecoded")}, arrayMap(paOnce -> [paOnce, ${decodedSegmentSql("paOnce")}], [${decodedFirstSql(segment)}])[1])`;
}

// Whether the path in `path` has a segment the scrubber redacts.
export function hasIdentifierSegmentSql(path: string): string {
  return `arrayExists(paSegment -> ${isIdentifierSegmentSql("paSegment")}, splitByChar('/', ${path}))`;
}

// The path in `path` with each such segment "[redacted]" (UrlScrubber.scrubPath).
export function redactedPathSql(path: string): string {
  return `arrayStringConcat(arrayMap(paSegment -> if(${isIdentifierSegmentSql("paSegment")}, '[redacted]', paSegment), splitByChar('/', ${path})), '/')`;
}

/*
 * The parts of an address `address` (a lambda argument), as the scrubber
 * reads them, each handed to `use` as SQL: the scheme and host when it has
 * them ("https://shop.example.com", "app://com.example.shop", "//cdn.x" -
 * "" for a path from the root, and for the "null/Checkout" a mobile screen
 * was stored as before #8384), the path up to its query or fragment, and a
 * hash router's route (its path, without a query) with the mark it was
 * written after ("#" or "#!"; "" when the fragment is no route).
 */
function addressPartsSql(
  address: string,
  use: (parts: {
    origin: string;
    path: string;
    routeMark: string;
    route: string;
  }) => string,
): string {
  /*
   * Each part is read once and bound to a lambda argument (a one-element
   * array, mapped): the address's origin, what follows it, and its fragment.
   */
  const parts: string = use({
    origin: "paOrigin",
    path: "splitByRegexp('[?#]', paRest)[1]",
    routeMark:
      "multiIf(startsWith(paFragment, '/'), '#', startsWith(paFragment, '!/'), '#!', '')",
    route:
      "splitByChar('?', multiIf(startsWith(paFragment, '/'), paFragment, startsWith(paFragment, '!/'), substring(paFragment, 2), ''))[1]",
  });

  return `arrayMap(paOrigin -> arrayMap(paRest -> arrayMap(paFragment -> ${parts}, [if(position(paRest, '#') > 0, substring(paRest, position(paRest, '#') + 1), '')])[1], [substring(${address}, length(paOrigin) + 1)])[1], [extract(${address}, '^((?:[A-Za-z][A-Za-z0-9+.-]*:)?//[^/?#]*)')])[1]`;
}

/*
 * Whether the stored address `address` names someone in its path or its
 * hash route, as the scrubber reads both.
 */
export function addressHasIdentifierSql(address: string): string {
  return addressPartsSql(
    address,
    (parts: { path: string; route: string }): string => {
      return `(${hasIdentifierSegmentSql(parts.path)} OR ${hasIdentifierSegmentSql(parts.route)})`;
    },
  );
}

/*
 * The address `address` as Session Replay keeps one (UrlScrubber.scrub, and
 * a path from the root as toProductAnalyticsPropertyValue reads it): the
 * scheme and host, without a user name and password; the path, each
 * segment that is an identifier "[redacted]"; and a hash router's route,
 * scrubbed alike. The query and any other fragment are dropped.
 */
export function scrubbedAddressSql(address: string): string {
  return addressPartsSql(
    address,
    (parts: {
      origin: string;
      path: string;
      routeMark: string;
      route: string;
    }): string => {
      return `concat(replaceRegexpOne(${parts.origin}, '//.*@', '//'), ${redactedPathSql(parts.path)}, if(${parts.routeMark} = '', '', concat(${parts.routeMark}, ${redactedPathSql(parts.route)})))`;
    },
  );
}

/*
 * A track() property, a metric() attribute or a user property `value` (a
 * lambda argument) as the product analytics ingest stores one now
 * (toProductAnalyticsPropertyValue): a value that is an address - an
 * http(s) URL, a "//host" one or a path from the root, with no whitespace -
 * scrubbed (scrubbedAddressSql); anything else as it is. The address is read
 * trimmed, as the ingest reads it; a value with a space JavaScript trims and
 * RE2 does not know is left as it is.
 */
export function scrubbedPropertyValueSql(value: string): string {
  return `arrayMap(paTrimmed -> if(match(paTrimmed, '^(?:[Hh][Tt][Tt][Pp][Ss]?://|/)[^${ASCII_SPACES}]*$') AND NOT multiSearchAny(${value}, ${JAVASCRIPT_ONLY_SPACE_LITERALS}), ${scrubbedAddressSql("paTrimmed")}, ${value}), [trim(BOTH '${ASCII_SPACES}' FROM ${value})])[1]`;
}

// Whether a Map(String, String) column holds a value scrubbedPropertyValueSql changes.
export function mapHasUnscrubbedAddressSql(column: string): string {
  return `arrayExists(paValue -> ${scrubbedPropertyValueSql("paValue")} != paValue, mapValues(${column}))`;
}

// A Map(String, String) column with every value scrubbedPropertyValueSql.
export function scrubbedMapSql(column: string): string {
  return `mapApply((paKey, paValue) -> (paKey, ${scrubbedPropertyValueSql("paValue")}), ${column})`;
}
