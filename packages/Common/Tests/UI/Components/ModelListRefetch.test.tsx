import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ModelList used to fetch from two effects - one keyed on refreshToggle and
 * one keyed on [] - and both run on mount, so every list sent two identical
 * getList requests on page load. It also applied responses in arrival order,
 * so whichever of those (or a refreshToggle refetch) answered last decided
 * what the list showed.
 *
 * getList hands back fresh Probe instances per call, as the real API does - a
 * shared instance would hide any identity-based behaviour.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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

import ModelList from "../../../UI/Components/ModelList/ModelList";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * These render a real component that fetches, so give the waits enough room
 * to survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";

type MakeListResultFunction = (name: string) => ListResult<Probe>;

const makeListResult: MakeListResultFunction = (
  name: string,
): ListResult<Probe> => {
  const probe: Probe = new Probe();
  probe.id = new ObjectID(PROBE_ID);
  probe.name = name;
  return { data: [probe], count: 1, skip: 0, limit: 1 };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

type MakeDeferredFunction = <T>() => Deferred<T>;

const makeDeferred: MakeDeferredFunction = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });
  return { promise, resolve };
};

interface ListProps {
  refreshToggle?: string | undefined;
  onListLoaded?: ((list: Array<Probe>) => void) | undefined;
}

const ProbeList: React.FunctionComponent<ListProps> = (
  props: ListProps,
): React.ReactElement => {
  return (
    <ModelList<Probe>
      id="probe-list"
      modelType={Probe}
      titleField="name"
      select={{ name: true }}
      noItemsMessage="No probes."
      refreshToggle={props.refreshToggle}
      onListLoaded={props.onListLoaded}
    />
  );
};

describe("ModelList refetching", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getListMock.mockImplementation(() => {
      return Promise.resolve(makeListResult("WBHQ"));
    });
  });

  it("calls getList exactly once on mount", async () => {
    render(<ProbeList refreshToggle="initial" />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when the parent re-renders with the same refreshToggle", async () => {
    const { rerender } = render(<ProbeList refreshToggle="initial" />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    rerender(<ProbeList refreshToggle="initial" />);
    rerender(<ProbeList refreshToggle="initial" />);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("WBHQ")).toBeDefined();
  });

  it("refetches when refreshToggle toggles", async () => {
    const { rerender } = render(<ProbeList refreshToggle="initial" />);

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    expect(getListMock).toHaveBeenCalledTimes(1);

    getListMock.mockImplementation(() => {
      return Promise.resolve(makeListResult("WBHQ renamed"));
    });

    rerender(<ProbeList refreshToggle="toggled" />);

    await screen.findByText("WBHQ renamed", {}, { timeout: WAIT_TIMEOUT });
    expect(getListMock).toHaveBeenCalledTimes(2);

    rerender(<ProbeList refreshToggle="toggled-again" />);

    await waitFor(
      () => {
        expect(getListMock).toHaveBeenCalledTimes(3);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  it("drops a response that arrives after a newer request's", async () => {
    const older: Deferred<ListResult<Probe>> =
      makeDeferred<ListResult<Probe>>();
    const newer: Deferred<ListResult<Probe>> =
      makeDeferred<ListResult<Probe>>();

    getListMock
      .mockImplementationOnce(() => {
        return older.promise;
      })
      .mockImplementationOnce(() => {
        return newer.promise;
      });

    const onListLoaded: MockFunction = getJestMockFunction();

    const { rerender } = render(
      <ProbeList refreshToggle="initial" onListLoaded={onListLoaded} />,
    );

    expect(getListMock).toHaveBeenCalledTimes(1);

    rerender(<ProbeList refreshToggle="toggled" onListLoaded={onListLoaded} />);

    expect(getListMock).toHaveBeenCalledTimes(2);

    // The newer request answers first...
    await act(async () => {
      newer.resolve(makeListResult("Frankfurt"));
    });

    await screen.findByText("Frankfurt", {}, { timeout: WAIT_TIMEOUT });

    // ...and then the older one straggles in.
    await act(async () => {
      older.resolve(makeListResult("WBHQ"));
    });

    expect(screen.getByText("Frankfurt")).toBeDefined();
    expect(screen.queryByText("WBHQ")).toBeNull();

    expect(onListLoaded).toHaveBeenCalledTimes(1);
    expect(
      ((onListLoaded.mock.calls[0] as Array<any>)[0] as Array<Probe>)[0]!.name,
    ).toBe("Frankfurt");
  });
});
