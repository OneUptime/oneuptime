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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import NotificationRuleConditionFormElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCondition";
import { VALUE_NOT_FOUND_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditionWords";
import NotificationRuleViewCondition from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewCondition";
import { NotificationRuleThen } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewElement";
import {
  createHeldRuleRecordCache,
  getHeldRuleIds,
  getHeldRuleRecords,
  HeldRuleRecordCache,
  HeldRuleRecords,
  readHeldRuleRecords,
  RuleInvitees,
  useRuleInvitees,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceRuleHeldRecords";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { INLINE_VALUE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/InlineValueSkeleton";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A WORKSPACE RULE'S LABELS, SLOS, ON-CALL POLICIES AND OWNERS, AND WHO IT
 * INVITES, FOUND AND KEPT HOWEVER MANY THE PROJECT HAS (#10689).
 *
 * The rules and summaries pages read the project's first 10,000 labels,
 * SLOs, policies and teams by name - and its first 10,000 team
 * memberships, unsorted - to offer them in a condition and to name what a
 * rule holds. One past them could not be picked, a rule holding one read
 * "No longer in this project" on its card and in its form, a team past
 * them was taken for a person who left, and an On-Call Policy Name
 * condition's switch never named a policy past them.
 *
 * Each condition searches the server now (RecordConditionPicker) and names
 * what it holds by its ids; the switch searches the words; the cards and
 * the summary name what the shown rules hold, read by their ids
 * (WorkspaceRuleHeldRecords). ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// Past the 10,000th of each kind: the one held, one to find, one archived.
const LATE_ID: string = "b0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "b0000000-0000-4000-8000-0000000000ab";
const ARCHIVED_ID: string = "b0000000-0000-4000-8000-0000000000ac";
const DELETED_ID: string = "b0000000-0000-4000-8000-0000000000dd";

const LATE_TEAM_ID: string = "c0000000-0000-4000-8000-0000000000aa";
const LATE_USER_ID: string = "d0000000-0000-4000-8000-0000000000aa";
const GONE_USER_ID: string = "d0000000-0000-4000-8000-0000000000dd";
const LATE_SCHEDULE_ID: string = "e0000000-0000-4000-8000-0000000000aa";

const RECORDS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;
let onChange: MockFunction;

const lateUser: () => User = (): User => {
  const user: User = new User();
  user._id = LATE_USER_ID;
  user.name = new Name("Wanda Bell");
  user.email = new Email("wanda@example.com");
  return user;
};

// The project: more of each kind than a page ever read, then the late ones.
const fillProject: () => void = (): void => {
  for (const modelType of [Label, ServiceLevelObjective, OnCallDutyPolicy]) {
    server.add(
      modelType as { new (): BaseModel },
      namesSortingFirst(RECORDS_BEFORE_WB).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
    server.add(modelType as { new (): BaseModel }, [
      { _id: LATE_ID, name: "WB1500KSK02", isArchived: false },
      { _id: OTHER_LATE_ID, name: "WB1500KSK03", isArchived: false },
      { _id: ARCHIVED_ID, name: "WB1500KSK09", isArchived: true },
    ]);
  }

  server.add(
    Team,
    namesSortingFirst(RECORDS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Team, [{ _id: LATE_TEAM_ID, name: "WB1500KSK02 Team" }]);

  // Every membership of the project's people before the late one's.
  server.add(
    TeamMember,
    namesSortingFirst(RECORDS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        const id: string = ObjectID.generate().toString();
        return {
          _id: ObjectID.generate().toString(),
          userId: id,
          user: { _id: id, name: name },
        };
      },
    ),
  );
  server.add(TeamMember, [
    {
      _id: ObjectID.generate().toString(),
      userId: LATE_USER_ID,
      user: lateUser(),
    },
  ]);

  server.add(OnCallDutyPolicySchedule, [
    { _id: LATE_SCHEDULE_ID, name: "WB1500KSK02 Schedule" },
  ]);
};

// Filled once: no test changes a row.
beforeAll(() => {
  server = new CappedListServer();
  fillProject();
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const condition: (
  checkOn: NotificationRuleConditionCheckOn,
  value: Array<string> | string,
  conditionType?: ConditionType,
) => NotificationRuleCondition = (
  checkOn: NotificationRuleConditionCheckOn,
  value: Array<string> | string,
  conditionType?: ConditionType,
): NotificationRuleCondition => {
  return {
    checkOn: checkOn,
    conditionType: conditionType || ConditionType.ContainsAny,
    value: value,
  };
};

async function renderCondition(data: {
  eventType: NotificationRuleEventType;
  condition: NotificationRuleCondition;
}): Promise<void> {
  await act(async () => {
    render(
      <ul>
        <NotificationRuleConditionFormElement
          initialValue={data.condition}
          onChange={(value: NotificationRuleCondition) => {
            onChange(value);
          }}
          eventType={data.eventType}
          index={0}
          alertStates={[]}
          alertSeverities={[]}
          incidentSeverities={[]}
          incidentStates={[]}
          scheduledMaintenanceStates={[]}
          monitorStatus={[]}
        />
      </ul>,
    );
  });
}

function valueCell(): HTMLElement {
  return screen.getByTestId("notification-rule-condition-value-0");
}

function picker(): HTMLElement {
  return within(valueCell()).getByRole("combobox");
}

function chips(): Array<string> {
  return within(valueCell())
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

// The condition as last reported.
function lastCondition(): NotificationRuleCondition | undefined {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
    | NotificationRuleCondition
    | undefined;
}

// Every read of a kind was of the ids a condition holds, never the kind whole.
function expectOnlyReadByIdOrSearched(modelType: { new (): BaseModel }): void {
  for (const call of server.callsFor(modelType)) {
    expect(
      call.query["_id"] instanceof Includes ||
        call.query["name"] instanceof Search,
    ).toBe(true);
  }
}

async function searchFor(text: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(picker());
    fireEvent.change(picker(), { target: { value: text } });
  });
}

// The searches asked of the server for a kind, by name.
function searches(modelType: {
  new (): BaseModel;
}): Array<Record<string, unknown>> {
  return server
    .callsFor(modelType)
    .map((call: { query: Record<string, unknown> }) => {
      return call.query;
    })
    .filter((query: Record<string, unknown>): boolean => {
      return query["name"] instanceof Search;
    });
}

/*
 * Labels, SLOs and policies: each condition searches the server, never
 * offers an archived value, and names what it holds by its ids.
 */
const RECORD_CONDITIONS: Array<{
  kind: string;
  modelType: { new (): BaseModel };
  eventType: NotificationRuleEventType;
  checkOn: NotificationRuleConditionCheckOn;
}> = [
  {
    kind: "an incident rule's labels",
    modelType: Label,
    eventType: NotificationRuleEventType.Incident,
    checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
  },
  {
    kind: "an SLO rule's SLOs",
    modelType: ServiceLevelObjective,
    eventType: NotificationRuleEventType.ServiceLevelObjective,
    checkOn: NotificationRuleConditionCheckOn.Slos,
  },
  {
    kind: "an on-call rule's policies",
    modelType: OnCallDutyPolicy,
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
  },
];

describe.each(RECORD_CONDITIONS)(
  "$kind, on the Conditions step",
  (data: {
    kind: string;
    modelType: { new (): BaseModel };
    eventType: NotificationRuleEventType;
    checkOn: NotificationRuleConditionCheckOn;
  }) => {
    test("names one past the 10,000th that the condition holds, read by its id", async () => {
      await renderCondition({
        eventType: data.eventType,
        condition: condition(data.checkOn, [LATE_ID]),
      });

      await waitFor(() => {
        expect(chips()).toEqual(["WB1500KSK02"]);
      });

      // Read by its id: never the project's whole list.
      expect(server.callsFor(data.modelType).length).toBeGreaterThan(0);
      for (const call of server.callsFor(data.modelType)) {
        expect(call.query["_id"]).toBeInstanceOf(Includes);
      }
    });

    test("finds one past the 10,000th by its name, never offers an archived one, and keeps the one held beside it", async () => {
      await renderCondition({
        eventType: data.eventType,
        condition: condition(data.checkOn, [LATE_ID]),
      });

      await waitFor(() => {
        expect(chips()).toEqual(["WB1500KSK02"]);
      });

      await searchFor("WB1500KSK0");

      const option: HTMLElement = await screen.findByRole("option", {
        name: /WB1500KSK03/,
      });

      // Asked of the server, by name, archived ones left out.
      const search: Record<string, unknown> | undefined = searches(
        data.modelType,
      ).pop();

      expect((search?.["name"] as Search<string>).toString()).toBe(
        "WB1500KSK0",
      );
      expect(search?.["isArchived"]).toBe(false);
      expect(
        screen.queryByRole("option", { name: /WB1500KSK09/ }),
      ).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(option);
      });

      // Saved with both: the one held is never dropped by the pick.
      expect(lastCondition()?.value).toEqual([LATE_ID, OTHER_LATE_ID]);
      expect(chips()).toEqual(["WB1500KSK02", "WB1500KSK03"]);
    });

    test("an archived one the condition holds stays, marked Archived", async () => {
      await renderCondition({
        eventType: data.eventType,
        condition: condition(data.checkOn, [ARCHIVED_ID]),
      });

      await waitFor(() => {
        expect(chips()).toEqual(["WB1500KSK09"]);
      });
      expect(
        within(valueCell()).getByTestId("entity-dropdown-archived-tag"),
      ).toBeInTheDocument();
    });

    test("one deleted since reads No longer in this project, kept until it is taken out", async () => {
      await renderCondition({
        eventType: data.eventType,
        condition: condition(data.checkOn, [DELETED_ID, LATE_ID]),
      });

      await waitFor(() => {
        expect(chips()).toEqual([VALUE_NOT_FOUND_NAME, "WB1500KSK02"]);
      });

      // Drawing it changes nothing: the rule keeps it as it was saved.
      for (const [value] of onChange.mock.calls as Array<
        [NotificationRuleCondition]
      >) {
        expect(value.value).toEqual([DELETED_ID, LATE_ID]);
      }

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: `Remove ${VALUE_NOT_FOUND_NAME}`,
          }),
        );
      });

      expect(lastCondition()?.value).toEqual([LATE_ID]);
    });
  },
);

describe("an On-Call Policy Name condition's switch to the policies it names", () => {
  test("names a policy past the 10,000th, searched by its words, and switches to it", async () => {
    await renderCondition({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        "WB1500KSK0",
        ConditionType.Contains,
      ),
    });

    const line: HTMLElement = await screen.findByTestId(
      "notification-rule-condition-policy-name-matches-0",
    );

    // The archived one is not named: it is never picked.
    expect(line).toHaveTextContent("WB1500KSK02");
    expect(line).toHaveTextContent("WB1500KSK03");
    expect(line).not.toHaveTextContent("WB1500KSK09");

    // The words, asked of the server: never the project's policies whole.
    expectOnlyReadByIdOrSearched(OnCallDutyPolicy);
    expect(
      (
        searches(OnCallDutyPolicy)[0]?.["name"] as Search<string> | undefined
      )?.toString(),
    ).toBe("WB1500KSK0");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("notification-rule-condition-use-policy-0"),
      );
    });

    expect(lastCondition()).toEqual({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: ConditionType.ContainsAny,
      value: [LATE_ID, OTHER_LATE_ID],
    });

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK02", "WB1500KSK03"]);
    });
  });

  test("words that name no policy offer no switch", async () => {
    await renderCondition({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      condition: condition(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        "Nothing is named this",
        ConditionType.Contains,
      ),
    });

    await screen.findByTestId(
      "notification-rule-condition-policy-name-matches-0",
    );

    expect(
      screen.queryByTestId("notification-rule-condition-use-policy-0"),
    ).not.toBeInTheDocument();
  });
});

describe("an owners condition", () => {
  // The people picker's chips, without what only a screen reader hears.
  function peopleChips(): Array<string> {
    return Array.from(
      document.body.querySelectorAll("[data-testid='people-chip']"),
    ).map((chip: Element): string => {
      const copy: Element = chip.cloneNode(true) as Element;

      copy
        .querySelectorAll('[aria-hidden="true"]')
        .forEach((hidden: Element) => {
          hidden.remove();
        });

      return (copy.textContent || "").trim();
    });
  }

  test("draws a team past the 10,000th as the team, and a person whose membership is past the first 10,000 by name", async () => {
    await renderCondition({
      eventType: NotificationRuleEventType.Incident,
      condition: condition(NotificationRuleConditionCheckOn.IncidentOwners, [
        LATE_USER_ID,
        LATE_TEAM_ID,
        GONE_USER_ID,
      ]),
    });

    await waitFor(() => {
      expect(peopleChips()).toEqual([
        "Wanda Bell",
        VALUE_NOT_FOUND_NAME,
        expect.stringContaining("WB1500KSK02 Team"),
      ]);
    });

    // Teams read by the ids the condition holds, never the project's whole.
    for (const call of server.callsFor(Team)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }

    // Drawing it changes nothing: the condition keeps all three.
    for (const [value] of onChange.mock.calls as Array<
      [NotificationRuleCondition]
    >) {
      expect(value.value).toEqual([LATE_USER_ID, LATE_TEAM_ID, GONE_USER_ID]);
    }
  });
});

// A rule as the rules page lists it.
const ruleHolding: (rule: Partial<IncidentNotificationRule>) => {
  notificationRule: Partial<IncidentNotificationRule>;
} = (
  rule: Partial<IncidentNotificationRule>,
): { notificationRule: Partial<IncidentNotificationRule> } => {
  return { notificationRule: rule };
};

const SHOWN_RULES: Array<{
  notificationRule: Partial<IncidentNotificationRule>;
}> = [
  ruleHolding({
    filters: [
      condition(NotificationRuleConditionCheckOn.IncidentLabels, [
        LATE_ID,
        DELETED_ID,
      ]),
      condition(NotificationRuleConditionCheckOn.IncidentOwners, [
        LATE_TEAM_ID,
        LATE_USER_ID,
        GONE_USER_ID,
      ]),
    ],
    inviteUsersToNewChannel: [new ObjectID(LATE_USER_ID)],
  }),
  ruleHolding({
    filters: [
      condition(NotificationRuleConditionCheckOn.OnCallDutyPolicies, [
        ARCHIVED_ID,
      ]),
    ],
    inviteOnCallSchedulesToNewChannel: [new ObjectID(LATE_SCHEDULE_ID)],
  } as Partial<IncidentNotificationRule>),
];

async function readShownRules(
  cache: HeldRuleRecordCache,
): Promise<HeldRuleRecords> {
  await readHeldRuleRecords({
    projectId: new ObjectID(PROJECT_ID),
    ids: getHeldRuleIds(SHOWN_RULES),
    cache: cache,
  });

  return getHeldRuleRecords({ ids: getHeldRuleIds(SHOWN_RULES), cache });
}

function names(records: Array<BaseModel> | undefined): Array<string> {
  return (records || []).map((record: BaseModel): string => {
    return String((record as unknown as { name?: unknown }).name || "");
  });
}

describe("the rules page's cards, named from what the shown rules hold", () => {
  test("each kind is read by the ids the rules hold, past the 10,000th, and once", async () => {
    const cache: HeldRuleRecordCache = createHeldRuleRecordCache();

    // Nothing named, and nothing said to be gone, before the read.
    const before: HeldRuleRecords = getHeldRuleRecords({
      ids: getHeldRuleIds(SHOWN_RULES),
      cache,
    });
    expect(before.labels).toBeUndefined();
    expect(before.teams).toBeUndefined();
    expect(before.users).toBeUndefined();
    expect(before.onCallSchedules).toBeUndefined();
    // A kind no shown rule holds has nothing to name.
    expect(before.serviceLevelObjectives).toEqual([]);

    const read: HeldRuleRecords = await readShownRules(cache);

    expect(names(read.labels)).toEqual(["WB1500KSK02"]);
    expect(names(read.onCallDutyPolicies)).toEqual(["WB1500KSK09"]);
    expect(names(read.teams)).toEqual(["WB1500KSK02 Team"]);
    expect(
      (read.users || []).map((user: User): string => {
        return user.name?.toString() || "";
      }),
    ).toEqual(["Wanda Bell"]);
    expect(names(read.onCallSchedules)).toEqual(["WB1500KSK02 Schedule"]);

    // By ids only: never a kind whole.
    for (const modelType of [Label, OnCallDutyPolicy, Team]) {
      for (const call of server.callsFor(modelType)) {
        expect(call.query["_id"]).toBeInstanceOf(Includes);
      }
    }
    for (const call of server.callsFor(TeamMember)) {
      expect(call.query["userId"]).toBeInstanceOf(Includes);
    }

    // Read again - the next page holds the same - and nothing is asked twice.
    const calls: number = server.calls.length;
    await readShownRules(cache);
    expect(server.calls.length).toBe(calls);
  });

  test("a kind that cannot be read names nothing, and says nothing is gone", async () => {
    getJestSpyOn(ModelAPI, "getList").mockImplementation((async (
      options: Parameters<typeof ModelAPI.getList>[0],
    ) => {
      if (options.modelType === Label) {
        throw new Error("Refused");
      }

      return server.list(options as never);
    }) as never);

    const read: HeldRuleRecords = await readShownRules(
      createHeldRuleRecordCache(),
    );

    expect(read.labels).toBeUndefined();
    // The others are named still.
    expect(names(read.teams)).toEqual(["WB1500KSK02 Team"]);
  });

  const renderCard: (data: {
    condition: NotificationRuleCondition;
    records: HeldRuleRecords;
    isNamingValues?: boolean;
  }) => void = (data: {
    condition: NotificationRuleCondition;
    records: HeldRuleRecords;
    isNamingValues?: boolean;
  }): void => {
    render(
      <MemoryRouter>
        <NotificationRuleViewCondition
          notificationRuleCondition={data.condition}
          labels={data.records.labels}
          onCallDutyPolicies={data.records.onCallDutyPolicies}
          users={data.records.users}
          teams={data.records.teams}
          alertStates={[]}
          alertSeverities={[]}
          incidentSeverities={[]}
          incidentStates={[]}
          scheduledMaintenanceStates={[]}
          monitorStatus={[]}
          isNamingValues={data.isNamingValues}
        />
      </MemoryRouter>,
    );
  };

  test("a card names its rule's label past the 10,000th, and says the deleted one is gone", async () => {
    const read: HeldRuleRecords = await readShownRules(
      createHeldRuleRecordCache(),
    );

    renderCard({
      condition: SHOWN_RULES[0]!.notificationRule.filters![0]!,
      records: read,
    });

    expect(screen.getByText("WB1500KSK02")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-rule-condition-value-not-found"),
    ).toHaveTextContent(VALUE_NOT_FOUND_NAME);
  });

  test("a card names its rule's team past the 10,000th as the team, and its person by name", async () => {
    const read: HeldRuleRecords = await readShownRules(
      createHeldRuleRecordCache(),
    );

    renderCard({
      condition: SHOWN_RULES[0]!.notificationRule.filters![1]!,
      records: read,
    });

    const owners: HTMLElement = screen.getByTestId(
      "notification-rule-condition-owners",
    );

    expect(owners).toHaveTextContent("WB1500KSK02 Team");
    expect(owners).toHaveTextContent("Wanda Bell");
    // Only the person who left is said to be gone.
    expect(within(owners).getAllByText(VALUE_NOT_FOUND_NAME)).toHaveLength(1);
  });

  test("while its values are read, a card draws a placeholder and says nothing is gone", () => {
    for (const filter of SHOWN_RULES[0]!.notificationRule.filters!) {
      renderCard({ condition: filter, records: {}, isNamingValues: true });

      expect(
        screen.getByTestId("notification-rule-condition-value-loading"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(INLINE_VALUE_SKELETON_TEST_ID),
      ).toBeInTheDocument();
      expect(screen.queryByText(VALUE_NOT_FOUND_NAME)).not.toBeInTheDocument();

      cleanup();
    }
  });

  test("once a read failed, a card says nothing is gone", () => {
    for (const filter of SHOWN_RULES[0]!.notificationRule.filters!) {
      renderCard({ condition: filter, records: {}, isNamingValues: false });

      expect(
        screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(VALUE_NOT_FOUND_NAME)).not.toBeInTheDocument();

      cleanup();
    }
  });
});

describe("who a rule invites to its channel, in its summary", () => {
  const renderThen: (data: {
    records: HeldRuleRecords;
    isNamingValues: boolean;
  }) => void = (data: {
    records: HeldRuleRecords;
    isNamingValues: boolean;
  }): void => {
    render(
      <MemoryRouter>
        <NotificationRuleThen
          rule={
            {
              shouldCreateNewChannel: true,
              newChannelTemplateName: "inc-",
              inviteUsersToNewChannel: [new ObjectID(LATE_USER_ID)],
            } as unknown as IncidentNotificationRule
          }
          eventType={NotificationRuleEventType.Incident}
          workspaceType={WorkspaceType.Slack}
          users={data.records.users}
          teams={data.records.teams}
          onCallSchedules={data.records.onCallSchedules}
          isNamingValues={data.isNamingValues}
        />
      </MemoryRouter>,
    );
  };

  test("names a person whose membership is past the first 10,000", async () => {
    const read: HeldRuleRecords = await readShownRules(
      createHeldRuleRecordCache(),
    );

    renderThen({ records: read, isNamingValues: false });

    expect(screen.getByTestId("notification-rule-summary")).toHaveTextContent(
      "Wanda Bell",
    );
  });

  test("while they are read, draws a placeholder rather than inviting nobody", () => {
    renderThen({ records: {}, isNamingValues: true });

    expect(
      screen.getByTestId("notification-rule-summary-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-rule-summary"),
    ).not.toBeInTheDocument();
  });

  test("the rule's form names one the page has not, read by its id", async () => {
    const Names: () => ReactElement = (): ReactElement => {
      const invitees: RuleInvitees = useRuleInvitees({
        rule: SHOWN_RULES[1]!.notificationRule,
        users: [],
        teams: [],
        onCallSchedules: [],
      });

      return (
        <span data-testid="invitee-names">
          {names(invitees.onCallSchedules).join(", ")}
        </span>
      );
    };

    render(<Names />);

    await waitFor(() => {
      expect(screen.getByTestId("invitee-names")).toHaveTextContent(
        "WB1500KSK02 Schedule",
      );
    });

    for (const call of server.callsFor(OnCallDutyPolicySchedule)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }
  });
});
