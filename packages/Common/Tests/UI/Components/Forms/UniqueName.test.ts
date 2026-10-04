import { describe, expect, test } from "@jest/globals";
import {
  getUniqueName,
  normalizeNameForComparison,
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
