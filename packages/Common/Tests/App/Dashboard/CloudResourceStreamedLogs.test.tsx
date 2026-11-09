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
import fs from "fs";
import path from "path";

/*
 * A cloud resource's Logs tab: what its connection's stream delivered
 * about it - an AWS connection's from the CloudWatch Logs group AWS names
 * after the resource, an Azure connection's from its diagnostic setting, a
 * Google Cloud connection's from Cloud Logging. The stream stamps each log
 * with the resource's id as the cloud.resource_id resource attribute
 * (CloudLogGroups), so the tab asks for exactly that - never the project's
 * every log - names the resource on its locked chip, and says in its
 * cloud's words how logs get there. The resource's view shows the tab in
 * its menu only for a kind of resource with logs of its own: a function, a
 * database or a web app has it; a bucket, an Azure virtual machine or an
 * instance group does not.
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
      default: (props: {
        hasStreamedLogs?: boolean;
        hasRecommendations?: boolean;
      }) => {
        sideMenuMock(props);
        return (
          <nav
            data-testid="side-menu"
            data-has-logs={String(Boolean(props.hasStreamedLogs))}
            data-has-recommendations={String(Boolean(props.hasRecommendations))}
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
  AZURE_RESOURCE_NO_LOGS_IN_RANGE,
  AZURE_RESOURCE_NO_STREAMED_LOGS,
  CLOUD_RESOURCE_LOGS_NOT_FOUND,
  CLOUD_RESOURCE_NO_LOGS_IN_RANGE,
  CLOUD_RESOURCE_NO_STREAMED_LOGS,
  GCP_RESOURCE_NO_LOGS_IN_RANGE,
  GCP_RESOURCE_NO_STREAMED_LOGS,
  getCloudResourceLogsQuery,
  getCloudResourceNoLogsMessage,
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

// Each cloud's empty sentences, and the action of the account's row they name.
const EMPTY_SENTENCES_BY_ACTION: Array<[Array<string>, string]> = [
  [
    [
      CLOUD_RESOURCE_NO_STREAMED_LOGS,
      CLOUD_RESOURCE_NO_LOGS_IN_RANGE,
      AZURE_RESOURCE_NO_STREAMED_LOGS,
      AZURE_RESOURCE_NO_LOGS_IN_RANGE,
    ],
    "Stream metrics and logs",
  ],
  [
    [GCP_RESOURCE_NO_STREAMED_LOGS, GCP_RESOURCE_NO_LOGS_IN_RANGE],
    "Stream logs",
  ],
];

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
    expect(props["noLogsMessage"]).toBe(CLOUD_RESOURCE_NO_STREAMED_LOGS);
    expect(props["noLogsMessage"]).toContain("Stream metrics and logs");
  });

  test.each([
    [
      "aws",
      "Stream metrics and logs",
      CLOUD_RESOURCE_NO_STREAMED_LOGS,
      CLOUD_RESOURCE_NO_LOGS_IN_RANGE,
    ],
    [
      "azure",
      "Stream metrics and logs",
      AZURE_RESOURCE_NO_STREAMED_LOGS,
      AZURE_RESOURCE_NO_LOGS_IN_RANGE,
    ],
    [
      "gcp",
      "Stream logs",
      GCP_RESOURCE_NO_STREAMED_LOGS,
      GCP_RESOURCE_NO_LOGS_IN_RANGE,
    ],
    [
      undefined,
      "Stream metrics and logs",
      CLOUD_RESOURCE_NO_STREAMED_LOGS,
      CLOUD_RESOURCE_NO_LOGS_IN_RANGE,
    ],
  ])(
    "a %s resource says, in its cloud's words, how its logs get here and what to check once its account streams",
    async (
      provider: string | undefined,
      action: string,
      notStreaming: string,
      inRange: string,
    ) => {
      getItemMock.mockResolvedValue({
        name: "checkout",
        providerResourceId: FUNCTION_ARN,
        cloudProvider: provider,
      });

      render(<CloudResourceLogs {...PAGE_PROPS} />);
      await screen.findByTestId("logs-viewer");

      expect(lastViewerProps()["noLogsMessage"]).toBe(notStreaming);
      expect(notStreaming).toContain(`choose ${action} in the account's row.`);

      cleanup();
      getItemMock.mockResolvedValue({
        name: "checkout",
        providerResourceId: FUNCTION_ARN,
        cloudProvider: provider,
        cloudConnection: {
          streamKeyCreatedAt: new Date("2026-11-06T08:00:00.000Z"),
        },
      });

      render(<CloudResourceLogs {...PAGE_PROPS} />);
      await screen.findByTestId("logs-viewer");

      expect(lastViewerProps()["noLogsMessage"]).toBe(inRange);
      expect(inRange).toContain(`open ${action} in the account's row.`);
    },
  );

  test("reads the resource's name, its ARN, its cloud and whether its account streams, and nothing else of it", async () => {
    getItemMock.mockResolvedValue({
      name: "checkout",
      providerResourceId: FUNCTION_ARN,
    });

    render(<CloudResourceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({
      name: true,
      providerResourceId: true,
      cloudProvider: true,
      cloudConnection: { streamKeyCreatedAt: true },
    });
  });

  test("once its account streams, an empty list says nothing came from its log group in this time range", async () => {
    getItemMock.mockResolvedValue({
      name: "nightly-export",
      providerResourceId: FUNCTION_ARN,
      cloudConnection: {
        name: "AWS 123456789012",
        streamKeyCreatedAt: new Date("2026-11-06T08:00:00.000Z"),
      },
    });

    render(<CloudResourceLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    const message: unknown = lastViewerProps()["noLogsMessage"];

    expect(message).toBe(CLOUD_RESOURCE_NO_LOGS_IN_RANGE);
    // Not how to start a stream that already runs.
    expect(message).not.toBe(CLOUD_RESOURCE_NO_STREAMED_LOGS);
    expect(message).toContain("in this time range");
  });

  test.each([
    ["is read by no connection", {}],
    ["is read by a connection that streams nothing", { cloudConnection: {} }],
    [
      "is read by a connection whose streaming stopped",
      { cloudConnection: { name: "AWS 123456789012" } },
    ],
  ])(
    "a resource that %s says how to start streaming",
    async (_case: string, fields: Record<string, unknown>) => {
      getItemMock.mockResolvedValue({
        name: "checkout",
        providerResourceId: FUNCTION_ARN,
        ...fields,
      });

      render(<CloudResourceLogs {...PAGE_PROPS} />);
      await screen.findByTestId("logs-viewer");

      expect(lastViewerProps()["noLogsMessage"]).toBe(
        CLOUD_RESOURCE_NO_STREAMED_LOGS,
      );
    },
  );

  test("its empty sentences: how to start, and what to check once it streams", () => {
    expect(getCloudResourceNoLogsMessage(null)).toBe(
      CLOUD_RESOURCE_NO_STREAMED_LOGS,
    );
    expect(
      getCloudResourceNoLogsMessage({
        cloudConnection: { streamKeyCreatedAt: new Date() },
      } as never),
    ).toBe(CLOUD_RESOURCE_NO_LOGS_IN_RANGE);
    /*
     * Every one sends the reader to the same place, named as the Dashboard
     * draws it: the Connect page under Cloud, and the account's row there,
     * whose menu holds the cloud's streaming action.
     */
    for (const [sentences, action] of EMPTY_SENTENCES_BY_ACTION) {
      for (const sentence of sentences) {
        expect(sentence).toContain("in Cloud > Connect, ");
        expect(sentence).toContain(`${action} in the account's row.`);
      }
    }
    // Once it streams, the range comes first: the likelier reason.
    expect(
      CLOUD_RESOURCE_NO_LOGS_IN_RANGE.startsWith(
        "Nothing arrived from this resource's log group in this time range. Choose a longer range, ",
      ),
    ).toBe(true);
    for (const sentence of [
      AZURE_RESOURCE_NO_LOGS_IN_RANGE,
      GCP_RESOURCE_NO_LOGS_IN_RANGE,
    ]) {
      expect(
        sentence.startsWith(
          "Nothing arrived from this resource in this time range. Choose a longer range, ",
        ),
      ).toBe(true);
    }
  });

  test("the place and the menu items they name are the Dashboard's own: Cloud > Connect, and the row's Stream metrics and logs or Stream logs", () => {
    const dashboardDir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src",
    );
    const sideMenu: string = fs.readFileSync(
      path.join(dashboardDir, "Pages/Cloud/SideMenu.tsx"),
      "utf8",
    );
    const connections: string = fs.readFileSync(
      path.join(
        dashboardDir,
        "Components/Cloud/Connect/CloudConnectionsTable.tsx",
      ),
      "utf8",
    );

    expect(sideMenu).toContain('title: "Cloud",');
    expect(sideMenu).toContain('title: "Connect",');
    expect(connections).toContain('title: "Stream metrics and logs",');
    expect(connections).toContain('title: "Stream logs",');
  });

  test("all are read in every language the Dashboard has, and left in English in none", () => {
    const localesDir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales",
    );
    const files: Array<string> = fs
      .readdirSync(localesDir)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as Record<string, string>;

      for (const [key, action] of EMPTY_SENTENCES_BY_ACTION.flatMap(
        ([sentences, action]: [Array<string>, string]) => {
          return sentences.map((sentence: string): [string, string] => {
            return [sentence, action];
          });
        },
      )) {
        const value: string | undefined = locale[key];

        expect({ file, has: typeof value === "string" }).toEqual({
          file,
          has: true,
        });

        if (file !== "en.json") {
          expect({ file, translated: value !== key }).toEqual({
            file,
            translated: true,
          });
          /*
           * The place and the menu item as this language's Dashboard draws
           * them - its own words for Cloud > Connect, never the English
           * menu inside a translated sentence.
           */
          const place: string = `${locale["Cloud"]} > ${locale["Connect"]}`;
          const item: string = locale[action]!;

          expect({ file, place, named: value!.includes(place) }).toEqual({
            file,
            place,
            named: true,
          });
          expect({ file, item, named: value!.includes(item) }).toEqual({
            file,
            item,
            named: true,
          });
        }
      }
    }
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
    ["an Azure web app", "azure", "Microsoft.Web/sites"],
    ["an Azure SQL database", "azure", "Microsoft.Sql/servers/databases"],
    ["an Azure key vault", "azure", "Microsoft.KeyVault/vaults"],
    ["a Cloud Run service", "gcp", "cloud_run_revision"],
    ["a Compute Engine VM", "gcp", "gce_instance"],
    ["a Cloud SQL instance", "gcp", "cloudsql_database"],
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
    // Its own logs need an agent in it.
    ["an Azure virtual machine", "azure", "Microsoft.Compute/virtualMachines"],
    ["an Azure storage account", "azure", "Microsoft.Storage/storageAccounts"],
    ["a Google Cloud instance group", "gcp", "instance_group"],
    ["a Google Cloud type of no rule", "gcp", "k8s_container"],
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

/*
 * Recommendations is in the menu of a type OneUptime recommends monitors
 * for (CloudAlertTemplates) - an instance, a function, a database, a VM -
 * and not in a VPC's, a bucket's or a role's, whose tab could only ever
 * say there are none. Read from the row the view already reads.
 */
describe("the resource's menu has Recommendations for a type some monitor is recommended for", () => {
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

  function menuHasRecommendations(): string | null {
    return screen
      .getByTestId("side-menu")
      .getAttribute("data-has-recommendations");
  }

  test.each([
    ["an EC2 instance", "aws", "AWS::EC2::Instance"],
    ["a Lambda function", "aws", "AWS::Lambda::Function"],
    ["an RDS database", "aws", "AWS::RDS::DBInstance"],
    ["an Azure VM", "azure", "Microsoft.Compute/virtualMachines"],
    ["a Compute Engine VM", "gcp", "gce_instance"],
  ])(
    "%s has Recommendations",
    async (_kind: string, provider: string, type: string) => {
      await openView({
        cloudResourceKind: "resource",
        cloudProvider: provider,
        cloudResourceType: type,
      });

      expect(menuHasRecommendations()).toBe("true");
    },
  );

  test.each([
    ["a VPC", "aws", "AWS::EC2::VPC"],
    ["an S3 bucket", "aws", "AWS::S3::Bucket"],
    ["an IAM role", "aws", "AWS::IAM::Role"],
    ["an AWS type under another cloud", "azure", "AWS::EC2::Instance"],
    ["a resource of no type", "aws", undefined],
  ])(
    "%s has none",
    async (_kind: string, provider: string, type: string | undefined) => {
      await openView({
        cloudResourceKind: "resource",
        cloudProvider: provider,
        cloudResourceType: type,
      });

      expect(menuHasRecommendations()).toBe("false");
    },
  );

  test("a row that cannot be read draws the menu without Recommendations", async () => {
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

    expect(menuHasRecommendations()).toBe("false");
  });
});
