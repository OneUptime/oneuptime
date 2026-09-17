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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ON-CALL RULE PAGES' DELETE GUARD, AS THE BROWSER RUNS IT.
 *
 * DeletionImpactModal and the arithmetic behind it are unit tested elsewhere.
 * They were also, for an entire phase, unreachable: every rule table still
 * passed `isDeleteable={true}`, so the modal had no production caller and a
 * responder deleting the last rule covering a severity still met the stock
 * "are you sure". Passing tests were not evidence the feature existed.
 *
 * So these tests deliberately do NOT render the modal. They render the real
 * page component, click the real Delete control on a real table row, and assert
 * on what appears - which is the only thing that can distinguish "the guard is
 * built" from "the guard is wired". Put a page back to `isDeleteable={true}`
 * with no action button and its tests here fail, because the stock
 * confirmation carries none of the numbers they assert on.
 */

const getMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
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
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

/*
 * Permissions and identity are read straight out of storage and cookies by the
 * real utils. Neither is what these tests are about, and both are what decides
 * whether a Delete control is offered at all, so they are stubbed to values the
 * individual tests set.
 */
let permissionsForTest: Array<any> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return permissionsForTest;
      },
      getProjectPermissions: () => {
        return null;
      },
      getGlobalPermissions: () => {
        return null;
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

import AlertOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/AlertOnCallRules";
import IncidentOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentOnCallRules";
import IncidentEpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/IncidentEpisodeOnCallRules";
import EpisodeOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/EpisodeOnCallRules";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Phone from "../../../Types/Phone";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import User from "../../../UI/Utils/User";

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";

const SEV1_ID: string = "eeeeeeee-5555-4555-8555-555555555555";
const SEV2_ID: string = "ffffffff-6666-4666-8666-666666666666";

const RULE_SEV1_EMAIL: string = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const RULE_SEV1_SMS: string = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const RULE_SEV2_EMAIL: string = "33333333-3333-4333-8333-cccccccccccc";

const EMAIL_METHOD_ID: string = "44444444-4444-4444-8444-dddddddddddd";
const SMS_METHOD_ID: string = "55555555-5555-4555-8555-eeeeeeeeeeee";

type EmailMethodFunction = () => UserEmail;

const emailMethod: EmailMethodFunction = (): UserEmail => {
  const email: UserEmail = new UserEmail();
  email.id = new ObjectID(EMAIL_METHOD_ID);
  email.email = new Email("jane@example.com");

  return email;
};

type SmsMethodFunction = () => UserSMS;

const smsMethod: SmsMethodFunction = (): UserSMS => {
  const sms: UserSMS = new UserSMS();
  sms.id = new ObjectID(SMS_METHOD_ID);
  sms.phone = new Phone("+15551230100");

  return sms;
};

type IncidentSeverityFunction = (id: string, name: string) => IncidentSeverity;

const incidentSeverity: IncidentSeverityFunction = (
  id: string,
  name: string,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = new ObjectID(id);
  severity.name = name;

  return severity;
};

type AlertSeverityFunction = (id: string, name: string) => AlertSeverity;

const alertSeverity: AlertSeverityFunction = (
  id: string,
  name: string,
): AlertSeverity => {
  const severity: AlertSeverity = new AlertSeverity();
  severity.id = new ObjectID(id);
  severity.name = name;

  return severity;
};

interface RuleSpec {
  ruleId: string;
  ruleType: NotificationRuleType;
  severityId: string;
  severityName: string;
  method: "email" | "sms";
}

/*
 * A rule as the table hands one to an action button: a real decorated model,
 * because `item.id` is what the page reads off it and a plain object would let
 * a broken read pass.
 */
type RuleModelFunction = (spec: RuleSpec) => UserNotificationRule;

const ruleModel: RuleModelFunction = (spec: RuleSpec): UserNotificationRule => {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.id = new ObjectID(spec.ruleId);
  rule.ruleType = spec.ruleType;
  rule.notifyAfterMinutes = 0;

  if (
    spec.ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT ||
    spec.ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE
  ) {
    rule.alertSeverity = alertSeverity(spec.severityId, spec.severityName);
    rule.alertSeverityId = new ObjectID(spec.severityId);
  } else {
    rule.incidentSeverity = incidentSeverity(
      spec.severityId,
      spec.severityName,
    );
    rule.incidentSeverityId = new ObjectID(spec.severityId);
  }

  if (spec.method === "email") {
    rule.userEmail = emailMethod();
    rule.userEmailId = new ObjectID(EMAIL_METHOD_ID);
  } else {
    rule.userSms = smsMethod();
    rule.userSmsId = new ObjectID(SMS_METHOD_ID);
  }

  return rule;
};

type ListResultFunction = (data: Array<unknown>) => JSONObject;

const listResult: ListResultFunction = (data: Array<unknown>): JSONObject => {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 50,
  } as unknown as JSONObject;
};

/*
 * Two incident rules on Sev1 and one on Sev2. Sev1 survives losing either of
 * its two; Sev2 goes dark the moment its single rule is deleted. That asymmetry
 * is the whole point of the guard, so it is what the fixture is built to
 * express.
 */
const INCIDENT_RULES: Array<RuleSpec> = [
  {
    ruleId: RULE_SEV1_EMAIL,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: SEV1_ID,
    severityName: "Sev1",
    method: "email",
  },
  {
    ruleId: RULE_SEV1_SMS,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: SEV1_ID,
    severityName: "Sev1",
    method: "sms",
  },
  {
    ruleId: RULE_SEV2_EMAIL,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityId: SEV2_ID,
    severityName: "Sev2",
    method: "email",
  },
];

interface PageFixture {
  severities: Array<unknown>;
  rules: Array<RuleSpec>;
  /* Which column of the rule the per-severity tables filter on. */
  severityQueryKey: "incidentSeverityId" | "alertSeverityId";
  severityModelType: unknown;
}

type MockPageFunction = (fixture: PageFixture) => void;

/*
 * The page's own loads and the table's, driven off one fixture.
 *
 * The rule list is filtered here the way the server filters it, because the
 * per-severity tables and the modal ask DIFFERENT questions of the same model -
 * the tables ask for one severity's rules, the modal asks for all of the user's
 * - and a mock that answered both with everything would hide the case where the
 * modal is handed only the rows of the table it was opened from.
 */
const mockPage: MockPageFunction = (fixture: PageFixture): void => {
  getCommonHeadersMock.mockReturnValue({});

  getListMock.mockImplementation((params: any): Promise<JSONObject> => {
    const modelType: unknown = params.modelType;

    if (modelType === fixture.severityModelType) {
      return Promise.resolve(listResult(fixture.severities));
    }

    if (modelType === UserNotificationRule) {
      const query: Record<string, unknown> = (params.query || {}) as Record<
        string,
        unknown
      >;

      /*
       * The modal's read carries no ruleType - it wants everything this user
       * has, across all four rule-type pages.
       */
      if (!query["ruleType"]) {
        return Promise.resolve(listResult(fixture.rules.map(ruleModel)));
      }

      const severityId: string = String(query[fixture.severityQueryKey] || "");

      return Promise.resolve(
        listResult(
          fixture.rules
            .filter((spec: RuleSpec): boolean => {
              return (
                spec.ruleType === query["ruleType"] &&
                spec.severityId === severityId
              );
            })
            .map(ruleModel),
        ),
      );
    }

    /* The verified notification methods behind the "add" dropdown. */
    return Promise.resolve(listResult([]));
  });
};

type SetUserFunction = (options: { isMasterAdmin: boolean }) => void;

const setUser: SetUserFunction = (options: {
  isMasterAdmin: boolean;
}): void => {
  User.setUserId(new ObjectID(USER_ID));
  User.setIsMasterAdmin(options.isMasterAdmin);
};

type OkResponseFunction = (data: JSONObject) => HTTPResponse<JSONObject>;

const okResponse: OkResponseFunction = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

/*
 * The readiness row for this user, as the per-user route serialises one. The
 * exposure sentence ("you are an on-call responder, reached through a team") is
 * the half of the warning that says why any of it matters.
 */
type ReadinessJsonFunction = (overrides: JSONObject) => JSONObject;

const readinessJson: ReadinessJsonFunction = (
  overrides: JSONObject,
): JSONObject => {
  return {
    userId: USER_ID,
    userName: "Alex Chen",
    userEmail: "alex@example.com",
    status: "Ready",
    methods: [],
    coverage: [],
    reasons: [],
    reachedVia: [],
    ...overrides,
  };
};

type FindDeleteButtonsFunction = () => Array<HTMLElement>;

const findDeleteButtons: FindDeleteButtonsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByRole("button", { name: "Delete" });
};

type SettleFunction = () => Promise<void>;

/*
 * Waits until the table has not merely ASKED for the rules but rendered them.
 *
 * Only the tests that assert an ABSENCE need this. "The rules were requested"
 * is true several renders before a row exists, and an absence checked at that
 * moment is an absence of everything - which is how a delete-guard test can
 * pass against a page that has no guard at all.
 */
const settleAfterRulesLoad: SettleFunction = async (): Promise<void> => {
  await waitFor(() => {
    const askedForRules: boolean = (
      getListMock as unknown as { mock: { calls: Array<Array<any>> } }
    ).mock.calls.some((call: Array<any>): boolean => {
      return call[0] && call[0].modelType === UserNotificationRule;
    });

    expect(askedForRules).toBe(true);
  });

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 200);
    });
  });
};

beforeEach(() => {
  /*
   * ProjectUtil reads the project off `/dashboard/:projectId/...`, so the URL
   * is the fixture rather than a mock of the util - the page and the modal both
   * have to agree on which project they are asking about, and a stubbed getter
   * would let them disagree silently.
   */
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/user-settings/on-call-rules`,
  );

  permissionsForTest = [Permission.CurrentUser];
  setUser({ isMasterAdmin: false });
  getMock.mockResolvedValue(okResponse(readinessJson({})) as never);
  deleteItemMock.mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  getMock.mockReset();
  getListMock.mockReset();
  deleteItemMock.mockReset();
  getCommonHeadersMock.mockReset();
});

describe("Incident on-call rules: deleting a rule says what it costs", () => {
  test("the last rule covering a severity is named as the last one", async () => {
    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "This is the last rule covering Incident · Sev2. Deleting it leaves that with no rule.",
      );
    });

    /*
     * And the cell is listed as well as counted - "1 severity" is a number
     * somebody has to translate before they can decide.
     */
    expect(screen.getByTestId("deletion-impact-cells")).toHaveTextContent(
      "Incident · Sev2",
    );
  });

  test("a severity with a second rule behind it is not warned about", async () => {
    mockPage({
      severities: [incidentSeverity(SEV1_ID, "Sev1")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(2);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    /*
     * The property, rather than the exact reassuring sentence: a guard that
     * cried wolf on the safe delete is a guard nobody reads by the time the
     * dangerous one comes round. So this asserts the alarm is NOT raised - no
     * orphaned-cell block, no "last rule" claim - and leaves the wording of the
     * all-clear to the component.
     */
    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "You are not currently a responder on any on-call policy in this project.",
      );
    });

    expect(screen.queryByTestId("deletion-impact-cells")).toBeNull();
    expect(
      screen.getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("This is the last rule covering");
  });

  test("it says who is relying on this person when the server knows", async () => {
    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });
    getMock.mockResolvedValue(
      okResponse(readinessJson({ reachedVia: ["Team"] })) as never,
    );

    render(<IncidentOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "You are an on-call responder in this project, reached through a team.",
      );
    });
  });

  /*
   * The guard explains; it does not block. Confirming has to actually delete
   * the row that was clicked, or the whole thing is a nag.
   */
  test("confirming deletes the rule that was clicked", async () => {
    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "This is the last rule covering Incident · Sev2",
      );
    });

    /*
     * Two controls now read "Delete": the row's and the confirmation's. The
     * last one in the document is the modal's submit.
     */
    const deleteControls: Array<HTMLElement> = findDeleteButtons();
    fireEvent.click(deleteControls[deleteControls.length - 1]!);

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalled();
    });

    const call: any = (deleteItemMock as any).mock.calls[0][0];
    expect(call.modelType).toBe(UserNotificationRule);
    expect(call.id.toString()).toBe(RULE_SEV2_EMAIL);
  });

  /*
   * The submit is held only while the counts are still in flight. A
   * confirmation that resolves before its own explanation arrives is the same
   * as no explanation.
   */
  test("the confirmation is not clickable until it knows the cost", async () => {
    let releaseRules: (() => void) | null = null;

    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    const previousImplementation: any = (
      getListMock as any
    ).getMockImplementation()!;

    getListMock.mockImplementation((params: any): Promise<JSONObject> => {
      const query: Record<string, unknown> = (params.query || {}) as Record<
        string,
        unknown
      >;

      if (params.modelType === UserNotificationRule && !query["ruleType"]) {
        return new Promise<JSONObject>((resolve: (v: JSONObject) => void) => {
          releaseRules = (): void => {
            resolve(listResult(INCIDENT_RULES.map(ruleModel)));
          };
        });
      }

      return previousImplementation(params);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Checking what this deletes...",
      );
    });

    const heldControls: Array<HTMLElement> = findDeleteButtons();
    fireEvent.click(heldControls[heldControls.length - 1]!);

    expect(deleteItemMock).not.toHaveBeenCalled();

    releaseRules!();

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "This is the last rule covering Incident · Sev2",
      );
    });

    const readyControls: Array<HTMLElement> = findDeleteButtons();
    fireEvent.click(readyControls[readyControls.length - 1]!);

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalled();
    });
  });

  /*
   * The gate the table applied before this change. Replacing its delete action
   * with our own would otherwise offer a Delete button to somebody the server
   * is going to refuse.
   */
  test("a member with no delete permission is offered no delete at all", async () => {
    permissionsForTest = [];
    setUser({ isMasterAdmin: false });

    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: INCIDENT_RULES,
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentOnCallRules {...({} as any)} />);

    await settleAfterRulesLoad();

    /*
     * Row rendering is what makes this non-vacuous. Hand the table an action
     * button unconditionally and the Actions column alone is enough to render
     * it - with a Delete on every row - in place of the refusal below.
     */
    expect(findDeleteButtons().length).toBe(0);
    expect(
      screen.getByText(/You are not authorized to view this table/),
    ).toBeInTheDocument();
  });
});

/*
 * The other three pages are near-identical copies of the first (the shared
 * extraction is a separate piece of work), so each one is checked for the same
 * property rather than the same four. A copy that was missed is a page where
 * deleting the last rule is still silent, and that is exactly what a
 * copy-paste-and-forget produces.
 */
describe("The other three rule pages carry the same guard", () => {
  test("alert rules", async () => {
    mockPage({
      severities: [alertSeverity(SEV2_ID, "Sev2")],
      rules: [
        {
          ruleId: RULE_SEV2_EMAIL,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          severityId: SEV2_ID,
          severityName: "Sev2",
          method: "email",
        },
      ],
      severityQueryKey: "alertSeverityId",
      severityModelType: AlertSeverity,
    });

    render(<AlertOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "This is the last rule covering Alert · Sev2. Deleting it leaves that with no rule.",
      );
    });
  });

  test("alert episode rules", async () => {
    mockPage({
      severities: [alertSeverity(SEV2_ID, "Sev2")],
      rules: [
        {
          ruleId: RULE_SEV2_EMAIL,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
          severityId: SEV2_ID,
          severityName: "Sev2",
          method: "email",
        },
      ],
      severityQueryKey: "alertSeverityId",
      severityModelType: AlertSeverity,
    });

    render(<EpisodeOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Deleting it leaves that with no rule.",
      );
    });
  });

  test("incident episode rules", async () => {
    mockPage({
      severities: [incidentSeverity(SEV2_ID, "Sev2")],
      rules: [
        {
          ruleId: RULE_SEV2_EMAIL,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          severityId: SEV2_ID,
          severityName: "Sev2",
          method: "email",
        },
      ],
      severityQueryKey: "incidentSeverityId",
      severityModelType: IncidentSeverity,
    });

    render(<IncidentEpisodeOnCallRules {...({} as any)} />);

    await waitFor(() => {
      expect(findDeleteButtons().length).toBe(1);
    });

    fireEvent.click(findDeleteButtons()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Deleting it leaves that with no rule.",
      );
    });
  });
});
