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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Route from "../../../Types/API/Route";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  describeNestedControls,
  findNestedControls,
} from "../../Helpers/NestedControls";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A runbook step's header used to be one role="button" (open/close) holding
 * the step's drag handle and its Delete button. A screen reader reads such a
 * header as one control, so the handle and Delete were lost inside it. Now
 * the three are side by side: a real open/close button, whose ::after still
 * covers the header so a press anywhere on it opens the step, with the handle
 * and Delete above it. Delete is named after its step.
 */

type UserEventController = ReturnType<typeof userEvent.setup>;

const RUNBOOK_ID: string = "77777777-0000-4000-8000-000000000001";

const STEPS: Array<RunbookStep> = [
  {
    id: "step-one",
    order: 0,
    type: RunbookStepType.Manual,
    title: "Check the dashboards",
    config: {},
  },
  {
    id: "step-two",
    order: 1,
    type: RunbookStepType.Manual,
    title: "Page the database owner",
    config: {},
  },
];

const renderSteps: () => Promise<RenderResult> =
  async (): Promise<RenderResult> => {
    let view: RenderResult | null = null;

    await act(async (): Promise<void> => {
      view = render(
        <MemoryRouter>
          <Steps
            pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    await screen.findAllByTestId("runbook-step-header");

    return view!;
  };

const headers: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("runbook-step-header");
};

// A step's open/close button: the header's button that says aria-expanded.
const toggleOf: (header: HTMLElement) => HTMLElement = (
  header: HTMLElement,
): HTMLElement => {
  const toggle: HTMLElement | undefined = within(header)
    .getAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });

  if (!toggle) {
    throw new Error("The step header has no open/close button.");
  }

  return toggle;
};

const handleOf: (header: HTMLElement) => HTMLElement = (
  header: HTMLElement,
): HTMLElement => {
  return within(header).getByLabelText("Drag to reorder step");
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = JSON.parse(JSON.stringify(STEPS)) as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  }) as never);

  // No AI providers: the page carries on without them.
  jest.spyOn(API, "post").mockImplementation((async () => {
    throw new Error("No AI providers here.");
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a runbook step's header", () => {
  test("holds its drag handle, open/close button and Delete side by side", async () => {
    const view: RenderResult = await renderSteps();

    expect(headers()).toHaveLength(2);

    for (const header of headers()) {
      const toggle: HTMLElement = toggleOf(header);
      const handle: HTMLElement = handleOf(header);

      expect(header).not.toHaveAttribute("role");
      expect(header).not.toHaveAttribute("tabindex");
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.contains(handle)).toBe(false);
      expect(handle.parentElement).toBe(header);
    }

    expect(describeNestedControls(findNestedControls(view.container))).toEqual(
      [],
    );
  });

  test("names its Delete button after the step, outside the open/close button", async () => {
    await renderSteps();

    const header: HTMLElement = headers()[0]!;
    const remove: HTMLElement = within(header).getByRole("button", {
      name: "Delete Check the dashboards",
    });

    expect(toggleOf(header).contains(remove)).toBe(false);
  });

  test("the open/close button is named by the step and opens it", async () => {
    const user: UserEventController = userEvent.setup();
    await renderSteps();

    const toggle: HTMLElement = toggleOf(headers()[0]!);

    expect(toggle).toHaveAccessibleName(/Check the dashboards/);
    // Existing steps open collapsed so the page is scannable.
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "true");

    await user.click(toggleOf(headers()[0]!));
    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "false");
  });

  test.each(["{Enter}", " "])(
    "%p on the open/close button opens the step",
    async (key: string) => {
      const user: UserEventController = userEvent.setup();
      await renderSteps();

      act(() => {
        toggleOf(headers()[1]!).focus();
      });
      await user.keyboard(key);

      expect(toggleOf(headers()[1]!)).toHaveAttribute("aria-expanded", "true");
      // Only that step.
      expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "false");
    },
  );

  test("a press on the drag handle does not open or close the step", async () => {
    await renderSteps();

    fireEvent.click(handleOf(headers()[0]!));

    expect(toggleOf(headers()[0]!)).toHaveAttribute("aria-expanded", "false");
  });

  test("Delete removes the step and leaves the others", async () => {
    const user: UserEventController = userEvent.setup();
    await renderSteps();

    await user.click(
      screen.getByRole("button", { name: "Delete Check the dashboards" }),
    );

    expect(headers()).toHaveLength(1);
    expect(toggleOf(headers()[0]!)).toHaveAccessibleName(
      /Page the database owner/,
    );
  });

  /*
   * A press anywhere on the header still opens the step: the open/close
   * button's ::after covers the header, and the handle and Delete are lifted
   * above it. (jsdom draws no ::after, so the classes are what can be read.)
   */
  test("its open/close button covers the header, below the handle and Delete", async () => {
    await renderSteps();

    const header: HTMLElement = headers()[0]!;

    expect(classesOf(header)).toEqual(
      expect.arrayContaining([
        "relative",
        "cursor-pointer",
        "hover:bg-gray-100",
      ]),
    );
    expect(classesOf(toggleOf(header))).toEqual(
      expect.arrayContaining([
        "after:absolute",
        "after:inset-0",
        "focus-visible:after:ring-2",
      ]),
    );
    expect(classesOf(handleOf(header))).toEqual(
      expect.arrayContaining(["relative", "z-10"]),
    );
    const remove: HTMLElement = within(header).getByRole("button", {
      name: "Delete Check the dashboards",
    });
    expect(classesOf(remove.parentElement!)).toEqual(
      expect.arrayContaining(["relative", "z-10"]),
    );
  });
});
