/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import { SecurityRuleAddedByOneUptime } from "../../../Utils/SecurityEvent/RecommendedDetectionRules";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityOverviewStatus from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatus";
import {
  SECURITY_RECOMMENDED_RULES_TEST_ID,
  SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID,
  readDismissedIds,
  rememberDismissedIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityRecommendedRules";
import { SecurityRecommendedRulesDismissal } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityRecommendedRulesModel";
import {
  SETUP_CALL_FAILED,
  SecuritySetupStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import { SecurityOverviewQueue } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";

/*
 * THE RECOMMENDED RULES A PROJECT DOES NOT HAVE, ON THE OVERVIEW (#11037), as
 * a reader sees them on the real card.
 *
 * A project that turned on the recommended rules before Sensitive file
 * served was one read "26 of 27 recommended" with a bulb, and nothing said
 * which rule, or what it catches. Under the pipeline the card now names it:
 * its name, how severe its findings are, what it catches, and Turn On -
 * which adds it as the Rule Library's Add does. A rule OneUptime turned on
 * itself, on upgrade, is said above it, with Turn Off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11037000-0000-4000-8000-0000000000d1",
);
const SERVED: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SENSITIVE_FILE_SERVED_RULE_ID,
)!;
const SCANNING: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
)!;
const RULE_ID: string = "11037000-0000-4000-8000-0000000000a1";
const ADDED_AT: string = "2026-11-24T09:30:00.000Z";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        runSetupTest: (): Promise<never> => {
          return new Promise<never>(() => {});
        },
      },
    };
  },
);

const QUEUE: SecurityOverviewQueue = {
  openCases: 0,
  criticalOpenCases: 0,
  highOpenCases: 0,
  myOpenCases: 0,
  unassignedOpenCases: 0,
  runsWaitingForApproval: 0,
};

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  const total: number = RECOMMENDED_DETECTION_RULE_IDS.length;

  return {
    connections: 0,
    logsSourceEnabled: true,
    telemetrySourcesEnabled: 1,
    eventsLast24Hours: 12,
    lastEventAt: new Date("2026-11-27T11:00:00.000Z"),
    enabledRules: total - 1,
    recommendedRules: total,
    recommendedRulesOn: total - 1,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 1,
    destinations: 0,
    recommendedRulesNotAdded: [SERVED],
    ...overrides,
  };
}

function addedByOneUptime(
  overrides: Partial<SecurityRuleAddedByOneUptime> = {},
): SecurityRuleAddedByOneUptime {
  return {
    ruleId: RULE_ID,
    libraryRuleId: SERVED.id,
    name: SERVED.title,
    addedAt: ADDED_AT,
    ...overrides,
  };
}

function renderCard(
  value: SecuritySetupStatus,
  options: { showPipeline?: boolean; onChanged?: () => void } = {},
): { rerender: (next: SecuritySetupStatus) => void } {
  const element: (next: SecuritySetupStatus) => React.ReactElement = (
    next: SecuritySetupStatus,
  ): React.ReactElement => {
    return (
      <MemoryRouter>
        <SecurityOverviewStatus
          queue={QUEUE}
          status={next}
          showPipeline={options.showPipeline !== false}
          hasStatusFailed={false}
          isReading={false}
          now={new Date("2026-11-27T12:00:00.000Z")}
          onChanged={options.onChanged || ((): void => {})}
          onTryAgain={(): void => {}}
          onSetUp={(): void => {}}
        />
      </MemoryRouter>
    );
  };
  const rendered: ReturnType<typeof render> = render(element(value));

  return {
    rerender: (next: SecuritySetupStatus): void => {
      rendered.rerender(element(next));
    },
  };
}

function line(): HTMLElement {
  return screen.getByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID);
}

beforeEach(() => {
  window.localStorage.clear();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the recommended rules a project does not have", () => {
  test("names the one rule it lacks - its name, how severe, what it catches - under the Detections cell that counts it", () => {
    renderCard(status());

    const total: number = RECOMMENDED_DETECTION_RULE_IDS.length;

    // The cell still counts it, as before.
    expect(
      screen.getByTestId("security-pipeline-detections-status"),
    ).toHaveTextContent(`${total - 1} of ${total} recommended`);

    expect(
      screen.getByTestId(`${SECURITY_RECOMMENDED_RULES_TEST_ID}-title`),
    ).toHaveTextContent("1 recommended rule is not in this project yet");

    const rule: HTMLElement = within(line()).getByTestId(
      `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${SERVED.id}`,
    );

    expect(rule).toHaveTextContent("Sensitive file served");
    expect(rule).toHaveTextContent("Critical");
    expect(rule).toHaveTextContent(SERVED.description);
    expect(within(rule).getByRole("button", { name: "Turn On" })).toBeEnabled();
    expect(
      within(line()).getByRole("list", {
        name: "Recommended rules not in this project",
      }),
    ).toBeInTheDocument();
  });

  test("a project with every recommended rule is told nothing more", () => {
    renderCard(status({ recommendedRulesNotAdded: undefined }));

    expect(
      screen.queryByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Turn On adds it as the Rule Library's Add does - on, opening cases - says so, and reads the card again", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue({} as never);
    const toast: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Toast, "success")
      .mockReturnValue("t");
    const onChanged: MockFunction = getJestMockFunction();

    renderCard(status(), { onChanged });

    fireEvent.click(within(line()).getByRole("button", { name: "Turn On" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    const call: { model: DetectionRule; modelType: unknown } = create.mock
      .calls[0]![0] as { model: DetectionRule; modelType: unknown };

    expect(call.modelType).toBe(DetectionRule);
    expect(call.model.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(call.model.name).toBe("Sensitive file served");
    expect(call.model.sigmaRuleYaml).toBe(SERVED.sigmaRuleYaml);
    expect(call.model.isEnabled).toBe(true);
    expect(call.model.shouldCreateCase).toBe(true);
    expect(toast).toHaveBeenCalledWith("Sensitive file served is on.");
  });

  test("a rule that cannot be added says why on its line, and Turn On tries again", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValueOnce(new HTTPErrorResponse(403, { message: "No." }, {}))
      .mockResolvedValueOnce({} as never);
    jest.spyOn(Toast, "success").mockReturnValue("t");
    const onChanged: MockFunction = getJestMockFunction();

    renderCard(status(), { onChanged });

    fireEvent.click(within(line()).getByRole("button", { name: "Turn On" }));

    const problem: HTMLElement = await screen.findByTestId(
      `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${SERVED.id}-problem`,
    );

    expect(problem).toHaveTextContent("1 rule could not be added");
    expect(problem).toHaveTextContent("Your role cannot add it.");
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(within(line()).getByRole("button", { name: "Turn On" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId(
        `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${SERVED.id}-problem`,
      ),
    ).not.toBeInTheDocument();
  });

  test("a role that cannot add rules sees Turn On locked", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Your role cannot create detection rules.",
    });

    renderCard(status());

    expect(
      within(line()).getByRole("button", { name: "Turn On" }),
    ).toBeDisabled();
  });

  test("names three, and opens the rest in the Rule Library, on the recommended rules not added", () => {
    const missing: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules().slice(0, 5);

    renderCard(status({ recommendedRulesNotAdded: missing }));

    expect(
      screen.getByTestId(`${SECURITY_RECOMMENDED_RULES_TEST_ID}-title`),
    ).toHaveTextContent("5 recommended rules are not in this project yet");
    expect(within(line()).getAllByRole("listitem")).toHaveLength(3);

    const more: HTMLElement = screen.getByTestId(
      `${SECURITY_RECOMMENDED_RULES_TEST_ID}-more`,
    );

    expect(more).toHaveTextContent("2 more in the Rule Library");

    const href: string = more.getAttribute("href") || "";

    expect(href).toContain("category=recommended");
    expect(href).toContain("status=not-added");
  });

  test("Dismiss puts the line away for this project - remembered - and a recommended rule it was not shown brings it back", () => {
    renderCard(status());

    fireEvent.click(within(line()).getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      readDismissedIds(SecurityRecommendedRulesDismissal.NotAdded),
    ).toEqual([SERVED.id]);

    // The next visit: still away.
    cleanup();
    const next: { rerender: (next: SecuritySetupStatus) => void } =
      renderCard(status());

    expect(
      screen.queryByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID),
    ).not.toBeInTheDocument();

    // A rule it was not shown: the line is back, for that rule alone.
    next.rerender(status({ recommendedRulesNotAdded: [SCANNING, SERVED] }));

    expect(
      screen.getByTestId(`${SECURITY_RECOMMENDED_RULES_TEST_ID}-title`),
    ).toHaveTextContent("1 recommended rule is not in this project yet");
    expect(
      within(line()).getByTestId(
        `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${SCANNING.id}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(line()).queryByTestId(
        `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${SERVED.id}`,
      ),
    ).not.toBeInTheDocument();
  });

  test("another project's dismissal is its own", () => {
    renderCard(status());
    fireEvent.click(within(line()).getByRole("button", { name: "Dismiss" }));
    cleanup();

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID("11037000-0000-4000-8000-0000000000d2"));
    renderCard(status());

    expect(line()).toBeInTheDocument();
  });

  test("not while Get started is on the page: its steps turn the rules on", () => {
    renderCard(status(), { showPipeline: false });

    expect(
      screen.queryByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("only library rules it knows: the card names nothing it cannot describe", () => {
    const notRecommended: DetectionRuleLibraryEntry =
      DETECTION_RULE_LIBRARY.find((entry: DetectionRuleLibraryEntry) => {
        return !RECOMMENDED_DETECTION_RULE_IDS.includes(entry.id);
      })!;

    renderCard(status({ recommendedRulesNotAdded: [SERVED] }));

    expect(
      within(line()).queryByTestId(
        `${SECURITY_RECOMMENDED_RULES_TEST_ID}-${notRecommended.id}`,
      ),
    ).not.toBeInTheDocument();
  });
});

describe("a rule OneUptime turned on itself", () => {
  function notice(): HTMLElement {
    return screen.getByTestId(
      `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${RULE_ID}`,
    );
  }

  test("says what was turned on, when and why, and what it catches", () => {
    renderCard(
      status({
        recommendedRulesNotAdded: undefined,
        recommendedRulesOn: RECOMMENDED_DETECTION_RULE_IDS.length,
        rulesAddedByOneUptime: [addedByOneUptime()],
      }),
    );

    expect(
      screen.getByTestId(
        `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${RULE_ID}-title`,
      ),
    ).toHaveTextContent(
      `OneUptime turned on Sensitive file served on ${OneUptimeDate.getDateAsLocalFormattedString(ADDED_AT, true)}`,
    );
    expect(notice()).toHaveTextContent(
      "Every other recommended rule was on in this project, so OneUptime added this one when it became recommended.",
    );
    expect(
      screen.getByTestId(
        `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${RULE_ID}-description`,
      ),
    ).toHaveTextContent(SERVED.description);
    // A renamed rule is said by its own name.
    cleanup();
    renderCard(
      status({
        rulesAddedByOneUptime: [addedByOneUptime({ name: "Leaked secrets" })],
      }),
    );
    expect(notice()).toHaveTextContent("OneUptime turned on Leaked secrets on");
  });

  test("Turn Off turns the rule off, says so, and reads the card again", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(undefined as never);
    const toast: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Toast, "success")
      .mockReturnValue("t");
    const onChanged: MockFunction = getJestMockFunction();

    renderCard(status({ rulesAddedByOneUptime: [addedByOneUptime()] }), {
      onChanged,
    });

    fireEvent.click(within(notice()).getByRole("button", { name: "Turn Off" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    const call: { modelType: unknown; id: ObjectID; data: unknown } = update
      .mock.calls[0]![0] as { modelType: unknown; id: ObjectID; data: unknown };

    expect(call.modelType).toBe(DetectionRule);
    expect(call.id.toString()).toBe(RULE_ID);
    expect(call.data).toEqual({ isEnabled: false });
    expect(toast).toHaveBeenCalledWith("Sensitive file served is off.");
  });

  test("a Turn Off that fails says so on its line, in the product's words", async () => {
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(
        new HTTPErrorResponse(502, { message: "Bad gateway" }, {}),
      );

    renderCard(status({ rulesAddedByOneUptime: [addedByOneUptime()] }));

    fireEvent.click(within(notice()).getByRole("button", { name: "Turn Off" }));

    const error: HTMLElement = await screen.findByTestId(
      `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${RULE_ID}-error`,
    );

    expect(error).toHaveTextContent(
      "Sensitive file served could not be turned off",
    );
    expect(error).toHaveTextContent(SETUP_CALL_FAILED);
    expect(error).not.toHaveTextContent("Bad gateway");
  });

  test("a role that cannot change rules sees Turn Off locked", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });

    renderCard(status({ rulesAddedByOneUptime: [addedByOneUptime()] }));

    expect(
      within(notice()).getByRole("button", { name: "Turn Off" }),
    ).toBeDisabled();
  });

  test("Dismiss puts it away, remembered by the rule", () => {
    renderCard(status({ rulesAddedByOneUptime: [addedByOneUptime()] }));

    fireEvent.click(within(notice()).getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByTestId(
        `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${RULE_ID}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      readDismissedIds(SecurityRecommendedRulesDismissal.AddedByOneUptime),
    ).toEqual([RULE_ID]);
    // The recommended rules' line is its own: still there.
    expect(line()).toBeInTheDocument();
  });

  test("said above the recommended rules the project does not have", () => {
    renderCard(status({ rulesAddedByOneUptime: [addedByOneUptime()] }));

    const order: number = notice().compareDocumentPosition(line());

    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("what a reader dismissed, kept in this browser", () => {
  test("under the project, each line apart, added to what was before", () => {
    rememberDismissedIds(SecurityRecommendedRulesDismissal.NotAdded, [
      SERVED.id,
    ]);
    rememberDismissedIds(SecurityRecommendedRulesDismissal.NotAdded, [
      SCANNING.id,
    ]);

    expect(
      readDismissedIds(SecurityRecommendedRulesDismissal.NotAdded).sort(),
    ).toEqual([SCANNING.id, SERVED.id].sort());
    expect(
      readDismissedIds(SecurityRecommendedRulesDismissal.AddedByOneUptime),
    ).toEqual([]);
    expect(
      window.localStorage.getItem(
        `security-recommended-rules-dismissed-${PROJECT_ID.toString()}`,
      ),
    ).not.toBeNull();
  });

  test("a storage that cannot be read or written dismisses nothing for good, and never fails the card", () => {
    jest.spyOn(LocalStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    jest.spyOn(LocalStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(
      readDismissedIds(SecurityRecommendedRulesDismissal.NotAdded),
    ).toEqual([]);
    expect(
      rememberDismissedIds(SecurityRecommendedRulesDismissal.NotAdded, [
        SERVED.id,
      ]),
    ).toEqual([SERVED.id]);

    renderCard(status());
    fireEvent.click(within(line()).getByRole("button", { name: "Dismiss" }));

    // Put away for this visit all the same.
    expect(
      screen.queryByTestId(SECURITY_RECOMMENDED_RULES_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("no project, nothing kept", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    rememberDismissedIds(SecurityRecommendedRulesDismissal.NotAdded, [
      SERVED.id,
    ]);

    expect(window.localStorage.length).toBe(0);
  });
});
