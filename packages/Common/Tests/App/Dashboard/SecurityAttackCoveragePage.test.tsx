import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Security Events > ATT&CK Coverage, as a reader meets it. It opened on the
 * whole matrix - fifteen columns of tiny cells wider than the card, the one
 * tactic a project covered off to the right. It now opens on a row per
 * tactic, in the order an attack moves through them, each with what the
 * attacker is after and how much of it the enabled rules cover; a row opens
 * on its techniques, the covered first, and each opens what covers it. A
 * line above says how much the Rule Library would add and opens it on the
 * rules not added. The matrix is one switch away, and the address keeps it.
 */

import AttackCoveragePage, {
  ATTACK_COVERAGE_GAP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/AttackCoverage";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  MITRE_TACTICS,
  MITRE_TACTIC_TECHNIQUES,
  MITRE_TECHNIQUES,
} from "../../../Types/SecurityEvent/MitreAttack";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function sigma(id: string, title: string, tags: Array<string>): string {
  return `title: ${title}
id: ${id}
level: high
tags:
${tags
  .map((tag: string): string => {
    return `  - ${tag}`;
  })
  .join("\n")}
detection:
  selection:
    className: Authentication
  condition: selection
`;
}

function rule(data: {
  id: string;
  name: string;
  isEnabled: boolean;
  sigmaRuleYaml: string;
}): DetectionRule {
  const item: DetectionRule = new DetectionRule();
  item._id = data.id;
  item.name = data.name;
  item.isEnabled = data.isEnabled;
  item.sigmaRuleYaml = data.sigmaRuleYaml;
  return item;
}

const BRUTE_FORCE: DetectionRule = rule({
  id: "26000000-0000-4000-8000-000000000001",
  name: "Our brute force rule",
  isEnabled: true,
  sigmaRuleYaml: sigma("our-brute-force", "Our brute force rule", [
    "attack.credential_access",
    "attack.t1110.001",
  ]),
});

const ACCOUNT_MANIPULATION_OFF: DetectionRule = rule({
  id: "26000000-0000-4000-8000-000000000002",
  name: "Admin added, switched off",
  isEnabled: false,
  sigmaRuleYaml: sigma("our-admin-added", "Admin added, switched off", [
    "attack.t1098",
  ]),
});

let listedRules: Array<DetectionRule> = [];
let failRead: boolean = false;
let queryWrites: Array<Record<string, string | null>> = [];

async function renderPage(search: string = ""): Promise<void> {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/security-events/attack-coverage${search}`,
  );

  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <AttackCoveragePage
          pageRoute={new Route("/dashboard/security-events/attack-coverage")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function tacticRow(tacticId: string): HTMLElement {
  return screen.getByTestId(`attack-tactic-${tacticId}`);
}

function tacticToggle(tacticId: string): HTMLElement {
  return within(tacticRow(tacticId)).getAllByRole("button")[0]!;
}

beforeEach(() => {
  listedRules = [BRUTE_FORCE, ACCOUNT_MANIPULATION_OFF];
  failRead = false;
  queryWrites = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    modelType: { new (): BaseModel };
  }) => {
    expect(new options.modelType()).toBeInstanceOf(DetectionRule);

    if (failRead) {
      throw new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read Detection Rule." },
        {},
      );
    }

    return {
      data: listedRules,
      count: listedRules.length,
      skip: 0,
      limit: 100,
    };
  }) as never);
  jest
    .spyOn(Navigation, "setQueryString")
    .mockImplementation((params: Record<string, string | null>): void => {
      queryWrites.push(params);
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the figures", () => {
  test("count the techniques and tactics the enabled rules cover, and the rules", async () => {
    await renderPage();

    // Brute Force alone: the rule that is off covers nothing.
    expect(screen.getByText(`1 / ${MITRE_TECHNIQUES.length}`)).toBeVisible();
    expect(screen.getByText(`1 / ${MITRE_TACTICS.length}`)).toBeVisible();
    expect(screen.getByText("Techniques Covered")).toBeVisible();
  });
});

describe("the tactics", () => {
  test("are a row each, in the matrix's order, each with what the attacker is after", async () => {
    await renderPage();

    const rows: Array<HTMLElement> = within(
      screen.getByTestId("attack-coverage-tactics"),
    ).getAllByRole("listitem");

    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-testid");
      }),
    ).toEqual(
      MITRE_TACTICS.map((tactic: { id: string }): string => {
        return `attack-tactic-${tactic.id}`;
      }),
    );

    expect(tacticRow("TA0006")).toHaveTextContent("Credential Access");
    expect(tacticRow("TA0006")).toHaveTextContent(
      "Steal account names and passwords.",
    );
    expect(tacticRow("TA0001")).toHaveTextContent("Get into your network.");
  });

  test("each says how many of its techniques the enabled rules cover", async () => {
    await renderPage();

    const credentialAccess: number = (MITRE_TACTIC_TECHNIQUES["TA0006"] || [])
      .length;

    expect(
      within(tacticRow("TA0006")).getByTestId("attack-tactic-covered"),
    ).toHaveTextContent(`1 of ${credentialAccess}`);
    // Account Manipulation's rule is off: Persistence has none covered.
    expect(
      within(tacticRow("TA0003")).getByTestId("attack-tactic-covered"),
    ).toHaveTextContent(
      `0 of ${(MITRE_TACTIC_TECHNIQUES["TA0003"] || []).length}`,
    );
  });

  test("start closed, and a row opens on its techniques, the covered first, then the library's", async () => {
    await renderPage();

    expect(screen.queryByTestId("attack-tactic-techniques")).toBeNull();
    expect(tacticToggle("TA0006")).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(tacticToggle("TA0006"));
    });

    expect(tacticToggle("TA0006")).toHaveAttribute("aria-expanded", "true");

    const cells: Array<HTMLElement> = within(
      within(tacticRow("TA0006")).getByTestId("attack-tactic-techniques"),
    ).getAllByRole("button");
    const states: Array<string | null> = cells.map(
      (cell: HTMLElement): string | null => {
        return cell.getAttribute("data-coverage");
      },
    );

    expect(cells[0]).toHaveAttribute("data-testid", "attack-technique-T1110");
    expect(states[0]).toBe("covered");
    expect(states).toContain("in-library");
    expect(states).toContain("not-covered");
    // Covered, then in the library, then not covered: never back up the order.
    const order: Array<string> = [
      "covered",
      "disabled-only",
      "in-library",
      "not-covered",
    ];
    const ranks: Array<number> = states.map((state: string | null): number => {
      return order.indexOf(state || "");
    });
    expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));

    // Closing it folds it again.
    await act(async () => {
      fireEvent.click(tacticToggle("TA0006"));
    });
    expect(
      within(tacticRow("TA0006")).queryByTestId("attack-tactic-techniques"),
    ).toBeNull();
  });

  test("a technique covered only by a rule that is off says so", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(tacticToggle("TA0003"));
    });

    expect(
      within(tacticRow("TA0003")).getByTestId("attack-technique-T1098"),
    ).toHaveAttribute("data-coverage", "disabled-only");
  });

  test("a technique opens what covers it: the project's rules, and the library's with the way to them", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(tacticToggle("TA0006"));
    });
    await act(async () => {
      fireEvent.click(
        within(tacticRow("TA0006")).getByTestId("attack-technique-T1110"),
      );
    });

    const details: HTMLElement = screen.getByTestId("attack-technique-details");

    expect(details).toHaveTextContent("Our brute force rule");
    expect(details).toHaveTextContent("In the rule library");

    const link: HTMLElement = within(details).getByRole("link", {
      name: "Open the rule library",
    });
    expect(link.getAttribute("href")).toContain("rule-library?search=T1110");
  });

  test("a page opened on a tactic (the Overview's tactics link here) opens that tactic", async () => {
    const scrolled: Array<Element> = [];
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: Element): void {
        scrolled.push(this);
      },
    });

    await renderPage("?tactic=TA0006");

    expect(tacticToggle("TA0006")).toHaveAttribute("aria-expanded", "true");
    expect(tacticToggle("TA0001")).toHaveAttribute("aria-expanded", "false");
    expect(scrolled).toContain(tacticRow("TA0006"));

    delete (
      window.HTMLElement.prototype as unknown as { scrollIntoView?: unknown }
    ).scrollIntoView;
  });

  test("a tactic the address names that is not ATT&CK's opens nothing", async () => {
    await renderPage("?tactic=TA9999");

    expect(screen.queryByTestId("attack-tactic-techniques")).toBeNull();
  });
});

describe("the next step", () => {
  test("says how many techniques the Rule Library covers that the rules do not, and opens it on the rules not added", async () => {
    await renderPage();

    const gap: HTMLElement = screen.getByTestId(ATTACK_COVERAGE_GAP_TEST_ID);

    expect(gap).toHaveTextContent(
      /The Rule Library covers \d+ techniques your rules do not\./,
    );

    const link: HTMLElement = within(gap).getByRole("link", {
      name: /See the rules you have not added/,
    });
    expect(link.getAttribute("href")).toContain(
      "rule-library?status=not-added",
    );
  });

  test("is gone once the rules cover all the library does - the library's own rules, however renamed", async () => {
    listedRules = DETECTION_RULE_LIBRARY.map(
      (entry: DetectionRuleLibraryEntry, index: number): DetectionRule => {
        return rule({
          id: `26000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
          // Renamed: the library knows each by the Sigma id it carries.
          name: `Our copy ${index}`,
          isEnabled: true,
          sigmaRuleYaml: entry.sigmaRuleYaml,
        });
      },
    );

    await renderPage();

    expect(screen.queryByTestId(ATTACK_COVERAGE_GAP_TEST_ID)).toBeNull();
  });
});

describe("the matrix", () => {
  test("is one switch away, and the address keeps it", async () => {
    await renderPage();

    expect(screen.queryByTestId("attack-coverage-matrix")).toBeNull();

    const matrixOption: HTMLElement = within(
      screen.getByTestId("attack-coverage-view"),
    ).getByRole("radio", { name: "Matrix" });

    await act(async () => {
      fireEvent.click(matrixOption);
    });

    expect(screen.getByTestId("attack-coverage-matrix")).toBeInTheDocument();
    expect(screen.queryByTestId("attack-coverage-tactics")).toBeNull();
    expect(queryWrites).toEqual([{ view: "matrix" }]);
    // The matrix's own filter comes with it.
    expect(screen.getByText("Only covered techniques")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("attack-coverage-view")).getByRole("radio", {
          name: "By tactic",
        }),
      );
    });

    expect(queryWrites[1]).toEqual({ view: null });
    expect(screen.getByTestId("attack-coverage-tactics")).toBeInTheDocument();
  });

  test("a page opened on the matrix opens on it, every cell in the matrix's order", async () => {
    await renderPage("?view=matrix");

    const matrix: HTMLElement = screen.getByTestId("attack-coverage-matrix");
    const cells: Array<string | null> = within(matrix)
      .getAllByRole("button")
      .map((cell: HTMLElement): string | null => {
        return cell.getAttribute("data-testid");
      });

    const firstColumn: Array<string> = (
      MITRE_TACTIC_TECHNIQUES[MITRE_TACTICS[0]!.id] || []
    ).map(([id]: readonly [string, string]): string => {
      return `attack-technique-${id}`;
    });

    expect(cells.slice(0, firstColumn.length)).toEqual(firstColumn);
  });
});

describe("the legend", () => {
  test("names each look of a technique, in the order the rows list them", async () => {
    await renderPage();

    const legend: HTMLElement = screen.getByTestId("attack-coverage-legend");

    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([
      "Covered by an enabled rule",
      "Covered by disabled rules only",
      "Available in the rule library",
      "Not covered",
    ]);
  });
});

describe("a read that fails", () => {
  test("says why, in the product's words", async () => {
    failRead = true;

    await renderPage();

    expect(
      screen.getByText("You do not have permission to read Detection Rule."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("attack-coverage-tactics")).toBeNull();
  });
});
