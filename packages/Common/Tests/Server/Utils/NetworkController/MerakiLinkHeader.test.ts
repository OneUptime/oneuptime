import {
  MAX_LINK_HEADER_LENGTH,
  parseMerakiLinkHeader,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiLinkHeader";
import { describe, expect, test } from "@jest/globals";

/*
 * The Link header Meraki pages lists with (RFC 5988): links found by their
 * angle brackets, so commas and semicolons inside a URL never split one,
 * and read in time linear in the header whatever it holds.
 */

const NEXT: string =
  "https://api.meraki.com/api/v1/organizations/549236/networks?perPage=1000&startingAfter=L_646829496481099586";

describe("parsing the Link header", () => {
  test("Meraki's four links, each by its rel", () => {
    const links: Record<string, string> = parseMerakiLinkHeader(
      [
        "<https://api.meraki.com/api/v1/organizations/549236/networks?perPage=1000&startingAfter=0>; rel=first",
        "<https://api.meraki.com/api/v1/organizations/549236/networks?perPage=1000&endingBefore=L_1>; rel=prev",
        `<${NEXT}>; rel=next`,
        "<https://api.meraki.com/api/v1/organizations/549236/networks?perPage=1000&endingBefore=z>; rel=last",
      ].join(", "),
    );

    expect(Object.keys(links).sort()).toEqual([
      "first",
      "last",
      "next",
      "prev",
    ]);
    expect(links["next"]).toBe(NEXT);
  });

  test("a quoted rel, extra spaces and a rel naming two relations", () => {
    expect(parseMerakiLinkHeader(`< ${NEXT} > ;  rel="next"`)["next"]).toBe(
      NEXT,
    );
    const both: Record<string, string> = parseMerakiLinkHeader(
      `<${NEXT}>; rel="next last"`,
    );
    expect(both["next"]).toBe(NEXT);
    expect(both["last"]).toBe(NEXT);
  });

  test("commas and semicolons inside a URL do not split it", () => {
    const url: string =
      "https://api.meraki.com/api/v1/organizations/1/devices?productTypes[]=appliance,switch&tags=a;b&startingAfter=Q2XX";

    expect(parseMerakiLinkHeader(`<${url}>; rel=next`)["next"]).toBe(url);
  });

  test("the first link of a rel wins", () => {
    expect(
      parseMerakiLinkHeader(
        `<https://api.meraki.com/api/v1/a>; rel=next, <https://api.meraki.com/api/v1/b>; rel=next`,
      )["next"],
    ).toBe("https://api.meraki.com/api/v1/a");
  });

  test.each([
    [undefined],
    [null],
    [""],
    ["rel=next"],
    ["<unterminated; rel=next"],
    [`<${NEXT}>`],
    [`<${NEXT}>; title=next`],
  ])("%p has no next link", (header: string | undefined | null) => {
    expect(parseMerakiLinkHeader(header)["next"]).toBeUndefined();
  });

  test("a header past the length kept is cut first", () => {
    const header: string = `${" ".repeat(MAX_LINK_HEADER_LENGTH)}<${NEXT}>; rel=next`;

    expect(parseMerakiLinkHeader(header)["next"]).toBeUndefined();
  });

  test("400,000 characters of its worst shapes read in linear time", () => {
    const shapes: Array<string> = [
      "<".repeat(400_000),
      "<a>;".repeat(100_000),
      "<a>; rel=".repeat(40_000),
      `<${"x".repeat(399_000)}>; rel=next`,
      ";".repeat(400_000),
    ];

    for (const shape of shapes) {
      const startedAt: number = Date.now();
      parseMerakiLinkHeader(shape);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    }
  });
});
