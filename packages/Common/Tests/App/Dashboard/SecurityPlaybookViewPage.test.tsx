import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A playbook's page. Its trail and its browser tab named every playbook
 * "View Playbook"; they name the playbook now, as a monitor's or an
 * incident's page names its record. Its settings card read the trigger and
 * the detection source as stored, in English, and repeated the name the
 * page's title already says; a rules filter that could not be saved turned
 * the whole page into an error; its latest runs drew every step of every
 * run. The card's fields, the page's own words and the runs are pinned
 * here; the card itself and the step editor have suites of their own.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

interface CapturedDetailField {
  title: string;
  field: Record<string, unknown>;
  colSpan?: number | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
}

let capturedDetailFields: Array<CapturedDetailField> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      modelDetailProps: { fields: Array<CapturedDetailField> };
    }) => {
      capturedDetailFields = props.modelDetailProps.fields;
      return React.createElement("div", {
        "data-testid": "security-playbook-settings",
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepsEditor",
  () => {
    return {
      __esModule: true,
      default: () => {
        return React.createElement("div", {
          "data-testid": "security-playbook-steps",
        });
      },
    };
  },
);

let capturedRulesSubmit:
  | ((values: Record<string, unknown>) => Promise<void>)
  | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      onSubmit: (values: Record<string, unknown>) => Promise<void>;
    }) => {
      capturedRulesSubmit = props.onSubmit;
      return React.createElement("div", {
        "data-testid": "security-playbook-rules-form",
      });
    },
  };
});

import SecurityPlaybookViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/PlaybookView";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import User from "../../../UI/Utils/User";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";

const PLAYBOOK_ID: string = "24000000-0000-4000-8000-000000000003";
const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const NAME: string = "Contain Compromised Okta Users";

function playbook(): SecurityPlaybook {
  const item: SecurityPlaybook = new SecurityPlaybook();
  item._id = PLAYBOOK_ID;
  item.name = NAME;
  item.isEnabled = true;
  item.trigger = SecurityPlaybookTrigger.CaseOpened;
  item.detectionSource = SecurityDetectionSource.DetectionRule;
  item.detectionRuleIds = [];
  item.steps = [] as unknown as JSONArray;
  item.runCount = 6;
  item.lastRunAt = new Date(Date.now() - 40 * 60 * 1000);
  return item;
}

function finishedRun(): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = "25000000-0000-4000-8000-000000000040";
  run.playbookName = NAME;
  run.status = SecurityPlaybookRunStatus.Succeeded;
  run.securityCaseId = new ObjectID(CASE_ID);
  run.securityCase = {
    caseNumberWithPrefix: "CASE-140",
    title: "CrowdStrike: credential dumping on fin-ws-112",
  } as unknown as NonNullable<SecurityPlaybookRun["securityCase"]>;
  run.steps = [
    {
      id: "note",
      action: SecurityPlaybookActionType.AddCaseNote,
      config: { note: "Done." },
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ] as unknown as JSONArray;
  run.stepResults = [
    {
      stepId: "note",
      status: SecurityPlaybookStepStatus.Succeeded,
      message: "Added the note.",
    },
  ] as unknown as JSONArray;
  run.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  run.startedAt = run.createdAt;
  return run;
}

let updateFails: boolean = false;

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityPlaybookViewPage
          pageRoute={new Route("/dashboard/security-events/playbooks/view")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function field(title: string): CapturedDetailField | undefined {
  return capturedDetailFields.find(
    (candidate: CapturedDetailField): boolean => {
      return candidate.title === title;
    },
  );
}

beforeEach(() => {
  capturedDetailFields = [];
  capturedRulesSubmit = null;
  updateFails = false;

  goTo(
    RouteUtil.getRouteString(PageMap.SECURITY_PLAYBOOK_VIEW)
      .replace(":projectId", PROJECT_ID)
      .replace(":id", PLAYBOOK_ID),
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(PLAYBOOK_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Realtime, "listenToModelEvent")
    .mockImplementation((): (() => void) => {
      return (): void => {
        // Nothing pushes changes here.
      };
    });
  stubDashboardSecurityCaseValues();

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return playbook();
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    modelType: { new (): BaseModel };
  }) => {
    const data: Array<BaseModel> =
      new options.modelType() instanceof SecurityPlaybookRun
        ? [finishedRun()]
        : [];

    return { data, count: data.length, skip: 0, limit: 10 };
  }) as never);
  jest.spyOn(ModelAPI, "updateById").mockImplementation((async () => {
    if (updateFails) {
      throw new HTTPErrorResponse(
        403,
        { message: "You do not have permission to update Security Playbook." },
        {},
      );
    }

    return {};
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a playbook's page", () => {
  test("names the playbook in its trail and its browser tab, not View Playbook", async () => {
    await renderPage();

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: /breadcrumb/i,
    });

    expect(trail).toHaveTextContent(NAME);
    expect(trail).not.toHaveTextContent("View Playbook");
    expect(document.title).toContain(NAME);
    expect(document.title).not.toContain("View Playbook");
  });

  test("its settings leave the name to the title, and read the trigger, the source and the last run in words", async () => {
    await renderPage();

    expect(
      capturedDetailFields.map((candidate: CapturedDetailField): string => {
        return candidate.title;
      }),
    ).toEqual([
      "Status",
      "Trigger",
      "For Cases At Least",
      "Only For Detections From",
      "Runs So Far",
      "Last Run",
      "Description",
    ]);
    expect(field("Description")?.colSpan).toBe(3);

    const { container: trigger } = render(
      field("Trigger")!.getElement!(playbook()),
    );
    expect(trigger).toHaveTextContent("Case Opened");

    const { container: source } = render(
      field("Only For Detections From")!.getElement!(playbook()),
    );
    expect(source).toHaveTextContent("Detection Rule");

    const anySource: SecurityPlaybook = playbook();
    delete (anySource as { detectionSource?: unknown }).detectionSource;
    const { container: none } = render(
      field("Only For Detections From")!.getElement!(anySource),
    );
    expect(none).toHaveTextContent("Any source");

    const { container: lastRun } = render(
      field("Last Run")!.getElement!(playbook()),
    );
    expect(lastRun).toHaveTextContent("40 minutes ago");

    const neverRan: SecurityPlaybook = playbook();
    delete (neverRan as { lastRunAt?: unknown }).lastRunAt;
    const { container: never } = render(
      field("Last Run")!.getElement!(neverRan),
    );
    expect(never).toHaveTextContent("Never");
  });

  test("a rules filter that cannot be saved says so in its card, and the page stays", async () => {
    await renderPage();

    await act(async () => {
      screen
        .getAllByRole("button", { name: "Edit" })
        .find((button: HTMLElement): boolean => {
          return Boolean(
            button
              .closest('[data-testid="card"]')
              ?.textContent?.includes("Only For These Detection Rules"),
          );
        })!
        .click();
    });

    expect(capturedRulesSubmit).not.toBeNull();
    updateFails = true;

    await act(async () => {
      await capturedRulesSubmit!({ detectionRuleIds: [] });
    });

    const rulesCard: HTMLElement = screen
      .getByText("Only For These Detection Rules")
      .closest('[data-testid="card"]') as HTMLElement;

    expect(rulesCard).toHaveTextContent(
      "You do not have permission to update Security Playbook.",
    );
    // The page is still the playbook's: its steps and its runs.
    expect(screen.getByTestId("security-playbook-steps")).toBeInTheDocument();
    expect(screen.getByText("Latest Runs")).toBeInTheDocument();
  });

  test("its latest runs fold to a line each, the case named by its number and title", async () => {
    await renderPage();

    const runCard: HTMLElement = await screen.findByTestId(
      "security-playbook-run-card",
    );

    expect(
      within(runCard).getByTestId("security-playbook-run-steps-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(runCard).not.toHaveTextContent("Added the note.");
    expect(
      within(runCard).getByRole("link", {
        name: "CASE-140 CrowdStrike: credential dumping on fin-ws-112",
      }),
    ).toBeInTheDocument();
  });
});
