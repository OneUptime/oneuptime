import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProjectPaymentMethods, {
  ProjectPaymentMethodsState,
  useProjectPaymentMethodCount,
  useProjectPaymentMethods,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectPaymentMethods";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Whether the open project has a payment method, as the Dashboard knows it
 * without asking the payment provider (#11053): the count of its payment
 * methods the shell makes once a project opens (App.tsx) and the Billing
 * page makes again each time it lists them. Add to Balance reads it to say
 * a payment method is needed before it asks for an amount, and the
 * header's Add Card Details reads the count.
 *
 * Unknown until a count arrives - and Unknown changes nothing: the amount is
 * asked for, as before. A count is a project's own: another project's
 * answers nothing about this one.
 */

const PROJECT_ID: string = "11053000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT_ID: string = "11053000-0000-4000-8000-0000000000a2";

beforeEach(() => {
  ProjectPaymentMethods.reset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectPaymentMethods.reset();
});

describe("what is known of a project's payment methods", () => {
  test("Unknown until a count arrives", () => {
    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
    expect(ProjectPaymentMethods.getCount(PROJECT_ID)).toBeUndefined();
  });

  test("a count of none is None, and any more is Some", () => {
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 0 });
    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.None,
    );

    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 1 });
    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Some,
    );

    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 7 });
    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Some,
    );
    expect(ProjectPaymentMethods.getCount(PROJECT_ID)).toBe(7);
  });

  test("the project's id is read however it is written", () => {
    ProjectPaymentMethods.setCount({
      projectId: new ObjectID(PROJECT_ID),
      count: 0,
    });

    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.None,
    );
    expect(ProjectPaymentMethods.getState(new ObjectID(PROJECT_ID))).toBe(
      ProjectPaymentMethodsState.None,
    );
  });

  test("another project's count is not this one's", () => {
    ProjectPaymentMethods.setCount({ projectId: OTHER_PROJECT_ID, count: 0 });

    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
  });

  test.each([
    ["a negative count", -1],
    ["a fraction", 0.5],
    ["not a number", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("%s is no count: what was known stays", (_case: string, count: number) => {
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 2 });
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: count });

    expect(ProjectPaymentMethods.getCount(PROJECT_ID)).toBe(2);
  });

  test("no project is no count", () => {
    ProjectPaymentMethods.setCount({ projectId: null, count: 0 });
    ProjectPaymentMethods.setCount({ projectId: "", count: 0 });

    expect(ProjectPaymentMethods.getState(null)).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
    expect(ProjectPaymentMethods.getState("")).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
  });

  test("whoever listens hears of a new count, and of nothing else", () => {
    const heard: Array<number> = [];
    const stopListening: () => void = ProjectPaymentMethods.subscribe(() => {
      heard.push(ProjectPaymentMethods.getCount(PROJECT_ID) ?? -1);
    });

    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 0 });
    // The same count again changes nothing, so nothing is drawn again.
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 0 });
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 1 });
    stopListening();
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 3 });

    expect(heard).toEqual([0, 1]);
  });

  test("reset forgets every count", () => {
    ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 0 });
    ProjectPaymentMethods.setCount({ projectId: OTHER_PROJECT_ID, count: 1 });

    ProjectPaymentMethods.reset();

    expect(ProjectPaymentMethods.getState(PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
    expect(ProjectPaymentMethods.getState(OTHER_PROJECT_ID)).toBe(
      ProjectPaymentMethodsState.Unknown,
    );
  });

  test("the last count of each project is the one known, however counts arrive", () => {
    const random: SeededRandom = seededRandom(11053);
    const projectIds: Array<string> = [PROJECT_ID, OTHER_PROJECT_ID];
    const lastCounts: Map<string, number> = new Map<string, number>();

    for (let step: number = 0; step < 500; step++) {
      const projectId: string = projectIds[random(projectIds.length)]!;
      // Mostly none or a few; now and then a count that is no count.
      const isNoCount: boolean = random(10) === 0;
      const count: number = isNoCount ? -1 - random(5) : random(4);

      ProjectPaymentMethods.setCount({ projectId: projectId, count: count });

      if (!isNoCount) {
        lastCounts.set(projectId, count);
      }

      for (const id of projectIds) {
        const expected: number | undefined = lastCounts.get(id);

        expect(ProjectPaymentMethods.getCount(id)).toBe(expected);
        expect(ProjectPaymentMethods.getState(id)).toBe(
          expected === undefined
            ? ProjectPaymentMethodsState.Unknown
            : expected > 0
              ? ProjectPaymentMethodsState.Some
              : ProjectPaymentMethodsState.None,
        );
      }
    }
  });
});

describe("a page drawn with it", () => {
  const OpenProjectState: () => React.ReactElement = (): React.ReactElement => {
    const state: ProjectPaymentMethodsState = useProjectPaymentMethods();
    const count: number | undefined = useProjectPaymentMethodCount();

    return (
      <p data-testid="payment-methods">
        {state} {count === undefined ? "uncounted" : count}
      </p>
    );
  };

  const NamedProjectCount: (props: {
    projectId: string | null;
  }) => React.ReactElement = (props: {
    projectId: string | null;
  }): React.ReactElement => {
    const count: number | undefined = useProjectPaymentMethodCount(
      props.projectId,
    );

    return (
      <p data-testid="named-count">
        {count === undefined ? "uncounted" : count}
      </p>
    );
  };

  test("reads the open project's, and is drawn again when a count arrives", async () => {
    render(<OpenProjectState />);

    expect(screen.getByTestId("payment-methods")).toHaveTextContent(
      "Unknown uncounted",
    );

    await act(async () => {
      ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 0 });
    });

    expect(screen.getByTestId("payment-methods")).toHaveTextContent("None 0");

    // A card added on the Billing page: the page follows, with no reload.
    await act(async () => {
      ProjectPaymentMethods.setCount({ projectId: PROJECT_ID, count: 1 });
    });

    expect(screen.getByTestId("payment-methods")).toHaveTextContent("Some 1");
  });

  test("another project's count does not change what it draws", async () => {
    render(<OpenProjectState />);

    await act(async () => {
      ProjectPaymentMethods.setCount({ projectId: OTHER_PROJECT_ID, count: 0 });
    });

    expect(screen.getByTestId("payment-methods")).toHaveTextContent(
      "Unknown uncounted",
    );
  });

  test("a project it is handed is read, and no project reads nothing", async () => {
    ProjectPaymentMethods.setCount({ projectId: OTHER_PROJECT_ID, count: 3 });

    const { rerender } = render(
      <NamedProjectCount projectId={OTHER_PROJECT_ID} />,
    );

    expect(screen.getByTestId("named-count")).toHaveTextContent("3");

    rerender(<NamedProjectCount projectId={null} />);

    expect(screen.getByTestId("named-count")).toHaveTextContent("uncounted");
  });
});
