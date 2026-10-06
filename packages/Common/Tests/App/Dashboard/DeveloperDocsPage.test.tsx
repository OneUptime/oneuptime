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
import React from "react";
import DeveloperDocsPage, {
  getReadableDeveloperDocsLookup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPage";
import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import { DEVELOPER_DOCS_NOT_FOUND_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Team from "../../../Models/DatabaseModels/Team";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getDeveloperDocsLookup } from "../../../Utils/DeveloperDocs/LiveData";
import Clipboard from "../../../UI/Utils/Clipboard";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo } from "./SideMenuHarness";

/*
 * The Developer page as people see it: what it fetches (never a secret,
 * only what the viewer may read, and only the kinds of record its examples
 * use), how it copes when a lookup fails, and what it shows for one
 * resource and for a whole type, on each of its three pages.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const WORKFLOW_ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
const MONITOR_ID: string = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
const INCIDENT_ID: string = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
const LABEL_ID: string = "0b1c2d3e-0000-4000-8000-00000000000a";
const CRITICAL_ID: string = "a0000001-0000-4000-8000-000000000001";
const TEAM_ID: string = "10000001-0000-4000-8000-000000000001";
const USER_ID: string = "0aa1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";

let routeId: string = WORKFLOW_ID;

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getListMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("react-router-dom", () => {
  return {
    __esModule: true,
    useParams: () => {
      return { id: routeId, projectId: PROJECT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

// This installation: a self-hosted OneUptime on 14.0.11.
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const ProtocolType: { HTTPS: unknown } = (
    jest.requireActual("../../../Types/API/Protocol") as {
      default: { HTTPS: unknown };
    }
  ).default;
  const VersionType: new (version: string) => unknown = (
    jest.requireActual("../../../Types/Version") as {
      default: new (version: string) => unknown;
    }
  ).default;

  return {
    __esModule: true,
    ...actual,
    HOST: "oneuptime.acme.com",
    HTTP_PROTOCOL: ProtocolType.HTTPS,
    VERSION: new VersionType("14.0.11"),
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

function label(): Label {
  const item: Label = new Label();
  item._id = LABEL_ID;
  item.name = "production";
  item.color = new Color("#ff0000");
  return item;
}

function workflow(): Workflow {
  const item: Workflow = new Workflow();
  item._id = WORKFLOW_ID;
  item.name = "Send weekly report";
  item.description = "Mails the ops team";
  item.isEnabled = true;
  item.labels = [label()];
  return item;
}

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item._id = MONITOR_ID;
  item.name = "API Health";
  item.monitorType = MonitorType.Manual;
  return item;
}

function incident(): Incident {
  const item: Incident = new Incident();
  item._id = INCIDENT_ID;
  item.title = "Checkout requests are failing";
  item.incidentSeverityId = new ObjectID(CRITICAL_ID);
  return item;
}

function severity(): IncidentSeverity {
  const item: IncidentSeverity = new IncidentSeverity();
  item._id = CRITICAL_ID;
  item.name = "Critical Incident";
  return item;
}

function team(): Team {
  const item: Team = new Team();
  item._id = TEAM_ID;
  item.name = "Platform";
  return item;
}

// What the project has, by table: answered for any list the page asks for.
const PROJECT: Record<string, () => Array<BaseModel>> = {
  Workflow: () => {
    return [workflow()];
  },
  Label: () => {
    return [label()];
  },
  Monitor: () => {
    return [monitor()];
  },
  Incident: () => {
    return [incident()];
  },
  IncidentSeverity: () => {
    return [severity()];
  },
  Team: () => {
    return [team()];
  },
};

interface ListCall {
  modelType: DatabaseBaseModelType;
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

function answerLists(): void {
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const call: ListCall = args[0] as ListCall;
    const table: string = new call.modelType().tableName || "";
    let data: Array<BaseModel> = (
      PROJECT[table] ||
      (() => {
        return [];
      })
    )();
    const ids: Includes | undefined = (call.query || {})["_id"] as
      | Includes
      | undefined;

    if (ids instanceof Includes) {
      data = data.filter((item: BaseModel): boolean => {
        return (ids.values as Array<string>).includes(item._id || "");
      });
    }

    return { data, count: data.length, skip: 0, limit: call.limit };
  });
}

function listCalls(): Array<ListCall> {
  return getListMock.mock.calls.map((call: Array<unknown>): ListCall => {
    return call[0] as ListCall;
  });
}

function listedTables(): Array<string> {
  return listCalls()
    .map((call: ListCall): string => {
      return new call.modelType().tableName || "";
    })
    .sort();
}

function renderPage(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScope;
  page: DeveloperDocsPageType;
}): void {
  render(
    <DeveloperDocsPage
      pageRoute={new Route("/")}
      currentProject={null}
      hasPaymentMethod={false}
      resource={getDeveloperDocsResource(data.modelType)}
      scope={data.scope}
      page={data.page}
    />,
  );
}

function lastSelect(mock: jest.Mock<any, any>): JSONObject {
  const call: Array<unknown> | undefined = mock.mock.calls[
    mock.mock.calls.length - 1
  ] as Array<unknown> | undefined;

  return ((call?.[0] as { select?: JSONObject })?.select || {}) as JSONObject;
}

function guide(): HTMLElement {
  return screen.getByTestId("developer-docs-guide");
}

beforeEach(() => {
  routeId = WORKFLOW_ID;
  // The project comes from the URL, as it does in the dashboard.
  goTo(`/dashboard/${PROJECT_ID}/workflows/${WORKFLOW_ID}/developer/terraform`);
  getItemMock.mockReset();
  getListMock.mockReset();
  answerLists();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a workflow's Terraform page", () => {
  test("shows its real configuration, naming its label, with the import block and this installation's provider", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(
      /resource "oneuptime_workflow" "send_weekly_report"/,
    );

    const text: string = guide().textContent || "";

    expect(text).toContain('name        = "Send weekly report"');
    expect(text).toContain("is_enabled  = true");
    expect(text).toContain(`labels      = ["${LABEL_ID}"] # production`);
    expect(text).toContain(`id = "${WORKFLOW_ID}"`);
    expect(text).toContain('oneuptime_url = "https://oneuptime.acme.com"');
    expect(text).toContain('version = ">= 14.0, <= 14.0.11"');
    expect(text).toContain(
      `[Project Settings → API Keys](/dashboard/${PROJECT_ID}/settings/api-keys)`,
    );
  });

  test("looks up the names of the records its ids point at, by id, and nothing else", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    expect(listedTables()).toEqual(["Label"]);

    const call: ListCall = listCalls()[0] as ListCall;

    expect((call.query["_id"] as Includes).values).toEqual([LABEL_ID]);
    expect(call.select).toEqual({ _id: true, name: true });
  });

  test("never asks for a secret, and fetches labels as ids", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    const select: JSONObject = lastSelect(getItemMock);

    expect(select).toEqual(
      expect.objectContaining({
        _id: true,
        name: true,
        description: true,
        isEnabled: true,
        graph: true,
        labels: { _id: true },
      }),
    );
    expect(Object.keys(select)).not.toContain("webhookSecretKey");
    expect(Object.keys(select)).not.toContain("incomingEmailSecretKey");
  });

  test("asks only for what the viewer may read: no fields, and no lookups of tables they cannot read", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    expect(lastSelect(getItemMock)).toEqual({ _id: true });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a workflow reader may read its configuration", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadWorkflow]);
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    expect(lastSelect(getItemMock)).toEqual(
      expect.objectContaining({
        name: true,
        isEnabled: true,
        graph: true,
        labels: { _id: true },
      }),
    );
  });

  test("Read All Operational Resources reads its configuration too, as the server lets it", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadAllOperationalResources]);
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    const select: JSONObject = lastSelect(getItemMock);

    expect(select).toEqual(
      expect.objectContaining({
        name: true,
        isEnabled: true,
        graph: true,
        labels: { _id: true },
      }),
    );
    expect(Object.keys(select)).not.toContain("webhookSecretKey");
  });

  test("a lookup that fails only costs its names: the page still shows the configuration", async () => {
    getItemMock.mockResolvedValue(workflow());
    getListMock.mockRejectedValue(new Error("Labels are down."));

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    const text: string = guide().textContent || "";

    expect(text).toContain(`labels      = ["${LABEL_ID}"]\n`);
    expect(text).not.toContain("Labels are down.");
  });

  test("says when the workflow is gone", async () => {
    getItemMock.mockResolvedValue(null);

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    expect(
      await screen.findByText(DEVELOPER_DOCS_NOT_FOUND_MESSAGE),
    ).toBeInTheDocument();
  });

  test("shows the error when the fetch fails, and tries again on refresh", async () => {
    getItemMock.mockRejectedValueOnce(new Error("The API is down."));
    getItemMock.mockResolvedValueOnce(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    expect(await screen.findByText("The API is down.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByText(/resource "oneuptime_workflow"/);
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

describe("an incident's API page", () => {
  test("reads the fields its example asks for, and shows them as the answer", async () => {
    routeId = INCIDENT_ID;
    getItemMock.mockResolvedValue(incident());

    renderPage({
      modelType: Incident,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Api,
    });

    await screen.findAllByText(/get-item/);

    expect(lastSelect(getItemMock)).toEqual({
      _id: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      currentIncidentStateId: true,
      declaredAt: true,
      createdAt: true,
    });

    const text: string = guide().textContent || "";

    expect(text).toContain(
      `curl -X POST https://oneuptime.acme.com/api/incident/${INCIDENT_ID}/get-item`,
    );
    expect(text).toContain("It answers with:");
    expect(text).toContain('"title": "Checkout requests are failing"');
  });

  test("looks up the severities to move it to and the states to acknowledge it with", async () => {
    routeId = INCIDENT_ID;
    getItemMock.mockResolvedValue(incident());

    renderPage({
      modelType: Incident,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Api,
    });

    await screen.findAllByText(/get-item/);

    expect(listedTables()).toEqual(["IncidentSeverity", "IncidentState"]);
  });

  test("shows its common tasks as tabs, each with its own request", async () => {
    routeId = INCIDENT_ID;
    getItemMock.mockResolvedValue(incident());

    renderPage({
      modelType: Incident,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Api,
    });

    await screen.findAllByText(/get-item/);

    const sections: Array<HTMLElement> = screen.getAllByTestId(
      "developer-docs-section",
    );

    expect(
      sections.map((section: HTMLElement): string => {
        return section.querySelector("h3")?.textContent || "";
      }),
    ).toEqual(["Common tasks", "Endpoints"]);

    const tasks: HTMLElement = sections[0] as HTMLElement;

    expect(
      within(tasks)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual([
      "Acknowledge it",
      "Resolve it",
      "Internal note",
      "Public update",
    ]);
    expect(tasks.textContent).toContain("/api/incident-state-timeline");

    fireEvent.click(within(tasks).getByRole("tab", { name: "Internal note" }));

    expect(tasks.textContent).toContain("/api/incident-internal-note");
    expect(tasks.textContent).not.toContain("/api/incident-state-timeline");
  });
});

describe("the Workflows menu's pages", () => {
  test("Terraform lists the existing workflows to import, oldest first, and the labels a new one can carry", async () => {
    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.List,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/to = oneuptime_workflow.send_weekly_report/);

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Workflow,
        limit: 100,
        skip: 0,
        select: { _id: true, name: true },
      }),
    );
    expect(listedTables()).toEqual(["Label", "Workflow"]);
    expect(getItemMock).not.toHaveBeenCalled();
    expect(guide().textContent).toContain(
      'resource "oneuptime_workflow" "notify_the_team_about_new_incidents"',
    );
    expect(guide().textContent).toContain(`["${LABEL_ID}"] # production`);
  });

  test("API shows the first workflow as the list request returns it", async () => {
    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.List,
      page: DeveloperDocsPageType.Api,
    });

    expect(
      await screen.findByText(/get-list\?skip=0&limit=10/),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();

    const sample: ListCall | undefined = listCalls().find(
      (call: ListCall): boolean => {
        return call.modelType === Workflow;
      },
    );

    expect(sample?.limit).toBe(1);
    expect(sample?.select).toEqual({
      _id: true,
      name: true,
      description: true,
      isEnabled: true,
      createdAt: true,
    });
    expect(guide().textContent).toContain('"count": 1');
    expect(guide().textContent).toContain('"name": "Send weekly report"');
  });

  test("API still shows its commands when the first workflow cannot be read", async () => {
    getListMock.mockRejectedValue(new Error("No."));

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.List,
      page: DeveloperDocsPageType.Api,
    });

    expect(
      await screen.findByText(/get-list\?skip=0&limit=10/),
    ).toBeInTheDocument();
    expect(guide().textContent).not.toContain("It answers with:");
  });
});

describe("the Incidents list's Terraform page", () => {
  test("declares an incident with this project's severity, and shows the setups as tabs", async () => {
    routeId = "";

    renderPage({
      modelType: Incident,
      scope: DeveloperDocsScope.List,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/Declare an incident/);

    expect(listedTables()).toEqual(
      expect.arrayContaining([
        "Incident",
        "IncidentSeverity",
        "Label",
        "Monitor",
        "MonitorStatus",
        "Team",
      ]),
    );
    expect(guide().textContent).toContain(`"${CRITICAL_ID}"`);
    expect(guide().textContent).toContain("# Critical Incident");

    const setups: HTMLElement = screen.getByTestId("developer-docs-section");

    expect(within(setups).getAllByRole("tab")).toHaveLength(2);
  });
});

describe("AI Assistants", () => {
  test("for a monitor: connect the MCP server, then prompts that each copy; no lookups", async () => {
    routeId = MONITOR_ID;
    getItemMock.mockResolvedValue(monitor());
    const copy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockResolvedValue(true);

    renderPage({
      modelType: Monitor,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.AiAssistants,
    });

    const prompts: HTMLElement = await screen.findByTestId(
      "developer-docs-prompts",
    );
    const items: Array<HTMLElement> = within(prompts).getAllByRole("listitem");

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]?.textContent).toContain(
      `the monitor "API Health" (ID ${MONITOR_ID})`,
    );
    expect(screen.queryByTestId("developer-docs-notice")).toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
    expect(lastSelect(getItemMock)).toEqual({ _id: true, name: true });

    fireEvent.click(within(items[0]!).getByRole("button"));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith(
        expect.stringContaining(`the monitor "API Health" (ID ${MONITOR_ID})`),
      );
    });
  });

  test("for a workflow, which the MCP server does not cover, it says so", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.AiAssistants,
    });

    expect(
      await screen.findByTestId("developer-docs-notice"),
    ).toHaveTextContent(
      "OneUptime's MCP server does not have tools for workflows yet.",
    );
  });
});

describe("what a lookup may ask for", () => {
  const can: {
    model: (modelType: DatabaseBaseModelType) => boolean;
    column: (modelType: DatabaseBaseModelType, column: string) => boolean;
  } = {
    model: (modelType: DatabaseBaseModelType): boolean => {
      return modelType !== Team;
    },
    column: (_modelType: DatabaseBaseModelType, column: string): boolean => {
      return column !== "isOfflineState";
    },
  };

  test("nothing from a table the viewer cannot read", () => {
    expect(
      getReadableDeveloperDocsLookup(getDeveloperDocsLookup(Team), can),
    ).toBeNull();
  });

  test("only the columns the viewer can read", () => {
    expect(
      getReadableDeveloperDocsLookup(getDeveloperDocsLookup(MonitorStatus), can)
        ?.select,
    ).toEqual({ _id: true, name: true, isOperationalState: true });
  });

  test("a lookup by ids is for names: without the name it is not made", () => {
    expect(
      getReadableDeveloperDocsLookup(getDeveloperDocsLookup(Label, ["l1"]), {
        model: can.model,
        column: (
          _modelType: DatabaseBaseModelType,
          column: string,
        ): boolean => {
          return column !== "name";
        },
      }),
    ).toBeNull();
  });
});
