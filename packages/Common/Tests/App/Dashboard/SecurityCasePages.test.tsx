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
import { ReactElement } from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Each page of a security case, below its layout: what it draws of the case
 * the layout hands it, and what it hands the cards it is made of. The
 * Overview leads with the case's figures, OneUptime AI's read and the
 * ATT&CK tactics; each other page is one part of the case on a page of its
 * own - the Timeline, the Detections, the Entities, the Playbook Runs, the
 * Private Notes, the Audit Logs and Delete Case. The cards themselves are
 * tested on their own; here they are stubs that say what they were given.
 */

let permissionsForTest: Array<string> = ["ProjectOwner"];
const received: Record<string, Array<Record<string, unknown>>> = {};
let feedMounts: number = 0;

function record(name: string, props: Record<string, unknown>): void {
  (received[name] ||= []).push(props);
}

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseAiCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("SecurityCaseAiCard", props);
        return React.createElement("div", { "data-testid": "ai-card" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFeed",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        ReactModule.useEffect(() => {
          feedMounts++;
        }, []);
        record("SecurityCaseFeed", props);
        return ReactModule.createElement("div", { "data-testid": "feed" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseDetections",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("SecurityCaseDetections", props);
        return React.createElement("div", { "data-testid": "detections" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseEntitiesCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("SecurityCaseEntitiesCard", props);
        return React.createElement("div", { "data-testid": "entities" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityCasePlaybookRuns",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("SecurityCasePlaybookRuns", props);
        return React.createElement("div", { "data-testid": "runs" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("EventNotes", props);
        return React.createElement("div", { "data-testid": "notes" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTable",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        record("AuditLogsTable", props);
        return React.createElement("div", { "data-testid": "audit-logs" });
      },
    };
  },
);

import SecurityCaseOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Index";
import SecurityCaseTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Timeline";
import SecurityCaseDetectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Detections";
import SecurityCaseEntitiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Entities";
import SecurityCasePlaybookRunsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/PlaybookRuns";
import SecurityCaseNotesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Notes";
import SecurityCaseAuditLogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/AuditLogs";
import SecurityCaseDeletePage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Delete";
import SecurityCaseViewContext from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/SecurityCaseViewContext";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const PLAYBOOK_ID: string = "24000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PROJECT: Project = new Project();
PROJECT._id = "10000000-0000-4000-8000-000000000001";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/"),
  currentProject: PROJECT,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

function buildCase(fields: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.caseNumberWithPrefix = "CASE-142";
  securityCase.title = "Password spray against Okta from 203.0.113.47";
  securityCase.securityCaseStatusId = testStatusId(
    SecurityCaseStage.Acknowledged,
  );
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  securityCase.detectionCount = 3;
  securityCase.createdAt = new Date("2026-10-14T08:48:00.000Z");
  securityCase.firstDetectedAt = new Date("2026-10-14T08:48:00.000Z");
  securityCase.acknowledgedAt = new Date("2026-10-14T09:02:00.000Z");
  securityCase.mitreTactics = ["TA0006"];
  securityCase.mitreTechniques = ["T1110.003"];
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "203.0.113.47" },
    { type: SecurityEntityType.User, value: "k.morgan@acme-commerce.example" },
  ] as never;
  Object.assign(securityCase, fields);
  return securityCase;
}

interface ContextHandlers {
  refresh: MockFunction;
  updateCase: MockFunction;
  runPlaybook: MockFunction;
  requestDelete: MockFunction;
}

let handlers: ContextHandlers;

function contextFor(
  securityCase: SecurityCase,
  fields: Partial<SecurityCaseViewContext> = {},
): SecurityCaseViewContext {
  return {
    caseId: new ObjectID(CASE_ID),
    securityCase: securityCase,
    values: {
      priorities: buildDefaultTestPriorities(),
      statuses: buildDefaultTestStatuses(),
    },
    refreshToggle: "first",
    isWorking: false,
    refresh: handlers.refresh as unknown as () => void,
    updateCase:
      handlers.updateCase as unknown as SecurityCaseViewContext["updateCase"],
    runPlaybook:
      handlers.runPlaybook as unknown as SecurityCaseViewContext["runPlaybook"],
    requestDelete: handlers.requestDelete as unknown as () => void,
    ...fields,
  };
}

// The page, below an outlet that hands it the case as the layout does.
function Page(props: {
  page: ReactElement;
  context: SecurityCaseViewContext;
}): ReactElement {
  return (
    <MemoryRouter>
      <Routes>
        <RouterRoute element={<Outlet context={props.context} />}>
          <RouterRoute path="*" element={props.page} />
        </RouterRoute>
      </Routes>
    </MemoryRouter>
  );
}

function drawPage(
  page: ReactElement,
  context: SecurityCaseViewContext,
): ReturnType<typeof render> {
  return render(<Page page={page} context={context} />);
}

function lastProps(name: string): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = received[name] || [];

  expect({ name, drawn: calls.length > 0 }).toEqual({ name, drawn: true });

  return calls[calls.length - 1]!;
}

beforeEach(() => {
  permissionsForTest = ["ProjectOwner"];
  for (const name of Object.keys(received)) {
    delete received[name];
  }
  feedMounts = 0;
  handlers = {
    refresh: getJestMockFunction(),
    updateCase: getJestMockFunction(),
    runPlaybook: getJestMockFunction(),
    requestDelete: getJestMockFunction(),
  };
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Overview", () => {
  test("leads with the case's figures: its detections, and how long it has been open, to acknowledge and to contain", () => {
    drawPage(
      <SecurityCaseOverviewPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    const figures: HTMLElement = screen.getByRole("group", {
      name: "Case figures",
    });

    expect(within(figures).getByText("Detections")).toBeInTheDocument();
    expect(within(figures).getByText("3")).toBeInTheDocument();
    expect(within(figures).getByText("Open For")).toBeInTheDocument();
    expect(within(figures).getByText("3 h 12 min")).toBeInTheDocument();
    expect(
      within(figures).getByText("Time to Acknowledge"),
    ).toBeInTheDocument();
    expect(within(figures).getByText("14 min")).toBeInTheDocument();
    expect(within(figures).getByText("Time to Contain")).toBeInTheDocument();
    expect(within(figures).getByText("—")).toBeInTheDocument();
  });

  test("a closed case says how long it took, to the moment it closed", () => {
    drawPage(
      <SecurityCaseOverviewPage {...PAGE_PROPS} />,
      contextFor(
        buildCase({
          securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
          containedAt: new Date("2026-10-14T09:30:00.000Z"),
          closedAt: new Date("2026-10-14T10:48:00.000Z"),
        }),
      ),
    );

    const figures: HTMLElement = screen.getByRole("group", {
      name: "Case figures",
    });

    expect(within(figures).getByText("Took")).toBeInTheDocument();
    expect(within(figures).queryByText("Open For")).toBeNull();
    expect(within(figures).getByText("2 h")).toBeInTheDocument();
    expect(within(figures).getByText("42 min")).toBeInTheDocument();
  });

  test("hands OneUptime AI's card the case and the project's priorities, and its moves to the layout", async () => {
    const context: SecurityCaseViewContext = contextFor(buildCase(), {
      refreshToggle: "after-a-run",
      isWorking: true,
    });

    drawPage(<SecurityCaseOverviewPage {...PAGE_PROPS} />, context);

    const props: Record<string, unknown> = lastProps("SecurityCaseAiCard");

    expect(props["securityCase"]).toBe(context.securityCase);
    expect(props["priorities"]).toBe(context.values.priorities);
    expect(props["refreshToggle"]).toBe("after-a-run");
    expect(props["isWorking"]).toBe(true);

    // A triage that finished reads the case again.
    (props["onTriaged"] as () => void)();
    expect(handlers.refresh).toHaveBeenCalledTimes(1);

    // Set priority saves the priority it suggests.
    const high: SecurityCasePriority = buildDefaultTestPriorities()[1]!;

    (props["onSetPriority"] as (priority: SecurityCasePriority) => void)(high);
    expect(handlers.updateCase).toHaveBeenCalledWith({
      securityCasePriorityId: high.id!.toString(),
    });

    // Run playbook opens the run dialog on the playbook it suggests.
    (props["onRunPlaybook"] as (playbookId: ObjectID) => void)(
      new ObjectID(PLAYBOOK_ID),
    );
    expect(handlers.runPlaybook).toHaveBeenCalledTimes(1);
    expect(
      (handlers.runPlaybook.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(PLAYBOOK_ID);
  });

  test("says which ATT&CK tactics and techniques the case's detections map to, each linked to its page", () => {
    drawPage(
      <SecurityCaseOverviewPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    expect(screen.getByText("MITRE ATT&CK")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "TA0006 Credential Access" }),
    ).toHaveAttribute("href", expect.stringContaining("attack.mitre.org"));
    expect(
      screen.getByRole("link", { name: "T1110.003 Brute Force" }),
    ).toHaveAttribute("href", "https://attack.mitre.org/techniques/T1110/003/");
  });

  test("a case none of whose detections is mapped says so", () => {
    drawPage(
      <SecurityCaseOverviewPage {...PAGE_PROPS} />,
      contextFor(buildCase({ mitreTactics: [], mitreTechniques: [] })),
    );

    expect(
      screen.getByText("None of this case's detections is mapped to ATT&CK."),
    ).toBeInTheDocument();
  });

  test("draws its parts in order: the figures, then OneUptime AI's read, then ATT&CK", () => {
    const { container } = drawPage(
      <SecurityCaseOverviewPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    const text: string = container.textContent || "";
    const order: Array<number> = [
      text.indexOf("Detections"),
      text.indexOf("MITRE ATT&CK"),
    ];

    expect(order[0]).toBeLessThan(order[1]!);
    expect(
      screen
        .getByTestId("ai-card")
        .compareDocumentPosition(screen.getByText("MITRE ATT&CK")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("each other page of a case", () => {
  test("the Timeline is the case's feed, drawn afresh whenever the case changes", () => {
    const view: ReturnType<typeof render> = drawPage(
      <SecurityCaseTimelinePage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    expect(
      (lastProps("SecurityCaseFeed")["securityCaseId"] as ObjectID).toString(),
    ).toBe(CASE_ID);
    expect(feedMounts).toBe(1);

    view.rerender(
      <Page
        page={<SecurityCaseTimelinePage {...PAGE_PROPS} />}
        context={contextFor(buildCase(), { refreshToggle: "second" })}
      />,
    );

    expect(feedMounts).toBe(2);
  });

  test("the Detections page is the case's detections, read again whenever the case changes", () => {
    drawPage(
      <SecurityCaseDetectionsPage {...PAGE_PROPS} />,
      contextFor(buildCase(), { refreshToggle: "bumped" }),
    );

    const props: Record<string, unknown> = lastProps("SecurityCaseDetections");

    expect((props["securityCaseId"] as ObjectID).toString()).toBe(CASE_ID);
    expect(props["refreshToggle"]).toBe("bumped");
  });

  test("the Entities page is who and what the case is about, as the case names them", () => {
    drawPage(
      <SecurityCaseEntitiesPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    expect(lastProps("SecurityCaseEntitiesCard")["entities"]).toEqual([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.47" },
      {
        type: SecurityEntityType.User,
        value: "k.morgan@acme-commerce.example",
      },
    ]);
  });

  test("the Entities page of a case that names nobody hands the card none", () => {
    drawPage(
      <SecurityCaseEntitiesPage {...PAGE_PROPS} />,
      contextFor(buildCase({ entities: undefined })),
    );

    expect(lastProps("SecurityCaseEntitiesCard")["entities"]).toEqual([]);
  });

  test("the Playbook Runs page is the case's runs; a decision reads the case again, and Run Playbook is the header's", () => {
    drawPage(
      <SecurityCasePlaybookRunsPage {...PAGE_PROPS} />,
      contextFor(buildCase(), { refreshToggle: "bumped" }),
    );

    const props: Record<string, unknown> = lastProps(
      "SecurityCasePlaybookRuns",
    );

    expect((props["securityCaseId"] as ObjectID).toString()).toBe(CASE_ID);
    expect(props["refreshToggle"]).toBe("bumped");
    // No second Run Playbook under the header's.
    expect(props["onRunPlaybook"]).toBeUndefined();

    (props["onRunsChanged"] as () => void)();
    expect(handlers.refresh).toHaveBeenCalledTimes(1);
  });

  test("the Private Notes page is the case's notes, private to the team", () => {
    drawPage(
      <SecurityCaseNotesPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    const props: Record<string, unknown> = lastProps("EventNotes");

    expect(props["modelType"]).toBe(SecurityCaseNote);
    expect(props["visibility"]).toBe("private");
    expect(props["parentIdField"]).toBe("securityCaseId");
    expect((props["parentId"] as ObjectID).toString()).toBe(CASE_ID);
    expect(props["currentProject"]).toBe(PROJECT);
  });

  test("the Audit Logs page lists every change made to the case", () => {
    drawPage(
      <SecurityCaseAuditLogsPage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    const props: Record<string, unknown> = lastProps("AuditLogsTable");

    expect(props["resourceType"]).toBe(new SecurityCase().singularName);
    expect(props["resourceType"]).toBe("Security Case");
    expect((props["resourceId"] as ObjectID).toString()).toBe(CASE_ID);
    expect(props["title"]).toBe("Case Audit Logs");
  });
});

describe("Delete Case", () => {
  test("says what goes with the case, and that closing it keeps the record; its button asks first", async () => {
    drawPage(
      <SecurityCaseDeletePage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    expect(
      screen.getByRole("heading", { name: "Delete Case" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "CASE-142 Password spray against Okta from 203.0.113.47 and its detections, notes and timeline are deleted for good. To keep the record, close it with a verdict instead.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Case" }));
    });

    // It asks the layout's question; nothing is deleted from the page itself.
    expect(handlers.requestDelete).toHaveBeenCalledTimes(1);
  });

  test("a Security Member may work the case, not delete it: the button is locked, and says why", async () => {
    permissionsForTest = ["SecurityMember"];
    drawPage(
      <SecurityCaseDeletePage {...PAGE_PROPS} />,
      contextFor(buildCase()),
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Delete Case",
    });

    expect(button).toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(handlers.requestDelete).not.toHaveBeenCalled();
  });

  test("while a change is being saved, it waits", () => {
    drawPage(
      <SecurityCaseDeletePage {...PAGE_PROPS} />,
      contextFor(buildCase(), { isWorking: true }),
    );

    expect(screen.getByRole("button", { name: "Delete Case" })).toBeDisabled();
  });
});
