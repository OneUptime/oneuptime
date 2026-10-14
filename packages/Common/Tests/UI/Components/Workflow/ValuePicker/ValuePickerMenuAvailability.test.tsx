/*
 * "Pls make the available and non-available variables a little more visually
 * distinct": how the value list draws what can be used where this step runs
 * and what cannot.
 *
 *   - A step before this one on some runs only lists its values as usual,
 *     under an amber line that says which branch decides.
 *   - The steps whose values are not there at all are folded after
 *     everything else, counted; opened, each says why. Their values are
 *     never picked, not even by a search, which shows them greyed.
 *   - A record's fields its step does not pass on are listed after the ones
 *     it does, under whose they are and how to pass them on - still picked,
 *     as the setting may be fixed on purpose.
 *   - A note that waits for a run while the workflow is off offers a test
 *     run with Run Workflow, when the builder can start one.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import ValuePickerMenu, {
  EMPTY_HERE_HEADING_ROOM,
  UNAVAILABLE_SETTLE_MS,
  ValuePickerMenuCopy,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import {
  ValueAvailabilityState,
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import {
  StepValueCopy,
  createStepValueSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { StepSampleCopy } from "../../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  StepGraphEdge,
  StepGraphNode,
  StepValueSources,
  getStepValueSources,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import {
  DEPLOY_ENV,
  SAMPLE_GROUPS,
  WithPickerOptions,
  staticSource,
  withPicker,
} from "./ValuePickerTestUtils";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import IconProp from "../../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import {
  AA_TEXT_CONTRAST,
  PAGE_TEXT_CLASS,
  WrittenWords,
  contrastOf,
  unreadableWords,
  wordsIn,
} from "../../../../Helpers/TailwindContrast";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const POST_BODY: string =
  "{{local.components.api-post-1.returnValues.response-body}}";
const POST_STATUS: string =
  "{{local.components.api-post-1.returnValues.response-status}}";
const AFTER_BODY: string =
  "{{local.components.api-get-after.returnValues.response-body}}";
const LOOSE_BODY: string =
  "{{local.components.api-get-loose.returnValues.response-body}}";

// HTTP POST, before this step only when If / Else takes Yes.
const SOMETIMES_GROUP: ValueSuggestionGroup = {
  id: "step:api-post-1",
  kind: ValueSuggestionGroupKind.Step,
  title: "HTTP POST",
  subtitle: "api-post-1",
  iconProp: IconProp.Globe,
  order: 1,
  items: [
    { reference: POST_BODY, label: "Response Body", typeLabel: "JSON" },
    { reference: POST_STATUS, label: "Response Status", typeLabel: "Number" },
  ],
  availability: {
    state: ValueAvailabilityState.Sometimes,
    reason: {
      template: StepValueCopy.sometimesWhen,
      values: { step: "If / Else", output: "Yes" },
    },
  },
};

type UnavailableGroupFunction = (data: {
  id: string;
  title: string;
  reference: string;
  reason: string;
  order: number;
}) => ValueSuggestionGroup;

const unavailableGroup: UnavailableGroupFunction = (data: {
  id: string;
  title: string;
  reference: string;
  reason: string;
  order: number;
}): ValueSuggestionGroup => {
  return {
    id: `step:${data.id}`,
    kind: ValueSuggestionGroupKind.Step,
    title: data.title,
    subtitle: data.id,
    iconProp: IconProp.Globe,
    order: data.order,
    items: [
      {
        reference: data.reference,
        label: "Response Body",
        typeLabel: "JSON",
        isUnavailable: true,
      },
    ],
    availability: {
      state: ValueAvailabilityState.Unavailable,
      reason: { template: data.reason },
    },
  };
};

const AFTER_GROUP: ValueSuggestionGroup = unavailableGroup({
  id: "api-get-after",
  title: "HTTP GET",
  reference: AFTER_BODY,
  reason: StepValueCopy.runsAfter,
  order: 2000,
});

const LOOSE_GROUP: ValueSuggestionGroup = unavailableGroup({
  id: "api-get-loose",
  title: "HTTP GET",
  reference: LOOSE_BODY,
  reason: StepValueCopy.neverRuns,
  order: 2001,
});

const INCIDENT: string = "{{local.components.on-update-1.returnValues.model}}";
const INCIDENT_ID: string =
  "{{local.components.on-update-1.returnValues.model._id}}";
const INCIDENT_TITLE: string =
  "{{local.components.on-update-1.returnValues.model.title}}";
const INCIDENT_DESCRIPTION: string =
  "{{local.components.on-update-1.returnValues.model.description}}";
const INCIDENT_SEVERITY: string =
  "{{local.components.on-update-1.returnValues.model.incidentSeverity}}";

// The fields as StepValueSource lists them: passed on first, then the rest.
const INCIDENT_FIELDS: Array<ValueSuggestion> = [
  { reference: INCIDENT_ID, label: "ID", typeLabel: "ID" },
  {
    reference: INCIDENT_TITLE,
    label: "Title",
    description: "The incident's title",
    typeLabel: "Text",
  },
  {
    reference: INCIDENT_DESCRIPTION,
    label: "Description",
    description: "What happened",
    typeLabel: "Long text",
    isEmptyHere: true,
  },
  {
    reference: INCIDENT_SEVERITY,
    label: "Incident Severity",
    typeLabel: "Record",
    isEmptyHere: true,
  },
];

type RecordGroupFunction = (
  fields: Array<ValueSuggestion>,
) => ValueSuggestionGroup;

const recordGroup: RecordGroupFunction = (
  fields: Array<ValueSuggestion>,
): ValueSuggestionGroup => {
  return {
    id: "step:on-update-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "On Update Incident",
    subtitle: "on-update-1",
    iconProp: IconProp.Bolt,
    order: 0,
    items: [
      {
        reference: INCIDENT,
        label: "Incident",
        typeLabel: "Record",
        drillIn: {
          wholeValueLabel: "The whole Incident",
          allowsPath: true,
          loadChildren: async (): Promise<Array<ValueSuggestion>> => {
            return fields;
          },
          emptyHereNote: {
            template: StepValueCopy.notPassedOn,
            values: {
              step: "On Update Incident",
              setting: "Fields to pass on",
            },
          },
        },
      },
    ],
  };
};

interface RenderedMenu {
  onPick: MockFunction;
  user: UserEvent;
}

type RenderMenuFunction = (
  groups: Array<ValueSuggestionGroup>,
  options?: WithPickerOptions,
) => RenderedMenu;

const renderMenu: RenderMenuFunction = (
  groups: Array<ValueSuggestionGroup>,
  options: WithPickerOptions = {},
): RenderedMenu => {
  const onPick: MockFunction = getJestMockFunction();

  render(
    withPicker(<ValuePickerMenu hasSearchBox={true} onPick={onPick} />, {
      groups: groups,
      ...options,
    }),
  );

  return { onPick: onPick, user: userEvent.setup({ delay: null }) };
};

type ReferencesFunction = () => Array<string>;

// What can be picked: the options, in the order the keys walk them.
const optionReferences: ReferencesFunction = (): Array<string> => {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.getAttribute("data-reference") || "";
  });
};

type ElementsFunction = () => Array<HTMLElement>;

const unavailableSteps: ElementsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("value-picker-unavailable-step");
};

const unavailableValues: ElementsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("value-picker-unavailable-value");
};

type ActiveReferenceFunction = () => string | undefined;

const activeReference: ActiveReferenceFunction = (): string | undefined => {
  return screen
    .queryAllByRole("option")
    .find((option: HTMLElement): boolean => {
      return option.getAttribute("aria-selected") === "true";
    })
    ?.getAttribute("data-reference") as string | undefined;
};

afterEach(() => {
  cleanup();
});

describe("a step before this one on some runs only", () => {
  test("its values are listed as usual, under why they can be empty here", () => {
    const { onPick } = renderMenu([SAMPLE_GROUPS[0]!, SOMETIMES_GROUP]);

    const line: HTMLElement = screen.getByTestId("value-picker-sometimes");

    expect(line).toHaveTextContent(
      "Runs only when If / Else takes Yes, so its values can be empty here.",
    );
    // It sits in its step's group, above that step's values.
    const group: HTMLElement = line.closest("[role='group']") as HTMLElement;
    expect(within(group).getByText("HTTP POST")).toBeInTheDocument();
    expect(
      within(group)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return option.getAttribute("data-reference");
        }),
    ).toEqual([POST_BODY, POST_STATUS]);

    // Nothing stops picking them: a value empty on some runs is still a value.
    fireEvent.click(within(group).getAllByRole("option")[1]!);
    expect(onPick).toHaveBeenCalledWith(POST_STATUS);
  });

  test("a step whose branch is not known still says its values can be empty", () => {
    renderMenu([
      {
        ...SOMETIMES_GROUP,
        availability: {
          state: ValueAvailabilityState.Sometimes,
          reason: { template: StepValueCopy.sometimes },
        },
      },
    ]);

    expect(screen.getByTestId("value-picker-sometimes")).toHaveTextContent(
      "Doesn't run on every path to this step, so its values can be empty here.",
    );
  });

  test("a step before this one on every run has no such line", () => {
    renderMenu(SAMPLE_GROUPS);

    expect(screen.queryByTestId("value-picker-sometimes")).toBeNull();
  });

  test("a search that finds its values keeps the line", async () => {
    const { user } = renderMenu([SAMPLE_GROUPS[0]!, SOMETIMES_GROUP]);

    await user.type(screen.getByTestId("value-picker-search"), "status");

    expect(optionReferences()).toEqual([POST_STATUS]);
    expect(screen.getByTestId("value-picker-sometimes")).toBeInTheDocument();
  });

  /*
   * The amber line is read by eye before the values under it. Walking the
   * list by ear, each of those values is described by the same line, so it
   * is heard with the value the keys are on.
   */
  test("each of its values is described by the line, and the values of a step that always ran by nothing", async () => {
    const { user } = renderMenu([SAMPLE_GROUPS[0]!, SOMETIMES_GROUP]);
    const line: string =
      "Runs only when If / Else takes Yes, so its values can be empty here.";

    type OptionFunction = (reference: string) => HTMLElement;

    const option: OptionFunction = (reference: string): HTMLElement => {
      return screen.getAllByRole("option").find((row: HTMLElement) => {
        return row.getAttribute("data-reference") === reference;
      })!;
    };

    expect(option(POST_BODY)).toHaveAccessibleDescription(line);
    expect(option(POST_STATUS)).toHaveAccessibleDescription(line);
    // And its group, for a reader that says a group's description on the way in.
    expect(
      screen.getByTestId("value-picker-sometimes").closest("[role='group']"),
    ).toHaveAccessibleDescription(line);

    // The Webhook ran on every run: its values have nothing to add.
    for (const row of within(
      screen.getByText("Webhook").closest("[role='group']") as HTMLElement,
    ).getAllByRole("option")) {
      expect(row).not.toHaveAttribute("aria-describedby");
    }

    expect(
      screen.getByText("Webhook").closest("[role='group']"),
    ).not.toHaveAttribute("aria-describedby");

    // A search keeps the line, and the value it finds still points at it.
    await user.type(screen.getByTestId("value-picker-search"), "status");

    expect(option(POST_STATUS)).toHaveAccessibleDescription(line);
  });

  test("two steps on some runs only are each described by their own line", () => {
    renderMenu([
      SOMETIMES_GROUP,
      {
        ...SOMETIMES_GROUP,
        id: "step:api-post-2",
        subtitle: "api-post-2",
        order: 2,
        items: [
          {
            reference:
              "{{local.components.api-post-2.returnValues.response-body}}",
            label: "Response Body",
            typeLabel: "JSON",
          },
        ],
        availability: {
          state: ValueAvailabilityState.Sometimes,
          reason: {
            template: StepValueCopy.sometimesWhen,
            values: { step: "Switch / Case", output: "production" },
          },
        },
      },
    ]);

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "value-picker-sometimes",
    );

    expect(lines).toHaveLength(2);
    // Each line has an id of its own, or the second would be read as the first.
    expect(lines[0]!.id).not.toBe("");
    expect(lines[1]!.id).not.toBe("");
    expect(lines[0]!.id).not.toBe(lines[1]!.id);

    const options: Array<HTMLElement> = screen.getAllByRole("option");

    expect(options[0]).toHaveAccessibleDescription(
      "Runs only when If / Else takes Yes, so its values can be empty here.",
    );
    expect(options[options.length - 1]).toHaveAccessibleDescription(
      "Runs only when Switch / Case takes production, so its values can be empty here.",
    );
  });
});

describe("steps whose values are not there", () => {
  test("are folded after everything else, counted", () => {
    renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

    const block: HTMLElement = screen.getByTestId("value-picker-unavailable");
    const toggle: HTMLElement = screen.getByTestId(
      "value-picker-unavailable-toggle",
    );

    expect(toggle).toHaveTextContent("2 steps aren't available here");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(unavailableSteps()).toHaveLength(0);

    // After the last group of values that can be used.
    const groups: Array<HTMLElement> = screen.getAllByRole("group");
    expect(
      groups[groups.length - 1]!.compareDocumentPosition(block) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // None of their values is an option.
    expect(optionReferences()).not.toContain(AFTER_BODY);
    expect(optionReferences()).not.toContain(LOOSE_BODY);
  });

  test("one is counted in the singular", () => {
    renderMenu([...SAMPLE_GROUPS, AFTER_GROUP]);

    expect(
      screen.getByTestId("value-picker-unavailable-toggle"),
    ).toHaveTextContent("1 step isn't available here");
  });

  test("opened, each step says why, and offers none of its values", () => {
    renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

    expect(
      screen.getByTestId("value-picker-unavailable-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(ValuePickerMenuCopy.notAvailableHint),
    ).toBeInTheDocument();

    const steps: Array<HTMLElement> = unavailableSteps();

    expect(
      steps.map((step: HTMLElement) => {
        return step.getAttribute("data-step");
      }),
    ).toEqual(["api-get-after", "api-get-loose"]);
    // Two steps share a title, and the id tells them apart.
    expect(steps[0]).toHaveTextContent("HTTP GET");
    expect(steps[0]).toHaveTextContent("api-get-after");
    expect(steps[0]).toHaveTextContent("Runs after this step.");
    expect(steps[1]).toHaveTextContent(
      "Not connected to the trigger, so it never runs.",
    );

    // Browsing names the steps, not their values: there is nothing to pick.
    expect(unavailableValues()).toHaveLength(0);
    expect(optionReferences()).not.toContain(AFTER_BODY);

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));
    expect(unavailableSteps()).toHaveLength(0);
  });

  /*
   * They are at the end of a list that scrolls, so opened they were under
   * its fold: the line said a step was not available and showed nothing.
   */
  test("opened, they are brought into view; closed, or never opened, nothing is scrolled to", () => {
    type ScrollIntoViewFunction = typeof Element.prototype.scrollIntoView;

    const original: ScrollIntoViewFunction | undefined =
      Element.prototype.scrollIntoView;
    const scrolled: Array<{ testId: string | null; options: unknown }> = [];

    Element.prototype.scrollIntoView = function (
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ): void {
      scrolled.push({
        testId: this.getAttribute("data-testid"),
        options: options,
      });
    };

    type BlockScrollsFunction = () => number;

    const blockScrolls: BlockScrollsFunction = (): number => {
      return scrolled.filter(
        (call: { testId: string | null; options: unknown }): boolean => {
          return call.testId === "value-picker-unavailable";
        },
      ).length;
    };

    try {
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      // Folded, as it opens: the list stays at its top.
      expect(blockScrolls()).toBe(0);

      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

      expect(blockScrolls()).toBe(1);
      expect(
        scrolled.find(
          (call: { testId: string | null; options: unknown }): boolean => {
            return call.testId === "value-picker-unavailable";
          },
        )?.options,
      ).toEqual({ block: "nearest" });

      // Folding it again moves nothing.
      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

      expect(blockScrolls()).toBe(1);
    } finally {
      if (original) {
        Element.prototype.scrollIntoView = original;
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown })
          .scrollIntoView;
      }
    }
  });

  /*
   * The Dashboard builds a class's style the first time the class is drawn.
   * A moment after the block opens its reasons get their indent, the longer
   * ones wrap onto another line, and the last step would end under the
   * list's edge: the block is kept in view while it settles.
   */
  describe("opened, while their lines settle", () => {
    type ScrollIntoViewFunction = typeof Element.prototype.scrollIntoView;

    interface WatchedSize {
      notify: () => void;
      watched: Array<string | null>;
      isDisconnected: boolean;
    }

    let original: ScrollIntoViewFunction | undefined = undefined;
    let blockScrolls: number = 0;
    let observers: Array<WatchedSize> = [];

    type InstallResizeObserverFunction = () => void;

    const installResizeObserver: InstallResizeObserverFunction = (): void => {
      class FakeResizeObserver {
        private readonly entry: WatchedSize;

        public constructor(callback: () => void) {
          this.entry = {
            notify: callback,
            watched: [],
            isDisconnected: false,
          };
          observers.push(this.entry);
        }

        public observe(element: Element): void {
          this.entry.watched.push(element.getAttribute("data-testid"));
        }

        public disconnect(): void {
          this.entry.isDisconnected = true;
        }
      }

      (window as unknown as Record<string, unknown>)["ResizeObserver"] =
        FakeResizeObserver;
    };

    beforeEach(() => {
      jest.useFakeTimers();
      original = Element.prototype.scrollIntoView;
      blockScrolls = 0;
      observers = [];

      Element.prototype.scrollIntoView = function (this: Element): void {
        if (this.getAttribute("data-testid") === "value-picker-unavailable") {
          blockScrolls++;
        }
      };
    });

    afterEach(() => {
      jest.useRealTimers();
      delete (window as unknown as Record<string, unknown>)["ResizeObserver"];

      if (original) {
        Element.prototype.scrollIntoView = original;
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown })
          .scrollIntoView;
      }
    });

    test("the block is watched once it is open, and brought into view again each time it grows", () => {
      installResizeObserver();
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      // Folded: nothing to watch.
      expect(observers).toHaveLength(0);

      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

      expect(blockScrolls).toBe(1);
      expect(observers).toHaveLength(1);
      expect(observers[0]!.watched).toEqual(["value-picker-unavailable"]);
      expect(observers[0]!.isDisconnected).toBe(false);

      // A reason wraps onto another line.
      act(() => {
        observers[0]!.notify();
      });

      expect(blockScrolls).toBe(2);

      // And once more, as the next style arrives.
      act(() => {
        observers[0]!.notify();
      });

      expect(blockScrolls).toBe(3);
    });

    test("once they have settled the list is the reader's to scroll: the block is watched no longer", () => {
      installResizeObserver();
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

      act(() => {
        jest.advanceTimersByTime(UNAVAILABLE_SETTLE_MS - 1);
      });

      expect(observers[0]!.isDisconnected).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1);
      });

      expect(observers[0]!.isDisconnected).toBe(true);
      // Still open, and scrolled to only the once.
      expect(unavailableSteps()).toHaveLength(2);
      expect(blockScrolls).toBe(1);
    });

    test("folded again before they settle, the block is let go at once, and opening it again starts over", () => {
      installResizeObserver();
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      const toggle: HTMLElement = screen.getByTestId(
        "value-picker-unavailable-toggle",
      );

      fireEvent.click(toggle);
      fireEvent.click(toggle);

      expect(observers).toHaveLength(1);
      expect(observers[0]!.isDisconnected).toBe(true);
      expect(blockScrolls).toBe(1);

      // The timer went with it: nothing is left to fire.
      expect(jest.getTimerCount()).toBe(0);

      fireEvent.click(toggle);

      expect(observers).toHaveLength(2);
      expect(observers[1]!.isDisconnected).toBe(false);
      expect(blockScrolls).toBe(2);
    });

    test("closing the list lets the block go too", () => {
      installResizeObserver();
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));
      cleanup();

      expect(observers[0]!.isDisconnected).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("a search opens them without the fold, and watches nothing", () => {
      installResizeObserver();
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      fireEvent.change(screen.getByTestId("value-picker-search"), {
        target: { value: "response" },
      });

      expect(unavailableValues()).toHaveLength(2);
      expect(observers).toHaveLength(0);
      expect(blockScrolls).toBe(0);
    });

    test("in a browser that cannot watch a size they are still brought into view, the once", () => {
      renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

      fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

      expect(blockScrolls).toBe(1);
      expect(observers).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  /*
   * The words that explain - the line under the fold, each step's reason,
   * its ID - are there to be read: gray-500, which is 4.8:1 on the list's
   * white. gray-400 (2.5:1) is left to what cannot be picked.
   */
  test("opened, the words that explain are written to be read, not as faint as what cannot be picked", async () => {
    const { user } = renderMenu([...SAMPLE_GROUPS, AFTER_GROUP, LOOSE_GROUP]);

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

    const step: HTMLElement = unavailableSteps()[0]!;

    for (const words of [
      screen.getByTestId("value-picker-unavailable-hint"),
      within(step).getByTestId("value-picker-unavailable-reason"),
      within(step).getByText("api-get-after"),
      within(step).getByText("HTTP GET"),
    ]) {
      expect(words).toHaveClass("text-gray-500");
      expect(words).not.toHaveClass("text-gray-400");
    }

    // Two HTTP GETs: the ID is what tells them apart.
    expect(within(step).getByText("api-get-after")).toHaveAttribute(
      "data-part",
      "step-id",
    );

    await user.type(screen.getByTestId("value-picker-search"), "response");

    expect(
      within(screen.getByTestId("value-picker-unavailable")).getByText(
        ValuePickerMenuCopy.notAvailableTitle,
      ),
    ).toHaveClass("text-gray-500");
    // The values that cannot be picked are the fainter ones.
    expect(
      within(unavailableValues()[0]!).getByText("Response Body"),
    ).toHaveClass("text-gray-400");
  });

  test("the toggle leaves the focus in the search box", async () => {
    const { user } = renderMenu([...SAMPLE_GROUPS, AFTER_GROUP]);

    const search: HTMLElement = screen.getByTestId("value-picker-search");
    expect(search).toHaveFocus();

    await user.click(screen.getByTestId("value-picker-unavailable-toggle"));

    expect(unavailableSteps()).toHaveLength(1);
    expect(search).toHaveFocus();
  });

  test("the keys walk only what can be used", async () => {
    const { user, onPick } = renderMenu([
      SAMPLE_GROUPS[2]!,
      AFTER_GROUP,
      LOOSE_GROUP,
    ]);

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

    expect(optionReferences()).toEqual(["{{global.variables.API_KEY}}"]);
    await user.keyboard("{ArrowDown}");
    expect(activeReference()).toBe("{{global.variables.API_KEY}}");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("{{global.variables.API_KEY}}");
  });

  test("a search shows their matching values greyed, which cannot be picked", async () => {
    const { user, onPick } = renderMenu([
      ...SAMPLE_GROUPS,
      AFTER_GROUP,
      LOOSE_GROUP,
    ]);

    await user.type(screen.getByTestId("value-picker-search"), "response");

    // No toggle: the search opened them, under a title of their own.
    expect(screen.queryByTestId("value-picker-unavailable-toggle")).toBeNull();
    expect(
      within(screen.getByTestId("value-picker-unavailable")).getByText(
        ValuePickerMenuCopy.notAvailableTitle,
      ),
    ).toBeInTheDocument();

    const values: Array<HTMLElement> = unavailableValues();

    expect(
      values.map((value: HTMLElement) => {
        return value.getAttribute("data-reference");
      }),
    ).toEqual([AFTER_BODY, LOOSE_BODY]);
    for (const value of values) {
      expect(value).toHaveAttribute("aria-disabled", "true");
      expect(value).not.toHaveAttribute("role", "option");
      expect(value).toHaveClass("cursor-not-allowed");
      expect(within(value).getByText("Response Body")).toHaveClass(
        "text-gray-400",
      );
    }

    // Each still says why.
    expect(unavailableSteps()[0]).toHaveTextContent("Runs after this step.");

    // Not an option, so a click and the keys pass them by.
    fireEvent.click(values[0]!);
    await user.keyboard("{Enter}");
    expect(onPick).not.toHaveBeenCalled();
    expect(optionReferences()).toEqual([]);
  });

  test("a search that finds only them does not say nothing matches", async () => {
    const { user } = renderMenu([...SAMPLE_GROUPS, AFTER_GROUP]);

    await user.type(screen.getByTestId("value-picker-search"), "response");

    expect(screen.queryByTestId("value-picker-no-match")).toBeNull();
    expect(unavailableValues()).toHaveLength(1);
  });

  test("a search that finds nothing anywhere says so, and lists none of them", async () => {
    const { user } = renderMenu([...SAMPLE_GROUPS, AFTER_GROUP]);

    await user.type(screen.getByTestId("value-picker-search"), "zzz");

    expect(screen.getByTestId("value-picker-no-match")).toHaveTextContent(
      "No values match “zzz”.",
    );
    expect(screen.queryByTestId("value-picker-unavailable")).toBeNull();
  });

  test("a search lists only the steps it finds values of", async () => {
    const { user } = renderMenu([
      ...SAMPLE_GROUPS,
      AFTER_GROUP,
      {
        ...LOOSE_GROUP,
        items: [
          {
            reference: "{{local.components.api-get-loose.returnValues.x}}",
            label: "Headers",
            isUnavailable: true,
          },
        ],
      },
    ]);

    await user.type(screen.getByTestId("value-picker-search"), "body");

    expect(
      unavailableSteps().map((step: HTMLElement) => {
        return step.getAttribute("data-step");
      }),
    ).toEqual(["api-get-after"]);
  });

  test("with nothing that can be used, it says so, and still explains the rest", () => {
    renderMenu([AFTER_GROUP]);

    expect(screen.getByTestId("value-picker-empty")).toBeInTheDocument();
    expect(
      screen.getByTestId("value-picker-unavailable-toggle"),
    ).toHaveTextContent("1 step isn't available here");
  });

  test("inside a record, only the record's fields are listed", async () => {
    renderMenu([recordGroup(INCIDENT_FIELDS), AFTER_GROUP]);

    expect(screen.getByTestId("value-picker-unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(optionReferences()).toContain(INCIDENT_TITLE);
    });
    expect(screen.queryByTestId("value-picker-unavailable")).toBeNull();
  });
});

/*
 * A row's description, its kind and what it last held are gray-500, which
 * reads at 4.8:1 on the list's white - and at 4.3:1 on the tint of the row
 * the pointer or the keys are on. There they are a shade darker.
 */
describe("what a row says besides its name", () => {
  type RowFunction = (reference: string) => HTMLElement;

  const row: RowFunction = (reference: string): HTMLElement => {
    return screen.getAllByRole("option").find((option: HTMLElement) => {
      return option.getAttribute("data-reference") === reference;
    })!;
  };

  const WEBHOOK_BODY: string =
    "{{local.components.webhook-1.returnValues.request-body}}";
  const WEBHOOK_HEADERS: string =
    "{{local.components.webhook-1.returnValues.request-headers}}";

  test("is gray-500, and a shade darker on the row the keys are on", async () => {
    const { user } = renderMenu(SAMPLE_GROUPS);

    // The list opens with the keys on its first row.
    expect(row(WEBHOOK_BODY)).toHaveAttribute("aria-selected", "true");
    expect(
      within(row(WEBHOOK_BODY)).getByText("What the request sent."),
    ).toHaveClass("text-gray-600");
    expect(within(row(WEBHOOK_BODY)).getByText("JSON")).toHaveClass(
      "text-gray-600",
    );
    expect(within(row(WEBHOOK_HEADERS)).getByText("Key / value")).toHaveClass(
      "text-gray-500",
    );

    await user.keyboard("{ArrowDown}");

    expect(
      within(row(WEBHOOK_BODY)).getByText("What the request sent."),
    ).toHaveClass("text-gray-500");
    expect(within(row(WEBHOOK_BODY)).getByText("JSON")).toHaveClass(
      "text-gray-500",
    );
    expect(within(row(WEBHOOK_HEADERS)).getByText("Key / value")).toHaveClass(
      "text-gray-600",
    );
    // The name is as dark as ever on either.
    expect(within(row(WEBHOOK_BODY)).getByText("Request Body")).toHaveClass(
      "text-gray-900",
    );
    expect(
      within(row(WEBHOOK_HEADERS)).getByText("Request Headers"),
    ).toHaveClass("text-gray-900");
  });

  test("what a value last held is drawn the same way", async () => {
    const { user } = renderMenu([
      {
        ...SAMPLE_GROUPS[0]!,
        items: [
          { ...SAMPLE_GROUPS[0]!.items[0]!, sample: "3 fields" },
          { ...SAMPLE_GROUPS[0]!.items[1]!, sample: "12 headers" },
        ],
      },
    ]);

    expect(screen.getByText("3 fields")).toHaveClass("text-gray-600");
    expect(screen.getByText("12 headers")).toHaveClass("text-gray-500");

    await user.keyboard("{ArrowDown}");

    expect(screen.getByText("3 fields")).toHaveClass("text-gray-500");
    expect(screen.getByText("12 headers")).toHaveClass("text-gray-600");
  });

  /*
   * "hidden", beside a lock, stands where a secret's value would be. It is
   * a word to read like any sample - it was gray-400, 2.5:1.
   */
  test("a value that is kept hidden says so in words that can be read, on either kind of row", async () => {
    const { user } = renderMenu([
      {
        ...SAMPLE_GROUPS[0]!,
        items: [
          { ...SAMPLE_GROUPS[0]!.items[0]!, isSampleHidden: true },
          { ...SAMPLE_GROUPS[0]!.items[1]!, sample: "12 headers" },
        ],
      },
    ]);

    type HiddenFunction = () => HTMLElement;

    const hidden: HiddenFunction = (): HTMLElement => {
      return screen
        .getAllByTestId("value-picker-sample")
        .find((sample: HTMLElement): boolean => {
          return sample.getAttribute("data-hidden") === "true";
        })!;
    };

    // On the row under the keys.
    expect(hidden()).toHaveTextContent("hidden");
    expect(contrastOf(hidden())).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    expect(unreadableWords(document.body, PAGE_TEXT_CLASS)).toEqual([]);

    await user.keyboard("{ArrowDown}");

    // And on a row that is not.
    expect(contrastOf(hidden())).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    expect(unreadableWords(document.body, PAGE_TEXT_CLASS)).toEqual([]);
  });

  test("a step's ID beside its name is gray-500 too: it is all that tells two steps of one kind apart", () => {
    renderMenu(SAMPLE_GROUPS);

    const id: HTMLElement = screen.getByText("webhook-1");

    expect(id).toHaveAttribute("data-part", "group-subtitle");
    expect(id).toHaveClass("text-gray-500");
    expect(id).not.toHaveClass("text-gray-400");
    // The step's name stays the darker of the two.
    expect(screen.getByText("Webhook")).toHaveClass("text-gray-700");
  });
});

describe("a record's fields its step does not pass on", () => {
  type OpenRecordFunction = (
    fields?: Array<ValueSuggestion>,
  ) => Promise<RenderedMenu>;

  const openRecord: OpenRecordFunction = async (
    fields: Array<ValueSuggestion> = INCIDENT_FIELDS,
  ): Promise<RenderedMenu> => {
    const rendered: RenderedMenu = renderMenu([recordGroup(fields)]);

    fireEvent.click(screen.getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(optionReferences()).toContain(
        fields[fields.length - 1]!.reference,
      );
    });

    return rendered;
  };

  test("come after the ones it does, under whose they are and how to pass them on", async () => {
    await openRecord();

    expect(optionReferences()).toEqual([
      INCIDENT,
      INCIDENT_ID,
      INCIDENT_TITLE,
      INCIDENT_DESCRIPTION,
      INCIDENT_SEVERITY,
    ]);

    const note: HTMLElement = screen.getByTestId(
      "value-picker-empty-here-note",
    );

    expect(note).toHaveTextContent(
      "On Update Incident doesn't pass these on, so they are empty here. Add them to its Fields to pass on to use them.",
    );

    // The note sits between the two: after Title, before Description.
    const title: HTMLElement = screen
      .getAllByRole("option")
      .find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === INCIDENT_TITLE;
      })!;
    const description: HTMLElement = screen
      .getAllByRole("option")
      .find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === INCIDENT_DESCRIPTION;
      })!;

    expect(
      title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      note.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("are drawn greyed, and say no more than their section does", async () => {
    await openRecord();

    const options: Array<HTMLElement> = screen.getAllByRole("option");
    const emptyHere: Array<HTMLElement> = options.filter(
      (option: HTMLElement) => {
        return option.getAttribute("data-empty-here") === "true";
      },
    );

    expect(
      emptyHere.map((option: HTMLElement) => {
        return option.getAttribute("data-reference");
      }),
    ).toEqual([INCIDENT_DESCRIPTION, INCIDENT_SEVERITY]);
    expect(within(emptyHere[0]!).getByText("Description")).toHaveClass(
      "text-gray-500",
    );
    // Its own description is left to the section's note.
    expect(screen.queryByText("What happened")).toBeNull();

    // A field it passes on is drawn as usual, its description and all.
    const title: HTMLElement = options.find((option: HTMLElement) => {
      return option.getAttribute("data-reference") === INCIDENT_TITLE;
    })!;
    expect(title).not.toHaveAttribute("data-empty-here");
    expect(within(title).getByText("Title")).toHaveClass("text-gray-900");
    expect(within(title).getByText("The incident's title")).toBeInTheDocument();
  });

  test("a greyed field under the keys is a shade darker, and still greyer than one that can be used", async () => {
    const { user } = await openRecord();

    type NameFunction = (reference: string, label: string) => HTMLElement;

    const name: NameFunction = (
      reference: string,
      label: string,
    ): HTMLElement => {
      return within(
        screen.getAllByRole("option").find((option: HTMLElement) => {
          return option.getAttribute("data-reference") === reference;
        })!,
      ).getByText(label);
    };

    // The whole Incident, its ID, the title - then the description.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");

    expect(name(INCIDENT_DESCRIPTION, "Description")).toHaveClass(
      "text-gray-600",
    );
    expect(name(INCIDENT_DESCRIPTION, "Description")).not.toHaveClass(
      "text-gray-900",
    );
    // The one beside it, not under the keys, is as it was.
    expect(name(INCIDENT_SEVERITY, "Incident Severity")).toHaveClass(
      "text-gray-500",
    );
    expect(name(INCIDENT_TITLE, "Title")).toHaveClass("text-gray-900");
  });

  test("can still be picked, by a click or the keys", async () => {
    const { onPick, user } = await openRecord();

    fireEvent.click(
      screen.getAllByRole("option").find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === INCIDENT_SEVERITY;
      })!,
    );
    expect(onPick).toHaveBeenLastCalledWith(INCIDENT_SEVERITY);

    // The whole record, ID, Title, then Description.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeReference()).toBe(INCIDENT_DESCRIPTION);
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenLastCalledWith(INCIDENT_DESCRIPTION);
  });

  test("a search inside the record keeps them apart", async () => {
    const { user } = await openRecord();

    await user.type(screen.getByTestId("value-picker-search"), "i");

    // "i" is in ID, Title, Description and Incident Severity alike.
    expect(optionReferences()).toEqual([
      INCIDENT_ID,
      INCIDENT_TITLE,
      INCIDENT_DESCRIPTION,
      INCIDENT_SEVERITY,
    ]);
    expect(
      screen.getByTestId("value-picker-empty-here-note"),
    ).toBeInTheDocument();

    await user.clear(screen.getByTestId("value-picker-search"));
    await user.type(screen.getByTestId("value-picker-search"), "title");

    // Only fields it passes on: no note about the others.
    expect(optionReferences()).toEqual([INCIDENT_TITLE]);
    expect(screen.queryByTestId("value-picker-empty-here-note")).toBeNull();
  });

  /*
   * Greyed says "not passed on" to the eye. Each greyed field is described
   * by the line over them, so it is said with the field the keys are on.
   */
  test("each is described by the line over them, and a field that is passed on by nothing", async () => {
    const { user } = await openRecord();
    const note: string =
      "On Update Incident doesn't pass these on, so they are empty here. Add them to its Fields to pass on to use them.";

    type OptionFunction = (reference: string) => HTMLElement;

    const option: OptionFunction = (reference: string): HTMLElement => {
      return screen.getAllByRole("option").find((row: HTMLElement) => {
        return row.getAttribute("data-reference") === reference;
      })!;
    };

    expect(option(INCIDENT_DESCRIPTION)).toHaveAccessibleDescription(note);
    expect(option(INCIDENT_SEVERITY)).toHaveAccessibleDescription(note);
    // The section they are in is named by its heading, and described by the line.
    const section: HTMLElement = screen
      .getByTestId("value-picker-empty-here-note")
      .closest("[role='group']") as HTMLElement;

    expect(section).toHaveAccessibleDescription(note);
    expect(section).toHaveAccessibleName("Not passed on 2 fields");

    for (const reference of [INCIDENT, INCIDENT_ID, INCIDENT_TITLE]) {
      expect(option(reference)).not.toHaveAttribute("aria-describedby");
    }

    // A search that still finds one keeps what describes it.
    await user.type(screen.getByTestId("value-picker-search"), "severity");

    expect(optionReferences()).toEqual([INCIDENT_SEVERITY]);
    expect(option(INCIDENT_SEVERITY)).toHaveAccessibleDescription(note);
  });

  test("a record whose fields are all passed on has no such section", async () => {
    await openRecord(
      INCIDENT_FIELDS.slice(0, 2).map((field: ValueSuggestion) => {
        return field;
      }),
    );

    expect(screen.queryByTestId("value-picker-empty-here-note")).toBeNull();
    expect(screen.queryByTestId("value-picker-empty-here-heading")).toBeNull();
    expect(screen.queryByText("Not passed on")).toBeNull();
    expect(
      screen.getAllByRole("option").some((option: HTMLElement) => {
        return option.hasAttribute("data-empty-here");
      }),
    ).toBe(false);
    // And no room is kept at the foot of the list for a heading that is not there.
    expect(screen.getByRole("listbox").style.scrollPaddingBottom).toBe("");
  });

  /*
   * The line said "doesn't pass these on" with nothing to say which were
   * "these": it stood under the fields that are passed on, and - with four
   * of them filling the list - over nothing in sight. A heading names the
   * section and counts it.
   */
  describe("under a heading that names them and counts them", () => {
    type HeadingFunction = () => HTMLElement;

    const heading: HeadingFunction = (): HTMLElement => {
      return screen.getByTestId("value-picker-empty-here-heading");
    };

    const toggle: HeadingFunction = (): HTMLElement => {
      return screen.getByTestId("value-picker-empty-here-toggle");
    };

    test("it says what they are and how many, between the fields that are passed on and the line", async () => {
      await openRecord();

      expect(
        heading().querySelector('[data-part="group-title"]'),
      ).toHaveTextContent(/^Not passed on$/);
      expect(
        heading().querySelector('[data-part="group-count"]'),
      ).toHaveTextContent(/^2 fields$/);

      type ByReferenceFunction = (reference: string) => HTMLElement;

      const byReference: ByReferenceFunction = (
        reference: string,
      ): HTMLElement => {
        return screen.getAllByRole("option").find((option: HTMLElement) => {
          return option.getAttribute("data-reference") === reference;
        })!;
      };

      type IsBeforeFunction = (first: Node, second: Node) => boolean;

      const isBefore: IsBeforeFunction = (
        first: Node,
        second: Node,
      ): boolean => {
        return Boolean(
          first.compareDocumentPosition(second) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      };

      const note: HTMLElement = screen.getByTestId(
        "value-picker-empty-here-note",
      );

      // Title, then the heading, then the line, then Description.
      expect(isBefore(byReference(INCIDENT_TITLE), heading())).toBe(true);
      expect(isBefore(heading(), note)).toBe(true);
      expect(isBefore(note, byReference(INCIDENT_DESCRIPTION))).toBe(true);
    });

    test("one field is counted as one", async () => {
      await openRecord(INCIDENT_FIELDS.slice(0, 3));

      expect(
        heading().querySelector('[data-part="group-count"]'),
      ).toHaveTextContent(/^1 field$/);
    });

    test("a search counts what it found of them", async () => {
      const { user } = await openRecord();

      await user.type(screen.getByTestId("value-picker-search"), "severity");

      expect(optionReferences()).toEqual([INCIDENT_SEVERITY]);
      expect(
        heading().querySelector('[data-part="group-count"]'),
      ).toHaveTextContent(/^1 field$/);
    });

    /*
     * Pinned to the foot of the list for as long as the fields it is over
     * are below it: a step that passes on four fields fills the list with
     * them, and nothing said there were more, or that they would be empty.
     */
    test("it is pinned to the foot of the list, on a ground of its own", async () => {
      await openRecord();

      // Down over the list's own bottom padding, so no row shows under it.
      expect(heading()).toHaveClass("sticky", "-bottom-1", "z-10", "bg-white");
      expect(screen.getByRole("listbox")).toHaveClass("py-1");
    });

    test("it is the list's own child: a pinned element keeps inside its parent", async () => {
      await openRecord();

      const list: HTMLElement = screen.getByRole("listbox");

      expect(heading().parentElement).toBe(list);
      // The fields it is over are the next thing in the list, in their group.
      expect(heading().nextElementSibling).toHaveAttribute("role", "group");
      expect(heading().nextElementSibling).toContainElement(
        screen.getByTestId("value-picker-empty-here-note"),
      );
      // The line is not pinned with it: it is read once the fields are reached.
      expect(heading()).not.toContainElement(
        screen.getByTestId("value-picker-empty-here-note"),
      );
    });

    test("room is kept at the foot of the list, so the row the keys are on is not under it", async () => {
      await openRecord();

      expect(screen.getByRole("listbox").style.scrollPaddingBottom).toBe(
        EMPTY_HERE_HEADING_ROOM,
      );
    });

    test("the steps' own list keeps no such room", () => {
      renderMenu([recordGroup(INCIDENT_FIELDS), SOMETIMES_GROUP]);

      expect(screen.getByRole("listbox").style.scrollPaddingBottom).toBe("");
      expect(
        screen.queryByTestId("value-picker-empty-here-heading"),
      ).toBeNull();
    });

    test("it is not one of the values: the keys walk past it", async () => {
      const { user } = await openRecord();

      expect(toggle()).not.toHaveAttribute("role", "option");
      expect(optionReferences()).toEqual([
        INCIDENT,
        INCIDENT_ID,
        INCIDENT_TITLE,
        INCIDENT_DESCRIPTION,
        INCIDENT_SEVERITY,
      ]);

      // From Title straight on to Description, the first under the heading.
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(activeReference()).toBe(INCIDENT_TITLE);
      await user.keyboard("{ArrowDown}");
      expect(activeReference()).toBe(INCIDENT_DESCRIPTION);

      // Tab never lands on it either.
      expect(toggle()).toHaveAttribute("tabindex", "-1");
    });

    test("a press on it brings the fields up to the top of the list, and keeps the focus where it was", async () => {
      await openRecord();

      const list: HTMLElement = screen.getByRole("listbox");
      const group: HTMLElement = heading().nextElementSibling as HTMLElement;

      type RectFunction = () => DOMRect;

      // The list starts at 100; the fields' group is 400 further down.
      list.getBoundingClientRect = ((): DOMRect => {
        return { top: 100, bottom: 340, height: 240 } as DOMRect;
      }) as RectFunction;
      group.getBoundingClientRect = ((): DOMRect => {
        return { top: 500, bottom: 900, height: 400 } as DOMRect;
      }) as RectFunction;
      Object.defineProperty(heading(), "offsetHeight", {
        configurable: true,
        value: 32,
      });
      list.scrollTop = 10;

      const search: HTMLElement = screen.getByTestId("value-picker-search");

      expect(search).toHaveFocus();

      // The press itself must not take the focus from the search box.
      expect(fireEvent.mouseDown(toggle())).toBe(false);
      fireEvent.click(toggle());

      /*
       * Scrolled by how far the group is below the list's top, less the
       * heading, which leads the group once it is no longer pinned.
       */
      expect(list.scrollTop).toBe(10 + (500 - 100) - 32);
      expect(search).toHaveFocus();
    });

    test("a press picks nothing", async () => {
      const { onPick } = await openRecord();

      fireEvent.click(toggle());

      expect(onPick).not.toHaveBeenCalled();
      expect(screen.getByTestId("value-picker-back")).toBeInTheDocument();
    });

    /*
     * The line over the heading divides it from the fields above. A search
     * that finds only fields that are not passed on has none above: the
     * line stood under an empty band, dividing the heading from nothing.
     */
    test("with fields above it, a line divides it from them", async () => {
      await openRecord();

      expect(heading()).toHaveAttribute("data-divided", "true");
      expect(toggle()).toHaveClass("border-t", "border-gray-100");
    });

    test("with none above it, there is no line and no empty band over it", async () => {
      const { user } = await openRecord();

      await user.type(screen.getByTestId("value-picker-search"), "severity");

      expect(optionReferences()).toEqual([INCIDENT_SEVERITY]);
      expect(heading()).toHaveAttribute("data-divided", "false");
      expect(toggle()).not.toHaveClass("border-t");

      const list: HTMLElement = screen.getByRole("listbox");

      // The record's own section, with nothing in it, is not drawn at all.
      expect(list.firstElementChild).toBe(heading());
      expect(within(list).getAllByRole("group")).toHaveLength(1);
    });

    test("a search that finds only fields that are passed on draws them alone", async () => {
      const { user } = await openRecord();

      await user.type(screen.getByTestId("value-picker-search"), "title");

      expect(optionReferences()).toEqual([INCIDENT_TITLE]);
      expect(
        screen.queryByTestId("value-picker-empty-here-heading"),
      ).toBeNull();
      expect(
        within(screen.getByRole("listbox")).getAllByRole("group"),
      ).toHaveLength(1);
    });

    test("a deleted record's step is under the same heading", async () => {
      const group: ValueSuggestionGroup = recordGroup(INCIDENT_FIELDS);
      group.items[0]!.drillIn!.emptyHereNote = {
        template: StepValueCopy.onDeletePassesOnId,
        values: { step: "On Delete Incident" },
      };

      renderMenu([group]);
      fireEvent.click(screen.getAllByRole("option")[0]!);

      await waitFor(() => {
        expect(heading()).toHaveTextContent("Not passed on");
      });
      expect(heading()).toHaveTextContent("2 fields");
    });

    test("typed after {{ in the field, the list has the same heading", async () => {
      const onPick: MockFunction = getJestMockFunction();

      render(
        withPicker(
          <ValuePickerMenu hasSearchBox={false} query="" onPick={onPick} />,
          { groups: [recordGroup(INCIDENT_FIELDS)] },
        ),
      );

      fireEvent.click(screen.getAllByRole("option")[0]!);

      await waitFor(() => {
        expect(optionReferences()).toContain(INCIDENT_SEVERITY);
      });

      expect(heading()).toHaveTextContent("Not passed on");
      expect(heading()).toHaveClass("sticky");
    });
  });

  test("a deleted record's step says it passes on only the ID", async () => {
    const group: ValueSuggestionGroup = recordGroup(INCIDENT_FIELDS);
    group.items[0]!.drillIn!.emptyHereNote = {
      template: StepValueCopy.onDeletePassesOnId,
      values: { step: "On Delete Incident" },
    };

    renderMenu([group]);
    fireEvent.click(screen.getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(
        screen.getByTestId("value-picker-empty-here-note"),
      ).toHaveTextContent(
        "On Delete Incident passes on only the ID: the record is already gone.",
      );
    });
  });
});

describe("a note that waits for a run while the workflow is off", () => {
  const OFF_NOTE_GROUP: ValueSuggestionGroup = {
    ...SAMPLE_GROUPS[0]!,
    note: {
      text: StepSampleCopy.noRequestYetWhileOff,
      waitingText: StepSampleCopy.waitingForTestRun,
      offersTestRun: true,
    },
  };

  test("offers a test run with Run Workflow, when the builder can start one", async () => {
    const onTestRun: MockFunction = getJestMockFunction();
    const { user, onPick } = renderMenu([OFF_NOTE_GROUP], {
      onTestRun: onTestRun as unknown as () => void,
    });

    const note: HTMLElement = screen.getByTestId("value-picker-group-note");
    expect(note).toHaveTextContent(StepSampleCopy.noRequestYetWhileOff);
    expect(
      within(note).getByTestId("value-picker-note-waiting"),
    ).toHaveTextContent(StepSampleCopy.waitingForTestRun);

    const button: HTMLElement = within(note).getByTestId(
      "value-picker-note-test-run",
    );
    expect(button).toHaveTextContent(StepSampleCopy.testWithRunWorkflow);

    await user.click(button);

    expect(onTestRun).toHaveBeenCalledTimes(1);
    // Nothing is inserted, and the focus stays in the search box.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("value-picker-search")).toHaveFocus();
  });

  test("without a way to start one, the note stays, with no button", () => {
    renderMenu([OFF_NOTE_GROUP]);

    expect(screen.getByTestId("value-picker-group-note")).toBeInTheDocument();
    expect(screen.queryByTestId("value-picker-note-test-run")).toBeNull();
  });

  /*
   * While the workflow is on, a Webhook's URL takes a real request: the note
   * offers one to copy, and waits for it, but no test run.
   */
  test("a note that does not offer one has no button, though the builder could", () => {
    renderMenu(
      [
        {
          ...SAMPLE_GROUPS[0]!,
          note: {
            text: StepSampleCopy.noRequestYetWithTest,
            copyText: "curl -X POST https://oneuptime.example/webhook",
            copyLabel: StepSampleCopy.copyTestRequest,
            waitingText: StepSampleCopy.waitingForRequest,
          },
        },
      ],
      {
        onTestRun: (() => {}) as () => void,
      },
    );

    const note: HTMLElement = screen.getByTestId("value-picker-group-note");
    expect(within(note).getByTestId("value-picker-note-copy")).toBeVisible();
    expect(within(note).getByTestId("value-picker-note-waiting")).toBeVisible();
    expect(screen.queryByTestId("value-picker-note-test-run")).toBeNull();
  });
});

/*
 * The real thing, end to end: the canvas's steps and connections, through
 * StepGraph and StepValueSource, to what the menu draws.
 */
describe("from the workflow's steps to the list", () => {
  type NodeFunction = (metadataId: string, id: string) => StepGraphNode;

  const node: NodeFunction = (
    metadataId: string,
    id: string,
  ): StepGraphNode => {
    const metadata: ComponentMetadata = Components.find(
      (component: ComponentMetadata): boolean => {
        return component.id === metadataId;
      },
    ) as ComponentMetadata;

    return {
      id: `rf-${id}`,
      data: {
        id: id,
        error: "",
        nodeType: NodeType.Node,
        metadata: metadata,
        metadataId: metadataId,
        internalId: `internal-${id}`,
        arguments: {},
        returnValues: {},
        componentType: metadata.componentType,
      } as NodeDataProp,
    };
  };

  type EdgeFunction = (
    from: string,
    output: string,
    to: string,
  ) => StepGraphEdge;

  const edge: EdgeFunction = (
    from: string,
    output: string,
    to: string,
  ): StepGraphEdge => {
    return { source: `rf-${from}`, sourceHandle: output, target: `rf-${to}` };
  };

  /*
   * Webhook → If / Else; Yes → HTTP POST, No → Log; both into Slack; after
   * Slack, a GET; and a GET connected to nothing.
   */
  const NODES: Array<StepGraphNode> = [
    node(ComponentID.Webhook, "webhook-1"),
    node(ComponentID.IfElse, "if-else-1"),
    node(ComponentID.ApiPost, "api-post-1"),
    node(ComponentID.Log, "log-1"),
    node(ComponentID.SlackSendMessageToChannel, "slack-1"),
    node(ComponentID.ApiGet, "api-get-after"),
    node(ComponentID.ApiGet, "api-get-loose"),
  ];

  const EDGES: Array<StepGraphEdge> = [
    edge("webhook-1", "out", "if-else-1"),
    edge("if-else-1", "yes", "api-post-1"),
    edge("if-else-1", "no", "log-1"),
    edge("api-post-1", "success", "slack-1"),
    edge("log-1", "out", "slack-1"),
    edge("slack-1", "success", "api-get-after"),
  ];

  type RenderStepFunction = (stepId: string) => RenderedMenu;

  const renderStep: RenderStepFunction = (stepId: string): RenderedMenu => {
    const valueSources: StepValueSources = getStepValueSources({
      nodes: NODES,
      edges: EDGES,
      nodeId: `rf-${stepId}`,
    });
    const sources: Array<ValueSuggestionSource> = [
      createStepValueSource(),
      staticSource([SAMPLE_GROUPS[1]!]),
    ];

    return renderMenu([], {
      sources: sources,
      valueSources: valueSources,
      graphComponents: NODES.map((entry: StepGraphNode) => {
        return entry.data as NodeDataProp;
      }),
      component: NODES.find((entry: StepGraphNode) => {
        return entry.id === `rf-${stepId}`;
      })!.data as NodeDataProp,
    });
  };

  test("after the branches join: the HTTP POST on Yes only, the steps after apart", () => {
    renderStep("slack-1");

    const sometimes: HTMLElement = screen.getByTestId("value-picker-sometimes");
    expect(sometimes).toHaveTextContent(
      "Runs only when If / Else takes Yes, so its values can be empty here.",
    );
    expect(
      within(sometimes.closest("[role='group']") as HTMLElement).getByText(
        "api-post-1",
      ),
    ).toBeInTheDocument();

    // The Webhook's values and the HTTP POST's, then the variables.
    expect(optionReferences()).toEqual(
      expect.arrayContaining([
        "{{local.components.webhook-1.returnValues.request-body}}",
        POST_BODY,
        DEPLOY_ENV,
      ]),
    );
    expect(optionReferences()).not.toContain(AFTER_BODY);
    expect(optionReferences()).not.toContain(LOOSE_BODY);

    expect(
      screen.getByTestId("value-picker-unavailable-toggle"),
    ).toHaveTextContent("2 steps aren't available here");
    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));
    expect(
      unavailableSteps().map((step: HTMLElement) => {
        return [step.getAttribute("data-step"), step.textContent];
      }),
    ).toEqual([
      ["api-get-after", expect.stringContaining("Runs after this step.")],
      [
        "api-get-loose",
        expect.stringContaining(
          "Not connected to the trigger, so it never runs.",
        ),
      ],
    ]);
  });

  test("on one branch: the other branch is not on its path", () => {
    renderStep("api-post-1");

    expect(screen.queryByTestId("value-picker-sometimes")).toBeNull();

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

    // The Log returns nothing, so it is not listed as a step to explain.
    expect(
      unavailableSteps().map((step: HTMLElement) => {
        return [step.getAttribute("data-step"), step.textContent];
      }),
    ).toEqual([
      ["slack-1", expect.stringContaining("Runs after this step.")],
      ["api-get-after", expect.stringContaining("Runs after this step.")],
      [
        "api-get-loose",
        expect.stringContaining(
          "Not connected to the trigger, so it never runs.",
        ),
      ],
    ]);
  });
});

/*
 * Greyed is for telling apart, not for hiding. Every word the list asks a
 * reader to read - a step's ID, why a step cannot be used, the line over the
 * fields that are not passed on, a description on the row under the keys -
 * reads at 4.5:1 or better on what is behind it. Only the values that cannot
 * be picked are fainter, as WCAG leaves out what cannot be used.
 */
describe("every word of the list can be read", () => {
  type ListWordsFunction = () => Array<WrittenWords>;

  // The list is drawn here without the popup around it, whose ground is white.
  const unreadable: ListWordsFunction = (): Array<WrittenWords> => {
    return unreadableWords(document.body, PAGE_TEXT_CLASS);
  };

  const written: ListWordsFunction = (): Array<WrittenWords> => {
    return wordsIn(document.body, PAGE_TEXT_CLASS);
  };

  type WalkEveryRowFunction = (user: UserEvent) => Promise<void>;

  // The keys on each row in turn: the row under them has a tint of its own.
  const walkEveryRow: WalkEveryRowFunction = async (
    user: UserEvent,
  ): Promise<void> => {
    const rows: number = screen.getAllByRole("option").length;

    for (let step: number = 0; step < rows; step++) {
      expect({ step: step, unreadable: unreadable() }).toEqual({
        step: step,
        unreadable: [],
      });

      await user.keyboard("{ArrowDown}");
    }
  };

  test("browsing: steps, a step on some runs only, variables and the folded steps opened", async () => {
    const { user } = renderMenu([
      ...SAMPLE_GROUPS,
      SOMETIMES_GROUP,
      AFTER_GROUP,
      LOOSE_GROUP,
    ]);

    fireEvent.click(screen.getByTestId("value-picker-unavailable-toggle"));

    expect(unavailableSteps()).toHaveLength(2);
    await walkEveryRow(user);

    // Among them: the amber line, the fold's own line, a reason and an ID.
    expect(
      written().map((words: WrittenWords): string => {
        return words.words;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Runs only when If / Else takes Yes, so its values can be empty here.",
        "2 steps aren't available here",
        "Their values aren't there when this step runs.",
        "Runs after this step.",
        "Not connected to the trigger, so it never runs.",
        "api-get-after",
        "webhook-1",
      ]),
    );
  });

  test("a search: what it finds that can be used, and under their own title what cannot", async () => {
    const { user } = renderMenu([
      ...SAMPLE_GROUPS,
      SOMETIMES_GROUP,
      AFTER_GROUP,
      LOOSE_GROUP,
    ]);

    await user.type(screen.getByTestId("value-picker-search"), "response");

    expect(unavailableValues()).toHaveLength(2);
    await walkEveryRow(user);

    const words: Array<string> = written().map(
      (entry: WrittenWords): string => {
        return entry.words;
      },
    );

    expect(words).toContain("Not available here");
    expect(words).toContain("Runs after this step.");
    /*
     * A value that cannot be picked is not among the words that have to be
     * read at 4.5:1 - its step and the reason are - and it is the one thing
     * here that is fainter.
     */
    expect(
      within(unavailableValues()[0]!).getByText("Response Body"),
    ).toHaveClass("text-gray-400");
    expect(
      contrastOf(within(unavailableValues()[0]!).getByText("Response Body")),
    ).toBeLessThan(AA_TEXT_CONTRAST);
  });

  test("inside a record: its fields, the line over the ones that are not passed on, and the path box", async () => {
    const { user } = renderMenu([recordGroup(INCIDENT_FIELDS)]);

    fireEvent.click(screen.getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(optionReferences()).toContain(INCIDENT_SEVERITY);
    });

    await walkEveryRow(user);

    expect(
      written().find((entry: WrittenWords): boolean => {
        return entry.words.startsWith("On Update Incident doesn't pass");
      }),
    ).toEqual(
      expect.objectContaining({
        textClass: "text-gray-500",
        groundClass: "bg-white",
      }),
    );

    /*
     * The heading over them and its count are words to read too: on the
     * heading's own white, which is what covers the rows passing under it
     * while it is pinned.
     */
    for (const words of ["Not passed on", "2 fields"]) {
      expect([
        words,
        written().find((entry: WrittenWords): boolean => {
          return entry.words === words;
        }),
      ]).toEqual([
        words,
        expect.objectContaining({
          textClass: "text-gray-500",
          groundClass: "bg-white",
        }),
      ]);
    }
  });

  test("a webhook nothing has called yet: its note, the request to copy and the line that it is waiting", () => {
    renderMenu([
      {
        ...SAMPLE_GROUPS[0]!,
        note: {
          text: StepSampleCopy.noRequestYetWithTest,
          copyText: "curl -X POST https://oneuptime.example/workflow/abc",
          copyLabel: StepSampleCopy.copyTestRequest,
          waitingText: StepSampleCopy.waitingForRequest,
        },
      },
    ]);

    expect(screen.getByTestId("value-picker-group-note")).toHaveTextContent(
      "No request has reached this webhook yet.",
    );
    expect(screen.getByTestId("value-picker-note-copy")).toBeInTheDocument();
    expect(unreadable()).toEqual([]);
  });

  test("the same webhook while the workflow is off: the note that offers a test run", () => {
    renderMenu(
      [
        {
          ...SAMPLE_GROUPS[0]!,
          note: {
            text: StepSampleCopy.noRequestYetWhileOff,
            waitingText: StepSampleCopy.waitingForTestRun,
            offersTestRun: true,
          },
        },
      ],
      { isWorkflowOff: true, onTestRun: getJestMockFunction() },
    );

    expect(screen.getByTestId("value-picker-note-test-run")).toHaveTextContent(
      "Test with Run Workflow",
    );
    expect(unreadable()).toEqual([]);
  });
});
