import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The four on-call rule pages - incident, alert, incident episode, alert
 * episode - were four ~370-line copies of one another and are now four sets of
 * props on one shared component. Everything a copy-paste page got wrong loudly
 * (a compile error, a missing import) a props object gets wrong silently, and
 * two of those silent failures page real people at the wrong time:
 *
 *   - the severity FOREIGN KEY COLUMN. A rule is tied to its severity band by
 *     `incidentSeverityId` or `alertSeverityId`. Write one and filter on the
 *     other and nothing throws: the table lists rules for EVERY severity, so a
 *     Sev 4 pages exactly like a Sev 1, and rules created from that table are
 *     stamped with a column nobody reads back.
 *
 *   - the severity MODEL. It does NOT follow from the rule type the way the
 *     names suggest. The alert episode page enumerates AlertSeverity; the
 *     incident episode page enumerates IncidentSeverity. Anything that derives
 *     one of the two axes from the other gets one of those pages wrong.
 *
 * The third pin here is the stored-preferences key. It has to carry the
 * severity id because one table is rendered per severity on a single route;
 * drop the id and paging one table repaginates every other table on the page.
 * That is a pure-UX bug, invisible to the type checker, and it was already
 * explained in a comment in the original source - which is exactly why it is
 * asserted rather than trusted to survive the next edit.
 *
 * The fourth is where the "Notification Method" dropdown comes from, which is
 * now two different places depending on whose rules are on screen. For the
 * signed-in user it is still nine reads of the nine method models, and that
 * path is the four settings pages every existing user relies on. For anybody
 * else those reads are REFUSED - the models are scoped to the person who owns
 * the device, because the columns behind them are the raw phone number, the
 * webhook bearer url, the push device token, the telegram chat id and the
 * verification code - so the caller hands the list over instead, masked. Both
 * halves are asserted here: that the self-serve path still reads what it always
 * read, and that pointing the table at somebody else reads nothing at all.
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";
const CURRENT_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b1";
const OTHER_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b2";
const SEVERITY_ONE_ID: string = "00000000-0000-4000-8000-0000000000c1";
const SEVERITY_TWO_ID: string = "00000000-0000-4000-8000-0000000000c2";

/*
 * The supplied methods. Each carries the id of its own row - which is what a
 * rule's userSmsId / userEmailId actually reference - alongside a mask in
 * exactly the shape OnCallReadinessService.maskIdentifier emits, and a raw value
 * that must never appear in a dropdown label.
 */
const SUPPLIED_SMS_ID: string = "00000000-0000-4000-8000-0000000000d1";
const SUPPLIED_EMAIL_ID: string = "00000000-0000-4000-8000-0000000000d2";
const SUPPLIED_TELEGRAM_ID: string = "00000000-0000-4000-8000-0000000000d3";
const UNKNOWN_METHOD_ID: string = "00000000-0000-4000-8000-0000000000d9";

const MASKED_SMS: string = "+1 ••• ••• 4821";
const MASKED_EMAIL: string = "j•••@example.com";
const MASKED_TELEGRAM: string = "@ja•••";

const RAW_PHONE: string = "+15551234821";

/*
 * Restated rather than imported, so that changing the wording in the component
 * fails here. This string is what distinguishes "deliberately never page me for
 * this" from a row that merely looks broken, and the whole risk it guards
 * against is somebody deleting the row because the cell was blank.
 */
const OPT_OUT_LABEL: string = "Muted - notifications turned off for this rule";

/* The signed-in user's own email, which their own page IS allowed to read. */
const OWN_EMAIL_ID: string = "00000000-0000-4000-8000-0000000000e1";
const OWN_EMAIL_ADDRESS: string = "self.serve@example.com";

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return currentUserId;
      },
      /*
       * The delete guard asks whether the viewer is a master admin before it
       * offers a Delete control at all. A stub missing this method does not
       * make the guard fail an assertion - it throws
       * "isMasterAdmin is not a function" at render, taking every test in the
       * file with it, which reads as 33 unrelated failures rather than one
       * missing stub.
       */
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

/*
 * A stand-in ModelTable that records the props it was handed. Rendering the
 * real one would drag in the pager, the facet bar and the URL state, none of
 * which this file is about - what matters is the query the table is given, the
 * row it builds on create, and the key it stores preferences under.
 */
interface CapturedFormField {
  overrideFieldKey?: string | undefined;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
}

/*
 * A declared column. `field` is captured because ModelTable folds it into the
 * projection it sends alongside `selectMoreFields` - so a column is a REQUEST,
 * not merely a renderer, and asserting only on selectMoreFields would miss half
 * of what goes on the wire.
 */
interface CapturedColumn {
  title: string;
  field: Record<string, unknown>;
  getElement?: ((item: UserNotificationRule) => ReactElement) | undefined;
}

interface CapturedTableProps {
  userPreferencesKey: string;
  query: Record<string, ObjectID | NotificationRuleType | undefined>;
  onBeforeCreate: (
    model: UserNotificationRule,
    miscDataProps: Record<string, unknown>,
  ) => Promise<UserNotificationRule>;
  isCreateable: boolean;
  isDeleteable: boolean;
  isEditable: boolean;
  formFields: Array<CapturedFormField>;
  selectMoreFields: Record<string, unknown>;
  columns: Array<CapturedColumn>;
  cardProps: { title: string; description: string };
}

let capturedTables: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTables.push(props);
      return null;
    },
  };
});

import OnCallRulesTable, {
  NotificationMethodChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/AlertOnCallRules";
import EpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/EpisodeOnCallRules";
import IncidentEpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentEpisodeOnCallRules";
import IncidentOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentOnCallRules";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The nine models whose rows only their owner may read. They are listed
 * together because the assertion that matters is about the SET: an admin
 * surface that reads any one of them is reading a row it is not entitled to,
 * and which one hardly matters.
 */
const NOTIFICATION_METHOD_MODELS: Array<unknown> = [
  UserEmail,
  UserSMS,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserSlack,
  UserMicrosoftTeams,
  UserWebhook,
];

/*
 * What the admin surface hands over in place of those reads: a channel name, the
 * id of the row, and a mask. Telegram is unverified on purpose - the self-serve
 * path filters `isVerified: true` in eight of its nine queries, so a supplied
 * list that offered unverified methods would be the two paths disagreeing about
 * what is pickable.
 */
const SUPPLIED_METHODS: Array<NotificationMethodChoice> = [
  {
    methodType: "SMS",
    methodId: SUPPLIED_SMS_ID,
    maskedIdentifier: MASKED_SMS,
    isVerified: true,
  },
  {
    methodType: "Email",
    methodId: SUPPLIED_EMAIL_ID,
    maskedIdentifier: MASKED_EMAIL,
    isVerified: true,
  },
  {
    methodType: "Telegram",
    methodId: SUPPLIED_TELEGRAM_ID,
    maskedIdentifier: MASKED_TELEGRAM,
    isVerified: false,
  },
];

/* Every foreign key a rule can point a method at. */
const METHOD_FOREIGN_KEYS: Array<keyof UserNotificationRule> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userPushId",
  "userWhatsAppId",
  "userTelegramId",
  "userSlackId",
  "userMicrosoftTeamsId",
  "userWebhookId",
];

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const currentUserId: ObjectID = new ObjectID(CURRENT_USER_ID_STRING);
const OTHER_USER_ID: ObjectID = new ObjectID(OTHER_USER_ID_STRING);

type SeverityModelType = { new (): IncidentSeverity | AlertSeverity };

type BuildSeverities = (
  modelType: SeverityModelType,
) => Array<IncidentSeverity | AlertSeverity>;

const buildSeverities: BuildSeverities = (
  modelType: SeverityModelType,
): Array<IncidentSeverity | AlertSeverity> => {
  return [
    { id: SEVERITY_ONE_ID, name: "Sev 1" },
    { id: SEVERITY_TWO_ID, name: "Sev 2" },
  ].map((spec: { id: string; name: string }) => {
    const severity: IncidentSeverity | AlertSeverity = new modelType();
    severity._id = spec.id;
    severity.name = spec.name;
    return severity;
  });
};

const pageProps: PageComponentProps = {
  pageRoute: new Route("/user-settings/on-call-rules"),
  currentProject: null,
  hasPaymentMethod: false,
};

/*
 * Which model each getList call asked for. The severity fetch is the only one
 * that varies between the four pages, so this is how "the right severity model
 * is used" gets asserted without reaching inside the component.
 */
type GetRequestedModelTypes = () => Array<unknown>;

const getRequestedModelTypes: GetRequestedModelTypes = (): Array<unknown> => {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0].modelType;
  });
};

type GetCapturedTables = () => Array<CapturedTableProps>;

/*
 * The captured list is REPLACED between tests rather than emptied in place, so a
 * closure built inside the `for` loop below would otherwise read whichever array
 * happened to be bound when the loop ran rather than the one the test is
 * filling. Going through a stable function is also what stops eslint's
 * no-loop-func from being right about it.
 */
const getCapturedTables: GetCapturedTables = (): Array<CapturedTableProps> => {
  return capturedTables;
};

type GetQueriedUserIds = () => Array<string | undefined>;

const getQueriedUserIds: GetQueriedUserIds = (): Array<string | undefined> => {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0].query.userId?.toString();
  });
};

/*
 * The options the create form's "Notification Method" dropdown is offering. It
 * is an override field - its value travels in `miscDataProps` rather than as a
 * column - so it is found by its override key rather than by a field name.
 */
type GetMethodOptions = (
  table: CapturedTableProps,
) => Array<{ label: string; value: string }>;

const getMethodOptions: GetMethodOptions = (
  table: CapturedTableProps,
): Array<{ label: string; value: string }> => {
  const field: CapturedFormField | undefined = table.formFields.find(
    (candidate: CapturedFormField): boolean => {
      return candidate.overrideFieldKey === "notificationMethod";
    },
  );

  if (!field) {
    throw new Error("no notification method form field");
  }

  return field.dropdownOptions || [];
};

/*
 * The nine RELATION spellings. Selecting any of these on a rule pulls columns
 * out of the method models themselves - the raw address, the raw number, the
 * telegram handle - through a table an administrator is allowed to read.
 *
 * That route is not refused, and it is worth being precise about why, because
 * "the model is owner-scoped" is the reason everybody assumes covers it and it
 * does not. SelectPermission checks the nested key against UserNotificationRule's
 * own `userEmail` column, whose read list is [Permission.CurrentUser] - and
 * CurrentUser is auto-granted to every authenticated caller. Then
 * QueryPermission.checkRelationQueryPermission sees `canReadOnRelationQuery:
 * true` on UserEmail.email and returns early without consulting UserEmail's own
 * read list at all. And a read of UserNotificationRule is deliberately NOT
 * row-scoped for an administrator, since that is what the admin surface is for.
 * Three permissive steps compose into a leak that no single one of them looks
 * like.
 */
const METHOD_RELATIONS: Array<string> = [
  "userEmail",
  "userSms",
  "userCall",
  "userPush",
  "userWhatsApp",
  "userTelegram",
  "userSlack",
  "userMicrosoftTeams",
  "userWebhook",
];

/*
 * Everything the table asks the server for about a method, from BOTH of the
 * places ModelTable builds its projection out of. Asserting on the union is the
 * point: the two are unioned on the wire, so a guard applied to one of them is
 * no guard at all.
 */
type GetMethodProjectionKeys = (table: CapturedTableProps) => Array<string>;

const getMethodProjectionKeys: GetMethodProjectionKeys = (
  table: CapturedTableProps,
): Array<string> => {
  const keys: Array<string> = Object.keys(table.selectMoreFields || {});

  for (const column of table.columns || []) {
    keys.push(...Object.keys(column.field || {}));
  }

  return keys;
};

/* The rendered "Notification Method" cell for one rule, as plain text. */
type RenderMethodCell = (
  table: CapturedTableProps,
  rule: UserNotificationRule,
) => string;

const renderMethodCell: RenderMethodCell = (
  table: CapturedTableProps,
  rule: UserNotificationRule,
): string => {
  const column: CapturedColumn | undefined = (table.columns || []).find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Notification Method";
    },
  );

  if (!column || !column.getElement) {
    throw new Error("no notification method column");
  }

  const { container }: { container: HTMLElement } = render(
    column.getElement(rule),
  );

  return container.textContent || "";
};

type GetMethodColumnsSet = (
  rule: UserNotificationRule,
) => Array<{ column: string; value: string }>;

/*
 * Which of the seven method foreign keys a created rule ended up carrying. The
 * assertion is always about the whole set, never about one column: a rule that
 * sets the wrong one pages the wrong device, and a rule that sets two is a shape
 * the create path has no meaning for.
 */
const getMethodColumnsSet: GetMethodColumnsSet = (
  rule: UserNotificationRule,
): Array<{ column: string; value: string }> => {
  const columns: Array<{ column: string; value: string }> = [];

  for (const foreignKey of METHOD_FOREIGN_KEYS) {
    const value: unknown = rule[foreignKey];

    if (value) {
      columns.push({
        column: foreignKey as string,
        value: (value as ObjectID).toString(),
      });
    }
  }

  return columns;
};

type RenderAndSettle = (element: ReactElement) => Promise<void>;

const renderAndSettle: RenderAndSettle = async (
  element: ReactElement,
): Promise<void> => {
  render(element);

  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(0);
  });
};

interface RuleTypeCase {
  label: string;
  Page: FunctionComponent<PageComponentProps>;
  severityModelType: SeverityModelType;
  wrongSeverityModelType: SeverityModelType;
  foreignKeyColumn: "incidentSeverityId" | "alertSeverityId";
  wrongForeignKeyColumn: "incidentSeverityId" | "alertSeverityId";
  ruleType: NotificationRuleType;
}

/*
 * Note the crossed pair in the middle two rows: the ALERT episode page reads
 * AlertSeverity while the INCIDENT episode page reads IncidentSeverity. That
 * crossing is the whole reason the severity model and the foreign key column
 * are two separate props, and a case table is the only shape that makes an
 * accidental re-derivation fail on exactly one row instead of passing on all
 * four.
 */
const RULE_TYPE_CASES: Array<RuleTypeCase> = [
  {
    label: "incident",
    Page: IncidentOnCallRules,
    severityModelType: IncidentSeverity,
    wrongSeverityModelType: AlertSeverity,
    foreignKeyColumn: "incidentSeverityId",
    wrongForeignKeyColumn: "alertSeverityId",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  },
  {
    label: "alert",
    Page: AlertOnCallRules,
    severityModelType: AlertSeverity,
    wrongSeverityModelType: IncidentSeverity,
    foreignKeyColumn: "alertSeverityId",
    wrongForeignKeyColumn: "incidentSeverityId",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  },
  {
    label: "alert episode",
    Page: EpisodeOnCallRules,
    severityModelType: AlertSeverity,
    wrongSeverityModelType: IncidentSeverity,
    foreignKeyColumn: "alertSeverityId",
    wrongForeignKeyColumn: "incidentSeverityId",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  },
  {
    label: "incident episode",
    Page: IncidentEpisodeOnCallRules,
    severityModelType: IncidentSeverity,
    wrongSeverityModelType: AlertSeverity,
    foreignKeyColumn: "incidentSeverityId",
    wrongForeignKeyColumn: "alertSeverityId",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  },
];

describe("OnCallRulesTable", () => {
  beforeEach(() => {
    capturedTables = [];
    getListMock.mockReset();

    /*
     * Whichever severity model the page asks for is the one it gets back. A
     * page that asked for the wrong one would still render two tables, so the
     * assertions below check the REQUEST rather than inferring it from what
     * came back.
     */
    getListMock.mockImplementation((data: any) => {
      if (
        data.modelType === IncidentSeverity ||
        data.modelType === AlertSeverity
      ) {
        return Promise.resolve({
          data: buildSeverities(data.modelType),
          count: 2,
          skip: 0,
          limit: 2,
        });
      }

      /*
       * One real row on the self-serve path, so "the dropdown is built from the
       * models" is asserted against a label rather than against an empty list -
       * which is what every method model returned before, and which a component
       * that had stopped reading them entirely would also produce.
       */
      if (data.modelType === UserEmail) {
        const userEmail: UserEmail = new UserEmail();
        userEmail._id = OWN_EMAIL_ID;
        userEmail.email = new Email(OWN_EMAIL_ADDRESS);

        return Promise.resolve({
          data: [userEmail],
          count: 1,
          skip: 0,
          limit: 1,
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    });

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  for (const testCase of RULE_TYPE_CASES) {
    const Page: FunctionComponent<PageComponentProps> = testCase.Page;

    describe(`${testCase.label} rules`, () => {
      test("enumerates its own severity model and never the other one", async () => {
        await renderAndSettle(<Page {...pageProps} />);

        const requested: Array<unknown> = getRequestedModelTypes();

        expect(requested).toContain(testCase.severityModelType);
        expect(requested).not.toContain(testCase.wrongSeverityModelType);
      });

      test("filters each table on its own severity foreign key column", async () => {
        await renderAndSettle(<Page {...pageProps} />);

        expect(getCapturedTables()).toHaveLength(2);

        const severityIds: Array<string> = [SEVERITY_ONE_ID, SEVERITY_TWO_ID];

        getCapturedTables().forEach((table: CapturedTableProps, i: number) => {
          expect(table.query["ruleType"]).toBe(testCase.ruleType);
          expect(table.query["projectId"]?.toString()).toBe(PROJECT_ID_STRING);
          expect(table.query["userId"]?.toString()).toBe(
            CURRENT_USER_ID_STRING,
          );

          expect(table.query[testCase.foreignKeyColumn]?.toString()).toBe(
            severityIds[i],
          );

          /*
           * Absent, not merely undefined. A query that carries the other column
           * at all is the shape that reads as "no severity filter" once it is
           * serialised onto the wire.
           */
          expect(Object.keys(table.query)).not.toContain(
            testCase.wrongForeignKeyColumn,
          );
        });
      });

      test("stamps the same severity foreign key column on a newly created rule", async () => {
        await renderAndSettle(<Page {...pageProps} />);

        const created: UserNotificationRule =
          await getCapturedTables()[0]!.onBeforeCreate(
            new UserNotificationRule(),
            {
              notificationMethod: undefined,
            },
          );

        expect(created.ruleType).toBe(testCase.ruleType);
        expect(created.projectId?.toString()).toBe(PROJECT_ID_STRING);
        expect(created.userId?.toString()).toBe(CURRENT_USER_ID_STRING);

        expect(created[testCase.foreignKeyColumn]?.toString()).toBe(
          SEVERITY_ONE_ID,
        );
        expect(created[testCase.wrongForeignKeyColumn]).toBeUndefined();
      });

      test("keeps the severity id in each table's user preferences key", async () => {
        await renderAndSettle(<Page {...pageProps} />);

        const keys: Array<string> = getCapturedTables().map(
          (table: CapturedTableProps) => {
            return table.userPreferencesKey;
          },
        );

        expect(keys[0]).toContain(SEVERITY_ONE_ID);
        expect(keys[1]).toContain(SEVERITY_TWO_ID);
        expect(keys[0]).not.toBe(keys[1]);

        keys.forEach((key: string) => {
          expect(key).toContain(testCase.ruleType);
        });
      });
    });
  }

  test("gives every table across all four rule types a distinct preferences key", async () => {
    const keys: Array<string> = [];

    for (const testCase of RULE_TYPE_CASES) {
      const Page: FunctionComponent<PageComponentProps> = testCase.Page;

      capturedTables = [];
      await renderAndSettle(<Page {...pageProps} />);

      capturedTables.forEach((table: CapturedTableProps) => {
        keys.push(table.userPreferencesKey);
      });

      cleanup();
    }

    /*
     * Four pages, two severities each. If any two keys collided the distinct
     * count would drop, and the two tables sharing a key would share a stored
     * page size and a slice of URL state.
     */
    expect(keys).toHaveLength(8);
    expect(new Set(keys).size).toBe(8);
  });

  /*
   * Pointed at somebody else - the admin surface.
   *
   * The rules still move with the user, but the METHODS no longer do: a read of
   * UserSMS for a colleague is refused, because the row behind the label holds
   * their raw number. Widening that scope so this dropdown could be filled was
   * tried and could not be contained, so the list is handed in already masked
   * and the table reads nothing.
   */
  type RenderForOtherUser = (
    notificationMethods?: Array<NotificationMethodChoice> | undefined,
  ) => Promise<void>;

  const renderForOtherUser: RenderForOtherUser = async (
    notificationMethods?: Array<NotificationMethodChoice> | undefined,
  ): Promise<void> => {
    await renderAndSettle(
      <OnCallRulesTable
        severityModelType={IncidentSeverity}
        severityForeignKeyColumn="incidentSeverityId"
        ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
        userPreferencesKeyPrefix="admin-notification-rules-table"
        userId={OTHER_USER_ID}
        notificationMethods={notificationMethods}
        getTitle={(severityName: string): string => {
          return severityName;
        }}
        getDescription={(severityName: string): string => {
          return severityName;
        }}
      />,
    );
  };

  test("scopes rules to the user it is given, and reads no method model for them", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    expect(capturedTables[0]!.query["userId"]?.toString()).toBe(
      OTHER_USER_ID_STRING,
    );

    /*
     * The whole point of the redesign, in one assertion. Not "reads them and
     * shows fewer columns" - does not read them. Each of these nine models is
     * scoped to the person who owns the device, and the columns behind them are
     * the raw phone number, the webhook bearer url, the push device token, the
     * telegram chat id and the verification code. A request here is a request
     * the server refuses, and a component that issues it renders an error page
     * where the rules should be.
     */
    const requested: Array<unknown> = getRequestedModelTypes();

    for (const methodModel of NOTIFICATION_METHOD_MODELS) {
      expect(requested).not.toContain(methodModel);
    }

    expect(requested).toEqual([IncidentSeverity]);

    // Nor may it quietly fall back to reading the ADMIN's own methods instead.
    expect(getQueriedUserIds()).not.toContain(CURRENT_USER_ID_STRING);

    const created: UserNotificationRule =
      await capturedTables[0]!.onBeforeCreate(new UserNotificationRule(), {});

    expect(created.userId?.toString()).toBe(OTHER_USER_ID_STRING);
  });

  test("reads no method model even when it is handed no methods at all", async () => {
    /*
     * The readiness payload the admin page sources these from is fetched
     * asynchronously and can fail outright, so an absent list is a real state
     * rather than a caller mistake. Treating it as "then fetch them yourself"
     * would fire nine refused requests and turn this component's error state on
     * - taking the rule repair away because a DIFFERENT read failed.
     */
    await renderForOtherUser(undefined);

    const requested: Array<unknown> = getRequestedModelTypes();

    for (const methodModel of NOTIFICATION_METHOD_MODELS) {
      expect(requested).not.toContain(methodModel);
    }

    expect(capturedTables).toHaveLength(2);
    expect(getMethodOptions(capturedTables[0]!)).toEqual([]);
  });

  test("builds the dropdown from the masked methods it is handed", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const options: Array<{ label: string; value: string }> = getMethodOptions(
      capturedTables[0]!,
    );

    /*
     * Label from the mask, value from the method id. That pairing is the entire
     * trick: the viewer picks "SMS: +1 ••• ••• 4821" and the form submits a
     * foreign key, so the number itself is never in the page to begin with.
     */
    expect(options).toEqual([
      { label: `SMS: ${MASKED_SMS}`, value: SUPPLIED_SMS_ID },
      { label: `Email: ${MASKED_EMAIL}`, value: SUPPLIED_EMAIL_ID },
    ]);

    for (const option of options) {
      expect(option.label).not.toContain(RAW_PHONE);
    }

    /*
     * The unverified Telegram method is absent, which mirrors the
     * `isVerified: true` filter on eight of the nine self-serve queries. A rule
     * pointed at an unverified device is a rule that pages nothing.
     */
    expect(
      options.map((option: { label: string; value: string }) => {
        return option.value;
      }),
    ).not.toContain(SUPPLIED_TELEGRAM_ID);
  });

  test("points the created rule at the column the chosen method belongs to", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const created: UserNotificationRule =
      await capturedTables[0]!.onBeforeCreate(new UserNotificationRule(), {
        notificationMethod: SUPPLIED_SMS_ID,
      });

    /*
     * The nine foreign keys are mutually exclusive and nothing validates that
     * client-side, so this asserts the whole set: an SMS id written to
     * `userEmailId` would page an address rather than a phone, and would not
     * error anywhere on the way.
     */
    expect(getMethodColumnsSet(created)).toEqual([
      { column: "userSmsId", value: SUPPLIED_SMS_ID },
    ]);
  });

  test("sets no method at all for an id it was never handed", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const created: UserNotificationRule =
      await capturedTables[0]!.onBeforeCreate(new UserNotificationRule(), {
        notificationMethod: UNKNOWN_METHOD_ID,
      });

    /*
     * A rule with no method is refused by the server, which is the right
     * failure. The wrong one would be guessing a column for an unrecognised id -
     * that produces a rule which pages some other device and never errors.
     */
    expect(getMethodColumnsSet(created)).toEqual([]);
  });

  test("sets no method for an id the dropdown deliberately withheld", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const created: UserNotificationRule =
      await capturedTables[0]!.onBeforeCreate(new UserNotificationRule(), {
        notificationMethod: SUPPLIED_TELEGRAM_ID,
      });

    /*
     * The unverified method IS in the supplied list - it is shown on the methods
     * card - and is only kept out of the dropdown. Matching on the list alone
     * would let a value that was never offered become a rule anyway, so the
     * offered set and the accepted set are one predicate rather than two.
     */
    expect(getMethodColumnsSet(created)).toEqual([]);
  });

  test("asks for no method column of any method model when the table is about somebody else", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    /*
     * The SECOND door, and the one that was open.
     *
     * "Reads no method model" is usually taken to mean "issues no getList over
     * UserEmail", which the test above already pins. But the rules table also
     * asked for `{ userEmail: { email: true }, userSms: { phone: true }, ... }`
     * as a nested select ON THE RULE, to render its "Notification Method" cell.
     * That reaches the same columns through a table an administrator may read,
     * it is not row-scoped for them, and the permission machinery lets it
     * through - see METHOD_RELATIONS above for the three steps. The admin page
     * masked every identifier on its readiness card and then printed the raw
     * ones in a table one card below.
     */
    const projection: Array<string> = getMethodProjectionKeys(
      capturedTables[0]!,
    );

    for (const relation of METHOD_RELATIONS) {
      expect(projection).not.toContain(relation);
    }

    /*
     * The ids are asked for instead, and are the mechanism rather than a
     * consolation prize: an id carries nothing, it is admin-readable by design,
     * and matching it against the masked payload is what lets the cell name a
     * method whose row was never read.
     */
    for (const foreignKey of METHOD_FOREIGN_KEYS) {
      expect(projection).toContain(foreignKey as string);
    }

    // Not vacuous - it still asks for the things the other cells need.
    expect(projection).toContain("isOptOut");
    expect(projection).toContain("notifyAfterMinutes");
  });

  test("labels somebody else's rule from the mask, never from the row", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userSmsId = new ObjectID(SUPPLIED_SMS_ID);

    const cell: string = renderMethodCell(capturedTables[0]!, rule);

    expect(cell).toBe(`SMS: ${MASKED_SMS}`);
    expect(cell).not.toContain(RAW_PHONE);
  });

  test("names the method behind a rule even once that method stops being verified", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userTelegramId = new ObjectID(SUPPLIED_TELEGRAM_ID);

    /*
     * The dropdown withholds this method, and the cell must NOT. A rule still
     * pointing at a method that has since become unverified is precisely the
     * misconfiguration an administrator opened this page to find, so hiding it
     * behind the same filter that governs the dropdown would blank out the one
     * row worth looking at.
     */
    expect(renderMethodCell(capturedTables[0]!, rule)).toBe(
      `Telegram: ${MASKED_TELEGRAM}`,
    );
  });

  test("a rule whose method is not in the payload is labelled, not left blank", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userCallId = new ObjectID(UNKNOWN_METHOD_ID);

    const cell: string = renderMethodCell(capturedTables[0]!, rule);

    /*
     * Readiness can be down, or the method deleted, and then the cell cannot
     * name it. Rendering nothing is the one genuinely wrong answer: a blank
     * method cell is exactly what an OPT-OUT row looks like, and the two mean
     * opposite things - "never page me here" against "paged on a device this
     * screen cannot name". An admin who reads the second as the first deletes a
     * working rule and silently stops somebody's pages.
     */
    expect(cell.length).toBeGreaterThan(0);
    expect(cell).not.toBe(OPT_OUT_LABEL);
  });

  test("an opt-out row is still labelled as muted for somebody else", async () => {
    await renderForOtherUser(SUPPLIED_METHODS);

    const rule: UserNotificationRule = new UserNotificationRule();
    (rule as unknown as Record<string, unknown>)["isOptOut"] = true;

    expect(renderMethodCell(capturedTables[0]!, rule)).toBe(OPT_OUT_LABEL);
  });

  test("the signed-in user's own table still asks for the method relations", async () => {
    /*
     * The other half of the seam, and the regression that would actually be
     * noticed: the four self-serve pages render this same cell from the nested
     * relations, and reading your own address unmasked is both allowed and the
     * more useful thing to show. Narrowing the projection for everybody would
     * blank the method column on every settings page in the product.
     */
    await renderAndSettle(<IncidentOnCallRules {...pageProps} />);

    const projection: Array<string> = getMethodProjectionKeys(
      capturedTables[0]!,
    );

    for (const relation of METHOD_RELATIONS) {
      expect(projection).toContain(relation);
    }
  });

  test("the signed-in user's own table still reads the method models itself", async () => {
    /*
     * The regression surface. Four settings pages every existing user already
     * relies on read their own nine models to fill this dropdown, and reading
     * your own rows is exactly what those models allow. Nothing about the admin
     * surface is a reason to change it - and an unmasked label is more use to
     * somebody looking at their own phone number than a mask of it.
     */
    await renderAndSettle(<IncidentOnCallRules {...pageProps} />);

    const requested: Array<unknown> = getRequestedModelTypes();

    for (const methodModel of NOTIFICATION_METHOD_MODELS) {
      expect(requested).toContain(methodModel);
    }

    expect(
      getQueriedUserIds().filter((userId: string | undefined) => {
        return userId === CURRENT_USER_ID_STRING;
      }),
    ).toHaveLength(9);

    expect(getMethodOptions(capturedTables[0]!)).toEqual([
      { label: `Email: ${OWN_EMAIL_ADDRESS}`, value: OWN_EMAIL_ID },
    ]);

    const created: UserNotificationRule =
      await capturedTables[0]!.onBeforeCreate(new UserNotificationRule(), {
        notificationMethod: OWN_EMAIL_ID,
      });

    expect(getMethodColumnsSet(created)).toEqual([
      { column: "userEmailId", value: OWN_EMAIL_ID },
    ]);
  });

  test("a table handed methods for the signed-in user still reads their own rows", async () => {
    /*
     * The fourth corner of the seam, stated so it cannot be read the other way:
     * WHOSE rules these are decides where the methods come from, not whether a
     * list happened to be passed. The admin page renders this component for the
     * viewer's own id too, and there the supplied masks are the wrong thing to
     * show somebody about their own devices.
     */
    await renderAndSettle(
      <OnCallRulesTable
        severityModelType={IncidentSeverity}
        severityForeignKeyColumn="incidentSeverityId"
        ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
        userPreferencesKeyPrefix="admin-notification-rules-table"
        userId={currentUserId}
        notificationMethods={SUPPLIED_METHODS}
        getTitle={(severityName: string): string => {
          return severityName;
        }}
        getDescription={(severityName: string): string => {
          return severityName;
        }}
      />,
    );

    expect(getMethodOptions(capturedTables[0]!)).toEqual([
      { label: `Email: ${OWN_EMAIL_ADDRESS}`, value: OWN_EMAIL_ID },
    ]);
  });

  test("drops the create and delete affordances when it is not editable", async () => {
    await renderAndSettle(
      <OnCallRulesTable
        severityModelType={AlertSeverity}
        severityForeignKeyColumn="alertSeverityId"
        ruleType={NotificationRuleType.ON_CALL_EXECUTED_ALERT}
        userPreferencesKeyPrefix="admin-notification-rules-table"
        userId={OTHER_USER_ID}
        isEditable={false}
        getTitle={(severityName: string): string => {
          return severityName;
        }}
        getDescription={(severityName: string): string => {
          return severityName;
        }}
      />,
    );

    expect(capturedTables).toHaveLength(2);

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(false);
      expect(table.isDeleteable).toBe(false);

      /*
       * Including the row editor. Leaving it on for a viewer who may not create
       * or delete would draw the one control that rewrites an existing rule for
       * exactly the person the server will refuse.
       */
      expect(table.isEditable).toBe(false);
    });
  });

  test("turns the row editor on for a viewer who may edit, along with add and remove", async () => {
    /*
     * All three affordances answer ONE question - may this person rewrite how
     * somebody gets paged? - and the server answers it once, so they move
     * together.
     *
     * The editor used to be hardcoded off, on the assumption that a notification
     * rule is only ever added and removed. That made the whole edit capability
     * inert: no PATCH was ever issued from this table, so opening
     * `notifyAfterMinutes` to update bought nothing anybody could click. The
     * delay is the single most common repair on this screen, and doing it by
     * deleting the rule and adding it back is a window during which the person
     * is not paged at all.
     */
    await renderAndSettle(<IncidentOnCallRules {...pageProps} />);

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(true);
      /*
       * Off by design, and NOT the same thing as "cannot delete". Deleting a
       * rule goes through the impact confirmation instead - the guard supplies
       * its own action button, because ModelTable's built-in dialog cannot say
       * how many rules disappear or which severity loses its last delivering
       * rule. "Remove" in this test's name is that button, not this flag.
       */
      expect(table.isDeleteable).toBe(false);
      expect(table.isEditable).toBe(true);
    });
  });

  test("renders the per-severity card copy the self-serve pages had before the extraction", async () => {
    await renderAndSettle(<IncidentOnCallRules {...pageProps} />);

    expect(capturedTables[0]!.cardProps.title).toBe(
      "Sev 1 Severity:  When I am on call and Sev 1 is assigned to me...",
    );
    expect(capturedTables[0]!.cardProps.description).toBe(
      "Here are the rules when you are on call and Sev 1 is assigned to you.",
    );

    cleanup();
    capturedTables = [];

    await renderAndSettle(<EpisodeOnCallRules {...pageProps} />);

    expect(capturedTables[0]!.cardProps.title).toBe(
      "Sev 1 Severity Episode:  When I am on call and Sev 1 severity episode is assigned to me...",
    );
    expect(capturedTables[0]!.cardProps.description).toBe(
      "Here are the rules when you are on call and Sev 1 Severity episode is assigned to you.",
    );
  });
});
