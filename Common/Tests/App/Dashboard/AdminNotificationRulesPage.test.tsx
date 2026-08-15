import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Users > View > Notification Rules, and the table component it now shares with
 * the four self-serve settings pages.
 *
 * Phase 3 is the first time one person's paging configuration is editable by
 * another person, so the failures worth writing down here are not "the page
 * crashed" - they are the quiet ones:
 *
 *   - THE WRONG SEVERITY AXIS. A rule is tied to its band by
 *     `incidentSeverityId` or `alertSeverityId`, and the severity MODEL does not
 *     follow from the rule type the way the names suggest: an alert episode is
 *     banded by AlertSeverity, an incident episode by IncidentSeverity. Get
 *     either axis wrong and nothing throws. The table simply lists rules for
 *     EVERY severity, so a Sev 4 pages exactly like a Sev 1, and rules created
 *     from it are stamped with a column nobody filters on. The two severity
 *     models in this file therefore return DISJOINT id sets, which is the only
 *     fixture shape in which "right column, wrong model" is visible at all.
 *
 *   - A SELF-SERVE REGRESSION. Four ~370-line copies became one component with
 *     props. Everything a copy-paste page got wrong loudly, a props object gets
 *     wrong silently, and these four pages are the ones every existing user
 *     already relies on, so their query, their created row, their stored
 *     preferences key and their card copy are pinned against the pre-extraction
 *     source.
 *
 *   - AN ADMIN TYPING IN SOMEBODY ELSE'S PHONE NUMBER. Rules are fully editable
 *     on this page; notification METHODS are read-only and masked, deliberately.
 *     Letting an admin add a device or address to another account would point
 *     that person's pages at hardware the admin controls, and would not even
 *     solve the case it appears to solve - a responder with no methods needs a
 *     device THEY hold and can verify. The admin's lever is a reminder, not a
 *     keyboard, and the assertions below are structural (no form controls, no
 *     table over a method model) rather than copy-deep, because the next person
 *     to be tempted will add a button, not a sentence.
 *
 *   - AN ADMIN READING SOMEBODY ELSE'S PHONE NUMBER, which is the same defect
 *     one step earlier and is what this page originally did. The seven method
 *     models are scoped to the person who owns the device - the columns behind
 *     them are the raw number, the webhook bearer url, the push device token,
 *     the telegram chat id and the verification code - and that scope was
 *     briefly widened so this page could build its rule form's method dropdown.
 *     It is back, and this page now reads NO method model at all: everything it
 *     knows about methods, the card and the dropdown alike, comes from the
 *     readiness payload, masked server-side. The assertion is about the request,
 *     not the render, because a component that asks is already wrong even if it
 *     is refused.
 *
 *   - A LEAKED IDENTIFIER. Every method fixture carries its raw value alongside
 *     the masked one under three plausible field names, so a component that
 *     starts reading `identifier`, or a parse that starts copying unknown keys
 *     through, fails here. This is a second barrier on purpose: the server-side
 *     masking tests prove the service masks, these prove the browser never
 *     un-masks.
 *
 * The page is never the gate. POST and PATCH on /api/user-notification-rule stay
 * reachable with any member session, so nothing here is a security boundary -
 * it is the surface declining to draw controls the server would refuse, and the
 * assertions are written in those terms.
 */

const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";
const SIGNED_IN_USER_ID_STRING: string = "20000000-0000-4000-8000-000000000002";
const TARGET_USER_ID_STRING: string = "30000000-0000-4000-8000-000000000003";

/*
 * Two disjoint sets. Incident severities and alert severities are two different
 * tables, and a fixture that reused an id between them could not tell a table
 * that enumerated the wrong model from one that enumerated the right one.
 */
const INCIDENT_SEVERITY_ONE_ID: string = "41111111-1111-4111-8111-111111111111";
const INCIDENT_SEVERITY_TWO_ID: string = "42222222-2222-4222-8222-222222222222";
const ALERT_SEVERITY_ONE_ID: string = "51111111-1111-4111-8111-111111111111";
const ALERT_SEVERITY_TWO_ID: string = "52222222-2222-4222-8222-222222222222";

const INCIDENT_SEVERITY_ONE_NAME: string = "Sev One";
const INCIDENT_SEVERITY_TWO_NAME: string = "Sev Two";
const ALERT_SEVERITY_ONE_NAME: string = "Alert One";
const ALERT_SEVERITY_TWO_NAME: string = "Alert Two";

const TARGET_USER_NAME: string = "Jane Ops";
const TARGET_USER_FIRST_NAME: string = "Jane";
const TARGET_LOGIN_EMAIL: string = "jane.ops@example.com";

/*
 * The values that must never survive the trip to the DOM. They are planted
 * INSIDE the readiness payload, on the same objects that carry the masked ones,
 * so none of this is a tautology.
 */
const RAW_EMAIL: string = "jane.ops.personal@example.com";
const RAW_PHONE: string = "+15551234821";
const RAW_TELEGRAM: string = "@janeops_oncall";
const RAW_WEBHOOK_URL: string = "https://hooks.example.com/T0P-53CR3T-T0K3N";

/*
 * The id of each method ROW - UserEmail._id, UserSMS._id - which is exactly what
 * UserNotificationRule.userEmailId / userSmsId reference. It is the one field on
 * the readiness payload that is not for display: it is what lets this page point
 * a rule AT a method without reading that method's row.
 *
 * A foreign key is not a secret. It is stored in plain sight on every rule its
 * owner already has, and it addresses nothing on its own - nobody is paged by a
 * uuid. Carrying it beside the mask is the whole of how the dropdown works.
 */
const EMAIL_METHOD_ID: string = "60000000-0000-4000-8000-000000000001";
const SMS_METHOD_ID: string = "60000000-0000-4000-8000-000000000002";
const TELEGRAM_METHOD_ID: string = "60000000-0000-4000-8000-000000000003";

// Exactly the shapes OnCallReadinessService.maskIdentifier emits.
const MASKED_EMAIL: string = "j•••@example.com";
const MASKED_PHONE: string = "+1 ••• ••• 4821";
const MASKED_TELEGRAM: string = "@ja•••";

const ALL_RAW_IDENTIFIERS: Array<string> = [
  RAW_EMAIL,
  RAW_PHONE,
  RAW_TELEGRAM,
  RAW_WEBHOOK_URL,
];

/*
 * Anything shaped like a whole address or a whole phone number. The masked forms
 * deliberately match neither: a bullet is not a local-part character, and four
 * trailing digits are too few to be a number. Un-mask any one identifier and
 * both patterns start hitting.
 */
const UNMASKED_EMAIL_PATTERN: RegExp =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UNMASKED_PHONE_PATTERN: RegExp = /\+?\d[\d\s().-]{6,}\d/;

type ReadErrorMessageFunction = (error: unknown) => string;

const readErrorMessage: ReadErrorMessageFunction = (error: unknown): string => {
  const message: unknown = (error as { message?: unknown } | null)?.message;

  return typeof message === "string" && message ? message : "Could not load";
};

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();

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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return apiGetMock(...args);
      },
      /*
       * Both spellings are used by the page and they are handed different
       * things - the identity read routes an Exception through
       * getFriendlyErrorMessage, the readiness read routes an HTTPErrorResponse
       * through getFriendlyMessage. Reading `.message` off either covers both,
       * because HTTPErrorResponse exposes the server's message under exactly
       * that name, and surfacing the real text rather than a fixed string is
       * what makes an error-state assertion mean anything.
       */
      getFriendlyMessage: (error: unknown) => {
        return readErrorMessage(error);
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return readErrorMessage(error);
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

/*
 * A stand-in ModelTable that records the props it was handed. Rendering the real
 * one would drag in the pager, the facet bar and the URL state, none of which
 * this file is about - what matters is which MODEL each table is mounted over,
 * the query it filters on, the row it builds on create, the affordances it is
 * given and the key it stores preferences under.
 */
interface CapturedFormField {
  field?: Record<string, true> | undefined;
  overrideField?: Record<string, true> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  doNotShowWhenCreating?: boolean | undefined;
}

interface CapturedColumn {
  title: string;
  /*
   * Captured because a column is a REQUEST as well as a renderer: ModelTable
   * unions every column's `field` with `selectMoreFields` to build the
   * projection it sends. A guard applied to only one of the two still puts the
   * other on the wire.
   */
  field: Record<string, unknown>;
  getElement?: ((item: UserNotificationRule) => ReactElement) | undefined;
}

interface CapturedTableProps {
  modelType: unknown;
  userPreferencesKey: string;
  query: Record<string, ObjectID | NotificationRuleType | undefined>;
  onBeforeCreate: (
    model: UserNotificationRule,
    miscDataProps: Record<string, unknown>,
  ) => Promise<UserNotificationRule>;
  isCreateable: boolean;
  isDeleteable: boolean;
  isEditable: boolean;
  createVerb: string;
  sortBy: string;
  sortOrder: SortOrder;
  id: string;
  name: string;
  noItemsMessage: string;
  singularName?: string | undefined;
  selectMoreFields: Record<string, unknown>;
  formFields: Array<CapturedFormField>;
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

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import UserViewNotificationRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/NotificationRules";
import AlertOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/AlertOnCallRules";
import EpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/EpisodeOnCallRules";
import IncidentEpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentEpisodeOnCallRules";
import IncidentOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentOnCallRules";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Email from "../../../Types/Email";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const SIGNED_IN_USER_ID: ObjectID = new ObjectID(SIGNED_IN_USER_ID_STRING);

/*
 * The seven models only their owner may read. They are asserted as a SET because
 * which one an admin surface reaches for hardly matters - every one of them
 * carries a raw identifier and most carry a credential.
 */
const NOTIFICATION_METHOD_MODELS: Array<unknown> = [
  UserEmail,
  UserSMS,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserWebhook,
];

/*
 * The RELATION spelling of those same seven, as they appear in a nested select
 * on UserNotificationRule. Selecting any of them pulls a column out of the
 * method model itself - the address, the number, the handle - through a table
 * an administrator may read and which is not row-scoped for them. It is the
 * second door into the room NOTIFICATION_METHOD_MODELS guards, and it does not
 * look like a request at all.
 */
const METHOD_RELATION_KEYS: Array<string> = [
  "userEmail",
  "userSms",
  "userCall",
  "userPush",
  "userWhatsApp",
  "userTelegram",
  "userWebhook",
];

/* Every foreign key a rule can point a method at. */
const METHOD_FOREIGN_KEYS: Array<keyof UserNotificationRule> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userPushId",
  "userWhatsAppId",
  "userTelegramId",
  "userWebhookId",
];

type SeverityModelType = { new (): IncidentSeverity | AlertSeverity };
type SeverityForeignKeyColumn = "incidentSeverityId" | "alertSeverityId";

interface SeveritySpec {
  id: string;
  name: string;
}

const INCIDENT_SEVERITY_SPECS: Array<SeveritySpec> = [
  { id: INCIDENT_SEVERITY_ONE_ID, name: INCIDENT_SEVERITY_ONE_NAME },
  { id: INCIDENT_SEVERITY_TWO_ID, name: INCIDENT_SEVERITY_TWO_NAME },
];

const ALERT_SEVERITY_SPECS: Array<SeveritySpec> = [
  { id: ALERT_SEVERITY_ONE_ID, name: ALERT_SEVERITY_ONE_NAME },
  { id: ALERT_SEVERITY_TWO_ID, name: ALERT_SEVERITY_TWO_NAME },
];

type BuildSeverities = (
  modelType: SeverityModelType,
  specs: Array<SeveritySpec>,
) => Array<IncidentSeverity | AlertSeverity>;

const buildSeverities: BuildSeverities = (
  modelType: SeverityModelType,
  specs: Array<SeveritySpec>,
): Array<IncidentSeverity | AlertSeverity> => {
  return specs.map((spec: SeveritySpec) => {
    const severity: IncidentSeverity | AlertSeverity = new modelType();
    severity._id = spec.id;
    severity.name = spec.name;
    return severity;
  });
};

/*
 * ------------------------------------------------------------------ *
 * The readiness payload
 * ------------------------------------------------------------------
 */

interface MethodSpec {
  methodId: string;
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
  // The value a leaky server - or a leaky future refactor - would hand over.
  leakedRawValue: string;
}

type MethodJsonFunction = (spec: MethodSpec) => JSONObject;

const methodJson: MethodJsonFunction = (spec: MethodSpec): JSONObject => {
  return {
    methodId: spec.methodId,
    methodType: spec.methodType,
    maskedIdentifier: spec.maskedIdentifier,
    isVerified: spec.isVerified,
    /*
     * Three plausible spellings of the same mistake, planted at once. None is
     * part of the frozen contract, so the parse drops all three and nothing
     * downstream has an unmasked value available to render by accident.
     */
    identifier: spec.leakedRawValue,
    rawIdentifier: spec.leakedRawValue,
    webhookUrl: RAW_WEBHOOK_URL,
  };
};

const VERIFIED_EMAIL_METHOD: JSONObject = methodJson({
  methodId: EMAIL_METHOD_ID,
  methodType: "Email",
  maskedIdentifier: MASKED_EMAIL,
  isVerified: true,
  leakedRawValue: RAW_EMAIL,
});

const VERIFIED_SMS_METHOD: JSONObject = methodJson({
  methodId: SMS_METHOD_ID,
  methodType: "SMS",
  maskedIdentifier: MASKED_PHONE,
  isVerified: true,
  leakedRawValue: RAW_PHONE,
});

const UNVERIFIED_TELEGRAM_METHOD: JSONObject = methodJson({
  methodId: TELEGRAM_METHOD_ID,
  methodType: "Telegram",
  maskedIdentifier: MASKED_TELEGRAM,
  isVerified: false,
  leakedRawValue: RAW_TELEGRAM,
});

/*
 * A coverage list with a hole in it, banded by the same disjoint severity ids
 * the tables use, so the grid on screen and the tables underneath are talking
 * about the same project.
 */
const COVERAGE: JSONArray = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: INCIDENT_SEVERITY_ONE_ID,
    severityName: INCIDENT_SEVERITY_ONE_NAME,
    hasRule: true,
    isOptOut: null,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: INCIDENT_SEVERITY_TWO_ID,
    severityName: INCIDENT_SEVERITY_TWO_NAME,
    hasRule: false,
    isOptOut: null,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityId: ALERT_SEVERITY_ONE_ID,
    severityName: ALERT_SEVERITY_ONE_NAME,
    hasRule: true,
    isOptOut: null,
  },
  {
    ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    hasRule: true,
    isOptOut: null,
  },
];

interface ReadinessOptions {
  status?: string | undefined;
  methods?: JSONArray | undefined;
  reasons?: Array<string> | undefined;
}

type ReadinessJsonFunction = (options?: ReadinessOptions) => JSONObject;

/*
 * The per-user endpoint returns ONE user, not a summary - the page wraps it as
 * the one-element `users` list the shared parser expects, which is the whole
 * reason this fixture is a bare user object rather than a summary.
 */
const readinessJson: ReadinessJsonFunction = (
  options: ReadinessOptions = {},
): JSONObject => {
  return {
    userId: TARGET_USER_ID_STRING,
    userName: TARGET_USER_NAME,
    userEmail: TARGET_LOGIN_EMAIL,
    status: options.status ?? "PartiallyReady",
    methods: options.methods ?? [
      VERIFIED_EMAIL_METHOD,
      VERIFIED_SMS_METHOD,
      UNVERIFIED_TELEGRAM_METHOD,
    ],
    coverage: COVERAGE,
    reasons: options.reasons ?? [
      `No notification rule for incidents at ${INCIDENT_SEVERITY_TWO_NAME}.`,
    ],
    reachedVia: ["Team"],
  };
};

const NO_METHODS_READINESS: JSONObject = readinessJson({
  status: "NotReachable",
  methods: [],
  reasons: ["No verified notification method on this account."],
});

/*
 * ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------
 */

type RespondWithReadinessFunction = (payload: JSONObject) => void;

const respondWithReadiness: RespondWithReadinessFunction = (
  payload: JSONObject,
): void => {
  apiGetMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, payload, {}) as never,
  );
};

type SetUpListsFunction = (teamMembers: Array<TeamMember>) => void;

const setUpLists: SetUpListsFunction = (
  teamMembers: Array<TeamMember>,
): void => {
  getListMock.mockImplementation((data: any) => {
    if (data.modelType === IncidentSeverity) {
      return Promise.resolve({
        data: buildSeverities(IncidentSeverity, INCIDENT_SEVERITY_SPECS),
        count: INCIDENT_SEVERITY_SPECS.length,
        skip: 0,
        limit: INCIDENT_SEVERITY_SPECS.length,
      });
    }

    if (data.modelType === AlertSeverity) {
      return Promise.resolve({
        data: buildSeverities(AlertSeverity, ALERT_SEVERITY_SPECS),
        count: ALERT_SEVERITY_SPECS.length,
        skip: 0,
        limit: ALERT_SEVERITY_SPECS.length,
      });
    }

    if (data.modelType === TeamMember) {
      return Promise.resolve({
        data: teamMembers,
        count: teamMembers.length,
        skip: 0,
        limit: 1,
      });
    }

    /*
     * Anything else, INCLUDING the seven notification-method models - which this
     * page must never ask for. A non-empty answer here would make a leak look
     * like a feature working, so the fallback stays empty and the assertion that
     * matters is about the request rather than the response: see "never reads a
     * notification method model" below.
     */
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
};

type BuildTeamMemberFunction = () => TeamMember;

const buildTeamMember: BuildTeamMemberFunction = (): TeamMember => {
  const user: User = new User();
  user._id = TARGET_USER_ID_STRING;
  user.name = new Name(TARGET_USER_NAME);
  user.email = new Email(TARGET_LOGIN_EMAIL);

  const member: TeamMember = new TeamMember();
  member.user = user;

  return member;
};

const pageProps: PageComponentProps = {
  pageRoute: new Route("/users/notification-rules"),
  currentProject: null,
  hasPaymentMethod: false,
};

type RenderAdminPageFunction = (
  targetUserId?: string | undefined,
) => Promise<HTMLElement>;

/*
 * The user id is read off the URL at offset 1 - this is a sub-page, so the last
 * segment is "notification-rules" and the id is the one before it. Driving that
 * through a real jsdom URL rather than a stub is deliberate: reading the wrong
 * offset yields an ObjectID of the literal string "notification-rules", which
 * every assertion about whose rules these are would then fail on.
 */
const renderAdminPage: RenderAdminPageFunction = async (
  targetUserId: string = TARGET_USER_ID_STRING,
): Promise<HTMLElement> => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID_STRING}/users/${targetUserId}/notification-rules`,
  );

  const { container } = render(<UserViewNotificationRules {...pageProps} />);

  await waitFor((): void => {
    expect(apiGetMock).toHaveBeenCalled();
  });

  return container;
};

type RenderAdminPageWithTablesFunction = () => Promise<HTMLElement>;

const renderAdminPageWithTables: RenderAdminPageWithTablesFunction =
  async (): Promise<HTMLElement> => {
    const container: HTMLElement = await renderAdminPage();

    await waitFor((): void => {
      expect(capturedTables).toHaveLength(8);
    });

    return container;
  };

type RenderSelfServePageFunction = (
  Page: FunctionComponent<PageComponentProps>,
) => Promise<void>;

const renderSelfServePage: RenderSelfServePageFunction = async (
  Page: FunctionComponent<PageComponentProps>,
): Promise<void> => {
  render(<Page {...pageProps} />);

  await waitFor((): void => {
    expect(capturedTables).toHaveLength(2);
  });
};

type TablesForFunction = (
  ruleType: NotificationRuleType,
) => Array<CapturedTableProps>;

/*
 * Four components mount at once and each resolves its own fetches, so the order
 * capturedTables ends up in is not something to assert against. The rule type on
 * the query is the stable handle.
 */
const tablesFor: TablesForFunction = (
  ruleType: NotificationRuleType,
): Array<CapturedTableProps> => {
  return capturedTables.filter((table: CapturedTableProps) => {
    return table.query["ruleType"] === ruleType;
  });
};

type GetCapturedTablesFunction = () => Array<CapturedTableProps>;

/*
 * The captured list is REPLACED between tests rather than emptied in place, so
 * a closure built inside the `for` loops below would otherwise read whichever
 * array happened to be bound when the loop ran. Going through a stable function
 * makes each test see the list as it stands when that test executes, which is
 * also what stops eslint's no-loop-func from being right about it.
 */
const getCapturedTables: GetCapturedTablesFunction =
  (): Array<CapturedTableProps> => {
    return capturedTables;
  };

/*
 * The most recent props each table was rendered with, keyed by the preferences
 * key that already uniquely identifies a table on this page.
 *
 * The page renders its tables as soon as it knows WHO it is about and re-renders
 * them when readiness lands, so `capturedTables` legitimately holds two entries
 * per table. Assertions about copy that depends on the readiness payload - the
 * empty-state sentence, which changes sign with the project's fallback switch -
 * have to read the settled render rather than whichever one happened to be
 * first.
 */
type LatestTablesFunction = () => Array<CapturedTableProps>;

const latestTables: LatestTablesFunction = (): Array<CapturedTableProps> => {
  const byKey: Map<string, CapturedTableProps> = new Map<
    string,
    CapturedTableProps
  >();

  for (const table of capturedTables) {
    byKey.set(table.userPreferencesKey, table);
  }

  return [...byKey.values()];
};

type FormFieldForFunction = (
  table: CapturedTableProps,
  key: string,
) => CapturedFormField;

/*
 * A form field by the column (or override key) it writes. Which columns the
 * form offers is the whole question on the edit path - the server decides what
 * it will accept from the column access control, and a field for anything else
 * is a control that is refused or, worse, silently dropped.
 */
const formFieldFor: FormFieldForFunction = (
  table: CapturedTableProps,
  key: string,
): CapturedFormField => {
  const field: CapturedFormField | undefined = table.formFields.find(
    (candidate: CapturedFormField): boolean => {
      return Boolean(
        candidate.field?.[key] ||
          candidate.overrideField?.[key] ||
          candidate.overrideFieldKey === key,
      );
    },
  );

  if (!field) {
    throw new Error(`no form field for ${key}`);
  }

  return field;
};

type FormFieldKeysFunction = (table: CapturedTableProps) => Array<string>;

const formFieldKeys: FormFieldKeysFunction = (
  table: CapturedTableProps,
): Array<string> => {
  return table.formFields.map((field: CapturedFormField): string => {
    return (
      field.overrideFieldKey ||
      Object.keys(field.field || field.overrideField || {})[0] ||
      ""
    );
  });
};

type MethodOptionsForFunction = (
  table: CapturedTableProps,
) => Array<{ label: string; value: string }>;

/*
 * What the create form's method dropdown is offering. This is the surface the
 * widening was done FOR, so it is the one that has to be shown working without
 * it: masked labels, real ids, and not one request for a method row.
 */
const methodOptionsFor: MethodOptionsForFunction = (
  table: CapturedTableProps,
): Array<{ label: string; value: string }> => {
  return formFieldFor(table, "notificationMethod").dropdownOptions || [];
};

type MethodColumnsSetFunction = (
  rule: UserNotificationRule,
) => Array<{ column: string; value: string }>;

const methodColumnsSet: MethodColumnsSetFunction = (
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

type RequestedModelTypesFunction = () => Array<unknown>;

const requestedModelTypes: RequestedModelTypesFunction = (): Array<unknown> => {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0].modelType;
  });
};

type ColumnNamedFunction = (
  table: CapturedTableProps,
  title: string,
) => CapturedColumn;

const columnNamed: ColumnNamedFunction = (
  table: CapturedTableProps,
  title: string,
): CapturedColumn => {
  const column: CapturedColumn | undefined = table.columns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  if (!column) {
    throw new Error(`no column titled ${title}`);
  }

  return column;
};

type MatrixForFunction = (label: string) => HTMLElement;

const matrixFor: MatrixForFunction = (label: string): HTMLElement => {
  return screen.getByRole("table", { name: `${label} coverage` });
};

type CardNamedFunction = (title: string) => HTMLElement;

const cardNamed: CardNamedFunction = (title: string): HTMLElement => {
  const card: HTMLElement | null = screen
    .getByText(title)
    .closest('[data-testid="card"]') as HTMLElement | null;

  if (!card) {
    throw new Error(`no card titled ${title}`);
  }

  return card;
};

type MailtoHrefInFunction = (element: HTMLElement) => string;

const mailtoHrefIn: MailtoHrefInFunction = (element: HTMLElement): string => {
  const href: string | null | undefined = element
    .querySelector('a[href^="mailto:"]')
    ?.getAttribute("href");

  if (!href) {
    throw new Error("no mailto link");
  }

  return decodeURIComponent(href);
};

/*
 * ------------------------------------------------------------------ *
 * The four rule types, stated as two independent axes
 * ------------------------------------------------------------------
 */

interface RuleTypeCase {
  label: string;
  ruleType: NotificationRuleType;
  Page: FunctionComponent<PageComponentProps>;
  severityModelType: SeverityModelType;
  wrongSeverityModelType: SeverityModelType;
  foreignKeyColumn: SeverityForeignKeyColumn;
  wrongForeignKeyColumn: SeverityForeignKeyColumn;
  severitySpecs: Array<SeveritySpec>;
  /* The pre-extraction card copy, reproduced from the deleted pages. */
  getTitle: (severityName: string) => string;
  getDescription: (severityName: string) => string;
}

/*
 * Note the crossed pair: the ALERT episode page reads AlertSeverity while the
 * INCIDENT episode page reads IncidentSeverity. That crossing is the whole
 * reason the severity model and the foreign key column are two separate props,
 * and a case table is the only shape in which an accidental re-derivation of one
 * from the other fails on exactly one row rather than passing on all four.
 */
const RULE_TYPE_CASES: Array<RuleTypeCase> = [
  {
    label: "incident",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    Page: IncidentOnCallRules,
    severityModelType: IncidentSeverity,
    wrongSeverityModelType: AlertSeverity,
    foreignKeyColumn: "incidentSeverityId",
    wrongForeignKeyColumn: "alertSeverityId",
    severitySpecs: INCIDENT_SEVERITY_SPECS,
    getTitle: (severityName: string): string => {
      return `${severityName} Severity:  When I am on call and ${severityName} is assigned to me...`;
    },
    getDescription: (severityName: string): string => {
      return `Here are the rules when you are on call and ${severityName} is assigned to you.`;
    },
  },
  {
    label: "incident episode",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    Page: IncidentEpisodeOnCallRules,
    severityModelType: IncidentSeverity,
    wrongSeverityModelType: AlertSeverity,
    foreignKeyColumn: "incidentSeverityId",
    wrongForeignKeyColumn: "alertSeverityId",
    severitySpecs: INCIDENT_SEVERITY_SPECS,
    getTitle: (severityName: string): string => {
      return `${severityName} Severity Episode:  When I am on call and ${severityName} severity episode is assigned to me...`;
    },
    getDescription: (severityName: string): string => {
      return `Here are the rules when you are on call and ${severityName} Severity episode is assigned to you.`;
    },
  },
  {
    label: "alert",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    Page: AlertOnCallRules,
    severityModelType: AlertSeverity,
    wrongSeverityModelType: IncidentSeverity,
    foreignKeyColumn: "alertSeverityId",
    wrongForeignKeyColumn: "incidentSeverityId",
    severitySpecs: ALERT_SEVERITY_SPECS,
    getTitle: (severityName: string): string => {
      return `${severityName} Severity Alert:  When I am on call and ${severityName} severity alert is assigned to me...`;
    },
    getDescription: (severityName: string): string => {
      return `Here are the rules when you are on call and ${severityName} Severity alert is assigned to you.`;
    },
  },
  {
    label: "alert episode",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    Page: EpisodeOnCallRules,
    severityModelType: AlertSeverity,
    wrongSeverityModelType: IncidentSeverity,
    foreignKeyColumn: "alertSeverityId",
    wrongForeignKeyColumn: "incidentSeverityId",
    severitySpecs: ALERT_SEVERITY_SPECS,
    getTitle: (severityName: string): string => {
      return `${severityName} Severity Episode:  When I am on call and ${severityName} severity episode is assigned to me...`;
    },
    getDescription: (severityName: string): string => {
      return `Here are the rules when you are on call and ${severityName} Severity episode is assigned to you.`;
    },
  },
];

const ADMIN_PREFERENCES_PREFIX: string = "admin-user-notification-rules";
const SELF_SERVE_PREFERENCES_PREFIX: string = "user-notification-rules-table";

const NO_ITEMS_MESSAGE: string =
  "No notification rules found for this user. Please add one to receive notifications.";

beforeEach((): void => {
  capturedTables = [];

  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  apiGetMock.mockReset();

  setUpLists([buildTeamMember()]);

  const project: Project = new Project();
  project.disableOnCallNotificationFallback = false;
  getItemMock.mockResolvedValue(project as never);

  getCommonHeadersMock.mockReturnValue({} as never);
  respondWithReadiness(readinessJson());

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(SIGNED_IN_USER_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the shared rules table, as the admin page wires it", () => {
  for (const testCase of RULE_TYPE_CASES) {
    test(`${testCase.label} rules are banded by their own severity model and foreign key column`, async () => {
      await renderAdminPageWithTables();

      const tables: Array<CapturedTableProps> = tablesFor(testCase.ruleType);

      expect(tables).toHaveLength(testCase.severitySpecs.length);

      tables.forEach((table: CapturedTableProps, index: number) => {
        /*
         * The id proves BOTH axes at once. The two severity models return
         * disjoint id sets, so a table that enumerated the other model would
         * carry an id from the other set even with the right column name, and a
         * table that wrote the other column would not carry the id at all.
         */
        expect(table.query[testCase.foreignKeyColumn]?.toString()).toBe(
          testCase.severitySpecs[index]!.id,
        );

        /*
         * Absent, not merely undefined. A query that carries the other column at
         * all is the shape that reads as "no severity filter" once serialised
         * onto the wire, and a table with no severity filter lists every
         * severity's rules - a Sev 4 rule shown, and edited, as if it were Sev 1.
         */
        expect(Object.keys(table.query)).not.toContain(
          testCase.wrongForeignKeyColumn,
        );

        expect(table.query["projectId"]?.toString()).toBe(PROJECT_ID_STRING);
      });
    });

    test(`${testCase.label} rules stamp the same column on a newly created rule`, async () => {
      await renderAdminPageWithTables();

      const table: CapturedTableProps = tablesFor(testCase.ruleType)[0]!;

      const created: UserNotificationRule = await table.onBeforeCreate(
        new UserNotificationRule(),
        {},
      );

      expect(created.ruleType).toBe(testCase.ruleType);
      expect(created.projectId?.toString()).toBe(PROJECT_ID_STRING);

      /*
       * The created row has to land in the table that created it. A rule
       * stamped with one column while the table filters on the other simply
       * vanishes from the surface that made it, and the admin adds it again.
       */
      expect(created[testCase.foreignKeyColumn]?.toString()).toBe(
        testCase.severitySpecs[0]!.id,
      );
      expect(created[testCase.wrongForeignKeyColumn]).toBeUndefined();

      // Never the admin's own id. This is the paging hijack in one line.
      expect(created.userId?.toString()).toBe(TARGET_USER_ID_STRING);
    });
  }

  test("every table is scoped to the user in the URL, never to the signed-in admin", async () => {
    await renderAdminPageWithTables();

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.query["userId"]?.toString()).toBe(TARGET_USER_ID_STRING);
      expect(table.query["userId"]?.toString()).not.toBe(
        SIGNED_IN_USER_ID_STRING,
      );
    });

    /*
     * And nothing this page reads is scoped to the ADMIN instead. A read of the
     * signed-in user's own rows would be the shape of a component that had
     * quietly fallen back to "well, load MY methods then" - which is the paging
     * hijack this phase guards against, offered as a convenience.
     */
    const queriedUserIds: Array<string | undefined> =
      getListMock.mock.calls.map((call: Array<any>) => {
        return call[0].query?.userId?.toString();
      });

    expect(queriedUserIds).not.toContain(SIGNED_IN_USER_ID_STRING);
    expect(queriedUserIds).toContain(TARGET_USER_ID_STRING);
  });

  test("never reads a notification method model", async () => {
    await renderAdminPageWithTables();

    /*
     * The redesign, in one assertion.
     *
     * These seven models are readable only by the person who owns the row, and
     * that is the whole protection: the table scope pins every read to the
     * caller. Widening it so this page could fill a dropdown exposed the raw
     * email and phone, the webhook url, the push device token, the telegram chat
     * id and the verification code of every member, and no column-level guard
     * held - it could not see nested relation selects, could not see `query`,
     * and could not see columns injected after it ran.
     *
     * This asserts the REQUEST, not the render. A page that asks and is refused
     * has still been written on the assumption that it may ask, and the next
     * person to widen the scope makes it work.
     */
    const requested: Array<unknown> = requestedModelTypes();

    for (const methodModel of NOTIFICATION_METHOD_MODELS) {
      expect(requested).not.toContain(methodModel);
    }

    // Not vacuous: it does read, just not those.
    expect(requested).toContain(TeamMember);
    expect(requested).toContain(IncidentSeverity);
    expect(requested).toContain(AlertSeverity);
  });

  test("asks the server for no column of a method model either", async () => {
    await renderAdminPageWithTables();

    /*
     * The same rule as the test above, applied to the OTHER way this page could
     * reach a method row - and the way it actually did.
     *
     * `requestedModelTypes` catches a direct getList over UserSMS. It does not
     * catch a nested relation select on the RULE, which is what
     * NotificationMethodUtil.getSelectForNotificationMethods produces
     * (`{ userSms: { phone: true } }`) and what this table used to ask for in
     * both its `selectMoreFields` and its method column. That select reaches the
     * raw phone number through UserNotificationRule - a table an administrator
     * IS allowed to read, and which is deliberately not row-scoped for them -
     * and the permission machinery permits it at every step: the nested key is
     * checked against the rule's own `userSms` column, whose read list is
     * [Permission.CurrentUser] and CurrentUser is auto-granted to every
     * authenticated caller; then `canReadOnRelationQuery: true` on UserSMS.phone
     * short-circuits the related model's own read list entirely.
     *
     * So the readiness card masked every identifier and the table one card below
     * printed them in full.
     */
    for (const table of latestTables()) {
      const projection: Array<string> = Object.keys(table.selectMoreFields);

      for (const column of table.columns) {
        projection.push(...Object.keys(column.field || {}));
      }

      for (const relation of METHOD_RELATION_KEYS) {
        expect(projection).not.toContain(relation);
      }

      /*
       * The ids instead - which carry nothing, are admin-readable by design, and
       * are what correlate a rule with the masked readiness entry.
       */
      expect(projection).toContain("userSmsId");
      expect(projection).toContain("userEmailId");
      expect(projection).toContain("isOptOut");
    }
  });

  test("labels a listed rule with the masked identifier, not the raw one", async () => {
    await renderAdminPageWithTables();

    const methodColumn: CapturedColumn = columnNamed(
      latestTables()[0]!,
      "Notification Method",
    );

    const rule: UserNotificationRule = new UserNotificationRule();
    rule.userSmsId = new ObjectID(SMS_METHOD_ID);
    rule.notifyAfterMinutes = 5;

    const { container } = render(methodColumn.getElement!(rule));

    /*
     * End to end: the page never read UserSMS, yet the cell still names the
     * method the rule pages - because the id it DID read is matched back onto
     * the masked readiness entry. That is the whole mechanism in one row.
     */
    expect(container.textContent).toContain(MASKED_PHONE);
    expect(container.textContent).not.toContain(RAW_PHONE);
    expect(container.textContent).not.toMatch(UNMASKED_PHONE_PATTERN);
  });

  test("builds the rule form's method dropdown out of the masked readiness payload", async () => {
    await renderAdminPageWithTables();

    latestTables().forEach((table: CapturedTableProps) => {
      /*
       * Masked label, real foreign key. The admin picks "SMS: +1 ••• ••• 4821"
       * and the form submits `userSmsId`, so the page can point a rule at a
       * device whose number it was never told.
       */
      expect(methodOptionsFor(table)).toEqual([
        { label: `Email: ${MASKED_EMAIL}`, value: EMAIL_METHOD_ID },
        { label: `SMS: ${MASKED_PHONE}`, value: SMS_METHOD_ID },
      ]);
    });
  });

  test("the dropdown withholds the unverified method", async () => {
    await renderAdminPageWithTables();

    const values: Array<string> = methodOptionsFor(latestTables()[0]!).map(
      (option: { label: string; value: string }) => {
        return option.value;
      },
    );

    /*
     * Telegram is unverified in the fixture. The self-serve pages filter
     * `isVerified: true` in their own queries, so offering it here would be the
     * two surfaces disagreeing about what is pickable - and a rule pointed at an
     * unverified device pages nothing at all.
     */
    expect(values).not.toContain(TELEGRAM_METHOD_ID);
  });

  test("a rule created from that dropdown points at the method's own column", async () => {
    await renderAdminPageWithTables();

    const created: UserNotificationRule =
      await latestTables()[0]!.onBeforeCreate(new UserNotificationRule(), {
        notificationMethod: SMS_METHOD_ID,
      });

    /*
     * The seven foreign keys are mutually exclusive, and writing an SMS id into
     * `userEmailId` would page an address instead of a phone without erroring
     * anywhere, so the whole set is asserted rather than the one column.
     */
    expect(methodColumnsSet(created)).toEqual([
      { column: "userSmsId", value: SMS_METHOD_ID },
    ]);
    expect(created.userId?.toString()).toBe(TARGET_USER_ID_STRING);
  });

  test("with readiness unavailable the dropdown is empty rather than fetched", async () => {
    apiGetMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "readiness is down" }, {}) as never,
    );

    await renderAdminPageWithTables();

    /*
     * The failure mode this seam had to be designed around. Readiness is the
     * only source of methods here, so when it is down there are none to offer -
     * and "then read the models directly" is not a fallback, it is seven refused
     * requests that would replace the rule tables with an error page. The rules
     * stay editable; only the method choice is missing.
     */
    for (const methodModel of NOTIFICATION_METHOD_MODELS) {
      expect(requestedModelTypes()).not.toContain(methodModel);
    }

    latestTables().forEach((table: CapturedTableProps) => {
      expect(methodOptionsFor(table)).toEqual([]);
      expect(table.isCreateable).toBe(true);
    });
  });

  test("keeps the severity id in every preferences key and namespaces the admin surface away from user settings", async () => {
    await renderAdminPageWithTables();

    const adminKeys: Array<string> = capturedTables.map(
      (table: CapturedTableProps) => {
        return table.userPreferencesKey;
      },
    );

    for (const testCase of RULE_TYPE_CASES) {
      const keys: Array<string> = tablesFor(testCase.ruleType).map(
        (table: CapturedTableProps) => {
          return table.userPreferencesKey;
        },
      );

      testCase.severitySpecs.forEach((spec: SeveritySpec, index: number) => {
        expect(keys[index]).toBe(
          `${ADMIN_PREFERENCES_PREFIX}-${testCase.ruleType}-${spec.id}`,
        );
      });
    }

    /*
     * Eight tables on one route. Two sharing a key would share a stored page
     * size and a slice of the URL state, so paging one would repaginate the
     * other - invisible to the type checker, and the reason the id is in there.
     */
    expect(new Set(adminKeys).size).toBe(8);

    cleanup();

    const selfServeKeys: Array<string> = [];

    for (const testCase of RULE_TYPE_CASES) {
      capturedTables = [];
      await renderSelfServePage(testCase.Page);

      capturedTables.forEach((table: CapturedTableProps) => {
        selfServeKeys.push(table.userPreferencesKey);
      });

      cleanup();
    }

    /*
     * And the admin surface has to be namespaced away from the self-serve one,
     * because both render the same component against the same rule types: a
     * shared prefix would make paging your own Sev 1 table repaginate the admin
     * table you last had open for a colleague.
     */
    expect(new Set([...adminKeys, ...selfServeKeys]).size).toBe(16);
  });

  test("never mounts a table over a notification method model", async () => {
    await renderAdminPageWithTables();

    /*
     * The structural form of "an admin may not add a method for somebody else".
     * A CRUD table over UserEmail or UserSMS is how that capability would
     * actually arrive - not as a sentence somebody deleted, but as one more
     * ModelTable next to the four that are meant to be here.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.modelType).toBe(UserNotificationRule);
    });
  });
});

describe("the self-serve settings pages are unchanged by the extraction", () => {
  for (const testCase of RULE_TYPE_CASES) {
    describe(testCase.label, () => {
      test("enumerates its own severity model and never the other one", async () => {
        await renderSelfServePage(testCase.Page);

        const requestedModelTypes: Array<unknown> = getListMock.mock.calls.map(
          (call: Array<any>) => {
            return call[0].modelType;
          },
        );

        expect(requestedModelTypes).toContain(testCase.severityModelType);
        expect(requestedModelTypes).not.toContain(
          testCase.wrongSeverityModelType,
        );
      });

      test("filters, creates and stores preferences exactly as it did before", async () => {
        await renderSelfServePage(testCase.Page);

        getCapturedTables().forEach(
          (table: CapturedTableProps, index: number): void => {
            const spec: SeveritySpec = testCase.severitySpecs[index]!;

            expect(table.query["ruleType"]).toBe(testCase.ruleType);
            expect(table.query["projectId"]?.toString()).toBe(
              PROJECT_ID_STRING,
            );
            expect(table.query["userId"]?.toString()).toBe(
              SIGNED_IN_USER_ID_STRING,
            );
            expect(table.query[testCase.foreignKeyColumn]?.toString()).toBe(
              spec.id,
            );
            expect(Object.keys(table.query)).not.toContain(
              testCase.wrongForeignKeyColumn,
            );

            // The prefix the deleted pages used, character for character.
            expect(table.userPreferencesKey).toBe(
              `${SELF_SERVE_PREFERENCES_PREFIX}-${testCase.ruleType}-${spec.id}`,
            );
          },
        );

        const created: UserNotificationRule =
          await getCapturedTables()[0]!.onBeforeCreate(
            new UserNotificationRule(),
            {
              notificationMethod: undefined,
            },
          );

        expect(created.ruleType).toBe(testCase.ruleType);
        expect(created.userId?.toString()).toBe(SIGNED_IN_USER_ID_STRING);
        expect(created.projectId?.toString()).toBe(PROJECT_ID_STRING);
        expect(created[testCase.foreignKeyColumn]?.toString()).toBe(
          testCase.severitySpecs[0]!.id,
        );
        expect(created[testCase.wrongForeignKeyColumn]).toBeUndefined();
      });

      test("renders the card copy and table contract it had before", async () => {
        await renderSelfServePage(testCase.Page);

        getCapturedTables().forEach(
          (table: CapturedTableProps, index: number): void => {
            const spec: SeveritySpec = testCase.severitySpecs[index]!;

            expect(table.cardProps.title).toBe(testCase.getTitle(spec.name));
            expect(table.cardProps.description).toBe(
              testCase.getDescription(spec.name),
            );

            /*
             * The rest of the contract the copies carried, plus the one thing
             * that deliberately changed: `isEditable` is now on. It was
             * hardcoded false, which made the row editor unreachable from every
             * one of these surfaces - so opening `notifyAfterMinutes` to update
             * bought nothing anybody could click, and changing a delay meant
             * deleting the rule and adding it back, a window during which the
             * user is not paged at all. The edit form is not "empty" as the
             * previous note assumed: it carries exactly the columns the model's
             * update access control accepts.
             */
            expect(table.isCreateable).toBe(true);
            /*
             * DELIBERATELY false. The built-in delete is switched off on these
             * tables because deleting a notification rule now goes through the
             * impact confirmation, which names how many rules disappear and
             * which severity cells lose their last delivering rule. ModelTable's
             * own dialog cannot carry that, so the guard supplies its own action
             * button instead and this flag stays off.
             *
             * If this ever reads true again, the stock "are you sure" is back and
             * a responder can delete their last rule for a severity without being
             * told - which is the failure the guard exists to prevent.
             */
            expect(table.isDeleteable).toBe(false);
            expect(table.isEditable).toBe(true);
            expect(table.createVerb).toBe("Add");
            expect(table.sortBy).toBe("notifyAfterMinutes");
            expect(table.sortOrder).toBe(SortOrder.Ascending);
            expect(table.id).toBe("notification-rules");
            expect(table.name).toBe(
              `User Settings > Notification Rules > ${spec.name}`,
            );
            expect(table.noItemsMessage).toBe(NO_ITEMS_MESSAGE);

            /*
             * And the form copy stays in the first person here, because on
             * these four pages it is true. `singularName` is left unset so the
             * modal, the create button and the delete confirmation keep saying
             * "Notification Rule" exactly as they always have.
             */
            expect(table.singularName).toBeUndefined();
            expect(formFieldFor(table, "notifyAfterMinutes").title).toBe(
              "Notify me after",
            );
            expect(formFieldFor(table, "notificationMethod").description).toBe(
              "How do you want to be notified?",
            );
          },
        );
      });
    });
  }
});

describe("the on-behalf-of banner", () => {
  test("names the person being edited and says the change is recorded and disclosed", async () => {
    const container: HTMLElement = await renderAdminPageWithTables();

    expect(container.textContent).toContain(
      `You are editing on behalf of ${TARGET_USER_NAME}`,
    );

    /*
     * Said before the click, not after. The promise itself is kept by the
     * server - UserNotificationRuleService notifies the owner of every write
     * made by anybody else, off the server-resolved actor - but an admin should
     * know that their colleague is about to get an email before they start.
     */
    expect(container.textContent).toContain("recorded in the audit log");
    expect(container.textContent).toContain(
      `${TARGET_USER_FIRST_NAME} is notified of it`,
    );
  });

  test("a viewer who may read but not edit is told so, and gets no add or remove controls", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadProjectUserNotificationRule]);

    const container: HTMLElement = await renderAdminPageWithTables();

    expect(container.textContent).toContain(
      `You are viewing ${TARGET_USER_NAME}`,
    );
    expect(container.textContent).toContain("Edit User Notification Rules");
    expect(container.textContent).not.toContain("editing on behalf of");

    /*
     * A convenience over the server's own check, never a substitute: the API
     * would refuse these writes anyway, so the page declines to draw buttons
     * that exist only to be rejected. All three affordances move together,
     * because they are one question - may this person rewrite how somebody
     * else gets paged? - and the server answers it once.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(false);
      expect(table.isDeleteable).toBe(false);
      expect(table.isEditable).toBe(false);
    });
  });

  test("a project owner keeps the controls even without the granular permission", async () => {
    /*
     * Existing teams are seeded with ROLES, never with individual granular
     * permissions, so a permission introduced in this release is held by nobody
     * until an administrator grants it. A page that checked only
     * EditProjectUserNotificationRule would be dead on arrival for every project
     * that already exists - its owner would open this page and be refused.
     */
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectOwner]);

    await renderAdminPageWithTables();

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(true);
      expect(table.isDeleteable).toBe(true);
    });
  });

  test("reading your own page never claims you are acting on somebody's behalf", async () => {
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID(TARGET_USER_ID_STRING));
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    const container: HTMLElement = await renderAdminPageWithTables();

    expect(container.textContent).toContain(
      "These are your own notification rules.",
    );
    expect(container.textContent).not.toContain("on behalf of");

    /*
     * And a member with no admin permission at all still edits their own rules
     * here, exactly as they would in User Settings - the ownership branch of
     * the permission check, which is the one every ordinary member walks.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(true);
    });
  });

  test("a member with no permission is refused, and the page reads nothing about the user", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/notification-rules`,
    );

    render(<UserViewNotificationRules {...pageProps} />);

    expect(
      await screen.findByText(/do not have permission to view this user/),
    ).toBeInTheDocument();

    /*
     * Not merely "no tables drawn": no request issued either. A refused page
     * that still fetches a colleague's readiness has already disclosed the
     * thing it declined to render.
     */
    expect(capturedTables).toHaveLength(0);
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("survives a readiness outage with the repair still on offer", async () => {
    apiGetMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "readiness is down" }, {}) as never,
    );

    const container: HTMLElement = await renderAdminPageWithTables();

    expect(container.textContent).toContain("readiness is down");
    expect(container.textContent).toContain(
      `You are editing on behalf of ${TARGET_USER_NAME}`,
    );

    /*
     * Readiness is a computed opinion; the rules underneath remain perfectly
     * editable without it. Folding the two into one state would let a readiness
     * outage take away the repair this page exists to offer.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(true);
    });

    /*
     * And it must not invent an empty method list out of a failed request. "No
     * methods" is the most alarming thing this page can print about somebody,
     * and printing it because a fetch failed sends an admin chasing an account
     * that is perfectly well configured.
     */
    expect(container.textContent).toContain(
      "Notification methods could not be loaded",
    );
    expect(container.textContent).not.toContain(
      "has no notification methods at all",
    );
  });
});

describe("notification methods are read-only", () => {
  test("lists each method masked, with its verification state", async () => {
    await renderAdminPageWithTables();

    const methods: HTMLElement = cardNamed("Notification methods");

    expect(methods.textContent).toContain(MASKED_EMAIL);
    expect(methods.textContent).toContain(MASKED_PHONE);
    expect(methods.textContent).toContain(MASKED_TELEGRAM);
    expect(methods.textContent).toContain("Verified");
    expect(methods.textContent).toContain("Unverified");

    // The asymmetry stated out loud, where somebody looking for a button is.
    expect(methods.textContent).toContain(
      "Identifiers are masked and cannot be edited from here",
    );
  });

  test("offers no control for adding a method on the user's behalf", async () => {
    await renderAdminPageWithTables();

    const methods: HTMLElement = cardNamed("Notification methods");

    /*
     * Structural rather than copy-deep, because the next person to be tempted
     * will add a button, not a sentence. Letting an admin type in a phone
     * number would point another person's pages at a device the admin controls,
     * and it would not solve the case it appears to solve: a responder with no
     * methods needs a device THEY hold and can verify.
     */
    expect(
      methods.querySelectorAll("button, input, select, textarea, form"),
    ).toHaveLength(0);

    /*
     * The only link out of this card is the mail draft. A link INTO somebody
     * else's notification-method settings would be the same capability wearing
     * a different hat.
     */
    Array.from(methods.querySelectorAll("a")).forEach((anchor: HTMLElement) => {
      expect(anchor.getAttribute("href") || "").toMatch(/^mailto:/);
    });
  });

  test("the no-methods empty state offers a reminder rather than a form", async () => {
    respondWithReadiness(NO_METHODS_READINESS);

    await renderAdminPageWithTables();

    const methods: HTMLElement = cardNamed("Notification methods");

    expect(methods.textContent).toContain("has no notification methods at all");
    expect(methods.textContent).toContain(
      `Only ${TARGET_USER_FIRST_NAME} can add one`,
    );

    // A nudge, with the link already in it - and still not a single control.
    expect(
      methods.querySelectorAll("button, input, select, textarea, form"),
    ).toHaveLength(0);

    const href: string = mailtoHrefIn(methods);

    expect(href).toContain(TARGET_LOGIN_EMAIL);
    expect(href).toContain("notification-methods");
    expect(href).toContain(
      "only you can add the device or address they send to",
    );

    /*
     * The draft has to say what is actually wrong, or it is a form letter. With
     * no method at all the consequence is not a late page, it is no page.
     */
    expect(href).toContain("dropped");
  });

  test("the rule tables stay editable while the methods stay locked", async () => {
    respondWithReadiness(NO_METHODS_READINESS);

    await renderAdminPageWithTables();

    /*
     * The whole design of this phase in one assertion: rules are the admin's to
     * repair, methods are not. A responder with no verified method still needs
     * rules waiting for the moment they add one.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isCreateable).toBe(true);
      expect(table.isDeleteable).toBe(true);
      expect(table.modelType).toBe(UserNotificationRule);
    });
  });
});

/*
 * The coverage grid is shared code now.
 *
 * CoverageMatrix, CoverageModel and buildCoverageModel started module-private
 * inside Pages/OnCallDuty/Readiness.tsx; this page imported them from a
 * Components path that did not exist, so it could not compile at all. They live
 * in Components/OnCallPolicy/Readiness/CoverageMatrix now and both surfaces
 * import them from there - which is the only arrangement in which "see the gap
 * on the readiness page, fix it here" cannot become two different opinions about
 * what a gap is.
 *
 * The assertions below are about the property that mattered enough to build the
 * model around it: incident severities and alert severities are DISJOINT id
 * sets, so one shared axis draws cells that can never exist and a reader cannot
 * tell an impossible cell from a real hole.
 */
describe("the coverage grid, now shared with the readiness page", () => {
  test("draws one matrix per severity kind", async () => {
    await renderAdminPageWithTables();

    expect(matrixFor("Incident severities")).toBeInTheDocument();
    expect(matrixFor("Alert severities")).toBeInTheDocument();
  });

  test("neither kind's severities appear under the other kind's columns", async () => {
    await renderAdminPageWithTables();

    const incidentMatrix: HTMLElement = matrixFor("Incident severities");
    const alertMatrix: HTMLElement = matrixFor("Alert severities");

    expect(
      within(incidentMatrix).getByText(INCIDENT_SEVERITY_ONE_NAME),
    ).toBeInTheDocument();
    expect(
      within(incidentMatrix).queryByText(ALERT_SEVERITY_ONE_NAME),
    ).toBeNull();

    expect(
      within(alertMatrix).getByText(ALERT_SEVERITY_ONE_NAME),
    ).toBeInTheDocument();
    expect(
      within(alertMatrix).queryByText(INCIDENT_SEVERITY_ONE_NAME),
    ).toBeNull();
  });

  test("marks the severity with no rule as a gap rather than as covered", async () => {
    await renderAdminPageWithTables();

    const incidentMatrix: HTMLElement = matrixFor("Incident severities");

    /*
     * The fixture gives Sev One a rule and Sev Two none, so exactly one cell in
     * this matrix is a hole. Counting by the cell's own title is what makes the
     * assertion about MEANING rather than about a class name.
     */
    expect(
      incidentMatrix.querySelectorAll('span[title^="No rule"]'),
    ).toHaveLength(1);
  });

  test("a severity-less rule type is listed apart from the grids", async () => {
    const container: HTMLElement = await renderAdminPageWithTables();

    /*
     * WHEN_USER_GOES_ON_CALL carries no severity at all. Putting it in a
     * severity grid would need a row for a severity it does not have, so it
     * belongs under its own heading.
     */
    expect(container.textContent).toContain("Shift changes");
  });
});

/*
 * The edit path.
 *
 * `isEditable` was hardcoded false on the ModelTable, so this page issued no
 * PATCH at all: the phase opened `notifyAfterMinutes` (and the seven method
 * foreign keys) to update behind the largest guard in the codebase, and bought
 * zero capability anybody could reach. These assertions are about the two halves
 * of making that real - the editor being on for exactly the viewers allowed to
 * use it, and the form offering exactly the columns the server will actually
 * accept on the update path.
 */
describe("the rules are editable, not merely addable and removable", () => {
  test("an admin gets the row editor on every table", async () => {
    await renderAdminPageWithTables();

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isEditable).toBe(true);
    });
  });

  test("a member editing their own rules gets it too", async () => {
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID(TARGET_USER_ID_STRING));
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    await renderAdminPageWithTables();

    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.isEditable).toBe(true);
    });
  });

  test("the form offers the delay, which is what the server lets an editor change", async () => {
    await renderAdminPageWithTables();

    const table: CapturedTableProps = capturedTables[0]!;
    const delayField: CapturedFormField = formFieldFor(
      table,
      "notifyAfterMinutes",
    );

    /*
     * `notifyAfterMinutes` is `update: [CurrentUser, ...admin]` on the model -
     * the one plain preference an editor may rewrite - so it has to survive
     * into the edit form. A field marked doNotShowWhenEditing here would leave
     * the editor with nothing to change and the PATCH with no columns, which
     * the API rejects outright.
     */
    expect(delayField.doNotShowWhenEditing).toBeFalsy();
  });

  test("the form withholds the method dropdown when editing, because update cannot carry it", async () => {
    await renderAdminPageWithTables();

    const methodField: CapturedFormField = formFieldFor(
      capturedTables[0]!,
      "notificationMethod",
    );

    /*
     * The dropdown is an override field: its value travels in `miscDataProps`
     * and is mapped onto one of the seven foreign keys by `onBeforeCreate`.
     * ModelForm calls that hook only for FormType.Create and BaseAPI.updateItem
     * never reads `miscDataProps`, so on the edit path the choice is discarded
     * in transit. Rendering it anyway would give an administrator a control
     * that accepts a new device, reports success, and leaves the rule paging
     * the old one - a worse outcome than not offering it.
     */
    expect(methodField.doNotShowWhenEditing).toBe(true);
    expect(methodField.overrideFieldKey).toBe("notificationMethod");
  });

  test("the form offers nothing the model refuses to update", async () => {
    await renderAdminPageWithTables();

    const keys: Array<string> = formFieldKeys(capturedTables[0]!);

    /*
     * Every one of these is `update: []` on UserNotificationRule: they are the
     * rule's ADDRESS - whose it is, what fires it, at which severity - and a
     * form that offered them would be offering to move somebody else's rule
     * onto a different person or a different severity band. The API would
     * refuse; the form does not ask.
     */
    for (const frozenColumn of [
      "userId",
      "user",
      "projectId",
      "ruleType",
      "incidentSeverityId",
      "alertSeverityId",
    ]) {
      expect(keys).not.toContain(frozenColumn);
    }
  });
});

/*
 * Three ways this page told the truth on one screen and not on another.
 */
describe("the page says the same thing at the moment of the write", () => {
  test("the modal, the create button and the delete prompt all name the person", async () => {
    await renderAdminPageWithTables();

    /*
     * ModelTable derives the modal title, the create button and the delete
     * confirmation from `singularName`, so setting it once puts the name on all
     * three. This is the fix for the banner problem: the on-behalf-of strip is
     * sticky but a modal covers it, and the modal is open at exactly the moment
     * an administrator is about to rewrite how a colleague gets paged.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.singularName).toBe(
        `Notification Rule for ${TARGET_USER_NAME}`,
      );
    });
  });

  test("the form fields stop speaking in the first person", async () => {
    await renderAdminPageWithTables();

    const table: CapturedTableProps = capturedTables[0]!;

    expect(formFieldFor(table, "notifyAfterMinutes").title).toBe(
      `Notify ${TARGET_USER_NAME} after`,
    );
    expect(formFieldFor(table, "notificationMethod").description).toBe(
      `How should ${TARGET_USER_NAME} be notified?`,
    );

    /*
     * "Notify me after" inside a modal opened from somebody else's page reads
     * as the admin's own configuration, which is the single mistake this whole
     * surface has to prevent.
     */
    expect(formFieldFor(table, "notifyAfterMinutes").title).not.toContain(
      " me ",
    );
  });

  test("reading your own page keeps the first person", async () => {
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID(TARGET_USER_ID_STRING));

    await renderAdminPageWithTables();

    const table: CapturedTableProps = capturedTables[0]!;

    expect(table.singularName).toBeUndefined();
    expect(formFieldFor(table, "notifyAfterMinutes").title).toBe(
      "Notify me after",
    );
  });

  test("an opt-out row is labelled rather than left blank", async () => {
    await renderAdminPageWithTables();

    const methodColumn: CapturedColumn = columnNamed(
      capturedTables[0]!,
      "Notification Method",
    );

    const optOutRule: UserNotificationRule = new UserNotificationRule();
    optOutRule.isOptOut = true;
    optOutRule.notifyAfterMinutes = 0;

    const { container } = render(methodColumn.getElement!(optOutRule));

    /*
     * An opt-out rule carries no notification method by design, so the method
     * cell renders empty - indistinguishable from a rule whose relation failed
     * to load, and from a corrupt row. An administrator who reads a blank as
     * broken deletes it, which silently turns paging back on for somebody who
     * asked for silence.
     */
    expect(container.textContent).toContain("Muted");
    expect(container.textContent).not.toBe("");
  });

  test("an ordinary rule is not labelled as muted", async () => {
    await renderAdminPageWithTables();

    const methodColumn: CapturedColumn = columnNamed(
      capturedTables[0]!,
      "Notification Method",
    );

    const plainRule: UserNotificationRule = new UserNotificationRule();
    plainRule.notifyAfterMinutes = 5;

    const { container } = render(methodColumn.getElement!(plainRule));

    expect(container.textContent).not.toContain("Muted");
  });

  test("the opt-out row is selected for, or the label could never fire", async () => {
    await renderAdminPageWithTables();

    /*
     * The cell can only branch on a column the table actually asked the API
     * for. Without this the flag arrives undefined on every row and every
     * opt-out renders blank again - the defect restored, with a passing-looking
     * component.
     */
    capturedTables.forEach((table: CapturedTableProps) => {
      expect(table.selectMoreFields["isOptOut"]).toBe(true);
    });
  });

  test("the empty state promises a fallback only where the project has one", async () => {
    await renderAdminPageWithTables();

    latestTables().forEach((table: CapturedTableProps) => {
      expect(table.noItemsMessage).toContain(
        "fall back to whatever verified method they have",
      );
    });
  });

  test("with the fallback switched off it says the pages are dropped instead", async () => {
    const project: Project = new Project();
    project.disableOnCallNotificationFallback = true;
    getItemMock.mockResolvedValue(project as never);

    await renderAdminPageWithTables();

    /*
     * The same hole means two different things depending on one project
     * setting, and this page already prints a banner about it - so promising a
     * fallback in the empty state underneath was the page contradicting itself
     * on one screen. With the switch off a missing rule is not a late page, it
     * is no page.
     */
    await waitFor((): void => {
      latestTables().forEach((table: CapturedTableProps) => {
        expect(table.noItemsMessage).toContain("dropped");
        expect(table.noItemsMessage).not.toContain("fall back to whatever");
      });
    });
  });

  test("when the setting cannot be read it claims neither outcome", async () => {
    apiGetMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "readiness is down" }, {}) as never,
    );

    await renderAdminPageWithTables();

    /*
     * A failed read is not a project with the fallback off. Saying "your pages
     * are dropped" because a request timed out is a specific and possibly false
     * claim, and saying they fall back is the comforting version of the same
     * mistake.
     */
    await waitFor((): void => {
      latestTables().forEach((table: CapturedTableProps) => {
        expect(table.noItemsMessage).toContain("could not be read");
        expect(table.noItemsMessage).not.toContain("dropped");
        expect(table.noItemsMessage).not.toContain("fall back to whatever");
      });
    });
  });
});

describe("no unmasked identifier reaches the DOM", () => {
  type AssertNoRawIdentifiersFunction = (container: HTMLElement) => void;

  const assertNoRawIdentifiers: AssertNoRawIdentifiersFunction = (
    container: HTMLElement,
  ): void => {
    /*
     * innerHTML rather than textContent, because a leak is just as real in an
     * href, a title or a data attribute as it is in visible copy.
     */
    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(container.innerHTML).not.toContain(raw);
    }

    /*
     * The scan above catches the planted values by name; these two catch the
     * shape, so an identifier this file never thought of is caught too.
     */
    expect(container.textContent || "").not.toMatch(UNMASKED_EMAIL_PATTERN);
    expect(container.textContent || "").not.toMatch(UNMASKED_PHONE_PATTERN);
  };

  test("the admin page renders masked identifiers only", async () => {
    const container: HTMLElement = await renderAdminPageWithTables();

    // The masked forms are present, so this is not passing by rendering nothing.
    expect(container.textContent).toContain(MASKED_EMAIL);
    expect(container.textContent).toContain(MASKED_PHONE);

    assertNoRawIdentifiers(container);
  });

  test("an unreachable user's empty state leaks nothing either", async () => {
    respondWithReadiness(NO_METHODS_READINESS);

    const container: HTMLElement = await renderAdminPageWithTables();

    expect(container.textContent).toContain(
      "has no notification methods at all",
    );

    assertNoRawIdentifiers(container);
  });

  /*
   * The dropdown labels are not in the DOM here - ModelTable is a stub, and the
   * real one renders them only once a modal is opened - so the scans above
   * cannot see them. They are the newest path a raw identifier could travel, so
   * they are checked at the prop.
   */
  test("no dropdown label carries a raw identifier", async () => {
    await renderAdminPageWithTables();

    const labels: Array<string> = [];

    latestTables().forEach((table: CapturedTableProps) => {
      methodOptionsFor(table).forEach(
        (option: { label: string; value: string }) => {
          labels.push(option.label);
        },
      );
    });

    // Not vacuous: there are labels, and they are the masked ones.
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.join(" ")).toContain(MASKED_PHONE);

    for (const label of labels) {
      for (const raw of ALL_RAW_IDENTIFIERS) {
        expect(label).not.toContain(raw);
      }

      expect(label).not.toMatch(UNMASKED_EMAIL_PATTERN);
      expect(label).not.toMatch(UNMASKED_PHONE_PATTERN);
    }
  });

  /*
   * The mail draft is the one place a whole address is legitimate - it is the
   * mailto recipient, and it is the login email an admin can already read on
   * every other screen in the product. It must never be a notification-method
   * identifier.
   */
  test("the mail draft carries the login address and no method identifier", async () => {
    respondWithReadiness(NO_METHODS_READINESS);

    await renderAdminPageWithTables();

    const href: string = mailtoHrefIn(cardNamed("Notification methods"));

    expect(href).toContain(TARGET_LOGIN_EMAIL);

    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(href).not.toContain(raw);
    }
  });
});
