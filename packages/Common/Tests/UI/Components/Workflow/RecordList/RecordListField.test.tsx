import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * A Page step's "who to page" setting, as the person building the workflow
 * uses it: the people picker every form picks people with, for the one kind
 * of record the step pages, and a value from an earlier step as a chip of
 * its own beside the picks.
 *
 * The field, the picker, its search list and the value picker are the real
 * thing; only the API is stood in for. What must hold:
 *
 *   - each kind of step picks its own kind of record, in its own words;
 *   - a pick is an id in the list the field saves, and taking it out takes
 *     the id out;
 *   - a value from an earlier step is picked from { }, joins the list as its
 *     reference, is named the way values are named everywhere else in the
 *     Builder, and comes out with its own remove button - never touching
 *     the picks;
 *   - anything else the setting holds is shown as written, and removable;
 *   - outside a workflow's settings there are no values to pick, and { } is
 *     not drawn.
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

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { PeoplePickerKind } from "../../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import RecordListField, {
  RECORD_LIST_COPY,
  USE_VALUE_FOR_LIST_LABEL,
} from "../../../../../UI/Components/Workflow/RecordList/RecordListField";
import {
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import IconProp from "../../../../../Types/Icon/IconProp";
import { withPicker } from "../ValuePicker/ValuePickerTestUtils";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "10000000-0000-4000-8000-000000000002";
const PLATFORM: string = "7eae0000-0000-4000-8000-000000000001";
const PRIMARY: string = "5c4e0000-0000-4000-8000-000000000001";
const CRITICAL: string = "dddddddd-0000-4000-8000-000000000001";

const MANUAL_VALUE: string = "{{local.components.manual-1.returnValues.value}}";
const OWNERS: string =
  "{{local.components.manual-1.returnValues.value.owners}}";
const GONE: string = "{{local.components.deleted-step-9.returnValues.value}}";

// What a pick's remove button is called, before the pick's name.
const REMOVE_PREFIX: string = "Remove ";

const PEOPLE: Array<{ id: string; name: string; email: string }> = [
  { id: JANE, name: "Jane Doe", email: "jane@example.com" },
  { id: JOHN, name: "John Roe", email: "john@example.com" },
];

function metadataOf(id: ComponentID): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
}

function step(id: ComponentID, number: number = 1): NodeDataProp {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: `${id}-${number}`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-${number}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
}

const MANUAL: NodeDataProp = step(ComponentID.Manual);
const PAGE_USERS: NodeDataProp = step(ComponentID.PageUsers);

// What the value picker offers this step: the trigger's one value.
const VALUES_ON_OFFER: Array<ValueSuggestionGroup> = [
  {
    id: "step:manual-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "Manual",
    subtitle: "manual-1",
    iconProp: IconProp.Bolt,
    order: 0,
    items: [{ reference: MANUAL_VALUE, label: "JSON", typeLabel: "JSON" }],
  },
];

function result(rows: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
}

// The project, as the API lists it: people through their team memberships.
function answerLists(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const wanted: Array<string> | null =
        request.query.userId instanceof Includes
          ? (request.query.userId.values as Array<string>).map(String)
          : null;

      return result(
        PEOPLE.filter((person: { id: string }): boolean => {
          return !wanted || wanted.includes(person.id);
        }).map((person: { id: string; name: string; email: string }) => {
          const user: User = new User();
          user._id = person.id;
          user.name = new Name(person.name);
          user.email = new Email(person.email);

          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        }),
      );
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = PLATFORM;
      team.name = "Platform";
      return result([team]);
    }

    if (request.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = PRIMARY;
      schedule.name = "Primary";
      return result([schedule]);
    }

    if (request.modelType === OnCallDutyPolicy) {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = CRITICAL;
      policy.name = "Critical";
      return result([policy]);
    }

    return result([]);
  });
}

interface Rendered {
  // Every value the field handed back, in order.
  changes: Array<Array<string>>;
  onBlur: MockFunction;
}

function renderField(data: {
  kind?: PeoplePickerKind | undefined;
  initial?: unknown;
  // Outside a step's settings: no value picker to draw from.
  withoutValues?: boolean | undefined;
  error?: string | undefined;
}): Rendered {
  const changes: Array<Array<string>> = [];
  const onBlur: MockFunction = getJestMockFunction();

  function Harness(): ReactElement {
    const [value, setValue] = useState<unknown>(data.initial);

    return (
      <div>
        <label id="who-label">Who to page</label>
        <RecordListField
          kind={data.kind || PeoplePickerKind.User}
          value={value}
          onChange={(next: Array<string>) => {
            changes.push(next);
            setValue(next);
          }}
          ariaLabelledby="who-label"
          error={data.error}
          dataTestId="who"
          onBlur={onBlur as () => void}
        />
      </div>
    );
  }

  render(
    data.withoutValues ? (
      <Harness />
    ) : (
      // Exactly these values on offer: nothing here reads the server for them.
      withPicker(<Harness />, {
        groups: VALUES_ON_OFFER,
        component: PAGE_USERS,
        graphComponents: [MANUAL, PAGE_USERS],
      })
    ),
  );

  return { changes: changes, onBlur: onBlur };
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Who to page" });
}

// The picks in the row, by the name each one's remove button says.
function chipNames(): Array<string> {
  return within(group())
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string => {
      const label: string =
        within(chip).getByRole("button").getAttribute("aria-label") || "";

      return label.startsWith(REMOVE_PREFIX)
        ? label.substring(REMOVE_PREFIX.length)
        : label;
    });
}

// The ids of the picks in the row, in the order they are drawn.
function chipIds(): Array<string> {
  return within(group())
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string => {
      return chip.getAttribute("data-id") || "";
    });
}

function valueChips(): Array<HTMLElement> {
  return within(group()).queryAllByTestId("who-value-chip");
}

describe("a step's who-to-page setting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/workflows`);
    answerLists();
  });

  afterEach(() => {
    cleanup();
  });

  describe("each kind of record, in its own words", () => {
    test.each<[PeoplePickerKind, string]>([
      [PeoplePickerKind.User, "Add user"],
      [PeoplePickerKind.Team, "Add team"],
      [PeoplePickerKind.OnCallSchedule, "Add on-call schedule"],
      [PeoplePickerKind.OnCallPolicy, "Add on-call policy"],
    ])(
      "%s: the button says what it adds",
      (kind: PeoplePickerKind, buttonText: string) => {
        renderField({ kind: kind });

        expect(
          within(group()).getByRole("button", { name: buttonText }),
        ).toBeInTheDocument();
        expect(RECORD_LIST_COPY[kind].addButtonText).toBe(buttonText);
      },
    );

    test("every kind the picker has can be a list, with words of its own for an empty project", () => {
      for (const kind of Object.values(PeoplePickerKind)) {
        expect(RECORD_LIST_COPY[kind].addButtonText.length).toBeGreaterThan(0);
        expect(RECORD_LIST_COPY[kind].searchPlaceholder.length).toBeGreaterThan(
          0,
        );
        expect(RECORD_LIST_COPY[kind].emptyText.length).toBeGreaterThan(0);
      }

      // No two kinds share a button: each says what it adds.
      expect(
        new Set(
          Object.values(RECORD_LIST_COPY).map(
            (copy: { addButtonText: string }): string => {
              return copy.addButtonText;
            },
          ),
        ).size,
      ).toBe(Object.values(PeoplePickerKind).length);
    });

    test.each<[PeoplePickerKind, unknown, string]>([
      [PeoplePickerKind.Team, Team, "Platform"],
      [PeoplePickerKind.OnCallSchedule, OnCallDutyPolicySchedule, "Primary"],
      [PeoplePickerKind.OnCallPolicy, OnCallDutyPolicy, "Critical"],
    ])(
      "%s: the search list offers that kind of record and no other",
      async (kind: PeoplePickerKind, modelType: unknown, name: string) => {
        renderField({ kind: kind });

        fireEvent.click(
          within(group()).getByRole("button", {
            name: RECORD_LIST_COPY[kind].addButtonText,
          }),
        );

        expect(await screen.findByText(name)).toBeInTheDocument();

        const listed: Array<unknown> = getListMock.mock.calls.map(
          (call: Array<any>): unknown => {
            return call[0].modelType;
          },
        );

        expect(listed.length).toBeGreaterThan(0);

        for (const listedModel of listed) {
          expect(listedModel).toBe(modelType);
        }
      },
    );
  });

  describe("picking people", () => {
    test("a pick is added to the list as its id, and shown as a chip by name", async () => {
      const rendered: Rendered = renderField({});

      fireEvent.click(
        within(group()).getByRole("button", { name: "Add user" }),
      );
      fireEvent.click(await screen.findByText("Jane Doe"));

      expect(rendered.changes).toEqual([[JANE]]);
      await waitFor(() => {
        expect(chipNames()).toEqual(["Jane Doe"]);
      });
    });

    test("several in a row, each joining the list", async () => {
      const rendered: Rendered = renderField({});

      fireEvent.click(
        within(group()).getByRole("button", { name: "Add user" }),
      );
      fireEvent.click(await screen.findByText("Jane Doe"));
      fireEvent.click(await screen.findByText("John Roe"));

      expect(rendered.changes[rendered.changes.length - 1]).toEqual([
        JANE,
        JOHN,
      ]);
    });

    test("ids the setting already holds are looked up and shown by name", async () => {
      renderField({ initial: [JOHN, JANE] });

      await waitFor(() => {
        expect(chipNames()).toEqual(["John Roe", "Jane Doe"]);
      });
      expect(chipIds()).toEqual([JOHN, JANE]);
    });

    test("a pick's remove button takes its id out and leaves the others", async () => {
      const rendered: Rendered = renderField({ initial: [JANE, JOHN] });

      fireEvent.click(
        await within(group()).findByRole("button", { name: "Remove Jane Doe" }),
      );

      expect(rendered.changes).toEqual([[JOHN]]);
    });

    test("the last one removed leaves an empty list, which a required setting reads as empty", async () => {
      const rendered: Rendered = renderField({ initial: [JANE] });

      fireEvent.click(
        await within(group()).findByRole("button", { name: "Remove Jane Doe" }),
      );

      expect(rendered.changes).toEqual([[]]);
    });

    test("somebody the project no longer has is still a chip, so they can be taken out", async () => {
      const gone: string = "99999999-0000-4000-8000-000000000009";
      const rendered: Rendered = renderField({ initial: [gone] });

      const chip: HTMLElement =
        await within(group()).findByText("Unknown user");

      expect(chip).toBeInTheDocument();

      fireEvent.click(
        within(group()).getByRole("button", { name: "Remove Unknown user" }),
      );

      expect(rendered.changes).toEqual([[]]);
    });

    test("the form's error is said under the field", () => {
      renderField({ error: "This field is required." });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "This field is required.",
      );
    });
  });

  describe("a value from an earlier step", () => {
    test("{ } is at the end of the row, and says what it does", () => {
      renderField({ initial: [JANE] });

      const insert: HTMLElement =
        within(group()).getByTestId("who-insert-value");

      expect(insert).toHaveAccessibleName(USE_VALUE_FOR_LIST_LABEL);
      expect(insert).toHaveTextContent("{ }");
      expect(insert).toHaveAttribute("aria-haspopup", "dialog");
      // After the Add button and every chip.
      expect(group().lastElementChild).toBe(insert);
    });

    test("picked from the list of values, it joins the list as its reference", async () => {
      const rendered: Rendered = renderField({ initial: [JANE] });

      fireEvent.click(within(group()).getByTestId("who-insert-value"));

      // The Manual trigger's value, as the value picker offers it.
      const option: HTMLElement = (await screen.findAllByRole("option")).find(
        (candidate: HTMLElement): boolean => {
          return candidate.getAttribute("data-reference") === MANUAL_VALUE;
        },
      )!;

      await act(async () => {
        fireEvent.click(option);
      });

      expect(rendered.changes).toEqual([[JANE, MANUAL_VALUE]]);
      // The list closes on the pick, and the value is a chip in the row.
      expect(screen.queryByTestId("value-picker")).toBeNull();
      expect(valueChips()).toHaveLength(1);
    });

    test("a reference the setting holds is a chip named the way values are named in the Builder", async () => {
      renderField({ initial: [JANE, OWNERS] });

      const chips: Array<HTMLElement> = valueChips();

      expect(chips).toHaveLength(1);
      expect(chips[0]).toHaveTextContent("Manual");
      expect(chips[0]).toHaveTextContent("owners");
      // Never the raw reference where a name can be drawn.
      expect(chips[0]!.textContent).not.toContain("{{local.components");
      // The reference itself is its tooltip.
      expect(chips[0]).toHaveAttribute(
        "title",
        expect.stringContaining(OWNERS),
      );
      expect(chips[0]).toHaveAttribute("data-entry-type", "Reference");
      expect(chips[0]).toHaveAttribute("data-tone", "Normal");

      // The picks are still people, before it.
      await waitFor(() => {
        expect(chipNames()).toEqual(["Jane Doe"]);
      });
    });

    test("its remove button takes the value out and leaves the picks", async () => {
      const rendered: Rendered = renderField({ initial: [JANE, OWNERS] });

      fireEvent.click(
        within(valueChips()[0]!).getByTestId("who-value-chip-remove"),
      );

      expect(rendered.changes).toEqual([[JANE]]);
    });

    test("removing a pick leaves the value where it is", async () => {
      const rendered: Rendered = renderField({ initial: [JANE, OWNERS] });

      fireEvent.click(
        await within(group()).findByRole("button", { name: "Remove Jane Doe" }),
      );

      expect(rendered.changes).toEqual([[OWNERS]]);
    });

    test("adding a pick keeps the value, after the picks", async () => {
      const rendered: Rendered = renderField({ initial: [OWNERS] });

      fireEvent.click(
        within(group()).getByRole("button", { name: "Add user" }),
      );
      fireEvent.click(await screen.findByText("Jane Doe"));

      expect(rendered.changes).toEqual([[JANE, OWNERS]]);
    });

    test("a value that points at a step the workflow no longer has is a warning chip, still removable", () => {
      const rendered: Rendered = renderField({ initial: [GONE] });

      const chip: HTMLElement = valueChips()[0]!;

      expect(chip).toHaveAttribute("data-tone", "Warning");
      expect(chip.className).toContain("amber");
      expect(chip.getAttribute("title")).toContain(GONE);

      fireEvent.click(within(chip).getByTestId("who-value-chip-remove"));

      expect(rendered.changes).toEqual([[]]);
    });

    test("text built around a value is shown as it is written", () => {
      renderField({ initial: ["team-{{local.variables.team}}"] });

      expect(valueChips()[0]).toHaveTextContent(
        "team-{{local.variables.team}}",
      );
      expect(valueChips()[0]).toHaveAttribute("data-entry-type", "Reference");
    });

    test("a value alone is not an empty field: nothing says nobody is picked", () => {
      renderField({ initial: [OWNERS] });

      expect(valueChips()).toHaveLength(1);
      expect(
        within(group()).queryByTestId("people-picker-nobody-picked"),
      ).toBeNull();
    });
  });

  describe("anything else the setting holds", () => {
    test("an email address written into a workflow is shown as written, and can be taken out", () => {
      const rendered: Rendered = renderField({
        initial: ["jane@example.com", OWNERS],
      });

      const chips: Array<HTMLElement> = valueChips();

      // In the order the setting holds them.
      expect(chips).toHaveLength(2);
      expect(chips[0]).toHaveTextContent("jane@example.com");
      expect(chips[0]).toHaveAttribute("data-entry-type", "Text");
      expect(chips[0]).toHaveAttribute("title", "jane@example.com");
      // Not drawn as a value from a step: no { } mark, no value colour.
      expect(chips[0]!.className).not.toContain("indigo");
      expect(chips[0]).not.toHaveTextContent("{ }");
      expect(chips[1]).toHaveAttribute("data-entry-type", "Reference");
      expect(chips[1]).toHaveTextContent("{ }");

      fireEvent.click(
        within(group()).getByRole("button", {
          name: "Remove jane@example.com",
        }),
      );

      expect(rendered.changes).toEqual([[OWNERS]]);
    });

    test("a setting stored as one string, as a workflow written by hand may hold, is read rather than lost", async () => {
      renderField({ initial: JANE });

      await waitFor(() => {
        expect(chipNames()).toEqual(["Jane Doe"]);
      });
    });
  });

  describe("outside a workflow's settings", () => {
    test("there are no values to pick, so { } is not drawn - and the picker works as it always does", async () => {
      const rendered: Rendered = renderField({ withoutValues: true });

      expect(within(group()).queryByTestId("who-insert-value")).toBeNull();

      fireEvent.click(
        within(group()).getByRole("button", { name: "Add user" }),
      );
      fireEvent.click(await screen.findByText("Jane Doe"));

      expect(rendered.changes).toEqual([[JANE]]);
    });
  });
});
