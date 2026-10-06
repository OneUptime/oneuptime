import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * The Send Test button on every row of the Slack channels card and the
 * Microsoft Teams channels and chats cards posts into that channel or chat,
 * which is what a notification rule does - so the server asks what adding a
 * rule asks (TestSendAccess), and the button asks it first (TestSendLock):
 * for someone the dashboard knows may not send, it is locked, says why in
 * one plain sentence, and a click sends nothing.
 */

let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

const posts: Array<unknown> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (request: unknown): Promise<unknown> => {
        posts.push(request);
        return new HTTPResponse<JSONObject>(200, {}, {});
      },
      getFriendlyErrorMessage: (): string => {
        return "Something went wrong.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-under-test" };
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "7b100000-0000-4000-8000-000000000001";
      },
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

import SendTestNotificationButton from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton";
import PermissionUtil from "../../../UI/Utils/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "7b100000-0000-4000-8000-000000000001",
);

const storeSnapshot: (permissions: Array<Permission>) => void = (
  permissions: Array<Permission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.CurrentUser],
  });

  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  });
};

const renderButton: () => RenderResult = (): RenderResult => {
  return render(
    <SendTestNotificationButton
      route="/slack/channels/test"
      requestBody={{ channelId: "C0123456789" }}
      destinationName="#alerts"
      workspaceName="Slack"
    />,
  );
};

const theButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", {
    name: "Send test notification to #alerts",
  });
};

// The tooltip's text, as a hover over the locked button's wrapper shows it.
const tooltipText: (button: HTMLElement) => Promise<string> = async (
  button: HTMLElement,
): Promise<string> => {
  const trigger: HTMLElement = button.parentElement || button;

  fireEvent.mouseEnter(trigger);

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return document.body.textContent || "";
};

beforeEach(() => {
  billingEnabledForTest = false;
  currentPlanForTest = null;
  posts.length = 0;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("a channel's Send Test, for someone who may not send it", () => {
  test("a Viewer: locked, saying what it takes, and a click sends nothing", async () => {
    storeSnapshot([Permission.Viewer]);
    renderButton();

    const button: HTMLElement = theButton();

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(posts).toHaveLength(0);
    expect(await tooltipText(button)).toContain(
      "Sending a test needs permission to create notification rules.",
    );
  });

  test("below the plan, on OneUptime Cloud: locked, naming the plan", async () => {
    billingEnabledForTest = true;
    currentPlanForTest = "Free";
    storeSnapshot([Permission.ProjectOwner]);
    renderButton();

    const button: HTMLElement = theButton();

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(posts).toHaveLength(0);
    expect(await tooltipText(button)).toContain(
      "Sending a test needs the Growth plan.",
    );
  });
});

describe("a channel's Send Test, for someone who may", () => {
  test("a Project Member on the plan: the button sends", async () => {
    billingEnabledForTest = true;
    currentPlanForTest = "Growth";
    storeSnapshot([Permission.ProjectMember]);
    renderButton();

    const button: HTMLElement = theButton();

    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
  });

  test("while the permissions are not loaded, the button works and the server decides", async () => {
    renderButton();

    const button: HTMLElement = theButton();

    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
  });
});
