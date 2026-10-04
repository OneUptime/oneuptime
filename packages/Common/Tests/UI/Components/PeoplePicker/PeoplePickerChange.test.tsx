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
 * A people picker says, with every change, who is picked now and who was
 * before - by name - the way a dropdown says which options it holds. A form
 * can then name something after the picks without a request of its own: an
 * owner rule is named "Add Platform as owners" (Dashboard Utils/Form/
 * ResourceRuleForm). As a form field, the picker hands that to the field's
 * onChange as its fourth argument, the DropdownChange a dropdown hands it.
 *
 * Only the network is stubbed: a tiny directory answers the picker's
 * requests the way the API filters them.
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

import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import { DropdownChange } from "../../../../UI/Components/Dropdown/DropdownChange";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import getOwnersFormField from "../../../../UI/Components/PeoplePicker/OwnersFormField";
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import {
  getPeoplePickerNamedOptions,
  getPeoplePickerOptionKey,
  PeoplePickerChange,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
  toPeoplePickerDropdownChange,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

const KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

const USERS: Array<User> = [
  makeUser(ADA, "Ada Lovelace", "ada@example.com"),
  makeUser(BOB, "Bob Stone", "bob@example.com"),
];

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      const users: Array<User> =
        query.userId instanceof Includes
          ? USERS.filter((user: User): boolean => {
              return (query.userId.values as Array<string>).includes(
                user._id as string,
              );
            })
          : USERS;

      rows = users.map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = PLATFORM;
      team.name = "Platform";
      rows = [team];
    }

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

const changes: Array<PeoplePickerChange | undefined> = [];

function Harness(props: { initial?: PeoplePickerValue }): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="owners-label">Owners</label>
      <PeoplePicker
        kinds={KINDS}
        value={value}
        onChange={(next: PeoplePickerValue, change?: PeoplePickerChange) => {
          changes.push(change);
          setValue(next);
        }}
        addButtonText="Add owner"
        ariaLabelledby="owners-label"
      />
    </div>
  );
}

async function pick(name: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", { name: "Add owner" });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  const options: Array<HTMLElement> =
    await within(dialog).findAllByRole("option");

  const option: HTMLElement | undefined = options.find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent?.includes(name) || false;
    },
  );

  if (!option) {
    throw new Error(`No option named ${name}`);
  }

  fireEvent.click(option);
}

type NamesFunction = (options: Array<PeoplePickerOption>) => Array<string>;

const names: NamesFunction = (
  options: Array<PeoplePickerOption>,
): Array<string> => {
  return options.map((option: PeoplePickerOption): string => {
    return option.name;
  });
};

function lastChange(): PeoplePickerChange {
  const change: PeoplePickerChange | undefined = changes[changes.length - 1];

  if (!change) {
    throw new Error("The picker reported no change.");
  }

  return change;
}

describe("a people picker's change, by name", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    changes.length = 0;
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("says who is picked now and who was before, people first", async () => {
    render(<Harness />);

    await pick("Platform");

    expect(names(lastChange().selectedOptions)).toEqual(["Platform"]);
    expect(names(lastChange().previousOptions)).toEqual([]);

    await pick("Ada Lovelace");

    // The picker shows people before teams, and so does the change.
    expect(names(lastChange().selectedOptions)).toEqual([
      "Ada Lovelace",
      "Platform",
    ]);
    expect(names(lastChange().previousOptions)).toEqual(["Platform"]);
    expect(lastChange().selectedOptions[0]).toMatchObject({
      kind: PeoplePickerKind.User,
      id: ADA,
    });
  });

  test("says who is left when a chip is taken away", async () => {
    render(<Harness />);

    await pick("Ada Lovelace");
    await pick("Bob Stone");

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    expect(names(lastChange().selectedOptions)).toEqual(["Bob Stone"]);
    expect(names(lastChange().previousOptions)).toEqual([
      "Ada Lovelace",
      "Bob Stone",
    ]);
  });

  test("names the picks it started with once they are looked up, and leaves out one no longer found", async () => {
    render(
      <Harness
        initial={{
          [PeoplePickerKind.User]: [ADA, GONE_USER],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")[0]).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    await pick("Platform");

    expect(names(lastChange().selectedOptions)).toEqual([
      "Ada Lovelace",
      "Platform",
    ]);
    // The user who left is still a chip, so it can be removed - not a name.
    expect(names(lastChange().previousOptions)).toEqual(["Ada Lovelace"]);
  });
});

describe("a people picker field's onChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("hears the picks by name, as a dropdown field's does", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="owners-form"
        fields={[
          getOwnersFormField<JSONObject>({
            onChange: (
              value: unknown,
              _currentValues: FormValues<JSONObject>,
              _setNewFormValues: (values: FormValues<JSONObject>) => void,
              change?: DropdownChange,
            ): void => {
              onChange(value, change);
            },
          }),
        ]}
        initialValues={{}}
        onSubmit={() => {}}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await pick("Ada Lovelace");
    await pick("Platform");

    expect(onChange).toHaveBeenCalledTimes(2);

    const [value, change] = onChange.mock.calls[1]! as [
      JSONObject,
      DropdownChange,
    ];

    // The value is what the field writes: each kind to its own form value.
    expect(value).toEqual({ ownerUsers: [ADA], ownerTeams: [PLATFORM] });
    expect(change).toEqual({
      selectedOptions: [
        {
          label: "Ada Lovelace",
          value: getPeoplePickerOptionKey(PeoplePickerKind.User, ADA),
        },
        {
          label: "Platform",
          value: getPeoplePickerOptionKey(PeoplePickerKind.Team, PLATFORM),
        },
      ],
      previousOptions: [
        {
          label: "Ada Lovelace",
          value: getPeoplePickerOptionKey(PeoplePickerKind.User, ADA),
        },
      ],
    });
  });
});

describe("the change's plain helpers", () => {
  const ada: PeoplePickerOption = {
    kind: PeoplePickerKind.User,
    id: ADA,
    name: "Ada Lovelace",
  };
  const platform: PeoplePickerOption = {
    kind: PeoplePickerKind.Team,
    id: PLATFORM,
    name: "Platform",
  };
  const gone: PeoplePickerOption = {
    kind: PeoplePickerKind.User,
    id: GONE_USER,
    name: "Unknown user",
    isUnknown: true,
  };

  const lookup: Record<string, PeoplePickerOption> = {
    [getPeoplePickerOptionKey(ada.kind, ada.id)]: ada,
    [getPeoplePickerOptionKey(platform.kind, platform.id)]: platform,
    [getPeoplePickerOptionKey(gone.kind, gone.id)]: gone,
  };

  test("names a value's picks in the kinds' order, leaving out the unknown and the not yet named", () => {
    expect(
      getPeoplePickerNamedOptions({
        kinds: KINDS,
        value: {
          [PeoplePickerKind.Team]: [PLATFORM],
          [PeoplePickerKind.User]: [GONE_USER, BOB, ADA],
        },
        getOption: (
          kind: PeoplePickerKind,
          id: string,
        ): PeoplePickerOption | undefined => {
          return lookup[getPeoplePickerOptionKey(kind, id)];
        },
      }),
    ).toEqual([ada, platform]);
  });

  test("turns a change into a dropdown's, keyed by kind so a person and a team of one name stay two", () => {
    const sameNameTeam: PeoplePickerOption = {
      kind: PeoplePickerKind.Team,
      id: ADA,
      name: "Ada Lovelace",
    };

    expect(
      toPeoplePickerDropdownChange({
        selectedOptions: [ada, sameNameTeam],
        previousOptions: [],
      }),
    ).toEqual({
      selectedOptions: [
        { label: "Ada Lovelace", value: `user:${ADA}` },
        { label: "Ada Lovelace", value: `team:${ADA}` },
      ],
      previousOptions: [],
    });
  });
});
