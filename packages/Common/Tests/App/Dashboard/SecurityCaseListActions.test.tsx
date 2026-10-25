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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * WORKING CASES FROM THEIR LISTS - "I dont see the button to assign to me,
 * change priority, change status here for cases. Can you please build it
 * as well. Please also have a button to assign it to someone else as well
 * (also in bulk actions)." (the maintainer)
 *
 * The real case pages (Pages/SecurityEvents/Cases) draw the real table
 * here, and every row's ⋯ and Bulk Actions are driven as a person drives
 * them. Pinned: which moves each case's ⋯ offers, in order, Delete last;
 * what each saves, one case at a time, and that the list - and the side
 * menu's counts - are read again at once; Bulk Actions' moves and what its
 * result says of each case changed, left alone or refused; and a reader
 * who may not change cases seeing every move locked, saying why.
 *
 * The dialogs the moves open are their own components, drawn for real in
 * SecurityCaseChangeModals.test.tsx: here they are stubs that say which
 * cases they were opened on, and hand a pick back as a person would.
 */

configure({ asyncUtilTimeout: 15000 });
jest.setTimeout(120000);

const ME: string = "80000000-0000-4000-8000-000000000001";
const DIEGO: string = "80000000-0000-4000-8000-000000000002";
const SOC_TEAM: string = "81000000-0000-4000-8000-000000000001";

let permissionsForTest: Array<string> = ["ProjectOwner"];

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
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  const ObjectIDType: typeof import("../../../Types/ObjectID").default = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof import("../../../Types/ObjectID").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): unknown => {
        return new ObjectIDType("80000000-0000-4000-8000-000000000001");
      },
      getName: (): string => {
        return "Maya Chen";
      },
      getEmail: (): string => {
        return "maya@acme-commerce.example";
      },
    },
  };
});

/*
 * The dialogs: which cases each was opened on, and buttons that hand a pick
 * back - the way the real dialogs do once a person picks and submits. A
 * pick the save refuses is said in the stub, as the real dialog says it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChangeModals",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    type Pick = { label: string; value: unknown };

    const stub: (
      testId: string,
      getPicks: (props: Record<string, unknown>) => Array<Pick>,
    ) => (props: Record<string, unknown>) => React.ReactElement = (
      testId: string,
      getPicks: (props: Record<string, unknown>) => Array<Pick>,
    ) => {
      return (props: Record<string, unknown>): React.ReactElement => {
        const [error, setError] = ReactModule.useState<string>("");
        const cases: Array<{ caseNumberWithPrefix?: string }> = props[
          "securityCases"
        ] as Array<{ caseNumberWithPrefix?: string }>;

        return ReactModule.createElement(
          "div",
          {
            "data-testid": testId,
            "data-cases": cases
              .map((item: { caseNumberWithPrefix?: string }): string => {
                return item.caseNumberWithPrefix || "";
              })
              .join(","),
            "data-error": error,
          },
          ...getPicks(props).map((pick: Pick): React.ReactElement => {
            return ReactModule.createElement(
              "button",
              {
                key: pick.label,
                type: "button",
                onClick: async (): Promise<void> => {
                  try {
                    await (
                      props["onSubmit"] as (value: unknown) => Promise<void>
                    )(pick.value);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                },
              },
              pick.label,
            );
          }),
          ReactModule.createElement(
            "button",
            {
              key: "cancel",
              type: "button",
              onClick: props["onClose"] as () => void,
            },
            `${testId}-cancel`,
          ),
        );
      };
    };

    const valuesOf: (
      props: Record<string, unknown>,
      list: "statuses" | "priorities",
    ) => Array<{ _id?: string; name?: string }> = (
      props: Record<string, unknown>,
      list: "statuses" | "priorities",
    ) => {
      return (
        props["values"] as Record<
          string,
          Array<{ _id?: string; name?: string }>
        >
      )[list]!;
    };

    return {
      __esModule: true,
      AssignSecurityCaseModal: stub("assign-dialog", () => {
        return [
          {
            label: "pick-diego",
            value: { userId: "80000000-0000-4000-8000-000000000002" },
          },
          {
            label: "pick-me",
            value: { userId: "80000000-0000-4000-8000-000000000001" },
          },
          {
            label: "pick-soc-team",
            value: { teamId: "81000000-0000-4000-8000-000000000001" },
          },
        ];
      }),
      ChangeSecurityCaseStatusModal: stub(
        "status-dialog",
        (props: Record<string, unknown>) => {
          return valuesOf(props, "statuses").map(
            (status: { _id?: string; name?: string }): Pick => {
              return {
                label: `status-${status.name}`,
                value: {
                  statusId: status._id,
                  verdict: "False Positive",
                  closingNote: "Our own scanner.",
                },
              };
            },
          );
        },
      ),
      ChangeSecurityCasePriorityModal: stub(
        "priority-dialog",
        (props: Record<string, unknown>) => {
          return valuesOf(props, "priorities").map(
            (priority: { _id?: string; name?: string }): Pick => {
              return {
                label: `priority-${priority.name}`,
                value: priority._id,
              };
            },
          );
        },
      ),
    };
  },
);

import SecurityCasesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Cases";
import { SecurityCaseQueueViewKey } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import API from "../../../UI/Utils/API/API";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/security-events/cases`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const REFUSAL: string =
  "You do not have permission to update this Security Case. Your role reaches only cases labelled for your team.";

function caseId(number: number): string {
  return `20000000-0000-4000-8000-000000000${number}`;
}

function buildCase(
  number: number,
  fields: {
    stage?: SecurityCaseStage;
    priority?: SecurityCasePriorityLevel;
    userId?: string;
    teamId?: string;
    verdict?: SecurityCaseVerdict;
  } = {},
): SecurityCase {
  const row: SecurityCase = new SecurityCase();
  row._id = caseId(number);
  row.caseNumberWithPrefix = `CASE-${number}`;
  row.title = `Case ${number} to work`;
  row.securityCaseStatusId = testStatusId(
    fields.stage || SecurityCaseStage.New,
  );
  row.securityCasePriorityId = testPriorityId(
    fields.priority || SecurityCasePriorityLevel.High,
  );
  row.detectionCount = 1;
  row.entities = [];
  row.lastDetectedAt = new Date(Date.now() - number * 60 * 1000);

  if (fields.userId) {
    row.assignedToUserId = new ObjectID(fields.userId);
  }

  if (fields.teamId) {
    const team: Team = new Team();
    team._id = fields.teamId;
    team.name = "SOC Tier 2";
    row.assignedToTeam = team;
    row.assignedToTeamId = new ObjectID(fields.teamId);
  }

  if (fields.verdict) {
    row.verdict = fields.verdict;
  }

  return row;
}

let listedRows: Array<SecurityCase> = [];
let caseListReads: number = 0;
let refusedIds: Array<string> = [];
const updates: Array<{ id: string; data: JSONObject }> = [];

async function openList(view: SecurityCaseQueueViewKey): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityCasesPage {...PAGE_PROPS} view={view} />
      </MemoryRouter>,
    );
  });

  await screen.findAllByTestId("row-actions");
}

function rowOf(caseNumber: string): HTMLElement {
  const row: HTMLElement | undefined = Array.from(
    document.querySelectorAll("tbody tr"),
  ).find((candidate: Element): boolean => {
    return (candidate.textContent || "").includes(caseNumber);
  }) as HTMLElement | undefined;

  if (!row) {
    throw new Error(`No row for ${caseNumber}.`);
  }

  return row;
}

async function openRowMenu(caseNumber: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(
      within(rowOf(caseNumber)).getByTestId("row-actions-more-button"),
    );
  });

  return screen.getByRole("menu");
}

function itemTitles(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function clickMenuItem(menu: HTMLElement, title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: title }));
  });
}

async function select(...caseNumbers: Array<string>): Promise<void> {
  for (const caseNumber of caseNumbers) {
    await act(async () => {
      fireEvent.click(within(rowOf(caseNumber)).getByRole("checkbox"));
    });
  }
}

async function openBulkActions(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByText("Bulk Actions"));
  });

  return screen.getByRole("menu");
}

async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
}

beforeEach(() => {
  permissionsForTest = ["ProjectOwner"];
  listedRows = [];
  caseListReads = 0;
  refusedIds = [];
  updates.length = 0;
  goTo(`/dashboard/${PROJECT_ID}/security-events/cases`);
  window.localStorage.clear();
  stubDashboardSecurityCaseValues();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const isCases: boolean = options.modelType === SecurityCase;

        if (isCases) {
          caseListReads++;
        }

        const data: Array<BaseModel> = isCases ? [...listedRows] : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (data: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<unknown> => {
    if (refusedIds.includes(data.id.toString())) {
      throw new Error(REFUSAL);
    }

    updates.push({ id: data.id.toString(), data: data.data });
    return null;
  }) as never);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a case's row ⋯", () => {
  test("offers the moves its case takes, beside View, Delete kept last", async () => {
    listedRows = [
      buildCase(141),
      buildCase(142, { userId: ME, stage: SecurityCaseStage.Acknowledged }),
      buildCase(138, { teamId: SOC_TEAM }),
    ];
    await openList("open");

    // Nobody's case: every move.
    expect(itemTitles(await openRowMenu("CASE-141"))).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]);

    // The reader's own: no Assign to Me, and the rest.
    expect(itemTitles(await openRowMenu("CASE-142"))).toEqual([
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]);

    // In a team's queue, nobody on it: the reader may take it.
    expect(itemTitles(await openRowMenu("CASE-138"))).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]);

    // The row's one button stays View.
    expect(
      within(rowOf("CASE-141")).getByRole("button", { name: "View" }),
    ).toBeInTheDocument();
  });

  test("a closed case is not assigned: its ⋯ moves its status (to reopen it), its priority, or deletes it", async () => {
    listedRows = [
      buildCase(136, {
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
        userId: DIEGO,
      }),
    ];
    await openList("all");

    expect(itemTitles(await openRowMenu("CASE-136"))).toEqual([
      "Change Status",
      "Change Priority",
      "Delete",
    ]);
  });

  test("Assign to Me saves the reader as the case's person, and the list and the side menu's counts are read again", async () => {
    listedRows = [buildCase(141)];
    const dispatched: Array<string> = [];
    jest
      .spyOn(GlobalEvents, "dispatchEvent")
      .mockImplementation((name: string): void => {
        dispatched.push(name);
      });
    await openList("unassigned");
    const readsBefore: number = caseListReads;

    await clickMenuItem(await openRowMenu("CASE-141"), "Assign to Me");

    await waitFor(() => {
      expect(updates).toEqual([
        { id: caseId(141), data: { assignedToUserId: ME } },
      ]);
    });
    await waitFor(() => {
      expect(caseListReads).toBeGreaterThan(readsBefore);
    });
    expect(dispatched).toContain(REFRESH_SIDEBAR_COUNT_EVENT);
  });

  test("two changes in the same moment are both read back: the list counts its reads, it never stamps them with the time", async () => {
    listedRows = [buildCase(141), buildCase(138)];
    // The clock stands still, as two saves in one millisecond see it.
    jest.spyOn(Date, "now").mockReturnValue(1791979200000);
    await openList("open");

    const readsBefore: number = caseListReads;

    await clickMenuItem(await openRowMenu("CASE-141"), "Assign to Me");
    await waitFor(() => {
      expect(caseListReads).toBe(readsBefore + 1);
    });

    await clickMenuItem(await openRowMenu("CASE-138"), "Assign to Me");
    await waitFor(() => {
      expect(caseListReads).toBe(readsBefore + 2);
    });
    expect(updates).toHaveLength(2);
  });

  test("Assign to Me that the server refuses says why", async () => {
    listedRows = [buildCase(141)];
    refusedIds = [caseId(141)];
    await openList("open");

    await clickMenuItem(await openRowMenu("CASE-141"), "Assign to Me");

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(updates).toEqual([]);
  });

  test("Assign to Someone Else opens its dialog on that case: a person picked works it, a team picked takes it into its queue", async () => {
    listedRows = [buildCase(141), buildCase(142, { userId: ME })];
    await openList("open");

    await clickMenuItem(
      await openRowMenu("CASE-141"),
      "Assign to Someone Else",
    );

    expect(screen.getByTestId("assign-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-141",
    );

    await press("pick-diego");

    await waitFor(() => {
      expect(screen.queryByTestId("assign-dialog")).toBeNull();
    });
    expect(updates).toEqual([
      { id: caseId(141), data: { assignedToUserId: DIEGO } },
    ]);

    await clickMenuItem(
      await openRowMenu("CASE-142"),
      "Assign to Someone Else",
    );
    await press("pick-soc-team");

    await waitFor(() => {
      expect(updates).toHaveLength(2);
    });
    expect(updates[1]).toEqual({
      id: caseId(142),
      data: { assignedToTeamId: SOC_TEAM, assignedToUserId: null },
    });
  });

  test("a pick that leaves the case as it is saves nothing and closes the dialog", async () => {
    listedRows = [buildCase(142, { userId: DIEGO })];
    await openList("open");

    await clickMenuItem(
      await openRowMenu("CASE-142"),
      "Assign to Someone Else",
    );
    await press("pick-diego");

    await waitFor(() => {
      expect(screen.queryByTestId("assign-dialog")).toBeNull();
    });
    expect(updates).toEqual([]);
  });

  test("a row's save the server refuses stays in its dialog, saying why", async () => {
    listedRows = [buildCase(141)];
    refusedIds = [caseId(141)];
    await openList("open");

    await clickMenuItem(await openRowMenu("CASE-141"), "Change Priority");
    await press("priority-Critical");

    await waitFor(() => {
      expect(screen.getByTestId("priority-dialog")).toHaveAttribute(
        "data-error",
        REFUSAL,
      );
    });
  });

  test("Change Status opens on that case; closing it saves the verdict and the closing note with the status", async () => {
    listedRows = [buildCase(141)];
    await openList("open");

    await clickMenuItem(await openRowMenu("CASE-141"), "Change Status");

    expect(screen.getByTestId("status-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-141",
    );

    await press("status-Closed");

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: caseId(141),
          data: {
            securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
            verdict: SecurityCaseVerdict.FalsePositive,
            closingNote: "Our own scanner.",
          },
        },
      ]);
    });
  });

  test("Change Status between open statuses saves the status alone", async () => {
    listedRows = [buildCase(141)];
    await openList("open");

    await clickMenuItem(await openRowMenu("CASE-141"), "Change Status");
    await press("status-Contained");

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: caseId(141),
          data: {
            securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Contained],
          },
        },
      ]);
    });
  });

  test("Change Priority opens on that case and saves the priority", async () => {
    listedRows = [buildCase(141)];
    await openList("open");

    await clickMenuItem(await openRowMenu("CASE-141"), "Change Priority");

    expect(screen.getByTestId("priority-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-141",
    );

    await press("priority-Critical");

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: caseId(141),
          data: {
            securityCasePriorityId:
              TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
          },
        },
      ]);
    });
  });
});

describe("Bulk Actions", () => {
  test("offer every move for the cases selected, Delete last", async () => {
    listedRows = [buildCase(141), buildCase(138)];
    await openList("open");

    await select("CASE-141", "CASE-138");

    const menu: HTMLElement = await openBulkActions();
    const titles: Array<string> = itemTitles(menu);

    expect(titles.slice(0, 4)).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]);
    expect(titles[titles.length - 1]).toBe("Delete");
  });

  test("Assign to Someone Else: one dialog for the cases selected, each saved in turn; the result counts the cases assigned and names each refused or left alone, with why", async () => {
    listedRows = [
      buildCase(141),
      buildCase(142, { userId: ME }),
      buildCase(138, { teamId: SOC_TEAM }),
      buildCase(140, { userId: DIEGO }),
    ];
    refusedIds = [caseId(138)];
    await openList("open");
    const readsBefore: number = caseListReads;

    await select("CASE-141", "CASE-142", "CASE-138", "CASE-140");
    await clickMenuItem(await openBulkActions(), "Assign to Someone Else");

    expect(screen.getByTestId("assign-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-141,CASE-142,CASE-138,CASE-140",
    );

    await press("pick-diego");

    const result: HTMLElement = await screen.findByTestId(
      "bulk-action-succeeded-count",
    );

    expect(result).toHaveTextContent("2 Security Cases assigned");
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Security Case not assigned",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      "CASE-138",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      REFUSAL,
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "CASE-140",
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "Assigned to them already.",
    );
    // One at a time, as the cases were selected; the dialog gave way to the run.
    expect(updates).toEqual([
      { id: caseId(141), data: { assignedToUserId: DIEGO } },
      { id: caseId(142), data: { assignedToUserId: DIEGO } },
    ]);
    expect(screen.queryByTestId("assign-dialog")).toBeNull();
    await waitFor(() => {
      expect(caseListReads).toBeGreaterThan(readsBefore);
    });
  });

  test("Assign to Me on All Cases leaves the reader's own and the closed ones alone, saying why", async () => {
    listedRows = [
      buildCase(141),
      buildCase(142, { userId: ME }),
      buildCase(136, {
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
    ];
    await openList("all");

    await select("CASE-141", "CASE-142", "CASE-136");
    await clickMenuItem(await openBulkActions(), "Assign to Me");

    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("1 Security Case assigned to you");

    const unchanged: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );

    expect(unchanged).toHaveTextContent("CASE-142");
    expect(unchanged).toHaveTextContent("Assigned to you already.");
    expect(unchanged).toHaveTextContent("CASE-136");
    expect(unchanged).toHaveTextContent("Closed. Reopen it to assign it.");
    expect(updates).toEqual([
      { id: caseId(141), data: { assignedToUserId: ME } },
    ]);
  });

  test("Change Status closes the open cases with the verdict, and leaves those there already alone", async () => {
    listedRows = [
      buildCase(141),
      buildCase(137, { stage: SecurityCaseStage.Contained }),
      buildCase(136, {
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
    ];
    await openList("all");

    await select("CASE-141", "CASE-137", "CASE-136");
    await clickMenuItem(await openBulkActions(), "Change Status");

    expect(screen.getByTestId("status-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-141,CASE-137,CASE-136",
    );

    await press("status-Closed");

    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2 Security Cases updated");
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "CASE-136",
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "Already Closed.",
    );
    expect(updates).toEqual(
      [141, 137].map((number: number) => {
        return {
          id: caseId(number),
          data: {
            securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
            verdict: SecurityCaseVerdict.FalsePositive,
            closingNote: "Our own scanner.",
          },
        };
      }),
    );
  });

  test("Change Status to an open status reopens the closed cases selected, never sending a verdict", async () => {
    listedRows = [
      buildCase(136, {
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
      buildCase(135, {
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
    ];
    await openList("closed");

    await select("CASE-136", "CASE-135");
    await clickMenuItem(await openBulkActions(), "Change Status");
    await press("status-Investigating");

    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2 Security Cases updated");
    expect(updates).toEqual(
      [136, 135].map((number: number) => {
        return {
          id: caseId(number),
          data: {
            securityCaseStatusId:
              TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
          },
        };
      }),
    );
  });

  test("Change Priority leaves the cases at it already alone", async () => {
    listedRows = [
      buildCase(141, { priority: SecurityCasePriorityLevel.Low }),
      buildCase(142, { priority: SecurityCasePriorityLevel.Critical }),
    ];
    await openList("open");

    await select("CASE-141", "CASE-142");
    await clickMenuItem(await openBulkActions(), "Change Priority");
    await press("priority-Critical");

    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("1 Security Case updated");
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "Already Critical.",
    );
    expect(updates).toEqual([
      {
        id: caseId(141),
        data: {
          securityCasePriorityId:
            TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
        },
      },
    ]);
  });

  test("Cancel in a dialog runs nothing", async () => {
    listedRows = [buildCase(141), buildCase(138)];
    await openList("open");

    await select("CASE-141", "CASE-138");
    await clickMenuItem(await openBulkActions(), "Change Priority");
    await press("priority-dialog-cancel");

    expect(screen.queryByTestId("priority-dialog")).toBeNull();
    expect(screen.queryByTestId("bulk-action-succeeded-count")).toBeNull();
    expect(updates).toEqual([]);
  });
});

describe("who may work cases", () => {
  test("a Security Viewer sees every move locked in a row's ⋯, each saying what it takes, and pressing one does nothing", async () => {
    permissionsForTest = ["SecurityViewer"];
    listedRows = [buildCase(141)];
    await openList("open");

    const menu: HTMLElement = await openRowMenu("CASE-141");

    for (const title of [
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
      "Delete",
    ]) {
      const item: HTMLElement = within(menu).getByRole("menuitem", {
        name: title,
      });

      expect(item).toHaveAttribute("aria-disabled", "true");
      // The reason is read with the item, as a locked Delete's is.
      expect(item.getAttribute("aria-describedby")).toBeTruthy();
      expect(
        document.getElementById(item.getAttribute("aria-describedby")!),
      ).toHaveTextContent(/permission/i);
    }

    await clickMenuItem(menu, "Assign to Someone Else");

    expect(screen.queryByTestId("assign-dialog")).toBeNull();
    expect(updates).toEqual([]);
  });

  test("a Security Viewer sees the bulk moves locked too", async () => {
    permissionsForTest = ["SecurityViewer"];
    listedRows = [buildCase(141), buildCase(138)];
    await openList("open");

    await select("CASE-141", "CASE-138");

    const menu: HTMLElement = await openBulkActions();

    for (const title of [
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]) {
      expect(
        within(menu).getByRole("menuitem", { name: title }),
      ).toHaveAttribute("aria-disabled", "true");
    }

    await clickMenuItem(menu, "Assign to Me");

    expect(updates).toEqual([]);
    expect(screen.queryByTestId("bulk-action-succeeded-count")).toBeNull();
  });

  test("a Security Member works cases from the list", async () => {
    permissionsForTest = ["SecurityMember"];
    listedRows = [buildCase(141)];
    await openList("open");

    const menu: HTMLElement = await openRowMenu("CASE-141");

    expect(
      within(menu).getByRole("menuitem", { name: "Change Status" }),
    ).toHaveAttribute("aria-disabled", "false");
    // Deleting a case is the Admin tier's.
    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
