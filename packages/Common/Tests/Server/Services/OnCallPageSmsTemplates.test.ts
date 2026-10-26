/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import { ProductBranding } from "../../../Types/Branding/ProductBranding";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageAgainNotice } from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import Phone from "../../../Types/Phone";
import SMS from "../../../Types/SMS/SMS";
import {
  countSmsSegments,
  SmsEncoding,
  SmsSegmentCount,
} from "../../../Utils/Sms/SmsSegments";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE TEXT A PAGE SENDS, AS THE SERVICE BUILDS IT.
 *
 * generateSmsTemplateFor{Incident,Alert,IncidentEpisode,AlertEpisode}Created
 * write a page's SMS from the record the delivery loaded - its severity,
 * number, project and title - and the short link of its acknowledge page,
 * fitted to one 160-character part (Utils/Sms/OnCallPageSms). Before, the
 * same page said "This is a message from OneUptime. A new incident has been
 * created: ..." in 225 characters or more: two parts at least, on every
 * page, for every person paged.
 *
 * Read here through the real service, with the short link stood in for
 * (eight letters, as ShortLinkService makes them) and the host pinned.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "5114a000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("5114a000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("5114a000-0000-4000-8000-000000000003");
const TO_PHONE: Phone = new Phone("+15555550101");

const CLOUD_HOST: string = "oneuptime.com";
const SELF_HOSTED_HOST: string = "status-oneuptime.example.com";
const SHORT_ID: string = "XJlaZRsd";

// Every URL a short link was made for, in order.
let shortened: Array<string>;
let host: string;

const pin: (hostname: string) => void = (hostname: string): void => {
  host = hostname;
};

beforeEach(() => {
  shortened = [];
  host = CLOUD_HOST;

  jest.spyOn(DatabaseConfig, "getHost").mockImplementation((async () => {
    return new Hostname(host);
  }) as never);
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(ShortLinkService, "saveShortLinkFor").mockImplementation((async (
    url: URL,
  ) => {
    shortened.push(url.toString());
    return { shortId: SHORT_ID };
  }) as never);
  jest
    .spyOn(EnterpriseEdition, "getProductBranding")
    .mockReturnValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function project(name: string = "Acme Prod"): Project {
  const model: Project = new Project();
  model.name = name;
  return model;
}

function incident(title: string = "Checkout API is down"): Incident {
  const model: Incident = new Incident();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = title;
  model.incidentNumber = 21033;
  model.incidentNumberWithPrefix = "INC-21033";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

function alert(title: string = "Checkout API is down"): Alert {
  const model: Alert = new Alert();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = title;
  model.alertNumber = 512;
  model.alertNumberWithPrefix = "ALT-512";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

function incidentEpisode(
  title: string = "Checkout API is down",
): IncidentEpisode {
  const model: IncidentEpisode = new IncidentEpisode();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = title;
  model.episodeNumber = 7;
  model.episodeNumberWithPrefix = "IE-7";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

function alertEpisode(title: string = "Checkout API is down"): AlertEpisode {
  const model: AlertEpisode = new AlertEpisode();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = title;
  model.episodeNumber = 3;
  model.episodeNumberWithPrefix = "AE-3";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

interface Kind {
  name: string;
  what: string;
  number: string;
  sms: (
    title?: string | undefined,
    pageAgain?: OnCallPageAgainNotice | undefined,
  ) => Promise<SMS>;
}

// The second page again of a policy whose timeout is 30 minutes.
const PAGE_AGAIN: OnCallPageAgainNotice = { pageAgainNumber: 2, minutes: 30 };

const service: typeof UserNotificationRuleService = UserNotificationRuleService;

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    what: "Critical Incident",
    number: "INC-21033",
    sms: (
      title?: string | undefined,
      pageAgain?: OnCallPageAgainNotice | undefined,
    ) => {
      return service.generateSmsTemplateForIncidentCreated(
        TO_PHONE,
        incident(title),
        NOTIFICATION,
        pageAgain,
      );
    },
  },
  {
    name: "an alert",
    what: "High alert",
    number: "ALT-512",
    sms: (
      title?: string | undefined,
      pageAgain?: OnCallPageAgainNotice | undefined,
    ) => {
      return service.generateSmsTemplateForAlertCreated(
        TO_PHONE,
        alert(title),
        NOTIFICATION,
        pageAgain,
      );
    },
  },
  {
    name: "an incident episode",
    what: "Critical Incident episode",
    number: "IE-7",
    sms: (
      title?: string | undefined,
      pageAgain?: OnCallPageAgainNotice | undefined,
    ) => {
      return service.generateSmsTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(title),
        NOTIFICATION,
        pageAgain,
      );
    },
  },
  {
    name: "an alert episode",
    what: "High alert episode",
    number: "AE-3",
    sms: (
      title?: string | undefined,
      pageAgain?: OnCallPageAgainNotice | undefined,
    ) => {
      return service.generateSmsTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(title),
        NOTIFICATION,
        pageAgain,
      );
    },
  },
];

const ACKNOWLEDGE_PAGE: string = `/api/user-notification-log-timeline/acknowledge-page/${NOTIFICATION.toString()}`;

describe.each(KINDS)("the SMS a page about $name sends", (kind: Kind) => {
  test("says who sends it, what happened, its number, the project, the title and the link, in one part", async () => {
    const sms: SMS = await kind.sms();

    expect(sms.to.toString()).toBe(TO_PHONE.toString());
    expect(sms.message).toBe(
      `OneUptime: ${kind.what} ${kind.number} in Acme Prod: Checkout API is down. Ack or escalate: https://${CLOUD_HOST}/l/${SHORT_ID}`,
    );
    expect(countSmsSegments(sms.message).segments).toBe(1);
  });

  test("its link is the short link of the page's own acknowledge page, which carries the page's token", async () => {
    await kind.sms();

    expect(shortened.length).toBe(1);

    const url: globalThis.URL = new globalThis.URL(shortened[0]!);
    const token: string | null = url.searchParams.get(
      ON_CALL_PAGE_LINK_TOKEN_PARAM,
    );

    expect(url.pathname).toBe(ACKNOWLEDGE_PAGE);
    expect(token).toBeTruthy();
    expect(
      OnCallPageLinkToken.isValid({
        token: token,
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(true);
  });

  test("no longer opens with the old 'This is a message from OneUptime.'", async () => {
    const sms: SMS = await kind.sms();

    expect(sms.message).not.toContain("This is a message from");
    expect(sms.message).not.toContain("please click on the following link");
  });

  test("on a long self-hosted address a long title is cut, the project first, so it stays one part", async () => {
    pin(SELF_HOSTED_HOST);

    const sms: SMS = await kind.sms(
      "Database replication lag on db-primary-01 is above 30 seconds and still growing in eu-west-1",
    );
    const counted: SmsSegmentCount = countSmsSegments(sms.message);

    expect(counted.encoding).toBe(SmsEncoding.Gsm7);
    expect(counted.segments).toBe(1);
    expect(
      sms.message.startsWith(
        `OneUptime: ${kind.what} ${kind.number}: Database replication lag`,
      ),
    ).toBe(true);
    expect(sms.message).not.toContain("Acme Prod");
    expect(
      sms.message.endsWith(
        `... Ack or escalate: https://${SELF_HOSTED_HOST}/l/${SHORT_ID}`,
      ),
    ).toBe(true);
  });

  test("a curly-quoted title stays one GSM-7 part", async () => {
    const sms: SMS = await kind.sms(
      "\u{201C}Checkout\u{201D} \u{2013} payments failing\u{2026}",
    );

    expect(sms.message).toContain(': "Checkout" - payments failing...');
    expect(countSmsSegments(sms.message)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: sms.message.length,
      segments: 1,
    });
  });

  test("on an installation that goes by another name, it is still one part as sent", async () => {
    const branding: ProductBranding = {
      productName: "Acme Corporation Monitoring",
    };
    jest
      .spyOn(EnterpriseEdition, "getProductBranding")
      .mockReturnValue(branding as never);

    const sms: SMS = await kind.sms(
      "Database replication lag on db-primary-01 is above 30 seconds and still growing",
    );
    const sent: string = ProductBrandingText.brandText(sms.message);

    // Written with OneUptime: the Notification service renames it, once.
    expect(sms.message.startsWith("OneUptime: ")).toBe(true);
    expect(sent.startsWith("Acme Corporation Monitoring: ")).toBe(true);
    expect(countSmsSegments(sent).segments).toBe(1);
  });

  /*
   * A page again (OnCallAcknowledgementTimeout) says the record is still not
   * resolved, where its first page went straight on to the title (#5173).
   */
  test("a page again says it is still not resolved, after the project, in one part", async () => {
    const sms: SMS = await kind.sms(undefined, PAGE_AGAIN);

    expect(sms.message).toBe(
      `OneUptime: ${kind.what} ${kind.number} in Acme Prod is still not resolved: Checkout API is down. Ack or escalate: https://${CLOUD_HOST}/l/${SHORT_ID}`,
    );
    expect(countSmsSegments(sms.message)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: sms.message.length,
      segments: 1,
    });
  });

  test("a page again's link is its own page's short link too", async () => {
    await kind.sms(undefined, PAGE_AGAIN);

    expect(shortened.length).toBe(1);
    expect(new globalThis.URL(shortened[0]!).pathname).toBe(ACKNOWLEDGE_PAGE);
  });

  test("a page again on a self-hosted address cuts the title, the project first, and keeps its words", async () => {
    pin(SELF_HOSTED_HOST);

    const sms: SMS = await kind.sms(
      "Database replication lag on db-primary-01 is above 30 seconds and still growing in eu-west-1",
      PAGE_AGAIN,
    );

    expect(countSmsSegments(sms.message).segments).toBe(1);
    expect(
      sms.message.startsWith(
        `OneUptime: ${kind.what} ${kind.number} is still not resolved: Database replication`,
      ),
    ).toBe(true);
    expect(sms.message).not.toContain("Acme Prod");
    expect(
      sms.message.endsWith(
        `... Ack or escalate: https://${SELF_HOSTED_HOST}/l/${SHORT_ID}`,
      ),
    ).toBe(true);
  });

  test("a first page never says it", async () => {
    expect((await kind.sms()).message).not.toContain("still not resolved");
    expect((await kind.sms(undefined, undefined)).message).not.toContain(
      "still not resolved",
    );
  });
});

describe("a record without a number prefix", () => {
  test("is numbered with #", async () => {
    const model: Alert = new Alert();
    model.id = RECORD;
    model.projectId = PROJECT;
    model.project = project();
    model.title = "Checkout API is down";
    model.alertNumber = 512;
    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "High";
    model.alertSeverity = severity;

    const sms: SMS = await service.generateSmsTemplateForAlertCreated(
      TO_PHONE,
      model,
      NOTIFICATION,
    );

    expect(sms.message).toBe(
      `OneUptime: High alert #512 in Acme Prod: Checkout API is down. Ack or escalate: https://${CLOUD_HOST}/l/${SHORT_ID}`,
    );
  });

  test("and one without a number, severity or project leaves them out", async () => {
    const model: IncidentEpisode = new IncidentEpisode();
    model.id = RECORD;
    model.projectId = PROJECT;
    model.title = "Checkout API is down";

    const sms: SMS = await service.generateSmsTemplateForIncidentEpisodeCreated(
      TO_PHONE,
      model,
      NOTIFICATION,
    );

    expect(sms.message).toBe(
      `OneUptime: Incident episode: Checkout API is down. Ack or escalate: https://${CLOUD_HOST}/l/${SHORT_ID}`,
    );
  });
});
