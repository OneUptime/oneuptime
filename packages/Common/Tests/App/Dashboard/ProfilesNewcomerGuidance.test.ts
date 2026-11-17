import { describe, expect, test } from "@jest/globals";
import getHelpDocumentProblems from "../../../UI/Components/Help/HelpDocumentRules";
import { readHelpDocument } from "../../../UI/Components/Help/HelpDocument";
import { PROFILE_FLAME_HELP } from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFlameHelp";
import {
  ProfileFunctionRow,
  getProfileServiceHotSpot,
  splitMinorProfileRows,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfilesView";

/*
 * ---------------------------------------------------------------------------
 * What a developer new to profiling is given (#9118)
 * ---------------------------------------------------------------------------
 *
 * Each service says where its own time goes before any graph; a function's
 * panel lists what it really calls before the kernel's interrupt handlers;
 * and how to read a flame graph is one help dialog away, written in the
 * help dialog's shape.
 */

function row(
  functionName: string,
  fileName: string,
  selfValue: number,
  ownValue: number = 0,
): ProfileFunctionRow {
  return {
    functionName,
    fileName,
    lineNumber: 1,
    frameType: "",
    selfValue,
    totalValue: selfValue,
    sampleCount: selfValue,
    ownValue,
  };
}

describe("getProfileServiceHotSpot", () => {
  test("the busiest function, when it is the service's own code", () => {
    expect(
      getProfileServiceHotSpot(
        [
          row("parseOrder", "src/orders/parse.ts", 400, 400),
          row("JSON.parse", "node:internal/json", 100),
        ],
        1000,
      ),
    ).toEqual({
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      share: 40,
      isOwnCode: true,
    });
  });

  test("a runtime's function leads: the own code with the most own-code time is named", () => {
    expect(
      getProfileServiceHotSpot(
        [
          row("JSON.parse", "node:internal/json", 500),
          row("handleCheckout", "src/routes/checkout.ts", 0, 100),
          row("parseOrder", "src/orders/parse.ts", 10, 450),
        ],
        1000,
      ),
    ).toEqual({
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      share: 45,
      isOwnCode: true,
    });
  });

  test("none of its own code ran: the busiest function, said as that", () => {
    expect(
      getProfileServiceHotSpot(
        [row("memcpy", "/lib/x86_64-linux-gnu/libc.so.6", 300)],
        1000,
      ),
    ).toEqual({
      functionName: "memcpy",
      fileName: "/lib/x86_64-linux-gnu/libc.so.6",
      share: 30,
      isOwnCode: false,
    });
  });

  test("nothing sampled: nothing to say", () => {
    expect(getProfileServiceHotSpot([], 0)).toBeNull();
  });
});

describe("splitMinorProfileRows", () => {
  const share: (value: number) => number = (value: number): number => {
    return value;
  };

  test("rows under 1% fold away, the first three always kept", () => {
    expect(splitMinorProfileRows([40, 0.5, 0.4, 5, 0.05, 0.02], share)).toEqual(
      { shown: [40, 0.5, 0.4, 5], folded: 2 },
    );
  });

  test("one row is never folded alone", () => {
    expect(splitMinorProfileRows([40, 30, 20, 0.01], share)).toEqual({
      shown: [40, 30, 20, 0.01],
      folded: 0,
    });
  });

  test("a short list is kept whole", () => {
    expect(splitMinorProfileRows([0.01, 0.02], share)).toEqual({
      shown: [0.01, 0.02],
      folded: 0,
    });
  });
});

describe("how to read a flame graph", () => {
  test("is written in the help dialog's shape", () => {
    expect(
      getHelpDocumentProblems(PROFILE_FLAME_HELP.markdown, {
        title: PROFILE_FLAME_HELP.title,
      }),
    ).toEqual([]);
  });

  test("puts what to fix first, then the words and colours the graph uses", () => {
    const titles: Array<string> = readHelpDocument(
      PROFILE_FLAME_HELP.markdown,
    ).sections.map((section: { title: string }): string => {
      return section.title;
    });

    expect(titles[0]).toBe("Find what to fix first");
    expect(titles).toEqual(
      expect.arrayContaining(["Self and total", "The colours", "No symbols"]),
    );
  });

  test("names every colour the flame graph's legend draws", () => {
    for (const word of [
      "Your code",
      "Library",
      "Runtime",
      "System",
      "No symbols",
    ]) {
      expect(PROFILE_FLAME_HELP.markdown).toContain(`**${word}**`);
    }
  });
});
