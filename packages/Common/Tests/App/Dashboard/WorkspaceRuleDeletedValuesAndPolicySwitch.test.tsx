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
  render,
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
 * A WORKSPACE RULE'S CONDITIONS STEP, WITH VALUES SINCE DELETED (#7807) AND
 * AN ON-CALL POLICY NAME TO SWITCH TO THE POLICIES IT NAMES (#7806).
 *
 * Drawn for real, from the Dashboard's own components and locales:
 *
 *   If  [On-Call Policy]  [is any of]  [(Payments) (Old) Archived
 *                                        (No longer in this project) v]
 *
 *   If  [On-Call Policy Name]  [contains]  [Escalation             ]
 *       To keep matching a policy after it is renamed, use On-Call Policy.
 *       Matches 2 policies now: Payments Escalation, Search Escalation.
 *       Use On-Call Policy instead
 *
 * - A value a condition holds that names nothing now - a policy, a
 *   severity, a label, a monitor, a state, an SLO, a security case's
 *   priority, since deleted - is a chip of its own in every picker kind,
 *   "No longer in this project", in the card's muted italics, removable and
 *   never offered for a new pick. A person who left reads the same, not the
 *   people picker's "Unknown user". The rule's card says the same, once.
 * - Under a name condition, the line says which policies its words match
 *   today, as the server compares them, and the action turns it into an On-
 *   Call Policy condition holding exactly those: is any of for contains and
 *   the others, is none of for does not contain and does not equal.
 *   Archived policies are not picked, and words that name none offer no
 *   switch.
 * - In German and Arabic, from the locales.
 *
 * Only the network is stubbed: the people picker's lookups.
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

import NotificationRuleConditionElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition";
import NotificationRuleConditionsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditions";
import {
  POLICY_NAME_LEAVES_OUT_NONE,
  POLICY_NAME_MATCHES_NONE,
  POLICY_NAME_SWITCH_ACTION,
  VALUE_NOT_FOUND_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditionWords";
import NotificationRuleViewConditionElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewCondition";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import Email from "../../../Types/Email";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Name from "../../../Types/Name";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const JANE: string = "0000000e-0000-4000-8000-000000000001";
const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const GONE_TEAM: string = "0000000b-0000-4000-8000-0000000000ff";

const PAYMENTS_POLICY: string = "0000000c-0000-4000-8000-000000000001";
const SEARCH_POLICY: string = "0000000c-0000-4000-8000-000000000002";
const OLD_POLICY: string = "0000000c-0000-4000-8000-000000000003";
const PRIMARY_POLICY: string = "0000000c-0000-4000-8000-000000000004";
const DELETED_POLICY: string = "0000000c-0000-4000-8000-0000000000ff";

const CRITICAL: string = "0000000d-0000-4000-8000-000000000001";
const DELETED_SEVERITY: string = "0000000d-0000-4000-8000-0000000000ff";

// Any record of any list, deleted.
const DELETED: string = "00000000-dead-4000-8000-0000000000ff";

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

function record<T extends BaseModel>(
  model: T,
  id: string,
  name: string,
  isArchived: boolean = false,
): T {
  model._id = id;
  (model as unknown as { name: string }).name = name;
  (model as unknown as { isArchived: boolean }).isArchived = isArchived;
  (model as unknown as { color: Color }).color = new Color("#2563eb");
  return model;
}

function policy(
  id: string,
  name: string,
  isArchived: boolean = false,
): OnCallDutyPolicy {
  return record(new OnCallDutyPolicy(), id, name, isArchived);
}

const POLICIES: Array<OnCallDutyPolicy> = [
  policy(PAYMENTS_POLICY, "Payments Escalation"),
  policy(SEARCH_POLICY, "Search Escalation"),
  policy(OLD_POLICY, "Old Escalation", true),
  policy(PRIMARY_POLICY, "Primary on-call"),
];

// The project's values, as the rules page loads them (with isArchived).
interface Lists {
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentStates: Array<IncidentState>;
  incidentSeverities: Array<IncidentSeverity>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  monitorStatus: Array<MonitorStatus>;
  securityCasePriorities: Array<SecurityCasePriority>;
  securityCaseStatuses: Array<SecurityCaseStatus>;
  serviceLevelObjectives: Array<ServiceLevelObjective> | undefined;
  onCallDutyPolicies: Array<OnCallDutyPolicy> | undefined;
}

function lists(): Lists {
  return {
    monitors: [
      record(new Monitor(), "0000000f-0000-4000-8000-000000000001", "Checkout"),
    ],
    labels: [
      record(new Label(), "0000000a-0000-4000-8000-000000000001", "Production"),
    ],
    alertStates: [
      record(
        new AlertState(),
        "00000002-0000-4000-8000-000000000001",
        "Firing",
      ),
    ],
    alertSeverities: [
      record(
        new AlertSeverity(),
        "00000003-0000-4000-8000-000000000001",
        "Warning",
      ),
    ],
    incidentStates: [
      record(
        new IncidentState(),
        "00000004-0000-4000-8000-000000000001",
        "Investigating",
      ),
    ],
    incidentSeverities: [record(new IncidentSeverity(), CRITICAL, "Critical")],
    scheduledMaintenanceStates: [
      record(
        new ScheduledMaintenanceState(),
        "00000005-0000-4000-8000-000000000001",
        "Ongoing",
      ),
    ],
    monitorStatus: [
      record(
        new MonitorStatus(),
        "00000006-0000-4000-8000-000000000001",
        "Degraded",
      ),
    ],
    securityCasePriorities: [
      record(
        new SecurityCasePriority(),
        "00000007-0000-4000-8000-000000000001",
        "P1",
      ),
    ],
    securityCaseStatuses: [
      record(
        new SecurityCaseStatus(),
        "00000008-0000-4000-8000-000000000001",
        "Triage",
      ),
    ],
    serviceLevelObjectives: [
      record(
        new ServiceLevelObjective(),
        "00000009-0000-4000-8000-000000000001",
        "Checkout availability",
      ),
    ],
    onCallDutyPolicies: POLICIES,
  };
}

const PROJECT_TEAMS: Array<Team> = [record(new Team(), PLATFORM, "Platform")];

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

// Answers the people picker's look-ups: Jane is a member, nobody else.
function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      rows = [makeUser(JANE, "Jane Doe", "jane@example.com")]
        .filter((user: User): boolean => {
          return (
            !(query.userId instanceof Includes) ||
            (query.userId.values as Array<string>).includes(user._id as string)
          );
        })
        .map((user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        });
    }

    if (request.modelType === Team) {
      rows = PROJECT_TEAMS.filter((team: Team): boolean => {
        return (
          !(query._id instanceof Includes) ||
          (query._id.values as Array<string>).includes(team._id as string)
        );
      });
    }

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

const onChangeSpy: MockFunction = getJestMockFunction();

function renderRow(data: {
  eventType: NotificationRuleEventType;
  condition: NotificationRuleCondition;
  lists?: Partial<Lists> | undefined;
}): void {
  render(
    <ul>
      <NotificationRuleConditionElement
        {...lists()}
        {...(data.lists || {})}
        teams={PROJECT_TEAMS}
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

function renderCard(data: {
  condition: NotificationRuleCondition;
  lists?: Partial<Lists> | undefined;
}): void {
  render(
    <NotificationRuleViewConditionElement
      {...lists()}
      {...(data.lists || {})}
      notificationRuleCondition={data.condition}
      users={[makeUser(JANE, "Jane Doe", "jane@example.com")]}
      teams={PROJECT_TEAMS}
    />,
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

// What the value picker shows as picked, each marked as it is drawn.
function pickedValues(): Array<{
  name: string;
  isArchived: boolean;
  isNotFound: boolean;
}> {
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
        isNotFound: label.getAttribute("data-not-found") === "true",
      };
    });
}

function chipNames(): Array<string> {
  return Array.from(
    document.body.querySelectorAll("[data-testid='people-chip']"),
  ).map((chip: Element): string => {
    const copy: Element = chip.cloneNode(true) as Element;

    copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
      hidden.remove();
    });

    return (copy.textContent || "").trim();
  });
}

async function openValueMenu(): Promise<void> {
  const comboboxes: Array<HTMLElement> = screen.getAllByRole("combobox");

  // 0 = the field, 1 = how it compares, 2 = the value.
  await userEvent.setup().click(comboboxes[2]!);
}

function listedLabels(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement) => {
    const label: Element | null = option.querySelector(
      "[data-testid='dropdown-option-label']",
    );

    return ((label || option).textContent || "").trim();
  });
}

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
    `/dashboard/${PROJECT_ID}/on-call-duty/workspace-connection-slack`,
  );
  serveDirectory();
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

describe("a picked value that was since deleted, on the Conditions step (#7807)", () => {
  test("REGRESSION: a deleted policy is a chip of its own beside the others, in the card's words", () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [PAYMENTS_POLICY, OLD_POLICY, DELETED_POLICY],
      ),
    });

    expect(pickedValues()).toEqual([
      { name: "Payments Escalation", isArchived: false, isNotFound: false },
      { name: "Old Escalation", isArchived: true, isNotFound: false },
      { name: VALUE_NOT_FOUND_NAME, isArchived: false, isNotFound: true },
    ]);

    const notFound: HTMLElement = within(
      screen.getByTestId("notification-rule-condition-value-0"),
    )
      .getAllByTestId("dropdown-value-label")
      .find((label: HTMLElement): boolean => {
        return label.getAttribute("data-not-found") === "true";
      })!;

    // The card's muted italics.
    expect(notFound).toHaveClass("italic");
    expect(notFound).toHaveClass("text-gray-500");
  });

  test("left alone, it is kept: the rule is saved holding it", () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [PAYMENTS_POLICY, DELETED_POLICY],
      ),
    });

    expect(lastCondition().value).toEqual([PAYMENTS_POLICY, DELETED_POLICY]);
  });

  test("taken out, it is dropped from the rule, and is not offered again", async () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [PAYMENTS_POLICY, DELETED_POLICY],
      ),
    });

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: `Remove ${VALUE_NOT_FOUND_NAME}` }),
      );

    expect(lastCondition().value).toEqual([PAYMENTS_POLICY]);
    expect(pickedValues()).toEqual([
      { name: "Payments Escalation", isArchived: false, isNotFound: false },
    ]);

    await openValueMenu();

    expect(listedLabels()).toEqual(["Search Escalation", "Primary on-call"]);
  });

  test("never offered for a pick while it is held", async () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [DELETED_POLICY],
      ),
    });

    await openValueMenu();

    expect(listedLabels()).not.toContain(VALUE_NOT_FOUND_NAME);
  });

  test("a deleted severity, the same", () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentSeverity,
        ConditionType.ContainsAny,
        [CRITICAL, DELETED_SEVERITY],
      ),
    });

    expect(pickedValues()).toEqual([
      { name: "Critical", isArchived: false, isNotFound: false },
      { name: VALUE_NOT_FOUND_NAME, isArchived: false, isNotFound: true },
    ]);
  });

  test("every picker kind of every kind of rule shows one", () => {
    let checked: number = 0;

    for (const eventType of Object.values(NotificationRuleEventType)) {
      for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
        eventType,
      )) {
        if (!NotificationRuleConditionUtil.isRecordValueField(checkOn)) {
          continue;
        }

        renderRow({
          eventType: eventType,
          condition: condition(
            checkOn,
            NotificationRuleConditionUtil.getConditionTypeByCheckOn(
              checkOn,
            )[0]!,
            [DELETED],
          ),
        });

        expect({ eventType, checkOn, picked: pickedValues() }).toEqual({
          eventType,
          checkOn,
          picked: [
            { name: VALUE_NOT_FOUND_NAME, isArchived: false, isNotFound: true },
          ],
        });

        cleanup();
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(25);
  });

  test("a list the page could not read says nothing is gone", () => {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [DELETED_POLICY],
      ),
      lists: { onCallDutyPolicies: undefined },
    });

    expect(pickedValues()).toEqual([]);
    // ...and the rule keeps it.
    expect(lastCondition().value).toEqual([DELETED_POLICY]);
  });

  test("a value of a fixed list is never called gone", () => {
    renderRow({
      eventType: NotificationRuleEventType.Monitor,
      condition: condition(
        NotificationRuleConditionCheckOn.MonitorType,
        ConditionType.ContainsAny,
        [MonitorType.Website, "A type a later version took out"],
      ),
    });

    expect(
      pickedValues().filter((value: { isNotFound: boolean }): boolean => {
        return value.isNotFound;
      }),
    ).toEqual([]);
  });

  test("REGRESSION: a person who left reads as the card says it, not 'Unknown user', and a deleted team too", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [JANE, GONE_USER, PLATFORM, GONE_TEAM],
      ),
    });

    await waitFor(() => {
      expect(chipNames()).toEqual([
        "Jane Doe",
        VALUE_NOT_FOUND_NAME,
        VALUE_NOT_FOUND_NAME,
        "PlatformTeam",
      ]);
    });

    expect(chipNames()).not.toContain("Unknown user");
    expect(chipNames()).not.toContain("Deleted team");
  });

  test("a person who left can be taken out of the condition", async () => {
    renderRow({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentOwners,
        ConditionType.ContainsAny,
        [JANE, GONE_USER],
      ),
    });

    const remove: HTMLElement = await screen.findByRole("button", {
      name: `Remove ${VALUE_NOT_FOUND_NAME}`,
    });

    await userEvent.setup().click(remove);

    expect(lastCondition().value).toEqual([JANE]);
  });

  test.each(["de", "ar"])(
    "in %s, a deleted value's chip reads in the language",
    async (language: string) => {
      await inLanguage(language);

      renderRow({
        eventType: NotificationRuleEventType.Incident,
        condition: condition(
          NotificationRuleConditionCheckOn.IncidentSeverity,
          ConditionType.ContainsAny,
          [CRITICAL, DELETED_SEVERITY],
        ),
      });

      expect(
        pickedValues().map((value: { name: string }): string => {
          return value.name;
        }),
      ).toEqual(["Critical", word(language, VALUE_NOT_FOUND_NAME)]);
    },
  );
});

describe("a picked value that was since deleted, on the rule's card (#7807)", () => {
  test("every picker kind says so once, after the values still there", () => {
    let checked: number = 0;

    for (const eventType of Object.values(NotificationRuleEventType)) {
      for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
        eventType,
      )) {
        if (!NotificationRuleConditionUtil.isRecordValueField(checkOn)) {
          continue;
        }

        renderCard({
          condition: condition(
            checkOn,
            NotificationRuleConditionUtil.getConditionTypeByCheckOn(
              checkOn,
            )[0]!,
            [DELETED, DELETED.toUpperCase()],
          ),
        });

        expect({
          eventType,
          checkOn,
          notFound: screen
            .getAllByTestId("notification-rule-condition-value-not-found")
            .map((element: HTMLElement): string => {
              return element.textContent || "";
            }),
        }).toEqual({ eventType, checkOn, notFound: [VALUE_NOT_FOUND_NAME] });

        cleanup();
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(25);
  });

  test("a severity and a label the project still has are named, and the gone one after them", () => {
    renderCard({
      condition: condition(
        NotificationRuleConditionCheckOn.IncidentSeverity,
        ConditionType.ContainsAny,
        [CRITICAL, DELETED_SEVERITY],
      ),
    });

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-rule-condition-value-not-found"),
    ).toHaveTextContent(VALUE_NOT_FOUND_NAME);
  });

  test("nothing is said gone while every value is there, or the list was not read", () => {
    renderCard({
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [PAYMENTS_POLICY],
      ),
    });

    expect(
      screen.queryByTestId("notification-rule-condition-value-not-found"),
    ).toBeNull();

    cleanup();

    renderCard({
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        ConditionType.ContainsAny,
        [DELETED_POLICY],
      ),
      lists: { onCallDutyPolicies: undefined },
    });

    expect(
      screen.queryByTestId("notification-rule-condition-value-not-found"),
    ).toBeNull();
  });
});

describe("switching an On-Call Policy Name condition to the policies it names (#7806)", () => {
  function nameRow(
    conditionType: ConditionType,
    words: string,
    extra?: Partial<Lists> | undefined,
  ): void {
    renderRow({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        conditionType,
        words,
      ),
      lists: extra,
    });
  }

  function matchLine(): HTMLElement | null {
    return screen.queryByTestId(
      "notification-rule-condition-policy-name-matches-0",
    );
  }

  function switchButton(): HTMLElement | null {
    return screen.queryByTestId("notification-rule-condition-use-policy-0");
  }

  test("REGRESSION: shows the policies the words match now, and switches to them in one step", async () => {
    nameRow(ConditionType.Contains, "Escalation");

    // The archived Old Escalation matches too, and is left out.
    expect(matchLine()).toHaveTextContent(
      "Matches 2 policies now: Payments Escalation, Search Escalation.",
    );
    expect(switchButton()).toHaveTextContent(POLICY_NAME_SWITCH_ACTION);

    await userEvent.setup().click(switchButton()!);

    expect(lastCondition()).toEqual({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: ConditionType.ContainsAny,
      value: [PAYMENTS_POLICY, SEARCH_POLICY],
    });

    // The row now reads as the picker it is, the policies picked.
    expect(
      screen.getByTestId("notification-rule-condition-field-0"),
    ).toHaveTextContent("On-Call Policy");
    expect(
      screen.getByTestId("notification-rule-condition-operator-0"),
    ).toHaveTextContent("is any of");
    expect(pickedValues()).toEqual([
      { name: "Payments Escalation", isArchived: false, isNotFound: false },
      { name: "Search Escalation", isArchived: false, isNotFound: false },
    ]);
    expect(matchLine()).toBeNull();
    expect(switchButton()).toBeNull();

    // The picker takes the focus the button had.
    expect(
      screen.getByRole("combobox", { name: "Value for condition 1" }),
    ).toHaveFocus();
  });

  test("one policy is named in the singular", () => {
    nameRow(ConditionType.EqualTo, "Primary on-call");

    expect(matchLine()).toHaveTextContent(
      "Matches 1 policy now: Primary on-call.",
    );
  });

  test("does not contain is switched to is none of the policies it leaves out", async () => {
    nameRow(ConditionType.NotContains, "Escalation");

    expect(matchLine()).toHaveTextContent(
      "Leaves out 2 policies now: Payments Escalation, Search Escalation.",
    );

    await userEvent.setup().click(switchButton()!);

    expect(lastCondition()).toEqual({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: ConditionType.NotContains,
      value: [PAYMENTS_POLICY, SEARCH_POLICY],
    });
    expect(
      screen.getByTestId("notification-rule-condition-operator-0"),
    ).toHaveTextContent("is none of");
  });

  test("letter case counts, as on the server: words that match no policy say so, and offer no switch", () => {
    nameRow(ConditionType.Contains, "escalation");

    expect(matchLine()).toHaveTextContent(POLICY_NAME_MATCHES_NONE);
    expect(switchButton()).toBeNull();

    cleanup();

    nameRow(ConditionType.NotEqualTo, "Payments");

    expect(matchLine()).toHaveTextContent(POLICY_NAME_LEAVES_OUT_NONE);
    expect(switchButton()).toBeNull();
  });

  test("an archived policy the words match alone is not picked", () => {
    nameRow(ConditionType.StartsWith, "Old");

    expect(matchLine()).toHaveTextContent(POLICY_NAME_MATCHES_NONE);
    expect(switchButton()).toBeNull();
  });

  test("many policies: the first few by name, and how many more", () => {
    const many: Array<OnCallDutyPolicy> = Array.from(
      { length: 7 },
      (_: unknown, index: number): OnCallDutyPolicy => {
        return policy(
          `0000000c-0000-4000-8000-00000000010${index}`,
          `Team ${index + 1} Escalation`,
        );
      },
    );

    nameRow(ConditionType.EndsWith, "Escalation", {
      onCallDutyPolicies: many,
    });

    expect(matchLine()).toHaveTextContent(
      "Matches 7 policies now: Team 1 Escalation, Team 2 Escalation, Team 3 Escalation, Team 4 Escalation, Team 5 Escalation and 2 more.",
    );
  });

  test("nothing is said while the words are empty, or when the policies could not be read", () => {
    nameRow(ConditionType.Contains, "");

    expect(matchLine()).toBeNull();
    expect(
      screen.getByTestId("notification-rule-condition-hint-0"),
    ).toBeInTheDocument();

    cleanup();

    nameRow(ConditionType.Contains, "Escalation", {
      onCallDutyPolicies: undefined,
    });

    expect(matchLine()).toBeNull();
    expect(switchButton()).toBeNull();
  });

  test("the line follows the words as they are typed", async () => {
    nameRow(ConditionType.Contains, "Pay");

    expect(matchLine()).toHaveTextContent(
      "Matches 1 policy now: Payments Escalation.",
    );

    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: "Value for condition 1" }),
        "x",
      );

    expect(matchLine()).toHaveTextContent(POLICY_NAME_MATCHES_NONE);
  });

  test("the switch replaces the condition where it stands, and leaves the others as they are", async () => {
    const changes: Array<Array<NotificationRuleCondition>> = [];
    const severity: NotificationRuleCondition = condition(
      NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      ConditionType.ContainsAny,
      ["0000000a-0000-4000-8000-000000000001"],
    );

    render(
      <NotificationRuleConditionsElement
        {...lists()}
        teams={PROJECT_TEAMS}
        eventType={NotificationRuleEventType.OnCallDutyPolicy}
        filterCondition={FilterCondition.All}
        value={[
          severity,
          condition(
            NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            ConditionType.Contains,
            "Payments",
          ),
        ]}
        onChange={(value: Array<NotificationRuleCondition>): void => {
          changes.push(value);
        }}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByTestId("notification-rule-condition-use-policy-1"));

    expect(changes[changes.length - 1]).toEqual([
      severity,
      {
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        conditionType: ConditionType.ContainsAny,
        value: [PAYMENTS_POLICY],
      },
    ]);
  });

  test("the words are read with the line that says what they match", () => {
    nameRow(ConditionType.Contains, "Escalation");

    const input: HTMLElement = screen.getByRole("textbox", {
      name: "Value for condition 1",
    });

    expect(input).toHaveAccessibleDescription(
      "To keep matching a policy after it is renamed, use On-Call Policy. Matches 2 policies now: Payments Escalation, Search Escalation.",
    );
  });

  test.each(["de", "ar"])(
    "in %s, the line and the action read in the language",
    async (language: string) => {
      await inLanguage(language);

      nameRow(ConditionType.Contains, "Escalation");

      const line: string = matchLine()?.textContent || "";

      // The sentence is the locale's, around the names as written.
      for (const name of ["Payments Escalation", "Search Escalation"]) {
        expect(line).toContain(name);
      }
      expect(line).not.toContain("Matches");
      expect(switchButton()).toHaveTextContent(
        word(language, POLICY_NAME_SWITCH_ACTION),
      );

      cleanup();

      nameRow(ConditionType.Contains, "Nothing");

      expect(matchLine()).toHaveTextContent(
        word(language, POLICY_NAME_MATCHES_NONE),
      );
    },
  );
});
