import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_CHECK_KEY_LENGTH,
  OPENSTACK_CHECK_NAME_PREFIX,
  OpenStackCheckNamePart,
  ParsedOpenStackCheckName,
  buildOpenStackCheckName,
  buildOpenStackCheckRunId,
  getOpenStackCheckStamp,
  isOpenStackCheckKey,
  parseOpenStackCheckName,
} from "../../../Utils/OpenStack/OpenStackCheckName";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * The one rule by which the janitor tells what is the lifecycle check's. It deletes what this says
 * yes to, in a customer's cloud, so nearly right has to be no.
 */

const KEY: string = "0123456789ab";
const AT: number = Date.UTC(2026, 10, 4, 11, 50, 7);
const RUN_ID: string = "20261104115007-abcdef";
const NAME: string = `oneuptime-check-${KEY}-${RUN_ID}-server`;

describe("a name", () => {
  test("is written as the guide says", () => {
    expect(
      buildOpenStackCheckName({ checkKey: KEY, runId: RUN_ID, part: "server" }),
    ).toBe(NAME);
    expect(buildOpenStackCheckRunId({ startedAt: AT, random: "abcdef" })).toBe(
      RUN_ID,
    );
    expect(getOpenStackCheckStamp(AT)).toBe("20261104115007");
  });

  test("reads back as what it says", () => {
    expect(parseOpenStackCheckName(NAME)).toEqual({
      checkKey: KEY,
      runId: RUN_ID,
      startedAt: AT,
      part: "server",
    });
  });

  test.each<[OpenStackCheckNamePart]>([
    ["server"],
    ["volume"],
    ["sg"],
    ["fip"],
  ])("%s reads back", (part: OpenStackCheckNamePart) => {
    const parsed: ParsedOpenStackCheckName | null = parseOpenStackCheckName(
      buildOpenStackCheckName({ checkKey: KEY, runId: RUN_ID, part: part }),
    );

    expect(parsed?.part).toBe(part);
  });

  test("a key or a run it could not read back is refused when it is written", () => {
    expect(() => {
      return buildOpenStackCheckName({
        checkKey: "short",
        runId: RUN_ID,
        part: "server",
      });
    }).toThrow("can read back");
  });
});

describe("what merely looks like one is not one", () => {
  const LOOKALIKES: Array<[string, unknown]> = [
    ["nothing", ""],
    ["a person's", "web-1"],
    ["the prefix alone", OPENSTACK_CHECK_NAME_PREFIX],
    ["without its dash", "oneuptime-check"],
    ["a word starting the same", "oneuptime-checkout-1"],
    ["a word that fits", "oneuptime-check-web"],
    ["four words that do not", "oneuptime-check-web-prod-eu-1"],
    ["prefixed", `not-${NAME}`],
    ["suffixed", `${NAME}-old`],
    ["copied", `${NAME}-copy`],
    ["with a space after", `${NAME} `],
    ["with a space before", ` ${NAME}`],
    ["with a newline", `${NAME}\n`],
    ["upper case", NAME.toUpperCase()],
    ["a capital in the prefix", NAME.replace("oneuptime", "OneUptime")],
    ["a capital in its part", NAME.replace("-server", "-Server")],
    ["another part", NAME.replace("-server", "-servers")],
    ["no part", NAME.replace("-server", "-")],
    ["a key too short", NAME.replace(KEY, KEY.substring(1))],
    ["a key too long", NAME.replace(KEY, `${KEY}0`)],
    ["a key in capitals", NAME.replace(KEY, "0123456789AB")],
    ["a key that is not hex", NAME.replace(KEY, "0123456789ag")],
    ["a time too short", NAME.replace("20261104115007", "2026110411500")],
    ["a time too long", NAME.replace("20261104115007", "202611041150070")],
    ["a time with a letter", NAME.replace("20261104115007", "2026110411500x")],
    ["month 13", NAME.replace("20261104115007", "20261304115007")],
    ["month 0", NAME.replace("20261104115007", "20260004115007")],
    ["the 31st of June", NAME.replace("20261104115007", "20260631115007")],
    ["hour 25", NAME.replace("20261104115007", "20261104255007")],
    ["minute 60", NAME.replace("20261104115007", "20261104116007")],
    ["random too short", NAME.replace("abcdef", "abcde")],
    ["random too long", NAME.replace("abcdef", "abcdef0")],
    ["random in capitals", NAME.replace("abcdef", "ABCDEF")],
    ["random that is not hex", NAME.replace("abcdef", "abcdeg")],
    ["not text", 12345],
    ["null", null],
    ["undefined", undefined],
    ["an object", { name: NAME }],
    ["a list", [NAME]],
    ["a megabyte of it", `${NAME}${"x".repeat(1024 * 1024)}`],
    ["a megabyte of dashes", `oneuptime-check-${"-".repeat(1024 * 1024)}`],
  ];

  test.each(LOOKALIKES)("%s", (_name: string, value: unknown) => {
    expect(parseOpenStackCheckName(value)).toBeNull();
  });

  test("nothing else reads as one, however it is cut or changed", () => {
    const random: SeededRandom = seededRandom(5749);

    for (let round: number = 0; round < 20_000; round++) {
      const at: number = random(NAME.length);
      const kind: number = random(3);
      let changed: string;

      if (kind === 0) {
        // One character gone.
        changed = NAME.substring(0, at) + NAME.substring(at + 1);
      } else if (kind === 1) {
        // One character added.
        changed = `${NAME.substring(0, at)}-${NAME.substring(at)}`;
      } else {
        // One character changed to one no part of a name is ever written with.
        changed = `${NAME.substring(0, at)}!${NAME.substring(at + 1)}`;
      }

      expect(parseOpenStackCheckName(changed)).toBeNull();
    }
  });

  test("random text never reads as one, even made of what names are made of", () => {
    const texts: Array<string> = generatedTexts(
      5000,
      5749,
      [
        "oneuptime",
        "check",
        "-",
        KEY,
        "20261104115007",
        "abcdef",
        "server",
        "volume",
        "sg",
        "fip",
        "x",
      ],
      12,
    );

    for (const text of texts) {
      const parsed: ParsedOpenStackCheckName | null =
        parseOpenStackCheckName(text);

      if (parsed) {
        // The only thing that may read as one is exactly what would be written.
        expect(
          buildOpenStackCheckName({
            checkKey: parsed.checkKey,
            runId: parsed.runId,
            part: parsed.part,
          }),
        ).toBe(text);
      }
    }
  });
});

describe("a check's key", () => {
  test("is twelve lowercase hex characters", () => {
    expect(OPENSTACK_CHECK_KEY_LENGTH).toBe(12);
    expect(isOpenStackCheckKey(KEY)).toBe(true);
    expect(isOpenStackCheckKey("0123456789AB")).toBe(false);
    expect(isOpenStackCheckKey("0123456789a")).toBe(false);
    expect(isOpenStackCheckKey("0123456789abc")).toBe(false);
    expect(isOpenStackCheckKey("0123456789ag")).toBe(false);
    expect(isOpenStackCheckKey(123456789012)).toBe(false);
    expect(isOpenStackCheckKey(undefined)).toBe(false);
  });
});
