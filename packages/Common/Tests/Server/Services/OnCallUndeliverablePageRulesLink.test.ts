import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import { OnCallNotificationAlertingService } from "../../../Server/Services/OnCallNotificationAlertingService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "You were paged without a notification rule" / "a page could not reach you":
 * the mail to the responder ends with a link to where the missing rule is
 * added. A person's on-call rules are one On-Call Rules page with a tab per
 * kind now, so the link opens that page on the tab of the rule type they were
 * paged for (`?type=alerts`). Sent to the old per-kind pages it would still
 * arrive (they forward), but only by a hop - and a link to the wrong tab
 * lands on a screen with nothing wrong on it, which reads as a false alarm.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESPONDER: ObjectID = new ObjectID("user-responder");
const DASHBOARD: string = "https://oneuptime.test/dashboard";

const RESPONDER_EMAIL: string = "responder@acme.test";

interface LinkCase {
  ruleType: NotificationRuleType;
  link: string;
}

/*
 * Spelled out rather than built from OnCallRuleKind, so a renamed tab fails
 * here: these addresses are in mail already sent.
 */
const LINK_CASES: Array<LinkCase> = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=incidents`,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=incident-episodes`,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=alerts`,
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=alert-episodes`,
  },
  /*
   * The shift rule types have no tab of their own: the page's first tab, as
   * its bare address opens.
   */
  {
    ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=incidents`,
  },
  {
    ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    link: `${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=incidents`,
  },
];

const RETIRED_RULE_PAGE_PATHS: Array<string> = [
  "incident-on-call-rules",
  "incident-episode-on-call-rules",
  "alert-on-call-rules",
  "alert-episode-on-call-rules",
];

function makeUser(userId: ObjectID, email: string): User {
  const user: User = new User(userId);
  user.name = userId.toString() as any;
  user.email = new Email(email);
  return user;
}

describe("OnCallNotificationAlertingService - the responder's mail links the right On-Call Rules tab", () => {
  let service: OnCallNotificationAlertingService;
  let sendMailSpy: any;

  // The message of the one mail sent to the responder.
  function responderMessage(): string {
    const calls: Array<any> = sendMailSpy.mock.calls.filter(
      (call: any): boolean => {
        return call[0].toEmail.toString() === RESPONDER_EMAIL;
      },
    );

    expect(calls).toHaveLength(1);

    return calls[0][0].vars.message as string;
  }

  async function reportUndeliverablePage(data: {
    ruleType: NotificationRuleType;
    fallbackChannelsUsed?: Array<string>;
  }): Promise<void> {
    await service.notifyOfUndeliverablePage({
      projectId: PROJECT_ID,
      userId: RESPONDER,
      ruleType: data.ruleType,
      severityName: "Sev1",
      onCallDutyPolicyId: new ObjectID("policy-1"),
      fallbackChannelsUsed: data.fallbackChannelsUsed || [],
    });
  }

  beforeEach(() => {
    // A fresh instance, so no test inherits another's in-process throttle.
    service = new OnCallNotificationAlertingService();

    const project: Project = new Project(PROJECT_ID);
    project.name = "Acme";
    project.onCallFallbackUsedNotificationSentToOwners = false;

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser(RESPONDER, RESPONDER_EMAIL));

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
      .mockResolvedValue("Primary");
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/policy"));
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD));

    // No policy owners: the owner mail goes to the project owners instead.
    jest
      .spyOn(OnCallDutyPolicyOwnerUserService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(ProjectService, "getOwners").mockResolvedValue([]);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined);

    sendMailSpy = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  for (const linkCase of LINK_CASES) {
    test(`a page of type "${linkCase.ruleType}" links ${linkCase.link.split("/").pop()}`, async () => {
      await reportUndeliverablePage({ ruleType: linkCase.ruleType });

      const message: string = responderMessage();

      expect(message).toContain(`href="${linkCase.link}"`);

      for (const retiredPath of RETIRED_RULE_PAGE_PATHS) {
        expect(message).not.toContain(`/user-settings/${retiredPath}`);
      }
    });
  }

  test("the mail sent when the fallback did reach them links the same tab", async () => {
    await reportUndeliverablePage({
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      fallbackChannelsUsed: ["Email", "Push"],
    });

    const message: string = responderMessage();

    expect(message).toContain("no notification rule configured for it");
    expect(message).toContain(
      `href="${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/on-call-rules?type=alert-episodes"`,
    );
  });

  test("a rule type this build has never heard of links Notification Methods", async () => {
    await reportUndeliverablePage({
      ruleType: "Some future rule type" as NotificationRuleType,
    });

    const message: string = responderMessage();

    expect(message).toContain(
      `href="${DASHBOARD}/${PROJECT_ID.toString()}/user-settings/notification-methods"`,
    );
    expect(message).not.toContain("on-call-rules");
  });
});
