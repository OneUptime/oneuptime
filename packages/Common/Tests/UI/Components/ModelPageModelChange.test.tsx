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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ModelPage hosts a layout route: the side menu and the "Incident - <title>"
 * heading stay mounted while the <Outlet/> below them changes. It used to read
 * the model once, on mount. A link from one incident to another on the same
 * route (the AI report links related incidents) kept the layout mounted, so
 * the heading, the document title and the header labels all stayed on the
 * incident the reader had left, while the page below showed the new one.
 *
 * These tests render the real ModelPage and Page against a fake API and
 * switch the model id the way a layout does: same component, new id.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

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

import ModelPage from "../../../UI/Components/Page/ModelPage";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";

const INCIDENT_A: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_B: string = "22222222-2222-4222-8222-222222222222";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}

type BuildIncidentFunction = (
  id: string,
  title: string,
  labelNames: Array<string>,
) => Incident;

const buildIncident: BuildIncidentFunction = (
  id: string,
  title: string,
  labelNames: Array<string>,
): Incident => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(id);
  incident.title = title;
  incident.labels = labelNames.map((name: string, index: number): Label => {
    const label: Label = new Label();
    label.id = new ObjectID(`33333333-3333-4333-8333-33333333333${index}`);
    label.name = name;
    return label;
  });

  return incident;
};

// Every render and mount of the page body, with the id it was given.
const childRenders: Array<string> = [];
const childMounts: Array<string> = [];

const ChildPage: (props: { incidentId: string }) => ReactElement = (props: {
  incidentId: string;
}): ReactElement => {
  childRenders.push(props.incidentId);

  React.useEffect(() => {
    childMounts.push(props.incidentId);
  }, []);

  return <div data-testid="child-page">{`Body of ${props.incidentId}`}</div>;
};

type RenderLayoutFunction = (
  incidentId: string,
  refreshToken?: number,
) => ReactElement;

/*
 * What a layout route renders: a fresh ObjectID built from the route params
 * on every render, a side menu, and the routed page as the child. A layout
 * whose page can edit the header bumps refreshToken.
 */
const layoutFor: RenderLayoutFunction = (
  incidentId: string,
  refreshToken?: number,
): ReactElement => {
  return (
    <ModelPage
      title="Incident"
      modelType={Incident}
      modelId={new ObjectID(incidentId)}
      modelNameField="title"
      refreshToken={refreshToken}
      sideMenu={<nav data-testid="side-menu">{`Menu for ${incidentId}`}</nav>}
    >
      <ChildPage incidentId={incidentId} />
    </ModelPage>
  );
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

function requestedIds(): Array<string> {
  return getItemMock.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { id: ObjectID }).id.toString();
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  childRenders.length = 0;
  childMounts.length = 0;
  document.title = "OneUptime";
});

afterEach(() => {
  cleanup();
});

describe("ModelPage", () => {
  test("reads the model's title and labels once and shows them over the page", async () => {
    getItemMock.mockResolvedValue(
      buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
    );

    const view: RenderResult = render(layoutFor(INCIDENT_A));

    // Loading: the heading is the plain title and the page body waits.
    expect(heading()).toHaveTextContent(/^Incident$/);
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("child-page")).toBeNull();

    await flush();

    expect(heading()).toHaveTextContent("Incident - Checkout is slow");
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByTestId("child-page")).toHaveTextContent(
      `Body of ${INCIDENT_A}`,
    );
    expect(document.title).toBe("OneUptime | Incident - Checkout is slow");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock.mock.calls[0]![0]).toMatchObject({
      modelType: Incident,
      select: {
        title: true,
        labels: { _id: true, name: true, color: true },
      },
    });

    // A re-render builds a new ObjectID for the same id: no second read.
    view.rerender(layoutFor(INCIDENT_A));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(childMounts).toEqual([INCIDENT_A]);
  });

  test("moving to another model on the same route reads it and replaces the heading, labels and document title", async () => {
    const second: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
      )
      .mockReturnValueOnce(second.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    expect(heading()).toHaveTextContent("Incident - Checkout is slow");

    view.rerender(layoutFor(INCIDENT_B));

    // Synchronously, before any effect: nothing of the old incident is left.
    expect(heading()).toHaveTextContent(/^Incident$/);
    expect(screen.queryByText("Checkout is slow")).toBeNull();
    expect(screen.queryByText("production")).toBeNull();
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("child-page")).toBeNull();
    // The side menu is part of the layout and stays, pointing at the new id.
    expect(screen.getByTestId("side-menu")).toHaveTextContent(
      `Menu for ${INCIDENT_B}`,
    );

    await flush();

    expect(requestedIds()).toEqual([INCIDENT_A, INCIDENT_B]);

    await act(async () => {
      second.resolve(
        buildIncident(INCIDENT_B, "Payments failing", ["billing"]),
      );
    });
    await flush();

    expect(heading()).toHaveTextContent("Incident - Payments failing");
    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.queryByText("production")).toBeNull();
    expect(document.title).toBe("OneUptime | Incident - Payments failing");
    expect(screen.getByTestId("child-page")).toHaveTextContent(
      `Body of ${INCIDENT_B}`,
    );
  });

  test("the page body never renders for the new model under the old heading, and mounts once per model", async () => {
    const second: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", []) as never,
      )
      .mockReturnValueOnce(second.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    view.rerender(layoutFor(INCIDENT_B));
    await flush();

    expect(childRenders).not.toContain(INCIDENT_B);

    await act(async () => {
      second.resolve(buildIncident(INCIDENT_B, "Payments failing", []));
    });
    await flush();

    expect(childRenders).toContain(INCIDENT_B);
    // Remounted for the new model, so nothing the old page held carries over.
    expect(childMounts).toEqual([INCIDENT_A, INCIDENT_B]);
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("a slow read of the model the reader already left cannot overwrite the new one", async () => {
    const first: Deferred<Incident> = createDeferred<Incident>();
    const second: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    view.rerender(layoutFor(INCIDENT_B));
    await flush();

    // The old model answers first: still loading the new one.
    await act(async () => {
      first.resolve(buildIncident(INCIDENT_A, "Left behind", ["old"]));
    });
    await flush();

    expect(heading()).toHaveTextContent(/^Incident$/);
    expect(screen.queryByText("Left behind")).toBeNull();
    expect(screen.queryByTestId("child-page")).toBeNull();

    await act(async () => {
      second.resolve(buildIncident(INCIDENT_B, "On screen now", ["new"]));
    });
    await flush();

    expect(heading()).toHaveTextContent("Incident - On screen now");
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.queryByText("old")).toBeNull();
  });

  test("a slow read that answers after the new model loaded is ignored too", async () => {
    const first: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_B, "On screen now", []) as never,
      );

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    view.rerender(layoutFor(INCIDENT_B));
    await flush();

    expect(heading()).toHaveTextContent("Incident - On screen now");

    await act(async () => {
      first.resolve(buildIncident(INCIDENT_A, "Left behind", []));
    });
    await flush();

    expect(heading()).toHaveTextContent("Incident - On screen now");
    expect(screen.getByTestId("child-page")).toHaveTextContent(
      `Body of ${INCIDENT_B}`,
    );
  });

  test("an error reading one model does not stick to the next", async () => {
    getItemMock
      .mockRejectedValueOnce(new Error("Not allowed") as never)
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_B, "Payments failing", []) as never,
      );

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(screen.queryByTestId("child-page")).toBeNull();

    view.rerender(layoutFor(INCIDENT_B));
    await flush();

    expect(screen.queryByText("Not allowed")).toBeNull();
    expect(heading()).toHaveTextContent("Incident - Payments failing");
    expect(screen.getByTestId("child-page")).toBeInTheDocument();
  });

  test("a model the reader cannot read says so instead of loading forever", async () => {
    getItemMock.mockResolvedValue(null as never);

    render(layoutFor(INCIDENT_A));
    await flush();

    expect(
      screen.getByText(
        "Cannot load incident. It could be because you don't have enough permissions to read this incident.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });

  test("a read still in flight when the page unmounts changes nothing", async () => {
    const first: Deferred<Incident> = createDeferred<Incident>();

    getItemMock.mockReturnValueOnce(first.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A));
    await flush();

    expect(document.title).toBe("OneUptime | Incident");

    view.unmount();

    await act(async () => {
      first.resolve(buildIncident(INCIDENT_A, "Too late", []));
    });
    await flush();

    expect(document.title).toBe("OneUptime | Incident");
    expect(screen.queryByText(/Too late/)).toBeNull();
  });
});

/*
 * A page below the header can change what the header shows - the monitor
 * overview edits the monitor's name and labels in place - so the layout bumps
 * refreshToken to have the header read again. A refresh is not a model
 * change: the page below must stay mounted through it, and a refresh that
 * fails must not take the page away over a transient error, since the header
 * already on screen is still right.
 */
describe("ModelPage - refreshing the header", () => {
  test("a refreshToken bump re-reads the header and keeps children mounted", async () => {
    const refresh: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
      )
      .mockReturnValueOnce(refresh.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    expect(heading()).toHaveTextContent("Incident - Checkout is slow");

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();

    expect(requestedIds()).toEqual([INCIDENT_A, INCIDENT_A]);

    // While the refresh is in flight the page and its header stay as they are.
    expect(heading()).toHaveTextContent("Incident - Checkout is slow");
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(screen.getByTestId("child-page")).toBeInTheDocument();

    await act(async () => {
      refresh.resolve(
        buildIncident(INCIDENT_A, "Checkout is fast", ["staging"]),
      );
    });
    await flush();

    expect(heading()).toHaveTextContent("Incident - Checkout is fast");
    expect(screen.getByText("staging")).toBeInTheDocument();
    expect(screen.queryByText("production")).toBeNull();
    expect(document.title).toBe("OneUptime | Incident - Checkout is fast");

    // Mounted once, and never shown the loader in between.
    expect(childMounts).toEqual([INCIDENT_A]);
  });

  test("a re-render with the same refreshToken does not read again", async () => {
    getItemMock.mockResolvedValue(
      buildIncident(INCIDENT_A, "Checkout is slow", []) as never,
    );

    const view: RenderResult = render(layoutFor(INCIDENT_A, 3));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 3));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a failed refresh keeps the previous title and labels", async () => {
    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
      )
      .mockRejectedValueOnce(new Error("Network blip") as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Network blip")).toBeNull();
    expect(heading()).toHaveTextContent("Incident - Checkout is slow");
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByTestId("child-page")).toBeInTheDocument();
    expect(childMounts).toEqual([INCIDENT_A]);
  });

  test("a refresh that comes back empty keeps the previous header too", async () => {
    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
      )
      .mockResolvedValueOnce(null as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Cannot load incident/)).toBeNull();
    expect(heading()).toHaveTextContent("Incident - Checkout is slow");
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByTestId("child-page")).toBeInTheDocument();
  });

  test("a later refresh that succeeds after a failed one still updates the header", async () => {
    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", []) as never,
      )
      .mockRejectedValueOnce(new Error("Network blip") as never)
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is fast", []) as never,
      );

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 2));
    await flush();

    expect(heading()).toHaveTextContent("Incident - Checkout is fast");
    expect(childMounts).toEqual([INCIDENT_A]);
  });

  test("a page showing a load error recovers on the next refresh", async () => {
    getItemMock
      .mockRejectedValueOnce(new Error("Not allowed") as never)
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", []) as never,
      );

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(screen.queryByTestId("child-page")).toBeNull();

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();

    expect(screen.queryByText("Not allowed")).toBeNull();
    expect(heading()).toHaveTextContent("Incident - Checkout is slow");
    expect(screen.getByTestId("child-page")).toBeInTheDocument();
  });

  test("a stale refresh after an id change is ignored", async () => {
    const staleRefresh: Deferred<Incident> = createDeferred<Incident>();
    const second: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", ["production"]) as never,
      )
      .mockReturnValueOnce(staleRefresh.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    // Refresh A, then move to B while that refresh is still in flight.
    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();
    view.rerender(layoutFor(INCIDENT_B, 1));
    await flush();

    expect(requestedIds()).toEqual([INCIDENT_A, INCIDENT_A, INCIDENT_B]);

    await act(async () => {
      staleRefresh.resolve(
        buildIncident(INCIDENT_A, "Renamed while leaving", ["stale"]),
      );
    });
    await flush();

    // Still loading B: neither A's old nor its refreshed header comes back.
    expect(heading()).toHaveTextContent(/^Incident$/);
    expect(screen.queryByText(/Renamed while leaving/)).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.queryByTestId("child-page")).toBeNull();

    await act(async () => {
      second.resolve(buildIncident(INCIDENT_B, "Payments failing", ["new"]));
    });
    await flush();

    expect(heading()).toHaveTextContent("Incident - Payments failing");
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByTestId("child-page")).toHaveTextContent(
      `Body of ${INCIDENT_B}`,
    );
  });

  test("a refresh of the old model that fails after an id change shows no error on the new one", async () => {
    const staleRefresh: Deferred<Incident> = createDeferred<Incident>();

    getItemMock
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_A, "Checkout is slow", []) as never,
      )
      .mockReturnValueOnce(staleRefresh.promise as never)
      .mockResolvedValueOnce(
        buildIncident(INCIDENT_B, "Payments failing", []) as never,
      );

    const view: RenderResult = render(layoutFor(INCIDENT_A, 0));
    await flush();

    view.rerender(layoutFor(INCIDENT_A, 1));
    await flush();
    view.rerender(layoutFor(INCIDENT_B, 1));
    await flush();

    expect(heading()).toHaveTextContent("Incident - Payments failing");

    await act(async () => {
      staleRefresh.reject(new Error("Timed out"));
    });
    await flush();

    expect(screen.queryByText("Timed out")).toBeNull();
    expect(heading()).toHaveTextContent("Incident - Payments failing");
    expect(screen.getByTestId("child-page")).toHaveTextContent(
      `Body of ${INCIDENT_B}`,
    );
  });
});
