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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import RuleLibraryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The Rule Library's recommended rules: marked on their cards, a filter of
 * their own, and one button that adds the ones the project does not have
 * yet - through the same server call as the Overview's "Turn on
 * recommended", which also turns back on any that were turned off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let ruleNames: Array<string> = [];

beforeEach(() => {
  ruleNames = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    return {
      data: ruleNames.map((name: string): DetectionRule => {
        const rule: DetectionRule = new DetectionRule();
        rule.name = name;
        return rule;
      }),
      count: ruleNames.length,
      skip: 0,
      limit: 100,
    } as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <RuleLibraryPage
          pageRoute={new Route("/dashboard/security-events/rule-library")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

const RECOMMENDED: Array<DetectionRuleLibraryEntry> =
  getRecommendedDetectionRules();

describe("recommended rules in the Rule Library", () => {
  test("every recommended rule is marked, and only those", async () => {
    await renderPage();

    const marked: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return (
          screen.queryByTestId(`rule-library-recommended-${entry.id}`) !== null
        );
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    });

    expect(marked).toEqual(
      RECOMMENDED.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );
  });

  test("the Recommended filter lists just them", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("rule-library-category-recommended"));
    });

    const shown: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return screen.queryByTestId(`rule-library-entry-${entry.id}`) !== null;
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    });

    expect(shown).toEqual(
      RECOMMENDED.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );
    expect(
      screen.getByTestId("rule-library-category-recommended"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("one button adds the recommended rules the project lacks, through the server, then reads the rules again", async () => {
    // Two of them are there already.
    ruleNames = [RECOMMENDED[0]!.title, RECOMMENDED[1]!.title];
    const turnOn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockImplementation(async () => {
        ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
          return entry.title;
        });
        return {
          rulesAdded: RECOMMENDED.length - 2,
          rulesTurnedOn: 0,
          logsTurnedOn: false,
          playbookAdded: false,
          playbookTurnedOn: false,
        };
      });
    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: `Add ${RECOMMENDED.length - 2} Recommended Rules`,
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(turnOn).toHaveBeenCalledWith({
      logs: false,
      detections: true,
      playbook: false,
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Recommended Rules?$/ }),
      ).toBeNull();
    });
    expect(ModelAPI.getList).toHaveBeenCalledTimes(2);
  });

  test("with every recommended rule added there is no button for them", async () => {
    ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
      return entry.title;
    });
    await renderPage();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Recommended Rules?$/ }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", {
        name: `Add All ${DETECTION_RULE_LIBRARY.length - RECOMMENDED.length} Rules`,
      }),
    ).toBeInTheDocument();
  });
});
