/*
 * A step's settings dialog, rendered for real, offering what the webhook
 * before it actually received - the maintainer's example. Only the network
 * and the dashboard's configured host are stubbed, so this checks the whole
 * way: the dialog asks the workflow service for the samples of the steps
 * before this one, the picker lists the body's fields with what each held,
 * and a field picked becomes a chip.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;
  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("../../../../Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

let mockStepSamples: unknown = { samples: [] };

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
      post: jest.fn(async () => {
        return { data: mockStepSamples };
      }),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return String(error);
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      }),
      getCommonHeaders: jest.fn(() => {
        return { tenantid: "project-1" };
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
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

import ComponentSettingsModal, {
  ComponentProps,
} from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import API from "../../../../UI/Utils/API/API";
import Clipboard from "../../../../UI/Utils/Clipboard";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import {
  StepSamplesResponse,
  describeSampleValue,
} from "../../../../Types/Workflow/StepSamples";
import { getWebhookTriggerCurlExample } from "../../../../Types/Workflow/WebhookTrigger";
import { CHIP_REFERENCE_ATTRIBUTE } from "../../../../UI/Components/Workflow/ValuePicker/ReferenceChip";
import getJestMockFunction from "../../../MockType";
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
  RenderResult,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";

const SECRET: string = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";
const WEBHOOK_URL: string = `https://oneuptime.example.com/workflow/trigger/${SECRET}`;
const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const TITLE: string =
  "{{local.components.webhook-1.returnValues.request-body.incident.title}}";

type MakeNodeFunction = (metadataId: string, id: string) => NodeDataProp;

const makeNode: MakeNodeFunction = (
  metadataId: string,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata) => {
      return component.id === metadataId;
    },
  )!;

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const webhook: NodeDataProp = makeNode(ComponentID.Webhook, "webhook-1");
const log: NodeDataProp = makeNode(ComponentID.Log, "log-1");

const REQUEST_RECEIVED: StepSamplesResponse = {
  samples: [
    {
      componentId: "webhook-1",
      returnValues: {
        "request-body": describeSampleValue(
          { incident: { title: "Database is down" }, environment: "prod" },
          { ranAt: new Date().toISOString() },
        ),
      },
    },
  ],
};

type RenderLogFunction = (overrides?: Partial<ComponentProps>) => RenderResult;

const renderLogSettings: RenderLogFunction = (
  overrides?: Partial<ComponentProps>,
): RenderResult => {
  const props: ComponentProps = {
    title: log.metadata.title,
    description: log.metadata.description,
    onClose: getJestMockFunction(),
    onSave: getJestMockFunction(),
    onDelete: getJestMockFunction(),
    component: log,
    graphComponents: [webhook, log],
    valueSources: {
      upstream: [webhook],
      downstreamIds: [],
      hasIncomingConnection: true,
    },
    workflowId: WORKFLOW_ID,
    webhookSecretKey: SECRET,
    canSeeWebhookSecretKey: true,
    ...(overrides || {}),
  };

  return render(<ComponentSettingsModal {...props} />);
};

type OpenPickerFunction = (user: UserEvent) => Promise<HTMLElement>;

const openValuePicker: OpenPickerFunction = async (
  user: UserEvent,
): Promise<HTMLElement> => {
  await user.click(screen.getByTestId("workflow-argument-value-insert-value"));

  return screen.findByTestId("value-picker");
};

beforeEach(() => {
  mockStepSamples = { samples: [] };
  (API.post as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a step after a webhook that has received a request", () => {
  test("asks the workflow service what the steps before it held", async () => {
    mockStepSamples = REQUEST_RECEIVED;
    renderLogSettings();

    await waitFor(() => {
      expect(API.post).toHaveBeenCalled();
    });

    const request: {
      url: { toString: () => string };
      data: unknown;
      headers: unknown;
    } = (API.post as unknown as jest.Mock).mock.calls[0]![0] as {
      url: { toString: () => string };
      data: unknown;
      headers: unknown;
    };

    expect(request.url.toString()).toBe(
      `https://oneuptime.example.com/workflow/step-samples/${WORKFLOW_ID.toString()}`,
    );
    expect(request.data).toEqual({ componentIds: ["webhook-1"] });
    expect(request.headers).toEqual({ tenantid: "project-1" });
  });

  test("offers the body's fields, and a picked one becomes a chip", async () => {
    mockStepSamples = REQUEST_RECEIVED;
    const user: UserEvent = userEvent.setup({ delay: null });

    renderLogSettings();

    const picker: HTMLElement = await openValuePicker(user);
    const body: HTMLElement = await waitFor(() => {
      const option: HTMLElement | undefined = within(picker)
        .getAllByRole("option")
        .find((candidate: HTMLElement) => {
          return candidate
            .getAttribute("data-reference")
            ?.endsWith("request-body}}");
        });

      expect(
        within(option!).getByTestId("value-picker-sample"),
      ).toHaveTextContent("2 fields");

      return option!;
    });

    await user.click(body);

    const title: HTMLElement = await waitFor(() => {
      const option: HTMLElement | undefined = within(picker)
        .getAllByRole("option")
        .find((candidate: HTMLElement) => {
          return candidate.getAttribute("data-reference") === TITLE;
        });

      expect(option).toBeDefined();

      return option!;
    });

    // Quoted: it is what the field held.
    expect(within(title).getByTestId("value-picker-sample")).toHaveTextContent(
      '"Database is down"',
    );

    await user.click(title);

    const chip: Element | null = document.querySelector(
      `[${CHIP_REFERENCE_ATTRIBUTE}="${TITLE}"]`,
    );

    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("incident.title");
  });
});

describe("a step after a webhook nothing has called yet", () => {
  test("offers a test request to the workflow's own URL", async () => {
    const copy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockResolvedValue(true as never);
    const user: UserEvent = userEvent.setup({ delay: null });

    renderLogSettings();

    const picker: HTMLElement = await openValuePicker(user);
    const note: HTMLElement = await within(picker).findByTestId(
      "value-picker-group-note",
    );

    await user.click(within(note).getByTestId("value-picker-note-copy"));

    expect(copy).toHaveBeenCalledWith(
      getWebhookTriggerCurlExample(WEBHOOK_URL),
    );
    // Copied, not shown: the dialog may be on a shared screen.
    expect(picker.textContent).not.toContain(SECRET);
  });

  test("offers no URL to someone who may not see it", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderLogSettings({ canSeeWebhookSecretKey: false });

    const picker: HTMLElement = await openValuePicker(user);
    const note: HTMLElement = await within(picker).findByTestId(
      "value-picker-group-note",
    );

    expect(within(note).queryByTestId("value-picker-note-copy")).toBeNull();
    expect(note).toHaveTextContent("The fields of the first one show up here.");
  });
});
