import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import FieldType from "../../../UI/Components/Types/FieldType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ModelDetail used to have two bugs that only showed up on real pages.
 *
 *   1. Its fetch effect was keyed on the modelId ObjectID by identity. Pages
 *      build that id inline - Navigation.getLastParamAsObjectID() and friends
 *      return a new instance per call - so every parent re-render refetched
 *      the card and flashed its loader (a polling page did it every tick; a
 *      page whose onItemLoaded set state looped forever). Responses were also
 *      applied in arrival order, so a slow older request could overwrite a
 *      newer one.
 *   2. It copied its fields into state once, at mount. A getElement closing
 *      over the page's state kept rendering, and calling back with, the
 *      values from the first render.
 *
 * getItem hands back a fresh Probe per call, as the real API does - a shared
 * instance would hide any identity-based behaviour.
 */

const getItemMock: MockFunction = getJestMockFunction();

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

import ModelDetail from "../../../UI/Components/ModelDetail/ModelDetail";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * These render real components that fetch, so give the waits enough room to
 * survive a loaded CI box - the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROBE_ID: string = "22222222-2222-4222-8222-222222222222";

type MakeProbeFunction = (id: string, name: string) => Probe;

const makeProbe: MakeProbeFunction = (id: string, name: string): Probe => {
  const probe: Probe = new Probe();
  probe.id = new ObjectID(id);
  probe.name = name;
  return probe;
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

/*
 * Names each probe after the id it was asked for, so a test can tell which
 * request a rendered name came from.
 */
const NAME_BY_ID: Record<string, string> = {
  [PROBE_ID]: "WBHQ",
  [OTHER_PROBE_ID]: "Frankfurt",
};

type GetRequestedIdFunction = (callIndex: number) => string;

const getRequestedId: GetRequestedIdFunction = (callIndex: number): string => {
  return (getItemMock.mock.calls[callIndex] as Array<any>)[0].id.toString();
};

interface DetailProps {
  modelId: ObjectID;
  refresher?: boolean | undefined;
  onItemLoaded?: ((item: Probe) => void) | undefined;
}

const ProbeDetail: React.FunctionComponent<DetailProps> = (
  props: DetailProps,
): React.ReactElement => {
  return (
    <ModelDetail<Probe>
      modelType={Probe}
      id="probe-detail"
      modelId={props.modelId}
      refresher={props.refresher}
      onItemLoaded={props.onItemLoaded}
      fields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FieldType.Text,
        },
      ]}
    />
  );
};

describe("ModelDetail refetching", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getItemMock.mockImplementation((data: any) => {
      const id: string = data.id.toString();
      return Promise.resolve(makeProbe(id, NAME_BY_ID[id] || "unknown"));
    });
  });

  it("does not refetch when the parent re-renders with a new but equal ObjectID", async () => {
    const { rerender } = render(
      <ProbeDetail modelId={new ObjectID(PROBE_ID)} />,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    expect(getItemMock).toHaveBeenCalledTimes(1);

    // What Navigation.getLastParamAsObjectID() hands a page on every render.
    rerender(<ProbeDetail modelId={new ObjectID(PROBE_ID)} />);
    rerender(<ProbeDetail modelId={new ObjectID(PROBE_ID)} />);

    expect(getItemMock).toHaveBeenCalledTimes(1);
    // No loader flash either: the loaded item stays on screen.
    expect(screen.getByText("WBHQ")).toBeDefined();
  });

  it("does not refetch through CardModelDetail when the parent re-renders", async () => {
    const renderCard: (modelId: ObjectID) => React.ReactElement = (
      modelId: ObjectID,
    ): React.ReactElement => {
      return (
        <CardModelDetail<Probe>
          name="Probe Details"
          cardProps={{
            title: "Probe Details",
            description: "Here are more details for this probe.",
          }}
          isEditable={false}
          modelDetailProps={{
            modelType: Probe,
            id: "probe-card-detail",
            modelId: modelId,
            fields: [
              {
                field: { name: true },
                title: "Name",
                fieldType: FieldType.Text,
              },
            ],
          }}
        />
      );
    };

    const { rerender } = render(renderCard(new ObjectID(PROBE_ID)));

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    const callsAfterMount: number = getItemMock.mock.calls.length;

    rerender(renderCard(new ObjectID(PROBE_ID)));
    rerender(renderCard(new ObjectID(PROBE_ID)));

    expect(getItemMock.mock.calls.length).toBe(callsAfterMount);
    expect(screen.getByText("WBHQ")).toBeDefined();
  });

  it("refetches when the id actually changes", async () => {
    const { rerender } = render(
      <ProbeDetail modelId={new ObjectID(PROBE_ID)} />,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });

    rerender(<ProbeDetail modelId={new ObjectID(OTHER_PROBE_ID)} />);

    await screen.findByText("Frankfurt", {}, { timeout: WAIT_TIMEOUT });

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(getRequestedId(1)).toBe(OTHER_PROBE_ID);
    expect(screen.queryByText("WBHQ")).toBeNull();
  });

  it("refetches when the refresher toggles", async () => {
    const { rerender } = render(
      <ProbeDetail modelId={new ObjectID(PROBE_ID)} refresher={false} />,
    );

    await screen.findByText("WBHQ", {}, { timeout: WAIT_TIMEOUT });
    expect(getItemMock).toHaveBeenCalledTimes(1);

    getItemMock.mockImplementation((data: any) => {
      return Promise.resolve(makeProbe(data.id.toString(), "WBHQ renamed"));
    });

    rerender(<ProbeDetail modelId={new ObjectID(PROBE_ID)} refresher={true} />);

    await screen.findByText("WBHQ renamed", {}, { timeout: WAIT_TIMEOUT });
    expect(getItemMock).toHaveBeenCalledTimes(2);

    rerender(
      <ProbeDetail modelId={new ObjectID(PROBE_ID)} refresher={false} />,
    );

    await waitFor(
      () => {
        expect(getItemMock).toHaveBeenCalledTimes(3);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  it("drops a response that arrives after a newer request's", async () => {
    const older: Deferred<Probe> = makeDeferred<Probe>();
    const newer: Deferred<Probe> = makeDeferred<Probe>();

    getItemMock
      .mockImplementationOnce(() => {
        return older.promise;
      })
      .mockImplementationOnce(() => {
        return newer.promise;
      });

    const onItemLoaded: MockFunction = getJestMockFunction();

    const { rerender } = render(
      <ProbeDetail
        modelId={new ObjectID(PROBE_ID)}
        onItemLoaded={onItemLoaded}
      />,
    );

    expect(getItemMock).toHaveBeenCalledTimes(1);

    rerender(
      <ProbeDetail
        modelId={new ObjectID(OTHER_PROBE_ID)}
        onItemLoaded={onItemLoaded}
      />,
    );

    expect(getItemMock).toHaveBeenCalledTimes(2);

    // The newer request answers first...
    await act(async () => {
      newer.resolve(makeProbe(OTHER_PROBE_ID, "Frankfurt"));
    });

    await screen.findByText("Frankfurt", {}, { timeout: WAIT_TIMEOUT });

    // ...and then the older one straggles in.
    await act(async () => {
      older.resolve(makeProbe(PROBE_ID, "WBHQ"));
    });

    expect(screen.getByText("Frankfurt")).toBeDefined();
    expect(screen.queryByText("WBHQ")).toBeNull();

    expect(onItemLoaded).toHaveBeenCalledTimes(1);
    expect(((onItemLoaded.mock.calls[0] as Array<any>)[0] as Probe).name).toBe(
      "Frankfurt",
    );
  });

  it("renders getElement with the parent's latest state and callbacks", async () => {
    const seenCounts: Array<number> = [];

    const Page: React.FunctionComponent = (): React.ReactElement => {
      const [count, setCount] = React.useState<number>(0);

      return (
        <>
          <button
            onClick={() => {
              setCount((prev: number) => {
                return prev + 1;
              });
            }}
          >
            Increment
          </button>
          <ModelDetail<Probe>
            modelType={Probe}
            id="probe-detail-with-element"
            // A fresh ObjectID per render, exactly like a real page.
            modelId={new ObjectID(PROBE_ID)}
            fields={[
              {
                field: { name: true },
                title: "Name",
                fieldType: FieldType.Element,
                getElement: (item: Probe): React.ReactElement => {
                  return (
                    <button
                      onClick={() => {
                        seenCounts.push(count);
                      }}
                    >
                      {`${item.name} clicked ${count} times`}
                    </button>
                  );
                },
              },
            ]}
          />
        </>
      );
    };

    render(<Page />);

    await screen.findByText(
      "WBHQ clicked 0 times",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await userEvent.click(screen.getByText("Increment"));
    await userEvent.click(screen.getByText("Increment"));

    await screen.findByText(
      "WBHQ clicked 2 times",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    // The handler inside getElement closes over the latest state too.
    await userEvent.click(screen.getByText("WBHQ clicked 2 times"));
    expect(seenCounts).toEqual([2]);

    // And none of those parent re-renders went back to the server.
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});
