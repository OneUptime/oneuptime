import {
  GENERIC_NAME_WORDS,
  LIKELY_NAME_SCORE,
  MAX_LIKENESS_NAME_LENGTH,
  NAME_LIKENESS_SCORES,
  NameLikeness,
  NameLikenessReason,
  getNameLikeness,
  getNameTokens,
  isLikelyName,
  toCompactName,
  toSerialKey,
} from "../../../Utils/NetworkDevice/DeviceNameLikeness";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * How like a device a thing from elsewhere is - a Meraki appliance a router
 * may be (OneUptime issue #5762) - by names and serial numbers, so "Link to
 * a Meraki appliance" offers the likely ones first. Only an order, which a
 * person confirms: these tests pin each rule, the order the rules are
 * tried in, what is never likened (an address, a generic word, a two-digit
 * number), letters of every script, and the time it takes.
 */

function liken(data: {
  names: Array<unknown>;
  serials?: Array<unknown>;
  otherNames: Array<unknown>;
  otherSerial?: unknown;
}): NameLikeness {
  return getNameLikeness(data);
}

describe("the rules, best first", () => {
  test("the same serial number, case and padding aside, beats everything", () => {
    expect(
      liken({
        names: ["Somewhere else entirely"],
        serials: ["  q2pn-lds0-0012 "],
        otherNames: ["LDS MX68"],
        otherSerial: "Q2PN-LDS0-0012",
      }),
    ).toEqual({
      score: NAME_LIKENESS_SCORES[NameLikenessReason.SerialNumber],
      reason: NameLikenessReason.SerialNumber,
    });
  });

  test("the same name, case, spaces and punctuation aside", () => {
    expect(
      liken({
        names: ["ST-2207 edge gw/01"],
        otherNames: ["st2207EDGEGW01"],
      }),
    ).toEqual({ score: 90, reason: NameLikenessReason.Name });
  });

  test("one name holds the other whole, four characters or more", () => {
    expect(
      liken({ names: ["LEEDS-MX-RTR"], otherNames: ["Leeds MX"] }),
    ).toEqual({ score: 70, reason: NameLikenessReason.NameWithin });

    // Either way round.
    expect(
      liken({ names: ["Leeds MX"], otherNames: ["leeds-mx-rtr-01"] }).reason,
    ).toBe(NameLikenessReason.NameWithin);

    // Three characters is too short to say anything: "lds" is in many names.
    expect(liken({ names: ["LDS"], otherNames: ["LDS MX68"] }).reason).not.toBe(
      NameLikenessReason.NameWithin,
    );
  });

  test("a store number in both: a router named after its store, in one word", () => {
    expect(
      liken({
        names: ["ST2207EDGEGW01"],
        otherNames: ["STORE 2207 MX", "Store 2207 network"],
      }),
    ).toEqual({
      score: 50,
      reason: NameLikenessReason.Number,
      shared: "2207",
    });
  });

  test("a number is as long as it is written, and compared without its leading zeros", () => {
    expect(
      liken({ names: ["BR012-EDGE-GW01"], otherNames: ["Branch 012 · Leeds"] }),
    ).toEqual({ score: 50, reason: NameLikenessReason.Number, shared: "12" });

    expect(
      liken({ names: ["Store 0386 router"], otherNames: ["MX for store 386"] })
        .shared,
    ).toBe("386");

    // Two digits as written say nothing: branch 12 is in every estate.
    expect(
      liken({ names: ["Branch 12 router"], otherNames: ["Store 12 MX"] }).score,
    ).toBe(0);
  });

  test("of several numbers both names have, the longest is said", () => {
    expect(
      liken({
        names: ["Site 204 rack 10933"],
        otherNames: ["10933 · floor 204"],
      }).shared,
    ).toBe("10933");
  });

  test("a word of four letters or more in both is a hint, not likely", () => {
    const likeness: NameLikeness = liken({
      names: ["Leeds router"],
      otherNames: ["Leeds MX68"],
    });

    expect(likeness).toEqual({
      score: 30,
      reason: NameLikenessReason.Word,
      shared: "leeds",
    });
    expect(isLikelyName(likeness)).toBe(false);
  });

  test("words every device's name could have are no hint at all", () => {
    expect(GENERIC_NAME_WORDS.has("router")).toBe(true);
    expect(GENERIC_NAME_WORDS.has("meraki")).toBe(true);

    expect(
      liken({
        names: ["Main office router"],
        otherNames: ["Main office Meraki appliance"],
      }).score,
    ).toBe(0);
  });

  test("the best rule any pair of names meets counts", () => {
    expect(
      liken({
        names: ["Leeds 012 edge", "LDS MX68"],
        otherNames: ["Branch 012 · Leeds", "lds mx68"],
      }).reason,
    ).toBe(NameLikenessReason.Name);
  });

  test("an appliance's network name counts as one of its names", () => {
    expect(
      liken({ names: ["LEEDS-RTR-01"], otherNames: ["MX68", "Leeds"] }),
    ).toEqual({ score: 70, reason: NameLikenessReason.NameWithin });
  });
});

describe("what is never likened", () => {
  test("an address is never a name: a polled address is not store 113", () => {
    expect(
      liken({ names: ["10.20.113.5"], otherNames: ["Store 113 MX"] }).score,
    ).toBe(0);
    expect(
      liken({ names: ["2001:db8::113"], otherNames: ["Store 113 MX"] }).score,
    ).toBe(0);
  });

  test("nothing to compare, nothing alike", () => {
    expect(liken({ names: [], otherNames: ["LDS MX68"] }).score).toBe(0);
    expect(liken({ names: ["LDS MX68"], otherNames: [] }).score).toBe(0);
    expect(
      liken({ names: [null, undefined, 42, "   "], otherNames: ["MX"] }).score,
    ).toBe(0);
    expect(
      liken({
        names: ["x"],
        serials: [""],
        otherNames: ["y"],
        otherSerial: "",
      }).score,
    ).toBe(0);
  });

  test("a serial number on one side only is no likeness", () => {
    expect(
      liken({
        names: ["a"],
        serials: ["Q2PN-AAAA-0001"],
        otherNames: ["b"],
        otherSerial: "Q2PN-AAAA-0002",
      }).score,
    ).toBe(0);
  });
});

describe("letters of every script", () => {
  test("names are compared without case in every cased script", () => {
    expect(
      liken({ names: ["Филиал-Москва"], otherNames: ["филиал москва"] }).reason,
    ).toBe(NameLikenessReason.Name);
  });

  test("letters of uncased scripts are kept: a Persian name is a name", () => {
    expect(toCompactName("دفتر تهران")).toBe("دفترتهران");
    expect(
      liken({ names: ["دفتر تهران"], otherNames: ["دفتر-تهران"] }).reason,
    ).toBe(NameLikenessReason.Name);
  });
});

describe("the parts", () => {
  test("a name's numbers and words", () => {
    expect(getNameTokens("ST2207EDGEGW01")).toEqual({
      numbers: ["2207"],
      words: ["edgegw"],
    });
    expect(getNameTokens("Branch 012 · Leeds")).toEqual({
      numbers: ["12"],
      words: ["leeds"],
    });
    expect(getNameTokens("10.0.0.1")).toEqual({ numbers: [], words: [] });
    expect(getNameTokens(undefined)).toEqual({ numbers: [], words: [] });
  });

  test("a compact name and a serial key", () => {
    expect(toCompactName("ST-2207 edge gw/01")).toBe("st2207edgegw01");
    expect(toCompactName("192.168.1.1")).toBe("");
    expect(toSerialKey(" q2pn-lds0-0012 ")).toBe("Q2PN-LDS0-0012");
    expect(toSerialKey(12)).toBe("");
  });

  test("likely starts at a shared number", () => {
    expect(LIKELY_NAME_SCORE).toBe(
      NAME_LIKENESS_SCORES[NameLikenessReason.Number],
    );
    expect(isLikelyName({ score: 50 })).toBe(true);
    expect(isLikelyName({ score: 49 })).toBe(false);
  });
});

describe("the time it takes", () => {
  test("a name is read no further than its longest", () => {
    const padding: string = "x".repeat(MAX_LIKENESS_NAME_LENGTH);

    // The number past the cut is never read: nothing alike.
    expect(
      liken({
        names: [`${padding} 4711`],
        otherNames: [`${"y".repeat(MAX_LIKENESS_NAME_LENGTH)} 4711`],
      }).score,
    ).toBe(0);
  });

  test("400,000 characters of digits and letters in turn take well under two seconds", () => {
    const run: FastestRun<NameLikeness> = fastestRun({
      run: (): NameLikeness => {
        return liken({
          names: ["a1".repeat(200000)],
          otherNames: ["1a".repeat(200000)],
        });
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
