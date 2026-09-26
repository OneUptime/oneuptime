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

const getItemMock: MockFunction = getJestMockFunction();

/*
 * ErrorMessage runs its text through i18next. No instance is set up in these
 * tests, so hand back the source string and keep the run free of the
 * missing-instance warning.
 */
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

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so getItemMock is still unassigned when the factory runs.
 * Dereferencing it lazily, at call time, is what makes this work.
 */
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

import FetchAlertState from "../../../../App/FeatureSet/Dashboard/src/Components/AlertState/FetchAlertState";
import FetchIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentState/FetchIncidentState";
import FetchAlertSeverity from "../../../../App/FeatureSet/Dashboard/src/Components/AlertSeverity/FetchAlertSeverity";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

/*
 * A create wizard's form holds only the id of the state or severity picked,
 * so the review step used to print a fixed sentence ("Initial state will be
 * set to selected state") that named nothing. The review step now hands the
 * id to one of these three components, which look the model up and draw the
 * same colored pill the event pages use.
 *
 * The three are the same component over three models, so every behaviour here
 * runs once per model. ModelAPI is the only fake: the pill, the loader and
 * the error message are the real ones a user sees.
 */

type PickedModel = AlertState | IncidentState | AlertSeverity;

type PickedModelType =
  | typeof AlertState
  | typeof IncidentState
  | typeof AlertSeverity;

interface PickedChoice {
  id: string;
  name: string;
  color: string;
}

interface FetchCase {
  componentName: string;
  modelType: PickedModelType;
  notFoundSentence: string;
  first: PickedChoice;
  second: PickedChoice;
  buildModel: (
    id: string,
    name: string | undefined,
    color: string | undefined,
  ) => PickedModel;
  renderFor: (id: ObjectID) => ReactElement;
}

/*
 * The models share name/color columns but not a base type that declares
 * them, so each case builds its own. Leaving name or color undefined models
 * a row that has none.
 */
type ApplyNameAndColorFunction = (
  model: PickedModel,
  id: string,
  name: string | undefined,
  color: string | undefined,
) => PickedModel;

const applyNameAndColor: ApplyNameAndColorFunction = (
  model: PickedModel,
  id: string,
  name: string | undefined,
  color: string | undefined,
): PickedModel => {
  model._id = id;

  if (name !== undefined) {
    model.name = name;
  }

  if (color !== undefined) {
    model.color = new Color(color);
  }

  return model;
};

const FETCH_CASES: Array<FetchCase> = [
  {
    componentName: "FetchAlertState",
    modelType: AlertState,
    notFoundSentence: "The selected alert state could not be found.",
    first: {
      id: "0193c0de-1111-4aaa-8bbb-000000000001",
      name: "Acknowledged",
      color: "#f59e0b",
    },
    second: {
      id: "0193c0de-1111-4aaa-8bbb-000000000002",
      name: "Resolved",
      color: "#10b981",
    },
    buildModel: (
      id: string,
      name: string | undefined,
      color: string | undefined,
    ): PickedModel => {
      return applyNameAndColor(new AlertState(), id, name, color);
    },
    renderFor: (id: ObjectID): ReactElement => {
      return <FetchAlertState alertStateId={id} />;
    },
  },
  {
    componentName: "FetchIncidentState",
    modelType: IncidentState,
    notFoundSentence: "The selected incident state could not be found.",
    first: {
      id: "0193c0de-2222-4aaa-8bbb-000000000001",
      name: "Investigating",
      color: "#ef4444",
    },
    second: {
      id: "0193c0de-2222-4aaa-8bbb-000000000002",
      name: "Monitoring",
      color: "#3b82f6",
    },
    buildModel: (
      id: string,
      name: string | undefined,
      color: string | undefined,
    ): PickedModel => {
      return applyNameAndColor(new IncidentState(), id, name, color);
    },
    renderFor: (id: ObjectID): ReactElement => {
      return <FetchIncidentState incidentStateId={id} />;
    },
  },
  {
    componentName: "FetchAlertSeverity",
    modelType: AlertSeverity,
    notFoundSentence: "The selected alert severity could not be found.",
    first: {
      id: "0193c0de-3333-4aaa-8bbb-000000000001",
      name: "Critical",
      color: "#dc2626",
    },
    second: {
      id: "0193c0de-3333-4aaa-8bbb-000000000002",
      name: "Minor",
      color: "#eab308",
    },
    buildModel: (
      id: string,
      name: string | undefined,
      color: string | undefined,
    ): PickedModel => {
      return applyNameAndColor(new AlertSeverity(), id, name, color);
    },
    renderFor: (id: ObjectID): ReactElement => {
      return <FetchAlertSeverity alertSeverityId={id} />;
    },
  },
];

/*
 * A promise the test settles by hand, so it decides which lookup answers
 * first - that ordering is the whole point of the stale-answer tests.
 */
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
    ): void => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

interface GetItemRequest {
  modelType: PickedModelType;
  id: ObjectID;
  select: Record<string, unknown>;
}

function getItemRequest(callIndex: number): GetItemRequest {
  return getItemMock.mock.calls[callIndex]![0] as GetItemRequest;
}

/*
 * AlertStateElement draws a solid pill whose background is the color;
 * IncidentStateElement and AlertSeverityElement draw the minimal pill, where
 * the color is a dot beside the name. Either way the name sits inside a
 * rounded pill, and the colored part is the dot when there is one.
 */
function getPillColorElement(name: string): HTMLElement {
  const nameElement: HTMLElement = screen.getByText(name);
  const pill: HTMLElement | null = nameElement.closest(".rounded-full");

  expect(pill).not.toBeNull();

  const dot: HTMLElement | null = pill!.querySelector('[aria-hidden="true"]');

  return dot || pill!;
}

/*
 * Asserting on the DOM after each step can miss a name that was painted and
 * then replaced inside a single act(). This keeps every text the container
 * ever held - added nodes and the old value of every edited text node - so a
 * test can say a name never reached the screen, not just that it is gone now.
 */
interface TextHistory {
  everShown: (text: string) => boolean;
  stop: () => void;
}

function recordTextHistory(root: HTMLElement): TextHistory {
  const seen: Array<string> = [root.textContent || ""];

  const collect: (records: Array<MutationRecord>) => void = (
    records: Array<MutationRecord>,
  ): void => {
    for (const record of records) {
      if (record.oldValue) {
        seen.push(record.oldValue);
      }

      record.addedNodes.forEach((node: Node): void => {
        seen.push(node.textContent || "");
      });
    }

    seen.push(root.textContent || "");
  };

  const observer: MutationObserver = new MutationObserver(collect);

  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  });

  return {
    everShown: (text: string): boolean => {
      collect(observer.takeRecords());
      return seen.some((value: string): boolean => {
        return value.includes(text);
      });
    },
    stop: (): void => {
      observer.disconnect();
    },
  };
}

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(FETCH_CASES)("$componentName", (fetchCase: FetchCase) => {
  const firstModel: () => PickedModel = (): PickedModel => {
    return fetchCase.buildModel(
      fetchCase.first.id,
      fetchCase.first.name,
      fetchCase.first.color,
    );
  };

  const secondModel: () => PickedModel = (): PickedModel => {
    return fetchCase.buildModel(
      fetchCase.second.id,
      fetchCase.second.name,
      fetchCase.second.color,
    );
  };

  test("shows a loader while the lookup is out, then the picked name in a pill of its color", async () => {
    const lookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    getItemMock.mockReturnValueOnce(lookup.promise);

    render(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByText(fetchCase.first.name)).toBeNull();

    await act(async () => {
      lookup.resolve(firstModel());
    });

    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(screen.getByText(fetchCase.first.name)).toBeInTheDocument();
    expect(getPillColorElement(fetchCase.first.name)).toHaveStyle({
      backgroundColor: fetchCase.first.color,
    });
  });

  test("looks up exactly the picked id on the right model, asking for its name and color", async () => {
    getItemMock.mockResolvedValueOnce(firstModel());

    render(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

    expect(await screen.findByText(fetchCase.first.name)).toBeInTheDocument();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: GetItemRequest = getItemRequest(0);

    expect(request.modelType).toBe(fetchCase.modelType);
    expect(request.id).toBeInstanceOf(ObjectID);
    expect(request.id.toString()).toBe(fetchCase.first.id);
    expect(request.select).toEqual(
      expect.objectContaining({ name: true, color: true }),
    );
  });

  test.each([
    {
      failure: "a plain error",
      error: new Error("Could not load the picked value."),
      message: "Could not load the picked value.",
    },
    {
      failure: "a 502 from the gateway",
      error: new HTTPErrorResponse(502, { message: "Bad Gateway" }, {}),
      message: "Error connecting to server. Please try again in few minutes.",
    },
  ])(
    "when the lookup fails with $failure it shows the friendly message and no pill",
    async ({ error, message }: { error: unknown; message: string }) => {
      getItemMock.mockRejectedValueOnce(error);

      render(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByTestId("component-loader")).toBeNull();
      expect(screen.queryByTestId("pill")).toBeNull();
      expect(document.querySelector(".rounded-full")).toBeNull();
      expect(screen.queryByText(fetchCase.notFoundSentence)).toBeNull();
    },
  );

  /*
   * The real ModelAPI.getItem never resolves null for a missing row: the
   * server answers {} and the client turns that into a model with no id.
   * Read as a row, that empty model would draw a black "Unknown" pill for a
   * state or severity that was deleted after it was picked.
   */
  test.each([
    {
      answer: "an empty model (what the API sends for a missing id)",
      build: (): PickedModel | null => {
        return new fetchCase.modelType();
      },
    },
    {
      answer: "null",
      build: (): PickedModel | null => {
        return null;
      },
    },
  ])(
    "says the picked value could not be found when the lookup returns $answer",
    async ({ build }: { build: () => PickedModel | null }) => {
      getItemMock.mockResolvedValueOnce(build());

      render(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

      expect(
        await screen.findByText(fetchCase.notFoundSentence),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("component-loader")).toBeNull();
      expect(document.querySelector(".rounded-full")).toBeNull();
      expect(screen.queryByText("Unknown")).toBeNull();
    },
  );

  test("a row with no name or color still shows a pill, reading 'Unknown' in black", async () => {
    getItemMock.mockResolvedValueOnce(
      fetchCase.buildModel(fetchCase.first.id, undefined, undefined),
    );

    render(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(getPillColorElement("Unknown")).toHaveStyle({
      backgroundColor: "#000000",
    });
    expect(screen.queryByText(fetchCase.notFoundSentence)).toBeNull();
  });

  test("picking a different value looks the new one up and shows its name, not the old one", async () => {
    const secondLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    getItemMock
      .mockResolvedValueOnce(firstModel())
      .mockReturnValueOnce(secondLookup.promise);

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );

    expect(await screen.findByText(fetchCase.first.name)).toBeInTheDocument();

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.second.id)));

    /*
     * While the new choice is looked up, the review step must not keep
     * naming the old one.
     */
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByText(fetchCase.first.name)).toBeNull();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(getItemRequest(1).id.toString()).toBe(fetchCase.second.id);
    expect(getItemRequest(1).modelType).toBe(fetchCase.modelType);

    await act(async () => {
      secondLookup.resolve(secondModel());
    });

    expect(screen.getByText(fetchCase.second.name)).toBeInTheDocument();
    expect(getPillColorElement(fetchCase.second.name)).toHaveStyle({
      backgroundColor: fetchCase.second.color,
    });
    expect(screen.queryByText(fetchCase.first.name)).toBeNull();
  });

  /*
   * The create pages build a fresh ObjectID from the form value on every
   * render, so keying the lookup on the object rather than its value would
   * refetch - and flash the loader - each time the review step re-renders.
   */
  test("a re-render that passes the same id as a new ObjectID does not look it up again", async () => {
    getItemMock.mockResolvedValueOnce(firstModel());

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );

    expect(await screen.findByText(fetchCase.first.name)).toBeInTheDocument();

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.first.id)));

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(screen.getByText(fetchCase.first.name)).toBeInTheDocument();
  });

  test("an error for one value does not linger once a different value is picked", async () => {
    getItemMock
      .mockRejectedValueOnce(new Error("Could not load the picked value."))
      .mockResolvedValueOnce(secondModel());

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );

    expect(
      await screen.findByText("Could not load the picked value."),
    ).toBeInTheDocument();

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.second.id)));

    expect(await screen.findByText(fetchCase.second.name)).toBeInTheDocument();
    expect(screen.queryByText("Could not load the picked value.")).toBeNull();
  });

  test("an answer for the old value that arrives after the new value's answer never replaces it", async () => {
    const firstLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    const secondLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    getItemMock
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(secondLookup.promise);

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );
    const history: TextHistory = recordTextHistory(view.container);

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.second.id)));

    await act(async () => {
      secondLookup.resolve(secondModel());
    });

    expect(screen.getByText(fetchCase.second.name)).toBeInTheDocument();

    await act(async () => {
      firstLookup.resolve(firstModel());
    });

    expect(screen.getByText(fetchCase.second.name)).toBeInTheDocument();
    expect(getPillColorElement(fetchCase.second.name)).toHaveStyle({
      backgroundColor: fetchCase.second.color,
    });
    expect(history.everShown(fetchCase.first.name)).toBe(false);

    history.stop();
  });

  test("an answer for the old value that arrives while the new value is loading is ignored", async () => {
    const firstLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    const secondLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    getItemMock
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(secondLookup.promise);

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );
    const history: TextHistory = recordTextHistory(view.container);

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.second.id)));

    await act(async () => {
      firstLookup.resolve(firstModel());
    });

    // Still waiting on the value that is actually picked.
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      secondLookup.resolve(secondModel());
    });

    expect(screen.getByText(fetchCase.second.name)).toBeInTheDocument();
    expect(history.everShown(fetchCase.first.name)).toBe(false);

    history.stop();
  });

  test("a failure for the old value that arrives after the new value's answer is ignored too", async () => {
    const firstLookup: Deferred<PickedModel | null> =
      createDeferred<PickedModel | null>();
    getItemMock
      .mockReturnValueOnce(firstLookup.promise)
      .mockResolvedValueOnce(secondModel());

    const view: RenderResult = render(
      fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
    );

    view.rerender(fetchCase.renderFor(new ObjectID(fetchCase.second.id)));

    expect(await screen.findByText(fetchCase.second.name)).toBeInTheDocument();

    await act(async () => {
      firstLookup.reject(new Error("Could not load the picked value."));
    });

    expect(screen.getByText(fetchCase.second.name)).toBeInTheDocument();
    expect(screen.queryByText("Could not load the picked value.")).toBeNull();
  });

  test.each([
    { outcome: "an answer", settle: "resolve" as const },
    { outcome: "a failure", settle: "reject" as const },
  ])(
    "leaving the review step before $outcome arrives logs nothing and throws nothing",
    async ({ settle }: { settle: "resolve" | "reject" }) => {
      const lookup: Deferred<PickedModel | null> =
        createDeferred<PickedModel | null>();
      getItemMock.mockReturnValueOnce(lookup.promise);

      const view: RenderResult = render(
        fetchCase.renderFor(new ObjectID(fetchCase.first.id)),
      );

      view.unmount();

      /*
       * Spy only from here: the question is what the late answer does, and
       * render() itself can print a once-per-run test-utils deprecation
       * warning that has nothing to do with these components.
       */
      const consoleErrorSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "error")
        .mockImplementation((): void => {});
      const consoleWarnSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(console, "warn")
        .mockImplementation((): void => {});

      await act(async () => {
        if (settle === "resolve") {
          lookup.resolve(firstModel());
        } else {
          lookup.reject(new Error("Could not load the picked value."));
        }
      });

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(document.body.textContent).toBe("");
    },
  );
});
