import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHO OWNS THE RECORD, AND WHICH POLICY: PICKED, NOT TYPED (#7554, #7582,
 * #7583).
 *
 * A workspace rule's Conditions step, and the rule's card, drawn for real:
 *
 *   If   [Incident Owner ]  [is any of]  (+ Add owner) (Jane Doe) (Platform)
 *                                        Matches the people and teams added
 *                                        as owners. Team membership does
 *                                        not count.
 *   And  [On-Call Policy ]  [is any of]  [(Payments Escalation) (Old) v]
 *
 * - an owners condition picks people and teams as owners are picked
 *   everywhere, and stores their ids - people first, then teams;
 * - an on-call rule picks its policies from the project's, by name, and
 *   stores their ids, so a renamed policy still matches;
 * - an archived value (a severity, a policy) is not offered for a new pick;
 *   one a rule holds already stays, marked Archived, until it is taken out;
 * - the card names what the rule picks - owners with their avatars, a team
 *   as a team, policies by name - and says so of one the project no longer
 *   has, rather than dropping it;
 * - all of it in the reader's language, from the Dashboard's own locales.
 *
 * Only the network is stubbed: a small directory answers the people
 * picker's requests the way the API filters them.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import NotificationRuleConditionElement, {
  getOwnerPickerValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition";
import NotificationRuleConditionsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditions";
import {
  CONDITION_FIELD_HINTS,
  getConditionFieldHint,
  getConditionOperatorWords,
  getConditionValueHint,
  OWNER_CONDITION_HINT,
  POLICY_NAME_CONDITION_HINT,
  VALUE_NOT_FOUND_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditionWords";
import NotificationRuleViewConditionElement, {
  getOwnerConditionOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewCondition";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import Email from "../../../Types/Email";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  getCheckOnLabel,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
  OWNER_CHECK_ON_BY_EVENT_TYPE,
  OWNER_CHECK_ONS,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  ARABIC_LIST_SEPARATOR,
  LIST_SEPARATOR,
} from "../../../UI/Utils/ListSeparator";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const JANE: string = "0000000e-0000-4000-8000-000000000001";
const SAM: string = "0000000e-0000-4000-8000-000000000002";
const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const PAYMENTS_TEAM: string = "0000000b-0000-4000-8000-000000000002";

const PAYMENTS_POLICY: string = "0000000c-0000-4000-8000-000000000001";
const SEARCH_POLICY: string = "0000000c-0000-4000-8000-000000000002";
const OLD_POLICY: string = "0000000c-0000-4000-8000-000000000003";
const DELETED_POLICY: string = "0000000c-0000-4000-8000-0000000000ff";

const CRITICAL: string = "0000000d-0000-4000-8000-000000000001";
const MAJOR: string = "0000000d-0000-4000-8000-000000000002";

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
  de: readLocale("de"),
  ar: readLocale("ar"),
};

function makeUser(data: {
  id: string;
  name: string;
  email: string;
  hasPicture?: boolean;
}): User {
  const user: User = new User();
  user._id = data.id;
  user.name = new Name(data.name);
  user.email = new Email(data.email);

  if (data.hasPicture) {
    user.profilePictureId = ObjectID.generate();
  }

  return user;
}

function makeTeam(id: string, name: string): Team {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
}

function makePolicy(
  id: string,
  name: string,
  isArchived: boolean = false,
): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = id;
  policy.name = name;
  policy.isArchived = isArchived;
  return policy;
}

function makeSeverity(
  id: string,
  name: string,
  isArchived: boolean,
): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = id;
  severity.name = name;
  severity.color = new Color("#dc2626");
  severity.isArchived = isArchived;
  return severity;
}

const DIRECTORY: { users: Array<User>; teams: Array<Team> } = {
  users: [
    makeUser({
      id: JANE,
      name: "Jane Doe",
      email: "jane@example.com",
      hasPicture: true,
    }),
    makeUser({ id: SAM, name: "Sam Lee", email: "sam@example.com" }),
  ],
  teams: [makeTeam(PAYMENTS_TEAM, "Payments"), makeTeam(PLATFORM, "Platform")],
};

function includes(haystack: unknown, needle: unknown): boolean {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

// Answers the people picker's requests the way the API filters them.
function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      let users: Array<User> = DIRECTORY.users;

      if (query.userId instanceof Includes) {
        users = users.filter((user: User): boolean => {
          return (query.userId.values as Array<string>).includes(
            user._id as string,
          );
        });
      }

      if (query.user?.name) {
        users = users.filter((user: User): boolean => {
          return includes(user.name, query.user.name.toString());
        });
      }

      if (query.user?.email) {
        users = users.filter((user: User): boolean => {
          return includes(user.email, query.user.email.toString());
        });
      }

      rows = users.map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
    }

    if (request.modelType === Team) {
      let teams: Array<Team> = DIRECTORY.teams;

      if (query._id instanceof Includes) {
        teams = teams.filter((team: Team): boolean => {
          return (query._id.values as Array<string>).includes(
            team._id as string,
          );
        });
      }

      if (query.name) {
        teams = teams.filter((team: Team): boolean => {
          return includes(team.name, query.name.toString());
        });
      }

      rows = teams;
    }

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

// The project's values, as the rules page loads them (with isArchived).
function lookupProps(): {
  monitors: [];
  labels: [];
  alertStates: [];
  alertSeverities: [];
  incidentStates: [];
  scheduledMaintenanceStates: [];
  monitorStatus: [];
  incidentSeverities: Array<IncidentSeverity>;
  onCallDutyPolicies: Array<OnCallDutyPolicy>;
} {
  return {
    monitors: [],
    labels: [],
    alertStates: [],
    alertSeverities: [],
    incidentStates: [],
    scheduledMaintenanceStates: [],
    monitorStatus: [],
    incidentSeverities: [
      makeSeverity(CRITICAL, "Critical", false),
      makeSeverity(MAJOR, "Major", true),
    ],
    onCallDutyPolicies: [
      makePolicy(PAYMENTS_POLICY, "Payments Escalation"),
      makePolicy(SEARCH_POLICY, "Search Escalation"),
      makePolicy(OLD_POLICY, "Old Escalation", true),
    ],
  };
}

const PROJECT_TEAMS: Array<Team> = [
  makeTeam(PLATFORM, "Platform"),
  makeTeam(PAYMENTS_TEAM, "Payments"),
];

const onChangeSpy: MockFunction = getJestMockFunction();

function renderRow(data: {
  eventType: NotificationRuleEventType;
  condition: NotificationRuleCondition;
  teams?: Array<Team> | undefined;
}): void {
  render(
    <ul>
      <NotificationRuleConditionElement
        {...lookupProps()}
        teams={data.teams || PROJECT_TEAMS}
        eventType={data.eventType}
        initialValue={data.condition}
        index={0}
        onChange={(value: NotificationRuleCondition): void => {
          onChangeSpy(value);
        }}
        onDelete={(): void => {}}
      />
    </ul>,
  );
}

function lastCondition(): NotificationRuleCondition {
  expect(onChangeSpy.mock.calls.length).toBeGreaterThan(0);

  return onChangeSpy.mock.calls[
    onChangeSpy.mock.calls.length - 1
  ]![0] as NotificationRuleCondition;
}

function condition(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType,
  value: Array<string> | string | undefined,
): NotificationRuleCondition {
  return { checkOn: checkOn, conditionType: conditionType, value: value };
}

/*
 * The text a screen reader reads: an avatar's initials are drawn for the
 * eye only (aria-hidden), the name beside them is the text.
 */
function readText(element: Element): string {
  const copy: Element = element.cloneNode(true) as Element;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return (copy.textContent || "").trim();
}

function chipNames(within_: HTMLElement = document.body): Array<string> {
  return Array.from(
    within_.querySelectorAll("[data-testid='people-chip']"),
  ).map((chip: Element): string => {
    return readText(chip);
  });
}

/*
 * react-select renders one text input per dropdown, in the row's order:
 * 0 = the field, 1 = how it compares, 2 = the value (when it is a list).
 */
async function openDropdown(index: number): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const comboboxes: Array<HTMLElement> = screen.getAllByRole("combobox");

  expect(comboboxes.length).toBeGreaterThan(index);

  await user.click(comboboxes[index]!);
}

// The open menu's options: each one's label and the line under it.
function listedOptions(): Array<{ label: string; description?: string }> {
  return screen.queryAllByRole("option").map((option: HTMLElement) => {
    const label: Element | null = option.querySelector(
      "[data-testid='dropdown-option-label']",
    );
    const description: Element | null = option.querySelector(
      "[data-testid='dropdown-option-description']",
    );

    return {
      label: ((label || option).textContent || "").trim(),
      ...(description
        ? { description: (description.textContent || "").trim() }
        : {}),
    };
  });
}

function listedLabels(): Array<string> {
  return listedOptions().map((option: { label: string }): string => {
    return option.label;
  });
}

async function pickOption(label: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      const optionLabel: Element | null = candidate.querySelector(
        "[data-testid='dropdown-option-label']",
      );

      return ((optionLabel || candidate).textContent || "").trim() === label;
    });

  if (!option) {
    throw new Error(`No option named ${label}`);
  }

  await user.click(option);
}

// The people picker's list, opened from its Add button.
async function openPeopleList(addButtonName: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: addButtonName }));

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: addButtonName,
  });

  await within(dialog).findAllByRole("option");

  return dialog;
}

function peopleOptionNamed(name: string): HTMLElement {
  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return readText(candidate).startsWith(name);
    });

  if (!option) {
    throw new Error(`No option named ${name}`);
  }

  return option;
}

// What the value control shows as picked, each with whether it is marked.
function pickedValues(): Array<{ name: string; isArchived: boolean }> {
  const control: HTMLElement | null = screen.queryByTestId(
    "notification-rule-condition-value-0",
  );

  if (!control) {
    return [];
  }

  return within(control)
    .queryAllByTestId("dropdown-value-label")
    .map((label: HTMLElement) => {
      return {
        name: (label.textContent || "").trim(),
        isArchived: Boolean(
          label.parentElement?.querySelector(
            "[data-testid='dropdown-archived-tag']",
          ),
        ),
      };
    });
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: LOCALES["en"]! },
      de: { translation: LOCALES["de"]! },
      ar: { translation: LOCALES["ar"]! },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getListMock.mockReset();
  onChangeSpy.mockReset();
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/incidents/workspace-connection-slack`,
  );
  serveDirectory();
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

describe("an owners condition (#7583)", () => {
  test("is offered by every kind of rule whose records have owners, and by no other", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      const offered: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType).filter(
          (checkOn: NotificationRuleConditionCheckOn): boolean => {
            return NotificationRuleConditionUtil.isOwnerCheckOn(checkOn);
          },
        );

      const own: NotificationRuleConditionCheckOn | undefined =
        OWNER_CHECK_ON_BY_EVENT_TYPE[eventType];

      expect({ eventType, offered }).toEqual({
        eventType,
        offered: own ? [own] : [],
      });
    }
  });

  test.each(
    Object.entries(OWNER_CHECK_ON_BY_EVENT_TYPE) as Array<
      [NotificationRuleEventType, NotificationRuleConditionCheckOn]
    >,
  )(
    "a %s rule's reads as a sentence, with the people picker and the line that says who counts",
    async (
      eventType: NotificationRuleEventType,
      checkOn: NotificationRuleConditionCheckOn,
    ) => {
      renderRow({
        eventType: eventType,
        condition: condition(checkOn, ConditionType.ContainsAny, []),
      });

      const row: HTMLElement = screen.getByTestId(
        "notification-rule-condition-0",
      );

      expect(
        within(row).getByTestId("notification-rule-condition-field-0"),
      ).toHaveTextContent(checkOn);
      expect(
        within(row).getByTestId("notification-rule-condition-operator-0"),
      ).toHaveTextContent("is any of");
      expect(
        within(row).getByRole("button", { name: "Add owner" }),
      ).toBeInTheDocument();

      // Neither a list of ids nor a box to type them in.
      expect(
        within(row).queryByTestId("notification-rule-condition-value-0"),
      ).toBeNull();
      expect(
        within(row).queryByTestId("notification-rule-condition-text-0"),
      ).toBeNull();

      // Who counts as an owner, said under the picker and read with it.
      const hint: HTMLElement = within(row).getByTestId(
        "notification-rule-condition-hint-0",
      );
      expect(hint).toHaveTextContent(OWNER_CONDITION_HINT);

      const group: HTMLElement = within(row).getByRole("group", {
        name: "Value for condition 1",
      });
      expect(group).toHaveAttribute("aria-describedby", hint.id);

      // How it compares: one of the picks, or none of them.
      await openDropdown(1);
      expect(listedLabels()).toEqual(["is any of", "is none of"]);
    },
  );

  test("picks people and teams from one list, and keeps their ids - people first, then teams", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [],
      ),
    });

    await openPeopleList("Add owner");

    fireEvent.click(peopleOptionNamed("Platform"));
    fireEvent.click(peopleOptionNamed("Jane Doe"));

    expect(lastCondition()).toEqual(
      condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [JANE, PLATFORM],
      ),
    );
    expect(chipNames()).toEqual(["Jane Doe", "PlatformTeam"]);
  });

  test("shows a saved condition's owners by name, its teams as teams, looking each kind up once", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Alert,
      condition: condition(
        NotificationRuleConditionCheckOn.AlertOwners,
        ConditionType.ContainsAny,
        [PLATFORM, JANE],
      ),
    });

    await waitFor(() => {
      expect(chipNames()).toEqual(["Jane Doe", "PlatformTeam"]);
    });

    const requests: Array<any> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0];
      },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0].modelType).toBe(TeamMember);
    expect(requests[0].query.userId.values).toEqual([JANE]);
    expect(requests[1].modelType).toBe(Team);
    expect(requests[1].query._id.values).toEqual([PLATFORM]);
  });

  test("tells a team from a person whatever case its id is stored in", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [PLATFORM.toUpperCase()],
      ),
      teams: [makeTeam(PLATFORM, "Platform")],
    });

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const kinds: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0].modelType;
      },
    );

    // Looked up as a team, never as a person.
    expect(kinds).toEqual([Team]);
  });

  test("a team picked while the form is open is still a team when the row draws again", async () => {
    // The page loaded its teams before this one was made.
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [],
      ),
      teams: [],
    });

    await openPeopleList("Add owner");

    fireEvent.click(peopleOptionNamed("Payments"));
    fireEvent.click(peopleOptionNamed("Sam Lee"));

    expect(lastCondition().value).toEqual([SAM, PAYMENTS_TEAM]);
    expect(chipNames()).toEqual(["Sam Lee", "PaymentsTeam"]);
    expect(
      Array.from(document.querySelectorAll("[data-testid='people-chip']")).map(
        (chip: Element) => {
          return chip.getAttribute("data-kind");
        },
      ),
    ).toEqual([PeoplePickerKind.User, PeoplePickerKind.Team]);
  });

  test("takes an owner out from their chip", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [JANE, PLATFORM],
      ),
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Jane Doe" }),
    );

    expect(lastCondition().value).toEqual([PLATFORM]);
  });

  test("'is none of' compares the same picks the other way", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [JANE],
      ),
    });

    await openDropdown(1);
    await pickOption("is none of");

    expect(lastCondition()).toEqual(
      condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.NotContains,
        [JANE],
      ),
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["Jane Doe"]);
    });
  });

  test("a row switched to an owners field starts with nobody picked, as 'is any of'", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentTitle,
        ConditionType.Contains,
        "database",
      ),
    });

    await openDropdown(0);

    /*
     * A name alone in the list of fields, one a line like the others: who
     * counts as an owner is said under the picker once the field is chosen.
     */
    expect(
      listedOptions().find((option: { label: string }) => {
        return option.label === "Incident Owner";
      }),
    ).toEqual({ label: "Incident Owner" });

    await pickOption("Incident Owner");

    expect(lastCondition()).toEqual(
      condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        undefined,
      ),
    );
    expect(screen.getByRole("button", { name: "Add owner" })).toBeVisible();
    expect(chipNames()).toEqual([]);
  });
});

describe("an on-call rule's policies, picked by name and kept by id (#7554)", () => {
  test("starts on On-Call Policy, offering the project's policies and leaving the archived one out", async () => {
    render(
      <NotificationRuleConditionsElement
        {...lookupProps()}
        teams={PROJECT_TEAMS}
        eventType={NotificationRuleEventType.OnCallDutyPolicy}
        value={[]}
        onChange={(value: Array<NotificationRuleCondition>): void => {
          onChangeSpy(value);
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("radio", {
        name: "Only on-call policies that match conditions",
      }),
    );

    expect(
      screen.getByTestId("notification-rule-condition-field-0"),
    ).toHaveTextContent("On-Call Policy");
    expect(
      screen.getByTestId("notification-rule-condition-operator-0"),
    ).toHaveTextContent("is any of");

    await openDropdown(2);

    expect(listedLabels()).toEqual([
      "Payments Escalation",
      "Search Escalation",
    ]);

    await pickOption("Search Escalation");

    const conditions: Array<NotificationRuleCondition> = onChangeSpy.mock.calls[
      onChangeSpy.mock.calls.length - 1
    ]![0] as Array<NotificationRuleCondition>;

    expect(conditions).toEqual([
      condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [SEARCH_POLICY],
      ),
    ]);
  });

  test("keeps a policy the rule holds that is since archived, marked Archived, until it is taken out", async () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [OLD_POLICY, PAYMENTS_POLICY],
      ),
    });

    expect(pickedValues()).toEqual([
      { name: "Payments Escalation", isArchived: false },
      { name: "Old Escalation", isArchived: true },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Old Escalation" }),
    );

    expect(lastCondition().value).toEqual([PAYMENTS_POLICY]);
    expect(pickedValues()).toEqual([
      { name: "Payments Escalation", isArchived: false },
    ]);

    // Once taken out, it cannot be picked again.
    await openDropdown(2);

    expect(listedLabels()).not.toContain("Old Escalation");
    expect(listedLabels()).toContain("Search Escalation");
  });

  test("says in the list of fields which policy field does what, and nothing under the others", async () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [],
      ),
    });

    await openDropdown(0);

    expect(listedOptions()).toEqual([
      {
        label: "On-Call Policy",
        description:
          "Pick policies from the list. Keeps matching a policy after it is renamed.",
      },
      {
        label: "On-Call Policy Name",
        description:
          "Matches words in a policy's name. To keep matching a policy after it is renamed, use On-Call Policy.",
      },
      { label: "On-Call Policy Description" },
      { label: "On-Call Policy Labels" },
      { label: "On-Call Policy Owner" },
    ]);
  });

  test("a name condition says under its words what keeps matching a renamed policy, read with them", () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ConditionType.EqualTo,
        "Payments Escalation",
      ),
    });

    const hint: HTMLElement = screen.getByTestId(
      "notification-rule-condition-hint-0",
    );

    expect(hint).toHaveTextContent(
      "To keep matching a policy after it is renamed, use On-Call Policy.",
    );
    expect(
      screen.getByRole("textbox", { name: "Value for condition 1" }),
    ).toHaveAttribute("aria-describedby", hint.id);
  });

  test.each([
    [
      NotificationRuleEventType.OnCallDutyPolicy,
      NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      [PAYMENTS_POLICY],
    ],
    [
      NotificationRuleEventType.Incident,
      NotificationRuleConditionCheckOn.IncidentSeverity,
      [CRITICAL],
    ],
  ])(
    "a %s rule's %s condition, picked from a list, has no line under its picks",
    (
      eventType: NotificationRuleEventType,
      checkOn: NotificationRuleConditionCheckOn,
      value: Array<string>,
    ) => {
      renderRow({
        eventType: eventType,
        condition: condition(checkOn, ConditionType.ContainsAny, value),
      });

      expect(
        screen.queryByTestId("notification-rule-condition-hint-0"),
      ).toBeNull();

      // Nothing points the picks at a line that is not there.
      const describedBy: Array<string> = (
        screen
          .getByRole("combobox", { name: "Value for condition 1" })
          .getAttribute("aria-describedby") || ""
      )
        .split(" ")
        .filter((id: string): boolean => {
          return Boolean(id);
        });

      for (const id of describedBy) {
        expect(id).not.toMatch(/-hint$/);
      }
    },
  );

  test("a name condition switched to On-Call Policy starts empty, never carrying the typed name over as an id", async () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ConditionType.EqualTo,
        "Payments Escalation",
      ),
    });

    await openDropdown(0);
    await pickOption("On-Call Policy");

    expect(lastCondition()).toEqual(
      condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        undefined,
      ),
    );
    expect(pickedValues()).toEqual([]);
  });
});

describe("archived values (#7582)", () => {
  test("an archived severity is not offered for a new pick", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentSeverity,
        ConditionType.ContainsAny,
        [],
      ),
    });

    await openDropdown(2);

    expect(listedLabels()).toEqual(["Critical"]);
  });

  test("one the condition holds stays, marked Archived", () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentSeverity,
        ConditionType.ContainsAny,
        [MAJOR, CRITICAL],
      ),
    });

    expect(pickedValues()).toEqual([
      { name: "Critical", isArchived: false },
      { name: "Major", isArchived: true },
    ]);
  });
});

describe("conditions read as one sentence", () => {
  const TWO_CONDITIONS: Array<NotificationRuleCondition> = [
    condition(
      NotificationRuleConditionCheckOn.IncidentOwners,
      ConditionType.ContainsAny,
      [PLATFORM],
    ),
    condition(
      NotificationRuleConditionCheckOn.IncidentTitle,
      ConditionType.Contains,
      "database",
    ),
  ];

  function renderTwo(filterCondition: FilterCondition): RenderResult {
    return render(
      <NotificationRuleConditionsElement
        {...lookupProps()}
        teams={PROJECT_TEAMS}
        eventType={NotificationRuleEventType.Incident}
        value={TWO_CONDITIONS}
        filterCondition={filterCondition}
      />,
    );
  }

  test("the first opens with If, the next with And when all must match", () => {
    renderTwo(FilterCondition.All);

    expect(
      screen.getByTestId("notification-rule-condition-0"),
    ).toHaveTextContent(/^If/);
    expect(
      screen.getByTestId("notification-rule-condition-connector-1"),
    ).toHaveTextContent("And");
    expect(
      screen.queryByTestId("notification-rule-condition-connector-0"),
    ).toBeNull();
  });

  test("and with Or when any one may", () => {
    const { rerender } = renderTwo(FilterCondition.All);

    rerender(
      <NotificationRuleConditionsElement
        {...lookupProps()}
        teams={PROJECT_TEAMS}
        eventType={NotificationRuleEventType.Incident}
        value={TWO_CONDITIONS}
        filterCondition={FilterCondition.Any}
      />,
    );

    expect(
      screen.getByTestId("notification-rule-condition-connector-1"),
    ).toHaveTextContent("Or");
  });
});

describe("the rule's card", () => {
  function renderCard(
    shown: NotificationRuleCondition,
    extra?: { users?: Array<User>; teams?: Array<Team> },
  ): HTMLElement {
    render(
      <NotificationRuleViewConditionElement
        {...lookupProps()}
        notificationRuleCondition={shown}
        users={extra?.users || DIRECTORY.users}
        teams={extra?.teams || PROJECT_TEAMS}
      />,
    );

    return document.body;
  }

  test("names the owners with their avatars, a team as a team, and one no longer in the project said so", () => {
    renderCard(
      condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [PLATFORM, JANE, SAM, GONE_USER],
      ),
    );

    expect(
      screen.getByTestId("notification-rule-condition-operator-words"),
    ).toHaveTextContent("is any of");

    const owners: HTMLElement = screen.getByTestId(
      "notification-rule-condition-owners",
    );

    expect(chipNames(owners)).toEqual([
      "PlatformTeam",
      "Jane Doe",
      "Sam Lee",
      VALUE_NOT_FOUND_NAME,
    ]);

    const chips: Array<Element> = Array.from(
      owners.querySelectorAll("[data-testid='people-chip']"),
    );

    // Jane's own picture; Sam's initials; a team's group avatar.
    expect(chips[1]!.querySelector("img")).toHaveAttribute("alt", "Jane Doe");
    expect(chips[2]!.querySelector("img")).toBeNull();
    expect(chips[2]).toHaveTextContent("SL");
    expect(chips[0]!.getAttribute("data-kind")).toBe(PeoplePickerKind.Team);

    // One gone is said so, quietly, in italics - not dropped.
    expect(chips[3]!.querySelector(".italic")).toHaveTextContent(
      VALUE_NOT_FOUND_NAME,
    );
  });

  test("says 'is none of' for the other way", () => {
    renderCard(
      condition(
        NotificationRuleConditionCheckOn.MonitorOwners,
        ConditionType.NotContains,
        [JANE],
      ),
    );

    expect(screen.getByText("Monitor Owner")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-rule-condition-operator-words"),
    ).toHaveTextContent("is none of");
  });

  test("names the policies picked, marks an archived one, and says when one is gone", () => {
    renderCard(
      condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [DELETED_POLICY, OLD_POLICY, PAYMENTS_POLICY],
      ),
    );

    const named: HTMLElement = screen.getByTestId(
      "notification-rule-condition-named-values",
    );

    expect(named.textContent).toBe(
      `Payments Escalation, Old EscalationArchived, ${VALUE_NOT_FOUND_NAME}`,
    );
    expect(within(named).getAllByTestId("archived-tag")).toHaveLength(1);
    expect(
      within(named).getByTestId("notification-rule-condition-value-not-found"),
    ).toHaveTextContent(VALUE_NOT_FOUND_NAME);

    /*
     * The archived one and its tag are one piece, which a narrow card
     * wraps whole: the tag never starts a line alone, beside the next name.
     */
    const archived: Array<HTMLElement> = within(named).getAllByTestId(
      "notification-rule-condition-archived-value",
    );

    expect(archived).toHaveLength(1);
    expect(archived[0]!.textContent).toBe("Old EscalationArchived");
    expect(archived[0]).toHaveClass("inline-flex");
  });

  test("names each policy once however often the rule holds it, and says nothing is gone when nothing is", () => {
    renderCard(
      condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [PAYMENTS_POLICY, PAYMENTS_POLICY.toUpperCase()],
      ),
    );

    expect(
      screen.getByTestId("notification-rule-condition-named-values")
        .textContent,
    ).toBe("Payments Escalation");
    expect(
      screen.queryByTestId("notification-rule-condition-value-not-found"),
    ).toBeNull();
  });

  test("marks an archived severity the rule holds", () => {
    renderCard(
      condition(
        NotificationRuleConditionCheckOn.IncidentSeverity,
        ConditionType.ContainsAny,
        [MAJOR, CRITICAL],
      ),
    );

    const archived: Array<HTMLElement> = screen.getAllByTestId(
      "notification-rule-condition-archived-value",
    );

    expect(archived).toHaveLength(1);
    expect(archived[0]).toHaveTextContent("Major");
    expect(within(archived[0]!).getByTestId("archived-tag")).toHaveTextContent(
      "Archived",
    );
  });
});

describe("in the reader's language", () => {
  const LANGUAGES: Array<string> = ["de", "ar"];

  function word(language: string, english: string): string {
    const translated: string | undefined = LOCALES[language]![english];

    // Worded in the language, not left in English.
    expect({ language, english, translated }).toEqual({
      language,
      english,
      translated: expect.any(String),
    });
    expect(translated).not.toBe(english);

    return translated as string;
  }

  test.each(LANGUAGES)(
    "an owners condition's row reads in %s",
    async (language: string) => {
      await inLanguage(language);

      renderRow({
        eventType: NotificationRuleEventType.Incident,
        condition: condition(
          NotificationRuleConditionCheckOn.IncidentOwners,
          ConditionType.ContainsAny,
          [],
        ),
      });

      expect(
        screen.getByTestId("notification-rule-condition-field-0"),
      ).toHaveTextContent(word(language, "Incident Owner"));
      expect(
        screen.getByTestId("notification-rule-condition-operator-0"),
      ).toHaveTextContent(word(language, "is any of"));
      expect(
        screen.getByRole("button", { name: word(language, "Add owner") }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("notification-rule-condition-hint-0"),
      ).toHaveTextContent(word(language, OWNER_CONDITION_HINT));
    },
  );

  test.each(LANGUAGES)(
    "an on-call rule's policy field, and the list of fields, read in %s",
    async (language: string) => {
      await inLanguage(language);

      renderRow({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        condition: condition(
          NotificationRuleConditionCheckOn.OnCallDutyPolicies,
          ConditionType.NotContains,
          [PAYMENTS_POLICY],
        ),
      });

      expect(
        screen.getByTestId("notification-rule-condition-field-0"),
      ).toHaveTextContent(word(language, "On-Call Policy"));
      expect(
        screen.getByTestId("notification-rule-condition-operator-0"),
      ).toHaveTextContent(word(language, "is none of"));
      // A policy's name is the team's own, drawn as written.
      expect(pickedValues()).toEqual([
        { name: "Payments Escalation", isArchived: false },
      ]);

      // The two policy fields say which does what, in the language.
      await openDropdown(0);

      expect(listedOptions().slice(0, 2)).toEqual([
        {
          label: word(language, "On-Call Policy"),
          description: word(
            language,
            CONDITION_FIELD_HINTS[
              NotificationRuleConditionCheckOn.OnCallDutyPolicies
            ]!,
          ),
        },
        {
          label: word(language, "On-Call Policy Name"),
          description: word(
            language,
            CONDITION_FIELD_HINTS[
              NotificationRuleConditionCheckOn.OnCallDutyPolicyName
            ]!,
          ),
        },
      ]);
    },
  );

  test.each(LANGUAGES)(
    "a policy name condition's line reads in %s",
    async (language: string) => {
      await inLanguage(language);

      renderRow({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        condition: condition(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
          ConditionType.Contains,
          "Payments",
        ),
      });

      expect(
        screen.getByTestId("notification-rule-condition-hint-0"),
      ).toHaveTextContent(word(language, POLICY_NAME_CONDITION_HINT));
    },
  );

  test.each(LANGUAGES)(
    "the card says in %s that a policy is gone, and which one is archived",
    async (language: string) => {
      await inLanguage(language);

      render(
        <NotificationRuleViewConditionElement
          {...lookupProps()}
          notificationRuleCondition={condition(
            NotificationRuleConditionCheckOn.OnCallDutyPolicies,
            ConditionType.ContainsAny,
            [OLD_POLICY, DELETED_POLICY],
          )}
        />,
      );

      expect(
        screen.getByText(word(language, "On-Call Policy")),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("notification-rule-condition-operator-words"),
      ).toHaveTextContent(word(language, "is any of"));
      expect(screen.getByTestId("archived-tag")).toHaveTextContent(
        word(language, "Archived"),
      );
      expect(
        screen.getByTestId("notification-rule-condition-value-not-found"),
      ).toHaveTextContent(word(language, VALUE_NOT_FOUND_NAME));

      /*
       * Listed with the commas of the words that say a policy is gone: an
       * Arabic line takes the Arabic comma, though the policy is named in
       * English.
       */
      expect(
        screen.getByTestId("notification-rule-condition-named-values")
          .textContent,
      ).toBe(
        `Old Escalation${word(language, "Archived")}${
          language === "ar" ? ARABIC_LIST_SEPARATOR : LIST_SEPARATOR
        }${word(language, VALUE_NOT_FOUND_NAME)}`,
      );
    },
  );

  test.each(LANGUAGES)(
    "the card names in %s an owner no longer in the project",
    async (language: string) => {
      await inLanguage(language);

      render(
        <NotificationRuleViewConditionElement
          {...lookupProps()}
          notificationRuleCondition={condition(
            NotificationRuleConditionCheckOn.SloOwners,
            ConditionType.ContainsAny,
            [GONE_USER, PLATFORM],
          )}
          users={DIRECTORY.users}
          teams={PROJECT_TEAMS}
        />,
      );

      expect(screen.getByText(word(language, "SLO Owner"))).toBeInTheDocument();

      // German says "Team" as English does.
      const teamTag: string = LOCALES[language]!["Team"] || "Team";

      expect(
        chipNames(screen.getByTestId("notification-rule-condition-owners")),
      ).toEqual([word(language, VALUE_NOT_FOUND_NAME), `Platform${teamTag}`]);
    },
  );
});

describe("the helpers the rows are drawn with", () => {
  test("getOwnerPickerValue sorts a condition's ids into people and teams, whatever their case", () => {
    expect(
      getOwnerPickerValue({
        ids: [JANE, PLATFORM.toUpperCase(), SAM, PAYMENTS_TEAM],
        teamIds: new Set([PLATFORM, PAYMENTS_TEAM]),
      }),
    ).toEqual({
      [PeoplePickerKind.User]: [JANE, SAM],
      [PeoplePickerKind.Team]: [PLATFORM.toUpperCase(), PAYMENTS_TEAM],
    });

    expect(getOwnerPickerValue({ ids: [], teamIds: new Set() })).toEqual({
      [PeoplePickerKind.User]: [],
      [PeoplePickerKind.Team]: [],
    });
  });

  test("getOwnerConditionOptions names a team, a person - by email when they have no name - and one gone", () => {
    const noName: User = makeUser({
      id: SAM,
      name: "",
      email: "sam@example.com",
    });

    expect(
      getOwnerConditionOptions({
        ids: [PLATFORM, JANE.toUpperCase(), SAM, GONE_USER],
        users: [DIRECTORY.users[0]!, noName],
        teams: PROJECT_TEAMS,
      }),
    ).toEqual([
      { kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" },
      {
        kind: PeoplePickerKind.User,
        id: JANE.toUpperCase(),
        name: "Jane Doe",
        userId: JANE.toUpperCase(),
        hasProfilePicture: true,
      },
      {
        kind: PeoplePickerKind.User,
        id: SAM,
        name: "sam@example.com",
        userId: SAM,
        hasProfilePicture: false,
      },
      {
        kind: PeoplePickerKind.User,
        id: GONE_USER,
        name: VALUE_NOT_FOUND_NAME,
        isUnknown: true,
      },
    ] as Array<PeoplePickerOption>);
  });

  test("getConditionOperatorWords: one of a record's owners or its policy 'is', its labels and monitors 'have'", () => {
    const words: (
      checkOn: NotificationRuleConditionCheckOn,
      conditionType: ConditionType,
    ) => string = (
      checkOn: NotificationRuleConditionCheckOn,
      conditionType: ConditionType,
    ): string => {
      return getConditionOperatorWords({ checkOn, conditionType });
    };

    for (const checkOn of [
      ...OWNER_CHECK_ONS,
      NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      NotificationRuleConditionCheckOn.IncidentSeverity,
    ]) {
      expect(words(checkOn, ConditionType.ContainsAny)).toBe("is any of");
      expect(words(checkOn, ConditionType.NotContains)).toBe("is none of");
    }

    expect(
      words(
        NotificationRuleConditionCheckOn.IncidentLabels,
        ConditionType.ContainsAny,
      ),
    ).toBe("has any of");
    expect(
      words(
        NotificationRuleConditionCheckOn.Monitors,
        ConditionType.NotContains,
      ),
    ).toBe("has none of");
    expect(
      words(
        NotificationRuleConditionCheckOn.IncidentLabels,
        ConditionType.ContainsAll,
      ),
    ).toBe("has all of");
    expect(
      words(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ConditionType.Contains,
      ),
    ).toBe("contains");
    expect(
      words(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ConditionType.NotContains,
      ),
    ).toBe("does not contain");
    expect(
      getConditionOperatorWords({
        checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
        conditionType: undefined,
      }),
    ).toBe("");
  });

  test("getConditionFieldHint: only the two policy fields have a line in the list of fields", () => {
    expect(Object.keys(CONDITION_FIELD_HINTS).sort()).toEqual(
      [
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      ].sort(),
    );

    for (const checkOn of Object.values(NotificationRuleConditionCheckOn)) {
      expect({ checkOn, hint: getConditionFieldHint(checkOn) }).toEqual({
        checkOn,
        hint: CONDITION_FIELD_HINTS[checkOn],
      });
    }
  });

  test("getConditionValueHint: every owners field says who counts, a policy name what keeps matching, and no other value has a line", () => {
    for (const checkOn of Object.values(NotificationRuleConditionCheckOn)) {
      const expected: string | undefined = OWNER_CHECK_ONS.includes(checkOn)
        ? OWNER_CONDITION_HINT
        : checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicyName
          ? POLICY_NAME_CONDITION_HINT
          : undefined;

      expect({ checkOn, hint: getConditionValueHint(checkOn) }).toEqual({
        checkOn,
        hint: expected,
      });
    }
  });

  test("every owners field is named as the record's owner, in the singular", () => {
    expect(
      OWNER_CHECK_ONS.map((checkOn: NotificationRuleConditionCheckOn) => {
        return getCheckOnLabel(checkOn);
      }),
    ).toEqual([
      "Incident Owner",
      "Alert Owner",
      "Incident Episode Owner",
      "Alert Episode Owner",
      "Scheduled Maintenance Owner",
      "Monitor Owner",
      "On-Call Policy Owner",
      "SLO Owner",
    ]);
  });
});
