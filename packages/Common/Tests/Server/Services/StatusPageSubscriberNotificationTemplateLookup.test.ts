import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplateStatusPageService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { FindOperator } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * getTemplateForStatusPage runs as root from every subscriber worker, so the
 * query is the only thing keeping one project's status page to its own
 * branded templates.
 *
 * It used to ask for every template of the event type and channel - across
 * ALL projects - 100 at a time, newest first, and look for the page's linked
 * template in memory. On a shared (SaaS) server with more than 100 such
 * templates, the linked one could fall outside those 100 and the page's
 * subscribers silently got the default template.
 *
 * Both services are backed here by a tiny in-memory table that honours the
 * query, the sort and - crucially - the limit the way Postgres would, so the
 * old query fails the "more than 100 other templates" case below and the
 * fixed one passes it.
 */

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;
const OTHER_EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged;
const METHOD: StatusPageSubscriberNotificationMethod =
  StatusPageSubscriberNotificationMethod.Email;

interface TemplateRow {
  id: ObjectID;
  projectId: ObjectID;
  eventType: StatusPageSubscriberNotificationEventType;
  notificationMethod: StatusPageSubscriberNotificationMethod;
  createdAt: number;
}

interface LinkRow {
  statusPageId: ObjectID;
  statusPageProjectId: ObjectID;
  projectId: ObjectID;
  templateId: ObjectID;
}

interface RecordedFind {
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
}

let templateTable: Array<TemplateRow> = [];
let linkTable: Array<LinkRow> = [];
let templateFinds: Array<RecordedFind> = [];
let linkFinds: Array<RecordedFind> = [];
let clock: number = 0;

function nextCreatedAt(): number {
  clock += 1;
  return clock;
}

function addTemplate(data: {
  projectId: ObjectID;
  eventType?: StatusPageSubscriberNotificationEventType;
  notificationMethod?: StatusPageSubscriberNotificationMethod;
}): ObjectID {
  const id: ObjectID = ObjectID.generate();
  templateTable.push({
    id,
    projectId: data.projectId,
    eventType: data.eventType || EVENT,
    notificationMethod: data.notificationMethod || METHOD,
    createdAt: nextCreatedAt(),
  });
  return id;
}

function link(data: {
  statusPageId: ObjectID;
  statusPageProjectId: ObjectID;
  templateId: ObjectID;
  linkProjectId?: ObjectID;
}): void {
  linkTable.push({
    statusPageId: data.statusPageId,
    statusPageProjectId: data.statusPageProjectId,
    projectId: data.linkProjectId || data.statusPageProjectId,
    templateId: data.templateId,
  });
}

// Other tenants' templates for the same event and channel, all newer.
function addTemplatesFromOtherProjects(count: number): void {
  for (let i: number = 0; i < count; i++) {
    addTemplate({ projectId: ObjectID.generate() });
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  return (value as { toNumber: () => number }).toNumber();
}

/*
 * The value a query column must equal, or the list it must be in. An `_id`
 * filter arrives as QueryHelper.any's Raw operator, whose ids travel as its
 * object-literal parameters.
 */
function matches(expected: unknown, actual: ObjectID | string): boolean {
  if (expected instanceof FindOperator) {
    const parameters: Record<string, unknown> =
      (expected.objectLiteralParameters as Record<string, unknown>) || {};
    const values: Array<string> = Object.values(parameters).flatMap(
      (value: unknown) => {
        return (value as Array<unknown>).map((item: unknown) => {
          return String(item);
        });
      },
    );
    return values.includes(actual.toString());
  }

  return String(expected) === actual.toString();
}

function fakeTemplateFind(args: unknown): Promise<Array<unknown>> {
  const findBy: RecordedFind = args as RecordedFind;
  templateFinds.push(findBy);

  const query: Record<string, unknown> = findBy.query;

  const rows: Array<TemplateRow> = templateTable
    .filter((row: TemplateRow) => {
      return (
        (query["_id"] === undefined || matches(query["_id"], row.id)) &&
        (query["projectId"] === undefined ||
          matches(query["projectId"], row.projectId)) &&
        (query["eventType"] === undefined ||
          query["eventType"] === row.eventType) &&
        (query["notificationMethod"] === undefined ||
          query["notificationMethod"] === row.notificationMethod)
      );
    })
    // DatabaseService's default sort: newest first.
    .sort((a: TemplateRow, b: TemplateRow) => {
      return b.createdAt - a.createdAt;
    })
    .slice(
      toNumber(findBy.skip),
      toNumber(findBy.skip) + toNumber(findBy.limit),
    );

  return Promise.resolve(
    rows.map((row: TemplateRow) => {
      const template: StatusPageSubscriberNotificationTemplate =
        new StatusPageSubscriberNotificationTemplate();
      template._id = row.id.toString();
      template.projectId = row.projectId;
      template.eventType = row.eventType;
      template.notificationMethod = row.notificationMethod;
      template.templateName = `template ${row.id.toString()}`;
      template.templateBody = `<p>${row.id.toString()}</p>`;
      return template;
    }),
  );
}

function fakeLinkFind(args: unknown): Promise<Array<unknown>> {
  const findBy: RecordedFind = args as RecordedFind;
  linkFinds.push(findBy);

  const rows: Array<LinkRow> = linkTable
    .filter((row: LinkRow) => {
      return matches(findBy.query["statusPageId"], row.statusPageId);
    })
    .slice(
      toNumber(findBy.skip),
      toNumber(findBy.skip) + toNumber(findBy.limit),
    );

  return Promise.resolve(
    rows.map((row: LinkRow) => {
      const linkModel: StatusPageSubscriberNotificationTemplateStatusPage =
        new StatusPageSubscriberNotificationTemplateStatusPage();
      linkModel.statusPageId = row.statusPageId;
      linkModel.projectId = row.projectId;
      linkModel.statusPageSubscriberNotificationTemplateId = row.templateId;
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = row.statusPageId.toString();
      statusPage.projectId = row.statusPageProjectId;
      linkModel.statusPage = statusPage;
      return linkModel;
    }),
  );
}

function lookUp(
  statusPageId: ObjectID,
  overrides: {
    eventType?: StatusPageSubscriberNotificationEventType;
    notificationMethod?: StatusPageSubscriberNotificationMethod;
  } = {},
): Promise<StatusPageSubscriberNotificationTemplate | null> {
  return StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
    {
      statusPageId,
      eventType: overrides.eventType || EVENT,
      notificationMethod: overrides.notificationMethod || METHOD,
    },
  );
}

describe("StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage", () => {
  const projectId: ObjectID = ObjectID.generate();
  const statusPageId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    templateTable = [];
    linkTable = [];
    templateFinds = [];
    linkFinds = [];
    clock = 0;

    jest
      .spyOn(StatusPageSubscriberNotificationTemplateService, "findBy")
      .mockImplementation(fakeTemplateFind as never);
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateStatusPageService,
        "findBy",
      )
      .mockImplementation(fakeLinkFind as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("still finds the linked template when more than 100 newer templates from other projects exist", async () => {
    const linkedTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: linkedTemplateId,
    });
    addTemplatesFromOtherProjects(150);

    const template: StatusPageSubscriberNotificationTemplate | null =
      await lookUp(statusPageId);

    expect(template?.id?.toString()).toBe(linkedTemplateId.toString());
  });

  test("harness guard: an unfiltered query for this event and channel would not have reached the linked template", async () => {
    /*
     * The query the service used to send: every project's templates for the
     * event and channel, one page of 100. If the fake table did not truncate
     * like Postgres does, the test above would prove nothing.
     */
    const linkedTemplateId: ObjectID = addTemplate({ projectId });
    addTemplatesFromOtherProjects(150);

    const page: Array<unknown> = await fakeTemplateFind({
      query: { eventType: EVENT, notificationMethod: METHOD },
      select: {},
      skip: 0,
      limit: 100,
    });

    expect(page).toHaveLength(100);
    expect(
      page.map((row: unknown) => {
        return (row as StatusPageSubscriberNotificationTemplate).id?.toString();
      }),
    ).not.toContain(linkedTemplateId.toString());
  });

  test("asks only for the linked ids, in the status page's project, for this event and channel", async () => {
    const linkedTemplateId: ObjectID = addTemplate({ projectId });
    const otherLinkedTemplateId: ObjectID = addTemplate({
      projectId,
      eventType: OTHER_EVENT,
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: linkedTemplateId,
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: otherLinkedTemplateId,
    });

    await lookUp(statusPageId);

    expect(templateFinds).toHaveLength(1);
    const query: Record<string, unknown> = templateFinds[0]!.query;

    expect(query["_id"]).toBeInstanceOf(FindOperator);
    const ids: Array<string> = Object.values(
      (query["_id"] as FindOperator<unknown>).objectLiteralParameters || {},
    ).flatMap((value: unknown) => {
      return (value as Array<unknown>).map((item: unknown) => {
        return String(item);
      });
    });
    expect(ids.sort()).toEqual(
      [linkedTemplateId.toString(), otherLinkedTemplateId.toString()].sort(),
    );
    expect(String(query["projectId"])).toBe(projectId.toString());
    expect(query["eventType"]).toBe(EVENT);
    expect(query["notificationMethod"]).toBe(METHOD);
    expect(templateFinds[0]!.select).toEqual(
      expect.objectContaining({
        templateBody: true,
        emailSubject: true,
      }),
    );
  });

  test("runs every lookup as root, because workers call it", async () => {
    const linkedTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: linkedTemplateId,
    });

    await lookUp(statusPageId);

    for (const find of [...linkFinds, ...templateFinds]) {
      expect((find as unknown as { props: { isRoot: boolean } }).props).toEqual(
        { isRoot: true },
      );
    }
  });

  test("reads every link of the page, not just the first 100", async () => {
    // 150 links to templates for another channel, then the one that matches.
    for (let i: number = 0; i < 150; i++) {
      link({
        statusPageId,
        statusPageProjectId: projectId,
        templateId: addTemplate({
          projectId,
          notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
        }),
      });
    }
    const emailTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: emailTemplateId,
    });

    const template: StatusPageSubscriberNotificationTemplate | null =
      await lookUp(statusPageId);

    expect(template?.id?.toString()).toBe(emailTemplateId.toString());
    expect(toNumber(linkFinds[0]!.limit)).toBeGreaterThan(151);
  });

  test("returns null without querying templates when the page links none", async () => {
    addTemplate({ projectId });

    expect(await lookUp(statusPageId)).toBeNull();
    expect(templateFinds).toHaveLength(0);
  });

  test("returns null when no linked template is for this event type", async () => {
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: addTemplate({ projectId, eventType: OTHER_EVENT }),
    });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("returns null when no linked template is for this channel", async () => {
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: addTemplate({
        projectId,
        notificationMethod: StatusPageSubscriberNotificationMethod.Slack,
      }),
    });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("never uses another project's template, even when the page's link points at it", async () => {
    const otherProjectTemplateId: ObjectID = addTemplate({
      projectId: ObjectID.generate(),
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: otherProjectTemplateId,
    });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("ignores a link row stamped with another project", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const otherProjectTemplateId: ObjectID = addTemplate({
      projectId: otherProjectId,
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      linkProjectId: otherProjectId,
      templateId: otherProjectTemplateId,
    });

    expect(await lookUp(statusPageId)).toBeNull();
    expect(templateFinds).toHaveLength(0);
  });

  test("keeps the page's own link when a foreign link row sits beside it", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const ownTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: ownTemplateId,
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      linkProjectId: otherProjectId,
      templateId: addTemplate({ projectId: otherProjectId }),
    });

    expect((await lookUp(statusPageId))?.id?.toString()).toBe(
      ownTemplateId.toString(),
    );
  });

  test("picks the newest linked template when two match the same event and channel", async () => {
    const olderTemplateId: ObjectID = addTemplate({ projectId });
    const newerTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: olderTemplateId,
    });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: newerTemplateId,
    });

    expect((await lookUp(statusPageId))?.id?.toString()).toBe(
      newerTemplateId.toString(),
    );
  });

  test("does not see templates linked to a different status page", async () => {
    const otherStatusPageId: ObjectID = ObjectID.generate();
    link({
      statusPageId: otherStatusPageId,
      statusPageProjectId: projectId,
      templateId: addTemplate({ projectId }),
    });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("returns the template's body and subject for the job to compile", async () => {
    const linkedTemplateId: ObjectID = addTemplate({ projectId });
    link({
      statusPageId,
      statusPageProjectId: projectId,
      templateId: linkedTemplateId,
    });

    const template: StatusPageSubscriberNotificationTemplate | null =
      await lookUp(statusPageId);

    expect(template?.templateBody).toBe(
      `<p>${linkedTemplateId.toString()}</p>`,
    );
  });
});
