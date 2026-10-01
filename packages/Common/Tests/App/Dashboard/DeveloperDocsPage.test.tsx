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
import DeveloperDocsPage from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPage";
import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import { DEVELOPER_DOCS_NOT_FOUND_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Clipboard from "../../../UI/Utils/Clipboard";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo } from "./SideMenuHarness";

/*
 * The Developer page as people see it: what it fetches (never a secret, and
 * only what the viewer may read), and what it shows for one resource and for
 * a whole type, on each of its three pages.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const WORKFLOW_ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
const MONITOR_ID: string = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
const LABEL_ID: string = "0b1c2d3e-0000-4000-8000-00000000000a";

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

function workflow(): Workflow {
  const label: Label = new Label();
  label._id = LABEL_ID;
  label.name = "production";
  label.color = new Color("#ff0000");

  const item: Workflow = new Workflow();
  item._id = WORKFLOW_ID;
  item.name = "Send weekly report";
  item.description = "Mails the ops team";
  item.isEnabled = true;
  item.labels = [label];
  return item;
}

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item._id = MONITOR_ID;
  item.name = "API Health";
  item.monitorType = MonitorType.Manual;
  return item;
}

function renderPage(data: {
  modelType: typeof Workflow | typeof Monitor;
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
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a workflow's Terraform page", () => {
  test("shows its real configuration, with the import block and this installation's provider", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow" "send_weekly_report"/);

    const text: string = guide().textContent || "";

    expect(text).toContain('name        = "Send weekly report"');
    expect(text).toContain("is_enabled  = true");
    expect(text).toContain(`labels      = ["${LABEL_ID}"]`);
    expect(text).toContain(`id = "${WORKFLOW_ID}"`);
    expect(text).toContain('oneuptime_url = "https://oneuptime.acme.com"');
    expect(text).toContain('version = ">= 14.0, <= 14.0.11"');
    expect(text).toContain(
      `[Project Settings → API Keys](/dashboard/${PROJECT_ID}/settings/api-keys)`,
    );
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

    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: Workflow }),
    );
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

  test("asks only for the fields the viewer may read (an unreadable one fails the whole request)", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    expect(lastSelect(getItemMock)).toEqual({ _id: true });
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

  test("a master admin may read everything that is not a secret", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    await screen.findByText(/resource "oneuptime_workflow"/);

    const select: JSONObject = lastSelect(getItemMock);

    expect(select["isEnabled"]).toBe(true);
    expect(Object.keys(select)).not.toContain("webhookSecretKey");
  });

  test("says when the workflow is gone", async () => {
    getItemMock.mockResolvedValue(null);

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Terraform,
    });

    expect(await screen.findByText(DEVELOPER_DOCS_NOT_FOUND_MESSAGE)).toBeInTheDocument();
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

describe("a workflow's API page", () => {
  test("fetches only the name, and shows curl for this workflow", async () => {
    getItemMock.mockResolvedValue(workflow());

    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.View,
      page: DeveloperDocsPageType.Api,
    });

    await screen.findByText(/get-item/);

    expect(lastSelect(getItemMock)).toEqual({ _id: true, name: true });

    const text: string = guide().textContent || "";

    expect(text).toContain(
      `curl -X POST https://oneuptime.acme.com/api/workflow/${WORKFLOW_ID}/get-item`,
    );
    expect(text).toContain(
      `curl -X DELETE https://oneuptime.acme.com/api/workflow/${WORKFLOW_ID}`,
    );
    expect(
      within(screen.getByTestId("developer-docs-links")).getByText(
        "Workflow API reference",
      ),
    ).toHaveAttribute("href", "https://oneuptime.acme.com/reference/workflow");
  });
});

describe("the Workflows menu's pages", () => {
  test("Terraform lists the existing workflows to import, oldest first", async () => {
    getListMock.mockResolvedValue({
      data: [workflow()],
      count: 1,
      skip: 0,
      limit: 100,
    });

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
    expect(getItemMock).not.toHaveBeenCalled();
    expect(guide().textContent).toContain(
      'resource "oneuptime_workflow" "my_workflow"',
    );
  });

  test("API needs no fetch at all", async () => {
    renderPage({
      modelType: Workflow,
      scope: DeveloperDocsScope.List,
      page: DeveloperDocsPageType.Api,
    });

    expect(
      await screen.findByText(/get-list\?skip=0&limit=10/),
    ).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("AI Assistants", () => {
  test("for a monitor: connect the MCP server, then prompts that each copy", async () => {
    routeId = MONITOR_ID;
    getItemMock.mockResolvedValue(monitor());
    const copy: jest.SpiedFunction<typeof Clipboard.copyToClipboard> = jest
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
    expect(guide().textContent).toContain(
      "claude mcp add --transport http oneuptime https://oneuptime.acme.com/mcp",
    );

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

    expect(await screen.findByTestId("developer-docs-notice")).toHaveTextContent(
      "OneUptime's MCP server does not have tools for workflows yet.",
    );
  });
});
