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
 *   - Monitor Info asks what to monitor first, as six common types, then the
 *     name; the description and the labels fold under More fields;
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([
          {
            _id: "0c000000-0000-4000-8000-0000000000a1",
            name: "Global probe",
            isGlobalProbe: true,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
        ]);
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

// The query string the page opens with.
function openWith(params: Record<string, string>): void {
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (name: string): string | null => {
      return params[name] ?? null;
    },
  );
}

async function renderPage(
  params: Record<string, string> = {},
): Promise<HTMLElement> {
  openWith(params);

  render(
    <MonitorCreate
      pageRoute={new Route("/dashboard/monitors/create")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
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

describe("Monitor Info: what to monitor comes first", () => {
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

  test("Next with no type picked says so, and stays on Monitor Info", async () => {
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
        "Monitor Info",
        "Criteria",
        "Probes & Interval",
      ]);
    });

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(screen.getByTestId("card-select-option-Incoming Request"));

    await waitFor(() => {
      expect(stepTitles()).toEqual(["Monitor Info", "Criteria"]);
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
    typeName("Office router");
    await pressNext();

    const editor: HTMLElement = await screen.findByTestId("criteria-editor");

    expect(editor).toHaveAttribute("data-monitor-type", MonitorType.Ping);
    expect(editor).toHaveAttribute("data-monitor-name", "Office router");
  });
});

describe("the criteria and the last step", () => {
  test("the criteria editor folds a new monitor's default criteria", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
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

  test("a website monitor: Monitor Info, Criteria, Probes & Interval, then Create Monitor", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
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
   * A Manual monitor has no criteria and no interval: Monitor Info is its
   * only step, and the action is there.
   */
  test("a manual monitor is created from Monitor Info, with no interval", async () => {
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

  test("Change on Monitor Info, after walking on, keeps the name typed", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("card-select-option-Website"));
    typeName("Marketing site");
    await pressNext();
    await screen.findByTestId("criteria-editor");

    // Back to Monitor Info from the step list.
    await act(async () => {
      fireEvent.click(screen.getByText("Monitor Info"));
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
