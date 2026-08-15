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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The three readiness surfaces, rendered for real.
 *
 * The thing being replaced here - Teams > Compliance - printed a binary
 * Compliant / Non-Compliant verdict as prose, hid itself entirely when a team
 * had not opted in, and offered no next step. Every assertion in this file aims
 * at one of the properties that makes the replacement worth having, and each of
 * those properties is invisible to a unit test of the pure helpers:
 *
 *   - the three states have to LOOK different on screen, not merely carry
 *     different enum members, because the whole point is that an admin can
 *     triage without reading;
 *   - the chip dot is drawn only for amber and red, because a dot on every
 *     healthy chip is a dot nobody reads;
 *   - a slow request has to keep the card's shape (skeletons), because a card
 *     that blanks reads as broken rather than loading;
 *   - a warning ships with its fix, or it is just nagging;
 *   - and no unmasked email address or phone number ever reaches the DOM.
 *
 * That last one is a second barrier, on purpose. The server masks; this asserts
 * the browser layer never un-masks, so a future change that starts rendering a
 * raw field the API happens to include fails here even if the server-side
 * masking tests stay green.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      /*
       * The setup-reminder endpoint. It is the only WRITE either surface makes,
       * and it is stubbed rather than exercised because what these tests are
       * about is whether the page tells the truth about the ANSWER - which
       * outcomes it renders, and which it must never render as a success.
       */
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      /*
       * The real helper unwraps an HTTPErrorResponse into its server message and
       * falls back to a generic line for anything else. Both branches matter
       * here: the readiness fetch fails with an HTTPErrorResponse, while a
       * rejected reminder send carries a plain Error whose text is the entire
       * point of the assertion.
       */
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error
          ? error.message
          : "Could not load readiness";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
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

import ResponderReadinessCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard";
import ReadinessDot from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessDot";
import EscalationSummary, {
  EscalationLevelSummary,
  EscalationResponder,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationSummary";
import {
  UserReadinessWire,
  parseReadinessSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import OnCallReadinessPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";

const POLICY_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const SEV1_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const SEV2_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";

/*
 * Incident severities and alert severities are two different tables with two
 * disjoint sets of ids, and a fixture that reuses one id for both (as the two
 * above deliberately do, to prove the shared-name case still works) cannot catch
 * the defect the matrix was rebuilt for: rows keyed on severity id alone put
 * every severity under all four rule-type columns, so an alert severity got an
 * "Incident" column that can never hold anything. These two ids appear under
 * exactly one kind each, which is the only shape in which an impossible cell is
 * visible.
 */
const INCIDENT_ONLY_SEV_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ALERT_ONLY_SEV_ID: string = "eeeeeeee-5555-4555-8555-555555555555";

const INCIDENT_ONLY_SEV_NAME: string = "Sev1 Incident";
const ALERT_ONLY_SEV_NAME: string = "Sev1 Alert";

const SIGNED_IN_USER_ID: string = "cccccccc-3333-4333-8333-333333333333";

/*
 * The raw values that must never survive the trip to the DOM. They are planted
 * INSIDE the fixture payloads, on the same objects that carry the masked ones,
 * so this is not a tautology: an API that leaks an extra field, or a component
 * that reads one, shows up as one of these strings in the rendered markup.
 */
const RAW_EMAIL: string = "jane.doe@example.com";
const RAW_PHONE: string = "+15551234821";
const RAW_TELEGRAM: string = "@janedoe_oncall";
const RAW_WEBHOOK_URL: string = "https://hooks.example.com/T0P-53CR3T-T0K3N";

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
 * Anything shaped like a whole address or a whole phone number. The masked
 * forms deliberately match neither: a bullet is not a local-part character, and
 * four trailing digits are too few to be a number. Un-mask any one identifier in
 * the fixtures and both patterns start hitting.
 */
const UNMASKED_EMAIL_PATTERN: RegExp =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UNMASKED_PHONE_PATTERN: RegExp = /\+?\d[\d\s().-]{6,}\d/;

interface CoverageSpec {
  ruleType: NotificationRuleType;
  severityId?: string | undefined;
  severityName?: string | undefined;
  hasRule: boolean;
  isOptOut?: boolean | undefined;
}

type CoverageJsonFunction = (spec: CoverageSpec) => JSONObject;

/*
 * isOptOut defaults to null rather than false on purpose: the column is
 * nullable and every row written before it existed carries NULL, so that is the
 * shape the UI actually receives most of the time.
 */
const coverageJson: CoverageJsonFunction = (spec: CoverageSpec): JSONObject => {
  const cell: JSONObject = {
    ruleType: spec.ruleType,
    hasRule: spec.hasRule,
    isOptOut: spec.isOptOut ?? null,
  };

  if (spec.severityId) {
    cell["severityId"] = spec.severityId;
    cell["severityName"] = spec.severityName ?? "";
  }

  return cell;
};

interface MethodSpec {
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
  // The value a leaky server - or a leaky future refactor - would hand over.
  leakedRawValue: string;
}

type MethodJsonFunction = (spec: MethodSpec) => JSONObject;

const methodJson: MethodJsonFunction = (spec: MethodSpec): JSONObject => {
  return {
    methodType: spec.methodType,
    maskedIdentifier: spec.maskedIdentifier,
    isVerified: spec.isVerified,
    /*
     * Three plausible spellings of the same mistake, planted at once. None is
     * part of the frozen contract, so parseMethod drops all three and nothing
     * downstream has an unmasked value available to render by accident.
     */
    identifier: spec.leakedRawValue,
    rawIdentifier: spec.leakedRawValue,
    webhookUrl: RAW_WEBHOOK_URL,
  };
};

const VERIFIED_EMAIL_METHOD: JSONObject = methodJson({
  methodType: "Email",
  maskedIdentifier: MASKED_EMAIL,
  isVerified: true,
  leakedRawValue: RAW_EMAIL,
});

const VERIFIED_SMS_METHOD: JSONObject = methodJson({
  methodType: "SMS",
  maskedIdentifier: MASKED_PHONE,
  isVerified: true,
  leakedRawValue: RAW_PHONE,
});

const UNVERIFIED_TELEGRAM_METHOD: JSONObject = methodJson({
  methodType: "Telegram",
  maskedIdentifier: MASKED_TELEGRAM,
  isVerified: false,
  leakedRawValue: RAW_TELEGRAM,
});

const SEVERITY_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
];

type FullCoverageFunction = (hasRule: boolean) => JSONArray;

const fullCoverage: FullCoverageFunction = (hasRule: boolean): JSONArray => {
  const cells: JSONArray = [];

  for (const severity of [
    { id: SEV1_ID, name: "Sev1" },
    { id: SEV2_ID, name: "Sev2" },
  ]) {
    for (const ruleType of SEVERITY_RULE_TYPES) {
      cells.push(
        coverageJson({
          ruleType: ruleType,
          severityId: severity.id,
          severityName: severity.name,
          hasRule: hasRule,
        }),
      );
    }
  }

  cells.push(
    coverageJson({
      ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
      hasRule: hasRule,
    }),
  );
  cells.push(
    coverageJson({
      ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
      hasRule: hasRule,
    }),
  );

  return cells;
};

/*
 * One responder carrying all four cell states at once, so a single expanded
 * matrix proves the four are drawn differently rather than four fixtures each
 * proving one. Incident/Sev2 is muted; Incident-episode/Sev2 is absent from the
 * payload entirely, which is the "not reported" state and is deliberately NOT
 * the same claim as "no rule".
 */
const PARTIAL_COVERAGE: JSONArray = [
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: SEV1_ID,
    severityName: "Sev1",
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityId: SEV1_ID,
    severityName: "Sev1",
    hasRule: false,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityId: SEV1_ID,
    severityName: "Sev1",
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityId: SEV1_ID,
    severityName: "Sev1",
    hasRule: false,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: SEV2_ID,
    severityName: "Sev2",
    hasRule: false,
    isOptOut: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityId: SEV2_ID,
    severityName: "Sev2",
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityId: SEV2_ID,
    severityName: "Sev2",
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    hasRule: false,
  }),
];

// Alert/Sev1, Alert-episode/Sev1 and off-call: no rule and no opt-out.
const PARTIAL_GAP_COUNT: number = 3;

const PARTIAL_GAP_LABEL: string = `${PARTIAL_GAP_COUNT} gaps`;

const READY_USER_ID: string = "11111111-1111-4111-8111-111111111111";
const PARTIAL_USER_ID: string = "22222222-2222-4222-8222-222222222222";
const UNREACHABLE_USER_ID: string = "33333333-3333-4333-8333-333333333333";
const CHANNELS_OFF_USER_ID: string = "55555555-5555-4555-8555-555555555555";
const TWO_TEAM_USER_ID: string = "77777777-7777-4777-8777-777777777777";

/*
 * Teams, as the readiness contract carries them: the on-call teams that page a
 * responder, not every team they happen to belong to. Only a responder whose
 * `reachedVia` includes Team may carry any, which is what makes the "Teams"
 * column and the "Reached via" column two views of one fact rather than two
 * facts that can disagree.
 */
const PLATFORM_TEAM_ID: string = "a1a1a1a1-1111-4111-8111-aaaaaaaaaaaa";
const PAYMENTS_TEAM_ID: string = "b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb";

const PLATFORM_TEAM: JSONObject = { _id: PLATFORM_TEAM_ID, name: "Platform" };
const PAYMENTS_TEAM: JSONObject = { _id: PAYMENTS_TEAM_ID, name: "Payments" };

const READY_USER: JSONObject = {
  userId: READY_USER_ID,
  userName: "Ada Ready",
  userEmail: "ada.ready@example.com",
  status: "Ready",
  methods: [VERIFIED_EMAIL_METHOD],
  coverage: fullCoverage(true),
  reasons: [],
  reachedVia: ["Team"],
  teams: [PLATFORM_TEAM],
};

const PARTIAL_USER: JSONObject = {
  userId: PARTIAL_USER_ID,
  userName: "Jane Partial",
  userEmail: "jane.partial@example.com",
  status: "PartiallyReady",
  methods: [
    VERIFIED_EMAIL_METHOD,
    VERIFIED_SMS_METHOD,
    UNVERIFIED_TELEGRAM_METHOD,
  ],
  coverage: PARTIAL_COVERAGE,
  reasons: ["No notification rule for alerts at Sev1."],
  reachedVia: ["Schedule", "Override"],
  teams: [],
};

const UNREACHABLE_USER: JSONObject = {
  userId: UNREACHABLE_USER_ID,
  userName: "Zed Unreachable",
  userEmail: "zed.unreachable@example.com",
  status: "NotReachable",
  methods: [],
  coverage: fullCoverage(false),
  reasons: ["No verified notification method on this account."],
  reachedVia: ["Direct"],
  teams: [],
};

/*
 * A responder two attached teams page. The interesting case for the team filter:
 * they have to appear under EITHER team, because removing them from one does not
 * stop the other paging them - which is the same reasoning `reachedVia` carries
 * every source rather than the first one found.
 */
const TWO_TEAM_USER: JSONObject = {
  userId: TWO_TEAM_USER_ID,
  userName: "Ravi Twoteams",
  userEmail: "ravi.twoteams@example.com",
  status: "PartiallyReady",
  methods: [VERIFIED_EMAIL_METHOD],
  coverage: PARTIAL_COVERAGE,
  reasons: ["No notification rule for alerts at Sev1."],
  reachedVia: ["Team"],
  teams: [PLATFORM_TEAM, PAYMENTS_TEAM],
};

/*
 * The second, quieter way to be unreachable: verified methods on file, every one
 * of them on a channel the project has switched off. It is NotReachable like Zed
 * is, but the fix is a project setting rather than an email asking somebody to
 * verify a phone they already verified — so the copy has to tell them apart.
 */
const CHANNELS_OFF_USER: JSONObject = {
  userId: CHANNELS_OFF_USER_ID,
  userName: "Sam Switchedoff",
  userEmail: "sam.switchedoff@example.com",
  status: "NotReachable",
  methods: [VERIFIED_SMS_METHOD],
  coverage: fullCoverage(true),
  reasons: [
    "Their only notification methods are on channels this project has switched off",
  ],
  reachedVia: ["Direct"],
  teams: [],
};

/*
 * A responder whose incident severities and alert severities are different rows
 * in different tables, which is what every real project looks like. Each of the
 * four cells below is a pair that genuinely exists; anything else the matrix
 * draws for this responder is a cell that cannot exist.
 */
const DISTINCT_KIND_COVERAGE: JSONArray = [
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: INCIDENT_ONLY_SEV_ID,
    severityName: INCIDENT_ONLY_SEV_NAME,
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityId: INCIDENT_ONLY_SEV_ID,
    severityName: INCIDENT_ONLY_SEV_NAME,
    hasRule: false,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityId: ALERT_ONLY_SEV_ID,
    severityName: ALERT_ONLY_SEV_NAME,
    hasRule: true,
  }),
  coverageJson({
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityId: ALERT_ONLY_SEV_ID,
    severityName: ALERT_ONLY_SEV_NAME,
    hasRule: false,
  }),
];

const DISTINCT_KIND_USER_ID: string = "66666666-6666-4666-8666-666666666666";

const DISTINCT_KIND_USER: JSONObject = {
  userId: DISTINCT_KIND_USER_ID,
  userName: "Kai Distinct",
  userEmail: "kai.distinct@example.com",
  status: "PartiallyReady",
  methods: [VERIFIED_EMAIL_METHOD],
  coverage: DISTINCT_KIND_COVERAGE,
  reasons: [],
  reachedVia: ["Direct"],
  teams: [],
};

type SummaryJsonFunction = (
  users: JSONArray,
  isFallbackEnabled?: boolean | undefined,
) => JSONObject;

/*
 * `isFallbackEnabled` defaults to true because that is the product default
 * (disableOnCallNotificationFallback is false unless an admin sets it), and every
 * test that does not name it is asserting behaviour in the ordinary project. The
 * tests that pass false are asserting the state the copy used to get wrong.
 */
const summaryJson: SummaryJsonFunction = (
  users: JSONArray,
  isFallbackEnabled: boolean = true,
): JSONObject => {
  /*
   * The counts are sent deliberately wrong. parseReadinessSummary recomputes
   * them from the rows, because a tile that disagrees with the list under it is
   * worse than no tile at all.
   */
  return {
    projectId: "44444444-4444-4444-8444-444444444444",
    onCallDutyPolicyId: POLICY_ID.toString(),
    isFallbackEnabled: isFallbackEnabled,
    readyCount: 0,
    partiallyReadyCount: 0,
    notReachableCount: 0,
    users: users,
  };
};

const ALL_THREE_USERS: JSONArray = [READY_USER, PARTIAL_USER, UNREACHABLE_USER];

/*
 * One PAGE of a summary. The endpoint is paged - default 100 responders, max
 * 500 - and a client that reads one page and stops holds a prefix of the list
 * while believing it holds the list: the responders past the cut appear in no
 * count, no row and no chip, which is the feature's own central failure mode
 * turned on the feature. `hasMore` is how the server says there is a cut.
 */
interface PageOptions {
  users: JSONArray;
  hasMore?: boolean | undefined;
  totalCount?: number | undefined;
  isTruncated?: boolean | undefined;
  isFallbackEnabled?: boolean | undefined;
}

type PageJsonFunction = (options: PageOptions) => JSONObject;

const pageJson: PageJsonFunction = (options: PageOptions): JSONObject => {
  return {
    ...summaryJson(options.users, options.isFallbackEnabled ?? true),
    hasMore: options.hasMore ?? false,
    totalCount: options.totalCount ?? options.users.length,
    isTruncated: options.isTruncated ?? false,
  };
};

type RespondWithFunction = (payload: JSONObject) => void;

const respondWith: RespondWithFunction = (payload: JSONObject): void => {
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, payload, {}) as never,
  );
};

// Each call gets the next page, in order, so a paging loop can be watched.
type RespondWithPagesFunction = (pages: Array<JSONObject>) => void;

const respondWithPages: RespondWithPagesFunction = (
  pages: Array<JSONObject>,
): void => {
  for (const page of pages) {
    getMock.mockResolvedValueOnce(
      new HTTPResponse<JSONObject>(200, page, {}) as never,
    );
  }
};

// The url a given request was issued against, as a plain string.
type RequestUrlAtFunction = (index: number) => string;

const requestUrlAt: RequestUrlAtFunction = (index: number): string => {
  const call: Array<unknown> = (getMock.mock.calls[index] ||
    []) as Array<unknown>;
  const args: { url?: unknown } = (call[0] || {}) as { url?: unknown };

  return String(args.url);
};

type RespondWithErrorFunction = () => void;

const respondWithError: RespondWithErrorFunction = (): void => {
  getMock.mockResolvedValue(
    new HTTPErrorResponse(500, { message: "boom" }, {}) as never,
  );
};

type NeverRespondFunction = () => void;

const neverRespond: NeverRespondFunction = (): void => {
  getMock.mockReturnValue(
    new Promise((): void => {
      // Deliberately never settles: this is the slow-request state.
    }) as never,
  );
};

type ToUserReadinessFunction = (json: JSONObject) => UserReadinessWire;

const toUserReadiness: ToUserReadinessFunction = (
  json: JSONObject,
): UserReadinessWire => {
  const parsed: UserReadinessWire | undefined = parseReadinessSummary(
    summaryJson([json]),
  ).users[0];

  if (!parsed) {
    throw new Error("fixture did not parse");
  }

  return parsed;
};

type RenderPolicyCardFunction = () => Promise<HTMLElement>;

const renderPolicyCard: RenderPolicyCardFunction =
  async (): Promise<HTMLElement> => {
    const { container } = render(
      <ResponderReadinessCard onCallDutyPolicyId={POLICY_ID} />,
    );

    await waitFor((): void => {
      expect(getMock).toHaveBeenCalled();
    });

    return container;
  };

type RenderProjectPageFunction = () => Promise<HTMLElement>;

const renderProjectPage: RenderProjectPageFunction =
  async (): Promise<HTMLElement> => {
    const { container } = render(
      <OnCallReadinessPage
        pageRoute={new Route("/dashboard/on-call-duty/readiness")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    await waitFor((): void => {
      expect(getMock).toHaveBeenCalled();
    });

    return container;
  };

/*
 * Status wording is deliberately repeated between the summary tiles and the
 * per-responder chips ("Unreachable" is both a tile label and a chip), so every
 * status assertion is scoped to one responder's row rather than to the document.
 * A document-wide query here would pass on the tile alone and never notice a
 * chip that stopped rendering.
 */
type CardRowForFunction = (userName: string) => HTMLElement;

const cardRowFor: CardRowForFunction = (userName: string): HTMLElement => {
  const row: HTMLElement | null = screen
    .getByText(userName)
    .closest("div.rounded-xl.border.p-4") as HTMLElement | null;

  if (!row) {
    throw new Error(`no readiness row for ${userName}`);
  }

  return row;
};

type TableRowForFunction = (userName: string) => HTMLElement;

const tableRowFor: TableRowForFunction = (userName: string): HTMLElement => {
  const row: HTMLElement | null = screen
    .getByText(userName)
    .closest("tr") as HTMLElement | null;

  if (!row) {
    throw new Error(`no table row for ${userName}`);
  }

  return row;
};

/*
 * The coverage grid lives in a modal, opened from the row's own action button.
 *
 * It used to expand the row in place, which the shared Table has no notion of -
 * and a grid that is severities-down by rule-types-across pushed every row under
 * it off the screen anyway.
 */
type OpenCoverageFunction = (userName: string) => void;

const openCoverage: OpenCoverageFunction = (userName: string): void => {
  fireEvent.click(
    within(tableRowFor(userName)).getByRole("button", { name: "Coverage" }),
  );
};

/*
 * Ticking one responder. The checkbox's accessible name is what the table builds
 * from bulkItemToString, so this is also the assertion that every row's box is
 * addressable at all - a column of unnamed boxes is one a screen reader user
 * cannot tell apart.
 */
type SelectResponderFunction = (userName: string) => void;

const selectResponder: SelectResponderFunction = (userName: string): void => {
  fireEvent.click(screen.getByLabelText(`Select ${userName}`));
};

/*
 * Opening the bulk-actions menu and pressing one of its items. Two clicks
 * because that is what the shared bulk bar is: a selection count, a menu, and
 * the actions inside it.
 */
type RunBulkActionFunction = (title: string) => void;

const runBulkAction: RunBulkActionFunction = (title: string): void => {
  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: title }));
};

/** The filter modal, opened from the funnel button in the card header. */
type OpenFilterModalFunction = () => void;

const openFilterModal: OpenFilterModalFunction = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
};

/*
 * The setup-reminder endpoint's answer. Deliberately takes the per-user results
 * and DERIVES nothing: the payload a test writes is the payload the page gets,
 * so a test can hand back a self-contradictory body (counts that disagree with
 * the list) and watch the page refuse to be confused by it.
 */
interface ReminderOutcomeFixture {
  userId: string;
  outcome: string;
  message: string;
}

type ReminderJsonFunction = (
  results: Array<ReminderOutcomeFixture>,
) => JSONObject;

const reminderJson: ReminderJsonFunction = (
  results: Array<ReminderOutcomeFixture>,
): JSONObject => {
  return {
    projectId: "44444444-4444-4444-8444-444444444444",
    /*
     * Wrong on purpose, exactly like summaryJson's counts. The banner recomputes
     * from `results` so its headline can never contradict the list underneath
     * it.
     */
    requestedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    results: results as unknown as JSONArray,
  };
};

type RespondToReminderFunction = (payload: JSONObject) => void;

const respondToReminderWith: RespondToReminderFunction = (
  payload: JSONObject,
): void => {
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, payload, {}) as never,
  );
};

beforeEach((): void => {
  getMock.mockReset();
  postMock.mockReset();
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, reminderJson([]), {}) as never,
  );
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue({} as never);
  localStorage.clear();
});

afterEach((): void => {
  cleanup();
});

describe("ReadinessDot", () => {
  /*
   * Absence is the "ready" signal. A dot on every healthy chip puts a mark on
   * the majority of chips in a healthy policy, and the eye then has to read
   * every one of them to learn that nothing is wrong.
   */
  test("a ready responder gets no dot at all", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(READY_USER)}
        label="Ada Ready"
        isFallbackEnabled={true}
      />,
    );

    expect(container.innerHTML).toBe("");
    expect(container.querySelector("span")).toBeNull();
  });

  /*
   * Absence has to be absence in both worlds. A project with the fallback off is
   * a project where every gap is a dropped page, and the temptation is to start
   * marking everything - but a ready responder has no gap, so a dot on their chip
   * would be an alarm with no referent and would put a mark on the majority of
   * chips all over again.
   */
  test("a ready responder gets no dot even where pages are being dropped", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(READY_USER)}
        label="Ada Ready"
        isFallbackEnabled={false}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  test("a partially ready responder gets an amber dot", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(PARTIAL_USER)}
        label="Jane Partial"
        isFallbackEnabled={true}
      />,
    );

    expect(container.querySelector(".bg-amber-500")).not.toBeNull();
    expect(container.querySelector(".bg-red-500")).toBeNull();
  });

  test("an unreachable responder gets a red dot", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(UNREACHABLE_USER)}
        label="Zed Unreachable"
        isFallbackEnabled={true}
      />,
    );

    expect(container.querySelector(".bg-red-500")).not.toBeNull();
    expect(container.querySelector(".bg-amber-500")).toBeNull();
  });

  /*
   * Amber is degraded, not dropped - Phase 1's fallback still pages these
   * people. A tooltip that implies the page vanishes is how the old binary pill
   * lost its audience, so amber has to promise delivery and red has to say the
   * page is lost.
   */
  test("the amber tooltip promises delivery and the red one does not", () => {
    const { container: amber } = render(
      <ReadinessDot
        user={toUserReadiness(PARTIAL_USER)}
        label="Jane Partial"
        isFallbackEnabled={true}
      />,
    );

    const amberLabel: string =
      amber.querySelector("[aria-label]")?.getAttribute("aria-label") || "";

    expect(amberLabel).toContain("still reach them");
    expect(amberLabel).toContain("so nothing is dropped");

    cleanup();

    const { container: red } = render(
      <ReadinessDot
        user={toUserReadiness(UNREACHABLE_USER)}
        label="Zed Unreachable"
        isFallbackEnabled={true}
      />,
    );

    const redLabel: string =
      red.querySelector("[aria-label]")?.getAttribute("aria-label") || "";

    expect(redLabel).toContain("every page routed to them is dropped");
    expect(redLabel).not.toContain("still reach");
    expect(redLabel).toContain("Zed Unreachable");
  });

  /*
   * The promise the old copy made unconditionally. With the fallback switched
   * off there is nothing behind a rule gap at all: no rule means no notification,
   * and telling an admin "nothing is dropped" here is telling them their problem
   * is harmless at the exact moment it is not.
   */
  test("the amber tooltip stops promising delivery when the fallback is off", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(PARTIAL_USER)}
        label="Jane Partial"
        isFallbackEnabled={false}
      />,
    );

    const label: string =
      container.querySelector("[aria-label]")?.getAttribute("aria-label") || "";

    expect(label).toContain("fallback switched off");
    expect(label).toContain("dropped");
    expect(label).not.toContain("nothing is dropped");
    expect(label).not.toContain("still reach them");
  });

  // Amber stays amber: the state did not change, only what it costs.
  test("the fallback switch changes the wording, not the colour", () => {
    const { container } = render(
      <ReadinessDot
        user={toUserReadiness(PARTIAL_USER)}
        label="Jane Partial"
        isFallbackEnabled={false}
      />,
    );

    expect(container.querySelector(".bg-amber-500")).not.toBeNull();
    expect(container.querySelector(".bg-red-500")).toBeNull();
  });
});

/*
 * The escalation summary's chips, which are where an admin is looking when they
 * are actually editing who gets paged.
 *
 * These assertions exist because the dots were dead code: the summary's only
 * caller passed neither the policy id nor a userId on the responders it built,
 * so the readiness hook stayed idle, no request was ever issued, and no dot could
 * render under any circumstances. Every test below fails if either half of that
 * wiring comes loose again - the request test catches a dropped policy id, and
 * the by-id test catches responders rebuilt without one.
 */
describe("the escalation summary's readiness dots", () => {
  type LevelWithFunction = (
    responders: Array<EscalationResponder>,
  ) => Array<EscalationLevelSummary>;

  const levelWith: LevelWithFunction = (
    responders: Array<EscalationResponder>,
  ): Array<EscalationLevelSummary> => {
    return [
      {
        name: "Level 1",
        escalateAfterInMinutes: 0,
        responders: responders,
      },
    ];
  };

  interface RenderSummaryOptions {
    responders: Array<EscalationResponder>;
    onCallDutyPolicyId?: ObjectID | undefined;
  }

  type RenderSummaryFunction = (options: RenderSummaryOptions) => void;

  const renderSummary: RenderSummaryFunction = (
    options: RenderSummaryOptions,
  ): void => {
    render(
      <EscalationSummary
        levels={levelWith(options.responders)}
        repeatEnabled={false}
        repeatCount={0}
        onCallDutyPolicyId={options.onCallDutyPolicyId}
      />,
    );
  };

  /*
   * The chip is the element whose own text is the responder label - the icon and
   * the dot are element children, so they do not interfere with the match.
   */
  type ChipForFunction = (label: string) => HTMLElement;

  const chipFor: ChipForFunction = (label: string): HTMLElement => {
    const chip: HTMLElement | null = screen
      .getByText(label)
      .closest("span") as HTMLElement | null;

    if (!chip) {
      throw new Error(`no responder chip for ${label}`);
    }

    return chip;
  };

  // The dot is the only element in a chip that exposes itself as an image.
  type DotInFunction = (chip: HTMLElement) => HTMLElement | null;

  const dotIn: DotInFunction = (chip: HTMLElement): HTMLElement | null => {
    return within(chip).queryByRole("img");
  };

  const userChip: (label: string, userId: string) => EscalationResponder = (
    label: string,
    userId: string,
  ): EscalationResponder => {
    return { type: "user", label: label, userId: userId };
  };

  test("issues a readiness request for the policy it was given", async () => {
    respondWith(summaryJson([PARTIAL_USER]));

    renderSummary({
      responders: [userChip("Jane Partial", PARTIAL_USER_ID)],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(getMock).toHaveBeenCalled();
    });

    expect(requestUrlAt(0)).toContain(
      `/on-call-readiness/policy/${POLICY_ID.toString()}`,
    );
  });

  /*
   * The exact shape of the original bug, kept as a test: a summary with no policy
   * id is inert. That is correct behaviour for a caller that has not opted in,
   * and it is precisely why the real caller failing to opt in produced no error,
   * no request and no dot - nothing to notice.
   */
  test("stays idle, and dotless, without a policy id", async () => {
    respondWith(summaryJson([PARTIAL_USER]));

    renderSummary({
      responders: [userChip("Jane Partial", PARTIAL_USER_ID)],
      onCallDutyPolicyId: undefined,
    });

    expect(getMock).not.toHaveBeenCalled();
    expect(dotIn(chipFor("Jane Partial"))).toBeNull();
  });

  test("marks the amber and red chips and leaves the ready one clean", async () => {
    respondWith(summaryJson(ALL_THREE_USERS));

    renderSummary({
      responders: [
        userChip("Ada Ready", READY_USER_ID),
        userChip("Jane Partial", PARTIAL_USER_ID),
        userChip("Zed Unreachable", UNREACHABLE_USER_ID),
      ],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("Jane Partial"))).not.toBeNull();
    });

    expect(
      chipFor("Jane Partial").querySelector(".bg-amber-500"),
    ).not.toBeNull();
    expect(
      chipFor("Zed Unreachable").querySelector(".bg-red-500"),
    ).not.toBeNull();

    // Absence is the "ready" signal, and it has to survive a loaded payload.
    expect(dotIn(chipFor("Ada Ready"))).toBeNull();
  });

  /*
   * The chip label is whatever the escalation rule renders - a display name that
   * two people can share. The id is what makes the match reliable, so a chip
   * labelled differently from the readiness row must still find its row.
   */
  test("matches a chip to its row by id, not by label", async () => {
    respondWith(summaryJson([PARTIAL_USER]));

    renderSummary({
      responders: [userChip("J. Partial (on-call)", PARTIAL_USER_ID)],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("J. Partial (on-call)"))).not.toBeNull();
    });

    // And the tooltip names the person the reader is actually pointing at.
    expect(
      dotIn(chipFor("J. Partial (on-call)"))?.getAttribute("aria-label"),
    ).toContain("J. Partial (on-call)");
  });

  /*
   * Teams and schedules are containers. The payload is per-user and never says
   * which team a user was reached through, so a dot on a team chip could only be
   * a guess - and a guess that happens to be wrong sends an admin to fix an
   * account that was never broken.
   */
  test("never marks a team chip, even one named after a person", async () => {
    respondWith(summaryJson(ALL_THREE_USERS));

    renderSummary({
      responders: [
        { type: "team", label: "Jane Partial" },
        userChip("Zed Unreachable", UNREACHABLE_USER_ID),
      ],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("Zed Unreachable"))).not.toBeNull();
    });

    expect(dotIn(chipFor("Jane Partial"))).toBeNull();
  });

  /*
   * A responder the readiness answer does not cover must not be drawn the way a
   * healthy responder is drawn. Everywhere else on this row a bare chip means
   * "ready", so silence here would promote somebody nobody checked into somebody
   * who is fine - the substitution the whole feature exists to prevent.
   */
  test("marks an unchecked responder as unknown when the answer is incomplete", async () => {
    respondWith(
      pageJson({
        users: [PARTIAL_USER],
        isTruncated: true,
        totalCount: 4000,
      }),
    );

    renderSummary({
      responders: [
        userChip("Jane Partial", PARTIAL_USER_ID),
        userChip("Ada Ready", READY_USER_ID),
      ],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("Ada Ready"))).not.toBeNull();
    });

    // Grey, not amber: an unknown is not an accusation.
    expect(chipFor("Ada Ready").querySelector(".bg-gray-400")).not.toBeNull();
    expect(chipFor("Ada Ready").querySelector(".bg-amber-500")).toBeNull();
    expect(
      dotIn(chipFor("Ada Ready"))?.getAttribute("aria-label") || "",
    ).toContain("was not checked");

    // The responder the answer DOES cover keeps its real state.
    expect(
      chipFor("Jane Partial").querySelector(".bg-amber-500"),
    ).not.toBeNull();
  });

  /*
   * The complement, and the more important half: on a complete answer a chip
   * with no row is a chip for somebody who is genuinely ready, and marking it
   * would put a dot on the majority of chips in a healthy policy.
   */
  test("leaves an unmatched chip bare when the answer is complete", async () => {
    respondWith(pageJson({ users: [PARTIAL_USER] }));

    renderSummary({
      responders: [
        userChip("Jane Partial", PARTIAL_USER_ID),
        userChip("Ada Ready", READY_USER_ID),
      ],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("Jane Partial"))).not.toBeNull();
    });

    expect(dotIn(chipFor("Ada Ready"))).toBeNull();
  });

  test("the chip tooltip follows the project's fallback switch", async () => {
    respondWith(summaryJson([PARTIAL_USER], false));

    renderSummary({
      responders: [userChip("Jane Partial", PARTIAL_USER_ID)],
      onCallDutyPolicyId: POLICY_ID,
    });

    await waitFor((): void => {
      expect(dotIn(chipFor("Jane Partial"))).not.toBeNull();
    });

    const label: string =
      dotIn(chipFor("Jane Partial"))?.getAttribute("aria-label") || "";

    expect(label).toContain("fallback switched off");
    expect(label).not.toContain("nothing is dropped");
  });
});

describe("ResponderReadinessCard", () => {
  /*
   * A slow request must keep the card's shape. Swapping the whole body for a
   * spinner - which is what the compliance table did - reads as "this feature is
   * broken" rather than "this is still loading", because the card's structure
   * disappears along with its content.
   */
  describe("while loading", () => {
    test("draws skeletons rather than blanking the card", async () => {
      neverRespond();

      const container: HTMLElement = await renderPolicyCard();

      expect(
        container.querySelectorAll(".animate-pulse").length,
      ).toBeGreaterThan(0);
    });

    test("keeps the heading and the explanation on screen", async () => {
      neverRespond();

      await renderPolicyCard();

      expect(screen.getByText("Responder readiness")).toBeInTheDocument();
      expect(
        screen.getByText(/including people it reaches through a team/),
      ).toBeInTheDocument();
    });

    test("does not render an error or an empty state while it waits", async () => {
      neverRespond();

      await renderPolicyCard();

      expect(screen.queryByText("Could not load readiness")).toBeNull();
      expect(screen.queryByText(/No one is on this policy yet/)).toBeNull();
    });
  });

  describe("when the request fails", () => {
    test("renders the failure and a way to retry", async () => {
      respondWithError();

      await renderPolicyCard();

      expect(
        await screen.findByText("Could not load readiness"),
      ).toBeInTheDocument();
      expect(screen.getByRole("refresh-button")).toBeInTheDocument();
    });

    test("retrying issues another request", async () => {
      respondWithError();

      await renderPolicyCard();

      await screen.findByText("Could not load readiness");

      const callsBefore: number = getMock.mock.calls.length;

      fireEvent.click(screen.getByRole("refresh-button"));

      await waitFor((): void => {
        expect(getMock.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });
  });

  describe("when nobody is on the policy", () => {
    test("explains why the card is empty and where to fix it", async () => {
      respondWith(summaryJson([]));

      await renderPolicyCard();

      expect(
        await screen.findByText(/No one is on this policy yet/),
      ).toBeInTheDocument();
      expect(screen.getByText("Escalation")).toBeInTheDocument();
    });
  });

  describe("when everyone is ready", () => {
    /*
     * The positive confirmation lives here precisely because the chips carry no
     * green dot. If this card were silent too, "ready" would have no surface at
     * all and the absence of a dot would be indistinguishable from a bug.
     */
    test("says so positively instead of showing an empty list", async () => {
      respondWith(summaryJson([READY_USER]));

      await renderPolicyCard();

      expect(
        await screen.findByText("Every responder can be paged"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Needs attention")).toBeNull();
    });

    test("counts the one responder in its tiles", async () => {
      respondWith(summaryJson([READY_USER]));

      await renderPolicyCard();

      await screen.findByText("Every responder can be paged");

      // Singular label, and the ready tile counting the one ready responder.
      expect(screen.getByText("Responder")).toBeInTheDocument();
      expect(screen.getByText("Ready")).toBeInTheDocument();
    });
  });

  describe("the three states, rendered together", () => {
    test("each non-ready row carries its own status wording", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(
        within(cardRowFor("Zed Unreachable")).getByText("Unreachable"),
      ).toBeInTheDocument();
      expect(
        within(cardRowFor("Jane Partial")).getByText(PARTIAL_GAP_LABEL),
      ).toBeInTheDocument();
    });

    /*
     * Red and amber are different colours on purpose: red loses pages, amber
     * does not. Collapsing them into one alarming colour is how a status surface
     * trains its readers to ignore it.
     */
    test("red and amber rows are visually distinct", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(container.querySelector(".border-red-200")).not.toBeNull();
      expect(container.querySelector(".border-amber-200")).not.toBeNull();
    });

    test("ready responders are not listed under Needs attention", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(screen.getByText("Needs attention")).toBeInTheDocument();
      expect(screen.getByText("2 of 3")).toBeInTheDocument();
      expect(screen.queryByText("Ada Ready")).toBeNull();
    });

    test("the amber row states that its pages still arrive", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      expect(cardRowFor("Jane Partial").textContent).toContain(
        "so nothing is dropped",
      );
    });

    test("the red row states that its pages are dropped", async () => {
      respondWith(summaryJson([UNREACHABLE_USER]));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      const row: HTMLElement = cardRowFor("Zed Unreachable");

      expect(row.textContent).toContain("is dropped");
      expect(row.textContent).toContain(
        "No verified notification method on this account.",
      );
    });
  });

  /*
   * The endpoint is paged, and this card counts people. A card that read one
   * page would print "0 unreachable" over a policy whose unreachable responders
   * happened to sort onto page two - a reassuring number computed from part of a
   * list, which is worse than no number at all.
   */
  describe("when the answer spans more than one page", () => {
    test("reads every page before it counts anything", async () => {
      respondWithPages([
        pageJson({
          users: [READY_USER, PARTIAL_USER],
          hasMore: true,
          totalCount: 3,
        }),
        pageJson({ users: [UNREACHABLE_USER], hasMore: false, totalCount: 3 }),
      ]);

      await renderPolicyCard();

      // The row from page two is on screen, so the second page was read.
      expect(await screen.findByText("Zed Unreachable")).toBeInTheDocument();
      expect(screen.getByText("Jane Partial")).toBeInTheDocument();
      expect(screen.getByText("2 of 3")).toBeInTheDocument();
    });

    test("asks for the next page from where the last one ended", async () => {
      respondWithPages([
        pageJson({
          users: [READY_USER, PARTIAL_USER],
          hasMore: true,
          totalCount: 3,
        }),
        pageJson({ users: [UNREACHABLE_USER], hasMore: false, totalCount: 3 }),
      ]);

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(getMock.mock.calls.length).toBe(2);
      expect(requestUrlAt(0)).toContain("skip=0");
      expect(requestUrlAt(1)).toContain("skip=2");
    });

    test("stops at the last page rather than asking forever", async () => {
      respondWith(pageJson({ users: ALL_THREE_USERS, hasMore: false }));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(getMock.mock.calls.length).toBe(1);
    });

    /*
     * A server that says "there is more" and returns nothing would otherwise
     * re-request the same offset until the page cap. Stopping is not enough on
     * its own - the card has to admit it is holding part of a list.
     */
    test("gives up, and says so, on a page that cannot advance", async () => {
      respondWith(pageJson({ users: [], hasMore: true, totalCount: 900 }));

      await renderPolicyCard();

      expect(
        await screen.findByText(/more than this card reads at once/),
      ).toBeInTheDocument();
      expect(getMock.mock.calls.length).toBe(1);
    });
  });

  /*
   * The server has its own truncation, from its own read ceilings, and it is a
   * different claim: not "you are holding part of a list" but "the answer itself
   * is missing people". Either way a count becomes a floor, and the card has to
   * say which one it is rather than printing a confident total.
   */
  describe("when the server reports its own answer is incomplete", () => {
    test("says the counts are a floor rather than a total", async () => {
      respondWith(
        pageJson({ users: ALL_THREE_USERS, isTruncated: true, totalCount: 3 }),
      );

      await renderPolicyCard();

      expect(
        await screen.findByText(/hit its own read limits/),
      ).toBeInTheDocument();
    });

    test("a complete answer carries no such caveat", async () => {
      respondWith(pageJson({ users: ALL_THREE_USERS }));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(screen.queryByText(/hit its own read limits/)).toBeNull();
      expect(
        screen.queryByText(/more than this card reads at once/),
      ).toBeNull();
    });
  });

  /*
   * The defect this block exists for: the consequence sentence used to hardcode
   * "Those pages still reach them ... so nothing is dropped" for EVERY amber
   * responder. In a project with disableOnCallNotificationFallback set, those
   * pages are not delivered at all - so the one surface built to stop a silent
   * unreachable responder was itself silently reassuring the admin. Both states
   * are asserted, because a copy fix that only ever runs in one of them is not a
   * fix.
   */
  describe("when the project's fallback is switched off", () => {
    test("the amber row says the pages are dropped", async () => {
      respondWith(summaryJson([PARTIAL_USER], false));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      const row: HTMLElement = cardRowFor("Jane Partial");

      expect(row.textContent).toContain("fallback switched off");
      expect(row.textContent).toContain("dropped");
      expect(row.textContent).not.toContain("so nothing is dropped");
      expect(row.textContent).not.toContain("still reach them");
    });

    test("the amber row promises delivery again when it is switched on", async () => {
      respondWith(summaryJson([PARTIAL_USER], true));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      const row: HTMLElement = cardRowFor("Jane Partial");

      expect(row.textContent).toContain("so nothing is dropped");
      expect(row.textContent).not.toContain("fallback switched off");
    });

    /*
     * Said once, above the rows, because it reframes all of them at once. A
     * reader who knows the product assumes the fallback is on - it is on by
     * default and on nearly everywhere - and would otherwise read each amber row
     * as "late" rather than "lost".
     */
    test("the card states the project-wide fact once, at the top", async () => {
      respondWith(summaryJson([PARTIAL_USER], false));

      await renderPolicyCard();

      expect(
        await screen.findByText(/it is no page at all/),
      ).toBeInTheDocument();
    });

    test("an ordinary project is not given that banner", async () => {
      respondWith(summaryJson([PARTIAL_USER], true));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      expect(screen.queryByText(/it is no page at all/)).toBeNull();
    });

    test("the mail draft to the responder says it too", async () => {
      respondWith(summaryJson([PARTIAL_USER], false));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      const href: string = decodeURIComponent(
        cardRowFor("Jane Partial")
          .querySelector('a[href^="mailto:"]')
          ?.getAttribute("href") || "",
      );

      expect(href).toContain("no notification rule on your account");
      expect(href).toContain("fallback switched off");
      expect(href).not.toContain("still reach you");
    });
  });

  /*
   * The other way the old copy lied. A responder can hold a verified phone number
   * and still be unreachable because the project switched SMS and Call off, and
   * "has no verified notification method" sends the admin to chase a verification
   * that already happened instead of to the project setting that is actually
   * dropping the page.
   */
  describe("a responder whose only channels are switched off", () => {
    test("is not described as having no verified method", async () => {
      respondWith(summaryJson([CHANNELS_OFF_USER]));

      await renderPolicyCard();

      await screen.findByText("Sam Switchedoff");

      const row: HTMLElement = cardRowFor("Sam Switchedoff");

      expect(row.textContent).toContain("channels switched off");
      expect(row.textContent).toContain("is dropped");
      expect(row.textContent).not.toContain("has no verified notification");
    });

    test("names the channels they do have, so the fix is findable", async () => {
      respondWith(summaryJson([CHANNELS_OFF_USER]));

      await renderPolicyCard();

      await screen.findByText("Sam Switchedoff");

      expect(cardRowFor("Sam Switchedoff").textContent).toContain("SMS");
    });

    test("the mail draft does not ask them to verify what they verified", async () => {
      respondWith(summaryJson([CHANNELS_OFF_USER]));

      await renderPolicyCard();

      await screen.findByText("Sam Switchedoff");

      const href: string = decodeURIComponent(
        cardRowFor("Sam Switchedoff")
          .querySelector('a[href^="mailto:"]')
          ?.getAttribute("href") || "",
      );

      expect(href).toContain("switched off");
      expect(href).not.toContain("no verified notification method");
    });
  });

  describe("every warning ships with its fix", () => {
    /*
     * Admins cannot edit somebody else's notification setup - that boundary is
     * deliberate, since attaching a phone number to another account is a
     * paging-hijack vector - so for anyone but the signed-in user the action is
     * a prefilled nudge rather than an edit.
     */
    test("another person's row offers a prefilled mail draft", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      const row: HTMLElement = cardRowFor("Jane Partial");

      expect(row.querySelector('a[href^="mailto:"]')).not.toBeNull();
      expect(row.textContent).toContain("Email Jane the fix");
    });

    test("the draft is addressed in the second person", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      const href: string =
        cardRowFor("Jane Partial")
          .querySelector('a[href^="mailto:"]')
          ?.getAttribute("href") || "";

      expect(decodeURIComponent(href)).toContain("Hi Jane,");
      expect(decodeURIComponent(href)).toContain(
        "no notification rule on your account",
      );
    });

    test("an unreachable responder is pointed at notification methods", async () => {
      respondWith(summaryJson([UNREACHABLE_USER]));

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      const href: string =
        cardRowFor("Zed Unreachable")
          .querySelector('a[href^="mailto:"]')
          ?.getAttribute("href") || "";

      expect(decodeURIComponent(href)).toContain(
        "your account has no verified notification method",
      );
    });

    /*
     * The signed-in user is the one person whose setup they can actually change
     * from here, so their row gets a real button instead of a nudge.
     */
    test("the signed-in user's own row gets an actionable button", async () => {
      localStorage.setItem("user_id", SIGNED_IN_USER_ID);

      respondWith(
        summaryJson([{ ...PARTIAL_USER, userId: SIGNED_IN_USER_ID }]),
      );

      await renderPolicyCard();

      await screen.findByText("Jane Partial");

      expect(
        screen.getByRole("button", { name: "Add the missing rules" }),
      ).toBeInTheDocument();
      expect(
        cardRowFor("Jane Partial").querySelector('a[href^="mailto:"]'),
      ).toBeNull();
    });

    test("the signed-in user with no method is sent to add one", async () => {
      localStorage.setItem("user_id", SIGNED_IN_USER_ID);

      respondWith(
        summaryJson([{ ...UNREACHABLE_USER, userId: SIGNED_IN_USER_ID }]),
      );

      await renderPolicyCard();

      await screen.findByText("Zed Unreachable");

      expect(
        screen.getByRole("button", { name: "Add a notification method" }),
      ).toBeInTheDocument();
    });
  });
});

describe("On-call readiness page", () => {
  describe("empty and error states", () => {
    test("an empty project says so rather than drawing an empty table", async () => {
      respondWith(summaryJson([]));

      await renderProjectPage();

      expect(
        await screen.findByText(
          "No responders are attached to any on-call policy in this project yet.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });

    test("a failed request renders the failure and a retry", async () => {
      respondWithError();

      await renderProjectPage();

      expect(
        await screen.findByText("Could not load readiness"),
      ).toBeInTheDocument();
      expect(screen.getByRole("refresh-button")).toBeInTheDocument();
    });

    test("the card chrome survives a failed request", async () => {
      respondWithError();

      await renderProjectPage();

      await screen.findByText("Could not load readiness");

      expect(screen.getByText("On-call readiness")).toBeInTheDocument();
    });
  });

  describe("the three states render distinctly", () => {
    test("every responder gets the status chip its state earns", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      expect(
        within(tableRowFor("Zed Unreachable")).getByText("Unreachable"),
      ).toBeInTheDocument();
      expect(
        within(tableRowFor("Jane Partial")).getByText(PARTIAL_GAP_LABEL),
      ).toBeInTheDocument();
      expect(
        within(tableRowFor("Ada Ready")).getByText("Ready"),
      ).toBeInTheDocument();
    });

    test("the chips carry three different colours", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      expect(container.querySelector(".bg-red-50.text-red-700")).not.toBeNull();
      expect(
        container.querySelector(".bg-amber-50.text-amber-700"),
      ).not.toBeNull();
      expect(
        container.querySelector(".bg-emerald-50.text-emerald-700"),
      ).not.toBeNull();
    });

    /*
     * Nobody opens this page to admire the responders who are fine. Unreachable
     * first, then the most incomplete, is the whole editorial position.
     */
    test("unreachable sorts above needs-setup, which sorts above ready", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      const rows: Array<string> = Array.from(
        container.querySelectorAll("tbody tr"),
      ).map((row: Element): string => {
        return row.textContent || "";
      });

      expect(rows[0]).toContain("Zed Unreachable");
      expect(rows[1]).toContain("Jane Partial");
      expect(rows[2]).toContain("Ada Ready");
    });

    /*
     * Scoped to the tile grid because the same four words are also the filter
     * button labels. A document-wide query would pass on the filter alone and
     * never notice a tile that stopped counting.
     */
    test("the summary tiles count each state separately", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      const tiles: HTMLElement | null = container.querySelector(
        "div.mb-6.grid",
      ) as HTMLElement | null;

      if (!tiles) {
        throw new Error("no summary tile grid");
      }

      expect(within(tiles).getByText("Responders")).toBeInTheDocument();
      expect(within(tiles).getByText("Ready")).toBeInTheDocument();
      expect(within(tiles).getByText("Needs setup")).toBeInTheDocument();
      expect(within(tiles).getByText("Unreachable")).toBeInTheDocument();

      // One of each, out of three responders.
      expect(within(tiles).getByText("3")).toBeInTheDocument();
      expect(within(tiles).getAllByText("1")).toHaveLength(3);
    });
  });

  describe("the coverage matrix", () => {
    /*
     * The grid is the centrepiece: severities down, rule types across, so a gap
     * is a literal hole you can see. Prose ("Missing notification rules for
     * incident severities: Sev1, Sev2") made a reader rebuild that grid in their
     * head, once per responder.
     */
    test("covered, gap and muted cells are three different marks", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(
        screen.getAllByRole("img", {
          name: "Covered - a notification rule exists",
        }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("img", {
          name: "No rule - pages here fall back to a verified method",
        }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("img", {
          name: "Muted - notifications intentionally turned off",
        }).length,
      ).toBeGreaterThan(0);
    });

    /*
     * A deliberate mute is not a gap. Counting it as one nags people for having
     * configured the product correctly, which is the fastest way to make the
     * whole surface ignorable. Nine cells, one muted and three genuinely
     * missing: if the mute were counted the chip would read "4 gaps" and the
     * coverage column "5 of 9".
     */
    test("a muted cell is not counted as a gap", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      expect(
        within(tableRowFor("Jane Partial")).getByText(PARTIAL_GAP_LABEL),
      ).toBeInTheDocument();
      expect(
        within(tableRowFor("Jane Partial")).getByText("6 of 9"),
      ).toBeInTheDocument();
    });

    /*
     * A pair the service did not report is not the same claim as "no rule", so
     * it renders neutral rather than as an accusation the reader wastes time
     * chasing.
     */
    test("an unreported pair renders as not-reported, not as a gap", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(container.querySelector('[title="Not reported"]')).not.toBeNull();
    });

    test("the columns are the four severity rule types, in a fixed order", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      const headers: Array<string> = screen
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent || "";
        });

      expect(headers).toContain("Severity");
      expect(headers).toContain("Incident");
      expect(headers).toContain("Alert");
      expect(headers).toContain("Incident episode");
      expect(headers).toContain("Alert episode");
    });

    /*
     * The two lifecycle rule types carry no severity, so they cannot be matrix
     * rows. Dropping them instead would silently hide a real gap - the very
     * mistake the compliance report made by treating rule types as
     * interchangeable.
     */
    test("the severity-less rule types get their own section", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(screen.getByText("Shift changes")).toBeInTheDocument();
      expect(screen.getByText("Goes on call")).toBeInTheDocument();
      expect(screen.getByText("Goes off call")).toBeInTheDocument();
    });

    test("both severities appear as rows", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(screen.getAllByText("Sev1").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Sev2").length).toBeGreaterThan(0);
    });
  });

  /*
   * The matrix has to have a severity KIND dimension, and these are the tests
   * that say so.
   *
   * The first cut keyed rows on severity id alone while the columns were all
   * four severity-scoped rule types. Incident severity ids and alert severity
   * ids are disjoint - they are rows in two different tables - so that grid put
   * every alert severity under an "Incident" column and every incident severity
   * under an "Alert" one. Half of every grid was cells that can never exist, and
   * nothing on screen distinguished one of those from a genuine hole, on the one
   * surface whose entire job is making a hole visible.
   */
  describe("the coverage matrix is split by severity kind", () => {
    type MatrixForFunction = (title: string) => HTMLElement;

    const matrixFor: MatrixForFunction = (title: string): HTMLElement => {
      return screen.getByRole("table", { name: `${title} coverage` });
    };

    /*
     * Every drawn cell carries one of the four state titles, and only cells do -
     * the severity name cell that opens each row does not - so counting titled
     * marks inside a matrix counts exactly the pairs it claims exist.
     */
    type CountDrawnCellsFunction = (matrix: HTMLElement) => number;

    const countDrawnCells: CountDrawnCellsFunction = (
      matrix: HTMLElement,
    ): number => {
      return matrix.querySelectorAll("tbody td span[title]").length;
    };

    type HeadersOfFunction = (matrix: HTMLElement) => Array<string>;

    const headersOf: HeadersOfFunction = (
      matrix: HTMLElement,
    ): Array<string> => {
      return within(matrix)
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent || "";
        });
    };

    type ExpandKaiFunction = () => Promise<void>;

    const expandKai: ExpandKaiFunction = async (): Promise<void> => {
      respondWith(summaryJson([DISTINCT_KIND_USER]));

      await renderProjectPage();

      await screen.findByText("Kai Distinct");

      openCoverage("Kai Distinct");
    };

    test("each kind gets its own matrix", async () => {
      await expandKai();

      expect(matrixFor("Incident severities")).toBeInTheDocument();
      expect(matrixFor("Alert severities")).toBeInTheDocument();
    });

    test("the incident matrix carries only incident columns", async () => {
      await expandKai();

      expect(headersOf(matrixFor("Incident severities"))).toEqual([
        "Severity",
        "Incident",
        "Incident episode",
      ]);
    });

    test("the alert matrix carries only alert columns", async () => {
      await expandKai();

      expect(headersOf(matrixFor("Alert severities"))).toEqual([
        "Severity",
        "Alert",
        "Alert episode",
      ]);
    });

    /*
     * The defect itself: an alert severity must never appear on the incident
     * axis, because there is no such thing as that severity on an incident.
     */
    test("neither kind's severities leak into the other kind's matrix", async () => {
      await expandKai();

      const incidentMatrix: HTMLElement = matrixFor("Incident severities");
      const alertMatrix: HTMLElement = matrixFor("Alert severities");

      expect(
        within(incidentMatrix).getByText(INCIDENT_ONLY_SEV_NAME),
      ).toBeInTheDocument();
      expect(
        within(incidentMatrix).queryByText(ALERT_ONLY_SEV_NAME),
      ).toBeNull();

      expect(
        within(alertMatrix).getByText(ALERT_ONLY_SEV_NAME),
      ).toBeInTheDocument();
      expect(
        within(alertMatrix).queryByText(INCIDENT_ONLY_SEV_NAME),
      ).toBeNull();
    });

    /*
     * The counting version of the same claim, and the one that fails loudest if
     * the kind dimension is ever dropped again: four pairs exist for this
     * responder, so four cells are drawn. The old single-axis grid drew eight -
     * two severities across four columns - and the four extras were impossible.
     */
    test("it draws exactly as many cells as there are pairs that can exist", async () => {
      await expandKai();

      const drawnCells: number =
        countDrawnCells(matrixFor("Incident severities")) +
        countDrawnCells(matrixFor("Alert severities"));

      expect(drawnCells).toBe(DISTINCT_KIND_COVERAGE.length);
    });

    /*
     * Kind is a property of the RULE TYPE a cell arrived under, never of the id,
     * so a project that happens to reuse an id across the two severity tables
     * still lands each cell in the matrix it belongs to rather than merging the
     * two rows back into one.
     */
    test("a shared severity id still lands in both matrices, once each", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(
        within(matrixFor("Incident severities")).getAllByText("Sev1"),
      ).toHaveLength(1);
      expect(
        within(matrixFor("Alert severities")).getAllByText("Sev1"),
      ).toHaveLength(1);
    });
  });

  /*
   * The setup-reminder control, now that it is real.
   *
   * Its history is the reason these assertions are shaped the way they are. The
   * first cut wired an enabled button to a function that unconditionally threw:
   * an admin ticked responders, confirmed a modal naming them, and got an error.
   * The second was honestly disabled, because a silent no-op would have been
   * worse still - they would have left believing a reminder reached somebody who
   * still cannot be paged.
   *
   * So the standard the enabled version has to meet is not "does it POST". It is
   * that the page never says a reminder went out unless the server said that
   * reminder went out, per user:
   *
   *   - a throttled skip must not render as a send (a throttle is not a send);
   *   - a failure must not be swallowed by the successes around it;
   *   - a failed REQUEST must say plainly that nothing was sent, and must not be
   *     confusable with a partial success, because "try again" is right for one
   *     and wrong for the other;
   *   - and the headline count must be derived from the same list it is printed
   *     above, so the two can never disagree on screen.
   */
  describe("the setup-reminder control - selecting responders", () => {
    test("every responder row carries a named checkbox", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      /*
       * Named, not merely present. The shared table draws an unlabelled box in
       * every row unless it is told what a row IS, and a column of boxes that
       * all announce themselves as "checkbox" is one a screen reader user
       * cannot tell apart - and one this file could not address either.
       */
      expect(
        screen.getByLabelText("Select Zed Unreachable"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Select Jane Partial")).toBeInTheDocument();
    });

    /*
     * A Ready responder has nothing to be reminded of, and the server agrees -
     * it answers SkippedNothingMissing rather than mailing them a claim they
     * could disprove in ten seconds. Locking the box says the same thing before
     * the click instead of explaining it after.
     */
    test("a ready responder cannot be selected, and the box says why", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Ada Ready");

      const box: HTMLElement = screen.getByLabelText("Select Ada Ready");

      expect(box).toBeDisabled();
      expect(box).toHaveAttribute(
        "title",
        "Already ready - there is nothing to remind them about",
      );
    });

    test("the bulk bar appears only once something is selected, and counts it", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      expect(screen.queryByText("Bulk Actions")).toBeNull();

      selectResponder("Zed Unreachable");

      expect(screen.getByText("1 Responders Selected")).toBeInTheDocument();
      expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
    });

    /*
     * Ticking a box must not do anything else. The row used to expand on click
     * and the checkbox cell had to stop propagation by hand; the coverage grid
     * now opens from its own button, so the two cannot collide at all - and this
     * is the assertion that says so.
     */
    test("ticking a box does not open the coverage grid", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      selectResponder("Jane Partial");

      expect(screen.queryByText("Incident severities")).toBeNull();
    });

    test("the header checkbox takes the remindable rows and leaves the ready one", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Ada Ready");

      fireEvent.click(screen.getByLabelText("Select all items"));

      expect(screen.getByText("2 Responders Selected")).toBeInTheDocument();
      expect(screen.getByLabelText("Select Ada Ready")).not.toBeChecked();
    });

    /*
     * "All selected" is judged against the rows that CAN be selected. Counting
     * the locked Ready row against it would leave the header box permanently
     * empty on any page holding one, which reads as "your selection was lost"
     * rather than as "one row here is not yours to pick".
     */
    test("the header checkbox fills even though a locked row stays unticked", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Ada Ready");

      fireEvent.click(screen.getByLabelText("Select all items"));

      expect(screen.getByLabelText("Select all items")).toBeChecked();
      expect(screen.getByLabelText("Select Ada Ready")).not.toBeChecked();
    });

    test("the selection can be cleared without sending anything", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      selectResponder("Zed Unreachable");
      fireEvent.click(screen.getByText("Clear Selection"));

      expect(screen.queryByText("Bulk Actions")).toBeNull();
      expect(postMock).not.toHaveBeenCalled();
    });

    /*
     * "Select All Responders" means every row the CURRENT FILTER matches, not
     * every row in the project - and still never a Ready one. An admin who
     * filtered to one team and pressed it must not mail the other four teams.
     */
    test("select-all covers the filtered rows and still skips the ready ones", async () => {
      respondWith(summaryJson([...ALL_THREE_USERS, TWO_TEAM_USER]));

      await renderProjectPage();

      await screen.findByText("Ravi Twoteams");

      selectResponder("Zed Unreachable");
      fireEvent.click(screen.getByText("Select All Responders"));

      await waitFor((): void => {
        expect(screen.getByText("3 Responders Selected")).toBeInTheDocument();
      });
    });
  });

  describe("the setup-reminder control - confirming and sending", () => {
    type SelectAndOpenFunction = () => Promise<void>;

    const selectZedAndOpenModal: SelectAndOpenFunction =
      async (): Promise<void> => {
        respondWith(summaryJson(ALL_THREE_USERS));

        await renderProjectPage();

        await screen.findByText("Zed Unreachable");

        selectResponder("Zed Unreachable");
        runBulkAction("Send setup reminder");
      };

    /*
     * The modal names them. Selection survives a filter change AND a page
     * change, so the rows an admin ticked are not necessarily the rows on
     * screen when they press the button - and this is the last moment before
     * real email reaches real people. "Send 6 reminders?" would be asking them
     * to confirm a number.
     */
    test("the confirmation names every recipient", async () => {
      await selectZedAndOpenModal();

      const modal: HTMLElement = screen.getByTestId("modal");

      expect(within(modal).getByText(/Zed Unreachable/)).toBeInTheDocument();
      expect(within(modal).queryByText(/Ada Ready/)).toBeNull();
    });

    test("the confirmation counts the recipients in its title", async () => {
      await selectZedAndOpenModal();

      expect(
        within(screen.getByTestId("modal")).getByText(
          /Send a setup reminder to 1 responder\?/,
        ),
      ).toBeInTheDocument();
    });

    test("the confirmation says the 24h throttle exists before anything is sent", async () => {
      await selectZedAndOpenModal();

      expect(
        within(screen.getByTestId("modal")).getByText(/24 hours/),
      ).toBeInTheDocument();
    });

    test("opening the confirmation sends nothing on its own", async () => {
      await selectZedAndOpenModal();

      expect(postMock).not.toHaveBeenCalled();
    });

    test("confirming posts the selected ids to the reminder endpoint", async () => {
      respondToReminderWith(
        reminderJson([
          {
            userId: UNREACHABLE_USER_ID,
            outcome: "Sent",
            message: "Reminder sent to their account email address.",
          },
        ]),
      );

      await selectZedAndOpenModal();

      fireEvent.click(
        screen.getByRole("button", { name: "Send setup reminder" }),
      );

      await waitFor((): void => {
        expect(postMock).toHaveBeenCalled();
      });

      const call: Array<any> = postMock.mock.calls[0] as Array<any>;
      const options: {
        url: { toString: () => string };
        data: { userIds: Array<string> };
      } = call[0];

      expect(options.url.toString()).toContain(
        "/on-call-readiness/send-setup-reminder",
      );
      expect(options.data.userIds).toEqual([UNREACHABLE_USER_ID]);
    });
  });

  describe("the setup-reminder control - reporting what happened", () => {
    type RunReminderFunction = (
      results: Array<ReminderOutcomeFixture>,
    ) => Promise<void>;

    /*
     * Select both responders who have something wrong, send, and let the caller
     * decide what the server said about them.
     */
    const runReminderForBoth: RunReminderFunction = async (
      results: Array<ReminderOutcomeFixture>,
    ): Promise<void> => {
      respondWith(summaryJson(ALL_THREE_USERS));
      respondToReminderWith(reminderJson(results));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      fireEvent.click(screen.getByLabelText("Select all items"));
      runBulkAction("Send setup reminder");
      fireEvent.click(
        screen.getByRole("button", { name: "Send setup reminder" }),
      );

      await waitFor((): void => {
        expect(screen.getByText(/Setup reminders:/)).toBeInTheDocument();
      });
    };

    test("an all-sent run says so, and does not list the successes", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        { userId: PARTIAL_USER_ID, outcome: "Sent", message: "Sent." },
      ]);

      expect(screen.getByText("2 sent.")).toBeInTheDocument();
      /*
       * The names appear in the table either way; what must NOT appear is a
       * per-user line under the banner for somebody nothing went wrong with.
       */
      expect(screen.queryByText(/Sent\./)).toBeNull();
    });

    /*
     * The highest-value assertion in this block. A throttle is not a send, and
     * the run that produced this is the ordinary one the moment a throttle
     * exists.
     *
     * It is also why this page keeps its own banner rather than reporting
     * through the shared bulk-action progress modal: that modal has two buckets,
     * succeeded and FAILED, and a responder skipped because they were reminded
     * an hour ago has not failed at anything.
     */
    test("a throttled skip is counted as skipped and named, never as sent", async () => {
      await runReminderForBoth([
        {
          userId: UNREACHABLE_USER_ID,
          outcome: "Sent",
          message: "Reminder sent to their account email address.",
        },
        {
          userId: PARTIAL_USER_ID,
          outcome: "SkippedThrottled",
          message: "Already reminded in the last 24 hours.",
        },
      ]);

      expect(screen.getByText("1 sent, 1 skipped.")).toBeInTheDocument();
      expect(
        screen.getByText(/Already reminded in the last 24 hours\./),
      ).toBeInTheDocument();
      expect(screen.queryByText("2 sent.")).toBeNull();
    });

    test("a failure is named with the server's own words", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        {
          userId: PARTIAL_USER_ID,
          outcome: "Failed",
          message: "This responder has no usable account email address.",
        },
      ]);

      expect(screen.getByText("1 sent, 1 failed.")).toBeInTheDocument();
      expect(
        screen.getByText(/no usable account email address/),
      ).toBeInTheDocument();
    });

    /*
     * Tone follows the WORST thing in the report. A green banner with a red line
     * inside it is read as green, which is how a partial failure gets closed as
     * a success.
     */
    test("any failure colours the whole banner as a failure", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        { userId: PARTIAL_USER_ID, outcome: "Failed", message: "Nope." },
      ]);

      const banner: HTMLElement | null = screen
        .getByText(/Setup reminders:/)
        .closest("div.rounded-md") as HTMLElement | null;

      expect(banner?.className).toContain("red");
      expect(banner?.className).not.toContain("emerald");
    });

    test("a user the page no longer knows still gets an outcome line", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        {
          userId: "99999999-8888-4888-8888-999999999999",
          outcome: "SkippedNotAMember",
          message: "Not a member of this project.",
        },
      ]);

      expect(screen.getByText("1 sent, 1 skipped.")).toBeInTheDocument();
      expect(
        screen.getByText(/Not a member of this project\./),
      ).toBeInTheDocument();
    });

    test("an outcome this build has never heard of is counted as skipped, not sent", async () => {
      /*
       * Erring towards "skipped" is the safe direction: understating the good
       * news costs nothing, while counting an unknown outcome as a send is the
       * page claiming a reminder went out that may not have.
       */
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        {
          userId: PARTIAL_USER_ID,
          outcome: "SomethingNewFromTheFuture",
          message: "Unknown outcome.",
        },
      ]);

      expect(screen.getByText("1 sent, 1 skipped.")).toBeInTheDocument();
    });

    test("the selection is cleared once the run completes", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        { userId: PARTIAL_USER_ID, outcome: "Sent", message: "Sent." },
      ]);

      /*
       * Through the table's own selection sync rather than immediately: the page
       * drops the ids, the table copies the empty list into its bar on the next
       * pass. The bar going away is the fact worth asserting; the pass it takes
       * to get there is not.
       */
      await waitFor((): void => {
        expect(screen.queryByText("Bulk Actions")).toBeNull();
      });
    });

    test("the report can be dismissed", async () => {
      await runReminderForBoth([
        { userId: UNREACHABLE_USER_ID, outcome: "Sent", message: "Sent." },
        { userId: PARTIAL_USER_ID, outcome: "Sent", message: "Sent." },
      ]);

      fireEvent.click(screen.getByText("Dismiss"));

      expect(screen.queryByText(/Setup reminders:/)).toBeNull();
    });
  });

  describe("the setup-reminder control - when the request itself fails", () => {
    type FailedRunFunction = () => Promise<void>;

    const runFailingReminder: FailedRunFunction = async (): Promise<void> => {
      respondWith(summaryJson(ALL_THREE_USERS));
      postMock.mockRejectedValue(new Error("Network is unreachable") as never);

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      selectResponder("Zed Unreachable");
      runBulkAction("Send setup reminder");
      fireEvent.click(
        screen.getByRole("button", { name: "Send setup reminder" }),
      );

      await waitFor((): void => {
        expect(
          screen.getByText(/We could not confirm which reminders were sent\./),
        ).toBeInTheDocument();
      });
    };

    test("it does not claim nothing was sent, because it cannot know", async () => {
      /*
       * The endpoint fans out up to 250 sequential sends inside ONE request, so a
       * rejected request does not mean nothing left the building - a gateway
       * timeout mid-fan-out looks identical here and some mail HAS gone. The old
       * copy said "No reminders were sent." and was a guess dressed as a fact.
       */
      await runFailingReminder();

      expect(screen.queryByText(/No reminders were sent\./)).toBeNull();
    });

    test("it says plainly what happened, in the server's words", async () => {
      await runFailingReminder();

      expect(screen.getByText(/Network is unreachable/)).toBeInTheDocument();
    });

    test("it never renders a per-user report alongside the failure", async () => {
      await runFailingReminder();

      expect(screen.queryByText(/Setup reminders:/)).toBeNull();
    });

    test("the selection survives, so the run can be retried", async () => {
      await runFailingReminder();

      expect(screen.getByText("1 Responders Selected")).toBeInTheDocument();
    });

    test("a non-200 answer is a failure, not a silent success", async () => {
      /*
       * API.post RESOLVES with an error response rather than throwing for a
       * non-2xx, so a page that only caught rejections would render a clean
       * banner over a request the server refused.
       */
      respondWith(summaryJson(ALL_THREE_USERS));
      postMock.mockResolvedValue(
        new HTTPErrorResponse(500, { message: "boom" }, {}) as never,
      );

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      selectResponder("Zed Unreachable");
      runBulkAction("Send setup reminder");
      fireEvent.click(
        screen.getByRole("button", { name: "Send setup reminder" }),
      );

      await waitFor((): void => {
        expect(
          screen.getByText(/We could not confirm which reminders were sent\./),
        ).toBeInTheDocument();
      });

      expect(screen.queryByText(/Setup reminders:/)).toBeNull();
    });
  });

  /*
   * A slow request has to keep the page's shape. A centred spinner where the
   * table belongs reads as "this feature is broken" rather than "this is still
   * loading" - the same reason ResponderReadinessCard draws skeletons.
   */
  describe("while loading", () => {
    test("draws skeletons rather than a bare spinner", async () => {
      neverRespond();

      const container: HTMLElement = await renderProjectPage();

      expect(
        container.querySelectorAll(".animate-pulse").length,
      ).toBeGreaterThan(0);
    });

    test("keeps the card chrome on screen", async () => {
      neverRespond();

      await renderProjectPage();

      expect(screen.getByText("On-call readiness")).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });

  /*
   * Tone follows the value. Hardcoded amber and red tiles paint a warning and a
   * critical zero on a project where every responder is reachable, which teaches
   * the reader that the colours here mean nothing - and the day one of them does
   * mean something, they have already stopped looking.
   */
  describe("the summary tiles", () => {
    test("a healthy project renders no warning or critical tone", async () => {
      respondWith(summaryJson([READY_USER]));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Ada Ready");

      const tiles: HTMLElement | null = container.querySelector(
        "div.mb-6.grid",
      ) as HTMLElement | null;

      if (!tiles) {
        throw new Error("no summary tile grid");
      }

      expect(tiles.querySelector(".text-amber-700")).toBeNull();
      expect(tiles.querySelector(".text-red-700")).toBeNull();
      expect(tiles.querySelector(".bg-emerald-50")).not.toBeNull();
    });

    test("a project with real gaps still colours them", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      const tiles: HTMLElement | null = container.querySelector(
        "div.mb-6.grid",
      ) as HTMLElement | null;

      if (!tiles) {
        throw new Error("no summary tile grid");
      }

      expect(tiles.querySelector(".text-amber-700")).not.toBeNull();
      expect(tiles.querySelector(".text-red-700")).not.toBeNull();
    });
  });

  /*
   * Filtering from the tiles.
   *
   * The tiles already carry the three counts an admin triages by, so they are
   * the control that filters to those states - one object holding the number and
   * the action on it. They replaced a private pill strip that no other table in
   * the product had, and, crucially, they go through the ORDINARY filter: the
   * result announces itself in the standard chip banner and clears with the
   * standard Clear Filters, so a filter applied from a tile and one applied from
   * the modal are the same thing in the same place.
   */
  describe("filtering from the summary tiles", () => {
    type FilterToUnreachableFunction = () => void;

    const filterToUnreachable: FilterToUnreachableFunction = (): void => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Filter to responders who are unreachable",
        }),
      );
    };

    test("filtering to unreachable hides the other two", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      filterToUnreachable();

      expect(screen.getByText("Zed Unreachable")).toBeInTheDocument();
      expect(screen.queryByText("Ada Ready")).toBeNull();
      expect(screen.queryByText("Jane Partial")).toBeNull();
    });

    test("a filter that matches nobody says so", async () => {
      respondWith(summaryJson([READY_USER]));

      await renderProjectPage();

      await screen.findByText("Ada Ready");

      filterToUnreachable();

      expect(
        screen.getByText("No responders match these filters."),
      ).toBeInTheDocument();
    });

    /*
     * A tile-driven filter is a real filter, which means the reader can see it
     * and undo it from the same place as any other. A private pill strip could
     * not say this: it announced nothing, so a reader who scrolled past it read
     * a filtered table as the whole project.
     */
    test("the filter announces itself in the standard chip banner", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      filterToUnreachable();

      expect(
        screen.getByText("Showing Responders that match"),
      ).toBeInTheDocument();
      expect(screen.getByText("Clear Filters")).toBeInTheDocument();
    });

    test("pressing the same tile again clears it", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      filterToUnreachable();

      expect(screen.queryByText("Ada Ready")).toBeNull();

      filterToUnreachable();

      expect(screen.getByText("Ada Ready")).toBeInTheDocument();
    });

    test("the pressed tile says it is pressed", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      const tile: HTMLElement = screen.getByRole("button", {
        name: "Filter to responders who are unreachable",
      });

      expect(tile).toHaveAttribute("aria-pressed", "false");

      filterToUnreachable();

      expect(tile).toHaveAttribute("aria-pressed", "true");
    });

    /*
     * The tiles count the WHOLE project, always. Recomputing them from the
     * filtered rows would make "Unreachable: 1" mean "1 of the rows you can
     * currently see", so pressing the tile would appear to have found every
     * unreachable responder in the project when it had only found the ones the
     * previous filter left behind.
     */
    test("the counts do not shrink to match the filter", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      filterToUnreachable();

      const tiles: HTMLElement | null = container.querySelector(
        "div.mb-6.grid",
      ) as HTMLElement | null;

      if (!tiles) {
        throw new Error("no summary tile grid");
      }

      // Three responders, one of each state, even though one row is showing.
      expect(within(tiles).getByText("3")).toBeInTheDocument();
      expect(within(tiles).getAllByText("1")).toHaveLength(3);
    });
  });

  /*
   * The filter modal - the same one every other table in the product opens from
   * the same funnel in the same corner.
   */
  describe("the filter modal", () => {
    /*
     * The row for one filter, found by its label. The modal holds several
     * comboboxes and they are indistinguishable by role alone, so every
     * interaction here is scoped to the row it belongs to - a document-wide
     * query would drive whichever control happened to render first and pass for
     * the wrong reason.
     */
    type FilterRowFunction = (title: string) => HTMLElement;

    const filterRow: FilterRowFunction = (title: string): HTMLElement => {
      const row: HTMLElement | null = screen
        .getByText(title, { selector: "label" })
        .closest("div.grid") as HTMLElement | null;

      if (!row) {
        throw new Error(`no filter row for ${title}`);
      }

      return row;
    };

    type PickOptionFunction = (
      filterTitle: string,
      optionLabel: string,
    ) => Promise<void>;

    /*
     * Opening the menu is ArrowDown on the combobox - react-select mounts its
     * option list lazily and no other interaction brings it into the DOM.
     *
     * The options themselves are then found document-wide rather than inside the
     * row, because react-select PORTALS its menu out of the row it belongs to.
     * Scoping to the row finds nothing; scoping to the option role is what keeps
     * this honest, since only one menu is ever open at a time and "Needs setup"
     * is also a tile label.
     */
    const pickOption: PickOptionFunction = async (
      filterTitle: string,
      optionLabel: string,
    ): Promise<void> => {
      fireEvent.keyDown(within(filterRow(filterTitle)).getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });

      const options: Array<HTMLElement> = await screen.findAllByRole("option");

      const option: HTMLElement | undefined = options.find(
        (candidate: HTMLElement): boolean => {
          return candidate.textContent === optionLabel;
        },
      );

      if (!option) {
        throw new Error(`no "${optionLabel}" option under ${filterTitle}`);
      }

      fireEvent.click(option);
    };

    type ApplyFiltersFunction = () => void;

    const applyFilters: ApplyFiltersFunction = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    };

    test("the funnel opens it", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      expect(screen.queryByText("Filter Responders")).toBeNull();

      openFilterModal();

      expect(screen.getByText("Filter Responders")).toBeInTheDocument();
    });

    test("it offers responder, status, team and reached-via", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openFilterModal();

      expect(filterRow("Responder")).toBeInTheDocument();
      expect(filterRow("Status")).toBeInTheDocument();
      expect(filterRow("Team")).toBeInTheDocument();
      expect(filterRow("Reached via")).toBeInTheDocument();
    });

    /*
     * Filtering by a free-text name is the one an admin reaches for when they
     * are chasing a particular person rather than triaging a state.
     */
    test("the responder filter matches on name", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openFilterModal();

      fireEvent.change(within(filterRow("Responder")).getByRole("textbox"), {
        target: { value: "jane" },
      });

      applyFilters();

      expect(screen.getByText("Jane Partial")).toBeInTheDocument();
      expect(screen.queryByText("Zed Unreachable")).toBeNull();
      expect(screen.queryByText("Ada Ready")).toBeNull();
    });

    /*
     * The login address, not only the display name. Two people called "J. Smith"
     * are told apart by their email and by nothing else, and it is the field an
     * admin is most likely to have in hand when somebody hands them a ticket.
     */
    test("the responder filter matches on the login email too", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openFilterModal();

      fireEvent.change(within(filterRow("Responder")).getByRole("textbox"), {
        target: { value: "zed.unreachable@example.com" },
      });

      applyFilters();

      expect(screen.getByText("Zed Unreachable")).toBeInTheDocument();
      expect(screen.queryByText("Jane Partial")).toBeNull();
    });

    test("filtering by status narrows the table", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openFilterModal();

      await pickOption("Status", "Needs setup");

      applyFilters();

      expect(screen.getByText("Jane Partial")).toBeInTheDocument();
      expect(screen.queryByText("Zed Unreachable")).toBeNull();
      expect(screen.queryByText("Ada Ready")).toBeNull();
    });

    test("filtering by how a responder is reached narrows the table", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openFilterModal();

      await pickOption("Reached via", "Schedule");

      applyFilters();

      expect(screen.getByText("Jane Partial")).toBeInTheDocument();
      expect(screen.queryByText("Zed Unreachable")).toBeNull();
    });
  });

  /*
   * Filtering by team.
   *
   * "Team" here means the on-call teams that PAGE a responder, not every team
   * they belong to, and the difference is what makes the filter worth having: a
   * team with no escalation rule attached to it pages nobody, so offering it
   * would be an option that always answers with an empty table.
   */
  describe("filtering by team", () => {
    type OpenTeamFilterFunction = () => Promise<void>;

    const teamRow: () => HTMLElement = (): HTMLElement => {
      const row: HTMLElement | null = screen
        .getByText("Team", { selector: "label" })
        .closest("div.grid") as HTMLElement | null;

      if (!row) {
        throw new Error("no team filter row");
      }

      return row;
    };

    const openTeamFilter: OpenTeamFilterFunction = async (): Promise<void> => {
      respondWith(
        summaryJson([
          READY_USER,
          PARTIAL_USER,
          UNREACHABLE_USER,
          TWO_TEAM_USER,
        ]),
      );

      await renderProjectPage();

      await screen.findByText("Ravi Twoteams");

      openFilterModal();

      fireEvent.keyDown(within(teamRow()).getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    };

    type PickTeamFunction = (name: string) => Promise<void>;

    /*
     * The menu is portalled out of the row, so the option is found by role
     * document-wide. Only one menu is open at a time, and a team name is also a
     * chip in the table - the role is what tells the two apart.
     */
    const pickTeam: PickTeamFunction = async (name: string): Promise<void> => {
      fireEvent.keyDown(within(teamRow()).getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });

      const option: HTMLElement | undefined = (
        await screen.findAllByRole("option")
      ).find((candidate: HTMLElement): boolean => {
        return candidate.textContent === name;
      });

      if (!option) {
        throw new Error(`no "${name}" option in the team filter`);
      }

      fireEvent.click(option);
    };

    const applyFilters: () => void = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    };

    /*
     * The options come from the rows themselves rather than from the project's
     * team list. Every option therefore has at least one responder behind it,
     * where a project-wide list would offer teams that page nobody.
     */
    test("the options are the teams that actually page somebody", async () => {
      await openTeamFilter();

      /*
       * Scoped to the open menu rather than the document: the table's
       * pagination bar carries a page-size select, whose native options are
       * `option`s too and are there whether a menu is open or not.
       */
      const menu: HTMLElement = await screen.findByRole("listbox");

      const options: Array<string> = within(menu)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        });

      expect(options).toEqual(["Payments", "Platform"]);
    });

    test("picking a team hides the responders it does not page", async () => {
      await openTeamFilter();

      await pickTeam("Payments");

      applyFilters();

      expect(screen.getByText("Ravi Twoteams")).toBeInTheDocument();
      expect(screen.queryByText("Ada Ready")).toBeNull();
      expect(screen.queryByText("Jane Partial")).toBeNull();
      expect(screen.queryByText("Zed Unreachable")).toBeNull();
    });

    /*
     * A responder on two attached teams is paged by both, so they belong under
     * either filter. An "equals" comparison could not express that at all, which
     * is why every filter on this page is a set intersection.
     */
    test("a responder on two teams appears under either of them", async () => {
      await openTeamFilter();

      await pickTeam("Platform");

      applyFilters();

      expect(screen.getByText("Ravi Twoteams")).toBeInTheDocument();
      expect(screen.getByText("Ada Ready")).toBeInTheDocument();
      expect(screen.queryByText("Jane Partial")).toBeNull();
    });

    test("two teams at once is a union, not an intersection", async () => {
      await openTeamFilter();

      await pickTeam("Platform");
      await pickTeam("Payments");

      applyFilters();

      expect(screen.getByText("Ravi Twoteams")).toBeInTheDocument();
      expect(screen.getByText("Ada Ready")).toBeInTheDocument();
      expect(screen.queryByText("Zed Unreachable")).toBeNull();
    });

    /*
     * Filters compose. Team AND status is the question an admin actually has -
     * "who on Platform cannot be paged" - and answering it must not silently
     * drop one half of it.
     */
    test("team and status narrow together", async () => {
      await openTeamFilter();

      await pickTeam("Platform");

      const statusRow: HTMLElement | null = screen
        .getByText("Status", { selector: "label" })
        .closest("div.grid") as HTMLElement | null;

      if (!statusRow) {
        throw new Error("no status filter row");
      }

      fireEvent.keyDown(within(statusRow).getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });

      const statusOption: HTMLElement | undefined = (
        await screen.findAllByRole("option")
      ).find((candidate: HTMLElement): boolean => {
        return candidate.textContent === "Needs setup";
      });

      if (!statusOption) {
        throw new Error("no needs-setup option in the status filter");
      }

      fireEvent.click(statusOption);

      applyFilters();

      expect(screen.getByText("Ravi Twoteams")).toBeInTheDocument();
      expect(screen.queryByText("Ada Ready")).toBeNull();
    });
  });

  /*
   * The teams column - the same fact the filter reads, rendered.
   */
  describe("the teams column", () => {
    test("a responder's teams are named in their row", async () => {
      respondWith(summaryJson([TWO_TEAM_USER]));

      await renderProjectPage();

      await screen.findByText("Ravi Twoteams");

      const row: HTMLElement = tableRowFor("Ravi Twoteams");

      expect(within(row).getByText("Platform")).toBeInTheDocument();
      expect(within(row).getByText("Payments")).toBeInTheDocument();
    });

    /*
     * A responder reached directly or through a schedule has no team involved at
     * all, so an empty cell is not a gap to be fixed. It renders as a dash rather
     * than as "None", which would read like something is missing.
     */
    test("a responder no team pages renders a dash, not an accusation", async () => {
      respondWith(summaryJson([UNREACHABLE_USER]));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      const row: HTMLElement = tableRowFor("Zed Unreachable");

      expect(within(row).getByText("—")).toBeInTheDocument();
    });
  });

  /*
   * Sorting and paging - two things the hand-rolled table never had. The old one
   * showed 25 rows behind a "Show more" button and could not be reordered at all,
   * so an admin looking for one name in a project of two hundred had to scroll.
   */
  describe("sorting and paging", () => {
    type ManyUsersFunction = (count: number) => JSONArray;

    const manyUsers: ManyUsersFunction = (count: number): JSONArray => {
      const users: JSONArray = [];

      for (let index: number = 0; index < count; index++) {
        users.push({
          ...UNREACHABLE_USER,
          userId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          userName: `Responder ${String(index).padStart(3, "0")}`,
          userEmail: `responder${index}@example.com`,
        });
      }

      return users;
    };

    test("the first page holds one page of rows, not all of them", async () => {
      respondWith(summaryJson(manyUsers(30)));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Responder 000");

      expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
      expect(screen.queryByText("Responder 029")).toBeNull();
    });

    test("the rest are one page away", async () => {
      respondWith(summaryJson(manyUsers(30)));

      await renderProjectPage();

      await screen.findByText("Responder 000");

      /*
       * Named by aria-label, and rendered twice - desktop and mobile layouts,
       * separated by CSS alone - so the first one is the one on screen at this
       * viewport.
       */
      fireEvent.click(
        screen.getAllByRole("button", { name: "Go to next page" })[0]!,
      );

      expect(await screen.findByText("Responder 029")).toBeInTheDocument();
      expect(screen.queryByText("Responder 000")).toBeNull();
    });

    /*
     * The default order is the page's editorial position - unreachable first,
     * then the most incomplete - and clicking a header replaces it. Both have to
     * work: an admin triaging wants the default, and an admin hunting for a name
     * wants the alphabet.
     */
    test("clicking a column header reorders the table", async () => {
      respondWith(summaryJson(ALL_THREE_USERS));

      const container: HTMLElement = await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      fireEvent.click(screen.getByText("Responder"));

      await waitFor((): void => {
        const rows: Array<string> = Array.from(
          container.querySelectorAll("tbody tr"),
        ).map((row: Element): string => {
          return row.textContent || "";
        });

        expect(rows[0]).toContain("Ada Ready");
      });
    });
  });

  /*
   * The coverage grid, in a modal rather than an expanded row.
   */
  describe("the coverage modal", () => {
    test("it is closed until the row's own button opens it", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      expect(screen.queryByText("Incident severities")).toBeNull();

      openCoverage("Jane Partial");

      expect(screen.getByText("Incident severities")).toBeInTheDocument();
    });

    test("it names the responder it is about", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(screen.getByText("Coverage for Jane Partial")).toBeInTheDocument();
    });

    test("it carries the reasons behind the status", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      expect(
        screen.getByText("No notification rule for alerts at Sev1."),
      ).toBeInTheDocument();
    });

    test("it closes again", async () => {
      respondWith(summaryJson([PARTIAL_USER]));

      await renderProjectPage();

      await screen.findByText("Jane Partial");

      openCoverage("Jane Partial");

      /*
       * The footer button. The header carries a close icon labelled "Close" too,
       * and either one shuts the modal - this is the one a reader reaches for.
       */
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(screen.queryByText("Incident severities")).toBeNull();
    });

    /*
     * A responder with nothing set up at all cannot be fixed by an admin - only
     * they can add a notification method - so the panel says that rather than
     * offering an edit that does not exist.
     */
    test("a responder with no methods is told who can fix it", async () => {
      respondWith(summaryJson([UNREACHABLE_USER]));

      await renderProjectPage();

      await screen.findByText("Zed Unreachable");

      openCoverage("Zed Unreachable");

      expect(
        screen.getByText(/No notification methods at all/),
      ).toBeInTheDocument();
    });
  });
});

/*
 * Parsing the teams a responder is paged through.
 *
 * This list is what builds the readiness table's team filter - its options AND
 * the values those options submit - so an entry that survives parsing without
 * both halves is an option nobody can choose deliberately. The parse therefore
 * drops rather than repairs, in both directions, and the browser half of that
 * rule is asserted here independently of the server half.
 */
describe("parsing a responder's teams", () => {
  type TeamNamesFunction = (teams: unknown) => Array<string>;

  const teamNamesFrom: TeamNamesFunction = (teams: unknown): Array<string> => {
    return toUserReadiness({
      ...READY_USER,
      teams: teams as JSONArray,
    }).teams.map((team: { name: string }): string => {
      return team.name;
    });
  };

  test("a well-formed team survives with both halves", () => {
    const parsed: UserReadinessWire = toUserReadiness({
      ...READY_USER,
      teams: [PLATFORM_TEAM],
    });

    expect(parsed.teams).toEqual([{ _id: PLATFORM_TEAM_ID, name: "Platform" }]);
  });

  /*
   * An id wrapped by ObjectID.toJSON() is flattened rather than stringified into
   * "[object Object]". A filter carrying that value matches nothing, and matching
   * nothing looks exactly like a team with no responders.
   */
  test("an ObjectID-wrapped id is flattened to the plain string", () => {
    const parsed: UserReadinessWire = toUserReadiness({
      ...READY_USER,
      teams: [
        {
          _id: { _type: "ObjectID", value: PLATFORM_TEAM_ID },
          name: "Platform",
        },
      ] as JSONArray,
    });

    expect(parsed.teams[0]!._id).toBe(PLATFORM_TEAM_ID);
  });

  test("a team with no name is dropped rather than rendered blank", () => {
    expect(teamNamesFrom([{ _id: PLATFORM_TEAM_ID }, PAYMENTS_TEAM])).toEqual([
      "Payments",
    ]);
  });

  test("a team with no id is dropped rather than rendered unfilterable", () => {
    expect(teamNamesFrom([{ name: "Ghost" }, PAYMENTS_TEAM])).toEqual([
      "Payments",
    ]);
  });

  /*
   * A browser holding this bundle can be talking to a server that predates the
   * field. An empty list is the only reading of "not sent" that does not crash a
   * render or invent a team.
   */
  test("a payload with no teams field at all parses to an empty list", () => {
    const withoutTeams: JSONObject = { ...READY_USER };
    delete withoutTeams["teams"];

    expect(toUserReadiness(withoutTeams).teams).toEqual([]);
  });

  test("a teams field that is not an array parses to an empty list", () => {
    expect(teamNamesFrom("Platform")).toEqual([]);
  });
});

/*
 * The render-layer masking guard.
 *
 * Deliberately independent of the server's masking tests: those prove the
 * service masks, these prove the browser never un-masks. Every fixture method
 * carries the raw value alongside the masked one under three plausible field
 * names, so a component that starts reading `identifier`, or a parse that starts
 * copying unknown keys through, fails here.
 */
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
     *
     * The pagination bar is cut out first. `textContent` joins siblings with
     * no separator, so its page-size options ("10", "20", "25", "50", "100")
     * fuse into "10202550100" - a digit run long enough to read as a phone
     * number. The bar renders no identifiers, so it comes out of the shape
     * scan rather than the shape being loosened everywhere. The raw-value
     * scan above still covers the whole container, bar included.
     */
    const withoutPagination: HTMLElement = container.cloneNode(
      true,
    ) as HTMLElement;

    withoutPagination
      .querySelectorAll('nav[aria-label^="Pagination"]')
      .forEach((paginationBar: Element): void => {
        paginationBar.remove();
      });

    expect(withoutPagination.textContent || "").not.toMatch(
      UNMASKED_EMAIL_PATTERN,
    );
    expect(withoutPagination.textContent || "").not.toMatch(
      UNMASKED_PHONE_PATTERN,
    );
  };

  test("the policy card renders masked identifiers only", async () => {
    respondWith(summaryJson(ALL_THREE_USERS));

    const container: HTMLElement = await renderPolicyCard();

    await screen.findByText("Zed Unreachable");

    // The masked forms are present, so this is not passing by rendering nothing.
    expect(container.textContent).toContain(MASKED_EMAIL);
    expect(container.textContent).toContain(MASKED_PHONE);

    assertNoRawIdentifiers(container);
  });

  test("the readiness page renders masked identifiers only", async () => {
    respondWith(summaryJson(ALL_THREE_USERS));

    const container: HTMLElement = await renderProjectPage();

    await screen.findByText("Zed Unreachable");

    openCoverage("Jane Partial");

    expect(container.textContent).toContain(MASKED_EMAIL);
    expect(container.textContent).toContain(MASKED_PHONE);
    expect(container.textContent).toContain(MASKED_TELEGRAM);

    assertNoRawIdentifiers(container);
  });

  /*
   * The unverified method is the one most likely to be rendered carelessly,
   * since it is the only one drawn with an extra badge beside it.
   */
  test("an unverified method is labelled, still masked", async () => {
    respondWith(summaryJson([PARTIAL_USER]));

    const container: HTMLElement = await renderProjectPage();

    await screen.findByText("Jane Partial");

    openCoverage("Jane Partial");

    expect(screen.getByText("Unverified")).toBeInTheDocument();
    assertNoRawIdentifiers(container);
  });

  /*
   * The mail draft is the one place a whole address is legitimate - it is the
   * mailto recipient, and it is the login email an admin can already read on
   * every other screen. It must never be a notification-method identifier.
   */
  test("the mail draft carries the login address and no method identifier", async () => {
    respondWith(summaryJson([PARTIAL_USER]));

    await renderPolicyCard();

    await screen.findByText("Jane Partial");

    const href: string = decodeURIComponent(
      cardRowFor("Jane Partial")
        .querySelector('a[href^="mailto:"]')
        ?.getAttribute("href") || "",
    );

    expect(href).toContain("jane.partial@example.com");

    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(href).not.toContain(raw);
    }
  });
});
