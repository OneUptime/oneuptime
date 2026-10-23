/*
 * The Link header the Meraki dashboard API pages lists with (RFC 5988, as
 * developer.cisco.com/meraki/api-v1/pagination describes it): up to four
 * comma-separated links, each `<url>; rel=first|prev|next|last`, quoted or
 * not.
 *
 *   <https://api.meraki.com/api/v1/organizations/1/networks?perPage=1000&startingAfter=L_9>; rel=next
 *
 * Read with indexOf, not a pattern: the header is outside text, and a URL
 * may itself hold commas and semicolons, so links are found by their angle
 * brackets and the parameters between one link and the next. Linear in the
 * header's length, which is cut first.
 */

// Longest header read; Meraki's four links are well under a kilobyte.
export const MAX_LINK_HEADER_LENGTH: number = 16 * 1024;

export function parseMerakiLinkHeader(
  header: string | undefined | null,
): Record<string, string> {
  const links: Record<string, string> = {};

  if (!header || typeof header !== "string") {
    return links;
  }

  const text: string = header.substring(0, MAX_LINK_HEADER_LENGTH);
  let index: number = 0;

  while (index < text.length) {
    const open: number = text.indexOf("<", index);

    if (open < 0) {
      break;
    }

    const close: number = text.indexOf(">", open + 1);

    if (close < 0) {
      break;
    }

    const url: string = text.substring(open + 1, close).trim();
    const nextOpen: number = text.indexOf("<", close + 1);
    const parameters: string = text.substring(
      close + 1,
      nextOpen < 0 ? text.length : nextOpen,
    );

    for (const parameter of parameters.split(";")) {
      const equals: number = parameter.indexOf("=");

      if (equals < 0) {
        continue;
      }

      const name: string = parameter.substring(0, equals).trim().toLowerCase();

      if (name !== "rel") {
        continue;
      }

      // rel="next", rel=next, and a trailing comma before the next link.
      const value: string = parameter
        .substring(equals + 1)
        .split(",")[0]!
        .trim()
        .split('"')
        .join("");

      // A rel may name several relations: rel="next last".
      for (const relation of value.split(" ")) {
        const rel: string = relation.trim().toLowerCase();

        if (rel && url && links[rel] === undefined) {
          links[rel] = url;
        }
      }
    }

    index = nextOpen < 0 ? text.length : nextOpen;
  }

  return links;
}
