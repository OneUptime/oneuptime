import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
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
import React from "react";
import { Mock } from "jest-mock";
import ObjectID from "../../../Types/ObjectID";

/*
 * The entity picker behind dashboard widget arguments and dashboard variables
 * (Incident/Alert list Monitors & Labels, Monitor list, the Kubernetes, Docker,
 * Podman, Proxmox, vCenter, Ceph and Swarm lists, ...). A widget saves bare ids,
 * but the picker listed only the first 1000 rows of a type. In a big project a
 * saved id past that cap had no option: its chip vanished (a single select fell
 * back to its placeholder), and the next multi-select edit emitted only the
 * visible values - silently removing it from the widget. So any selected id the
 * list is missing is looked up by id and shown under its own name.
 *
 * Since #10580 the kinds a project can have any number of - monitors, SLOs,
 * labels, clusters, hosts, vCenters, storage arrays - list nothing: the picker
 * searches the server as the reader types (EntityDropdown), and what the
 * widget holds is read by its ids and shown under its names. The project's
 * own short lists - severities, states, statuses, site types - are still
 * listed, and a selection their list is missing is still looked up by id.
 */

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface Row {
  _id: string;
  name: string;
}

interface ListResultShape {
  data: Array<Row>;
  count: number;
  skip: number;
  limit: number;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000007",
);

const getListMock: Mock<(args: ListArgs) => Promise<ListResultShape>> =
  jest.fn<(args: ListArgs) => Promise<ListResultShape>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs): Promise<ListResultShape> => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import EntityFilterDropdown, {
  getEntityModelDef,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";

// On the first page of the list.
const LISTED: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000201",
  name: "API gateway",
};

// Also on the first page - something to add through the menu.
const OTHER_LISTED: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000202",
  name: "Billing worker",
};

// Saved on the widget, but past the list's 1000-row cap.
const PAST_CAP: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000203",
  name: "Zeta checkout",
};

// A saved value that is no id at all.
const MALFORMED: string = "not-an-id";

function listOf(rows: Array<Row>): Promise<ListResultShape> {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 1000,
  });
}

function idsIn(filter: unknown): Array<string> {
  return ((filter as Includes).values as Array<ObjectID>).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

/*
 * The server as the picker sees it in a big project: the list stops before
 * PAST_CAP, and a lookup by id returns whichever rows were asked for.
 */
function serveRowCap(args: ListArgs): Promise<ListResultShape> {
  const idFilter: unknown = args.query["_id"];

  if (idFilter instanceof Includes) {
    const ids: Array<string> = idsIn(idFilter);

    return listOf(
      [LISTED, OTHER_LISTED, PAST_CAP].filter((row: Row): boolean => {
        return ids.includes(row._id);
      }),
    );
  }

  return listOf([LISTED, OTHER_LISTED]);
}

function renderPicker(options: {
  type: EntityFilterModelType;
  isMultiSelect?: boolean | undefined;
  value?: string | Array<string> | undefined;
  placeholder?: string | undefined;
  onChange?: ((value: string | Array<string> | null) => void) | undefined;
}): void {
  render(
    <EntityFilterDropdown
      entityFilterModelType={options.type}
      isMultiSelect={Boolean(options.isMultiSelect)}
      value={options.value}
      placeholder={options.placeholder}
      onChange={
        options.onChange ||
        (() => {
          return undefined;
        })
      }
    />,
  );
}

async function waitForOptions(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading options...")).not.toBeInTheDocument();
  });
}

// Every effect run and every read answered.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function listCall(index: number): ListArgs {
  return getListMock.mock.calls[index]![0];
}

// A listed picker's menu opens from the keyboard.
function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

// A searched picker searches as its box is opened.
async function openSearchedMenu(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("combobox"));
  });
}

beforeEach(() => {
  getListMock.mockReset().mockImplementation(serveRowCap);
});

afterEach(() => {
  cleanup();
});

interface LookupCase {
  type: EntityFilterModelType;
  modelType: unknown;
  select: Record<string, true>;
}

const LISTED_LOOKUP_CASES: Array<LookupCase> = [
  {
    type: EntityFilterModelType.NetworkSiteType,
    modelType: NetworkSiteType,
    select: { _id: true, name: true },
  },
  {
    type: EntityFilterModelType.IncidentSeverity,
    modelType: IncidentSeverity,
    // A severity is shown with its colour, so the lookup reads it too.
    select: { _id: true, name: true, color: true },
  },
];

describe("EntityFilterDropdown keeps a saved selection its list is missing", () => {
  test.each(LISTED_LOOKUP_CASES)(
    "$type multi-select: looks up the unlisted id and shows both chips by name",
    async ({ type, modelType, select }: LookupCase) => {
      renderPicker({
        type: type,
        isMultiSelect: true,
        value: [LISTED._id, PAST_CAP._id],
      });

      expect(
        await screen.findByRole("button", { name: "Remove Zeta checkout" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove API gateway" }),
      ).toBeInTheDocument();
      // Past the cap is not the same as archived - no marker for these.
      expect(screen.queryByText(/\(archived\)/)).not.toBeInTheDocument();

      expect(getListMock).toHaveBeenCalledTimes(2);
      expect(listCall(0).modelType).toBe(modelType);
      expect(listCall(0).limit).toBe(1000);

      const lookup: ListArgs = listCall(1);
      expect(lookup.modelType).toBe(modelType);
      expect(Object.keys(lookup.query).sort()).toEqual(["_id", "projectId"]);
      expect(idsIn(lookup.query["_id"])).toEqual([PAST_CAP._id]);
      expect((lookup.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(lookup.limit).toBe(1);
      expect(lookup.select).toEqual(select);
    },
  );

  test("a single select shows the unlisted item's name, not the placeholder", async () => {
    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      value: PAST_CAP._id,
      placeholder: "All site types",
    });

    expect(await screen.findByText("Zeta checkout")).toBeInTheDocument();
    expect(screen.queryByText("All site types")).not.toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    EntityFilterModelType.IncidentSeverity,
    EntityFilterModelType.AlertSeverity,
    EntityFilterModelType.IncidentState,
    EntityFilterModelType.AlertState,
    EntityFilterModelType.MonitorStatus,
    EntityFilterModelType.NetworkSiteType,
  ])(
    "%s: an unlisted selection is looked up from the same model and shown by name",
    async (type: EntityFilterModelType) => {
      renderPicker({ type: type, value: PAST_CAP._id });

      expect(await screen.findByText("Zeta checkout")).toBeInTheDocument();

      expect(getListMock).toHaveBeenCalledTimes(2);
      expect(listCall(1).modelType).toBe(listCall(0).modelType);
      expect(idsIn(listCall(1).query["_id"])).toEqual([PAST_CAP._id]);
    },
  );

  test("removing the listed chip keeps the unlisted id on the widget", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
      onChange: onChange,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove API gateway" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([PAST_CAP._id]);
    expect(screen.getByText("Zeta checkout")).toBeInTheDocument();
  });

  test("the unlisted chip can still be removed on purpose", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
      onChange: onChange,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Zeta checkout" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([LISTED._id]);
  });

  test("adding another item through the menu keeps the unlisted id", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.IncidentSeverity,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
      onChange: onChange,
    });

    await screen.findByRole("button", { name: "Remove Zeta checkout" });

    openMenu();
    fireEvent.click(
      await screen.findByRole("option", { name: "Billing worker" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      LISTED._id,
      PAST_CAP._id,
      OTHER_LISTED._id,
    ]);
  });

  test("makes no second call when every selection is listed", async () => {
    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      isMultiSelect: true,
      value: [LISTED._id, OTHER_LISTED._id],
    });

    expect(
      await screen.findByRole("button", { name: "Remove Billing worker" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove API gateway" }),
    ).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("makes no second call for a listed single selection, or none at all", async () => {
    renderPicker({
      type: EntityFilterModelType.IncidentSeverity,
      value: LISTED._id,
    });
    expect(await screen.findByText("API gateway")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);

    cleanup();
    getListMock.mockClear();

    renderPicker({
      type: EntityFilterModelType.IncidentSeverity,
      isMultiSelect: true,
    });
    await waitForOptions();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("never sends a malformed saved value to the lookup", async () => {
    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      isMultiSelect: true,
      value: [MALFORMED, PAST_CAP._id],
    });

    expect(
      await screen.findByRole("button", { name: "Remove Zeta checkout" }),
    ).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(idsIn(listCall(1).query["_id"])).toEqual([PAST_CAP._id]);
  });

  test("a failed lookup still renders the list and the listed selection", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.query["_id"]) {
        return Promise.reject(new Error("lookup failed"));
      }

      return listOf([LISTED, OTHER_LISTED]);
    });

    renderPicker({
      type: EntityFilterModelType.NetworkSiteType,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
    });
    await waitForOptions();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("lookup failed")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove API gateway" }),
    ).toBeInTheDocument();

    openMenu();
    expect(
      await screen.findByRole("option", { name: "Billing worker" }),
    ).toBeInTheDocument();
  });
});

const SEARCHED_LOOKUP_CASES: Array<LookupCase> = [
  {
    type: EntityFilterModelType.Monitor,
    modelType: Monitor,
    select: { _id: true, name: true },
  },
  {
    type: EntityFilterModelType.Label,
    modelType: Label,
    /*
     * A label is shown with its colour, and with what tells it apart from
     * one of the same name (getSharedNameSelect, #10064), so the read asks
     * for both.
     */
    select: {
      _id: true,
      name: true,
      color: true,
      description: true,
      createdAt: true,
    },
  },
];

describe("EntityFilterDropdown names a searched kind's saved selection by its ids (#10580)", () => {
  test.each(SEARCHED_LOOKUP_CASES)(
    "$type multi-select: reads the saved ids, and nothing else, and shows both chips by name",
    async ({ type, modelType, select }: LookupCase) => {
      renderPicker({
        type: type,
        isMultiSelect: true,
        value: [LISTED._id, PAST_CAP._id],
      });

      expect(
        await screen.findByRole("button", { name: "Remove Zeta checkout" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove API gateway" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\(archived\)/)).not.toBeInTheDocument();

      await settle();

      // No list of the first 1000: one read, of what the widget holds.
      expect(getListMock).toHaveBeenCalledTimes(1);

      const read: ListArgs = listCall(0);
      expect(read.modelType).toBe(modelType);
      expect(Object.keys(read.query).sort()).toEqual(["_id", "projectId"]);
      expect(idsIn(read.query["_id"])).toEqual([LISTED._id, PAST_CAP._id]);
      expect((read.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(read.limit).toBe(2);
      expect(read.select).toEqual(select);
    },
  );

  test("a single select shows the saved item's name, not the placeholder", async () => {
    renderPicker({
      type: EntityFilterModelType.Monitor,
      value: PAST_CAP._id,
      placeholder: "All monitors",
    });

    expect(await screen.findByText("Zeta checkout")).toBeInTheDocument();
    expect(screen.queryByText("All monitors")).not.toBeInTheDocument();

    await settle();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(idsIn(listCall(0).query["_id"])).toEqual([PAST_CAP._id]);
  });

  test.each([
    EntityFilterModelType.KubernetesCluster,
    EntityFilterModelType.DockerHost,
    EntityFilterModelType.PodmanHost,
    EntityFilterModelType.ProxmoxCluster,
    EntityFilterModelType.VMwareVCenter,
    EntityFilterModelType.CephCluster,
    EntityFilterModelType.StorageArray,
    EntityFilterModelType.DockerSwarmCluster,
  ])(
    "%s: a saved selection is read by its id from the kind's own model and shown by name",
    async (type: EntityFilterModelType) => {
      renderPicker({ type: type, value: PAST_CAP._id });

      expect(await screen.findByText("Zeta checkout")).toBeInTheDocument();

      await settle();

      expect(getListMock).toHaveBeenCalledTimes(1);
      expect(listCall(0).modelType).toBe(getEntityModelDef(type).modelType);
      expect(idsIn(listCall(0).query["_id"])).toEqual([PAST_CAP._id]);
    },
  );

  test("removing one chip keeps the other saved id on the widget", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.Monitor,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
      onChange: onChange,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove API gateway" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([PAST_CAP._id]);
    expect(screen.getByText("Zeta checkout")).toBeInTheDocument();
  });

  test("adding another item through the search keeps the saved ids", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.Label,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
      onChange: onChange,
    });

    await screen.findByRole("button", { name: "Remove Zeta checkout" });

    await openSearchedMenu();
    fireEvent.click(
      await screen.findByRole("option", { name: "Billing worker" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      LISTED._id,
      PAST_CAP._id,
      OTHER_LISTED._id,
    ]);
  });

  test("reads a saved single selection once, and nothing at all without one", async () => {
    renderPicker({ type: EntityFilterModelType.Label, value: LISTED._id });
    expect(await screen.findByText("API gateway")).toBeInTheDocument();

    await settle();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(idsIn(listCall(0).query["_id"])).toEqual([LISTED._id]);

    cleanup();
    getListMock.mockClear();

    renderPicker({ type: EntityFilterModelType.Label, isMultiSelect: true });
    await waitForOptions();
    await settle();

    // Searched as the reader opens it: nothing is read before.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("never sends a malformed saved value to the server, and says it is no longer available", async () => {
    renderPicker({
      type: EntityFilterModelType.Monitor,
      isMultiSelect: true,
      value: [MALFORMED, PAST_CAP._id],
    });

    expect(
      await screen.findByRole("button", { name: "Remove Zeta checkout" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove No longer available" }),
    ).toBeInTheDocument();

    await settle();

    // Read alone, the well-formed id keeps its name.
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(idsIn(listCall(0).query["_id"])).toEqual([PAST_CAP._id]);
  });

  test("makes no read at all when the only saved value is malformed", async () => {
    renderPicker({
      type: EntityFilterModelType.Monitor,
      value: MALFORMED,
      placeholder: "All monitors",
    });

    expect(await screen.findByText("No longer available")).toBeInTheDocument();

    await settle();

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failed read of the saved selection: the picker names it itself, and searching still works", async () => {
    getListMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("lookup failed"));
    });

    renderPicker({
      type: EntityFilterModelType.Monitor,
      isMultiSelect: true,
      value: [LISTED._id, PAST_CAP._id],
    });

    expect(
      await screen.findByRole("button", { name: "Remove API gateway" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Zeta checkout" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("lookup failed")).not.toBeInTheDocument();

    await openSearchedMenu();
    expect(
      await screen.findByRole("option", { name: "Billing worker" }),
    ).toBeInTheDocument();
  });
});
