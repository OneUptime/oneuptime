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
import { ReactElement } from "react";
import {
  MemoryRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

/*
 * A SECURITY CASE'S LAYOUT, drawn for real around stub pages: "When I open
 * the case, can I have a side menu (on the similar lines that we do for
 * incidents / alerts / scheduled maintenance)" (the maintainer).
 *
 * Pinned here, on every page of a case: the side menu, the trail with the
 * case named by its number, the header in full on the Overview and compact
 * on the others with the same actions, the case read once for all its
 * pages and handed to the page below; what the actions do from any page
 * (Assign to Me, Close Case asking for the verdict first, Run Playbook -
 * also on the playbook OneUptime AI suggested -, Declare Incident, Edit
 * Case, the priority from the ⋯, Assign to Someone Else and Change Status
 * from the ⋯, Delete Case from the ⋯ or its own page);
 * a save that fails; a colleague's change reading the case again; a case
 * that is not there, that the reader may not read, or that cannot be read;
 * and moving from one case to another.
 *
 * The case's dialogs are their own components, tested on their own: here
 * they are stubs that say what they were opened with.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

let permissionsForTest: Array<string> = ["ProjectOwner"];
let realtimeListener: ((modelId: unknown) => void) | null = null;
const realtimeSubscriptions: Array<{ modelId: string }> = [];

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

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: (
        options: { modelId: { toString: () => string } },
        listener: (modelId: unknown) => void,
      ): (() => void) => {
        realtimeSubscriptions.push({ modelId: options.modelId.toString() });
        realtimeListener = listener;
        return () => {
          realtimeListener = null;
        };
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "case-description" },
        props.text,
      );
    },
  };
});

// The case's dialogs: what each was opened with, and a way to finish it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseActionModals",
  () => {
    const ReactModule: typeof import("react") = jest.requireActual(
      "react",
    ) as typeof import("react");

    const stub: (
      testId: string,
    ) => (props: Record<string, unknown>) => React.ReactElement = (
      testId: string,
    ) => {
      return (props: Record<string, unknown>): React.ReactElement => {
        const status: { name?: string } | undefined = props["closeToStatus"] as
          | { name?: string }
          | undefined;

        return ReactModule.createElement(
          "div",
          {
            "data-testid": testId,
            "data-close-to": status?.name || "",
            "data-playbook": props["initialPlaybookId"]
              ? String(props["initialPlaybookId"])
              : "",
          },
          ReactModule.createElement(
            "button",
            {
              type: "button",
              onClick: props["onDone"] as () => void,
            },
            `${testId}-done`,
          ),
          ReactModule.createElement(
            "button",
            {
              type: "button",
              onClick: props["onClose"] as () => void,
            },
            `${testId}-cancel`,
          ),
        );
      };
    };

    return {
      __esModule: true,
      CloseSecurityCaseModal: stub("close-case-dialog"),
      RunSecurityPlaybookModal: stub("run-playbook-dialog"),
      DeclareIncidentFromCaseModal: stub("declare-incident-dialog"),
    };
  },
);

/*
 * Assign to Someone Else and Change Status (SecurityCaseChangeModals, drawn
 * for real in SecurityCaseChangeModals.test.tsx): which cases each was
 * opened on, buttons that hand a pick back as a person would, and the
 * reason a save failed, as the real dialog shows it.
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
        );
      };
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
            label: "pick-soc-team",
            value: { teamId: "81000000-0000-4000-8000-000000000001" },
          },
        ];
      }),
      ChangeSecurityCaseStatusModal: stub(
        "status-dialog",
        (props: Record<string, unknown>) => {
          return (
            props["values"] as {
              statuses: Array<{ _id?: string; name?: string }>;
            }
          ).statuses.map((status: { _id?: string; name?: string }): Pick => {
            return {
              label: `status-${status.name}`,
              value: {
                statusId: status._id,
                verdict: "False Positive",
                closingNote: "Our own scanner.",
              },
            };
          });
        },
      ),
    };
  },
);

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  const ReactModule: typeof import("react") = jest.requireActual(
    "react",
  ) as typeof import("react");

  return {
    __esModule: true,
    default: (props: {
      title: string;
      modelIdToEdit?: { toString: () => string };
      onSuccess: () => void;
    }): React.ReactElement => {
      return ReactModule.createElement(
        "div",
        {
          "data-testid": "edit-case-dialog",
          "data-title": props.title,
          "data-id": props.modelIdToEdit?.toString() || "",
        },
        ReactModule.createElement(
          "button",
          { type: "button", onClick: props.onSuccess },
          "edit-case-dialog-save",
        ),
      );
    },
  };
});

import SecurityCaseViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/Layout";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/SecurityCaseViewContext";
import { SECURITY_CASE_VIEW_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseViewSelect";
import {
  SECURITY_CASE_NOT_FOUND_COPY,
  SecurityCaseNotFoundReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseNotFound";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";
import { testPriorityId, testStatusId } from "../../Helpers/SecurityCaseValues";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";

const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const OTHER_CASE_ID: string = "20000000-0000-4000-8000-000000000141";
const PLAYBOOK_ID: string = "24000000-0000-4000-8000-000000000003";
const ME: string = "80000000-0000-4000-8000-000000000001";
const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PRODUCT),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

// A case's pages other than its Overview, by their address and their stub's name.
const SUB_PAGES: Array<[PageMap, string, string]> = [
  [PageMap.SECURITY_CASE_VIEW_TIMELINE, "timeline", "Timeline"],
  [PageMap.SECURITY_CASE_VIEW_DETECTIONS, "detections", "Detections"],
  [PageMap.SECURITY_CASE_VIEW_ENTITIES, "entities", "Entities"],
  [PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS, "playbook-runs", "Playbook Runs"],
  [PageMap.SECURITY_CASE_VIEW_NOTES, "notes", "Private Notes"],
  [PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS, "audit-logs", "Audit Logs"],
  [PageMap.SECURITY_CASE_VIEW_DELETE, "delete", "Delete Case"],
];

function buildCase(fields: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.caseNumberWithPrefix = "CASE-142";
  securityCase.title = "Password spray against Okta from 203.0.113.47";
  securityCase.description =
    "A burst of failed Okta sign-ins for many accounts from one address.";
  securityCase.securityCaseStatusId = testStatusId(
    SecurityCaseStage.Acknowledged,
  );
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  securityCase.source = SecurityDetectionSource.DetectionRule;
  securityCase.detectionCount = 3;
  securityCase.createdAt = new Date("2026-10-14T08:48:00.000Z");
  securityCase.lastDetectedAt = new Date("2026-10-14T11:51:00.000Z");
  Object.assign(securityCase, fields);
  return securityCase;
}

// What the server holds for each case id, read by getItem.
let cases: Record<string, SecurityCase | null> = {};
let getItemFailures: number = 0;
const getItemCalls: Array<{ id: string; select: unknown }> = [];
const updates: Array<{ id: string; data: JSONObject }> = [];
const deletes: Array<string> = [];
let updateFailure: string = "";

// Where the router is, and what the page below the layout was handed.
const WhereAmI: () => ReactElement = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
};

let navigateTo: ((path: string) => void) | null = null;

const Shell: () => ReactElement = (): ReactElement => {
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  Navigation.setNavigateHook(navigate);
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  navigateTo = (path: string): void => {
    goTo(path);
    navigate(path);
  };

  return <SecurityCaseViewLayout {...PAGE_PROPS} />;
};

let pageMounts: number = 0;
let lastContext: SecurityCaseViewContext | null = null;

const Probe: (props: { page: string }) => ReactElement = (props: {
  page: string;
}): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();
  lastContext = view;

  React.useEffect(() => {
    pageMounts++;
  }, []);

  return (
    <div
      data-testid="case-page"
      data-page={props.page}
      data-case={view.securityCase.caseNumberWithPrefix || ""}
      data-case-id={view.caseId.toString()}
      data-refresh={view.refreshToggle}
    >
      <button
        type="button"
        onClick={() => {
          view.runPlaybook(new ObjectID(PLAYBOOK_ID));
        }}
      >
        probe-run-suggested
      </button>
      <button
        type="button"
        onClick={() => {
          view.requestDelete();
        }}
      >
        probe-delete
      </button>
    </div>
  );
};

async function open(path: string): Promise<void> {
  goTo(path);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <RouterRoute
            path={(RouteMap[PageMap.SECURITY_CASE_VIEW] as Route).toString()}
            element={<Shell />}
          >
            <RouterRoute index element={<Probe page="Overview" />} />
            {SUB_PAGES.map(
              ([key, , title]: [PageMap, string, string]): ReactElement => {
                return (
                  <RouterRoute
                    key={key}
                    path={RouteUtil.getLastPathForKey(key)}
                    element={<Probe page={title} />}
                  />
                );
              },
            )}
          </RouterRoute>
          <RouterRoute path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <WhereAmI />
      </MemoryRouter>,
    );
  });
}

async function openCase(segment: string = ""): Promise<void> {
  await open(
    segment
      ? `${PRODUCT}/cases/${CASE_ID}/${segment}`
      : `${PRODUCT}/cases/${CASE_ID}`,
  );
  await screen.findByTestId("case-page");
}

function header(): HTMLElement {
  return screen.getByTestId("security-case-header");
}

function crumbs(): Array<string> {
  const trail: HTMLElement = screen.getByRole("navigation", {
    name: "Breadcrumb",
  });

  return within(trail)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

beforeEach(() => {
  permissionsForTest = ["ProjectOwner"];
  realtimeListener = null;
  realtimeSubscriptions.length = 0;
  cases = {
    [CASE_ID]: buildCase(),
    [OTHER_CASE_ID]: buildCase({
      _id: OTHER_CASE_ID,
      caseNumberWithPrefix: "CASE-141",
      title: "Known-bad domain resolved by build-runner-07",
    }),
  };
  getItemFailures = 0;
  getItemCalls.length = 0;
  updates.length = 0;
  deletes.length = 0;
  updateFailure = "";
  pageMounts = 0;
  lastContext = null;

  setViewportWidth(DESKTOP_WIDTH);
  stubDashboardSecurityCaseValues();

  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (data: {
    id: ObjectID;
    select: unknown;
  }): Promise<unknown> => {
    getItemCalls.push({ id: data.id.toString(), select: data.select });

    if (getItemFailures > 0) {
      getItemFailures--;
      throw new Error("The server could not be reached.");
    }

    const found: SecurityCase | null | undefined = cases[data.id.toString()];

    return found === undefined ? null : found;
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (data: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<unknown> => {
    if (updateFailure) {
      throw new Error(updateFailure);
    }

    updates.push({ id: data.id.toString(), data: data.data });
    return null;
  }) as never);

  jest.spyOn(ModelAPI, "deleteItem").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<unknown> => {
    deletes.push(data.id.toString());
    return null;
  }) as never);

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation((async (): Promise<number> => {
      return 1;
    }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("every page of a case", () => {
  test("opens on the Overview at the case's own address, with the header in full", async () => {
    await openCase();

    expect(screen.getByTestId("case-page")).toHaveAttribute(
      "data-page",
      "Overview",
    );
    expect(header()).toHaveAttribute("data-layout", "full");
    // The full header: what it is, where it stands, who has it.
    expect(screen.getByTestId("case-description")).toBeInTheDocument();
    expect(
      screen.getByTestId("security-case-status-steps"),
    ).toBeInTheDocument();
    expect(within(header()).getByText("Assignee")).toBeInTheDocument();
    expect(within(header()).getByText("Last Detection")).toBeInTheDocument();
  });

  test.each(SUB_PAGES)(
    "%s has the compact header, with every action the Overview has",
    async (_page: PageMap, segment: string, title: string) => {
      await openCase(segment);

      expect(screen.getByTestId("case-page")).toHaveAttribute(
        "data-page",
        title,
      );
      expect(header()).toHaveAttribute("data-layout", "compact");
      expect(
        within(header()).getByRole("heading", {
          level: 1,
          name: "Password spray against Okta from 203.0.113.47",
        }),
      ).toBeInTheDocument();

      for (const testId of [
        "security-case-assign-to-me",
        "security-case-run-playbook",
        "security-case-declare-incident",
        "security-case-close",
        "security-case-more",
      ]) {
        expect(within(header()).getByTestId(testId)).toBeInTheDocument();
      }

      // The Overview's own parts stay on the Overview.
      expect(screen.queryByTestId("case-description")).toBeNull();
      expect(screen.queryByTestId("security-case-status-steps")).toBeNull();
      expect(within(header()).queryByText("Assignee")).toBeNull();
    },
  );

  test("names the case by its number in the trail, and the page after it", async () => {
    await openCase("detections");

    expect(crumbs()).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
      "Detections",
    ]);

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });

    expect(
      within(trail).getByRole("link", { name: "CASE-142" }),
    ).toHaveAttribute("href", `${PRODUCT}/cases/${CASE_ID}`);
    expect(document.title).toContain("CASE-142");
  });

  test("on the Overview, the case's own crumb is where the trail ends", async () => {
    await openCase();

    expect(crumbs()).toEqual([
      "Project",
      "Security Events",
      "Security Cases",
      "CASE-142",
    ]);
  });

  test("draws the case's side menu beside each page, its links the case's pages", async () => {
    await openCase("playbook-runs");

    const menu: HTMLElement = screen.getByRole("navigation", {
      name: "Main navigation",
    });

    expect(within(menu).getByText("Investigation")).toBeInTheDocument();
    expect(
      Array.from(menu.querySelectorAll("a")).map(
        (anchor: HTMLAnchorElement): string => {
          return anchor.getAttribute("href") || "";
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        `${PRODUCT}/cases/${CASE_ID}`,
        `${PRODUCT}/cases/${CASE_ID}/timeline`,
        `${PRODUCT}/cases/${CASE_ID}/detections`,
        `${PRODUCT}/cases/${CASE_ID}/entities`,
        `${PRODUCT}/cases/${CASE_ID}/playbook-runs`,
        `${PRODUCT}/cases/${CASE_ID}/notes`,
      ]),
    );
  });

  test("reads the case once, with everything its pages show, and hands it to the page below", async () => {
    await openCase();

    expect(getItemCalls).toEqual([
      { id: CASE_ID, select: SECURITY_CASE_VIEW_SELECT },
    ]);
    expect(screen.getByTestId("case-page")).toHaveAttribute(
      "data-case",
      "CASE-142",
    );
    expect(lastContext?.values.statuses.length).toBeGreaterThan(0);
    expect(lastContext?.caseId.toString()).toBe(CASE_ID);
  });

  test("going from page to page keeps the case it read: no read per page", async () => {
    await openCase();

    // Taken once the router has drawn, for the loop below to call.
    const goTo: (path: string) => void = navigateTo!;

    for (const [, segment, title] of SUB_PAGES) {
      await act(async () => {
        goTo(`${PRODUCT}/cases/${CASE_ID}/${segment}`);
      });

      expect(screen.getByTestId("case-page")).toHaveAttribute(
        "data-page",
        title,
      );
    }

    expect(getItemCalls).toHaveLength(1);
    expect(header()).toHaveAttribute("data-layout", "compact");

    await act(async () => {
      navigateTo!(`${PRODUCT}/cases/${CASE_ID}`);
    });

    expect(header()).toHaveAttribute("data-layout", "full");
    expect(getItemCalls).toHaveLength(1);
  });

  test("listens for changes to this case alone", async () => {
    await openCase();

    expect(realtimeSubscriptions).toEqual([{ modelId: CASE_ID }]);
  });
});

describe("the header's actions work from any page", () => {
  test("Assign to Me saves the reader as the assignee and reads the case again", async () => {
    await openCase("entities");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-assign-to-me"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        { id: CASE_ID, data: { assignedToUserId: ME } },
      ]);
    });
    await waitFor(() => {
      expect(getItemCalls).toHaveLength(2);
    });
  });

  test("Close Case asks for the verdict first, into the project's closed status, and saves nothing yet", async () => {
    await openCase("detections");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-close"));
    });

    expect(screen.getByTestId("close-case-dialog")).toHaveAttribute(
      "data-close-to",
      "Closed",
    );
    expect(updates).toEqual([]);

    // Done: the dialog closes, and the case is read again.
    await act(async () => {
      fireEvent.click(screen.getByText("close-case-dialog-done"));
    });

    expect(screen.queryByTestId("close-case-dialog")).toBeNull();
    await waitFor(() => {
      expect(getItemCalls).toHaveLength(2);
    });
  });

  test("Run Playbook opens the run dialog on no playbook in particular", async () => {
    await openCase("timeline");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-run-playbook"));
    });

    expect(screen.getByTestId("run-playbook-dialog")).toHaveAttribute(
      "data-playbook",
      "",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("run-playbook-dialog-cancel"));
    });

    expect(screen.queryByTestId("run-playbook-dialog")).toBeNull();
    // Cancelled: nothing read again.
    expect(getItemCalls).toHaveLength(1);
  });

  test("a page can open Run Playbook on a playbook of its own choosing - the Overview's AI card, on the suggested one", async () => {
    await openCase();

    await act(async () => {
      fireEvent.click(screen.getByText("probe-run-suggested"));
    });

    expect(screen.getByTestId("run-playbook-dialog")).toHaveAttribute(
      "data-playbook",
      PLAYBOOK_ID,
    );
  });

  test("Declare Incident opens its dialog, and a declared incident is read back with the case", async () => {
    await openCase("notes");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-declare-incident"));
    });

    expect(screen.getByTestId("declare-incident-dialog")).toBeInTheDocument();

    cases[CASE_ID] = buildCase({
      incidentId: new ObjectID("30000000-0000-4000-8000-000000000001"),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("declare-incident-dialog-done"));
    });

    // The case now links to its incident, and offers no second declaration.
    await waitFor(() => {
      expect(screen.queryByTestId("security-case-declare-incident")).toBeNull();
    });
    expect(within(header()).getByText("View Incident")).toBeInTheDocument();
  });

  test("the ⋯ sets the case's priority, and edits and deletes the case", async () => {
    await openCase("detections");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });

    const options: Array<HTMLElement> = screen.getAllByTestId(
      "security-case-priority-option",
    );

    expect(
      options.map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual(["Critical", "High", "Medium", "Low", "Informational"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: CASE_ID,
          data: {
            securityCasePriorityId: testPriorityId(
              SecurityCasePriorityLevel.High,
            ).toString(),
          },
        },
      ]);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-edit"));
    });

    expect(screen.getByTestId("edit-case-dialog")).toHaveAttribute(
      "data-id",
      CASE_ID,
    );
  });

  test("picking the priority the case already has saves nothing", async () => {
    await openCase("detections");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Critical" }));
    });

    expect(updates).toEqual([]);
  });

  test("a save that fails says why above the header, and can be put away", async () => {
    updateFailure = "You do not have permission to update this Security Case.";
    await openCase("entities");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-assign-to-me"));
    });

    const alert: HTMLElement = await screen.findByTestId(
      "security-case-action-error",
    );

    expect(alert).toHaveTextContent(updateFailure);
    // Still on the page it was on, with the case as it was.
    expect(screen.getByTestId("case-page")).toHaveAttribute(
      "data-page",
      "Entities",
    );

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button"));
    });

    expect(screen.queryByTestId("security-case-action-error")).toBeNull();
  });
});

describe("assigning a case and moving its status from the ⋯", () => {
  const DIEGO: string = "80000000-0000-4000-8000-000000000002";
  const SOC_TEAM: string = "81000000-0000-4000-8000-000000000001";

  async function openFromMore(testId: string): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId(testId));
    });
  }

  test("Assign to Someone Else opens on the case, saves the person picked and reads the case again", async () => {
    await openCase("timeline");
    const readsBefore: number = getItemCalls.length;

    await openFromMore("security-case-assign-to-someone-else");

    expect(screen.getByTestId("assign-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-142",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("pick-diego"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        { id: CASE_ID, data: { assignedToUserId: DIEGO } },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("assign-dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(getItemCalls.length).toBeGreaterThan(readsBefore);
    });
  });

  test("handing the case to a team takes the person off it", async () => {
    cases[CASE_ID] = buildCase({ assignedToUserId: new ObjectID(ME) });
    await openCase("detections");

    await openFromMore("security-case-assign-to-someone-else");
    await act(async () => {
      fireEvent.click(screen.getByText("pick-soc-team"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: CASE_ID,
          data: { assignedToTeamId: SOC_TEAM, assignedToUserId: null },
        },
      ]);
    });
  });

  test("Change Status, from a page with no status steps, closes the case with the verdict and the note", async () => {
    await openCase("entities");

    await openFromMore("security-case-change-status");

    expect(screen.getByTestId("status-dialog")).toHaveAttribute(
      "data-cases",
      "CASE-142",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("status-Closed"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: CASE_ID,
          data: {
            securityCaseStatusId: testStatusId(
              SecurityCaseStage.Closed,
            ).toString(),
            verdict: SecurityCaseVerdict.FalsePositive,
            closingNote: "Our own scanner.",
          },
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("status-dialog")).toBeNull();
    });
  });

  test("Change Status to an open status moves the case there, with no verdict", async () => {
    await openCase("notes");

    await openFromMore("security-case-change-status");
    await act(async () => {
      fireEvent.click(screen.getByText("status-Contained"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: CASE_ID,
          data: {
            securityCaseStatusId: testStatusId(
              SecurityCaseStage.Contained,
            ).toString(),
          },
        },
      ]);
    });
  });

  test("a pick that leaves the case as it is saves nothing, and the dialog closes", async () => {
    await openCase("timeline");

    // The case is Investigating already.
    await openFromMore("security-case-change-status");
    await act(async () => {
      fireEvent.click(screen.getByText("status-Investigating"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("status-dialog")).toBeNull();
    });
    expect(updates).toEqual([]);
  });

  test("a save that fails stays in its dialog, saying why", async () => {
    updateFailure = "You do not have permission to update this Security Case.";
    await openCase("playbook-runs");

    await openFromMore("security-case-assign-to-someone-else");
    await act(async () => {
      fireEvent.click(screen.getByText("pick-diego"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("assign-dialog")).toHaveAttribute(
        "data-error",
        updateFailure,
      );
    });
    // Said in the dialog, not over the page.
    expect(screen.queryByTestId("security-case-action-error")).toBeNull();
  });

  test("a closed case's ⋯ has no Assign to Someone Else", async () => {
    cases[CASE_ID] = buildCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
      verdict: SecurityCaseVerdict.TruePositive,
    });
    await openCase();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });

    expect(
      screen.queryByTestId("security-case-assign-to-someone-else"),
    ).toBeNull();
    expect(
      screen.getByTestId("security-case-change-status"),
    ).toBeInTheDocument();
  });
});

describe("deleting a case", () => {
  test("asks first, deletes it for good, and goes back to the open cases", async () => {
    await openCase("delete");

    await act(async () => {
      fireEvent.click(screen.getByText("probe-delete"));
    });

    const dialog: HTMLElement = screen.getByRole("dialog");

    // By its number, as the header and the trail name it - not number and title run together.
    expect(dialog).toHaveTextContent(
      "CASE-142 and its detections, notes, timeline and playbook runs are deleted for good. To keep the record, close it with a verdict instead.",
    );
    expect(dialog).not.toHaveTextContent("CASE-142 Password spray");
    expect(deletes).toEqual([]);

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Delete Case" }),
      );
    });

    await waitFor(() => {
      expect(deletes).toEqual([CASE_ID]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${PRODUCT}/cases`,
      );
    });
  });

  test("the ⋯'s Delete Case asks the same question", async () => {
    await openCase();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-delete"));
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "To keep the record, close it with a verdict instead.",
    );
  });
});

describe("keeping the case fresh", () => {
  test("a colleague's change reads the case again, and tells every page to read its own again", async () => {
    await openCase("timeline");

    const before: string =
      screen.getByTestId("case-page").getAttribute("data-refresh") || "";

    cases[CASE_ID] = buildCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Contained),
      title: "Password spray, contained",
    });

    await act(async () => {
      realtimeListener!(new ObjectID(CASE_ID));
    });

    await waitFor(() => {
      expect(
        within(header()).getByRole("heading", {
          level: 1,
          name: "Password spray, contained",
        }),
      ).toBeInTheDocument();
    });
    expect(getItemCalls).toHaveLength(2);
    expect(
      screen.getByTestId("case-page").getAttribute("data-refresh"),
    ).not.toBe(before);
    // The side menu's count of runs waiting is asked again too.
    expect(
      (ModelAPI.count as unknown as { mock: { calls: Array<unknown> } }).mock
        .calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a refresh that fails keeps the case on screen", async () => {
    await openCase("detections");

    getItemFailures = 1;

    await act(async () => {
      realtimeListener!(new ObjectID(CASE_ID));
    });

    await waitFor(() => {
      expect(getItemCalls).toHaveLength(2);
    });
    expect(header()).toBeInTheDocument();
    expect(screen.getByTestId("case-page")).toHaveAttribute(
      "data-page",
      "Detections",
    );
  });

  test("a case a colleague deleted says it is not there any more", async () => {
    await openCase("detections");

    cases[CASE_ID] = null;

    await act(async () => {
      realtimeListener!(new ObjectID(CASE_ID));
    });

    expect(
      await screen.findByTestId("security-case-not-found"),
    ).toHaveAttribute("data-reason", "not-found");
  });
});

describe("a case there is nothing to show of", () => {
  test("a case that is not there says so, with the way back to the open cases", async () => {
    cases[CASE_ID] = null;
    await open(`${PRODUCT}/cases/${CASE_ID}/entities`);

    const state: HTMLElement = await screen.findByTestId(
      "security-case-not-found",
    );

    expect(state).toHaveAttribute("data-reason", "not-found");
    expect(state).toHaveTextContent("This case could not be found");
    expect(state).toHaveTextContent(
      SECURITY_CASE_NOT_FOUND_COPY[SecurityCaseNotFoundReason.NotFound]
        .description,
    );
    // No side menu and no header: there is no case to work.
    expect(screen.queryByTestId("security-case-header")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Main navigation" }),
    ).toBeNull();
    expect(screen.queryByTestId("case-page")).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(state).getByRole("button", { name: "Open Cases" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${PRODUCT}/cases`,
      );
    });
  });

  test("an address that is not a case's id is not asked for at all", async () => {
    await open(`${PRODUCT}/cases/not-a-case/detections`);

    expect(
      await screen.findByTestId("security-case-not-found"),
    ).toHaveAttribute("data-reason", "not-found");
    expect(getItemCalls).toEqual([]);
    expect(realtimeSubscriptions).toEqual([]);
  });

  test("a reader whose role cannot read security cases is told why, and offered nothing", async () => {
    permissionsForTest = ["ReadMonitor"];
    cases[CASE_ID] = null;
    await open(`${PRODUCT}/cases/${CASE_ID}`);

    const state: HTMLElement = await screen.findByTestId(
      "security-case-not-found",
    );

    expect(state).toHaveAttribute("data-reason", "no-access");
    expect(state).toHaveTextContent("You cannot open this case");
    expect(state).toHaveTextContent("You do not have permission to read");
    expect(within(state).queryByRole("button")).toBeNull();
  });

  test("a case that cannot be read says so, and Try again reads it again", async () => {
    getItemFailures = 1;
    await open(`${PRODUCT}/cases/${CASE_ID}/detections`);

    const state: HTMLElement = await screen.findByTestId(
      "security-case-not-found",
    );

    expect(state).toHaveAttribute("data-reason", "load-failed");
    expect(state).toHaveTextContent("This case could not be loaded");
    expect(state).toHaveTextContent("The server could not be reached.");

    await act(async () => {
      fireEvent.click(within(state).getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByTestId("case-page")).toHaveAttribute(
      "data-page",
      "Detections",
    );
    expect(getItemCalls).toHaveLength(2);
  });

  test("the project's case statuses that cannot be read say so, and Try again reads them again", async () => {
    let statusReads: number = 0;
    // The stub the suite answers the project's values with.
    const answerValues: (data: unknown) => Promise<unknown> = (
      ModelListCache.getList as unknown as {
        getMockImplementation: () => (data: unknown) => Promise<unknown>;
      }
    ).getMockImplementation();

    jest.spyOn(ModelListCache, "getList").mockImplementation((async (data: {
      modelType: { new (): SecurityCase };
    }): Promise<unknown> => {
      if (new data.modelType().tableName === "SecurityCaseStatus") {
        statusReads++;

        if (statusReads === 1) {
          throw new Error("Statuses are not available right now.");
        }
      }

      return answerValues(data);
    }) as never);

    await open(`${PRODUCT}/cases/${CASE_ID}`);

    const state: HTMLElement = await screen.findByTestId(
      "security-case-not-found",
    );

    expect(state).toHaveAttribute("data-reason", "load-failed");

    await act(async () => {
      fireEvent.click(within(state).getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByTestId("case-page")).toHaveAttribute(
      "data-page",
      "Overview",
    );
  });

  test("while the case is read, the side menu is there and the page waits", async () => {
    let finishRead: (() => void) | null = null;

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation((async (): Promise<unknown> => {
        await new Promise<void>((resolve: () => void): void => {
          finishRead = resolve;
        });
        return buildCase();
      }) as never);

    await open(`${PRODUCT}/cases/${CASE_ID}/detections`);

    expect(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("security-case-header")).toBeNull();
    expect(screen.queryByTestId("case-page")).toBeNull();

    await act(async () => {
      finishRead!();
    });

    expect(await screen.findByTestId("case-page")).toBeInTheDocument();
  });
});

describe("moving to another case", () => {
  test("reads the other case, and starts its pages afresh", async () => {
    await openCase("detections");

    const mountsBefore: number = pageMounts;

    await act(async () => {
      navigateTo!(`${PRODUCT}/cases/${OTHER_CASE_ID}/detections`);
    });

    await waitFor(() => {
      expect(screen.getByTestId("case-page")).toHaveAttribute(
        "data-case",
        "CASE-141",
      );
    });

    expect(
      getItemCalls.map((call: { id: string }): string => {
        return call.id;
      }),
    ).toEqual([CASE_ID, OTHER_CASE_ID]);
    expect(pageMounts).toBe(mountsBefore + 1);
    expect(crumbs()).toContain("CASE-141");
    expect(realtimeSubscriptions[realtimeSubscriptions.length - 1]).toEqual({
      modelId: OTHER_CASE_ID,
    });
  });
});

describe("a closed case", () => {
  test("offers Reopen in place of Close Case, and says its verdict, on every page", async () => {
    cases[CASE_ID] = buildCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
      verdict: SecurityCaseVerdict.FalsePositive,
      closedAt: new Date("2026-10-14T11:00:00.000Z"),
      closingNote: "A pen test from the red team.",
    });

    await openCase("entities");

    expect(screen.queryByTestId("security-case-close")).toBeNull();
    expect(screen.getByTestId("security-case-reopen")).toBeInTheDocument();
    expect(within(header()).getByText("False Positive")).toBeInTheDocument();
    // The closing note is the Overview's.
    expect(screen.queryByText("A pen test from the red team.")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-reopen"));
    });

    await waitFor(() => {
      expect(updates).toEqual([
        {
          id: CASE_ID,
          data: {
            securityCaseStatusId: testStatusId(
              SecurityCaseStage.Acknowledged,
            ).toString(),
          },
        },
      ]);
    });
  });

  test("its Overview keeps the closing note under the facts", async () => {
    cases[CASE_ID] = buildCase({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
      verdict: SecurityCaseVerdict.FalsePositive,
      closingNote: "A pen test from the red team.",
    });

    await openCase();

    expect(
      screen.getByText("A pen test from the red team."),
    ).toBeInTheDocument();
  });
});

describe("a Security Viewer", () => {
  test("sees the actions locked, each saying why, on any page", async () => {
    permissionsForTest = ["SecurityViewer"];
    await openCase("detections");

    for (const testId of [
      "security-case-assign-to-me",
      // Starting a run is creating one, which a viewer may not.
      "security-case-run-playbook",
      "security-case-declare-incident",
      "security-case-close",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
      // Reached through a wrapper that can take the hover and the focus.
      expect(screen.getByTestId(`${testId}-disabled-wrapper`)).toHaveAttribute(
        "tabindex",
        "0",
      );
    }

    // No dialog the server would refuse at the end of it.
    fireEvent.click(screen.getByTestId("security-case-run-playbook"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
