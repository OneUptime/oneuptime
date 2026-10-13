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
import React from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

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

  test("a record whose fields are all passed on has no such section", async () => {
    await openRecord(
      INCIDENT_FIELDS.slice(0, 2).map((field: ValueSuggestion) => {
        return field;
      }),
    );

    expect(screen.queryByTestId("value-picker-empty-here-note")).toBeNull();
    expect(
      screen.getAllByRole("option").some((option: HTMLElement) => {
        return option.hasAttribute("data-empty-here");
      }),
    ).toBe(false);
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
