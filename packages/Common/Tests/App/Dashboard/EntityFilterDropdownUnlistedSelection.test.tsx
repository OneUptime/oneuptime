import "@testing-library/jest-dom";
import {
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
 * but the picker lists only the first 1000 rows of a type. In a big project a
 * saved id past that cap had no option: its chip vanished (a single select fell
 * back to its placeholder), and the next multi-select edit emitted only the
 * visible values - silently removing it from the widget. So any selected id the
 * list is missing is looked up by id and shown under its own name.
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

import EntityFilterDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import Includes from "../../../Types/BaseDatabase/Includes";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Label from "../../../Models/DatabaseModels/Label";

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

function listCall(index: number): ListArgs {
  return getListMock.mock.calls[index]![0];
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

beforeEach(() => {
  getListMock.mockReset().mockImplementation(serveRowCap);
});

afterEach(() => {
  cleanup();
});

describe("EntityFilterDropdown keeps a saved selection past the list's row cap", () => {
  test.each([
    { type: EntityFilterModelType.Monitor, modelType: Monitor },
    { type: EntityFilterModelType.Label, modelType: Label },
  ])(
    "$type multi-select: looks up the unlisted id and shows both chips by name",
    async ({
      type,
      modelType,
    }: {
      type: EntityFilterModelType;
      modelType: unknown;
    }) => {
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
      expect(lookup.select).toEqual({ _id: true, name: true });
    },
  );

  test("a single select shows the unlisted item's name, not the placeholder", async () => {
    renderPicker({
      type: EntityFilterModelType.Monitor,
      value: PAST_CAP._id,
      placeholder: "All monitors",
    });

    expect(await screen.findByText("Zeta checkout")).toBeInTheDocument();
    expect(screen.queryByText("All monitors")).not.toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    EntityFilterModelType.IncidentSeverity,
    EntityFilterModelType.AlertSeverity,
    EntityFilterModelType.IncidentState,
    EntityFilterModelType.AlertState,
    EntityFilterModelType.MonitorStatus,
    EntityFilterModelType.KubernetesCluster,
    EntityFilterModelType.DockerHost,
    EntityFilterModelType.PodmanHost,
    EntityFilterModelType.ProxmoxCluster,
    EntityFilterModelType.VMwareVCenter,
    EntityFilterModelType.CephCluster,
    EntityFilterModelType.DockerSwarmCluster,
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

  test("the unlisted chip can still be removed on purpose", async () => {
    const onChange: Mock<(value: string | Array<string> | null) => void> =
      jest.fn<(value: string | Array<string> | null) => void>();

    renderPicker({
      type: EntityFilterModelType.Monitor,
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
      type: EntityFilterModelType.Label,
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
      type: EntityFilterModelType.Monitor,
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
    renderPicker({ type: EntityFilterModelType.Label, value: LISTED._id });
    expect(await screen.findByText("API gateway")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);

    cleanup();
    getListMock.mockClear();

    renderPicker({ type: EntityFilterModelType.Label, isMultiSelect: true });
    await waitForOptions();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("never sends a malformed saved value to the lookup", async () => {
    renderPicker({
      type: EntityFilterModelType.Monitor,
      isMultiSelect: true,
      value: ["not-an-id", PAST_CAP._id],
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
      type: EntityFilterModelType.Monitor,
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
