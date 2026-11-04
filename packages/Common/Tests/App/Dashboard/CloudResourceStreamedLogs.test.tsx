import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A cloud resource's Logs tab: what an AWS connection's stream delivered
 * from the CloudWatch Logs group AWS names after the resource. The stream
 * stamps each log with the resource's ARN as the cloud.resource_id resource
 * attribute (CloudLogGroups), so the tab asks for exactly that - never the
 * project's every log - and names the resource on its locked chip. The
 * resource's view shows the tab in its menu only for a kind of resource a
 * log group names: a function or a database has it, a bucket does not.
 */

const MODEL_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const FUNCTION_ARN: string =
  "arn:aws:lambda:us-east-1:123456789012:function:checkout";

const getItemMock: MockFunction = getJestMockFunction();
const logsViewerMock: MockFunction = getJestMockFunction();
const sideMenuMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-3333-4aaa-8bbb-000000000003");
      },
      getRoutePath: () => {
        return "";
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        logsViewerMock(props);
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

// The view's frame: what it draws as its menu, and its page.
jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: {
      sideMenu?: ReactNode;
      children?: ReactNode;
    }): ReactElement => {
      return (
        <div data-testid="view">
          {props.sideMenu}
          {props.children}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (props: { hasStreamedLogs?: boolean }) => {
        sideMenuMock(props);
        return (
          <nav
            data-testid="side-menu"
            data-has-logs={String(Boolean(props.hasStreamedLogs))}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CloudBreadcrumbs",
  () => {
    return {
      __esModule: true,
      getCloudBreadcrumbs: () => {
        return [];
      },
    };
  },
);

import CloudResourceLogs, {
  CLOUD_RESOURCE_LOGS_NOT_FOUND,
  getCloudResourceLogsQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Logs";
import CloudResourceViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Layout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "../../../Types/Cloud/CloudLogGroups";
import {
  SavedViewScopeKind,
  buildSavedViewScope,
} from "../../../Utils/Telemetry/SavedViewScope";
import ObjectID from "../../../Types/ObjectID";

type ViewerProps = Record<string, unknown>;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function lastViewerProps(): ViewerProps {
  const calls: Array<Array<unknown>> = logsViewerMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
}

beforeEach(() => {
  getItemMock.mockReset();
  logsViewerMock.mockReset();
  sideMenuMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a cloud resource's Logs tab", () => {
  test("asks for the logs stamped with the resource's ARN, and only those", async () => {
    getItemMock.mockResolvedValue({
      name: "checkout",
      providerResourceId: FUNCTION_ARN,
    });

    render(<CloudResourceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    const props: ViewerProps = lastViewerProps();

    expect(STORED_CLOUD_RESOURCE_ID_ATTRIBUTE).toBe(
      "resource.cloud.resource_id",
    );
    expect(props["logQuery"]).toEqual({
      attributes: { "resource.cloud.resource_id": FUNCTION_ARN },
    });
    // The chip names the resource, not its ARN.
    expect(props["attributeFilterDisplayKeys"]).toEqual({
      "resource.cloud.resource_id": "Resource",
    });
    expect(props["attributeFilterDisplayValues"]).toEqual({
      "resource.cloud.resource_id": "checkout",
    });
    // Saved views are the resource's own.
    expect(props["savedViewScope"]).toEqual(
      buildSavedViewScope(
        SavedViewScopeKind.CloudMonitoredResource,
        new ObjectID(MODEL_ID),
      ),
    );
    // How logs get here: a stream, set up on the account's connection.
    expect(props["noLogsMessage"]).toContain("Stream metrics and logs");
  });

  test("reads the resource's name and ARN, and nothing else of it", async () => {
    getItemMock.mockResolvedValue({
      name: "checkout",
      providerResourceId: FUNCTION_ARN,
    });

    render(<CloudResourceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, boolean> })
        .select,
    ).toEqual({ name: true, providerResourceId: true });
  });

  test("a resource without a name is named on its chip by its ARN", async () => {
    getItemMock.mockResolvedValue({ providerResourceId: FUNCTION_ARN });

    render(<CloudResourceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    expect(lastViewerProps()["attributeFilterDisplayValues"]).toEqual({
      "resource.cloud.resource_id": FUNCTION_ARN,
    });
  });

  test.each([
    ["is not there", null],
    ["has no ARN", { name: "checkout" }],
    ["has an empty ARN", { name: "checkout", providerResourceId: "" }],
  ])(
    "a resource that %s says so, and never shows the project's every log",
    async (_case: string, item: unknown) => {
      getItemMock.mockResolvedValue(item);

      render(<CloudResourceLogs {...PAGE_PROPS} />);

      expect(await screen.findByTestId("error-message")).toHaveTextContent(
        CLOUD_RESOURCE_LOGS_NOT_FOUND,
      );
      expect(logsViewerMock).not.toHaveBeenCalled();
    },
  );

  test("its query always names one resource", () => {
    expect(getCloudResourceLogsQuery(FUNCTION_ARN)).toEqual({
      attributes: { [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: FUNCTION_ARN },
    });
  });
});

describe("the resource's menu has Logs for a kind a log group names", () => {
  async function openView(item: Record<string, unknown> | null): Promise<void> {
    getItemMock.mockResolvedValue(item);

    await act(async () => {
      render(
        <MemoryRouter
          initialEntries={[`/dashboard/${PROJECT_ID}/cloud/${MODEL_ID}`]}
        >
          <Routes>
            <RouterRoute
              path="/dashboard/:projectId/cloud/:id"
              element={<CloudResourceViewLayout {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  function menuHasLogs(): string | null {
    return screen.getByTestId("side-menu").getAttribute("data-has-logs");
  }

  test.each([
    ["an AWS Lambda function", "aws", "AWS::Lambda::Function"],
    ["an RDS database", "aws", "AWS::RDS::DBInstance"],
    ["an Aurora cluster", "aws", "AWS::RDS::DBCluster"],
    ["an App Runner service", "aws", "AWS::AppRunner::Service"],
  ])("%s has Logs", async (_kind: string, provider: string, type: string) => {
    await openView({
      cloudResourceKind: "resource",
      cloudProvider: provider,
      cloudResourceType: type,
    });

    expect(menuHasLogs()).toBe("true");
  });

  test.each([
    ["an S3 bucket", "aws", "AWS::S3::Bucket"],
    ["an EC2 instance", "aws", "AWS::EC2::Instance"],
    ["an Azure function", "azure", "AWS::Lambda::Function"],
    ["a resource of no type", "aws", undefined],
  ])(
    "%s has none",
    async (_kind: string, provider: string, type: string | undefined) => {
      await openView({
        cloudResourceKind: "resource",
        cloudProvider: provider,
        cloudResourceType: type,
      });

      expect(menuHasLogs()).toBe("false");
    },
  );

  test("the view reads the kind and what the menu needs, once", async () => {
    await openView({
      cloudResourceKind: "resource",
      cloudProvider: "aws",
      cloudResourceType: "AWS::Lambda::Function",
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, boolean> })
        .select,
    ).toEqual({
      cloudResourceKind: true,
      cloudProvider: true,
      cloudResourceType: true,
    });
  });

  test("a row that cannot be read draws the menu without Logs", async () => {
    getItemMock.mockRejectedValue(new Error("You cannot read this resource."));

    await act(async () => {
      render(
        <MemoryRouter
          initialEntries={[`/dashboard/${PROJECT_ID}/cloud/${MODEL_ID}`]}
        >
          <Routes>
            <RouterRoute
              path="/dashboard/:projectId/cloud/:id"
              element={<CloudResourceViewLayout {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(menuHasLogs()).toBe("false");
  });
});
