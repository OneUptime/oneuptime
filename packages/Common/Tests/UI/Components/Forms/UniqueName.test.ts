import { describe, expect, test } from "@jest/globals";
import {
  getCopyName,
  getCopyNameSearchText,
  getUniqueName,
  normalizeNameForComparison,
  splitNumberedName,
} from "../../../../UI/Components/Forms/Utils/UniqueName";

/*
 * The one rule behind every name a form fills in for a new record - a
 * dashboard after its template, a key after its setup guide: the wanted
 * name while nothing has it, else the first free "<name> N". Names are
 * compared the way the server's unique check compares them (without case
 * or surrounding spaces), so the name filled in is never one the server
 * would refuse as taken.
 */
describe("a name nothing in the project has yet", () => {
  type Case = [string, Array<string | null | undefined>, string];

  const CASES: Array<Case> = [
    ["Kubernetes Dashboard", [], "Kubernetes Dashboard"],
    ["Kubernetes Dashboard", ["Hosts Dashboard"], "Kubernetes Dashboard"],
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard"],
      "Kubernetes Dashboard 2",
    ],
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard", "Kubernetes Dashboard 2"],
      "Kubernetes Dashboard 3",
    ],
    // The first free number, not one past the highest.
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard", "Kubernetes Dashboard 3"],
      "Kubernetes Dashboard 2",
    ],
    // A gap at the start: the wanted name itself is free again.
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard 2", "Kubernetes Dashboard 3"],
      "Kubernetes Dashboard",
    ],
    // Case and surrounding spaces do not tell names apart.
    [
      "Kubernetes Dashboard",
      ["  kubernetes DASHBOARD "],
      "Kubernetes Dashboard 2",
    ],
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard", "KUBERNETES DASHBOARD 2"],
      "Kubernetes Dashboard 3",
    ],
    // A name that merely contains the wanted one does not take it.
    [
      "Kubernetes Dashboard",
      ["Kubernetes Dashboard Old", "My Kubernetes Dashboard"],
      "Kubernetes Dashboard",
    ],
    [
      "Kubernetes Dashboard",
      ["Kubernetes Cost Dashboard"],
      "Kubernetes Dashboard",
    ],
    // What is not a name is passed over.
    [
      "Kubernetes Dashboard",
      [null, undefined, "", "   ", "Kubernetes Dashboard"],
      "Kubernetes Dashboard 2",
    ],
  ];

  test.each(CASES)(
    "%j among %j is %j",
    (
      name: string,
      existingNames: Array<string | null | undefined>,
      expected: string,
    ) => {
      expect(getUniqueName({ name, existingNames })).toBe(expected);
    },
  );

  test("the name is filled in without the spaces around it", () => {
    expect(
      getUniqueName({ name: "  Hosts Dashboard ", existingNames: [] }),
    ).toBe("Hosts Dashboard");
    expect(
      getUniqueName({
        name: " Hosts Dashboard ",
        existingNames: ["Hosts Dashboard"],
      }),
    ).toBe("Hosts Dashboard 2");
  });

  test("a blank name is handed back as it is: there is nothing to number", () => {
    expect(getUniqueName({ name: "", existingNames: [""] })).toBe("");
    expect(getUniqueName({ name: "  ", existingNames: ["Anything"] })).toBe(
      "  ",
    );
  });

  test("numbering always finds a free name", () => {
    const existingNames: Array<string> = ["SLO Dashboard"];

    for (let number: number = 2; number <= 60; number++) {
      existingNames.push(`SLO Dashboard ${number}`);
    }

    expect(getUniqueName({ name: "SLO Dashboard", existingNames })).toBe(
      "SLO Dashboard 61",
    );
  });

  test("the name it gives is never one of the names it was given", () => {
    const existingNames: Array<string> = [];

    for (let round: number = 0; round < 25; round++) {
      const name: string = getUniqueName({
        name: "Monitor Dashboard",
        existingNames,
      });

      expect(
        existingNames.map((existing: string): string => {
          return normalizeNameForComparison(existing);
        }),
      ).not.toContain(normalizeNameForComparison(name));

      existingNames.push(name);
    }

    expect(existingNames[0]).toBe("Monitor Dashboard");
    expect(existingNames[1]).toBe("Monitor Dashboard 2");
    expect(existingNames[24]).toBe("Monitor Dashboard 25");
  });

  test("takes any iterable of names, a Set included", () => {
    expect(
      getUniqueName({
        name: "Alert Dashboard",
        existingNames: new Set<string>(["Alert Dashboard"]),
      }),
    ).toBe("Alert Dashboard 2");
  });
});

describe("how two names are compared", () => {
  test("like the server's unique check: no case, no surrounding spaces", () => {
    expect(normalizeNameForComparison("  Kubernetes Dashboard ")).toBe(
      "kubernetes dashboard",
    );
    expect(normalizeNameForComparison("KUBERNETES dashboard")).toBe(
      normalizeNameForComparison("kubernetes Dashboard"),
    );
  });

  test("spaces inside a name still count", () => {
    expect(normalizeNameForComparison("Kubernetes  Dashboard")).not.toBe(
      normalizeNameForComparison("Kubernetes Dashboard"),
    );
  });
});

/*
 * What Duplicate fills in for the copy: the original's name, numbered past
 * the names the project has. A copy of a copy goes on with the series its
 * original belongs to - when the series' first name is one the project
 * has - and is never numbered below its original.
 */
describe("a copy's name", () => {
  type Case = [string, Array<string | null | undefined>, string];

  const CASES: Array<Case> = [
    // The original is always taken, even when the lookup did not see it.
    ["API Monitor", [], "API Monitor 2"],
    ["API Monitor", ["API Monitor"], "API Monitor 2"],
    ["API Monitor", ["API Monitor", "API Monitor 2"], "API Monitor 3"],
    // The first free number after the original's, a gap included.
    ["API Monitor", ["API Monitor", "API Monitor 3"], "API Monitor 2"],
    // A copy of a copy continues the series, past its own number.
    ["API Monitor 2", ["API Monitor", "API Monitor 2"], "API Monitor 3"],
    [
      "API Monitor 2",
      ["API Monitor", "API Monitor 2", "API Monitor 3", "API Monitor 4"],
      "API Monitor 5",
    ],
    // Never below its original, even where a lower number is free.
    ["API Monitor 3", ["API Monitor", "API Monitor 3"], "API Monitor 4"],
    // "1" is a number like any other.
    ["Release 1", ["Release", "Release 1"], "Release 2"],
    // Without the series' first name, the number is part of the name.
    ["Windows Server 2019", [], "Windows Server 2019 2"],
    [
      "Windows Server 2019",
      ["Windows Server 2016", "Windows Server 2019"],
      "Windows Server 2019 2",
    ],
    ["API Monitor 2", ["API Monitor 2"], "API Monitor 2 2"],
    // The series' first name is matched like any name: no case, no spaces around.
    ["API Monitor 2", ["  api monitor ", "API Monitor 2"], "API Monitor 3"],
    // Taken names are compared without case or surrounding spaces.
    ["API Monitor", ["API MONITOR 2 "], "API Monitor 3"],
    // A number glued to the name is part of it: "v2" is not a copy number.
    ["Service v2", ["Service v", "Service v2"], "Service v2 2"],
    // A name that is only a number has no series.
    ["2024", ["2024"], "2024 2"],
    // What is not a name is passed over.
    ["API Monitor", [null, undefined, "", "  "], "API Monitor 2"],
  ];

  test.each(CASES)(
    "a copy of %j among %j is %j",
    (
      name: string,
      existingNames: Array<string | null | undefined>,
      expected: string,
    ) => {
      expect(getCopyName({ name, existingNames })).toBe(expected);
    },
  );

  test("is never the original's name, nor any name taken", () => {
    const names: Array<string> = ["API Monitor"];

    // Copy the newest copy, again and again.
    for (let round: number = 0; round < 30; round++) {
      const copy: string = getCopyName({
        name: names[names.length - 1] as string,
        existingNames: names,
      });

      expect(
        names.map((existing: string): string => {
          return normalizeNameForComparison(existing);
        }),
      ).not.toContain(normalizeNameForComparison(copy));

      names.push(copy);
    }

    expect(names.slice(0, 4)).toEqual([
      "API Monitor",
      "API Monitor 2",
      "API Monitor 3",
      "API Monitor 4",
    ]);
    expect(names[30]).toBe("API Monitor 31");
  });

  test("copying the original again and again numbers the copies in turn", () => {
    const names: Array<string> = ["Nightly Sync"];

    for (let round: number = 0; round < 5; round++) {
      names.push(getCopyName({ name: "Nightly Sync", existingNames: names }));
    }

    expect(names).toEqual([
      "Nightly Sync",
      "Nightly Sync 2",
      "Nightly Sync 3",
      "Nightly Sync 4",
      "Nightly Sync 5",
      "Nightly Sync 6",
    ]);
  });

  test("is filled in without the spaces around the original's name", () => {
    expect(getCopyName({ name: "  API Monitor ", existingNames: [] })).toBe(
      "API Monitor 2",
    );
  });

  test("is blank for a blank name: there is nothing to number", () => {
    expect(getCopyName({ name: "", existingNames: ["API Monitor"] })).toBe("");
    expect(getCopyName({ name: "   ", existingNames: [] })).toBe("");
  });

  test("takes any iterable of names, a Set included", () => {
    expect(
      getCopyName({
        name: "API Monitor",
        existingNames: new Set<string>(["API Monitor", "API Monitor 2"]),
      }),
    ).toBe("API Monitor 3");
  });

  test("always finds a free number, however long the series", () => {
    const names: Array<string> = ["Probe"];

    for (let number: number = 2; number <= 80; number++) {
      names.push(`Probe ${number}`);
    }

    expect(getCopyName({ name: "Probe 7", existingNames: names })).toBe(
      "Probe 81",
    );
  });
});

describe("a name ending in a number", () => {
  test("is split into its base and its number", () => {
    expect(splitNumberedName("API Monitor 2")).toEqual({
      base: "API Monitor",
      number: 2,
    });
    expect(splitNumberedName("  API  Monitor   12 ")).toEqual({
      base: "API  Monitor",
      number: 12,
    });
  });

  test("needs a space before the number, and something before that", () => {
    expect(splitNumberedName("API Monitor")).toBeNull();
    expect(splitNumberedName("Service v2")).toBeNull();
    expect(splitNumberedName("2024")).toBeNull();
    expect(splitNumberedName("")).toBeNull();
    expect(splitNumberedName("Release 2.1")).toBeNull();
  });

  test("is not split when the number is too large to count on", () => {
    expect(splitNumberedName("Order 123456789012345678901234567890")).toBe(
      null,
    );
    expect(
      getCopyName({
        name: "Order 123456789012345678901234567890",
        existingNames: ["Order"],
      }),
    ).toBe("Order 123456789012345678901234567890 2");
  });
});

describe("what the lookup of a copy's taken names searches for", () => {
  test("the series' first name when the name ends in a number, else the name", () => {
    expect(getCopyNameSearchText("API Monitor 2")).toBe("API Monitor");
    expect(getCopyNameSearchText("API Monitor")).toBe("API Monitor");
    expect(getCopyNameSearchText("  API Monitor  ")).toBe("API Monitor");
    expect(getCopyNameSearchText("Windows Server 2019")).toBe(
      "Windows Server",
    );
  });

  test("is contained in every name that decides the copy's name", () => {
    const cases: Array<[string, Array<string>]> = [
      ["API Monitor", ["API Monitor", "API Monitor 2", "API Monitor 2 2"]],
      ["API Monitor 2", ["API Monitor", "API Monitor 2", "API Monitor 3"]],
      ["Windows Server 2019", ["Windows Server 2019", "Windows Server 2019 2"]],
    ];

    for (const [name, deciding] of cases) {
      const searchText: string = normalizeNameForComparison(
        getCopyNameSearchText(name),
      );

      for (const existing of deciding) {
        expect(normalizeNameForComparison(existing)).toContain(searchText);
      }
    }
  });
});
