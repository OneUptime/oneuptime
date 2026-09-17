import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
 * The entity picker behind dashboard SLO widgets and dashboard variables.
 *
 * An archived SLO is retired - not evaluated, its numbers frozen - so it must
 * not be offered for a NEW widget or variable. But a widget that already points
 * at one keeps loading it by id, and its settings must not pretend nothing is
 * selected: a blank picker over a live selection is how that selection gets
 * silently dropped on the next edit. So the picker lists only live SLOs and,
 * separately, looks up any selected SLO that list is missing, showing it marked
 * "(archived)". Every other entity type is untouched.
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
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";

const LIVE_SLO: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000101",
  name: "Checkout availability",
};

const ARCHIVED_SLO: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000102",
  name: "Legacy search latency",
};

function listOf(rows: Array<Row>): Promise<ListResultShape> {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 1000,
  });
}

/*
 * The server as the picker sees it: the pickable list returns only the live
 * SLO, and a lookup by id returns whichever SLOs were asked for, archived or
 * not.
 */
function serveSlos(args: ListArgs): Promise<ListResultShape> {
  const idFilter: unknown = args.query["_id"];

  if (idFilter instanceof Includes) {
    const ids: Array<string> = (idFilter.values as Array<ObjectID>).map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );

    return listOf(
      [LIVE_SLO, ARCHIVED_SLO].filter((row: Row): boolean => {
        return ids.includes(row._id);
      }),
    );
  }

  return listOf([LIVE_SLO]);
}

function renderPicker(options: {
  type: EntityFilterModelType;
  isMultiSelect?: boolean | undefined;
  value?: string | Array<string> | undefined;
}): void {
  render(
    <EntityFilterDropdown
      entityFilterModelType={options.type}
      isMultiSelect={Boolean(options.isMultiSelect)}
      value={options.value}
      onChange={() => {
        return undefined;
      }}
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

beforeEach(() => {
  getListMock.mockReset().mockImplementation(serveSlos);
});

afterEach(() => {
  cleanup();
});

describe("EntityFilterDropdown and archived SLOs", () => {
  test("offers only unarchived SLOs, within the current project", async () => {
    renderPicker({ type: EntityFilterModelType.ServiceLevelObjective });
    await waitForOptions();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(listCall(0).modelType).toBe(ServiceLevelObjective);
    expect(listCall(0).query["isArchived"]).toBe(false);
    expect((listCall(0).query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("leaves every other entity type's list exactly as it was", async () => {
    renderPicker({ type: EntityFilterModelType.Monitor });
    await waitForOptions();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(listCall(0).modelType).toBe(Monitor);
    expect(Object.keys(listCall(0).query)).toEqual(["projectId"]);
  });

  test("keeps showing an archived SLO a widget already points at, marked as archived", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: ARCHIVED_SLO._id,
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();

    expect(getListMock).toHaveBeenCalledTimes(2);

    const lookup: ListArgs = listCall(1);
    expect(lookup.modelType).toBe(ServiceLevelObjective);
    // By id, in the project, and NOT narrowed to live SLOs - that is the point.
    expect(Object.keys(lookup.query).sort()).toEqual(["_id", "projectId"]);
    expect(
      ((lookup.query["_id"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([ARCHIVED_SLO._id]);
    expect(lookup.limit).toBe(1);
  });

  test("in a multi-select, looks up only the selected SLOs the live list is missing", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [LIVE_SLO._id, ARCHIVED_SLO._id],
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(
      ((listCall(1).query["_id"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([ARCHIVED_SLO._id]);
  });

  test("never sends a malformed saved value to the lookup, so it cannot cost the real selection its label", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: ["not-an-id", ARCHIVED_SLO._id],
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(
      ((listCall(1).query["_id"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([ARCHIVED_SLO._id]);
  });

  test("makes no lookup at all when the only unlisted value is malformed", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: "not-an-id",
    });
    await waitForOptions();

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("makes no second lookup when every selected SLO is live", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: LIVE_SLO._id,
    });

    expect(
      await screen.findByText("Checkout availability"),
    ).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("makes no second lookup when nothing is selected", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [],
    });
    await waitForOptions();

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed lookup of the stale selection leaves the picker working", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.query["_id"]) {
        return Promise.reject(new Error("lookup failed"));
      }

      return listOf([LIVE_SLO]);
    });

    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: ARCHIVED_SLO._id,
    });
    await waitForOptions();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("lookup failed")).not.toBeInTheDocument();
    expect(screen.getByText("Select...")).toBeInTheDocument();
  });

  test("a failed list still shows its error, as before", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("list failed"));
    });

    renderPicker({ type: EntityFilterModelType.ServiceLevelObjective });

    expect(await screen.findByText("list failed")).toBeInTheDocument();
  });
});
