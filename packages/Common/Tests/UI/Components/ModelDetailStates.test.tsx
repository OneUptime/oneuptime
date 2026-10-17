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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission, { UserPermission } from "../../../Types/Permission";

const getItemMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock consts are still unassigned when the
 * factories run. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import { DetailStyle } from "../../../UI/Components/Detail/Detail";
import { getDetailCellClassNames } from "../../../UI/Components/Detail/DetailGridLayout";
import {
  DETAIL_SKELETON_TEST_ID,
  MAX_DETAIL_SKELETON_CELLS,
} from "../../../UI/Components/Detail/DetailSkeleton";
import ModelDetail from "../../../UI/Components/ModelDetail/ModelDetail";
import Field from "../../../UI/Components/ModelDetail/Field";
import FieldType from "../../../UI/Components/Types/FieldType";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a detail card shows before, between and instead of its fields
 * (ModelDetail):
 *
 *   - while its record loads, the rows the fields will fill - a skeleton in
 *     the grid they are laid out in - rather than a thin bar spinning in a
 *     100px gap the fields then replace at their own height;
 *   - while the record on screen is read again (after a save, or a field's
 *     own action), that record, until the new one lands: no flash of a
 *     loader over a card that was just edited;
 *   - when the read fails, why, and a real button to try again - it was a
 *     <span> with an onClick, which a keyboard could not reach.
 */

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const makeDeferred: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      resolvePromise: (value: T) => void,
      rejectPromise: (error: Error) => void,
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
};

const makeProbe: (id: ObjectID, name: string) => Probe = (
  id: ObjectID,
  name: string,
): Probe => {
  const probe: Probe = new Probe(id);
  probe.name = name;
  probe.description = "Runs checks from Virginia";
  return probe;
};

const FIELDS: Array<Field<Probe>> = [
  { field: { _id: true }, title: "Probe ID", fieldType: FieldType.ObjectID },
  { field: { name: true }, title: "Name" },
  { field: { description: true }, title: "Description", colSpan: 2 },
  { field: { key: true }, title: "Key" },
  {
    field: { createdAt: true },
    title: "Created At",
    fieldType: FieldType.DateTime,
  },
  {
    title: "No column",
    getElement: (): ReactElement => {
      return <span>Nothing</span>;
    },
  },
];

type RenderProbeFunction = (props: {
  modelId?: ObjectID | undefined;
  refresher?: boolean | undefined;
  style?: DetailStyle | undefined;
  columns?: number | undefined;
  fields?: Array<Field<Probe>> | undefined;
}) => ReactElement;

const probeDetail: RenderProbeFunction = (props: {
  modelId?: ObjectID | undefined;
  refresher?: boolean | undefined;
  style?: DetailStyle | undefined;
  columns?: number | undefined;
  fields?: Array<Field<Probe>> | undefined;
}): ReactElement => {
  return (
    <ModelDetail<Probe>
      modelType={Probe}
      id="probe-detail"
      modelId={props.modelId || PROBE_ID}
      refresher={props.refresher}
      style={props.style}
      showDetailsInNumberOfColumns={
        props.columns === undefined ? 2 : props.columns
      }
      fields={props.fields || FIELDS}
    />
  );
};

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("while the record loads", () => {
  test("the card shows its fields' rows as a skeleton, in the grid they will fill", () => {
    getItemMock.mockImplementation(() => {
      return makeDeferred<Probe>().promise;
    });

    render(probeDetail({}));

    const skeleton: HTMLElement = screen.getByTestId(DETAIL_SKELETON_TEST_ID);

    // Said to a screen reader as the bar was.
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-label", "Loading");
    expect(within(skeleton).getByText("Loading...")).toHaveClass("sr-only");
    expect(screen.queryByTestId("bar-loader")).toBeNull();

    /*
     * One cell per field the grid will draw: Name, Description (two
     * columns wide) and Key - not the ID or Created At, which go on the
     * line under the fields, nor a field with no column, which draws
     * nothing.
     */
    const skeletonCells: Array<HTMLElement> = within(skeleton).getAllByTestId(
      `${DETAIL_SKELETON_TEST_ID}-cell`,
    );

    expect(skeletonCells).toHaveLength(3);
    expect(
      skeletonCells.map((cell: HTMLElement): string => {
        return cell.className;
      }),
    ).toEqual(getDetailCellClassNames([undefined, 2, undefined], 2));
  });

  test("a compact card's skeleton has the compact rows", () => {
    getItemMock.mockImplementation(() => {
      return makeDeferred<Probe>().promise;
    });

    render(probeDetail({ style: DetailStyle.Compact, columns: 1 }));

    const skeleton: HTMLElement = screen.getByTestId(DETAIL_SKELETON_TEST_ID);
    const grid: HTMLElement = skeleton.firstElementChild as HTMLElement;

    expect(grid).toHaveClass("divide-y", "divide-gray-100", "sm:grid-cols-1");
    for (const cell of within(skeleton).getAllByTestId(
      `${DETAIL_SKELETON_TEST_ID}-cell`,
    )) {
      expect(cell).toHaveClass("py-3", "first:pt-0", "last:pb-0");
    }
  });

  test("a card with many fields draws no more than a dozen rows of skeleton", () => {
    getItemMock.mockImplementation(() => {
      return makeDeferred<Probe>().promise;
    });

    render(
      probeDetail({
        columns: 1,
        fields: Array.from({ length: 30 }, (): Field<Probe> => {
          return { field: { name: true }, title: "Name" };
        }),
      }),
    );

    expect(
      screen.getAllByTestId(`${DETAIL_SKELETON_TEST_ID}-cell`),
    ).toHaveLength(MAX_DETAIL_SKELETON_CELLS);
  });

  test("the skeleton gives way to the fields once the record lands", async () => {
    const read: Deferred<Probe> = makeDeferred<Probe>();
    getItemMock.mockImplementation(() => {
      return read.promise;
    });

    render(probeDetail({}));

    expect(screen.getByTestId(DETAIL_SKELETON_TEST_ID)).toBeInTheDocument();

    await act(async () => {
      read.resolve(makeProbe(PROBE_ID, "WBHQ"));
    });

    expect(
      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(DETAIL_SKELETON_TEST_ID)).toBeNull();
  });
});

describe("reading the record on screen again", () => {
  test("keeps it on screen until the new one lands - no skeleton, no flash", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.resolve(makeProbe(PROBE_ID, "WBHQ"));
    });

    const { rerender } = render(probeDetail({ refresher: false }));

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    const reread: Deferred<Probe> = makeDeferred<Probe>();
    getItemMock.mockImplementation(() => {
      return reread.promise;
    });

    rerender(probeDetail({ refresher: true }));

    // The read is out; the record stays.
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("WBHQ")).toBeInTheDocument();
    expect(screen.queryByTestId(DETAIL_SKELETON_TEST_ID)).toBeNull();

    await act(async () => {
      reread.resolve(makeProbe(PROBE_ID, "WBHQ renamed"));
    });

    expect(
      await screen.findByText("WBHQ renamed", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
  });

  test("another record shows the skeleton while it loads - never the last one's values", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.resolve(makeProbe(PROBE_ID, "WBHQ"));
    });

    const { rerender } = render(probeDetail({}));

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    const other: Deferred<Probe> = makeDeferred<Probe>();
    getItemMock.mockImplementation(() => {
      return other.promise;
    });

    rerender(probeDetail({ modelId: OTHER_PROBE_ID }));

    expect(screen.getByTestId(DETAIL_SKELETON_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByText("WBHQ")).toBeNull();

    await act(async () => {
      other.resolve(makeProbe(OTHER_PROBE_ID, "Frankfurt"));
    });

    expect(
      await screen.findByText("Frankfurt", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
  });
});

describe("a read that fails", () => {
  test("says why, with a real button that reads the record again", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.reject(new Error("We could not reach OneUptime."));
    });

    render(probeDetail({}));

    const error: HTMLElement = await screen.findByTestId(
      "model-detail-error",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(error).toHaveTextContent("We could not reach OneUptime.");

    const retry: HTMLElement = within(error).getByTestId("refresh-button");

    expect(retry.tagName).toBe("BUTTON");
    expect(retry).toHaveAttribute("type", "button");
    expect(retry).toHaveTextContent("Refresh?");

    getItemMock.mockImplementation(() => {
      return Promise.resolve(makeProbe(PROBE_ID, "WBHQ"));
    });

    await act(async () => {
      fireEvent.click(retry);
    });

    expect(
      await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("model-detail-error")).toBeNull();
  });

  test("a record the reader may not read says so, with the same way to try again", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.resolve(null);
    });

    render(probeDetail({}));

    const error: HTMLElement = await screen.findByTestId(
      "model-detail-error",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(error).toHaveTextContent(
      "Cannot load probe. It could be because you don't have enough permissions to read this probe.",
    );
    expect(within(error).getByTestId("refresh-button").tagName).toBe("BUTTON");
  });
});
