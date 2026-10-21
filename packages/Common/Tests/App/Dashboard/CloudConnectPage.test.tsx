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
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAwsRoleSetup } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudConnectPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Connect";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

/*
 * CLOUD > CONNECT, the page itself, with the network stubbed and the
 * connection list and form replaced by markers that show what the page
 * told them:
 *
 *   - a tile per cloud, counted from the project's connections, and three
 *     promises: read-only, read every few minutes, chart and alert;
 *   - the list shows only once something is connected, and stays; when
 *     it loads again after a change made in it (a connection deleted),
 *     the tiles count the connections again;
 *   - a tile, or an address naming a cloud, opens that cloud's form, with
 *     what this OneUptime can offer for an AWS role (asked once; a failed
 *     ask is "no role");
 *   - saving says what happens next and reads everything again;
 *   - without the right to connect, the tiles are disabled and say why,
 *     and nothing is asked about roles;
 *   - a plan without telemetry says so and reads nothing.
 */

type TableProps = {
  refreshToggle: string;
  updateGate: PermissionGateResult;
  onEdit: (connection: CloudConnection) => void;
  onConnectionsLoaded: (totalCount: number) => void;
};

type FormProps = {
  provider: CloudProvider;
  connection?: CloudConnection | undefined;
  awsRoleSetup?: CloudConnectionAwsRoleSetup | undefined;
  onClose: () => void;
  onSaved: (saved: { name: string; isNew: boolean }) => void;
};

// How many rows the list marker reports it found; undefined: still loading.
let listedForTest: number | undefined = undefined;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionsTable",
  () => {
    return {
      __esModule: true,
      default: (props: TableProps): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        ReactActual.useEffect(() => {
          if (listedForTest !== undefined) {
            props.onConnectionsLoaded(listedForTest);
          }
        }, [props.refreshToggle]);

        return ReactActual.createElement(
          "div",
          {
            "data-testid": "connections-table",
            "data-refresh": props.refreshToggle,
            "data-can-update": String(props.updateGate.isAllowed),
          },
          ReactActual.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                const connection: CloudConnection = new CloudConnection();
                connection.provider = CloudProvider.GCP;
                connection.name = "acme-prod";
                props.onEdit(connection);
              },
            },
            "Edit a connection",
          ),
          // The list loading again, as it does after a row is deleted.
          ReactActual.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                props.onConnectionsLoaded(listedForTest || 0);
              },
            },
            "Reload the list",
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionFormModal",
  () => {
    return {
      __esModule: true,
      default: (props: FormProps): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactActual.createElement(
          "div",
          {
            "data-testid": "connection-form",
            "data-provider": props.provider,
            "data-editing": String(Boolean(props.connection)),
            "data-role":
              props.awsRoleSetup === undefined
                ? "unknown"
                : String(props.awsRoleSetup.isAvailable),
          },
          ReactActual.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                props.onSaved({
                  name: "Saved",
                  isNew: !props.connection,
                });
              },
            },
            "Save the connection",
          ),
          ReactActual.createElement(
            "button",
            { type: "button", onClick: props.onClose },
            "Close the form",
          ),
        );
      },
    };
  },
);

function connection(provider: CloudProvider): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item.provider = provider;
  return item;
}

let connectionsForTest: Array<CloudConnection> = [];
let roleSetupForTest: JSONObject | Error = {
  isAvailable: true,
  trustedPrincipalArn: "arn:aws:iam::999988887777:root",
  externalId: "oneuptime-0123",
};
let createGate: PermissionGateResult = { isAllowed: true };
let updateGate: PermissionGateResult = { isAllowed: true };
let getListSpy: jest.SpyInstance<any, any>;
let getSpy: jest.SpyInstance<any, any>;

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/cloud/connect`),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);

  connectionsForTest = [];
  listedForTest = undefined;
  roleSetupForTest = {
    isAvailable: true,
    trustedPrincipalArn: "arn:aws:iam::999988887777:root",
    externalId: "oneuptime-0123",
  };
  createGate = { isAllowed: true };
  updateGate = { isAllowed: true };

  getListSpy = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: connectionsForTest,
        count: connectionsForTest.length,
        skip: 0,
        limit: 100,
      };
    },
  );

  getSpy = getJestSpyOn(API, "get").mockImplementation(
    async (): Promise<unknown> => {
      if (roleSetupForTest instanceof Error) {
        throw roleSetupForTest;
      }

      return { data: roleSetupForTest };
    },
  );

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (_model: unknown, action: ModelAction): PermissionGateResult => {
      return action === ModelAction.Create ? createGate : updateGate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(props: PageComponentProps = pageProps): Promise<void> {
  await act(async () => {
    render(<CloudConnectPage {...props} />);
  });
}

function listIsShown(): boolean {
  return !screen
    .getByTestId("connections-table")
    .parentElement!.classList.contains("hidden");
}

describe("the page", () => {
  test("three tiles, three promises, no list while nothing is connected", async () => {
    await openPage();

    for (const provider of ["aws", "azure", "gcp"]) {
      expect(
        screen.getByTestId(`cloud-connection-tile-${provider}`),
      ).toBeEnabled();
    }

    const promises: HTMLElement = screen.getByTestId("cloud-connect-promises");

    expect(promises).toHaveTextContent(
      "Read-only: OneUptime can read, never change, anything in your cloud.",
    );
    expect(promises).toHaveTextContent(
      "Resources and their key metrics are read every few minutes.",
    );
    expect(promises).toHaveTextContent(
      "Chart them, and alert on them with a metric monitor.",
    );
    expect(listIsShown()).toBe(false);
    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
  });

  test("those who run their own collector are pointed to that guide", async () => {
    await openPage();

    const note: HTMLElement = screen.getByTestId(
      "cloud-connect-collector-note",
    );

    expect(note).toHaveTextContent(
      "Already run an OpenTelemetry Collector, or need CloudWatch Metric Streams?",
    );
    expect(note.querySelector("a")!.getAttribute("href")).toMatch(
      /\/telemetry\/cloud-resources$/,
    );
  });

  test("the tiles count the project's connections, and the list shows", async () => {
    connectionsForTest = [
      connection(CloudProvider.AWS),
      connection(CloudProvider.AWS),
      connection(CloudProvider.GCP),
    ];
    listedForTest = 3;

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-connection-tile-connected-aws"),
      ).toHaveTextContent("Connected (2)");
    });
    expect(
      screen.getByTestId("cloud-connection-tile-connected-gcp"),
    ).toHaveTextContent("Connected");
    expect(
      screen.queryByTestId("cloud-connection-tile-connected-azure"),
    ).not.toBeInTheDocument();
    expect(listIsShown()).toBe(true);
    // Only what the tiles need: never settings or credentials.
    expect(getListSpy.mock.calls[0]![0].select).toEqual({
      _id: true,
      provider: true,
    });
  });
});

describe("a change made in the list", () => {
  test("a connection deleted there is counted at once: the tile no longer says Connected", async () => {
    connectionsForTest = [
      connection(CloudProvider.AWS),
      connection(CloudProvider.Azure),
    ];
    listedForTest = 2;

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-connection-tile-connected-azure"),
      ).toBeInTheDocument();
    });

    const readsBefore: number = getListSpy.mock.calls.length;

    // The Azure connection is deleted from the list, which loads again.
    connectionsForTest = [connection(CloudProvider.AWS)];
    listedForTest = 1;

    await act(async () => {
      fireEvent.click(screen.getByText("Reload the list"));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("cloud-connection-tile-connected-azure"),
      ).not.toBeInTheDocument();
    });
    expect(getListSpy.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(
      screen.getByTestId("cloud-connection-tile-azure"),
    ).toHaveTextContent("Connect");
    expect(
      screen.getByTestId("cloud-connection-tile-connected-aws"),
    ).toHaveTextContent("Connected");
    // The list stays, so a search that finds nothing can still be cleared.
    expect(listIsShown()).toBe(true);
  });

  test("the list's first load is not a change: the connections are read once", async () => {
    connectionsForTest = [connection(CloudProvider.GCP)];
    listedForTest = 1;

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-connection-tile-connected-gcp"),
      ).toBeInTheDocument();
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });
});

describe("opening a form", () => {
  test("a tile opens its cloud's form; AWS's knows it can offer a role", async () => {
    await openPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("cloud-connection-tile-aws"));
    });

    const form: HTMLElement = screen.getByTestId("connection-form");

    expect(form).toHaveAttribute("data-provider", "aws");
    expect(form).toHaveAttribute("data-editing", "false");
    expect(form).toHaveAttribute("data-role", "true");
    // Asked once, at /cloud-connection/aws-role-setup.
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0]![0].url.toString()).toMatch(
      /\/cloud-connection\/aws-role-setup$/,
    );
  });

  test("a failed ask is read as no role: the form offers an access key", async () => {
    roleSetupForTest = new Error("Network Error");

    await openPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("cloud-connection-tile-aws"));
    });

    expect(screen.getByTestId("connection-form")).toHaveAttribute(
      "data-role",
      "false",
    );
  });

  test("an address naming a cloud opens its form at once; closing forgets it", async () => {
    goTo(`/dashboard/${PROJECT_ID}/cloud/connect?cloud=gcp`);

    await openPage();

    expect(screen.getByTestId("connection-form")).toHaveAttribute(
      "data-provider",
      "gcp",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Close the form"));
    });

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("an address naming no cloud we know opens nothing", async () => {
    goTo(`/dashboard/${PROJECT_ID}/cloud/connect?cloud=oracle`);

    await openPage();

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
  });
});

describe("saving", () => {
  test("a new connection: what happens next is said, and everything is read again", async () => {
    await openPage();

    const before: string = screen
      .getByTestId("connections-table")
      .getAttribute("data-refresh")!;
    const readsBefore: number = getListSpy.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByTestId("cloud-connection-tile-azure"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save the connection"));
    });

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("cloud-connect-saved")).toHaveTextContent(
      "Connected. The first read starts within a minute; resources appear under All Resources as it finds them.",
    );
    expect(
      screen.getByTestId("connections-table").getAttribute("data-refresh"),
    ).not.toBe(before);
    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });

  test("an edit from the list: the form is the connection's, and saving says it is read again", async () => {
    listedForTest = 1;
    connectionsForTest = [connection(CloudProvider.GCP)];

    await openPage();

    await act(async () => {
      fireEvent.click(screen.getByText("Edit a connection"));
    });

    expect(screen.getByTestId("connection-form")).toHaveAttribute(
      "data-editing",
      "true",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Save the connection"));
    });

    expect(screen.getByTestId("cloud-connect-saved")).toHaveTextContent(
      "Saved. The connection is read again within a minute.",
    );
  });
});

describe("rights and plans", () => {
  test("without the right to connect: tiles disabled, why said in words, no role asked about", async () => {
    createGate = {
      isAllowed: false,
      disabledReason: "Ask a project admin to connect a cloud account.",
    };

    await openPage();

    for (const provider of ["aws", "azure", "gcp"]) {
      expect(
        screen.getByTestId(`cloud-connection-tile-${provider}`),
      ).toBeDisabled();
    }
    expect(screen.getByTestId("cloud-connect-locked")).toHaveTextContent(
      "Ask a project admin to connect a cloud account.",
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("without the right to edit, the list is told so", async () => {
    updateGate = { isAllowed: false, disabledReason: "Read only." };

    await openPage();

    expect(screen.getByTestId("connections-table")).toHaveAttribute(
      "data-can-update",
      "false",
    );
  });

  test("a plan without telemetry says so and reads nothing", async () => {
    const project: Project = new Project();
    project.reseller = { enableTelemetryFeatures: false } as never;

    await openPage({ ...pageProps, currentProject: project });

    expect(document.body).toHaveTextContent(
      "Telemetry features are disabled for this project.",
    );
    expect(getListSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
