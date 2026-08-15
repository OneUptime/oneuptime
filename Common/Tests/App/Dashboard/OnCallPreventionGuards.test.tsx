import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * PHASE 4 - the guards that stop the mistake being made.
 *
 * Everything the readiness feature shipped before this reports a problem that
 * already exists, on a surface somebody has to go and look at. The two guards
 * covered here run at the two moments the problem is CREATED - an unreachable
 * person being added to an escalation rule, and a notification method or rule
 * being deleted out from under the severities it covers - and the properties
 * worth testing are the ones that decide whether a warning gets read or clicked
 * through:
 *
 *   - it names REAL NUMBERS and real people, because "this may affect your
 *     on-call coverage" is true before every delete and therefore says nothing;
 *   - it stays SILENT when nothing is wrong, including for the amber
 *     PartiallyReady state, because a modal that lights up every time anybody is
 *     added is a modal whose red block stops registering;
 *   - it is HONEST when it does not know, rather than rendering the same nothing
 *     a healthy responder renders;
 *   - it never BLOCKS, because adding somebody who is halfway through verifying
 *     a phone is a legitimate thing to do;
 *   - and the reminder it offers reports what the SERVER said happened, not the
 *     fact that a request was made.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

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
      post: (...args: Array<any>) => {
        return postMock(...args);
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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
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

import EscalationRules, {
  AddResponderWarning,
  AddedResponderCheck,
  MembersByRuleId,
  SetupReminderStatus,
  describeEscalationRuleDeletion,
  fetchResponderCheck,
  getAddedUserIds,
  getEscalationRuleDeletionImpact,
  getResponderDisplayName,
  getRespondersToWarnAbout,
  parseUserReadinessPayload,
  readSetupReminderStatus,
  requestSetupReminder,
  toSelectedOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import {
  CoverageCell,
  DeletionImpact,
  DeletionImpactModal,
  NotificationRuleFacts,
  OnCallExposure,
  UNKNOWN_ON_CALL_EXPOSURE,
  buildCoverageCells,
  computeMethodDeletionImpact,
  computeRuleDeletionImpact,
  describeMethodDeletion,
  describeOnCallExposure,
  describeRuleDeletion,
  getCellLabel,
  parseOnCallExposure,
  readRuleFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod";
import { UserReadinessWire } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import EmailMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Email";
import SMSMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS";
import CallMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call";
import PushMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push";
import WhatsAppMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/WhatsApp";
import TelegramMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram";
import WebhookMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Webhook";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { ColumnValueReader } from "../../../UI/Utils/NotificationMethodUtil";

const USER_ALEX: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_SAM: string = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_JO: string = "cccccccc-3333-4333-8333-333333333333";

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-444444444444",
);

const SEV1_ID: string = "eeeeeeee-5555-4555-8555-555555555555";
const SEV2_ID: string = "ffffffff-6666-4666-8666-666666666666";

const EMAIL_METHOD_ID: string = "11111111-7777-4777-8777-777777777777";
const SMS_METHOD_ID: string = "22222222-8888-4888-8888-888888888888";

type OkResponseFunction = (data: JSONObject) => HTTPResponse<JSONObject>;

const okResponse: OkResponseFunction = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

afterEach(() => {
  cleanup();
  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  deleteItemMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

/*
 * A readiness row as the per-user route serialises one. Built through the
 * component's own parser rather than as a literal, so a change to the payload
 * shape breaks these fixtures the same way it would break the browser.
 */
type ReadinessJsonFunction = (overrides: JSONObject) => JSONObject;

const readinessJson: ReadinessJsonFunction = (
  overrides: JSONObject,
): JSONObject => {
  return {
    userId: USER_ALEX,
    userName: "Alex Chen",
    userEmail: "alex@example.com",
    status: "NotReachable",
    methods: [],
    coverage: [],
    reasons: [],
    reachedVia: [],
    ...overrides,
  };
};

type CheckFunction = (
  overrides: Partial<AddedResponderCheck>,
) => Array<AddedResponderCheck>;

const checksFor: CheckFunction = (
  overrides: Partial<AddedResponderCheck>,
): Array<AddedResponderCheck> => {
  return [
    {
      userId: USER_ALEX,
      label: "Alex Chen",
      state: "checked",
      readiness: parseUserReadinessPayload(readinessJson({})),
      ...overrides,
    },
  ];
};

const NO_REMINDERS: Record<string, SetupReminderStatus> = {};

describe("Add-responder guard: reading the form selection", () => {
  test("flattens option envelopes and bare ids into id/label pairs", () => {
    expect(
      toSelectedOptions([
        { value: USER_ALEX, label: "Alex Chen" },
        USER_SAM,
        null,
        undefined,
      ]),
    ).toEqual([
      { id: USER_ALEX, label: "Alex Chen" },
      { id: USER_SAM, label: "" },
    ]);
  });

  test("a non-array selection is no selection rather than a crash", () => {
    expect(toSelectedOptions(undefined)).toEqual([]);
    expect(toSelectedOptions("not-an-array")).toEqual([]);
  });

  test("only the ids new to this rule count as added, in pick order", () => {
    expect(getAddedUserIds([USER_SAM, USER_ALEX, USER_JO], [USER_SAM])).toEqual(
      [USER_ALEX, USER_JO],
    );
  });

  /*
   * The edit modal opens pre-populated. Without the baseline every open would
   * re-accuse the rule's existing responders of being unreachable - a warning
   * about something this admin did not just do.
   */
  test("an untouched edit selection adds nobody", () => {
    expect(
      getAddedUserIds([USER_SAM, USER_ALEX], [USER_SAM, USER_ALEX]),
    ).toEqual([]);
  });

  test("a duplicate pick is checked once", () => {
    expect(getAddedUserIds([USER_ALEX, USER_ALEX], [])).toEqual([USER_ALEX]);
  });
});

describe("Add-responder guard: reading the readiness payload", () => {
  test("parses a per-user payload into a readiness row", () => {
    const readiness: UserReadinessWire | null = parseUserReadinessPayload(
      readinessJson({ status: "Ready" }),
    );

    expect(readiness).not.toBeNull();
    expect(readiness!.userId).toBe(USER_ALEX);
    expect(readiness!.userName).toBe("Alex Chen");
    expect(readiness!.status).toBe("Ready");
  });

  /*
   * The shared parser fills defaults rather than throwing, so a body this
   * surface cannot understand would otherwise come back as a responder with an
   * empty id and a defaulted amber status - which this warning stays silent
   * about. Refusing it is what turns that into a visible "we could not check".
   */
  test("a payload with no user id is refused rather than defaulted", () => {
    expect(parseUserReadinessPayload({})).toBeNull();
    expect(parseUserReadinessPayload({ status: "Ready" })).toBeNull();
  });

  test("an unrecognised status degrades to amber, not to green", () => {
    const readiness: UserReadinessWire | null = parseUserReadinessPayload(
      readinessJson({ status: "SomethingNew" }),
    );

    expect(readiness!.status).toBe("PartiallyReady");
  });
});

describe("Add-responder guard: who is worth warning about", () => {
  test("an unreachable responder is warned about", () => {
    expect(getRespondersToWarnAbout(checksFor({}))).toHaveLength(1);
  });

  test("a ready responder is silent", () => {
    expect(
      getRespondersToWarnAbout(
        checksFor({
          readiness: parseUserReadinessPayload(
            readinessJson({ status: "Ready" }),
          ),
        }),
      ),
    ).toHaveLength(0);
  });

  /*
   * The alarm-fatigue property, asserted rather than assumed. On a project with
   * the fallback on - the default - a PartiallyReady responder's pages still
   * arrive, and most responders on a project with many severities are amber. A
   * block that fires for them fires almost always.
   */
  test("a partially ready responder is silent", () => {
    expect(
      getRespondersToWarnAbout(
        checksFor({
          readiness: parseUserReadinessPayload(
            readinessJson({ status: "PartiallyReady" }),
          ),
        }),
      ),
    ).toHaveLength(0);
  });

  test("a responder still being checked is shown", () => {
    expect(
      getRespondersToWarnAbout(
        checksFor({ state: "checking", readiness: null }),
      ),
    ).toHaveLength(1);
  });

  test("a responder we could not check is shown", () => {
    expect(
      getRespondersToWarnAbout(
        checksFor({ state: "unavailable", readiness: null }),
      ),
    ).toHaveLength(1);
  });

  test("names come from the readiness row, then the dropdown, then neither", () => {
    expect(
      getResponderDisplayName({
        userId: USER_ALEX,
        label: "Picked From Dropdown",
        state: "checked",
        readiness: parseUserReadinessPayload(readinessJson({})),
      }),
    ).toBe("Alex Chen");

    expect(
      getResponderDisplayName({
        userId: USER_ALEX,
        label: "Picked From Dropdown",
        state: "checking",
        readiness: null,
      }),
    ).toBe("Picked From Dropdown");

    expect(
      getResponderDisplayName({
        userId: USER_ALEX,
        label: "",
        state: "unavailable",
        readiness: null,
      }),
    ).toBe("This responder");
  });
});

describe("Add-responder guard: what the admin actually reads", () => {
  test("an unreachable responder is named, and the consequence is stated", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByTestId("add-responder-unreachable")).toBeInTheDocument();
    expect(screen.getByText("Alex Chen cannot be paged")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Alex Chen has no verified notification method, so every page routed to them is dropped\./,
      ),
    ).toBeInTheDocument();
  });

  /*
   * The two NotReachable branches are different problems with different fixes -
   * "they never verified anything" versus "this project switched off the only
   * channel they have" - and an admin who is sent to chase the wrong one wastes
   * the trip.
   */
  test("methods on switched-off channels get their own sentence", () => {
    render(
      <AddResponderWarning
        checks={checksFor({
          readiness: parseUserReadinessPayload(
            readinessJson({
              methods: [
                {
                  methodType: "SMS",
                  maskedIdentifier: "+1 ••• ••• 4821",
                  isVerified: true,
                },
              ],
            }),
          ),
        })}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(
      screen.getByText(/this project has those channels switched off/),
    ).toBeInTheDocument();
  });

  test("it says out loud that it is not a block", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "You can still add them - this is a warning, not a block.",
      ),
    ).toBeInTheDocument();
  });

  test("a healthy selection renders nothing at all", () => {
    const { container } = render(
      <AddResponderWarning
        checks={checksFor({
          readiness: parseUserReadinessPayload(
            readinessJson({ status: "Ready" }),
          ),
        })}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("a lookup that failed says so rather than staying quiet", () => {
    render(
      <AddResponderWarning
        checks={checksFor({ state: "unavailable", readiness: null })}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByTestId("add-responder-unknown")).toBeInTheDocument();
    expect(
      screen.getByText(/We could not check whether Alex Chen can be paged/),
    ).toBeInTheDocument();
  });

  test("an in-flight lookup keeps the name on screen", () => {
    render(
      <AddResponderWarning
        checks={checksFor({ state: "checking", readiness: null })}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByTestId("add-responder-checking")).toBeInTheDocument();
    expect(
      screen.getByText(/Checking whether Alex Chen can be paged/),
    ).toBeInTheDocument();
  });

  test("several added responders each get their own block", () => {
    render(
      <AddResponderWarning
        checks={[
          ...checksFor({}),
          {
            userId: USER_SAM,
            label: "Sam Doe",
            state: "checked",
            readiness: parseUserReadinessPayload(
              readinessJson({
                userId: USER_SAM,
                userName: "Sam Doe",
                userEmail: "sam@example.com",
              }),
            ),
          },
        ]}
        reminders={NO_REMINDERS}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getAllByTestId("add-responder-unreachable")).toHaveLength(2);
    expect(screen.getByText("Sam Doe cannot be paged")).toBeInTheDocument();
  });
});

describe("Add-responder guard: the reminder it offers", () => {
  test("the reminder is offered, and clicking it asks for that user", () => {
    const onSendReminder: MockFunction = getJestMockFunction();

    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={NO_REMINDERS}
        onSendReminder={onSendReminder as unknown as (userId: string) => void}
      />,
    );

    fireEvent.click(screen.getByText("Send setup reminder"));

    expect(onSendReminder).toHaveBeenCalledWith(USER_ALEX);
  });

  test("a sent reminder says who it reached, and offers no second send", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={{ [USER_ALEX]: { state: "sent", message: "" } }}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByTestId("setup-reminder-sent")).toHaveTextContent(
      "Setup reminder sent to Alex Chen.",
    );
    expect(screen.queryByText("Send setup reminder")).not.toBeInTheDocument();
  });

  /*
   * The failure this whole control was disabled for two phases to avoid: a
   * reminder that did not go anywhere must not leave a tick behind it. A
   * throttle is not a send.
   */
  test("a skipped reminder is not reported as sent", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={{
          [USER_ALEX]: {
            state: "skipped",
            message: "Alex Chen was already reminded today.",
          },
        }}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.queryByTestId("setup-reminder-sent")).not.toBeInTheDocument();
    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "No reminder was sent. Alex Chen was already reminded today.",
    );
    // And the fix that is always available is still offered.
    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "Ask Alex Chen to finish their notification setup in User Settings.",
    );
  });

  test("a failed reminder shows the server's own words and can be retried", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={{
          [USER_ALEX]: {
            state: "failed",
            message: "No email address on file.",
          },
        }}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "No email address on file.",
    );
    expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
  });

  test("the button is held while a send is in flight", () => {
    render(
      <AddResponderWarning
        checks={checksFor({})}
        reminders={{ [USER_ALEX]: { state: "sending", message: "" } }}
        onSendReminder={() => {}}
      />,
    );

    expect(screen.getByText("Sending...")).toBeInTheDocument();
  });
});

describe("Add-responder guard: reading the reminder endpoint's answer", () => {
  test("a Sent outcome is a send", () => {
    expect(
      readSetupReminderStatus(
        {
          sentCount: 1,
          results: [
            { userId: USER_ALEX, outcome: "Sent", message: "Emailed." },
          ],
        },
        USER_ALEX,
      ),
    ).toEqual({ state: "sent", message: "Emailed." });
  });

  test("a throttled outcome is a skip carrying the server's explanation", () => {
    expect(
      readSetupReminderStatus(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "SkippedThrottled",
              message: "Already reminded in the last 24 hours.",
            },
          ],
        },
        USER_ALEX,
      ),
    ).toEqual({
      state: "skipped",
      message: "Already reminded in the last 24 hours.",
    });
  });

  test("a failed outcome is a failure", () => {
    expect(
      readSetupReminderStatus(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "Failed",
              message: "Mail provider rejected the message.",
            },
          ],
        },
        USER_ALEX,
      ).state,
    ).toBe("failed");
  });

  /*
   * A 200 whose results say nothing about the user we asked about is the one
   * shape that could quietly become a tick over a reminder that never left.
   */
  test("a 200 that says nothing about this user is not a send", () => {
    expect(
      readSetupReminderStatus(
        { results: [{ userId: USER_SAM, outcome: "Sent", message: "" }] },
        USER_ALEX,
      ),
    ).toEqual({
      state: "failed",
      message: "The server did not report an outcome for this reminder.",
    });

    expect(readSetupReminderStatus({}, USER_ALEX).state).toBe("failed");
  });

  test("an outcome this build has never heard of still reads as not-sent", () => {
    expect(
      readSetupReminderStatus(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "SkippedSomethingNewEntirely",
              message: "A future reason.",
            },
          ],
        },
        USER_ALEX,
      ),
    ).toEqual({ state: "skipped", message: "A future reason." });
  });

  test("an outcome with no message still produces a true sentence", () => {
    expect(
      readSetupReminderStatus(
        { results: [{ userId: USER_ALEX, outcome: "Failed" }] },
        USER_ALEX,
      ).message,
    ).toBe('The server reported "Failed" without an explanation.');
  });
});

/*
 * The escalation-level delete confirmation. Every number below comes from rows
 * already on the screen, which is why the sentence can be specific without a
 * request that might fail.
 */
type UserJoinFunction = (userId: string, name: string) => any;

const userJoin: UserJoinFunction = (userId: string, name: string): any => {
  return { user: { id: new ObjectID(userId), name: name } };
};

const membersByRuleId: MembersByRuleId = {
  "rule-1": {
    userJoins: [
      userJoin(USER_ALEX, "Alex Chen"),
      userJoin(USER_SAM, "Sam Doe"),
    ],
    teamJoins: [
      { team: { id: new ObjectID(USER_JO), name: "Platform" } } as any,
    ],
    scheduleJoins: [],
  },
  "rule-2": {
    userJoins: [userJoin(USER_SAM, "Sam Doe")],
    teamJoins: [],
    scheduleJoins: [{ onCallDutyPolicySchedule: { name: "Weekends" } } as any],
  },
};

describe("Escalation-level delete: the consequence is counted", () => {
  test("it counts the users, teams and schedules the level notifies", () => {
    const impact: ReturnType<typeof getEscalationRuleDeletionImpact> =
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-1",
        ruleIds: ["rule-1", "rule-2"],
        membersByRuleId: membersByRuleId,
      });

    expect(impact.userCount).toBe(2);
    expect(impact.teamCount).toBe(1);
    expect(impact.scheduleCount).toBe(0);
    expect(impact.isLastRule).toBe(false);
  });

  /*
   * Sam is on level 2 as well, so deleting level 1 does not take him off the
   * policy. Alex is only here.
   */
  test("it names only the users this policy stops naming altogether", () => {
    const impact: ReturnType<typeof getEscalationRuleDeletionImpact> =
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-1",
        ruleIds: ["rule-1", "rule-2"],
        membersByRuleId: membersByRuleId,
      });

    expect(impact.usersNamedNowhereElse).toEqual(["Alex Chen"]);
  });

  test("deleting the only level is called out as leaving nobody", () => {
    const impact: ReturnType<typeof getEscalationRuleDeletionImpact> =
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-1",
        ruleIds: ["rule-1"],
        membersByRuleId: membersByRuleId,
      });

    expect(impact.isLastRule).toBe(true);
    expect(
      describeEscalationRuleDeletion("First Responders", impact),
    ).toContain("This is the only escalation level on this policy");
  });

  test("the sentence names the level and its responders", () => {
    const sentence: string = describeEscalationRuleDeletion(
      "First Responders",
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-1",
        ruleIds: ["rule-1", "rule-2"],
        membersByRuleId: membersByRuleId,
      }),
    );

    expect(sentence).toContain(
      '"First Responders" notifies 2 users and 1 team.',
    );
    expect(sentence).toContain(
      "Alex Chen is not named on any other level of this policy.",
    );
    expect(sentence).toContain("This action cannot be undone.");
  });

  test("a level that notifies nobody says exactly that", () => {
    const sentence: string = describeEscalationRuleDeletion(
      "Empty Level",
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-3",
        ruleIds: ["rule-1", "rule-2", "rule-3"],
        membersByRuleId: membersByRuleId,
      }),
    );

    expect(sentence).toContain('"Empty Level" currently notifies no one.');
  });

  test("a schedule-only level is described in schedules", () => {
    const sentence: string = describeEscalationRuleDeletion(
      "Weekend Cover",
      getEscalationRuleDeletionImpact({
        ruleIdToDelete: "rule-2",
        ruleIds: ["rule-1", "rule-2"],
        membersByRuleId: membersByRuleId,
      }),
    );

    expect(sentence).toContain(
      '"Weekend Cover" notifies 1 user and 1 on-call schedule.',
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * DELETE GUARDS on notification methods and rules.
 * ---------------------------------------------------------------------------
 */

interface RuleSpec {
  ruleId: string;
  ruleType: NotificationRuleType;
  severityId?: string | undefined;
  severityName?: string | undefined;
  methodRelation?: string | undefined;
  methodId?: string | undefined;
  methodValue?: string | undefined;
  isOptOut?: boolean | undefined;
}

/*
 * A rule as the reader sees one. Deliberately a bare ColumnValueReader rather
 * than a decorated entity: that is the only interface the impact maths uses, and
 * building fixtures through it is what keeps these tests about the arithmetic
 * instead of about TypeORM.
 */
type RuleReaderFunction = (spec: RuleSpec) => ColumnValueReader;

const ruleReader: RuleReaderFunction = (spec: RuleSpec): ColumnValueReader => {
  const columns: Record<string, unknown> = {
    _id: spec.ruleId,
    ruleType: spec.ruleType,
    isOptOut: spec.isOptOut === true,
  };

  if (spec.severityId) {
    const severity: Record<string, unknown> = {
      _id: spec.severityId,
      name: spec.severityName || "",
    };

    if (
      spec.ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT ||
      spec.ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE
    ) {
      columns["alertSeverity"] = severity;
    } else {
      columns["incidentSeverity"] = severity;
    }
  }

  if (spec.methodRelation && spec.methodId) {
    columns[spec.methodRelation] = {
      _id: spec.methodId,
      email: spec.methodRelation === "userEmail" ? spec.methodValue : undefined,
      phone: spec.methodRelation === "userSms" ? spec.methodValue : undefined,
    };
  }

  return {
    getColumnValue: (columnName: string): unknown => {
      return columns[columnName] ?? null;
    },
  } as ColumnValueReader;
};

/*
 * A rule whose severity is written into a NAMED column, rather than into the
 * one its rule type implies.
 *
 * `ruleReader` above always pairs the two correctly, which is exactly why it
 * cannot express the row this feature has to survive: a rule carrying a
 * severity id in the column its type does not use. That row is real - Gap G
 * wrote episode rules with a NULL severity, and any retype or partial write
 * leaves the other column populated - and reading it loosely is how a rule that
 * matches no page at runtime gets counted as cover for one.
 */
interface CrossedColumnRuleSpec {
  ruleId: string;
  ruleType: NotificationRuleType;
  severityColumn: "incidentSeverity" | "alertSeverity";
  severityId: string;
  severityName: string;
  methodRelation: string;
  methodId: string;
}

type CrossedColumnRuleFunction = (
  spec: CrossedColumnRuleSpec,
) => ColumnValueReader;

const crossedColumnRule: CrossedColumnRuleFunction = (
  spec: CrossedColumnRuleSpec,
): ColumnValueReader => {
  const columns: Record<string, unknown> = {
    _id: spec.ruleId,
    ruleType: spec.ruleType,
    isOptOut: false,
    [spec.severityColumn]: { _id: spec.severityId, name: spec.severityName },
    [spec.methodRelation]: {
      _id: spec.methodId,
      email: "jane@example.com",
    },
  };

  return {
    getColumnValue: (columnName: string): unknown => {
      return columns[columnName] ?? null;
    },
  } as ColumnValueReader;
};

const factsFor: (specs: Array<RuleSpec>) => Array<NotificationRuleFacts> = (
  specs: Array<RuleSpec>,
): Array<NotificationRuleFacts> => {
  return specs.map((spec: RuleSpec): NotificationRuleFacts => {
    return readRuleFacts(ruleReader(spec));
  });
};

const EMAIL_ON_SEV1_INCIDENT: RuleSpec = {
  ruleId: "rule-a",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  severityId: SEV1_ID,
  severityName: "Sev1",
  methodRelation: "userEmail",
  methodId: EMAIL_METHOD_ID,
  methodValue: "jane@example.com",
};

const SMS_ON_SEV1_INCIDENT: RuleSpec = {
  ruleId: "rule-b",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  severityId: SEV1_ID,
  severityName: "Sev1",
  methodRelation: "userSms",
  methodId: SMS_METHOD_ID,
  methodValue: "+15550100",
};

const EMAIL_ON_SEV2_ALERT: RuleSpec = {
  ruleId: "rule-c",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  severityId: SEV2_ID,
  severityName: "Sev2",
  methodRelation: "userEmail",
  methodId: EMAIL_METHOD_ID,
  methodValue: "jane@example.com",
};

/* The same cell, deliberately silenced. Carries no method, by definition. */
const MUTED_SEV2_ALERT: RuleSpec = {
  ruleId: "rule-mute-sev2",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  severityId: SEV2_ID,
  severityName: "Sev2",
  isOptOut: true,
};

describe("Delete guards: reading a rule", () => {
  test("it reads the severity, the rule type and the method off one rule", () => {
    const facts: NotificationRuleFacts = readRuleFacts(
      ruleReader(EMAIL_ON_SEV1_INCIDENT),
    );

    expect(facts).toEqual({
      ruleId: "rule-a",
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityId: SEV1_ID,
      severityName: "Sev1",
      methodId: EMAIL_METHOD_ID,
      methodType: "Email",
      methodLabel: "Email: jane@example.com",
      isOptOut: false,
    });
  });

  test("an alert rule's severity comes off the alert relation", () => {
    const facts: NotificationRuleFacts = readRuleFacts(
      ruleReader(EMAIL_ON_SEV2_ALERT),
    );

    expect(facts.severityId).toBe(SEV2_ID);
    expect(facts.severityName).toBe("Sev2");
  });

  /*
   * An opt-out row carries no method at all, and that absence is the point
   * rather than a misconfiguration.
   */
  test("an opt-out row is read as carrying no method", () => {
    const facts: NotificationRuleFacts = readRuleFacts(
      ruleReader({
        ruleId: "rule-mute",
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: SEV2_ID,
        severityName: "Sev2",
        isOptOut: true,
      }),
    );

    expect(facts.isOptOut).toBe(true);
    expect(facts.methodId).toBe("");
    expect(facts.methodLabel).toBe("");
  });

  test("a lifecycle rule type carries no severity", () => {
    const facts: NotificationRuleFacts = readRuleFacts(
      ruleReader({
        ruleId: "rule-handoff",
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        methodRelation: "userEmail",
        methodId: EMAIL_METHOD_ID,
        methodValue: "jane@example.com",
      }),
    );

    expect(facts.severityId).toBe("");
    expect(getCellLabel(buildCoverageCells([facts])[0]!)).toBe("Goes on call");
  });

  /*
   * The severity is taken from the column the RULE TYPE dictates, never from
   * whichever of the two happens to be populated - the rule
   * UserNotificationRuleService states for the server half of this maths and
   * refuses to bend. At runtime an alert rule is only ever matched against an
   * ALERT severity id, so a severity sitting in the incident column of an alert
   * rule covers nothing at all, whatever it looks like.
   */
  test("a severity in the column the rule type does not use is not read", () => {
    const facts: NotificationRuleFacts = readRuleFacts(
      crossedColumnRule({
        ruleId: "rule-crossed",
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityColumn: "incidentSeverity",
        severityId: SEV2_ID,
        severityName: "Sev2",
        methodRelation: "userEmail",
        methodId: EMAIL_METHOD_ID,
      }),
    );

    expect(facts.severityId).toBe("");
    expect(facts.severityName).toBe("");
  });

  test("an episode rule reads the severity its own kind is scoped by", () => {
    expect(
      readRuleFacts(
        crossedColumnRule({
          ruleId: "rule-alert-episode",
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
          severityColumn: "alertSeverity",
          severityId: SEV2_ID,
          severityName: "Sev2",
          methodRelation: "userEmail",
          methodId: EMAIL_METHOD_ID,
        }),
      ).severityId,
    ).toBe(SEV2_ID);

    expect(
      readRuleFacts(
        crossedColumnRule({
          ruleId: "rule-incident-episode",
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          severityColumn: "incidentSeverity",
          severityId: SEV1_ID,
          severityName: "Sev1",
          methodRelation: "userEmail",
          methodId: EMAIL_METHOD_ID,
        }),
      ).severityId,
    ).toBe(SEV1_ID);
  });

  /*
   * The consequence, and the reason the loose read is a bug rather than a
   * tidiness complaint: a mis-columned rule that is read as covering Sev2 alerts
   * VOUCHES for that cell. Delete the one rule that really does deliver there
   * and the warning stays silent, because a rule that can never fire for the
   * cell was counted as cover for it.
   */
  test("a mis-columned rule cannot vouch for a cell it can never fire for", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: [
        readRuleFacts(
          ruleReader({
            ruleId: "rule-real",
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: SEV2_ID,
            severityName: "Sev2",
            methodRelation: "userSms",
            methodId: SMS_METHOD_ID,
            methodValue: "+15550100",
          }),
        ),
        readRuleFacts(
          crossedColumnRule({
            ruleId: "rule-crossed",
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityColumn: "incidentSeverity",
            severityId: SEV2_ID,
            severityName: "Sev2",
            methodRelation: "userEmail",
            methodId: EMAIL_METHOD_ID,
          }),
        ),
      ],
      methodId: SMS_METHOD_ID,
    });

    expect(
      impact.orphanedCells.map((cell: CoverageCell): string => {
        return getCellLabel(cell);
      }),
    ).toEqual(["Alert · Sev2"]);
  });
});

describe("Delete guards: what a method deletion costs", () => {
  test("it counts every rule that points at the method", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: factsFor([
        EMAIL_ON_SEV1_INCIDENT,
        SMS_ON_SEV1_INCIDENT,
        EMAIL_ON_SEV2_ALERT,
      ]),
      methodId: EMAIL_METHOD_ID,
    });

    expect(impact.ruleCount).toBe(2);
  });

  /*
   * The central piece of arithmetic. Sev1 incidents keep the SMS rule, so that
   * cell survives; Sev2 alerts had only the email rule, so that one goes dark.
   * A warning that named both would be crying wolf, and one that named neither
   * would be the silence this feature exists to end.
   */
  test("only the cells left with nothing are named", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: factsFor([
        EMAIL_ON_SEV1_INCIDENT,
        SMS_ON_SEV1_INCIDENT,
        EMAIL_ON_SEV2_ALERT,
      ]),
      methodId: EMAIL_METHOD_ID,
    });

    expect(
      impact.orphanedCells.map((cell: CoverageCell): string => {
        return getCellLabel(cell);
      }),
    ).toEqual(["Alert · Sev2"]);
  });

  /*
   * A muted cell is a cell whose silence was chosen. Warning about it nags
   * somebody for having configured the product correctly.
   */
  test("a cell the user muted is never reported as a loss", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: factsFor([
        EMAIL_ON_SEV2_ALERT,
        {
          ruleId: "rule-mute",
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          severityId: SEV2_ID,
          severityName: "Sev2",
          isOptOut: true,
        },
      ]),
      methodId: EMAIL_METHOD_ID,
    });

    expect(impact.ruleCount).toBe(1);
    expect(impact.orphanedCells).toHaveLength(0);
  });

  test("a method nothing points at costs nothing", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV1_INCIDENT]),
      methodId: SMS_METHOD_ID,
    });

    expect(impact.ruleCount).toBe(0);
    expect(impact.orphanedCells).toHaveLength(0);
  });

  /*
   * An empty method id must not match the empty method id every opt-out row
   * carries, or muting one severity would make every method look load bearing.
   */
  test("an empty method id matches nothing", () => {
    const impact: DeletionImpact = computeMethodDeletionImpact({
      rules: factsFor([
        EMAIL_ON_SEV1_INCIDENT,
        {
          ruleId: "rule-mute",
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          severityId: SEV2_ID,
          isOptOut: true,
        },
      ]),
      methodId: "",
    });

    expect(impact.ruleCount).toBe(0);
  });
});

describe("Delete guards: what a rule deletion costs", () => {
  test("the last rule for a cell is called out", () => {
    const impact: DeletionImpact = computeRuleDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV1_INCIDENT, EMAIL_ON_SEV2_ALERT]),
      ruleId: "rule-c",
    });

    expect(impact.ruleCount).toBe(1);
    expect(
      impact.orphanedCells.map((cell: CoverageCell): string => {
        return getCellLabel(cell);
      }),
    ).toEqual(["Alert · Sev2"]);
  });

  test("a rule with a sibling on the same cell leaves no gap", () => {
    const impact: DeletionImpact = computeRuleDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV1_INCIDENT, SMS_ON_SEV1_INCIDENT]),
      ruleId: "rule-a",
    });

    expect(impact.orphanedCells).toHaveLength(0);
  });

  /*
   * An opt-out is a rule that exists in order to deliver NOTHING. It is not a
   * warning when the last delivering rule for a muted cell goes - the silence
   * was chosen - but it is not cover either, and the two must not be reported
   * as the same thing.
   */
  test("a muted cell losing its last delivering rule is tracked, not silently dropped", () => {
    const impact: DeletionImpact = computeRuleDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV2_ALERT, MUTED_SEV2_ALERT]),
      ruleId: "rule-c",
    });

    expect(impact.orphanedCells).toHaveLength(0);
    expect(
      impact.mutedCells.map((cell: CoverageCell): string => {
        return getCellLabel(cell);
      }),
    ).toEqual(["Alert · Sev2"]);
  });

  test("a cell that keeps a delivering rule is neither orphaned nor muted", () => {
    const impact: DeletionImpact = computeRuleDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV1_INCIDENT, SMS_ON_SEV1_INCIDENT]),
      ruleId: "rule-a",
    });

    expect(impact.orphanedCells).toHaveLength(0);
    expect(impact.mutedCells).toHaveLength(0);
  });

  test("cells are keyed on rule type as well as severity", () => {
    /*
     * Same severity id, two rule types. Keying on severity alone would let an
     * incident rule vouch for an alert cell it can never fire for.
     */
    const cells: Array<CoverageCell> = buildCoverageCells(
      factsFor([
        EMAIL_ON_SEV1_INCIDENT,
        {
          ruleId: "rule-d",
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          severityId: SEV1_ID,
          severityName: "Sev1",
          methodRelation: "userEmail",
          methodId: EMAIL_METHOD_ID,
          methodValue: "jane@example.com",
        },
      ]),
    );

    expect(cells).toHaveLength(2);
  });
});

describe("Delete guards: the sentences", () => {
  const exposure: OnCallExposure = {
    isKnown: true,
    isOnCallResponder: true,
    sources: ["Team"],
  };

  test("the method sentence carries the real numbers and the real names", () => {
    const sentence: string = describeMethodDeletion({
      methodLabel: "Email: jane@example.com",
      impact: computeMethodDeletionImpact({
        rules: factsFor([
          EMAIL_ON_SEV1_INCIDENT,
          SMS_ON_SEV1_INCIDENT,
          EMAIL_ON_SEV2_ALERT,
        ]),
        methodId: EMAIL_METHOD_ID,
      }),
      exposure: exposure,
    });

    expect(sentence).toBe(
      "You are an on-call responder in this project, reached through a team. " +
        "Deleting Email: jane@example.com removes 2 notification rules and leaves Alert · Sev2 with no rule.",
    );
  });

  test("a harmless delete is described as harmless", () => {
    const sentence: string = describeMethodDeletion({
      methodLabel: "SMS: +15550100",
      impact: computeMethodDeletionImpact({
        rules: factsFor([EMAIL_ON_SEV1_INCIDENT]),
        methodId: SMS_METHOD_ID,
      }),
      exposure: exposure,
    });

    expect(sentence).toContain(
      "No notification rules use SMS: +15550100, so deleting it does not change how you are paged.",
    );
  });

  test("one rule and one cell are singular", () => {
    const sentence: string = describeMethodDeletion({
      methodLabel: "Email: jane@example.com",
      impact: computeMethodDeletionImpact({
        rules: factsFor([EMAIL_ON_SEV2_ALERT]),
        methodId: EMAIL_METHOD_ID,
      }),
      exposure: UNKNOWN_ON_CALL_EXPOSURE,
    });

    expect(sentence).toBe(
      "Deleting Email: jane@example.com removes 1 notification rule and leaves Alert · Sev2 with no rule.",
    );
  });

  test("the rule sentence says whether this was the last one standing", () => {
    expect(
      describeRuleDeletion({
        impact: computeRuleDeletionImpact({
          rules: factsFor([EMAIL_ON_SEV2_ALERT]),
          ruleId: "rule-c",
        }),
        exposure: UNKNOWN_ON_CALL_EXPOSURE,
      }),
    ).toBe(
      "This is the last rule covering Alert · Sev2. Deleting it leaves that with no rule.",
    );

    expect(
      describeRuleDeletion({
        impact: computeRuleDeletionImpact({
          rules: factsFor([EMAIL_ON_SEV1_INCIDENT, SMS_ON_SEV1_INCIDENT]),
          ruleId: "rule-a",
        }),
        exposure: UNKNOWN_ON_CALL_EXPOSURE,
      }),
    ).toBe(
      "Other rules still cover this severity and rule type, so deleting this one does not leave a gap.",
    );
  });

  /*
   * "Other rules still cover this" is a CLAIM about somebody else picking the
   * page up. An opt-out picks nothing up - it is the row that says do not send -
   * so a cell whose only survivor is one has not been covered by anything, and
   * the sentence that says it has is a false reassurance delivered at the exact
   * moment a person is deciding whether to click Delete.
   */
  test("an opt-out is never described as other rules still covering the cell", () => {
    const sentence: string = describeRuleDeletion({
      impact: computeRuleDeletionImpact({
        rules: factsFor([EMAIL_ON_SEV2_ALERT, MUTED_SEV2_ALERT]),
        ruleId: "rule-c",
      }),
      exposure: UNKNOWN_ON_CALL_EXPOSURE,
    });

    expect(sentence).not.toContain("Other rules still cover");
    expect(sentence).toBe(
      "This is the last rule that delivers for Alert · Sev2. " +
        "The only rule left for it is an opt-out, so nothing will be sent for it once this is gone.",
    );
  });

  /*
   * A muted cell is still not a WARNING. Nothing goes amber, nothing is listed
   * as left with no rule - the user asked for that silence and gets to keep it.
   */
  test("a muted cell is stated, not raised as a coverage loss", () => {
    const impact: DeletionImpact = computeRuleDeletionImpact({
      rules: factsFor([EMAIL_ON_SEV2_ALERT, MUTED_SEV2_ALERT]),
      ruleId: "rule-c",
    });

    expect(impact.orphanedCells).toHaveLength(0);
    expect(
      describeRuleDeletion({
        impact: impact,
        exposure: UNKNOWN_ON_CALL_EXPOSURE,
      }),
    ).not.toContain("with no rule");
  });

  /*
   * The third way orphanedCells comes back empty: the rule was not among the
   * ones we loaded. We do not know what it covered, and a confident "no gap"
   * about a row we could not find is a guess with a sentence wrapped round it.
   */
  test("a rule we could not find is not reported as leaving no gap", () => {
    const sentence: string = describeRuleDeletion({
      impact: computeRuleDeletionImpact({
        rules: factsFor([EMAIL_ON_SEV1_INCIDENT]),
        ruleId: "rule-we-never-loaded",
      }),
      exposure: UNKNOWN_ON_CALL_EXPOSURE,
    });

    expect(sentence).not.toContain("does not leave a gap");
    expect(sentence).toBe(
      "We could not match this rule to your notification rules, so we cannot tell what deleting it leaves uncovered.",
    );
  });

  /*
   * The sentence is dropped rather than softened. "You are not a responder on
   * any on-call policy" is a reassurance, and printing it because the server
   * did not answer is the most dangerous shape this warning could take.
   */
  test("an unknown exposure produces no exposure sentence at all", () => {
    expect(describeOnCallExposure(UNKNOWN_ON_CALL_EXPOSURE)).toBe("");
  });

  test("a known non-responder is told so", () => {
    expect(
      describeOnCallExposure({
        isKnown: true,
        isOnCallResponder: false,
        sources: [],
      }),
    ).toBe(
      "You are not currently a responder on any on-call policy in this project.",
    );
  });

  test("the doors a responder is reached through are named", () => {
    expect(
      describeOnCallExposure({
        isKnown: true,
        isOnCallResponder: true,
        sources: ["Team", "Schedule"],
      }),
    ).toBe(
      "You are an on-call responder in this project, reached through a team and an on-call schedule.",
    );
  });
});

describe("Delete guards: reading exposure off the readiness payload", () => {
  test("reachedVia becomes the exposure", () => {
    const exposure: OnCallExposure = parseOnCallExposure(
      readinessJson({ reachedVia: ["Direct", "Schedule"] }),
    );

    expect(exposure).toEqual({
      isKnown: true,
      isOnCallResponder: true,
      sources: ["Direct", "Schedule"],
    });
  });

  test("an empty reachedVia is a known non-responder", () => {
    expect(parseOnCallExposure(readinessJson({}))).toEqual({
      isKnown: true,
      isOnCallResponder: false,
      sources: [],
    });
  });

  test("a payload with no user in it is unknown, not empty", () => {
    expect(parseOnCallExposure({})).toEqual(UNKNOWN_ON_CALL_EXPOSURE);
  });

  test("a source this build has never heard of is dropped, not rendered", () => {
    const exposure: OnCallExposure = parseOnCallExposure(
      readinessJson({ reachedVia: ["Direct", "SomethingNew"] }),
    );

    expect(exposure.sources).toEqual(["Direct"]);
  });
});

/*
 * The two rendered surfaces. Both load the caller's own rules through ModelAPI
 * and their exposure through the readiness route, so both are driven here by the
 * same pair of mocks.
 */
type RuleModelFunction = (spec: RuleSpec) => any;

const ruleModel: RuleModelFunction = (spec: RuleSpec): any => {
  const reader: ColumnValueReader = ruleReader(spec);

  return {
    getColumnValue: (columnName: string): unknown => {
      return reader.getColumnValue(columnName);
    },
  };
};

type MockRulesFunction = (specs: Array<RuleSpec>) => void;

const mockRules: MockRulesFunction = (specs: Array<RuleSpec>): void => {
  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockResolvedValue({
    data: specs.map(ruleModel),
    count: specs.length,
    skip: 0,
    limit: 50,
  } as never);
};

describe("Delete guards: the confirmation an admin actually reads", () => {
  test("it names the rules and the cells the method takes with it", async () => {
    mockRules([
      EMAIL_ON_SEV1_INCIDENT,
      SMS_ON_SEV1_INCIDENT,
      EMAIL_ON_SEV2_ALERT,
    ]);
    getMock.mockResolvedValue(
      okResponse(readinessJson({ reachedVia: ["Team"] })) as never,
    );

    render(
      <DeletionImpactModal
        target={{
          type: "method",
          methodId: EMAIL_METHOD_ID,
          methodLabel: "Email: jane@example.com",
        }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Email"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Deleting Email: jane@example.com removes 2 notification rules and leaves Alert · Sev2 with no rule.",
      );
    });

    expect(screen.getByTestId("deletion-impact-cells")).toHaveTextContent(
      "Alert · Sev2",
    );
  });

  test("it says who is relying on this person when the server knows", async () => {
    mockRules([EMAIL_ON_SEV2_ALERT]);
    getMock.mockResolvedValue(
      okResponse(readinessJson({ reachedVia: ["Team"] })) as never,
    );

    render(
      <DeletionImpactModal
        target={{
          type: "method",
          methodId: EMAIL_METHOD_ID,
          methodLabel: "Email: jane@example.com",
        }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Email"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "You are an on-call responder in this project, reached through a team.",
      );
    });
  });

  /*
   * The readiness call failing must not take the counts down with it. They are
   * computed from a different read and they are the half that has to be right.
   */
  test("a failed exposure lookup still leaves the counts standing", async () => {
    mockRules([EMAIL_ON_SEV2_ALERT]);
    getMock.mockRejectedValue(new Error("readiness is down") as never);

    render(
      <DeletionImpactModal
        target={{
          type: "method",
          methodId: EMAIL_METHOD_ID,
          methodLabel: "Email: jane@example.com",
        }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Email"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Deleting Email: jane@example.com removes 1 notification rule",
      );
    });

    expect(
      screen.getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("on-call responder");
  });

  /*
   * The honest failure. We know a delete is imminent and we do not know what it
   * costs; saying nothing would let the generic confirmation imply we had
   * checked.
   */
  test("it admits when it could not work the cost out", async () => {
    getCommonHeadersMock.mockReturnValue({});
    getListMock.mockRejectedValue(new Error("rules are unavailable") as never);
    getMock.mockRejectedValue(new Error("readiness is down") as never);

    render(
      <DeletionImpactModal
        target={{
          type: "method",
          methodId: EMAIL_METHOD_ID,
          methodLabel: "Email: jane@example.com",
        }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Email"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "We could not check what this deletes: rules are unavailable",
      );
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Deleting a notification method also deletes every notification rule that uses it.",
    );
  });

  test("confirming is what deletes, and it is never taken away", async () => {
    const onConfirm: MockFunction = getJestMockFunction();

    mockRules([EMAIL_ON_SEV2_ALERT]);
    getMock.mockResolvedValue(okResponse(readinessJson({})) as never);

    render(
      <DeletionImpactModal
        target={{
          type: "method",
          methodId: EMAIL_METHOD_ID,
          methodLabel: "Email: jane@example.com",
        }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Email"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={onConfirm as unknown as () => void}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "removes 1 notification rule",
      );
    });

    fireEvent.click(screen.getByText("Delete"));

    expect(onConfirm).toHaveBeenCalled();
  });

  test("the rule variant answers the only question that matters", async () => {
    mockRules([EMAIL_ON_SEV1_INCIDENT, SMS_ON_SEV1_INCIDENT]);
    getMock.mockResolvedValue(okResponse(readinessJson({})) as never);

    render(
      <DeletionImpactModal
        target={{ type: "rule", ruleId: "rule-a" }}
        userId={new ObjectID(USER_ALEX)}
        projectId={PROJECT_ID}
        title="Delete Notification Rule"
        submitButtonText="Delete"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Other rules still cover this severity and rule type",
      );
    });
  });
});

/*
 * The escalation-rule surface rendered for real, wiring and all.
 *
 * The pure helpers above prove the arithmetic; this proves it is CONNECTED. A
 * guard whose copy is perfect and whose confirmation modal still shows the old
 * generic sentence has prevented nothing, and that failure is invisible to every
 * test that stops at the function boundary.
 */
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-9999-4999-8999-999999999999",
);

const RULE_ONE_ID: ObjectID = new ObjectID(
  "88888888-1010-4010-8010-101010101010",
);
const RULE_TWO_ID: ObjectID = new ObjectID(
  "99999999-2020-4020-8020-202020202020",
);

type EscalationDataFunction = () => void;

const mockEscalationPolicy: EscalationDataFunction = (): void => {
  getCommonHeadersMock.mockReturnValue({});

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  /*
   * Keyed on the SELECT rather than the model class, because all three join
   * reads issue the same query against the same policy and only their selects
   * tell them apart - which is also exactly how a reader of the component tells
   * them apart.
   */
  getListMock.mockImplementation((params: any): Promise<any> => {
    const select: Record<string, unknown> = params.select || {};

    if (select["escalateAfterInMinutes"]) {
      return Promise.resolve({
        data: [
          {
            id: RULE_ONE_ID,
            name: "First Responders",
            escalateAfterInMinutes: 5,
            order: 1,
          },
          {
            id: RULE_TWO_ID,
            name: "Backup",
            escalateAfterInMinutes: 10,
            order: 2,
          },
        ],
        count: 2,
        skip: 0,
        limit: 50,
      });
    }

    if (select["user"]) {
      return Promise.resolve({
        data: [
          {
            id: new ObjectID("aaaaaaaa-0001-4001-8001-000000000001"),
            onCallDutyPolicyEscalationRuleId: RULE_ONE_ID,
            user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" },
          },
          {
            id: new ObjectID("aaaaaaaa-0002-4002-8002-000000000002"),
            onCallDutyPolicyEscalationRuleId: RULE_ONE_ID,
            user: { id: new ObjectID(USER_SAM), name: "Sam Doe" },
          },
          {
            id: new ObjectID("aaaaaaaa-0003-4003-8003-000000000003"),
            onCallDutyPolicyEscalationRuleId: RULE_TWO_ID,
            user: { id: new ObjectID(USER_SAM), name: "Sam Doe" },
          },
        ],
        count: 3,
        skip: 0,
        limit: 50,
      });
    }

    if (select["team"]) {
      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });

  // The policy readiness the escalation summary loads for its chip dots.
  getMock.mockResolvedValue(
    okResponse({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyId: POLICY_ID.toString(),
      isFallbackEnabled: true,
      isTruncated: false,
      totalCount: 0,
      hasMore: false,
      users: [],
    }) as never,
  );
};

describe("Escalation rules, wired: the delete confirmation says what it costs", () => {
  test("the confirmation counts the level's responders and names who else loses cover", async () => {
    mockEscalationPolicy();

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      /*
       * The name appears twice on purpose - once in the escalation summary and
       * once on the rule card - so the wait is on the delete control, which
       * exists exactly once per level and is the thing the next line clicks.
       */
      expect(screen.getAllByLabelText("Delete rule").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByLabelText("Delete rule")[0]!);

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    const description: string =
      screen.getByTestId("confirm-modal-description").textContent || "";

    expect(description).toContain('"First Responders" notifies 2 users.');
    /*
     * Sam is on the second level too, so only Alex is left with nothing. The
     * generic sentence this replaced ("its notification targets will be
     * removed") could not tell those two apart.
     */
    expect(description).toContain(
      "Alex Chen is not named on any other level of this policy.",
    );
    expect(description).not.toContain("Sam Doe");
    expect(description).not.toContain(
      "This is the only escalation level on this policy",
    );
  });

  test("deleting the last remaining level says the policy will page no one", async () => {
    mockEscalationPolicy();
    getListMock.mockImplementation((params: any): Promise<any> => {
      const select: Record<string, unknown> = params.select || {};

      if (select["escalateAfterInMinutes"]) {
        return Promise.resolve({
          data: [
            {
              id: RULE_ONE_ID,
              name: "First Responders",
              escalateAfterInMinutes: 5,
              order: 1,
            },
          ],
          count: 1,
          skip: 0,
          limit: 50,
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      /*
       * The name appears twice on purpose - once in the escalation summary and
       * once on the rule card - so the wait is on the delete control, which
       * exists exactly once per level and is the thing the next line clicks.
       */
      expect(screen.getAllByLabelText("Delete rule").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByLabelText("Delete rule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "This is the only escalation level on this policy. Deleting it leaves the policy with nobody to notify, so an incident routed here would page no one.",
      );
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE SEVEN METHOD TABLES, RENDERED FOR REAL.
 * ---------------------------------------------------------------------------
 *
 * This block exists because the first cut of this feature shipped a correct,
 * fully tested DeletionImpactModal that NOTHING OPENED. Every table still
 * passed `isDeleteable={true}`, so a delete went through ModelTable's generic
 * "are you sure" and none of the arithmetic above ever ran. Every test passed.
 *
 * So these tests refuse to hand the modal its props. They render the real
 * component, wait for the real row, click the real Delete control, and assert on
 * what a person would then be looking at. The only thing that can make them pass
 * is a delete that actually goes through the guard.
 *
 * The second assertion in each case is the one that catches the half-measure:
 * exactly ONE Delete control per row. `isDeleteable={true}` left alongside a
 * custom Delete action gives two, and whichever one the user reaches for first
 * decides whether they are told anything.
 */

interface MethodSurface {
  /* What the tab is called, and the noun in the modal title. */
  name: string;
  Component: () => ReactElement;
  modelType: DatabaseBaseModelType;
  /* The relation on UserNotificationRule that points at this model. */
  relationName: string;
  methodId: string;
  /* One row, as the table's own list read would return it. */
  buildRow: () => BaseModel;
  /* The title the impact modal is expected to wear. */
  modalTitle: string;
  /* How the method is expected to be named in the sentence. */
  methodLabel: string;
}

type BuildRowFunction = (
  modelType: DatabaseBaseModelType,
  methodId: string,
  columns: JSONObject,
) => BaseModel;

const buildMethodRow: BuildRowFunction = (
  modelType: DatabaseBaseModelType,
  methodId: string,
  columns: JSONObject,
): BaseModel => {
  const model: BaseModel = new modelType();

  model.id = new ObjectID(methodId);

  for (const columnName of Object.keys(columns)) {
    (model as unknown as Record<string, unknown>)[columnName] =
      columns[columnName];
  }

  return model;
};

const METHOD_ID_CALL: string = "33333333-9999-4999-8999-999999999999";
const METHOD_ID_PUSH: string = "44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const METHOD_ID_WHATSAPP: string = "55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const METHOD_ID_TELEGRAM: string = "66666666-cccc-4ccc-8ccc-cccccccccccc";
const METHOD_ID_WEBHOOK: string = "77777777-dddd-4ddd-8ddd-dddddddddddd";

const METHOD_SURFACES: Array<MethodSurface> = [
  {
    name: "Email",
    Component: EmailMethods,
    modelType: UserEmail,
    relationName: "userEmail",
    methodId: EMAIL_METHOD_ID,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserEmail, EMAIL_METHOD_ID, {
        email: new Email("jane@example.com") as never,
        isVerified: true,
      });
    },
    modalTitle: "Delete Email",
    methodLabel: "Email: jane@example.com",
  },
  {
    name: "SMS",
    Component: SMSMethods,
    modelType: UserSMS,
    relationName: "userSms",
    methodId: SMS_METHOD_ID,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserSMS, SMS_METHOD_ID, {
        phone: new Phone("+15551230100") as never,
        isVerified: true,
      });
    },
    modalTitle: "Delete Phone Number",
    methodLabel: "SMS: +15551230100",
  },
  {
    name: "Call",
    Component: CallMethods,
    modelType: UserCall,
    relationName: "userCall",
    methodId: METHOD_ID_CALL,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserCall, METHOD_ID_CALL, {
        phone: new Phone("+15551230199") as never,
        isVerified: true,
      });
    },
    modalTitle: "Delete Phone Number",
    methodLabel: "Call: +15551230199",
  },
  {
    name: "Push",
    Component: PushMethods,
    modelType: UserPush,
    relationName: "userPush",
    methodId: METHOD_ID_PUSH,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserPush, METHOD_ID_PUSH, {
        deviceName: "Chrome on macOS",
      });
    },
    modalTitle: "Delete Device",
    methodLabel: "Push: Chrome on macOS",
  },
  {
    name: "WhatsApp",
    Component: WhatsAppMethods,
    modelType: UserWhatsApp,
    relationName: "userWhatsApp",
    methodId: METHOD_ID_WHATSAPP,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserWhatsApp, METHOD_ID_WHATSAPP, {
        phone: new Phone("+15551230123") as never,
        isVerified: true,
      });
    },
    modalTitle: "Delete WhatsApp Number",
    methodLabel: "WhatsApp: +15551230123",
  },
  {
    name: "Telegram",
    Component: TelegramMethods,
    modelType: UserTelegram,
    relationName: "userTelegram",
    methodId: METHOD_ID_TELEGRAM,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserTelegram, METHOD_ID_TELEGRAM, {
        telegramUserHandle: "@alexchen",
        isVerified: true,
      });
    },
    modalTitle: "Delete Telegram Account",
    methodLabel: "Telegram: @alexchen",
  },
  {
    name: "Webhook",
    Component: WebhookMethods,
    modelType: UserWebhook,
    relationName: "userWebhook",
    methodId: METHOD_ID_WEBHOOK,
    buildRow: (): BaseModel => {
      return buildMethodRow(UserWebhook, METHOD_ID_WEBHOOK, {
        name: "Internal alerts",
      });
    },
    modalTitle: "Delete Webhook",
    methodLabel: "Webhook: Internal alerts",
  },
];

/*
 * The session these pages read themselves out of. The components take the user
 * and the project from the real utils rather than from props, so the storage
 * those utils read is set instead of stubbing them - the guard passing the
 * WRONG user id to the impact lookup is a failure worth being able to catch,
 * and a stub would hide it.
 */
type SignInFunction = () => void;

const signIn: SignInFunction = (): void => {
  localStorage.setItem("user_id", USER_ALEX);
  localStorage.setItem("is_master_admin", "true");
  sessionStorage.setItem("current_project_id", PROJECT_ID.toString());
};

/*
 * One rule, pointing at the method about to be deleted, covering Sev2 alerts and
 * nothing else. Deleting the method therefore costs exactly one rule and leaves
 * exactly one cell with nothing - numbers small enough to state in the assertion
 * and specific enough that a generic confirmation could not have produced them.
 */
type MockMethodTableFunction = (surface: MethodSurface) => void;

const mockMethodTable: MockMethodTableFunction = (
  surface: MethodSurface,
): void => {
  getCommonHeadersMock.mockReturnValue({});

  getListMock.mockImplementation((params: any): Promise<any> => {
    if (params.modelType === UserNotificationRule) {
      return Promise.resolve({
        data: [
          ruleModel({
            ruleId: "rule-on-this-method",
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severityId: SEV2_ID,
            severityName: "Sev2",
            methodRelation: surface.relationName,
            methodId: surface.methodId,
            methodValue: "does-not-matter",
          }),
        ],
        count: 1,
        skip: 0,
        limit: 50,
      });
    }

    if (params.modelType === surface.modelType) {
      return Promise.resolve({
        data: [surface.buildRow()],
        count: 1,
        skip: 0,
        limit: 50,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });

  getMock.mockResolvedValue(
    okResponse(readinessJson({ reachedVia: ["Team"] })) as never,
  );
};

type OpenDeleteFunction = () => Promise<void>;

const openDeleteConfirmation: OpenDeleteFunction = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getAllByText("Delete").length).toBeGreaterThan(0);
  });

  /*
   * Exactly one Delete control on the row. Two would mean the built-in delete
   * was left switched on beside the guard, and a user reaching for the wrong one
   * gets the generic confirmation and no numbers at all.
   */
  expect(screen.getAllByText("Delete")).toHaveLength(1);

  fireEvent.click(screen.getByText("Delete"));

  await waitFor(() => {
    expect(screen.getByTestId("confirm-modal-description")).toBeInTheDocument();
  });

  /*
   * And what opened is the impact modal, not ModelTable's fixed-description
   * confirmation. Without this line a table that still routes its delete
   * through the built-in "Are you sure you want to delete this user email?"
   * would satisfy every step above.
   */
  expect(
    screen.queryByText(/Are you sure you want to delete/),
  ).not.toBeInTheDocument();
};

/*
 * The confirmation's own button, not the row's. Once the modal is open the page
 * carries two controls reading "Delete" and clicking the wrong one would prove
 * nothing.
 */
type ClickInModalFunction = (name: string) => void;

const clickInModal: ClickInModalFunction = (name: string): void => {
  fireEvent.click(
    within(screen.getByTestId("modal")).getByRole("button", { name: name }),
  );
};

describe.each(METHOD_SURFACES)(
  "$name methods, wired: deleting goes through the impact modal",
  (surface: MethodSurface) => {
    test("the Delete control opens the impact modal, with the real numbers", async () => {
      signIn();
      mockMethodTable(surface);

      render(<surface.Component />);

      await openDeleteConfirmation();

      await waitFor(() => {
        expect(
          screen.getByTestId("confirm-modal-description"),
        ).toHaveTextContent(
          `Deleting ${surface.methodLabel} removes 1 notification rule and leaves Alert · Sev2 with no rule.`,
        );
      });

      // The cells are listed as well as counted.
      expect(screen.getByTestId("deletion-impact-cells")).toHaveTextContent(
        "Alert · Sev2",
      );

      // The stakes, read off the readiness route for this user.
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "You are an on-call responder in this project, reached through a team.",
      );

      // Titled for this method, so the reader knows which row they are on.
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        surface.modalTitle,
      );
    });

    test("the impact is computed for the signed-in user's own rules", async () => {
      signIn();
      mockMethodTable(surface);

      render(<surface.Component />);

      await openDeleteConfirmation();

      const ruleReadCalls: Array<any> = (getListMock as any).mock.calls.filter(
        (call: Array<any>): boolean => {
          return call[0].modelType === UserNotificationRule;
        },
      );

      expect(ruleReadCalls.length).toBeGreaterThan(0);
      expect(ruleReadCalls[0][0].query.userId.toString()).toBe(USER_ALEX);
      expect(ruleReadCalls[0][0].query.projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    test("confirming is what deletes, and it deletes this row", async () => {
      signIn();
      mockMethodTable(surface);
      deleteItemMock.mockResolvedValue(undefined as never);

      render(<surface.Component />);

      await openDeleteConfirmation();

      await waitFor(() => {
        expect(
          screen.getByTestId("confirm-modal-description"),
        ).toHaveTextContent("removes 1 notification rule");
      });

      // The modal's own submit, which only exists once the guard has opened it.
      clickInModal("Delete");

      await waitFor(() => {
        expect(deleteItemMock).toHaveBeenCalled();
      });

      const deleteCall: any = (deleteItemMock as any).mock.calls[0][0];

      expect(deleteCall.modelType).toBe(surface.modelType);
      expect(deleteCall.id.toString()).toBe(surface.methodId);
    });

    /*
     * Opening the confirmation must not delete anything. It reads as obvious and
     * it is the property that lets the modal be honest rather than a gate: a
     * person who reads what it costs and changes their mind has to end up with
     * the method still there.
     */
    test("opening the confirmation deletes nothing on its own", async () => {
      signIn();
      mockMethodTable(surface);

      render(<surface.Component />);

      await openDeleteConfirmation();

      expect(deleteItemMock).not.toHaveBeenCalled();

      clickInModal("Cancel");

      await waitFor(() => {
        expect(
          screen.queryByTestId("confirm-modal-description"),
        ).not.toBeInTheDocument();
      });

      expect(deleteItemMock).not.toHaveBeenCalled();
    });

    /*
     * A delete that fails leaves the row on screen. Closing the modal on failure
     * would leave a person looking at a method they believe they just deleted.
     */
    test("a failed delete is reported in the modal rather than swallowed", async () => {
      signIn();
      mockMethodTable(surface);
      deleteItemMock.mockRejectedValue(
        new Error("You do not have permission to delete this.") as never,
      );

      render(<surface.Component />);

      await openDeleteConfirmation();

      await waitFor(() => {
        expect(
          screen.getByTestId("confirm-modal-description"),
        ).toHaveTextContent("removes 1 notification rule");
      });

      clickInModal("Delete");

      await waitFor(() => {
        expect(
          screen.getByText("You do not have permission to delete this."),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });
  },
);

/*
 * The two requests the guard actually makes.
 *
 * Tested against the mocked transport rather than through the form, because the
 * failure worth catching here is a wiring failure - the wrong route, the wrong
 * body, an error path that silently produces a healthy-looking check - and none
 * of those is visible from the pure helpers above.
 */
describe("Add-responder guard: the readiness lookup it issues", () => {
  test("it asks the per-user readiness route, with the session headers", async () => {
    getCommonHeadersMock.mockReturnValue({ tenantid: "a-project" });
    getMock.mockResolvedValue(okResponse(readinessJson({})) as never);

    const check: AddedResponderCheck = await fetchResponderCheck({
      userId: USER_ALEX,
      label: "Alex Chen",
    });

    const request: any = (getMock as any).mock.calls[0][0];

    expect(request.url.toString()).toContain(
      `/on-call-readiness/user/${USER_ALEX}`,
    );
    expect(request.headers).toEqual({ tenantid: "a-project" });
    expect(check.state).toBe("checked");
    expect(check.readiness!.status).toBe("NotReachable");
  });

  /*
   * The whole reason "unavailable" exists. A rejected lookup that produced a
   * missing check would render as nothing, and nothing is what a healthy
   * responder renders.
   */
  test("a failed lookup produces an honest unavailable check, not a healthy one", async () => {
    getCommonHeadersMock.mockReturnValue({});
    getMock.mockRejectedValue(new Error("readiness is down") as never);

    const check: AddedResponderCheck = await fetchResponderCheck({
      userId: USER_ALEX,
      label: "Alex Chen",
    });

    expect(check).toEqual({
      userId: USER_ALEX,
      label: "Alex Chen",
      state: "unavailable",
      readiness: null,
    });
  });

  test("a 200 carrying a body we cannot read is also unavailable", async () => {
    getCommonHeadersMock.mockReturnValue({});
    getMock.mockResolvedValue(okResponse({ nothing: "useful" }) as never);

    const check: AddedResponderCheck = await fetchResponderCheck({
      userId: USER_ALEX,
      label: "Alex Chen",
    });

    expect(check.state).toBe("unavailable");
    expect(check.readiness).toBeNull();
  });
});

describe("Add-responder guard: the reminder it sends", () => {
  test("it posts one user id to the shared reminder endpoint", async () => {
    getCommonHeadersMock.mockReturnValue({ tenantid: "a-project" });
    postMock.mockResolvedValue(
      okResponse({
        sentCount: 1,
        skippedCount: 0,
        failedCount: 0,
        results: [{ userId: USER_ALEX, outcome: "Sent", message: "Emailed." }],
      }) as never,
    );

    const status: SetupReminderStatus = await requestSetupReminder(USER_ALEX);

    const request: any = (postMock as any).mock.calls[0][0];

    expect(request.url.toString()).toContain(
      "/on-call-readiness/send-setup-reminder",
    );
    expect(request.data).toEqual({ userIds: [USER_ALEX] });
    expect(status.state).toBe("sent");
  });

  /*
   * A 200 whose batch skipped everybody is not a send, and this is the exact
   * shape that would otherwise leave an admin believing somebody was told.
   */
  test("a 200 that skipped this user is reported as not sent", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockResolvedValue(
      okResponse({
        sentCount: 0,
        skippedCount: 1,
        failedCount: 0,
        results: [
          {
            userId: USER_ALEX,
            outcome: "SkippedThrottled",
            message: "Already reminded in the last 24 hours.",
          },
        ],
      }) as never,
    );

    expect(await requestSetupReminder(USER_ALEX)).toEqual({
      state: "skipped",
      message: "Already reminded in the last 24 hours.",
    });
  });

  /*
   * A server without the endpoint at all - anything older than this release -
   * fails here, and the reader is told in the server's own words rather than
   * shown a control that appeared to work.
   */
  test("a transport failure carries the server's message through", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockRejectedValue(new Error("Not Found") as never);

    expect(await requestSetupReminder(USER_ALEX)).toEqual({
      state: "failed",
      message: "Not Found",
    });
  });
});
