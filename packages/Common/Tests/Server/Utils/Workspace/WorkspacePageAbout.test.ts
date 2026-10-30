import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import { OnCallPageRecordType } from "../../../../Server/Services/OnCallPageService";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePageAbout, {
  WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
  WorkspacePageRecord,
  WorkspacePageSubject,
} from "../../../../Server/Utils/Workspace/WorkspacePageAbout";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHAT A PAGE FROM A CHAT IS ABOUT: WHERE IT IS ASKED FOR DECIDES.
 *
 * The maintainer (block 31): "If I am paging someone from an incident
 * channel, it's because of that incident. You should not create an alert
 * for it." One rule, for Slack and Microsoft Teams alike: in the channel
 * OneUptime made for an open incident or alert, a page is about it; anywhere
 * else, and in the channel of one that is resolved, about something new.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-0000000000a1",
);
const ALERT_ID: ObjectID = new ObjectID("e5000000-0000-4000-8000-0000000000b1");
const SIMON: ObjectID = new ObjectID("e5000000-0000-4000-8000-0000000000c1");
const IDENTIFIED: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-0000000000d1",
);
const ACKNOWLEDGED: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-0000000000d2",
);
const RESOLVED: ObjectID = new ObjectID("e5000000-0000-4000-8000-0000000000d3");
const DASHBOARD: string = "https://oneuptime.test/dashboard";
const INCIDENT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;
const ALERT_URL: string = `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;

const PROPS: DatabaseCommonInteractionProps = {
  userId: SIMON,
  tenantId: PROJECT_ID,
};

// The channel a channel-ownership query looks for: the JSON it contains.
function channelOf(query: Record<string, unknown>): string | null {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    (query["postUpdatesToWorkspaceChannels"] as {
      objectLiteralParameters?: Record<string, unknown>;
    }) || {};
  const parameters: Array<unknown> = Object.values(
    operator.objectLiteralParameters || {},
  );

  if (parameters.length !== 1) {
    return null;
  }

  const contained: Array<{ id?: string }> = JSON.parse(
    String(parameters[0]),
  ) as Array<{ id?: string }>;

  return contained[0]?.id || null;
}

function incidentStates(): Array<IncidentState> {
  return [
    [IDENTIFIED, 1, { isCreatedState: true }],
    [ACKNOWLEDGED, 2, { isAcknowledgedState: true }],
    [RESOLVED, 3, { isResolvedState: true }],
  ].map(([id, order, flags]: Array<unknown>): IncidentState => {
    const state: IncidentState = new IncidentState();
    state._id = (id as ObjectID).toString();
    state.order = order as number;
    Object.assign(state, flags);
    return state;
  });
}

function alertStates(): Array<AlertState> {
  return [
    [IDENTIFIED, 1, { isCreatedState: true }],
    [ACKNOWLEDGED, 2, { isAcknowledgedState: true }],
    [RESOLVED, 3, { isResolvedState: true }],
  ].map(([id, order, flags]: Array<unknown>): AlertState => {
    const state: AlertState = new AlertState();
    state._id = (id as ObjectID).toString();
    state.order = order as number;
    Object.assign(state, flags);
    return state;
  });
}

/*
 * The project's incidents and alerts as the services hand them back: the
 * owner of one channel each, read as OneUptime; each read by its id as the
 * member, in the state given.
 */
function installRecords(data: {
  incidentChannel?: string | undefined;
  incidentCreatedAt?: Date | undefined;
  incidentState?: ObjectID | undefined;
  alertChannel?: string | undefined;
  alertCreatedAt?: Date | undefined;
  alertState?: ObjectID | undefined;
}): {
  incidentReads: SpyInstance<typeof IncidentService.findOneBy>;
  alertReads: SpyInstance<typeof AlertService.findOneBy>;
} {
  const incidentReads: SpyInstance<typeof IncidentService.findOneBy> = jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (find: {
      query: Record<string, unknown>;
    }): Promise<Incident | null> => {
      if (find.query["postUpdatesToWorkspaceChannels"]) {
        if (
          !data.incidentChannel ||
          channelOf(find.query) !== data.incidentChannel
        ) {
          return null;
        }

        const owner: Incident = new Incident();
        owner.id = INCIDENT_ID;
        owner.createdAt = data.incidentCreatedAt || new Date(1000);
        return owner;
      }

      if (String(find.query["_id"]) !== INCIDENT_ID.toString()) {
        return null;
      }

      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.title = "Checkout   is\ndown";
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      incident.currentIncidentStateId = data.incidentState || IDENTIFIED;
      return incident;
    }) as never);

  const alertReads: SpyInstance<typeof AlertService.findOneBy> = jest
    .spyOn(AlertService, "findOneBy")
    .mockImplementation((async (find: {
      query: Record<string, unknown>;
    }): Promise<Alert | null> => {
      if (find.query["postUpdatesToWorkspaceChannels"]) {
        if (!data.alertChannel || channelOf(find.query) !== data.alertChannel) {
          return null;
        }

        const owner: Alert = new Alert();
        owner.id = ALERT_ID;
        owner.createdAt = data.alertCreatedAt || new Date(1000);
        return owner;
      }

      if (String(find.query["_id"]) !== ALERT_ID.toString()) {
        return null;
      }

      const alert: Alert = new Alert();
      alert.id = ALERT_ID;
      alert.title = "Disk almost full";
      alert.alertNumber = 3;
      alert.alertNumberWithPrefix = "ALT-3";
      alert.currentAlertStateId = data.alertState || IDENTIFIED;
      return alert;
    }) as never);

  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(incidentStates());
  jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockResolvedValue(alertStates());
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));

  return { incidentReads: incidentReads, alertReads: alertReads };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspacePageAbout.findChannelRecord: the incident or alert a channel was made for", () => {
  test("an incident's own channel names the incident, read as OneUptime by the channel's id", async () => {
    const { incidentReads, alertReads } = installRecords({
      incidentChannel: "C0INC42",
    });

    expect(
      await WorkspacePageAbout.findChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
      }),
    ).toEqual({ type: OnCallPageRecordType.Incident, id: INCIDENT_ID });

    // Both kinds asked, each in the project, as OneUptime, newest first.
    for (const read of [incidentReads, alertReads]) {
      const find: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
        sort: Record<string, unknown>;
      } = read.mock.calls[0]![0] as never;

      expect(find.props).toEqual({ isRoot: true });
      expect(find.query["projectId"]).toEqual(PROJECT_ID);
      expect(channelOf(find.query)).toBe("C0INC42");
      expect(find.sort).toEqual({ createdAt: "DESC" });
    }
  });

  test("an alert's own channel names the alert", async () => {
    installRecords({ alertChannel: "C0ALT3" });

    expect(
      await WorkspacePageAbout.findChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0ALT3",
      }),
    ).toEqual({ type: OnCallPageRecordType.Alert, id: ALERT_ID });
  });

  test.each([
    ["the incident, made later", new Date(5000), new Date(1000), "incident"],
    ["the alert, made later", new Date(1000), new Date(5000), "alert"],
    ["the incident, on a tie", new Date(3000), new Date(3000), "incident"],
  ])(
    "a channel two records claim: the newest - %s",
    async (
      _name: string,
      incidentCreatedAt: Date,
      alertCreatedAt: Date,
      expected: string,
    ) => {
      installRecords({
        incidentChannel: "C0SHARED",
        incidentCreatedAt: incidentCreatedAt,
        alertChannel: "C0SHARED",
        alertCreatedAt: alertCreatedAt,
      });

      expect(
        (
          await WorkspacePageAbout.findChannelRecord({
            projectId: PROJECT_ID,
            channelId: "C0SHARED",
          })
        )?.type,
      ).toBe(
        expected === "incident"
          ? OnCallPageRecordType.Incident
          : OnCallPageRecordType.Alert,
      );
    },
  );

  test("any other channel - #ops, #incidents that many records post to - belongs to none", async () => {
    installRecords({ incidentChannel: "C0INC42", alertChannel: "C0ALT3" });

    expect(
      await WorkspacePageAbout.findChannelRecord({
        projectId: PROJECT_ID,
        channelId: "C0OPS",
      }),
    ).toBeNull();
  });

  test.each([
    ["no channel (a direct message, the app's Home)", undefined],
    ["an empty one", ""],
    ["only spaces", "   "],
  ])("%s: none, and nothing is read", async (_name: string, channel?: string) => {
    const { incidentReads, alertReads } = installRecords({});

    expect(
      await WorkspacePageAbout.findChannelRecord({
        projectId: PROJECT_ID,
        channelId: channel,
      }),
    ).toBeNull();
    expect(incidentReads).not.toHaveBeenCalled();
    expect(alertReads).not.toHaveBeenCalled();
  });
});

describe("WorkspacePageAbout.read: what a page asked for in a channel is about", () => {
  test("an open incident's own channel: the incident, read as the member, with its name and link", async () => {
    const { incidentReads } = installRecords({ incidentChannel: "C0INC42" });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0INC42",
      props: PROPS,
    });

    expect(about.resolvedRecord).toBeUndefined();
    expect(about.record).not.toBeNull();

    const record: WorkspacePageRecord = about.record!;
    expect(record.type).toBe(OnCallPageRecordType.Incident);
    expect(record.event.type).toBe(WorkspaceEventType.Incident);
    expect(record.event.id).toEqual(INCIDENT_ID);
    expect(record.event.projectId).toEqual(PROJECT_ID);
    expect(record.event.numberWithPrefix).toBe("INC-42");
    expect(record.name).toEqual({
      label: "Incident INC-42",
      link: INCIDENT_URL,
    });
    expect(record.title).toBe("Checkout   is\ndown");

    // The incident itself was read as Simon, in his project.
    const memberRead: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = incidentReads.mock.calls.find((call: Array<unknown>): boolean => {
      return Boolean(
        (call[0] as { query: Record<string, unknown> }).query["_id"],
      );
    })![0] as never;
    expect(memberRead.props).toEqual(PROPS);
    expect(memberRead.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("an acknowledged incident is still open: the page is about it", async () => {
    installRecords({ incidentChannel: "C0INC42", incidentState: ACKNOWLEDGED });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0INC42",
      props: PROPS,
    });

    expect(about.record?.type).toBe(OnCallPageRecordType.Incident);
  });

  test("an open alert's own channel: the alert", async () => {
    installRecords({ alertChannel: "C0ALT3" });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0ALT3",
      props: PROPS,
    });

    expect(about.record?.type).toBe(OnCallPageRecordType.Alert);
    expect(about.record?.name).toEqual({
      label: "Alert ALT-3",
      link: ALERT_URL,
    });
    expect(about.record?.title).toBe("Disk almost full");
  });

  test("a resolved incident's channel: something new, naming the incident as why", async () => {
    installRecords({ incidentChannel: "C0INC42", incidentState: RESOLVED });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0INC42",
      props: PROPS,
    });

    expect(about).toEqual({
      record: null,
      resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
    });
  });

  test("a resolved alert's channel: something new, naming the alert", async () => {
    installRecords({ alertChannel: "C0ALT3", alertState: RESOLVED });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0ALT3",
      props: PROPS,
    });

    expect(about.record).toBeNull();
    expect(about.resolvedRecord?.label).toBe("Alert ALT-3");
  });

  test("any other channel: something new, and the member's read of nothing", async () => {
    const { incidentReads } = installRecords({ incidentChannel: "C0INC42" });

    const about: WorkspacePageSubject = await WorkspacePageAbout.read({
      projectId: PROJECT_ID,
      channelId: "C0OPS",
      props: PROPS,
    });

    expect(about).toEqual(WORKSPACE_PAGE_NEW_ALERT_SUBJECT);
    // Only the ownership question was asked.
    expect(
      incidentReads.mock.calls.every((call: Array<unknown>): boolean => {
        return !(call[0] as { query: Record<string, unknown> }).query["_id"];
      }),
    ).toBe(true);
  });

  test("a record's channel the member may not read: refused with why - the page there would be about it", async () => {
    installRecords({ incidentChannel: "C0INC42" });

    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to page someone about this incident: this incident is private.",
    );
    const read: SpyInstance<typeof WorkspaceMemberActions.readEventForMember> =
      jest
        .spyOn(WorkspaceMemberActions, "readEventForMember")
        .mockRejectedValue(refusal);

    await expect(
      WorkspacePageAbout.read({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
        props: PROPS,
      }),
    ).rejects.toBe(refusal);

    // The refusal says what the member was refused: paging about it.
    expect(
      (read.mock.calls[0]![0] as { action: string; props: unknown }).action,
    ).toBe("page someone about this incident");
    expect((read.mock.calls[0]![0] as { props: unknown }).props).toEqual(
      PROPS,
    );
  });

  test("an alert's channel the member may not read: the refusal is about the alert", async () => {
    installRecords({ alertChannel: "C0ALT3" });

    const read: SpyInstance<typeof WorkspaceMemberActions.readEventForMember> =
      jest
        .spyOn(WorkspaceMemberActions, "readEventForMember")
        .mockRejectedValue(new NotAuthorizedException("no"));

    await expect(
      WorkspacePageAbout.read({
        projectId: PROJECT_ID,
        channelId: "C0ALT3",
        props: PROPS,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect((read.mock.calls[0]![0] as { action: string }).action).toBe(
      "page someone about this alert",
    );
  });
});

describe("a form's value: what a form carries of what it pages about", () => {
  function subjectOf(type: OnCallPageRecordType): WorkspacePageSubject {
    return {
      record: {
        type: type,
        event: {
          type:
            type === OnCallPageRecordType.Incident
              ? WorkspaceEventType.Incident
              : WorkspaceEventType.Alert,
          id: type === OnCallPageRecordType.Incident ? INCIDENT_ID : ALERT_ID,
          projectId: PROJECT_ID,
          currentStateId: undefined,
          number: 42,
          numberWithPrefix: "INC-42",
        },
        name: { label: "Incident INC-42", link: INCIDENT_URL },
        title: "Checkout is down",
      },
    };
  }

  test("an incident, an alert, or nothing for something new", () => {
    expect(
      WorkspacePageAbout.toValue(subjectOf(OnCallPageRecordType.Incident)),
    ).toBe(`incident:${INCIDENT_ID.toString()}`);
    expect(
      WorkspacePageAbout.toValue(subjectOf(OnCallPageRecordType.Alert)),
    ).toBe(`alert:${ALERT_ID.toString()}`);
    expect(WorkspacePageAbout.toValue(WORKSPACE_PAGE_NEW_ALERT_SUBJECT)).toBe(
      "",
    );
    expect(
      WorkspacePageAbout.toValue({
        record: null,
        resolvedRecord: { label: "Incident INC-42", link: null },
      }),
    ).toBe("");
  });

  test("read back as it was written", () => {
    expect(
      WorkspacePageAbout.parseValue(
        WorkspacePageAbout.toValue(subjectOf(OnCallPageRecordType.Incident)),
      ),
    ).toEqual({ type: OnCallPageRecordType.Incident, id: INCIDENT_ID });
    expect(
      WorkspacePageAbout.parseValue(
        WorkspacePageAbout.toValue(subjectOf(OnCallPageRecordType.Alert)),
      ),
    ).toEqual({ type: OnCallPageRecordType.Alert, id: ALERT_ID });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty value", ""],
    ["no separator", INCIDENT_ID.toString()],
    ["a kind no form writes", `episode:${INCIDENT_ID.toString()}`],
    ["a kind in other case", `Incident:${INCIDENT_ID.toString()}`],
    ["an id that is no id", "incident:42"],
    ["an id with text after it", `incident:${INCIDENT_ID.toString()}x`],
    ["the bare id an incident menu form carries", INCIDENT_ID.toString()],
  ])("%s is no record: something new", (_name: string, value: unknown) => {
    expect(WorkspacePageAbout.parseValue(value as string)).toBeNull();
  });

  test("readValue reads a carried incident again as whoever submits the form", async () => {
    const { incidentReads } = installRecords({});

    const about: WorkspacePageSubject = await WorkspacePageAbout.readValue({
      value: `incident:${INCIDENT_ID.toString()}`,
      props: PROPS,
    });

    expect(about.record?.event.id).toEqual(INCIDENT_ID);
    expect(
      (incidentReads.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual(PROPS);
  });

  test("readValue of a form whose incident was resolved since: something new, saying which", async () => {
    installRecords({ incidentState: RESOLVED });

    expect(
      await WorkspacePageAbout.readValue({
        value: `incident:${INCIDENT_ID.toString()}`,
        props: PROPS,
      }),
    ).toEqual({
      record: null,
      resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
    });
  });

  test("readValue of a form that carries nothing reads nothing: something new", async () => {
    const { incidentReads, alertReads } = installRecords({});

    expect(
      await WorkspacePageAbout.readValue({ value: "", props: PROPS }),
    ).toEqual(WORKSPACE_PAGE_NEW_ALERT_SUBJECT);
    expect(incidentReads).not.toHaveBeenCalled();
    expect(alertReads).not.toHaveBeenCalled();
  });

  test("readValue of a forged value naming a record the member may not read: refused", async () => {
    installRecords({});
    jest
      .spyOn(WorkspaceMemberActions, "readEventForMember")
      .mockRejectedValue(new NotAuthorizedException("not yours"));

    await expect(
      WorkspacePageAbout.readValue({
        value: `alert:${ALERT_ID.toString()}`,
        props: PROPS,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});

describe("the words: what a form opens with, and what the answer says the page is about", () => {
  function record(data: {
    numberWithPrefix: string | null;
    number: number | null;
    link: string | null;
    title: string;
  }): WorkspacePageRecord {
    return {
      type: OnCallPageRecordType.Incident,
      event: {
        type: WorkspaceEventType.Incident,
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
        currentStateId: undefined,
        number: data.number,
        numberWithPrefix: data.numberWithPrefix,
      },
      name: { label: "Incident INC-42", link: data.link },
      title: data.title,
    };
  }

  test("the heading: the number, linked to the record, then its title on one line", () => {
    expect(
      WorkspacePageAbout.getHeading(
        record({
          numberWithPrefix: "INC-42",
          number: 42,
          link: INCIDENT_URL,
          title: "Checkout   is\ndown",
        }),
      ).toString(),
    ).toBe(`🚨 **[INC-42](${INCIDENT_URL})** Checkout is down`);
  });

  test("with no prefix: #42; with no link: the number in bold", () => {
    expect(
      WorkspacePageAbout.getHeading(
        record({
          numberWithPrefix: null,
          number: 42,
          link: null,
          title: "Checkout is down",
        }),
      ).toString(),
    ).toBe("🚨 **#42** Checkout is down");
  });

  test("with no number at all: the title alone", () => {
    expect(
      WorkspacePageAbout.getHeading(
        record({
          numberWithPrefix: null,
          number: null,
          link: INCIDENT_URL,
          title: "Checkout is down",
        }),
      ).toString(),
    ).toBe("🚨 Checkout is down");
  });

  test("a title is text: what would be Markdown in it is escaped", () => {
    const heading: string = WorkspacePageAbout.getHeading(
      record({
        numberWithPrefix: "INC-42",
        number: 42,
        link: INCIDENT_URL,
        title: "**[click](https://evil.example)**",
      }),
    ).toString();

    expect(heading).not.toContain("[click](https://evil.example)");
    expect(heading).toContain("\\*\\*\\[click\\]");
  });

  test("what the answer says: about the record, or about a new alert", () => {
    expect(
      WorkspacePageAbout.getAboutWords({
        record: record({
          numberWithPrefix: "INC-42",
          number: 42,
          link: INCIDENT_URL,
          title: "Checkout is down",
        }),
      }),
    ).toBe("about Incident INC-42");
    expect(
      WorkspacePageAbout.getAboutWords(WORKSPACE_PAGE_NEW_ALERT_SUBJECT),
    ).toBe("about a new alert");
    expect(
      WorkspacePageAbout.getAboutWords({
        record: null,
        resolvedRecord: { label: "Incident INC-42", link: null },
      }),
    ).toBe("about a new alert");
  });

  test("the page's targets about the record: its incident's id, or its alert's", () => {
    const incident: WorkspacePageRecord = record({
      numberWithPrefix: "INC-42",
      number: 42,
      link: null,
      title: "x",
    });

    expect(WorkspacePageAbout.getRecordAbout(incident)).toEqual({
      incidentId: INCIDENT_ID,
    });
    expect(
      WorkspacePageAbout.getRecordAbout({
        ...incident,
        type: OnCallPageRecordType.Alert,
        event: { ...incident.event, id: ALERT_ID },
      }),
    ).toEqual({ alertId: ALERT_ID });
  });
});
