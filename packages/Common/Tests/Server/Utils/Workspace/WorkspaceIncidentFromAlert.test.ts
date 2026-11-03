import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import IncidentAlertService from "../../../../Server/Services/IncidentAlertService";
import { OnCallPageRecordType } from "../../../../Server/Services/OnCallPageService";
import { LinkedAffectedResource } from "../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceActionAnswers, {
  WorkspaceRecordName,
} from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceAffectedResources from "../../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import WorkspaceIncidentFromAlert, {
  WORKSPACE_DECLARED_FROM_FIELD,
  WorkspaceAlertNotLinked,
  WorkspaceAlertToLink,
  WorkspaceDeclaringAlert,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentFromAlert";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
  WorkspaceEventStanding,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePageAbout from "../../../../Server/Utils/Workspace/WorkspacePageAbout";
import { AiAffectedResourceKind } from "../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../../Types/ObjectID";

/*
 * AN INCIDENT DECLARED IN AN ALERT'S OWN CHANNEL IS DECLARED FROM THAT
 * ALERT (#5409's follow-up).
 *
 * `/oneuptime incident` in Slack, or "incident" typed to the Microsoft
 * Teams bot, in the channel OneUptime made for an alert declared an
 * incident linked to nothing - not to the alert the channel is about. The
 * shared half both chats read (WorkspaceIncidentFromAlert):
 *
 *   - only the channel a notification rule made for the alert, and only
 *     while the alert is open, as for a page from it (WorkspacePageAbout);
 *     read as the member, so an alert they may not read is not theirs to
 *     declare from;
 *   - the form says so, and starts from the alert's title and the
 *     resources it is linked to that the member may view - never its
 *     monitor;
 *   - the submission names the alert, which is read again as whoever
 *     submits it, and linked only when they may link it, the way the
 *     Dashboard declares an incident from an alert
 *     (INCIDENT_ALERT_IDS_TO_LINK_KEY); otherwise the incident is declared
 *     without it, and why is said.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f1a10000-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("f1a10000-0000-4000-8000-0000000000a1");
const INCIDENT_ID: ObjectID = new ObjectID(
  "f1a10000-0000-4000-8000-0000000000b1",
);
const HOST_ID: string = "f1a10000-0000-4000-8000-0000000000c1";
const CHANNEL_ID: string = "C0ALERT3";
const ALERT_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("f1a10000-0000-4000-8000-0000000000d1"),
  tenantId: PROJECT_ID,
};

const ALERT_NAME: WorkspaceRecordName = {
  label: "Alert ALT-3",
  link: ALERT_LINK,
};

const API_HOST: LinkedAffectedResource = {
  kind: AiAffectedResourceKind.Host,
  id: HOST_ID,
  name: "api-1",
};

type FindChannelRecord = typeof WorkspacePageAbout.findChannelRecord;
type ReadEventForMember = typeof WorkspaceMemberActions.readEventForMember;
type GetStanding = typeof WorkspaceMemberActions.getStanding;
type ReadAlertResources = typeof WorkspaceAffectedResources.readAlertResources;
type ValidateAlertIds =
  typeof IncidentAlertService.validateAlertIdsForNewIncident;

let channelOwner: { type: OnCallPageRecordType; id: ObjectID } | null;
let alertRead: Alert | Error;
let isResolved: boolean;
let findChannelRecordSpy: SpyInstance<FindChannelRecord>;
let readEventSpy: SpyInstance<ReadEventForMember>;
let readAlertResourcesSpy: SpyInstance<ReadAlertResources>;
let validateSpy: SpyInstance<ValidateAlertIds>;

function alertOf(data: { title?: string; isPrivate?: boolean }): Alert {
  const alert: Alert = new Alert();
  alert.id = ALERT_ID;
  alert.title = data.title ?? "Disk almost full";
  alert.isPrivate = data.isPrivate ?? false;
  return alert;
}

function eventRecordOf(event: WorkspaceEvent): WorkspaceEventRecord {
  return {
    type: event.type,
    id: event.id,
    projectId: PROJECT_ID,
    currentStateId: undefined,
    number: 3,
    numberWithPrefix: "ALT-3",
  };
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  channelOwner = { type: OnCallPageRecordType.Alert, id: ALERT_ID };
  alertRead = alertOf({});
  isResolved = false;

  findChannelRecordSpy = jest
    .spyOn(WorkspacePageAbout, "findChannelRecord")
    .mockImplementation(async () => {
      return channelOwner;
    });
  readEventSpy = jest
    .spyOn(WorkspaceMemberActions, "readEventForMember")
    .mockImplementation((async (data: {
      event: WorkspaceEvent;
      props: DatabaseCommonInteractionProps;
    }) => {
      if (alertRead instanceof Error) {
        throw alertRead;
      }

      return { record: alertRead, event: eventRecordOf(data.event) };
    }) as never) as unknown as SpyInstance<ReadEventForMember>;
  jest
    .spyOn(WorkspaceMemberActions, "getStanding")
    .mockImplementation((async (): Promise<WorkspaceEventStanding> => {
      return {
        isAcknowledged: isResolved,
        isResolved: isResolved,
        hasStarted: false,
        isComplete: false,
      };
    }) as GetStanding);
  jest
    .spyOn(WorkspaceActionAnswers, "getRecordName")
    .mockResolvedValue(ALERT_NAME);
  readAlertResourcesSpy = jest
    .spyOn(WorkspaceAffectedResources, "readAlertResources")
    .mockResolvedValue([API_HOST]);
  validateSpy = jest
    .spyOn(IncidentAlertService, "validateAlertIdsForNewIncident")
    .mockImplementation((async (data: { alertIds: Array<string> }) => {
      return data.alertIds.map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readChannelAlert(
  channelId: string | undefined = CHANNEL_ID,
): Promise<WorkspaceDeclaringAlert | null> {
  return await WorkspaceIncidentFromAlert.readChannelAlert({
    projectId: PROJECT_ID,
    channelId: channelId,
    props: PROPS,
  });
}

describe("the alert a form is declared from: the open alert of its own channel, as the member reads it", () => {
  test("an open alert's own channel: the alert, its name, title and privacy, and the resources the member may view", async () => {
    await expect(readChannelAlert()).resolves.toEqual({
      alertId: ALERT_ID,
      name: ALERT_NAME,
      title: "Disk almost full",
      isPrivate: false,
      resources: [API_HOST],
    });

    // Which channel is the alert's own: the pages' one rule, in the project.
    expect(findChannelRecordSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      channelId: CHANNEL_ID,
    });

    // The alert, as the member reads it.
    const read: {
      event: WorkspaceEvent;
      props: DatabaseCommonInteractionProps;
      select: Record<string, unknown>;
    } = readEventSpy.mock.calls[0]![0] as never;
    expect(read.event).toEqual({
      type: WorkspaceEventType.Alert,
      id: ALERT_ID,
    });
    expect(read.props).toBe(PROPS);
    expect(read.select).toEqual({ title: true, isPrivate: true });

    // Its resources, as the member may view them.
    expect(readAlertResourcesSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      props: PROPS,
    });
  });

  test("a private alert's form says the incident will be private", async () => {
    alertRead = alertOf({ isPrivate: true });

    await expect(readChannelAlert()).resolves.toEqual(
      expect.objectContaining({ isPrivate: true }),
    );
  });

  test("no channel - a direct message, the app's Home - is no alert's, and nothing is read", async () => {
    await expect(
      WorkspaceIncidentFromAlert.readChannelAlert({
        projectId: PROJECT_ID,
        channelId: undefined,
        props: PROPS,
      }),
    ).resolves.toBeNull();
    await expect(readChannelAlert("  ")).resolves.toBeNull();

    expect(findChannelRecordSpy).not.toHaveBeenCalled();
  });

  test("a channel many records post to - #alerts - belongs to none", async () => {
    channelOwner = null;

    await expect(readChannelAlert()).resolves.toBeNull();
    expect(readEventSpy).not.toHaveBeenCalled();
  });

  test("an incident's own channel is not an alert's: its incident form links nothing", async () => {
    channelOwner = { type: OnCallPageRecordType.Incident, id: INCIDENT_ID };

    await expect(readChannelAlert()).resolves.toBeNull();
    expect(readEventSpy).not.toHaveBeenCalled();
  });

  test("a resolved alert's channel is no longer the alert's, as for a page", async () => {
    isResolved = true;

    await expect(readChannelAlert()).resolves.toBeNull();
    expect(readAlertResourcesSpy).not.toHaveBeenCalled();
  });

  test("an alert the member may not read is not theirs to declare from: the plain form", async () => {
    alertRead = new NotAuthorizedException(
      "This alert is private, so only its owners may see it.",
    );

    await expect(readChannelAlert()).resolves.toBeNull();
    expect(readAlertResourcesSpy).not.toHaveBeenCalled();
  });

  test("a read that fails: the plain form, and it never throws", async () => {
    findChannelRecordSpy.mockRejectedValue(new Error("connection reset"));

    await expect(readChannelAlert()).resolves.toBeNull();
  });

  test("an alert with no title is still the alert", async () => {
    alertRead = alertOf({ title: "" });

    await expect(readChannelAlert()).resolves.toEqual(
      expect.objectContaining({ alertId: ALERT_ID, title: "" }),
    );
  });
});

describe("what the form says", () => {
  function declaringAlert(
    data: Partial<WorkspaceDeclaringAlert> = {},
  ): WorkspaceDeclaringAlert {
    return {
      alertId: ALERT_ID,
      name: ALERT_NAME,
      title: "Disk almost full",
      isPrivate: false,
      resources: [],
      ...data,
    };
  }

  test("the alert it is declared from, linked, and its title", () => {
    expect(
      WorkspaceIncidentFromAlert.getFormLine(declaringAlert()).toString(),
    ).toBe(
      `This incident will be linked to **[Alert ALT-3](${ALERT_LINK})**, Disk almost full.`,
    );
  });

  test("a private alert: and that the incident will be private like it", () => {
    expect(
      WorkspaceIncidentFromAlert.getFormLine(
        declaringAlert({ isPrivate: true }),
      ).toString(),
    ).toBe(
      `This incident will be linked to **[Alert ALT-3](${ALERT_LINK})**, Disk almost full, and private like it.`,
    );
  });

  test("with no title, or no link that could be built", () => {
    expect(
      WorkspaceIncidentFromAlert.getFormLine(
        declaringAlert({
          title: "  ",
          name: { label: "Alert ALT-3", link: null },
        }),
      ).toString(),
    ).toBe("This incident will be linked to **Alert ALT-3**.");
  });

  test("the title is text: Markdown in it is never read as Markdown", () => {
    const line: string = WorkspaceIncidentFromAlert.getFormLine(
      declaringAlert({ title: "**disk** [click](https://evil.example)" }),
    ).toString();

    expect(line).not.toContain("**disk**");
    expect(line).not.toContain("[click](");
  });
});

describe("what a form carries of the alert", () => {
  test("a Slack form's value, and a Teams button's field: alert:<id>", () => {
    expect(WorkspaceIncidentFromAlert.toValue(ALERT_ID)).toBe(
      `alert:${ALERT_ID.toString()}`,
    );
    expect(WORKSPACE_DECLARED_FROM_FIELD).toBe("declaredFrom");
  });

  test("reads back as the alert", () => {
    expect(
      WorkspaceIncidentFromAlert.readValue(
        WorkspaceIncidentFromAlert.toValue(ALERT_ID),
      )?.toString(),
    ).toBe(ALERT_ID.toString());
  });

  test.each([
    ["a channel id, as forms opened anywhere else carry", "C0OPS"],
    ["an incident", `incident:${INCIDENT_ID.toString()}`],
    ["an alert that is no id", "alert:not-an-id"],
    ["nothing", undefined],
    ["an empty value", ""],
    ["a number", 3],
  ])("names no alert: %s", (_what: string, value: unknown) => {
    expect(WorkspaceIncidentFromAlert.readValue(value)).toBeNull();
  });
});

describe("linking the alert a submission names, as whoever submits it", () => {
  async function checkLink(): Promise<
    WorkspaceAlertToLink | WorkspaceAlertNotLinked
  > {
    return await WorkspaceIncidentFromAlert.checkLink({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      props: PROPS,
    });
  }

  test("read and linkable: linked with the incident, as the Dashboard declares one from an alert", async () => {
    const result: WorkspaceAlertToLink | WorkspaceAlertNotLinked =
      await checkLink();

    expect(WorkspaceIncidentFromAlert.isLinked(result)).toBe(true);
    expect(result).toEqual({
      miscDataProps: {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
      },
      name: ALERT_NAME,
      isPrivate: false,
    });

    // Checked as the member, before anything is written.
    expect(validateSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertIds: [ALERT_ID.toString()],
      props: PROPS,
    });
    expect((readEventSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(
      PROPS,
    );
  });

  test("a private alert: and the incident private, like it", async () => {
    alertRead = alertOf({ isPrivate: true });

    await expect(checkLink()).resolves.toEqual(
      expect.objectContaining({ isPrivate: true }),
    );
  });

  test("an alert the member may not read: not linked, and not named", async () => {
    alertRead = new NotAuthorizedException(
      "This alert is private, so only its owners may see it.",
    );

    const result: WorkspaceAlertToLink | WorkspaceAlertNotLinked =
      await checkLink();

    expect(WorkspaceIncidentFromAlert.isLinked(result)).toBe(false);
    expect(result).toEqual({
      name: null,
      reason: "This alert is private, so only its owners may see it.",
    });
    expect(validateSpy).not.toHaveBeenCalled();
  });

  test("a member who may not link alerts to incidents: not linked, and why", async () => {
    validateSpy.mockRejectedValue(
      new BadDataException(
        "You do not have permission to link alerts to incidents in this project.",
      ),
    );

    await expect(checkLink()).resolves.toEqual({
      name: ALERT_NAME,
      reason:
        "You do not have permission to link alerts to incidents in this project.",
    });
  });

  test("a private alert none of their teams may link: not linked, and why", async () => {
    validateSpy.mockRejectedValue(
      new NotAuthorizedException(
        "Some of the alerts are private, and none of the teams of yours that own them may link them to an incident.",
      ),
    );

    await expect(checkLink()).resolves.toEqual({
      name: ALERT_NAME,
      reason:
        "Some of the alerts are private, and none of the teams of yours that own them may link them to an incident.",
    });
  });

  test("anything else that fails says so in one plain line, and never throws", async () => {
    validateSpy.mockRejectedValue(new Error("connection reset"));

    await expect(checkLink()).resolves.toEqual({
      name: ALERT_NAME,
      reason: "It could not be read just now.",
    });
  });

  test("the line that says why, to the person who declared it", () => {
    expect(
      WorkspaceIncidentFromAlert.getNotLinkedLine({
        name: ALERT_NAME,
        reason: "You may not link it.",
      }).toString(),
    ).toBe(
      `The incident was not linked to **[Alert ALT-3](${ALERT_LINK})**: You may not link it.`,
    );
    expect(
      WorkspaceIncidentFromAlert.getNotLinkedText({
        name: ALERT_NAME,
        reason: "You may not link it.",
      }),
    ).toBe("The incident was not linked to Alert ALT-3: You may not link it.");
    expect(
      WorkspaceIncidentFromAlert.getNotLinkedLine({
        name: null,
        reason: "You may not see it.",
      }).toString(),
    ).toBe(
      "The incident was not linked to this channel's alert: You may not see it.",
    );
    expect(
      WorkspaceIncidentFromAlert.getNotLinkedText({
        name: null,
        reason: "You may not see it.",
      }),
    ).toBe(
      "The incident was not linked to this channel's alert: You may not see it.",
    );
  });
});
