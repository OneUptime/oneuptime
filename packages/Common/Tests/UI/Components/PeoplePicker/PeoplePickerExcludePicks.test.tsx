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
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A PEOPLE PICKER CAN LEAVE OUT WHOM ANOTHER FIELD HOLDS.
 *
 * A user override asks two questions about people - who is away, and who
 * covers - and nobody can cover for themselves. So the "Who covers?" picker
 * leaves the person who is away out of its search list
 * (PeoplePickerFieldConfig.excludePicksOf, or a PeoplePicker's `excluded`),
 * and follows them when they change. Only the list: a pick already made
 * still shows, so the form's own check can say what is wrong with it.
 *
 * Driven as a person would, with only the network stubbed.
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Search from "../../../../Types/BaseDatabase/Search";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import { PEOPLE_PICKER_SEARCH_LIMIT } from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  getPeoplePickerValueKeySet,
  readPeoplePickerExcludedValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-0000000000a1";
const BOB: string = "0000000e-0000-4000-8000-0000000000b1";
const CY: string = "0000000e-0000-4000-8000-0000000000c1";

interface Person {
  id: string;
  name: string;
  email: string;
}

const PEOPLE: Array<Person> = [
  { id: ADA, name: "Ada Lovelace", email: "ada@example.com" },
  { id: BOB, name: "Bob Stone", email: "bob@example.com" },
  { id: CY, name: "Cy Young", email: "cy@example.com" },
];

function wanted(query: unknown, id: string): boolean {
  if (!(query instanceof Includes)) {
    return true;
  }

  return (query.values as Array<unknown>).some((value: unknown): boolean => {
    return String(value).toLowerCase() === id.toLowerCase();
  });
}

function searchedFor(query: Record<string, unknown>): string {
  const user: Record<string, unknown> =
    (query["user"] as Record<string, unknown>) || {};

  for (const value of Object.values(user)) {
    if (value instanceof Search) {
      return String(value.toString()).toLowerCase();
    }
  }

  return "";
}

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: Record<string, unknown> = request.query || {};

    if (request.modelType !== TeamMember) {
      return { data: [], count: 0, skip: 0, limit: 0 };
    }

    const term: string = searchedFor(query);

    const rows: Array<TeamMember> = PEOPLE.filter((person: Person) => {
      return (
        wanted(query["userId"], person.id) &&
        (!term ||
          person.name.toLowerCase().includes(term) ||
          person.email.includes(term))
      );
    }).map((person: Person): TeamMember => {
      const user: User = new User();
      user._id = person.id;
      user.name = new Name(person.name);
      user.email = new Email(person.email);

      const member: TeamMember = new TeamMember();
      member.user = user;
      return member;
    });

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

// What a screen reader reads: an avatar's initials are drawn for the eye only.
function readText(element: HTMLElement): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return copy.textContent || "";
}

/*
 * Opens a picker's search list with its button. The list is named after
 * the picker's add button, which reads "Change" once something is picked.
 */
async function openList(
  buttonName: string,
  listName: string = buttonName,
): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: listName,
  });

  await waitFor(() => {
    expect(within(dialog).getByRole("listbox")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  return dialog;
}

function namesListed(dialog: HTMLElement): Array<string> {
  return PEOPLE.filter((person: Person) => {
    return within(dialog)
      .queryAllByRole("option")
      .some((option: HTMLElement): boolean => {
        return option.getAttribute("data-id") === person.id;
      });
  }).map((person: Person) => {
    return person.name;
  });
}

describe("reading what a picker leaves out", () => {
  const config: PeoplePickerFieldConfig = {
    kinds: [{ kind: PeoplePickerKind.User, valueKey: "routeAlertsToUserId" }],
    isSinglePick: true,
    excludePicksOf: [
      { kind: PeoplePickerKind.User, valueKey: "overrideUserId" },
    ],
  };

  test("is the picks the named form values hold now", () => {
    expect(
      readPeoplePickerExcludedValue(config, { overrideUserId: ADA }),
    ).toEqual({ [PeoplePickerKind.User]: [ADA] });
  });

  test("reads an id however the form holds it", () => {
    for (const held of [
      ADA,
      new ObjectID(ADA),
      { _id: ADA },
      { value: ADA },
      [ADA],
    ]) {
      expect(
        readPeoplePickerExcludedValue(config, { overrideUserId: held }),
      ).toEqual({ [PeoplePickerKind.User]: [ADA] });
    }
  });

  test("is nobody when the named value is empty", () => {
    for (const values of [
      {},
      { overrideUserId: null },
      { overrideUserId: "" },
      null,
      undefined,
    ]) {
      expect(readPeoplePickerExcludedValue(config, values)).toEqual({
        [PeoplePickerKind.User]: [],
      });
    }
  });

  test("is nothing at all for a picker that names no other value", () => {
    expect(
      readPeoplePickerExcludedValue(
        { kinds: config.kinds, isSinglePick: true },
        { overrideUserId: ADA },
      ),
    ).toEqual({});
  });

  test("joins several values of one kind, each id once", () => {
    expect(
      readPeoplePickerExcludedValue(
        {
          kinds: config.kinds,
          excludePicksOf: [
            { kind: PeoplePickerKind.User, valueKey: "a" },
            { kind: PeoplePickerKind.User, valueKey: "b" },
          ],
        },
        { a: [ADA, BOB], b: BOB },
      ),
    ).toEqual({ [PeoplePickerKind.User]: [ADA, BOB] });
  });

  test("looks ids up without case, as picks are", () => {
    const keys: Set<string> = getPeoplePickerValueKeySet({
      [PeoplePickerKind.User]: [ADA.toUpperCase()],
    });

    expect(keys.has(`${PeoplePickerKind.User}:${ADA}`)).toBe(true);
    expect(getPeoplePickerValueKeySet(undefined).size).toBe(0);
  });
});

const onChangeSpy: MockFunction = getJestMockFunction();

function Harness(props: {
  initial?: PeoplePickerValue;
  excluded?: PeoplePickerValue;
}): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="who-covers-label">Who covers?</label>
      <PeoplePicker
        kinds={[PeoplePickerKind.User]}
        value={value}
        onChange={(next: PeoplePickerValue) => {
          onChangeSpy(next);
          setValue(next);
        }}
        addButtonText="Choose who covers"
        ariaLabelledby="who-covers-label"
        isSinglePick={true}
        excluded={props.excluded}
      />
    </div>
  );
}

describe("a people picker that leaves someone out", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("lists everyone but them", async () => {
    render(<Harness excluded={{ [PeoplePickerKind.User]: [ADA] }} />);

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(namesListed(dialog)).toEqual(["Bob Stone", "Cy Young"]);
  });

  test("leaves them out of a search, too", async () => {
    render(<Harness excluded={{ [PeoplePickerKind.User]: [ADA] }} />);

    const dialog: HTMLElement = await openList("Choose who covers");
    const searchesBefore: number = getListMock.mock.calls.length;

    // Only Ada is called Lovelace: searching for her finds nobody to pick.
    fireEvent.change(within(dialog).getByTestId("people-search-input"), {
      target: { value: "lovelace" },
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(searchesBefore);
    });

    await waitFor(() => {
      expect(dialog).toHaveTextContent("No matches found.");
    });

    expect(namesListed(dialog)).toEqual([]);

    // A search for someone else finds them.
    fireEvent.change(within(dialog).getByTestId("people-search-input"), {
      target: { value: "stone" },
    });

    await waitFor(() => {
      expect(namesListed(dialog)).toEqual(["Bob Stone"]);
    });
  });

  test("whatever case their id is written in", async () => {
    render(
      <Harness excluded={{ [PeoplePickerKind.User]: [ADA.toUpperCase()] }} />,
    );

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(namesListed(dialog)).toEqual(["Bob Stone", "Cy Young"]);
  });

  test("says there is nobody to pick when they were the only one", async () => {
    render(
      <Harness
        excluded={{
          [PeoplePickerKind.User]: PEOPLE.map((person: Person) => {
            return person.id;
          }),
        }}
      />,
    );

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    expect(dialog).toHaveTextContent("No people or teams available.");
  });

  test("still shows a pick already made of someone it leaves out", async () => {
    render(
      <Harness
        initial={{ [PeoplePickerKind.User]: [ADA] }}
        excluded={{ [PeoplePickerKind.User]: [ADA] }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("people-chip").map((chip: HTMLElement) => {
          return readText(chip);
        }),
      ).toEqual(["Ada Lovelace"]);
    });
  });

  test("lists everyone when it leaves nobody out", async () => {
    render(<Harness />);

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(namesListed(dialog)).toEqual([
      "Ada Lovelace",
      "Bob Stone",
      "Cy Young",
    ]);
  });

  /*
   * The search list shows a page of people. Asking for one more for each
   * person left out keeps the page as long as it would be without them.
   */
  test("asks for one more person for each it leaves out", async () => {
    render(<Harness excluded={{ [PeoplePickerKind.User]: [ADA] }} />);

    await openList("Choose who covers");

    expect(searchLimits()).toEqual([PEOPLE_PICKER_SEARCH_LIMIT + 1]);
  });

  test("asks for the usual number when it leaves nobody out", async () => {
    render(<Harness />);

    await openList("Choose who covers");

    expect(searchLimits()).toEqual([PEOPLE_PICKER_SEARCH_LIMIT]);
  });
});

// The page sizes the search list asked for (look-ups by id are not searches).
function searchLimits(): Array<number> {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((request: any): boolean => {
      return request.modelType === TeamMember && !request.query?.userId;
    })
    .map((request: any): number => {
      return request.limit;
    });
}

/*
 * Two pickers in one form, through the real BasicForm: "Who covers?"
 * leaves out whoever "Who is away?" holds, and follows it.
 */
const FORM_FIELDS: Fields<JSONObject> = [
  {
    field: { overrideUserId: true },
    title: "Who is away?",
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: {
      kinds: [{ kind: PeoplePickerKind.User, valueKey: "overrideUserId" }],
      isSinglePick: true,
      addButtonText: "Choose who is away",
    },
    required: true,
    defaultValue: ADA,
  },
  {
    field: { routeAlertsToUserId: true },
    title: "Who covers?",
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: {
      kinds: [{ kind: PeoplePickerKind.User, valueKey: "routeAlertsToUserId" }],
      isSinglePick: true,
      excludePicksOf: [
        { kind: PeoplePickerKind.User, valueKey: "overrideUserId" },
      ],
      addButtonText: "Choose who covers",
    },
    required: true,
  },
];

describe("a form with one picker leaving out another's pick", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  function renderForm(): MockFunction {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="override-form"
        fields={FORM_FIELDS}
        initialValues={{}}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    return onSubmit;
  }

  async function pickIn(
    buttonName: string,
    listName: string,
    name: string,
  ): Promise<void> {
    const dialog: HTMLElement = await openList(buttonName, listName);

    const option: HTMLElement | undefined = within(dialog)
      .getAllByRole("option")
      .find((candidate: HTMLElement): boolean => {
        return readText(candidate).startsWith(name);
      });

    if (!option) {
      throw new Error(`No option named ${name}`);
    }

    await act(async (): Promise<void> => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  }

  test("'Who covers?' does not offer the person who is away", async () => {
    renderForm();

    // "Who is away?" starts as Ada.
    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")).toHaveLength(1);
    });

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(namesListed(dialog)).toEqual(["Bob Stone", "Cy Young"]);
  });

  test("follows 'Who is away?' when it changes", async () => {
    renderForm();

    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")).toHaveLength(1);
    });

    // Bob is away instead of Ada.
    await pickIn("Change", "Choose who is away", "Bob Stone");

    const dialog: HTMLElement = await openList("Choose who covers");

    expect(namesListed(dialog)).toEqual(["Ada Lovelace", "Cy Young"]);
  });

  test("saves both picks, each in its own value", async () => {
    const onSubmit: MockFunction = renderForm();

    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")).toHaveLength(1);
    });

    await pickIn("Choose who covers", "Choose who covers", "Cy Young");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const values: JSONObject = onSubmit.mock.calls[0]![0] as JSONObject;

    expect(values["overrideUserId"]).toBe(ADA);
    expect(values["routeAlertsToUserId"]).toBe(CY);
  });
});
