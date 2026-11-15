import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "Create Monitor" on a postmortem's action item (#6801) opens the monitor
 * create page with `?postmortemActionItemId=<id>`: the monitor is named after
 * what the item asks for and says where it comes from, and once it is
 * created the item names it and is done - then the person lands on the new
 * monitor, as from anywhere else. What it watches is the person's to pick:
 * an action item is words, not a check.
 *
 * The real page drives it, with ModelForm mocked to capture the props it is
 * handed (as MonitorCreateFromMonitorBackedDevice does); the captured
 * onSuccess is invoked un-awaited, as ModelForm invokes it.
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  onSuccess?: ((createdItem: unknown) => void) | undefined;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([]);
      },
    },
  };
});

const ACTION_ITEM_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_ID: string = "33333333-3333-4333-8333-333333333333";

let actionItemRow: IncidentPostmortemActionItem | null = null;
let actionItemReadFails: boolean = false;
let getItemRequests: Array<{
  modelType: unknown;
  select?: Record<string, unknown> | undefined;
}> = [];
let updateRequests: Array<{
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}> = [];
let linkResult: () => Promise<void> = (): Promise<void> => {
  return Promise.resolve();
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: unknown;
        select?: Record<string, unknown> | undefined;
      }): Promise<unknown> => {
        getItemRequests.push(request);

        if (request.modelType === IncidentPostmortemActionItem) {
          if (actionItemReadFails) {
            return Promise.reject(
              new Error("Your project is not allowed to read this."),
            );
          }

          return Promise.resolve(actionItemRow);
        }

        if (request.modelType === Project) {
          return Promise.resolve({
            doNotAddGlobalProbesByDefaultOnNewMonitors: false,
          });
        }

        return Promise.resolve(null);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      updateById: (request: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        updateRequests.push(request);
        return linkResult();
      },
    },
  };
});

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import { ACTION_ITEM_MONITOR_QUERY_PARAM } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemActionItem from "../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import PostmortemActionItemStatus from "../../../Types/Incident/PostmortemActionItemStatus";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

// The server's global config, answered here rather than over the network.
beforeEach((): void => {
  standInForGlobalConfig();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const navigateMock: MockFunction = getJestMockFunction();
let queryValue: string | null = ACTION_ITEM_ID;

function actionItem(
  incident: Partial<Incident> | null,
  title: string = "Alert on connection pool usage",
): IncidentPostmortemActionItem {
  const item: IncidentPostmortemActionItem = new IncidentPostmortemActionItem();
  item._id = ACTION_ITEM_ID;
  item.title = title;

  if (incident) {
    item.incident = Object.assign(new Incident(), incident);
  }

  return item;
}

function renderCreatePage(): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function openForm(): Promise<CapturedFormProps> {
  renderCreatePage();

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
    expect(capturedForm!.initialValues["name"]).toBeDefined();
  });

  return capturedForm!;
}

function createdMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID(MONITOR_ID);
  monitor.monitorType = MonitorType.Website;
  return monitor;
}

beforeEach(() => {
  capturedForm = null;
  actionItemRow = actionItem({ incidentNumber: 42 });
  actionItemReadFails = false;
  getItemRequests = [];
  updateRequests = [];
  linkResult = (): Promise<void> => {
    return Promise.resolve();
  };
  queryValue = ACTION_ITEM_ID;
  navigateMock.mockReset();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((paramName: string): string | null => {
      return paramName === ACTION_ITEM_MONITOR_QUERY_PARAM ? queryValue : null;
    });
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (...args: Array<unknown>): void => {
      navigateMock(...args);
    },
  );
  getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the monitor create page opened from a postmortem's action item", () => {
  test("names the monitor after the item, and says which incident's postmortem it comes from", async () => {
    const form: CapturedFormProps = await openForm();

    // Beside the page's own defaults (interval, probes): nothing else is filled in.
    expect(form.initialValues).toMatchObject({
      name: "Alert on connection pool usage",
      description:
        "Created for the action item Alert on connection pool usage, from the postmortem of incident #42.",
    });
    expect(form.initialValues["monitorType"]).toBeUndefined();
    expect(form.initialValues["monitorSteps"]).toBeUndefined();

    // The item is read with its incident's number, as the reader may read it.
    const read: { select?: Record<string, unknown> | undefined } | undefined =
      getItemRequests.find((request: { modelType: unknown }): boolean => {
        return request.modelType === IncidentPostmortemActionItem;
      });
    expect(read?.select).toEqual({
      title: true,
      incident: { incidentNumber: true, incidentNumberWithPrefix: true },
    });
  });

  test("an incident numbered with a prefix is named by it", async () => {
    actionItemRow = actionItem({
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
    });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["description"]).toBe(
      "Created for the action item Alert on connection pool usage, from the postmortem of incident INC-42.",
    );
  });

  test("with no incident number to name, it still says where it comes from", async () => {
    actionItemRow = actionItem(null);

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["description"]).toBe(
      "Created for the action item Alert on connection pool usage, from an incident's postmortem.",
    );
  });

  test("a long title is cut to what a monitor's name holds", async () => {
    actionItemRow = actionItem({ incidentNumber: 1 }, "a".repeat(240));

    const form: CapturedFormProps = await openForm();

    expect((form.initialValues["name"] as string).length).toBe(100);
  });

  test("once created, the item names the monitor and is done, and the person lands on the monitor", async () => {
    const form: CapturedFormProps = await openForm();

    form.onSuccess!(createdMonitor());

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateRequests).toEqual([
      {
        modelType: IncidentPostmortemActionItem,
        id: new ObjectID(ACTION_ITEM_ID),
        data: {
          monitorId: new ObjectID(MONITOR_ID),
          status: PostmortemActionItemStatus.Done,
        },
      },
    ]);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain(`/monitors/${MONITOR_ID}`);
  });

  test("an item that cannot be linked says so in place of the form, with where to finish it", async () => {
    linkResult = (): Promise<void> => {
      return Promise.reject(
        new Error("You do not have permission to edit this action item."),
      );
    };

    const form: CapturedFormProps = await openForm();
    form.onSuccess!(createdMonitor());

    expect(
      await screen.findByText(
        /The monitor was created, but its action item was not marked done\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Mark it done on the incident's postmortem\./),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("a link that names no action item says how to open it again", async () => {
    queryValue = "not-an-id";

    renderCreatePage();

    expect(
      await screen.findByText(
        "This link does not point to an action item. Open the incident's postmortem again and choose Create Monitor on the action item.",
      ),
    ).toBeInTheDocument();
  });

  test("an action item that is gone says so", async () => {
    actionItemRow = null;

    renderCreatePage();

    expect(
      await screen.findByText(
        "The action item this monitor was to be created for no longer exists.",
      ),
    ).toBeInTheDocument();
  });

  test("an item the person cannot read says why, in the server's words", async () => {
    actionItemReadFails = true;

    renderCreatePage();

    expect(
      await screen.findByText(/Your project is not allowed to read this\./),
    ).toBeInTheDocument();
  });
});
