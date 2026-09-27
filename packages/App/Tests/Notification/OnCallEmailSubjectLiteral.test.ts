import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";

/*
 * The on-call page email ("ACTION REQUIRED: Incident #12 created - <title>")
 * is built by UserNotificationRuleService and handed to MailService.sendMail
 * unchanged. Its subject carries the resource's title, which users type. The
 * mailer used to compile every subject through Handlebars against the email's
 * variables, so a title with a lone "{{" failed to parse and the responder was
 * never paged by email, and one quoting "{{ .Values.image.tag }}" lost those
 * words.
 *
 * These tests call the real builders and check the message they return: the
 * subject is marked literal and keeps the title exactly as written. The
 * database-backed lookups the builders make for links and episode members are
 * stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");
const LOG_TIMELINE_ID: ObjectID = new ObjectID("timeline-1");
const RESPONDER: Email = new Email("responder@acme.test");
const TITLE: string = "Rollout of {{ .Values.image.tag }} stalled";

function project(): Project {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
}

function incidentState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  return state;
}

function incidentSeverity(): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  return severity;
}

function alertState(): AlertState {
  const state: AlertState = new AlertState();
  state.name = "Firing";
  return state;
}

function alertSeverity(): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  return severity;
}

function incident(): Incident {
  const model: Incident = new Incident(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.incidentNumber = 12;
  model.currentIncidentState = incidentState();
  model.incidentSeverity = incidentSeverity();
  return model;
}

function alert(): Alert {
  const model: Alert = new Alert(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.alertNumber = 12;
  model.currentAlertState = alertState();
  model.alertSeverity = alertSeverity();
  return model;
}

function incidentEpisode(): IncidentEpisode {
  const model: IncidentEpisode = new IncidentEpisode(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.episodeNumber = 12;
  model.currentIncidentState = incidentState();
  model.incidentSeverity = incidentSeverity();
  return model;
}

function alertEpisode(): AlertEpisode {
  const model: AlertEpisode = new AlertEpisode(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.episodeNumber = 12;
  model.currentAlertState = alertState();
  model.alertSeverity = alertSeverity();
  return model;
}

interface PageEmailCase {
  name: string;
  build: () => Promise<EmailMessage>;
  subject: string;
}

const PAGE_EMAIL_CASES: Array<PageEmailCase> = [
  {
    name: "incident",
    build: (): Promise<EmailMessage> => {
      return UserNotificationRuleService.generateEmailTemplateForIncidentCreated(
        RESPONDER,
        incident(),
        LOG_TIMELINE_ID,
      );
    },
    subject: `ACTION REQUIRED: Incident #12 created - ${TITLE}`,
  },
  {
    name: "alert",
    build: (): Promise<EmailMessage> => {
      return UserNotificationRuleService.generateEmailTemplateForAlertCreated(
        RESPONDER,
        alert(),
        LOG_TIMELINE_ID,
      );
    },
    subject: `ACTION REQUIRED: Alert #12 created - ${TITLE}`,
  },
  {
    name: "incident episode",
    build: (): Promise<EmailMessage> => {
      return UserNotificationRuleService.generateEmailTemplateForIncidentEpisodeCreated(
        RESPONDER,
        incidentEpisode(),
        LOG_TIMELINE_ID,
      );
    },
    subject: `ACTION REQUIRED: Incident Episode #12 created - ${TITLE}`,
  },
  {
    name: "alert episode",
    build: (): Promise<EmailMessage> => {
      return UserNotificationRuleService.generateEmailTemplateForAlertEpisodeCreated(
        RESPONDER,
        alertEpisode(),
        LOG_TIMELINE_ID,
      );
    },
    subject: `ACTION REQUIRED: Alert Episode #12 created - ${TITLE}`,
  },
];

beforeEach(() => {
  const link: URL = URL.fromString("https://oneuptime.test/dashboard/r1");

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(link);
  jest.spyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(link);
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  // An episode with no members yet, so no member resources are looked up.
  jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue([]);
  jest.spyOn(AlertEpisodeMemberService, "findBy").mockResolvedValue([]);
  // Nothing linked: the Resources Affected row is covered in OnCallEmailResourcesAffected.
  jest.spyOn(IncidentService, "findAllBy").mockResolvedValue([]);
  jest.spyOn(AlertService, "findAllBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the on-call page email for a resource whose title quotes template syntax", () => {
  test.each(PAGE_EMAIL_CASES)(
    "for an $name marks the subject literal and keeps the title as written",
    async ({ build, subject }: PageEmailCase) => {
      const message: EmailMessage = await build();

      expect(message.isSubjectLiteral).toBe(true);
      expect(message.subject).toBe(subject);
      expect(message.toEmail.toString()).toBe(RESPONDER.toString());
    },
  );
});
