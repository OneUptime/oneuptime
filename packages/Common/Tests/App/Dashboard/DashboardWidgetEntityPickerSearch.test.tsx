import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EntityFilterDropdown, {
  ENTITY_FILTER_LIST_PAGE_SIZE,
  getEntityModelDef,
  isEntityFilterSearchedOnServer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * A DASHBOARD WIDGET'S ENTITY PICKER SEARCHES THE SERVER (#10580).
 *
 * A Monitor List widget's monitors (and its SLOs, labels, clusters and
 * hosts) were picked from the first 1,000 by name, read when the settings
 * opened and searched in the browser: a monitor past the 1,000th was never
 * offered. Those kinds now search the server as the reader types - 50 by
 * name, within the kind's own rules - and what the widget points at is read
 * by its id, so it is named even where no search offers it. The short lists
 * of the project's own values (severities, states) keep their order, read
 * whole, a page at a time.
 *
 * What Postgres answers to the searches, through the real list routes, is
 * pinned in Tests/Server/API/DashboardWidgetPickerSearchPostgres.test.ts.
 */

type ListOptions = Parameters<typeof ModelAPI.getList<BaseModel>>[0];

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

let instance: i18n;

beforeAll(async () => {
  instance = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/dashboards`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const named: <T extends BaseModel>(
  modelType: { new (): T },
  name: string,
  id?: string | undefined,
  extra?: Record<string, unknown> | undefined,
) => T = <T extends BaseModel>(
  modelType: { new (): T },
  name: string,
  id?: string | undefined,
  extra?: Record<string, unknown> | undefined,
): T => {
  const row: T = new modelType();
  (row as unknown as Record<string, unknown>)["_id"] =
    id || ObjectID.generate().toString();
  (row as unknown as Record<string, unknown>)["name"] = name;

  for (const [key, value] of Object.entries(extra || {})) {
    (row as unknown as Record<string, unknown>)[key] = value;
  }

  return row;
};

// The server, faked: every read kept, each answered by `answer`.
const fakeServer: (
  answer: (call: ListCall) => { rows: Array<BaseModel>; count?: number },
) => Array<ListCall> = (
  answer: (call: ListCall) => { rows: Array<BaseModel>; count?: number },
): Array<ListCall> => {
  const calls: Array<ListCall> = [];

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: ListOptions,
  ): Promise<ListResult<BaseModel>> => {
    const call: ListCall = {
      modelType: options.modelType,
      query: options.query as Record<string, unknown>,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort as Record<string, unknown>,
    };

    calls.push(call);

    const answered: { rows: Array<BaseModel>; count?: number } = answer(call);

    return {
      data: answered.rows,
      count: answered.count ?? answered.rows.length,
      skip: options.skip,
      limit: options.limit,
    };
  }) as never);

  return calls;
};

const nameSearched: (call: ListCall) => string = (call: ListCall): string => {
  const name: unknown = call.query["name"];

  return name instanceof Search ? (name as Search<string>).toString() : "";
};

const draw: (data: {
  kind: EntityFilterModelType;
  value?: string | Array<string> | undefined;
  isMultiSelect?: boolean | undefined;
  onChange?: ((value: string | Array<string> | null) => void) | undefined;
}) => void = (data: {
  kind: EntityFilterModelType;
  value?: string | Array<string> | undefined;
  isMultiSelect?: boolean | undefined;
  onChange?: ((value: string | Array<string> | null) => void) | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instance}>
      <EntityFilterDropdown
        entityFilterModelType={data.kind}
        isMultiSelect={data.isMultiSelect !== false}
        value={data.value}
        onChange={data.onChange || (() => {})}
      />
    </I18nextProvider>,
  );
};

const openAndType: (text: string) => Promise<void> = async (
  text: string,
): Promise<void> => {
  const picker: HTMLElement = await screen.findByRole("combobox");

  await act(async () => {
    fireEvent.click(picker);
  });

  if (text) {
    await act(async () => {
      fireEvent.change(picker, { target: { value: text } });
    });
  }
};

describe("which kinds are searched on the server", () => {
  test("every kind a project can have any number of", () => {
    for (const kind of [
      EntityFilterModelType.Monitor,
      EntityFilterModelType.ServiceLevelObjective,
      EntityFilterModelType.Label,
      EntityFilterModelType.KubernetesCluster,
      EntityFilterModelType.DockerHost,
      EntityFilterModelType.PodmanHost,
      EntityFilterModelType.ProxmoxCluster,
      EntityFilterModelType.VMwareVCenter,
      EntityFilterModelType.CephCluster,
      EntityFilterModelType.StorageArray,
      EntityFilterModelType.DockerSwarmCluster,
    ]) {
      expect(isEntityFilterSearchedOnServer(kind)).toBe(true);
      // Searched by name, as EntityDropdown searches.
      expect(getEntityModelDef(kind).sortField).toBe("name");
    }
  });

  test("the project's own short lists keep their order, and saved views their application line", () => {
    for (const kind of [
      EntityFilterModelType.IncidentSeverity,
      EntityFilterModelType.AlertSeverity,
      EntityFilterModelType.IncidentState,
      EntityFilterModelType.AlertState,
      EntityFilterModelType.MonitorStatus,
      EntityFilterModelType.NetworkSiteType,
      EntityFilterModelType.ProductAnalyticsSavedFunnel,
      EntityFilterModelType.ProductAnalyticsSavedRetention,
    ]) {
      expect(isEntityFilterSearchedOnServer(kind)).toBe(false);
    }
  });

  test("a kind this build does not know is listed, and says so there", () => {
    expect(
      isEntityFilterSearchedOnServer("NoSuchKind" as EntityFilterModelType),
    ).toBe(false);
  });
});

describe("a Monitor List widget's monitors", () => {
  test("nothing is read up front, and a search asks the server for 50 by name", async () => {
    const calls: Array<ListCall> = fakeServer((call: ListCall) => {
      return nameSearched(call) === "WB1500"
        ? { rows: [named(Monitor, "WB1500KSK02")] }
        : { rows: [named(Monitor, "AP000001")], count: 10050 };
    });

    draw({ kind: EntityFilterModelType.Monitor });

    await screen.findByRole("combobox");

    // No list of 1,000 (or any list) before the picker is opened.
    expect(
      calls.filter((call: ListCall): boolean => {
        return call.limit >= ENTITY_FILTER_LIST_PAGE_SIZE;
      }),
    ).toEqual([]);

    await openAndType("WB1500");

    expect(
      await screen.findByRole(
        "option",
        { name: /WB1500KSK02/ },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    const searches: Array<ListCall> = calls.filter(
      (call: ListCall): boolean => {
        return call.modelType === Monitor && nameSearched(call) === "WB1500";
      },
    );

    expect(searches.length).toBeGreaterThan(0);
    expect(searches[0]!.limit).toBe(50);
    expect(searches[0]!.skip).toBe(0);
    expect(searches[0]!.sort).toEqual({ name: SortOrder.Ascending });
    // A monitor picker keeps its rules: no archived filter of its own.
    expect(searches[0]!.query["isArchived"]).toBeUndefined();
  });

  test("picking a monitor hands the widget its id", async () => {
    const id: string = ObjectID.generate().toString();
    const onChange: jest.Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    fakeServer(() => {
      return { rows: [named(Monitor, "WB1500KSK02", id)] };
    });

    draw({ kind: EntityFilterModelType.Monitor, onChange: onChange });

    await openAndType("");

    const option: HTMLElement = await screen.findByRole(
      "option",
      { name: /WB1500KSK02/ },
      { timeout: 5000 },
    );

    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChange).toHaveBeenLastCalledWith([id]);
  });

  test("the monitors the widget points at are read by their ids and named", async () => {
    const id: string = ObjectID.generate().toString();

    const calls: Array<ListCall> = fakeServer((call: ListCall) => {
      return call.query["_id"] instanceof Includes
        ? { rows: [named(Monitor, "WB1500KSK02", id)] }
        : { rows: [] };
    });

    draw({ kind: EntityFilterModelType.Monitor, value: [id] });

    expect(await screen.findByText("WB1500KSK02")).toBeInTheDocument();

    const byId: ListCall | undefined = calls.find((call: ListCall) => {
      return call.query["_id"] instanceof Includes;
    });

    expect(
      ((byId!.query["_id"] as Includes).values as Array<unknown>).map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([id]);
    expect(String(byId!.query["projectId"])).toBe(PROJECT_ID);
  });
});

describe("an SLO widget", () => {
  test("searches only the SLOs that are not archived", async () => {
    const calls: Array<ListCall> = fakeServer(() => {
      return { rows: [named(ServiceLevelObjective, "Checkout latency")] };
    });

    draw({ kind: EntityFilterModelType.ServiceLevelObjective });

    await openAndType("Checkout");

    await screen.findByRole(
      "option",
      { name: /Checkout latency/ },
      { timeout: 5000 },
    );

    const search: ListCall | undefined = calls.find((call: ListCall) => {
      return nameSearched(call) === "Checkout";
    });

    expect(search!.query["isArchived"]).toBe(false);
  });

  test("an archived SLO it already points at is named as archived", async () => {
    const id: string = ObjectID.generate().toString();

    fakeServer((call: ListCall) => {
      return call.query["_id"] instanceof Includes
        ? {
            rows: [
              named(ServiceLevelObjective, "Checkout latency", id, {
                isArchived: true,
              }),
            ],
          }
        : { rows: [] };
    });

    draw({
      kind: EntityFilterModelType.ServiceLevelObjective,
      value: id,
      isMultiSelect: false,
    });

    expect(
      await screen.findByText("Checkout latency (archived)"),
    ).toBeInTheDocument();
  });
});

describe("a short list of the project's own values", () => {
  test("is read whole, a page at a time, in its own order", async () => {
    const calls: Array<ListCall> = fakeServer((call: ListCall) => {
      // A first page as full as a page gets, and one more row after it.
      return call.skip === 0
        ? {
            rows: Array.from(
              { length: ENTITY_FILTER_LIST_PAGE_SIZE },
              (_value: unknown, index: number): BaseModel => {
                return named(IncidentSeverity, `Severity ${index}`);
              },
            ),
            count: ENTITY_FILTER_LIST_PAGE_SIZE + 1,
          }
        : {
            rows: [named(IncidentSeverity, "The last severity")],
            count: ENTITY_FILTER_LIST_PAGE_SIZE + 1,
          };
    });

    draw({ kind: EntityFilterModelType.IncidentSeverity });

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    expect(calls[0]!.skip).toBe(0);
    expect(calls[1]!.skip).toBe(ENTITY_FILTER_LIST_PAGE_SIZE);
    expect(calls[0]!.sort).toEqual({ order: SortOrder.Ascending });
    expect(calls[1]!.modelType).toBe(IncidentSeverity);
  });

  test("stops at a page that is not full", async () => {
    const calls: Array<ListCall> = fakeServer(() => {
      return { rows: [named(IncidentSeverity, "Critical")], count: 1 };
    });

    draw({ kind: EntityFilterModelType.IncidentSeverity });

    await screen.findByRole("combobox");

    expect(calls).toHaveLength(1);
  });
});
