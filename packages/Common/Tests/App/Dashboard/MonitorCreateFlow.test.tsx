import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CREATE MONITOR, WALKED THROUGH - the real page, the real ModelForm, the real
 * type picker; only the network, the signed-in user and the criteria editor
 * (MonitorSteps, which has suites of its own) are stubbed.
 *
 * The maintainer: "When I create a new monitor, this UI is extremely
 * confusing to use." The form asked for a name before what to monitor, then
 * showed a wall of type cards under "32 to choose from" and eight category
 * headings with counts, with a big description box in between. Now:
 *
 *   - What to Monitor asks what to monitor first, as six common types,
 *     then where it is - a website's URL, a host, a port (#7463) - then the
 *     name, which follows the address; the description and the labels fold
 *     under More fields;
 *   - a picked type shrinks to one line with Change; More monitor types and
 *     the search reach every other type;
 *   - the criteria step gets the type, the name and foldDefaultCriteria;
 *   - Next is plain and the form's action is on the last step only (#4352).
 */

const PROJECT_ID: string = "0c000000-0000-4000-8000-000000000001";
const NEW_MONITOR_ID: string = "0c000000-0000-4000-8000-000000000002";
const GLOBAL_PROBE_ID: string = "0c000000-0000-4000-8000-0000000000a1";
const TEMPLATE_ID: string = "0c000000-0000-4000-8000-0000000000b1";
const ONLINE_STATUS_ID: string = "0c000000-0000-4000-8000-0000000000c1";
const OFFLINE_STATUS_ID: string = "0c000000-0000-4000-8000-0000000000c2";
const SEVERITY_ID: string = "0c000000-0000-4000-8000-0000000000c3";

jest.setTimeout(30000);

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0c000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

// The probes the project can pick from; one global probe unless a test says.
const ONE_GLOBAL_PROBE: Array<Record<string, unknown>> = [
  {
    _id: "0c000000-0000-4000-8000-0000000000a1",
    name: "Global probe",
    isGlobalProbe: true,
    shouldAutoEnableProbeOnNewMonitors: true,
  },
];

let probesForTest: Array<Record<string, unknown>> = ONE_GLOBAL_PROBE;

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve(probesForTest);
      },
    },
  };
});

/*
 * The criteria editor, stubbed: it says what it was handed, and hands the
 * form the valid steps a real one would once its defaults are in (with the
 * address a person would type for a probe check), so Next can walk on.
 */
const criteriaEditorProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, any>): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        criteriaEditorProps.push(props);

        ReactActual.useEffect(() => {
          const MonitorStepsType: any = (
            jest.requireActual("../../../Types/Monitor/MonitorSteps") as any
          ).default;
          const ObjectIDType: any = (
            jest.requireActual("../../../Types/ObjectID") as any
          ).default;
          const URLType: any = (
            jest.requireActual("../../../Types/API/URL") as any
          ).default;

          const steps: any = MonitorStepsType.getDefaultMonitorSteps({
            monitorType: props["monitorType"],
            monitorName: props["monitorName"] || "",
            defaultMonitorStatusId: new ObjectIDType(
              "0c000000-0000-4000-8000-0000000000c1",
            ),
            onlineMonitorStatusId: new ObjectIDType(
              "0c000000-0000-4000-8000-0000000000c1",
            ),
            offlineMonitorStatusId: new ObjectIDType(
              "0c000000-0000-4000-8000-0000000000c2",
            ),
            defaultIncidentSeverityId: new ObjectIDType(
              "0c000000-0000-4000-8000-0000000000c3",
            ),
            defaultAlertSeverityId: new ObjectIDType(
              "0c000000-0000-4000-8000-0000000000c3",
            ),
          });

          steps.data.monitorStepsInstanceArray[0].setMonitorDestination(
            URLType.fromString("https://example.com"),
          );

          props["onChange"]?.(steps);
        }, [props["monitorType"]]);

        return ReactActual.createElement("div", {
          "data-testid": "criteria-editor",
          "data-monitor-type": props["monitorType"],
          "data-monitor-name": props["monitorName"],
          "data-fold-default-criteria": String(props["foldDefaultCriteria"]),
        });
      },
    };
  },
);

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import Route from "../../../Types/API/Route";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import UiAnalytics from "../../../UI/Utils/Analytics";
import { getJestSpyOn } from "../../Spy";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * A read the page makes that these tests leave unanswered: the project's
 * active monitor limit, for the notice above the form
 * (ActiveMonitorLimitNotice), which says nothing when it cannot read it.
 * Refused at once, as the network refused it, and taken as a read the
 * notice could not make (Tests/Helpers/RealNetworkRequests.ts).
 */
refuseRequestsTo([
  "/monitor/active-monitor-limit",
  /*
   * Who the criteria would tell (When this goes down), which What to Check
   * reads for the monitor the form holds: its card has suites of its own.
   */
  "/who-is-told/draft",
]);

// The server's global config, answered here rather than over the network.
beforeEach((): void => {
  standInForGlobalConfig();
});

const COMMON_TYPES: Array<string> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.Port,
  MonitorType.SSLCertificate,
  MonitorType.IncomingRequest,
];

let navigateCalls: Array<string> = [];

function list(data: Array<unknown>): Record<string, unknown> {
  return { data, count: data.length, skip: 0, limit: 50 };
}

// The query string the page opens with, read by name and whole.
function openWith(params: Record<string, string>): void {
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (name: string): string | null => {
      return params[name] ?? null;
    },
  );
  getJestSpyOn(Navigation, "getQueryString").mockImplementation((): string => {
    const query: string = new URLSearchParams(params).toString();

    return query ? `?${query}` : "";
  });
}

async function renderPage(
  params: Record<string, string> = {},
): Promise<HTMLElement> {
  openWith(params);

  /*
   * In a router, as the Dashboard draws every page: Website or API picked,
   * the page links the guided setup (#7054).
   */
  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  const form: HTMLElement = await waitFor(
    (): HTMLElement => {
      const element: HTMLElement | null = document.getElementById(
        "create-monitor-form",
      );

      if (!element) {
        throw new Error("The create monitor form is not drawn yet.");
      }

      return element;
    },
    { timeout: 10000 },
  );

  /*
   * BasicForm opens its first step in an effect, and draws its fields once
   * their list has arrived: wait for the step list, then for the picker -
   * its catalog, or the summary of a type a link or template chose.
   */
  await screen.findByRole(
    "navigation",
    { name: "Progress" },
    { timeout: 10000 },
  );

  await waitFor(
    (): void => {
      if (
        !screen.queryByTestId("card-select-common") &&
        !screen.queryByTestId("card-select-summary")
      ) {
        throw new Error("The monitor type picker is not drawn yet.");
      }
    },
    { timeout: 10000 },
  );

  // The form element drawn once its fields are in, not the first one.
  return document.getElementById("create-monitor-form") || form;
}

function stepTitles(): Array<string> {
  return within(screen.getByRole("navigation", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function shownTypes(): Array<string> {
  return screen.queryAllByRole("radio").map((radio: HTMLElement): string => {
    return radio.getAttribute("data-card-select-value") || "";
  });
}

function nameInput(): HTMLElement {
  return screen.getByPlaceholderText("Monitor Name");
}

function typeName(value: string): void {
  fireEvent.change(nameInput(), { target: { value } });
}

// The address a type whose check is of one address asks with it (#7463).
function addressInput(): HTMLElement {
  return screen.getByTestId("monitor-address-input");
}

function typeAddress(value: string): void {
  fireEvent.change(addressInput(), { target: { value } });
}

// The criteria editor's props, as it was last drawn.
function lastCriteriaEditorProps(): Record<string, any> {
  const props: Record<string, any> | undefined =
    criteriaEditorProps[criteriaEditorProps.length - 1];

  if (!props) {
    throw new Error("The criteria editor was never drawn.");
  }

  return props;
}

async function pressNext(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("form-next-button"));
  });
}

async function pressCreate(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("Create Monitor"));
  });
}

function sentMonitor(): Monitor {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (createOrUpdateMock.mock.calls[0]![0] as { model: Monitor }).model;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  probesForTest = ONE_GLOBAL_PROBE;
  navigateCalls = [];
  criteriaEditorProps.length = 0;
  PermissionGate.clearPermissionPropsCache();

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );
  getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
    (): void => {},
  );

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === Label) {
      const label: Label = new Label();
      label._id = "0c000000-0000-4000-8000-0000000000d1";
      label.name = "production";
      return list([label]);
    }

    return list([]);
  });

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === MonitorTemplate) {
      const template: MonitorTemplate = new MonitorTemplate();
      template._id = TEMPLATE_ID;
      template.monitorName = "Checkout API";
      template.monitorDescription = "The checkout service.";
      template.monitorType = MonitorType.API;
      return template;
    }

    // The project: global probes are added to new monitors.
    return { doNotAddGlobalProbesByDefaultOnNewMonitors: false };
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: NEW_MONITOR_ID,
        name: data.model.name,
        monitorType: data.model.monitorType,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

describe("What to Monitor: what to monitor comes first", () => {
  test("the type picker is the first field, then the name", async () => {
    const form: HTMLElement = await renderPage();

    const picker: HTMLElement = within(form).getByTestId("card-select-common");

    expect(
      picker.compareDocumentPosition(nameInput()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(form).getByText("What do you want to monitor?"),
    ).toBeVisible();
  });

  test("it opens on the six common types and a way to the rest", async () => {
    await renderPage();

    expect(shownTypes()).toEqual(COMMON_TYPES);
    expect(screen.getByTestId("card-select-more")).toHaveTextContent(
      "More monitor types",
    );
    expect(screen.queryByText(/to choose from/)).not.toBeInTheDocument();
    expect(screen.queryByText("Infrastructure")).not.toBeInTheDocument();
  });

  test("the description and the labels fold under More fields", async () => {
    const form: HTMLElement = await renderPage();

    const moreFields: HTMLElement = within(form).getByRole("button", {
      name: "More fields",
    });

    expect(moreFields).toHaveAttribute("aria-expanded", "false");

    // Folded away until opened: no description box on the way to a monitor.
    expect(
      within(form).queryByRole("textbox", { name: /^Description/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(moreFields);

    expect(
      await within(form).findByRole("textbox", { name: /^Description/ }),
    ).toBeVisible();
    expect(
      within(form).getByText(
        "Anything your team should know about this monitor.",
      ),
    ).toBeVisible();
    expect(
      within(form).getByRole("combobox", { name: /^Labels/ }),
    ).toBeVisible();
  });

  test("the name says what it is for", async () => {
    await renderPage();

    expect(
      screen.getByText(
        "A name your team will recognize. It is used in alerts and incident titles.",
      ),
    ).toBeVisible();
  });

  test("Next with no type picked says so, and stays on What to Monitor", async () => {
    await renderPage();

    typeName("Marketing site");
    await pressNext();

    expect(await screen.findByText("Monitor Type is required.")).toBeVisible();
    expect(screen.queryByTestId("criteria-editor")).not.toBeInTheDocument();
  });

  test("Next is plain: the form's action waits for the last step", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    expect(screen.getByTestId("form-next-button")).toBeVisible();
    expect(screen.queryByTestId("Create Monitor")).not.toBeInTheDocument();
  });
});

describe("picking and changing the type", () => {
  test("a picked type shrinks to one line, with Change, and the name stays put", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    const summary: HTMLElement = screen.getByTestId("card-select-summary");

    expect(summary).toHaveAttribute("data-card-select-value", "Website");
    expect(within(summary).getByTestId("card-select-change")).toHaveFocus();
    expect(shownTypes()).toEqual([]);
    expect(nameInput()).toBeVisible();
  });

  test("the steps follow the type picked", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    await waitFor(() => {
      expect(stepTitles()).toEqual([
        "What to Monitor",
        "Criteria",
        "Probes & Interval",
      ]);
    });

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Incoming Request"));

    await waitFor(() => {
      expect(stepTitles()).toEqual(["What to Monitor", "Criteria"]);
    });
  });

  test("a type from the long tail, by More monitor types", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-more"));

    expect(
      within(
        screen.getByTestId("card-select-group-Infrastructure"),
      ).getByTestId("card-select-option-Kubernetes"),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
  });

  /*
   * Issue #5364: More monitor types went once pressed, so the long tail
   * stayed open until the page was reloaded. On the real page it folds
   * again, and nothing else of Monitor Info moves or resets.
   */
  test("More monitor types folds the long tail away again, and the name stays as typed", async () => {
    const form: HTMLElement = await renderPage();

    typeName("Checkout cluster");

    const more: HTMLElement = screen.getByTestId("card-select-more");

    fireEvent.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("card-select-group-Infrastructure"),
    ).toBeVisible();

    fireEvent.click(more);

    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
    expect(shownTypes()).toEqual(COMMON_TYPES);
    expect(within(form).queryByText("Infrastructure")).not.toBeInTheDocument();
    expect(nameInput()).toHaveValue("Checkout cluster");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a link's type from the long tail: Change opens it with More open, and More folds it", async () => {
    await renderPage({ monitorType: MonitorType.Kubernetes });

    fireEvent.click(screen.getByTestId("card-select-change"));

    expect(screen.getByTestId("card-select-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("card-select-option-Kubernetes")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("card-select-more"));

    expect(shownTypes()).toEqual(COMMON_TYPES);

    // A common type picked from there builds that type's steps.
    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.Website,
    );
    await waitFor(() => {
      expect(stepTitles()).toEqual([
        "What to Monitor",
        "Criteria",
        "Probes & Interval",
      ]);
    });
  });

  test("a type from the long tail, by search and Enter", async () => {
    await renderPage();

    fireEvent.change(screen.getByTestId("card-select-search"), {
      target: { value: "postgres" },
    });
    fireEvent.keyDown(screen.getByTestId("card-select-search"), {
      key: "Enter",
    });

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.Database,
    );
  });

  test("Change, then another type: the criteria step is built for the new one", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Ping"));
    typeAddress("router.office.example");
    typeName("Office router");
    await pressNext();

    const editor: HTMLElement = await screen.findByTestId("criteria-editor");

    expect(editor).toHaveAttribute("data-monitor-type", MonitorType.Ping);
    expect(editor).toHaveAttribute("data-monitor-name", "Office router");
  });

  /*
   * Website or API picked on a plain Create Monitor: one line under the
   * picked type offers the guided setup, which does the whole job - who is
   * told and a test page too (#7054). Another type is offered nothing.
   */
  test("Website or API picked: one line offers the guided setup; Ping, nothing", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    expect(await screen.findByTestId("website-down-setup-offer")).toBeVisible();
    expect(
      screen.getByTestId("website-down-setup-offer-link").getAttribute("href"),
    ).toContain("/monitors/setup?from=create_monitor");

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Ping"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("website-down-setup-offer"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-API"));

    expect(await screen.findByTestId("website-down-setup-offer")).toBeVisible();
  });
});

describe("the criteria and the last step", () => {
  test("the criteria editor folds a new monitor's default criteria", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    typeName("Marketing site");
    await pressNext();

    const editor: HTMLElement = await screen.findByTestId("criteria-editor");

    expect(editor).toHaveAttribute("data-monitor-type", MonitorType.Website);
    expect(editor).toHaveAttribute("data-monitor-name", "Marketing site");
    expect(editor).toHaveAttribute("data-fold-default-criteria", "true");
    expect(
      screen.getByText(
        "What to check, and what counts as a problem. The criteria start with defaults that suit most monitors.",
      ),
    ).toBeVisible();
  });

  test("a website monitor: What to Monitor, Criteria, Probes & Interval, then Create Monitor", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    typeName("Marketing site");
    await pressNext();
    await screen.findByTestId("criteria-editor");
    await pressNext();

    // The last step: probes and interval, with defaults, and the action.
    expect(
      await screen.findByText(
        "How often to check. Every 5 minutes suits most monitors.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Every 5 Minutes")).toBeVisible();
    expect(screen.getByText("Global probe")).toBeVisible();
    expect(screen.queryByTestId("form-next-button")).not.toBeInTheDocument();

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });

    const monitor: Monitor = sentMonitor();

    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(monitor.name).toBe("Marketing site");
    expect(monitor.monitoringInterval).toBe("*/5 * * * *");
    // The address asked with the type is the one its step checks.
    expect(
      monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestination?.toString(),
    ).toBe("https://marketing.example/");

    const misc: Record<string, unknown> = (
      createOrUpdateMock.mock.calls[0]![0] as {
        miscDataProps: Record<string, unknown>;
      }
    ).miscDataProps;

    expect(misc["probes"]).toEqual([GLOBAL_PROBE_ID]);

    await waitFor(() => {
      expect(navigateCalls.join(" ")).toContain(NEW_MONITOR_ID);
    });
  });

  /*
   * A Manual monitor has no criteria and no interval: What to Monitor is
   * its only step, and the action is there.
   */
  test("a manual monitor is created from What to Monitor, with no interval", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-more"));
    fireEvent.click(screen.getByTestId("card-select-option-Manual"));
    typeName("Payment provider");

    // One step left to walk: the form draws no step list at all.
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Criteria")).not.toBeInTheDocument();
    expect(screen.queryByText("Probes & Interval")).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-next-button")).not.toBeInTheDocument();
    // Nothing to check at an address: no address is asked.
    expect(
      screen.queryByTestId("monitor-address-input"),
    ).not.toBeInTheDocument();

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });

    const monitor: Monitor = sentMonitor();

    expect(monitor.monitorType).toBe(MonitorType.Manual);
    expect(monitor.name).toBe("Payment provider");
    expect(monitor.monitoringInterval).toBeUndefined();
    expect(criteriaEditorProps).toEqual([]);
  });

  test("Change on What to Monitor, after walking on, keeps the name typed", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    typeName("Marketing site");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    // Back to What to Monitor from the step list.
    await act(async () => {
      fireEvent.click(screen.getByText("What to Monitor"));
    });

    expect(await screen.findByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Website",
    );

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-API"));

    expect(nameInput()).toHaveValue("Marketing site");
  });
});

/*
 * A monitor with no probes is never checked, and the form used to create one
 * without a word: a project whose default probe set is empty (global probes
 * kept off new monitors, and no probe of its own picked for them) opened the
 * Probes picker empty, and Create Monitor saved the monitor as it was - as it
 * did for a picker someone had cleared. The help said so; the form let it
 * happen. While there are probes to pick, it now asks for one.
 */
describe("Probes: the form never creates a monitor that nothing checks", () => {
  const LAST_STEP_HELP: string =
    "How often to check. Every 5 minutes suits most monitors.";

  // Global probes are kept off new monitors, and no other probe is picked.
  function projectWithNoDefaultProbes(): void {
    getItemMock.mockImplementation(async (): Promise<any> => {
      return { doNotAddGlobalProbesByDefaultOnNewMonitors: true };
    });
  }

  async function walkToProbesAndInterval(): Promise<void> {
    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    typeName("Marketing site");
    await pressNext();
    await screen.findByTestId("criteria-editor");
    await pressNext();
    await screen.findByText(LAST_STEP_HELP);
  }

  // The Probes picker, named by its field's label.
  function probesPicker(): HTMLElement {
    return screen.getByRole("combobox", { name: /^Probes/ });
  }

  async function pickProbe(name: string): Promise<void> {
    await act(async () => {
      fireEvent.keyDown(probesPicker(), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    });
    const option: HTMLElement = await screen.findByText(name, {
      selector: ".ou-select__option, .ou-select__option *",
    });
    await act(async () => {
      fireEvent.click(option);
    });
  }

  function sentProbes(): unknown {
    return (
      createOrUpdateMock.mock.calls[0]![0] as {
        miscDataProps: Record<string, unknown>;
      }
    ).miscDataProps["probes"];
  }

  test("Probes no longer reads as optional", async () => {
    await renderPage();
    await walkToProbesAndInterval();

    // Its label, which names the picker, has no "(Optional)" after it.
    expect(probesPicker()).toHaveAccessibleName("Probes");
  });

  test("with no default probes, Create Monitor asks for one and creates nothing", async () => {
    projectWithNoDefaultProbes();
    await renderPage();
    await walkToProbesAndInterval();

    // Nothing starts selected: the picker shows its placeholder.
    expect(screen.getByText("Select Probes")).toBeInTheDocument();

    await pressCreate();

    expect(await screen.findByText("Probes is required.")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(navigateCalls).toEqual([]);
  });

  test("picking a probe then creates the monitor, checked by that probe", async () => {
    projectWithNoDefaultProbes();
    await renderPage();
    await walkToProbesAndInterval();

    await pressCreate();
    expect(await screen.findByText("Probes is required.")).toBeVisible();

    await pickProbe("Global probe");

    await waitFor(() => {
      expect(screen.queryByText("Probes is required.")).not.toBeInTheDocument();
    });

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });
    expect(sentProbes()).toEqual([GLOBAL_PROBE_ID]);
  });

  test("clearing the default probes is caught the same way", async () => {
    await renderPage();
    await walkToProbesAndInterval();

    // The project's default probe starts selected; take it away.
    const remove: HTMLElement = screen.getByRole("button", {
      name: "Remove Global probe",
    });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(screen.queryByText("Global probe")).not.toBeInTheDocument();

    await pressCreate();

    expect(await screen.findByText("Probes is required.")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("the default probes, left as they are, still create the monitor in one go", async () => {
    await renderPage();
    await walkToProbesAndInterval();

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Probes is required.")).not.toBeInTheDocument();
    expect(sentProbes()).toEqual([GLOBAL_PROBE_ID]);
  });

  test("a type no probe checks is still created from its one step, with no probe", async () => {
    projectWithNoDefaultProbes();
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-more"));
    fireEvent.click(screen.getByTestId("card-select-option-Manual"));
    typeName("Payment provider");

    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
    });

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });
    expect(sentMonitor().monitorType).toBe(MonitorType.Manual);
    expect(screen.queryByText("Probes is required.")).not.toBeInTheDocument();
  });

  /*
   * The list always holds the global probes, so it is empty only on an
   * installation with no probe at all: there is nothing to ask for, and the
   * form does not stand in the way.
   */
  test("with no probe to pick at all, the picker stays away and Create goes through", async () => {
    probesForTest = [];
    await renderPage();
    await walkToProbesAndInterval();

    expect(
      screen.queryByRole("combobox", { name: /^Probes/ }),
    ).not.toBeInTheDocument();

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Probes is required.")).not.toBeInTheDocument();
  });
});

describe("opening on a type a link or a template chose", () => {
  test("a link's monitor type opens on that type, ready to name", async () => {
    await renderPage({ monitorType: MonitorType.Kubernetes });

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Kubernetes",
    );
    expect(shownTypes()).toEqual([]);
  });

  test("a template opens on its type, with its name filled in", async () => {
    await renderPage({ monitorTemplateId: TEMPLATE_ID });

    expect(await screen.findByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.API,
    );
    expect(nameInput()).toHaveValue("Checkout API");
    // The template's own job: the guided setup is not offered over it (#7054).
    expect(
      screen.queryByTestId("website-down-setup-offer"),
    ).not.toBeInTheDocument();
  });

  test("a link naming a type that does not exist opens on the common types", async () => {
    await renderPage({ monitorType: "Mainframe" });

    expect(screen.queryByTestId("card-select-summary")).not.toBeInTheDocument();
    expect(shownTypes()).toEqual(COMMON_TYPES);
  });
});

/*
 * ObjectID is imported for the type of the ids the page sends; keep the
 * import used so the suite type-checks the same way the page does.
 */
test("the ids above are real ObjectIDs", () => {
  for (const id of [
    PROJECT_ID,
    NEW_MONITOR_ID,
    GLOBAL_PROBE_ID,
    TEMPLATE_ID,
    ONLINE_STATUS_ID,
    OFFLINE_STATUS_ID,
    SEVERITY_ID,
  ]) {
    expect(new ObjectID(id).toString()).toBe(id);
  }
});

/*
 * #7463: the walker picked Website, named the monitor, and found its address
 * on the next step, named "Criteria", under a heading of rules. The address
 * is asked first now, with the type, on a step named for what it holds, and
 * the name follows it; the steps are What to Monitor, Criteria and Probes &
 * Interval.
 */
describe("What to Monitor asks where it is, with the type", () => {
  test("a website's address comes right after the type, before the name", async () => {
    await renderPage();

    // Nothing to fill in until there is a type.
    expect(
      screen.queryByTestId("monitor-address-input"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    const address: HTMLElement = addressInput();

    expect(address).toHaveAttribute("placeholder", "https://example.com");
    expect(screen.getByLabelText(/^Website URL/)).toBe(address);
    expect(
      screen.getByText("The page to check, like https://example.com."),
    ).toBeVisible();
    expect(
      address.compareDocumentPosition(nameInput()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Read left to right on every page, a right-to-left one too.
    expect(address).toHaveAttribute("dir", "ltr");
  });

  test("every type whose check is of one address asks it, named as the type names it", async () => {
    const asked: Array<[string, RegExp]> = [
      [MonitorType.Website, /^Website URL/],
      [MonitorType.API, /^API URL/],
      [MonitorType.Ping, /^Hostname or IP Address/],
      [MonitorType.Port, /^Hostname or IP Address/],
      [MonitorType.SSLCertificate, /^Website URL/],
    ];

    await renderPage();

    for (const [type, label] of asked) {
      if (screen.queryByTestId("card-select-change")) {
        fireEvent.click(screen.getByTestId("card-select-change"));
      }

      fireEvent.click(screen.getByTestId(`card-select-option-${type}`));

      expect([type, screen.getByLabelText(label)]).toEqual([
        type,
        addressInput(),
      ]);
    }

    // A heartbeat has no address to check.
    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Incoming Request"));

    expect(
      screen.queryByTestId("monitor-address-input"),
    ).not.toBeInTheDocument();
  });

  test("the IP, NTP and DNS types from the long tail: an address for the first two, the DNS criteria step's own for the third", async () => {
    await renderPage();

    for (const [type, isAsked] of [
      [MonitorType.IP, true],
      [MonitorType.NTP, true],
      [MonitorType.DNS, false],
    ] as Array<[string, boolean]>) {
      if (screen.queryByTestId("card-select-change")) {
        fireEvent.click(screen.getByTestId("card-select-change"));
      }

      if (
        screen.getByTestId("card-select-more").getAttribute("aria-expanded") !==
        "true"
      ) {
        fireEvent.click(screen.getByTestId("card-select-more"));
      }

      fireEvent.click(screen.getByTestId(`card-select-option-${type}`));

      expect([
        type,
        Boolean(screen.queryByTestId("monitor-address-input")),
      ]).toEqual([type, isAsked]);
    }
  });

  test("the name follows the address, until a name of the person's own is written", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));

    typeAddress("https://www.acme-commerce.example/shop/");
    expect(nameInput()).toHaveValue("acme-commerce.example/shop");

    typeAddress("https://www.acme-commerce.example/cart");
    expect(nameInput()).toHaveValue("acme-commerce.example/cart");

    typeName("Checkout");
    typeAddress("https://www.acme-commerce.example/checkout");
    expect(nameInput()).toHaveValue("Checkout");
  });

  test("a name the person wrote first is never replaced by the address", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Ping"));
    typeName("Office router");
    typeAddress("router.office.example");

    expect(nameInput()).toHaveValue("Office router");
  });

  test("a Port monitor asks its port beside the host, and is named after both", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Port"));
    typeAddress("db.acme.example");

    const port: HTMLElement = screen.getByRole("textbox", { name: /^Port/ });

    expect(port).toHaveAttribute("placeholder", "443");

    fireEvent.change(port, { target: { value: "5432" } });

    expect(nameInput()).toHaveValue("db.acme.example:5432");
  });

  test("a Port monitor with no port says so, and Next stays", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Port"));
    typeAddress("db.acme.example");
    await pressNext();

    expect(
      await screen.findByText("Enter the port to check, like 443."),
    ).toBeVisible();
    expect(screen.queryByTestId("criteria-editor")).not.toBeInTheDocument();
  });

  test("no address, or one that is not one, says so, and Next stays on What to Monitor", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeName("Marketing site");
    await pressNext();

    expect(
      await screen.findByText("Enter the address to check."),
    ).toBeVisible();
    expect(screen.queryByTestId("criteria-editor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Ping"));
    typeAddress("not a host!");
    await pressNext();

    expect(screen.queryByTestId("criteria-editor")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enter the address to check."),
    ).not.toBeInTheDocument();
  });

  test("Criteria is handed the address: its steps are seeded with it, and it says what it checks", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-API"));
    typeAddress("https://api.acme.example/health");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    const props: Record<string, any> = lastCriteriaEditorProps();

    expect(props["isAddressAskedFirst"]).toBe(true);
    expect(props["seedStep"]?.monitorType).toBe(MonitorType.API);
    expect(props["seedStep"]?.monitorDestination?.toString()).toBe(
      "https://api.acme.example/health",
    );
    // The name the address made reaches the criteria's words.
    expect(props["monitorName"]).toBe("api.acme.example/health");
  });

  test("a type with no address is not told one was asked", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Incoming Request"));
    typeName("Nightly backup");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    expect(lastCriteriaEditorProps()["isAddressAskedFirst"]).toBe(false);
  });

  test("an address changed after a walk back is the one the steps hold", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://old.acme.example");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    await act(async () => {
      fireEvent.click(screen.getByText("What to Monitor"));
    });

    typeAddress("https://new.acme.example");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    const initialValue: any = lastCriteriaEditorProps()["initialValue"];

    expect(
      initialValue?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestination?.toString(),
    ).toBe("https://new.acme.example/");
  });

  test("a template's address opens on What to Monitor", async () => {
    const MonitorStepsType: any = (
      jest.requireActual("../../../Types/Monitor/MonitorSteps") as any
    ).default;
    const URLType: any = (jest.requireActual("../../../Types/API/URL") as any)
      .default;

    const steps: any = MonitorStepsType.getDefaultMonitorSteps({
      monitorType: MonitorType.API,
      monitorName: "Checkout API",
      defaultMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
      onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
      offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
      defaultIncidentSeverityId: new ObjectID(SEVERITY_ID),
      defaultAlertSeverityId: new ObjectID(SEVERITY_ID),
    });

    steps.data.monitorStepsInstanceArray[0].setMonitorDestination(
      URLType.fromString("https://api.acme.example/checkout"),
    );

    getItemMock.mockImplementation(async (params: any): Promise<any> => {
      if (params.modelType === MonitorTemplate) {
        const template: MonitorTemplate = new MonitorTemplate();
        template._id = TEMPLATE_ID;
        template.monitorName = "Checkout API";
        template.monitorType = MonitorType.API;
        template.monitorSteps = steps;
        return template;
      }

      return { doNotAddGlobalProbesByDefaultOnNewMonitors: false };
    });

    await renderPage({ monitorTemplateId: TEMPLATE_ID });

    await waitFor(() => {
      expect(addressInput()).toHaveValue("https://api.acme.example/checkout");
    });
    expect(nameInput()).toHaveValue("Checkout API");
  });
});

/*
 * #7985: Test Monitor, on the Criteria step, opened on an empty Select Probe
 * though the form had its probes picked. The step is handed the probes the
 * form holds - the project's defaults until Probes & Interval changes them -
 * and the test starts on the first (MonitorTestForm's own suite checks
 * what its picker starts on).
 */
describe("the probes Test Monitor starts on", () => {
  test("one probe: the Criteria step is handed it", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    expect(lastCriteriaEditorProps()["testProbeIds"]).toEqual([
      GLOBAL_PROBE_ID,
    ]);
  });

  test("two probes picked by default: both, in the form's order", async () => {
    const SECOND_PROBE_ID: string = "0c000000-0000-4000-8000-0000000000a2";

    probesForTest = [
      ...ONE_GLOBAL_PROBE,
      {
        _id: SECOND_PROBE_ID,
        name: "Second global probe",
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: true,
      },
    ];

    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeAddress("https://marketing.example");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    expect(lastCriteriaEditorProps()["testProbeIds"]).toEqual([
      GLOBAL_PROBE_ID,
      SECOND_PROBE_ID,
    ]);
  });
});
