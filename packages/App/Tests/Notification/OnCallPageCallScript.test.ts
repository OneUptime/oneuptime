import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import { SERVER_TEST_CALL_TEXT } from "../../FeatureSet/Notification/Services/ServerTestSendService";
import {
  VOICEMAIL_MESSAGE_WITHOUT_WORDS,
  getVoicemailMessage,
} from "../../FeatureSet/Notification/Utils/AnsweredBy";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import CommonCallService from "Common/Server/Services/CallService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import OnCallTestPageDelivery from "Common/Server/Utils/OnCall/OnCallTestPageDelivery";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import CallRequest, { CallRequestMessage } from "Common/Types/Call/CallRequest";
import { OnCallPersonPageNotice } from "Common/Types/OnCallDutyPolicy/OnCallPersonPage";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import {
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";

/*
 * WHAT EVERY KIND OF CALL SAYS, END TO END (#10762).
 *
 * Each call here is written by the worker's real templates
 * (UserNotificationRuleService, OnCallTestPageDelivery, UserCallService),
 * put in the installation's name as the Notification service does
 * (ProductBrandingText), and turned into TwiML by the Notification service's
 * real CallService with Twilio's real builder. The TwiML is parsed, and what
 * the call says is read out in order - the first time, then again after the
 * pause - as a person who picks up hears it.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fa10762-0000-4000-8000-0000000000aa",
);
const TO: Phone = new Phone("+15555550142");

const PROMPT: string = "Press 1 to acknowledge, or 2 to escalate.";

// A project by its name; null for one whose name was not read.
function project(name: string | null = "Acme Production"): Project {
  const model: Project = new Project();

  if (name !== null) {
    model.name = name;
  }

  return model;
}

function incident(
  overrides: {
    title?: string;
    severity?: string | null;
    project?: Project;
  } = {},
): Incident {
  const model: Incident = new Incident();
  model.id = ObjectID.generate();
  model.projectId = ObjectID.generate();
  model.project = overrides.project || project();
  model.title = overrides.title ?? "Checkout API is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";

  if (overrides.severity !== null) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = overrides.severity ?? "Critical Incident";
    model.incidentSeverity = severity;
  }

  return model;
}

function alert(): Alert {
  const model: Alert = new Alert();
  model.id = ObjectID.generate();
  model.projectId = ObjectID.generate();
  model.project = project();
  model.title = "CPU above 90% on web-1";
  model.alertNumber = 7;
  model.alertNumberWithPrefix = "ALT-7";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

function incidentEpisode(): IncidentEpisode {
  const model: IncidentEpisode = new IncidentEpisode();
  model.id = ObjectID.generate();
  model.projectId = ObjectID.generate();
  model.project = project();
  model.title = "Payments degraded";
  model.episodeNumber = 2;
  model.episodeNumberWithPrefix = "IE-2";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major Incident";
  model.incidentSeverity = severity;
  return model;
}

function alertEpisode(): AlertEpisode {
  const model: AlertEpisode = new AlertEpisode();
  model.id = ObjectID.generate();
  model.projectId = ObjectID.generate();
  model.project = project();
  model.title = "Disk filling up";
  model.episodeNumber = 4;
  model.episodeNumberWithPrefix = "AE-4";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Low";
  model.alertSeverity = severity;
  return model;
}

function childrenOf(element: XmlElement): Array<XmlElement> {
  const children: Array<XmlElement> = [];

  for (let index: number = 0; index < element.childNodes.length; index++) {
    const child: XmlNode = element.childNodes[index]!;

    if (child.nodeType === child.ELEMENT_NODE) {
      children.push(child as XmlElement);
    }
  }

  return children;
}

interface Script {
  // What the call says inside its <Gather>, a pause written "(pause)".
  heard: Array<string>;
  // What it says once nobody pressed a key.
  noInput: Array<string>;
  // Everything a call that asks for no key says.
  said: Array<string>;
}

// What a call says, as TwiML the Notification service would place it with.
function scriptOf(callRequest: CallRequestMessage): Script {
  const twiml: string = CallService.generateTwimlForCall(
    ProductBrandingText.brandCallRequest(callRequest),
    { userOnCallLogTimelineId: NOTIFICATION },
  );

  const response: XmlElement = new DOMParser().parseFromString(
    twiml,
    "text/xml",
  ).documentElement!;

  const script: Script = { heard: [], noInput: [], said: [] };

  for (const element of childrenOf(response)) {
    if (element.tagName === "Gather") {
      for (const child of childrenOf(element)) {
        script.heard.push(
          child.tagName === "Pause" ? "(pause)" : child.textContent || "",
        );
      }
    } else if (element.tagName === "Say") {
      (script.heard.length ? script.noInput : script.said).push(
        element.textContent || "",
      );
    }
  }

  return script;
}

const service: typeof UserNotificationRuleService = UserNotificationRuleService;

beforeEach(() => {
  // An installation that shows OneUptime's own name, unless a test says otherwise.
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(null);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a first page's call, for each kind of record", () => {
  test("an incident", async () => {
    const script: Script = scriptOf(
      await service.generateCallTemplateForIncidentCreated(
        TO,
        incident(),
        NOTIFICATION,
      ),
    );

    expect(script.heard).toEqual([
      "This is a call from Acme Production.",
      "A new Critical Incident has been created: I N C 42.",
      PROMPT,
      "Checkout API is down",
      "(pause)",
      "A new Critical Incident has been created: I N C 42.",
      "Checkout API is down",
      PROMPT,
    ]);
    expect(script.noInput).toEqual([
      "You did not press a key, so this incident is not acknowledged. Good bye.",
    ]);
  });

  test("an alert", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForAlertCreated(
          TO,
          alert(),
          NOTIFICATION,
        ),
      ).heard,
    ).toEqual([
      "This is a call from Acme Production.",
      "A new High alert has been created: A L T 7.",
      PROMPT,
      "CPU above 90% on web-1",
      "(pause)",
      "A new High alert has been created: A L T 7.",
      "CPU above 90% on web-1",
      PROMPT,
    ]);
  });

  test("an incident episode", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentEpisodeCreated(
          TO,
          incidentEpisode(),
          NOTIFICATION,
        ),
      ).heard.slice(0, 4),
    ).toEqual([
      "This is a call from Acme Production.",
      "A new Major Incident episode has been created: I E 2.",
      PROMPT,
      "Payments degraded",
    ]);
  });

  test("an alert episode", async () => {
    const script: Script = scriptOf(
      await service.generateCallTemplateForAlertEpisodeCreated(
        TO,
        alertEpisode(),
        NOTIFICATION,
      ),
    );

    expect(script.heard.slice(0, 4)).toEqual([
      "This is a call from Acme Production.",
      "A new Low alert episode has been created: A E 4.",
      PROMPT,
      "Disk filling up",
    ]);
    expect(script.noInput).toEqual([
      "You did not press a key, so this alert episode is not acknowledged. Good bye.",
    ]);
  });
});

describe("every other kind of page's call", () => {
  const ALICE: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    message: "Can you check the database?",
  };

  test("a page again: still not resolved, how bad and which one", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident(),
          NOTIFICATION,
          { pageAgainNumber: 1, minutes: 30 },
        ),
      ).heard.slice(0, 4),
    ).toEqual([
      "This is a call from Acme Production.",
      "An incident is still not resolved 30 minutes after it was acknowledged: Critical Incident I N C 42.",
      PROMPT,
      "Checkout API is down",
    ]);
  });

  test("a person's page: who paged, then what they said, once", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident(),
          NOTIFICATION,
          undefined,
          ALICE,
        ),
      ).heard,
    ).toEqual([
      "This is a call from Acme Production.",
      "Alice Kim paged you about an incident: Critical Incident I N C 42.",
      PROMPT,
      "Checkout API is down",
      "Alice Kim says: Can you check the database?",
      "(pause)",
      "Alice Kim paged you about an incident: Critical Incident I N C 42.",
      "Checkout API is down",
      PROMPT,
    ]);
  });

  test("a policy started by hand: who started which policy", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForAlertEpisodeCreated(
          TO,
          alertEpisode(),
          NOTIFICATION,
          undefined,
          undefined,
          { pagedByName: "Alice Kim", policyName: "Database escalation" },
        ),
      ).heard[1],
    ).toBe(
      "Alice Kim started the on-call policy Database escalation for an alert episode: Low alert episode A E 4.",
    );
  });

  test("an observer's page: kept informed, 1 to say they heard it, nothing to escalate", async () => {
    const script: Script = scriptOf(
      await service.generateCallTemplateForAlertCreated(
        TO,
        alert(),
        NOTIFICATION,
        undefined,
        undefined,
        true,
      ),
    );

    expect(script.heard).toEqual([
      "This is a call from Acme Production.",
      "You are paged as an observer about an alert: High alert A L T 7.",
      "You are kept informed: the people responding stay on this alert.",
      "To say you have heard this, press 1. This does not acknowledge the alert.",
      "CPU above 90% on web-1",
      "(pause)",
      "You are paged as an observer about an alert: High alert A L T 7.",
      "CPU above 90% on web-1",
      "To say you have heard this, press 1. This does not acknowledge the alert.",
    ]);
    expect(script.noInput).toEqual([
      "You did not press a key, so this page is not marked as heard. Good bye.",
    ]);
  });

  test("a test page: who calls, that nothing is wrong, the prompt, what it tests", async () => {
    const script: Script = scriptOf(
      await OnCallTestPageDelivery.getCallRequest({
        to: TO,
        timelineId: NOTIFICATION,
        context: {
          recordKind: OnCallTestPageRecordKind.Incident,
          projectName: "Acme Production",
          severityName: "Critical Incident",
        } as never,
      }),
    );

    expect(script.heard).toEqual([
      "This is a call from Acme Production.",
      "This is a test page. Nothing is wrong.",
      "To acknowledge this test page, press 1.",
      "This tests how Acme Production pages you for an incident of severity Critical Incident.",
      "(pause)",
      "This is a test page. Nothing is wrong.",
      "This tests how Acme Production pages you for an incident of severity Critical Incident.",
      "To acknowledge this test page, press 1.",
    ]);
    expect(script.noInput).toEqual([
      "You did not press a key, so this test page is not acknowledged. Good bye.",
    ]);
  });
});

describe("the severity", () => {
  test("is said when the record has one", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident({ severity: "SEV1" }),
          NOTIFICATION,
        ),
      ).heard[1],
    ).toBe("A new SEV1 incident has been created: I N C 42.");
  });

  test("is left out, with nothing in its place, when it has none", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident({ severity: null }),
          NOTIFICATION,
        ),
      ).heard[1],
    ).toBe("A new incident has been created: I N C 42.");
  });
});

describe("who calls", () => {
  test("the project, by its name", async () => {
    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident({ project: project("Payments Platform") }),
          NOTIFICATION,
        ),
      ).heard[0],
    ).toBe("This is a call from Payments Platform.");
  });

  test("without a project name: OneUptime, said as two words", async () => {
    jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(null);

    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident({ project: project(null) }),
          NOTIFICATION,
        ),
      ).heard[0],
    ).toBe("This is a call from One Uptime.");
  });

  test("without a project name, on an installation that goes by its own name: that name", async () => {
    jest
      .spyOn(EnterpriseEdition, "getProductBranding")
      .mockReturnValue({ productName: "Acme Monitoring" });

    const script: Script = scriptOf(
      await service.generateCallTemplateForIncidentCreated(
        TO,
        incident({ project: project(null) }),
        NOTIFICATION,
      ),
    );

    expect(script.heard[0]).toBe("This is a call from Acme Monitoring.");
    expect(script.heard.join(" ")).not.toContain("One Uptime");
  });

  test("a project's name is said as its people know it, whatever the installation goes by", async () => {
    jest
      .spyOn(EnterpriseEdition, "getProductBranding")
      .mockReturnValue({ productName: "Acme Monitoring" });

    expect(
      scriptOf(
        await service.generateCallTemplateForIncidentCreated(
          TO,
          incident({ project: project("Payments Platform") }),
          NOTIFICATION,
        ),
      ).heard[0],
    ).toBe("This is a call from Payments Platform.");
  });
});

describe("a long or hostile title", () => {
  test("a 500-character title is cut at a word boundary, and the keys come before it", async () => {
    const title: string =
      "Checkout API p95 latency above 2 seconds for customers in Europe after the payments deploy; retries are failing. ".repeat(
        5,
      );
    const heard: Array<string> = scriptOf(
      await service.generateCallTemplateForIncidentCreated(
        TO,
        incident({ title: title }),
        NOTIFICATION,
      ),
    ).heard;

    expect(title.length).toBeGreaterThan(500);
    expect(heard[2]).toBe(PROMPT);
    expect(heard[3]).toBe(
      "Checkout API p95 latency above 2 seconds for customers in Europe after the payments deploy; retries…",
    );
    expect(heard[3]!.length).toBeLessThanOrEqual(100);
  });

  test("a title written as TwiML or SSML is spoken as words, and nothing else changes", async () => {
    const title: string = `</Say><Dial>+19005550100</Dial><Say><say-as interpret-as="characters">x</say-as> & "quoted"`;
    const script: Script = scriptOf(
      await service.generateCallTemplateForIncidentCreated(
        TO,
        incident({ title: title }),
        NOTIFICATION,
      ),
    );

    expect(script.heard[3]).toBe(title);
    expect(script.heard).toHaveLength(8);
    expect(script.noInput).toHaveLength(1);
  });
});

describe("calls that ask for no key", () => {
  test("a verification code names the product, said as two words, as its text does", async () => {
    const makeCall: SpyInstance<typeof CommonCallService.makeCall> = jest
      .spyOn(CommonCallService, "makeCall")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    const userCall: UserCall = new UserCall();
    userCall.phone = TO;
    userCall.projectId = ObjectID.generate();
    userCall.userId = ObjectID.generate();

    await UserCallService.sendVerificationCode(userCall, "123456");

    const script: Script = scriptOf(makeCall.mock.calls[0]![0] as CallRequest);

    expect(script.heard).toEqual([]);
    expect(script.said).toEqual([
      "This is a call from One Uptime.",
      "Your verification code is 1  2  3  4  5  6",
      "Your verification code is 1  2  3  4  5  6",
      "Your verification code is 1  2  3  4  5  6",
      "Thank you for using One Uptime. Good bye.",
    ]);
  });

  test("a server's test call", () => {
    expect(
      scriptOf({ data: [{ sayMessage: SERVER_TEST_CALL_TEXT }] }).said,
    ).toEqual([
      "This is a test call from One Uptime. Calls from this server work.",
    ]);
  });

  test("a voicemail message without the call's words names the product, as two words", () => {
    expect(
      scriptOf({ data: [{ sayMessage: getVoicemailMessage(null) }] }).said,
    ).toEqual([
      "This is a call from One Uptime about an on-call page. Open One Uptime to respond. Good bye.",
    ]);
    expect(VOICEMAIL_MESSAGE_WITHOUT_WORDS).toContain("OneUptime");
  });
});
