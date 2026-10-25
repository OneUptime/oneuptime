import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Adding a resource the way a host is added (Components/ResourceOnboarding),
 * rendered: the Add guide names the resource with a name the project has not
 * used and writes it into the commands as it is typed, says when the typed
 * name is reported differently or is already in the project, and its last
 * step waits for the resource and says when it connected - a new one, or one
 * the project had that reports again. A function names itself, so its guide
 * asks for no name. The Add dialog is that guide with the dialog's title.
 *
 * And a resource a form adds - a database, a queue, a RUM application - has
 * its prefilled guide open on its own once the form saved it, waiting for
 * that one's first data. A vCenter connected through a probe opens on its
 * page instead.
 *
 * Only the data boundary (ModelAPI) is replaced, by a project kept here.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

import AddResourceGuide, {
  RESOURCE_NAME_LOOKUP_DELAY_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/AddResourceGuide";
import AddResourceModal from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/AddResourceModal";
import {
  RESOURCE_ADDED,
  RESOURCE_CONNECTION_POLL_INTERVAL_MS,
  RESOURCE_NAME_FIELD_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceOnboarding";
import KUBERNETES_CLUSTER_ONBOARDING from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesClusterOnboarding";
import SERVERLESS_FUNCTION_ONBOARDING from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessFunctionOnboarding";
import IOT_FLEET_ONBOARDING from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTFleetOnboarding";
import DOCKER_HOST_ONBOARDING from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DockerHostOnboarding";
import DatabaseAddedModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseAddedModal";
import MessageQueueAddedModal from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueAddedModal";
import RumApplicationAddedModal from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumApplicationAddedModal";
import ServiceAddedModal from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceAddedModal";
import { SERVICE_NAME_HELP } from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceListCopy";
import {
  canCarryServiceName,
  withServiceName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  hasWildcard,
  unescapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

const SERVER_KEY: string = "acme-server-key-0123456789";

type Row = Record<string, unknown>;

// The project, by table, as the tests set it up.
let store: Map<string, Array<Row>> = new Map<string, Array<Row>>();
// Every list read, by table.
let reads: Array<{ table: string; query: Record<string, unknown> }> = [];
// How many of the next reads of a table fail.
let failingReads: number = 0;

function tableOf(modelType: { new (): BaseModel }): string {
  return new modelType().tableName || "";
}

function rowsOf(modelType: { new (): BaseModel }): Array<Row> {
  const table: string = tableOf(modelType);
  if (!store.has(table)) {
    store.set(table, []);
  }
  return store.get(table)!;
}

function asTime(value: unknown): number {
  return value ? new Date(value as string | Date).getTime() : NaN;
}

// The query, matched as the server would.
function matches(row: Row, query: Record<string, unknown>): boolean {
  for (const [field, wanted] of Object.entries(query)) {
    // Every row here is the current project's.
    if (field === "projectId") {
      continue;
    }

    const value: unknown = row[field];

    if (wanted instanceof Search) {
      if (
        typeof value !== "string" ||
        !value.toLowerCase().includes(String(wanted.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }

    // A glob with no wildcard in it: that text exactly, case aside (ILIKE).
    if (wanted instanceof Wildcard) {
      if (hasWildcard(wanted.value)) {
        throw new Error(`Only exact Wildcards are modelled: ${wanted.value}`);
      }
      if (
        typeof value !== "string" ||
        value.toLowerCase() !== unescapeWildcards(wanted.value).toLowerCase()
      ) {
        return false;
      }
      continue;
    }

    if (wanted instanceof NotNull) {
      if (value === null || value === undefined) {
        return false;
      }
      continue;
    }

    if (wanted instanceof GreaterThanOrEqual) {
      if (!(asTime(value) >= asTime(wanted.value))) {
        return false;
      }
      continue;
    }

    if (wanted instanceof ObjectID) {
      if (String(value) !== wanted.toString()) {
        return false;
      }
      continue;
    }

    if (typeof wanted === "string" || typeof wanted === "boolean") {
      if (value !== wanted) {
        return false;
      }
    }
  }
  return true;
}

function idOf(number: number): string {
  return `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  store = new Map<string, Array<Row>>();
  reads = [];
  failingReads = 0;

  rowsOf(TelemetryIngestionKey).push({
    _id: "40000000-0000-4000-8000-000000000001",
    name: "Production",
    secretKey: SERVER_KEY,
    keyType: TelemetryIngestionKeyType.Server,
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
    limit?: number;
    sort?: Record<string, unknown>;
  }): Promise<ListResult<BaseModel>> => {
    const table: string = tableOf(data.modelType);
    const query: Record<string, unknown> = data.query || {};
    reads.push({ table, query });

    if (failingReads > 0 && table !== "TelemetryIngestionKey") {
      failingReads--;
      return Promise.reject(new Error("The API is down."));
    }

    const found: Array<Row> = rowsOf(data.modelType).filter((row: Row) => {
      return matches(row, query);
    });

    if (data.sort && data.sort["createdAt"]) {
      found.sort((first: Row, second: Row): number => {
        return asTime(second["createdAt"]) - asTime(first["createdAt"]);
      });
    }

    const models: Array<BaseModel> = found
      .slice(0, data.limit || found.length)
      .map((row: Row): BaseModel => {
        return Object.assign(new data.modelType(), row);
      });

    return Promise.resolve({
      data: models,
      count: models.length,
      skip: 0,
      limit: data.limit || 10,
    } as ListResult<BaseModel>);
  }) as never);
  jest.spyOn(ModelAPI, "getItem").mockImplementation(((data: {
    modelType: { new (): BaseModel };
    id: ObjectID;
  }): Promise<BaseModel | null> => {
    const row: Row | undefined = rowsOf(data.modelType).find((item: Row) => {
      return String(item["_id"]) === data.id.toString();
    });
    return Promise.resolve(
      row ? Object.assign(new data.modelType(), row) : null,
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Moves the clock on, and with it the guide's lookups and checks.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

async function show(element: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await settle();
}

function pageText(): string {
  return document.body.textContent || "";
}

function nameInput(): HTMLInputElement {
  return screen.getByTestId("resource-name-input") as HTMLInputElement;
}

async function typeName(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(nameInput(), { target: { value } });
  });
  await advance(RESOURCE_NAME_LOOKUP_DELAY_MS);
}

// Ingest registering what an agent first reports.
function arrive(data: {
  modelType: { new (): BaseModel };
  id: number;
  name: string;
  nameField: string;
}): void {
  const now: Date = new Date();
  rowsOf(data.modelType).push({
    _id: idOf(data.id),
    name: data.name,
    [data.nameField]: data.name,
    otelCollectorStatus: "connected",
    createdAt: now,
    lastSeenAt: now,
  });
}

describe("the Add guide's name", () => {
  test("starts as the example, and the install command carries it", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    expect(nameInput().value).toBe("my-cluster");
    expect(screen.getByText(RESOURCE_NAME_FIELD_HINT)).toBeInTheDocument();
    expect(pageText()).toContain('--set clusterName="my-cluster"');
    expect(pageText()).toContain(`--set oneuptime.apiKey="${SERVER_KEY}"`);
    // Known, so the guide says to keep it - not to replace an example.
    expect(pageText()).toContain(
      "keep `clusterName` exactly as it is, or the data registers as a new cluster",
    );
    expect(pageText()).not.toContain("Replace `my-cluster`");
  });

  test("starts as one the project has not used: two clusters of one name would report into one", async () => {
    rowsOf(KubernetesCluster).push(
      {
        _id: idOf(90),
        name: "my-cluster",
        clusterIdentifier: "my-cluster",
        otelCollectorStatus: "connected",
      },
      {
        _id: idOf(91),
        name: "Second",
        clusterIdentifier: "MY-CLUSTER-2",
        otelCollectorStatus: "connected",
      },
    );

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    expect(nameInput().value).toBe("my-cluster-3");
    expect(pageText()).toContain('--set clusterName="my-cluster-3"');
    expect(
      reads.some((read: { table: string; query: Record<string, unknown> }) => {
        return (
          read.table === "KubernetesCluster" &&
          read.query["clusterIdentifier"] instanceof Search
        );
      }),
    ).toBe(true);
  });

  test("is written into the commands as it is typed, made safe for them, and says so", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    await typeName("Prod East 1");

    expect(pageText()).toContain('--set clusterName="Prod-East-1"');
    expect(screen.getByTestId("resource-name-reported-as")).toHaveTextContent(
      "The agent reports it as Prod-East-1.",
    );
  });

  test("says nothing more while it is the name the commands carry", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    await typeName("prod-east");

    expect(screen.queryByTestId("resource-name-reported-as")).toBeNull();
    expect(screen.queryByTestId("resource-name-taken")).toBeNull();
  });

  test("falls back to the suggestion while nothing usable is typed", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    await typeName("   ");

    expect(pageText()).toContain('--set clusterName="my-cluster"');
  });

  test("says when the project already has one of that name, which the agent's data goes to", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(91),
      name: "Legacy East",
      clusterIdentifier: "legacy-east",
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    await typeName("Legacy-East");

    const taken: HTMLElement = screen.getByTestId("resource-name-taken");

    expect(taken).toHaveTextContent(
      "Legacy East is already in this project, so the agent's data goes to it.",
    );
    expect(
      within(taken).getByRole("link", { name: "View cluster" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/kubernetes/${idOf(91)}`,
    );
  });

  /*
   * A substring search, ten rows at a time and newest first, would return
   * only the newer look-alikes. The lookup asks for the name itself.
   */
  test("finds a name the project has among many newer ones like it", async () => {
    for (let i: number = 1; i <= 12; i++) {
      rowsOf(KubernetesCluster).push({
        _id: idOf(100 + i),
        name: `prod-${i}`,
        clusterIdentifier: `prod-${i}`,
        otelCollectorStatus: "connected",
      });
    }
    rowsOf(KubernetesCluster).push({
      _id: idOf(99),
      name: "Prod",
      clusterIdentifier: "Prod",
      otelCollectorStatus: "disconnected",
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await typeName("prod");

    expect(screen.getByTestId("resource-name-taken")).toHaveTextContent(
      "Prod is already in this project, so the agent's data goes to it.",
    );
    expect(
      reads.some((read: { table: string; query: Record<string, unknown> }) => {
        return (
          read.table === "KubernetesCluster" &&
          read.query["clusterIdentifier"] instanceof Wildcard
        );
      }),
    ).toBe(true);
  });
});

describe("the Add guide's last step", () => {
  test("waits for the named resource, and says when it connected, with a link to it", async () => {
    const connected: Array<BaseModel> = [];

    await show(
      <AddResourceGuide
        onboarding={KUBERNETES_CLUSTER_ONBOARDING}
        onConnected={(record: BaseModel) => {
          connected.push(record);
        }}
      />,
    );

    await typeName("prod-east");

    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for prod-east to connect. This step updates by itself.",
    );

    arrive({
      modelType: KubernetesCluster,
      id: 1,
      name: "prod-east",
      nameField: "clusterIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    const done: HTMLElement = screen.getByTestId(
      "resource-connection-connected",
    );

    expect(done).toHaveTextContent(
      "prod-east is connected. Its data arrives within a minute or two.",
    );
    expect(
      within(done).getByRole("link", { name: "View cluster" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/kubernetes/${idOf(1)}`,
    );
    expect(connected).toHaveLength(1);
  });

  test("prefers the one of its name when several register at once", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await typeName("prod-east");

    arrive({
      modelType: KubernetesCluster,
      id: 2,
      name: "prod-east",
      nameField: "clusterIdentifier",
    });
    // A colleague's install, registered a moment later.
    jest.advanceTimersByTime(1000);
    arrive({
      modelType: KubernetesCluster,
      id: 3,
      name: "staging",
      nameField: "clusterIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "prod-east",
    );
  });

  test("does not take one that was reporting before the guide opened for the one it added", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(90),
      name: "my-cluster",
      clusterIdentifier: "my-cluster",
      otelCollectorStatus: "connected",
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    // It keeps reporting while the guide waits.
    rowsOf(KubernetesCluster)[0]!["lastSeenAt"] = new Date(Date.now() + 1000);
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 3);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();
    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for my-cluster-2 to connect.",
    );
  });

  /*
   * The first-run card saw my-cluster connect, and the Add dialog opened a
   * minute later: my-cluster is not the one it is adding.
   */
  test("does not take one that registered a moment before the guide opened for the one it added", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(92),
      name: "my-cluster",
      clusterIdentifier: "my-cluster",
      otelCollectorStatus: "connected",
      createdAt: new Date(Date.now() - 60 * 1000),
      lastSeenAt: new Date(),
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 3);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();
    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for my-cluster-2 to connect.",
    );

    arrive({
      modelType: KubernetesCluster,
      id: 93,
      name: "my-cluster-2",
      nameField: "clusterIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "my-cluster-2",
    );
  });

  /*
   * The server's clock ten minutes behind the browser's: the new cluster's
   * createdAt reads as before the guide opened, by the browser's clock.
   */
  test("sees the new resource whatever the browser's clock says", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(94),
      name: "old-cluster",
      clusterIdentifier: "old-cluster",
      otelCollectorStatus: "connected",
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    const serverNow: Date = new Date(Date.now() - 10 * 60 * 1000);
    rowsOf(KubernetesCluster).push({
      _id: idOf(95),
      name: "my-cluster",
      clusterIdentifier: "my-cluster",
      otelCollectorStatus: "connected",
      createdAt: serverNow,
      lastSeenAt: serverNow,
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "my-cluster",
    );
  });

  test("sees one the project had, never connected, report under the guide's name", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(91),
      name: "Legacy East",
      clusterIdentifier: "legacy-east",
      otelCollectorStatus: "disconnected",
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSeenAt: null,
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await typeName("legacy-east");
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();

    rowsOf(KubernetesCluster)[0]!["lastSeenAt"] = new Date();
    rowsOf(KubernetesCluster)[0]!["otelCollectorStatus"] = "connected";
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "Legacy East",
    );
  });

  /*
   * Its agent stopped five minutes ago: the cluster still reads as
   * connected (that takes fifteen minutes of silence to change), and a
   * reinstall under its name is what the guide is waiting for.
   */
  test("sees one the project had report again, though it still read as connected", async () => {
    const stoppedAt: Date = new Date(Date.now() - 5 * 60 * 1000);
    rowsOf(KubernetesCluster).push({
      _id: idOf(96),
      name: "Legacy East",
      clusterIdentifier: "legacy-east",
      otelCollectorStatus: "connected",
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSeenAt: stoppedAt,
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await typeName("legacy-east");
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();

    rowsOf(KubernetesCluster)[0]!["lastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "Legacy East",
    );
  });

  test("with a name the project has, another one registering is not the one it added", async () => {
    rowsOf(KubernetesCluster).push({
      _id: idOf(97),
      name: "Legacy East",
      clusterIdentifier: "legacy-east",
      otelCollectorStatus: "disconnected",
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastSeenAt: null,
    });

    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    await typeName("legacy-east");

    // A colleague's install, somewhere else.
    arrive({
      modelType: KubernetesCluster,
      id: 98,
      name: "staging",
      nameField: "clusterIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 2);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();

    rowsOf(KubernetesCluster)[0]!["lastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "Legacy East",
    );
  });

  test("keeps waiting through a failed check, and sees the resource on the next", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);
    // The name's lookup is done: the next read is the step's check.
    await advance(RESOURCE_NAME_LOOKUP_DELAY_MS);

    arrive({
      modelType: KubernetesCluster,
      id: 4,
      name: "my-cluster",
      nameField: "clusterIdentifier",
    });
    failingReads = 1;
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.getByTestId("resource-connection-waiting"),
    ).toBeInTheDocument();

    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.getByTestId("resource-connection-connected"),
    ).toBeInTheDocument();
  });

  test("stops asking once the resource has connected", async () => {
    await show(<AddResourceGuide onboarding={KUBERNETES_CLUSTER_ONBOARDING} />);

    arrive({
      modelType: KubernetesCluster,
      id: 5,
      name: "my-cluster",
      nameField: "clusterIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    const checksThen: number = reads.length;
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 4);

    expect(reads.length).toBe(checksThen);
  });
});

describe("a resource that names itself", () => {
  test("a function's guide asks for no name, and waits for the first data", async () => {
    await show(
      <AddResourceGuide onboarding={SERVERLESS_FUNCTION_ONBOARDING} />,
    );

    expect(screen.queryByTestId("resource-name-field")).toBeNull();
    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for the first data. This step updates by itself.",
    );

    arrive({
      modelType: ServerlessFunction,
      id: 6,
      name: "checkout-handler",
      nameField: "functionIdentifier",
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByTestId("connected-resource-name")).toHaveTextContent(
      "checkout-handler",
    );
    expect(screen.getByRole("link", { name: "View function" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/serverless/${idOf(6)}`,
    );
  });
});

describe("the name in other guides", () => {
  test("an IoT fleet's snippets send its readings under the fleet's name", async () => {
    await show(<AddResourceGuide onboarding={IOT_FLEET_ONBOARDING} />);

    await typeName("warehouse-7");

    expect(pageText()).toContain(
      "export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=warehouse-7,device.id=sensor-001,service.name=iot/warehouse-7",
    );
    expect(pageText()).toContain(
      "This sends the readings to the fleet **`warehouse-7`**.",
    );
    // The guide creates nothing: the fleet registers itself.
    expect(rowsOf(IoTFleet)).toHaveLength(0);
  });

  test("a Docker host's commands carry its name as DOCKER_HOST_NAME", async () => {
    await show(<AddResourceGuide onboarding={DOCKER_HOST_ONBOARDING} />);

    await typeName("web 01");

    expect(pageText()).toContain("web-01");
    expect(pageText()).not.toContain("my-docker-host");
    expect(rowsOf(DockerHost).length).toBe(0);
  });
});

describe("the Add dialog", () => {
  test("is the guide under the dialog's own title, and Done closes it", async () => {
    let closed: number = 0;

    await show(
      <AddResourceModal
        onboarding={KUBERNETES_CLUSTER_ONBOARDING}
        onClose={() => {
          closed++;
        }}
      />,
    );

    const dialog: HTMLElement = screen.getByTestId("add-resource-modal");

    expect(
      screen.getByRole("heading", { name: "Add Kubernetes Cluster" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Install the OneUptime agent with Helm. The cluster shows up here as soon as the agent connects.",
      ),
    ).toBeInTheDocument();
    // Bare: the dialog's title says what it is for, not a card of its own.
    expect(
      within(dialog).queryByText("Getting Started with Kubernetes Monitoring"),
    ).toBeNull();
    expect(
      within(dialog).getByTestId("resource-name-input"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });

    expect(closed).toBe(1);
  });
});

describe("the guide that opens once a form has added a resource", () => {
  test("a database's: prefilled for the row, id included, waiting for its engine metrics", async () => {
    const id: string = idOf(50);
    rowsOf(DatabaseServer).push({
      _id: id,
      name: "PostgreSQL payments-db.prod.internal:5432",
      dbSystem: "postgresql",
      serverAddress: "payments-db.prod.internal",
      serverPort: 5432,
      discoverySource: "manual",
      createdAt: new Date(),
      lastSeenAt: null,
      collectorLastSeenAt: null,
    });
    rowsOf(DatabaseServerEndpoint);

    await show(
      <DatabaseAddedModal
        databaseId={new ObjectID(id)}
        name="PostgreSQL payments-db.prod.internal:5432"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Connect PostgreSQL engine metrics",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("resource-added-note")).toHaveTextContent(
      RESOURCE_ADDED.replace(
        "{{name}}",
        "PostgreSQL payments-db.prod.internal:5432",
      ),
    );
    expect(pageText()).toContain(id);

    // An application's query is not the agent's data.
    rowsOf(DatabaseServer)[0]!["lastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();

    rowsOf(DatabaseServer)[0]!["collectorLastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByRole("link", { name: "View database" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/databases/${id}`,
    );
  });

  test("a database that is not there says so", async () => {
    await show(
      <DatabaseAddedModal
        databaseId={new ObjectID(idOf(59))}
        name="Gone"
        onClose={() => {}}
      />,
    );

    expect(pageText()).toContain("Database not found");
    expect(screen.queryByTestId("resource-connection-waiting")).toBeNull();
    // No "follow the steps below" over an error with no steps.
    expect(screen.queryByTestId("resource-added-note")).toBeNull();
  });

  test("a queue's: its messaging system's guide, waiting for its first data", async () => {
    const id: string = idOf(60);
    rowsOf(MessageQueue).push({
      _id: id,
      name: "orders.created",
      destinationName: "orders.created",
      messagingSystem: "kafka",
      queueIdentifier: "kafka|orders.created",
      createdAt: new Date(),
      lastSeenAt: null,
    });

    await show(
      <MessageQueueAddedModal
        queueId={new ObjectID(id)}
        name="orders.created"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("resource-added-note")).toHaveTextContent(
      "orders.created is added.",
    );
    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for orders.created to connect.",
    );

    rowsOf(MessageQueue)[0]!["lastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByRole("link", { name: "View queue" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/queues/${id}`,
    );
  });

  // The server's clock ten minutes behind the browser's.
  test("sees the first data whatever the browser's clock says", async () => {
    const id: string = idOf(61);
    rowsOf(MessageQueue).push({
      _id: id,
      name: "payments.settled",
      destinationName: "payments.settled",
      messagingSystem: "kafka",
      queueIdentifier: "kafka|payments.settled",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      lastSeenAt: null,
    });

    await show(
      <MessageQueueAddedModal
        queueId={new ObjectID(id)}
        name="payments.settled"
        onClose={() => {}}
      />,
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.queryByTestId("resource-connection-connected")).toBeNull();

    rowsOf(MessageQueue)[0]!["lastSeenAt"] = new Date(
      Date.now() - 10 * 60 * 1000,
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByRole("link", { name: "View queue" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/queues/${id}`,
    );
  });

  test("a RUM application's: its name in the snippet as service.name", async () => {
    const id: string = idOf(70);
    rowsOf(RumApplication).push({
      _id: id,
      name: "storefront-web",
      appIdentifier: "storefront-web",
      createdAt: new Date(),
      lastSeenAt: null,
    });

    await show(
      <RumApplicationAddedModal
        applicationId={new ObjectID(id)}
        appIdentifier="checkout-web"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Instrument your app for RUM" }),
    ).toBeInTheDocument();
    expect(pageText()).toContain('[ATTR_SERVICE_NAME]: "checkout-web"');
    expect(screen.getByTestId("resource-connection-waiting")).toHaveTextContent(
      "Waiting for checkout-web to connect.",
    );
  });
});

describe("the guide that opens once Create Service has saved a service", () => {
  test("names the service in every snippet, and waits for its first data", async () => {
    const id: string = idOf(80);
    rowsOf(Service).push({
      _id: id,
      name: "checkout-api",
      createdAt: new Date(),
      lastSeenAt: null,
    });

    await show(
      <ServiceAddedModal
        serviceId={new ObjectID(id)}
        name="checkout-api"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Send telemetry from checkout-api" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("resource-added-note")).toHaveTextContent(
      "checkout-api is added.",
    );
    expect(pageText()).toContain("serviceName: 'checkout-api'");
    expect(pageText()).not.toContain("my-service");

    const lastStep: HTMLElement = screen.getByTestId(
      "resource-added-last-step",
    );

    expect(lastStep).toHaveTextContent("Wait for it to connect");
    expect(
      within(lastStep).getByTestId("resource-connection-waiting"),
    ).toHaveTextContent("Waiting for checkout-api to connect.");

    rowsOf(Service)[0]!["lastSeenAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(screen.getByRole("link", { name: "View service" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/service/${id}`,
    );
  });

  test("names a service with spaces in it too, in quotes where a shell reads it bare", async () => {
    const id: string = idOf(81);
    rowsOf(Service).push({
      _id: id,
      name: "User Authentication API",
      createdAt: new Date(),
      lastSeenAt: null,
    });

    await show(
      <ServiceAddedModal
        serviceId={new ObjectID(id)}
        name="User Authentication API"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Instrument the service with OpenTelemetry. Every snippet below already carries its service.name.",
      ),
    ).toBeInTheDocument();
    expect(pageText()).toContain("serviceName: 'User Authentication API'");
    expect(pageText()).not.toContain("my-service");
  });

  /*
   * A quote or a $ in the name: no snippet can carry it as written, so they
   * keep their examples, and the dialog does not say they carry it.
   */
  test("says to use the service's name where the snippets cannot carry it", async () => {
    const id: string = idOf(82);
    rowsOf(Service).push({
      _id: id,
      name: 'Bob\'s "API"',
      createdAt: new Date(),
      lastSeenAt: null,
    });

    await show(
      <ServiceAddedModal
        serviceId={new ObjectID(id)}
        name={'Bob\'s "API"'}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(SERVICE_NAME_HELP)).toBeInTheDocument();
    expect(pageText()).not.toContain("Every snippet below already carries");
    expect(pageText()).toContain("serviceName: 'my-service'");
  });
});

describe("a service name in the telemetry guide's snippets", () => {
  const SNIPPET: string = [
    "serviceName: 'my-service',",
    'export OTEL_SERVICE_NAME="my-service"',
    "-Dotel.service.name=my-service",
    "'service.name': 'my-react-app',",
    "'service.name': 'my-angular-app',",
  ].join("\n");

  test("takes the examples' place everywhere", () => {
    const filled: string = withServiceName(SNIPPET, "checkout-api");

    expect(filled).not.toMatch(/my-service|my-react-app|my-angular-app/);
    expect(filled.split("checkout-api").length - 1).toBe(5);
  });

  test("keeps the examples for a name the snippets cannot carry as written", () => {
    for (const name of [
      "",
      "  ",
      "it's",
      'say "hi"',
      "a$b",
      "back\\slash",
      "`tick`",
      "#{interpolated}",
    ]) {
      expect({ name, filled: withServiceName(SNIPPET, name) }).toEqual({
        name,
        filled: SNIPPET,
      });
      expect({ name, carried: canCarryServiceName(name) }).toEqual({
        name,
        carried: false,
      });
    }
    expect(withServiceName(SNIPPET, undefined)).toBe(SNIPPET);
  });

  test("takes names with dots, slashes and colons, as service names have", () => {
    expect(withServiceName("'my-service'", "team/orders.v2:api")).toBe(
      "'team/orders.v2:api'",
    );
  });

  test("takes a name with spaces: as it is inside the quotes, in quotes where a shell reads it bare", () => {
    const filled: string = withServiceName(SNIPPET, "User Authentication API");

    expect(filled).toBe(
      [
        "serviceName: 'User Authentication API',",
        'export OTEL_SERVICE_NAME="User Authentication API"',
        '-Dotel.service.name="User Authentication API"',
        "'service.name': 'User Authentication API',",
        "'service.name': 'User Authentication API',",
      ].join("\n"),
    );
  });

  test("takes names in any script", () => {
    for (const name of ["支付服务", "भुगतान सेवा", "Zahlungsdienst Köln"]) {
      expect({ name, carried: canCarryServiceName(name) }).toEqual({
        name,
        carried: true,
      });
      expect(withServiceName("-Dotel.service.name=my-service", name)).toBe(
        `-Dotel.service.name="${name}"`,
      );
    }
  });

  test("writes a name with one of the examples in it once", () => {
    const filled: string = withServiceName(SNIPPET, "my-react-app-web");

    expect(filled).not.toContain("my-react-app-web-web");
    expect(filled.split("my-react-app-web").length - 1).toBe(5);
    expect(filled).toContain("-Dotel.service.name=my-react-app-web");
  });
});
