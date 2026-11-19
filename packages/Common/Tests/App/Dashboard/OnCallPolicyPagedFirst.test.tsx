import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHO EACH POLICY PAGES FIRST, ON THE ON-CALL POLICIES LIST (#9701).
 *
 * The list's Paged First column (Components/OnCallPolicy/PagedFirst):
 *
 *   - its reads: the page's policies' escalation rules, then the people,
 *     teams and schedules of each policy's first rule, then who is on call
 *     in those schedules - in the request's project, each narrowed to the
 *     page's policies and their first rules, with the reader's own
 *     permissions (ModelAPI);
 *   - its cell: a chip per responder, a schedule with who it pages now -
 *     amber when nobody is on call - three chips, then "+N more" naming the
 *     rest; the break named in amber where the policy pages nobody; the
 *     line it will take while it loads, and the quiet dash when it could not
 *     be read;
 *   - its export: the names the cell shows;
 *   - each in the reader's language, the names as the project wrote them.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

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

import PagedFirstCell, {
  NO_ESCALATION_RULES_TEXT,
  NO_ESCALATION_RULES_TOOLTIP,
  NO_ONE_ON_CALL_TEXT,
  NO_RESPONDERS_TEXT,
  NO_RESPONDERS_TOOLTIP,
  ON_CALL_NOW_TOOLTIP,
  PAGED_FIRST_COLUMN_TITLE,
  PagedFirstChip,
  getPagedFirstChip,
  getPagedFirstExportText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PagedFirst/PagedFirstCell";
import { readPagedFirstOfPolicies } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PagedFirst/UsePagedFirst";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Includes from "../../../Types/BaseDatabase/Includes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  PagedFirst,
  PagedFirstKind,
  PagedFirstResponder,
  PagedFirstResponderKind,
} from "../../../Types/OnCallDutyPolicy/PagedFirst";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import { INLINE_VALUE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/InlineValueSkeleton";
import { TABLE_VALUE_LOADING_ATTRIBUTE } from "../../../UI/Components/Table/TableFoldedValues";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const POLICY_PAYMENTS: string = "aaaaaaaa-0000-4000-8000-000000000001";
const POLICY_EMPTY: string = "aaaaaaaa-0000-4000-8000-000000000002";
const POLICY_SILENT: string = "aaaaaaaa-0000-4000-8000-000000000003";

const RULE_PAYMENTS_1: string = "bbbbbbbb-0000-4000-8000-000000000001";
const RULE_PAYMENTS_2: string = "bbbbbbbb-0000-4000-8000-000000000002";
const RULE_SILENT_1: string = "bbbbbbbb-0000-4000-8000-000000000003";

const SCHEDULE_PRIMARY: string = "cccccccc-0000-4000-8000-000000000001";
const SCHEDULE_NIGHTS: string = "cccccccc-0000-4000-8000-000000000002";
const SCHEDULE_BACKUP: string = "cccccccc-0000-4000-8000-000000000003";
const TEAM_PAYMENTS: string = "dddddddd-0000-4000-8000-000000000001";
const USER_ALICE: string = "eeeeeeee-0000-4000-8000-000000000001";
const USER_INVITED: string = "eeeeeeee-0000-4000-8000-000000000002";

// English, as written: no lookup has a word for anything.
const ENGLISH: Translator = createTranslator(undefined);

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

// What a list read asked for, by the kind of record it read.
function callFor(modelType: unknown): ListCall {
  const call: Array<unknown> | undefined = getListMock.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as ListCall).modelType === modelType;
    },
  );

  if (!call) {
    throw new Error("Expected a read of that kind of record.");
  }

  return call[0] as ListCall;
}

function includedIds(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return ((value as Includes).values as Array<string>).map(
    (id: string): string => {
      return id.toString();
    },
  );
}

function rows(models: Array<Record<string, unknown>>): {
  data: Array<Record<string, unknown>>;
  count: number;
} {
  return { data: models, count: models.length };
}

/*
 * The project: Payments' first rule (at place 2; its place-5 rule is
 * later) names a schedule paged for whoever is on call, one paged for the
 * next in its rotation, a team and a person who has no name yet; its
 * schedules are Primary (Carol on call) and Nights (nobody); Empty has no
 * rules; Silent's first rule names nobody.
 */
function answerReads(): void {
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const call: ListCall = args[0] as ListCall;

    if (call.modelType === OnCallDutyPolicyEscalationRule) {
      return rows([
        {
          _id: RULE_PAYMENTS_2,
          name: "Level 2",
          order: 5,
          onCallDutyPolicyId: new ObjectID(POLICY_PAYMENTS),
        },
        {
          _id: RULE_PAYMENTS_1,
          name: "First responders",
          order: 2,
          onCallDutyPolicyId: new ObjectID(POLICY_PAYMENTS),
        },
        {
          _id: RULE_SILENT_1,
          name: "Level 1",
          order: 1,
          onCallDutyPolicyId: new ObjectID(POLICY_SILENT),
        },
      ]);
    }

    if (call.modelType === OnCallDutyPolicyEscalationRuleUser) {
      return rows([
        {
          _id: "u1",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          user: { _id: USER_INVITED, email: "new.person@example.com" },
        },
        {
          _id: "u2",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          user: { _id: USER_ALICE, name: "Alice" },
        },
      ]);
    }

    if (call.modelType === OnCallDutyPolicyEscalationRuleTeam) {
      return rows([
        {
          _id: "t1",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          team: { _id: TEAM_PAYMENTS, name: "Payments" },
        },
      ]);
    }

    if (call.modelType === OnCallDutyPolicyEscalationRuleSchedule) {
      return rows([
        {
          _id: "s1",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          pageNextInRotation: false,
          onCallDutyPolicySchedule: { _id: SCHEDULE_PRIMARY, name: "Primary" },
        },
        {
          _id: "s2",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          pageNextInRotation: false,
          onCallDutyPolicySchedule: { _id: SCHEDULE_NIGHTS, name: "Nights" },
        },
        {
          _id: "s3",
          onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_PAYMENTS_1),
          pageNextInRotation: true,
          onCallDutyPolicySchedule: { _id: SCHEDULE_BACKUP, name: "Backup" },
        },
      ]);
    }

    if (call.modelType === OnCallDutyPolicySchedule) {
      return rows([
        {
          _id: SCHEDULE_PRIMARY,
          currentUserOnRoster: { _id: "carol", name: "Carol" },
        },
        { _id: SCHEDULE_NIGHTS, currentUserOnRoster: null },
      ]);
    }

    throw new Error("Unexpected read.");
  });
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("what the list reads", () => {
  test("each policy's first rule's responders, and who is on call in its schedules now", async () => {
    answerReads();

    const pagedFirst: Map<string, PagedFirst> = await readPagedFirstOfPolicies([
      POLICY_PAYMENTS,
      POLICY_EMPTY,
      POLICY_SILENT,
    ]);

    const payments: PagedFirst | undefined = pagedFirst.get(POLICY_PAYMENTS);

    expect(payments?.kind).toBe(PagedFirstKind.Responders);
    expect(payments?.ruleId).toBe(RULE_PAYMENTS_1);
    expect(payments?.responders).toEqual([
      {
        kind: PagedFirstResponderKind.Schedule,
        id: SCHEDULE_BACKUP,
        name: "Backup",
        isNextInRotation: true,
        onCallUserName: undefined,
      },
      {
        kind: PagedFirstResponderKind.Schedule,
        id: SCHEDULE_NIGHTS,
        name: "Nights",
        isNextInRotation: false,
        onCallUserName: null,
      },
      {
        kind: PagedFirstResponderKind.Schedule,
        id: SCHEDULE_PRIMARY,
        name: "Primary",
        isNextInRotation: false,
        onCallUserName: "Carol",
      },
      {
        kind: PagedFirstResponderKind.Team,
        id: TEAM_PAYMENTS,
        name: "Payments",
      },
      {
        kind: PagedFirstResponderKind.User,
        id: USER_ALICE,
        name: "Alice",
      },
      // A person with no name yet, by their email.
      {
        kind: PagedFirstResponderKind.User,
        id: USER_INVITED,
        name: "new.person@example.com",
      },
    ]);

    expect(pagedFirst.get(POLICY_EMPTY)?.kind).toBe(
      PagedFirstKind.NoEscalationRules,
    );
    expect(pagedFirst.get(POLICY_SILENT)?.kind).toBe(
      PagedFirstKind.NoResponders,
    );
  });

  test("the rules of the page's policies, in its project, by place", async () => {
    answerReads();

    await readPagedFirstOfPolicies([POLICY_PAYMENTS, POLICY_EMPTY]);

    const rules: ListCall = callFor(OnCallDutyPolicyEscalationRule);

    expect(rules.query["projectId"]?.toString()).toBe(PROJECT_ID);
    expect(includedIds(rules.query["onCallDutyPolicyId"])).toEqual([
      POLICY_PAYMENTS,
      POLICY_EMPTY,
    ]);
    expect(rules.select).toEqual({
      _id: true,
      name: true,
      order: true,
      onCallDutyPolicyId: true,
    });
  });

  test("the responders of the first rules only, never a later rule's", async () => {
    answerReads();

    await readPagedFirstOfPolicies([POLICY_PAYMENTS, POLICY_SILENT]);

    for (const modelType of [
      OnCallDutyPolicyEscalationRuleUser,
      OnCallDutyPolicyEscalationRuleTeam,
      OnCallDutyPolicyEscalationRuleSchedule,
    ]) {
      const call: ListCall = callFor(modelType);

      expect(call.query["projectId"]?.toString()).toBe(PROJECT_ID);
      expect(
        includedIds(call.query["onCallDutyPolicyEscalationRuleId"]).sort(),
      ).toEqual([RULE_PAYMENTS_1, RULE_SILENT_1].sort());
    }
  });

  test("who is on call, only in the schedules paged for whoever is on call", async () => {
    answerReads();

    await readPagedFirstOfPolicies([POLICY_PAYMENTS]);

    const rosters: ListCall = callFor(OnCallDutyPolicySchedule);

    expect(includedIds(rosters.query["_id"]).sort()).toEqual(
      [SCHEDULE_PRIMARY, SCHEDULE_NIGHTS].sort(),
    );
    expect(rosters.select).toEqual({
      _id: true,
      currentUserOnRoster: { _id: true, name: true, email: true },
    });
  });

  test("no rules at all: nothing more is read", async () => {
    getListMock.mockImplementation(async () => {
      return rows([]);
    });

    const pagedFirst: Map<string, PagedFirst> = await readPagedFirstOfPolicies([
      POLICY_EMPTY,
    ]);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(pagedFirst.get(POLICY_EMPTY)?.kind).toBe(
      PagedFirstKind.NoEscalationRules,
    );
  });

  test("no policies: nothing is read", async () => {
    expect((await readPagedFirstOfPolicies([])).size).toBe(0);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a read refused is thrown, for the column to leave its cells empty", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("You do not have permission to read escalation rules.");
    });

    await expect(readPagedFirstOfPolicies([POLICY_PAYMENTS])).rejects.toThrow(
      "permission",
    );
  });
});

function schedule(
  name: string,
  onCallUserName: string | null | undefined,
  isNextInRotation: boolean = false,
): PagedFirstResponder {
  return {
    kind: PagedFirstResponderKind.Schedule,
    id: name,
    name: name,
    onCallUserName: onCallUserName,
    isNextInRotation: isNextInRotation,
  };
}

function person(name: string): PagedFirstResponder {
  return { kind: PagedFirstResponderKind.User, id: name, name: name };
}

function responders(list: Array<PagedFirstResponder>): PagedFirst {
  return {
    kind: PagedFirstKind.Responders,
    ruleId: RULE_PAYMENTS_1,
    ruleName: "Level 1",
    responders: list,
  };
}

describe("a responder's chip", () => {
  test("a schedule says who it pages now, set apart from its name", () => {
    expect(getPagedFirstChip(schedule("Primary", "Carol"), ENGLISH)).toEqual({
      icon: IconProp.Calendar,
      text: "Primary · Carol",
      tone: PillTone.Neutral,
      tooltip: "Carol is on call now in Primary.",
    });
  });

  test("a schedule with nobody on call is amber, and says so", () => {
    expect(getPagedFirstChip(schedule("Nights", null), ENGLISH)).toEqual({
      icon: IconProp.Alert,
      text: "Nights · no one on call",
      tone: PillTone.Warning,
      tooltip: "No one is currently on call in this schedule.",
    });
  });

  test("a schedule paged for the next in its rotation says so", () => {
    expect(
      getPagedFirstChip(schedule("Backup", undefined, true), ENGLISH),
    ).toEqual({
      icon: IconProp.Forward,
      text: "Backup · next in rotation",
      tone: PillTone.Neutral,
      tooltip: undefined,
    });
  });

  test("a schedule whose on-call person was not read is its name alone", () => {
    expect(
      getPagedFirstChip(schedule("Primary", undefined), ENGLISH).text,
    ).toBe("Primary");
  });

  test("a team and a person by name", () => {
    expect(
      getPagedFirstChip(
        {
          kind: PagedFirstResponderKind.Team,
          id: TEAM_PAYMENTS,
          name: "Payments",
        },
        ENGLISH,
      ),
    ).toEqual({
      icon: IconProp.Team,
      text: "Payments",
      tone: PillTone.Neutral,
      tooltip: undefined,
    });
    expect(getPagedFirstChip(person("Alice"), ENGLISH).icon).toBe(
      IconProp.User,
    );
  });

  test.each(["de", "ja", "fa", "ar"])(
    "in %s, the words in that language, the names as written",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);
      const nobody: PagedFirstChip = getPagedFirstChip(
        schedule("Nights", null),
        translator,
      );

      expect(nobody.text).toContain("Nights");
      expect(nobody.text).toContain(words[NO_ONE_ON_CALL_TEXT]!);
      expect(nobody.text).not.toContain("no one on call");

      const onCall: PagedFirstChip = getPagedFirstChip(
        schedule("Primary", "Carol"),
        translator,
      );

      expect(onCall.text).toContain("Primary");
      expect(onCall.text).toContain("Carol");
      expect(onCall.tooltip).not.toContain("is on call now in");
    },
  );
});

describe("the cell", () => {
  test("draws a chip for each responder, three at most, then +N more naming the rest", () => {
    render(
      <PagedFirstCell
        pagedFirst={responders([
          schedule("Backup", undefined, true),
          schedule("Nights", null),
          schedule("Primary", "Carol"),
          person("Alice"),
          person("Bob"),
        ])}
        isLoading={false}
      />,
    );

    const chips: Array<HTMLElement> = screen.getAllByTestId(
      "paged-first-responder",
    );

    expect(
      chips.map((chip: HTMLElement): string => {
        return chip.textContent || "";
      }),
    ).toEqual([
      "Backup · next in rotation",
      "Nights · no one on call",
      "Primary · Carol",
    ]);
    expect(screen.getByTestId("paged-first-more")).toHaveTextContent("+2 more");
  });

  test("draws four responders as four chips: never +1 more", () => {
    render(
      <PagedFirstCell
        pagedFirst={responders([
          person("Alice"),
          person("Bob"),
          person("Carol"),
          person("Dan"),
        ])}
        isLoading={false}
      />,
    );

    expect(screen.getAllByTestId("paged-first-responder")).toHaveLength(4);
    expect(screen.queryByTestId("paged-first-more")).toBeNull();
  });

  test("a policy with no escalation rules: the break, named", () => {
    render(
      <PagedFirstCell
        pagedFirst={{
          kind: PagedFirstKind.NoEscalationRules,
          ruleId: null,
          ruleName: "",
          responders: [],
        }}
        isLoading={false}
      />,
    );

    expect(
      screen.getByTestId("paged-first-no-escalation-rules"),
    ).toHaveTextContent(NO_ESCALATION_RULES_TEXT);
    expect(screen.queryByTestId("paged-first-responder")).toBeNull();
  });

  test("a first rule that names nobody: the break, named", () => {
    render(
      <PagedFirstCell
        pagedFirst={{
          kind: PagedFirstKind.NoResponders,
          ruleId: RULE_SILENT_1,
          ruleName: "Level 1",
          responders: [],
        }}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("paged-first-no-responders")).toHaveTextContent(
      NO_RESPONDERS_TEXT,
    );
  });

  test("while it loads: the line its chips will take, marked as on its way", () => {
    const { container } = render(
      <PagedFirstCell pagedFirst={undefined} isLoading={true} />,
    );

    expect(
      screen.getByTestId(INLINE_VALUE_SKELETON_TEST_ID),
    ).toBeInTheDocument();
    expect(
      container.querySelector(`[${TABLE_VALUE_LOADING_ATTRIBUTE}="true"]`),
    ).not.toBeNull();
  });

  test("when it could not be read: the quiet dash, never words of a failure", () => {
    const { container } = render(
      <PagedFirstCell pagedFirst={undefined} isLoading={false} />,
    );

    expect(screen.queryByTestId("paged-first")).toBeNull();
    expect(screen.queryByTestId(INLINE_VALUE_SKELETON_TEST_ID)).toBeNull();
    expect(container.textContent).not.toContain("Loading");
  });

  test("a chip's names are drawn as written", () => {
    render(
      <PagedFirstCell
        pagedFirst={responders([person("Network")])}
        isLoading={false}
      />,
    );

    expect(
      within(screen.getByTestId("paged-first")).getByText("Network"),
    ).toBeInTheDocument();
  });
});

describe("the export", () => {
  test("names what the cell shows, a schedule with who it pages in brackets", () => {
    expect(
      getPagedFirstExportText(
        responders([
          schedule("Backup", undefined, true),
          schedule("Nights", null),
          schedule("Primary", "Carol"),
          schedule("Weekends", undefined),
          person("Alice"),
        ]),
        ENGLISH,
      ),
    ).toBe(
      "Backup (next in rotation); Nights (no one on call); Primary (Carol); Weekends; Alice",
    );
  });

  test("names the break", () => {
    expect(
      getPagedFirstExportText(
        {
          kind: PagedFirstKind.NoEscalationRules,
          ruleId: null,
          ruleName: "",
          responders: [],
        },
        ENGLISH,
      ),
    ).toBe(NO_ESCALATION_RULES_TEXT);
    expect(
      getPagedFirstExportText(
        {
          kind: PagedFirstKind.NoResponders,
          ruleId: RULE_SILENT_1,
          ruleName: "",
          responders: [],
        },
        ENGLISH,
      ),
    ).toBe(NO_RESPONDERS_TEXT);
    expect(getPagedFirstExportText(undefined, ENGLISH)).toBe("");
  });
});

describe("the column's words, in every Dashboard language", () => {
  const NEW_WORDS: Array<string> = [
    PAGED_FIRST_COLUMN_TITLE,
    NO_ESCALATION_RULES_TEXT,
    NO_ESCALATION_RULES_TOOLTIP,
    NO_RESPONDERS_TOOLTIP,
    ON_CALL_NOW_TOOLTIP,
  ];

  test.each([...DASHBOARD_LANGUAGES])(
    "are translated in %s",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const word of NEW_WORDS) {
        expect({
          word,
          translated: typeof words[word] === "string" && words[word] !== word,
        }).toEqual({
          word,
          translated: true,
        });
      }

      // The tooltip keeps both of its values.
      expect(words[ON_CALL_NOW_TOOLTIP]).toContain("{{name}}");
      expect(words[ON_CALL_NOW_TOOLTIP]).toContain("{{schedule}}");
    },
  );
});
