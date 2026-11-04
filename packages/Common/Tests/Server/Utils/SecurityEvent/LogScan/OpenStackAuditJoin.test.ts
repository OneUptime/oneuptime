import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackCloud from "../../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../../Models/DatabaseModels/OpenStackResource";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../../Server/Services/OpenStackResourceService";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../../Types/OpenStack/OpenStackResourceKind";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OpenStackAuditLogParser, {
  OpenStackAuditAttribute,
} from "../../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { logLine } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * An audit event names what it is about by ID, and a case should name it the way a person does.
 * So names go in from the cloud's inventory, and from what the cloud's own events have said of
 * a user, and an ID nobody has a name for keeps its ID, which is still exact.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const OPENSTACK_PROJECT: string = "fedcba9876543210fedcba9876543210";
const OTHER_PROJECT: string = "0123456789abcdef0123456789abcde0";
const INSTANCE: string = "bcee0abb-08c3-430a-9a53-cce3284714eb";
const USER: string = "e988af08b4024d1f9af182fda1f9b42a";

function grant(project: string = OPENSTACK_PROJECT): NormalizedSecurityEvent {
  return OpenStackAuditLogParser.parse(
    logLine(
      JSON.stringify({
        event_type: "identity.role_assignment.created",
        payload: {
          typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
          outcome: "success",
          initiator: { id: "u", username: "alice" },
          role: "r",
          project,
          user: "target",
        } as JSONObject,
      }),
      { "resource.openstack.cloud.name": "production" },
    ),
  )[0] as NormalizedSecurityEvent;
}

function call(project: string = OPENSTACK_PROJECT): NormalizedSecurityEvent {
  return OpenStackAuditLogParser.parse(
    logLine(
      JSON.stringify({
        event_type: "audit.http.response",
        payload: {
          typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
          action: "update/os-stop",
          outcome: "success",
          requestPath: `/compute/v2.1/servers/${INSTANCE}/action`,
          initiator: {
            id: USER,
            name: "alice",
            project_id: project,
            host: { address: "203.0.113.7" },
          },
          target: { id: "unknown", name: "unknown", typeURI: "unknown" },
        } as JSONObject,
      }),
      {
        "resource.openstack.cloud.name": "production",
        "openstack.request_id": "req-1",
      },
    ),
  )[0] as NormalizedSecurityEvent;
}

type InventoryRow = {
  kind?: string;
  externalId: string;
  name: string;
  openStackProjectId?: string;
};

function mockInventory(rows: Array<[string, string] | InventoryRow>): {
  findRows: ReturnType<typeof jest.spyOn>;
} {
  const cloud: OpenStackCloud = new OpenStackCloud();

  cloud.id = ObjectID.generate();
  cloud.name = "production";

  jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async () => {
    return [cloud];
  }) as never);

  const findRows: ReturnType<typeof jest.spyOn> = jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async (data: {
      query: { externalId: { value: Array<string> } | string };
    }) => {
      const wanted: unknown = data.query.externalId;
      const list: Array<string> = JSON.stringify(wanted).match(
        /[0-9a-f-]{32,36}/g,
      ) as Array<string>;

      return rows
        .map((given: [string, string] | InventoryRow): InventoryRow => {
          return Array.isArray(given)
            ? {
                kind: OpenStackResourceKind.Project,
                externalId: given[0],
                name: given[1],
              }
            : given;
        })
        .filter((row: InventoryRow): boolean => {
          return list.includes(row.externalId);
        })
        .map((row: InventoryRow): OpenStackResource => {
          const model: OpenStackResource = new OpenStackResource();
          model.kind = row.kind || OpenStackResourceKind.Instance;
          model.externalId = row.externalId;
          model.name = row.name;
          if (row.openStackProjectId) {
            model.openStackProjectId = row.openStackProjectId;
          }
          return model;
        });
    }) as never);

  return { findRows };
}

/*
 * Redis, as a map: what a page of events remembered of a user, a later page reads. Each test
 * starts with none.
 */
let remembered: Map<string, string> = new Map();

beforeEach(() => {
  remembered = new Map();

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    _namespace: string,
    keys: Array<string>,
  ) => {
    return keys.map((key: string): string | null => {
      return remembered.get(key) || null;
    });
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    _namespace: string,
    key: string,
    value: string,
  ) => {
    remembered.set(key, value);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an event's project", () => {
  test("is named where a case and a person read it", async () => {
    mockInventory([[OPENSTACK_PROJECT, "payments"]]);

    const event: NormalizedSecurityEvent = grant();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes[OpenStackAuditAttribute.ProjectName]).toBe(
      "payments",
    );
    expect(event.message).toBe(
      "alice granted role r to target on project payments",
    );
    expect(event.targetResource).toBe("project payments");
    // The ID stays, for what reads it exactly.
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      OPENSTACK_PROJECT,
    );
  });

  test("one the inventory has not seen keeps its ID", async () => {
    mockInventory([]);

    const event: NormalizedSecurityEvent = grant();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(
      event.attributes[OpenStackAuditAttribute.ProjectName],
    ).toBeUndefined();
    expect(event.targetResource).toBe(`project ${OPENSTACK_PROJECT}`);
  });

  test("a cloud it cannot find keeps its IDs", async () => {
    jest
      .spyOn(OpenStackCloudService, "findBy")
      .mockImplementation((async () => {
        return [];
      }) as never);

    const event: NormalizedSecurityEvent = grant();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(
      event.attributes[OpenStackAuditAttribute.ProjectName],
    ).toBeUndefined();
  });

  test("a read that fails loses no event, and throws nothing", async () => {
    jest
      .spyOn(OpenStackCloudService, "findBy")
      .mockImplementation((async () => {
        throw new Error("Postgres is down");
      }) as never);

    const event: NormalizedSecurityEvent = grant();

    await expect(
      OpenStackAuditJoin.enrichEvents({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).resolves.toBeUndefined();
    expect(event.targetResource).toBe(`project ${OPENSTACK_PROJECT}`);
  });

  test("another source's events cost no read", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OpenStackCloudService,
      "findBy",
    );

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [
        {
          attributes: { "openstack.audit.project_id": "x" },
        } as unknown as NormalizedSecurityEvent,
      ],
    });

    expect(findBy).not.toHaveBeenCalled();
  });

  test("a name that looks like a marker is written as text, once", () => {
    const event: NormalizedSecurityEvent = grant();

    OpenStackAuditJoin.nameProject({
      event,
      id: OPENSTACK_PROJECT,
      name: "$& **bold**",
    });

    expect(event.targetResource).toBe("project $& **bold**");
  });

  test("is named for a case too, in place of its ID", async () => {
    mockInventory([[OPENSTACK_PROJECT, "payments"]]);

    const event: NormalizedSecurityEvent = grant();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.observables).toContain("project payments");
    expect(event.observables).not.toContain(`project ${OPENSTACK_PROJECT}`);
  });
});

describe("the part an API call touched", () => {
  test("is named where a case and a person read it", async () => {
    mockInventory([
      [OPENSTACK_PROJECT, "payments"],
      {
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
        name: "web-1",
        openStackProjectId: OPENSTACK_PROJECT,
      },
    ]);

    const event: NormalizedSecurityEvent = call();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes[OpenStackAuditAttribute.PartName]).toBe("web-1");
    expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe(INSTANCE);
    expect(event.message).toBe("alice update/os-stop on instance web-1");
    expect(event.targetResource).toBe("project payments instance web-1");
    expect(event.observables).toContain("instance web-1");
    expect(event.observables).toContain("project payments");
  });

  test("affects the project its row says, whichever project the token was for", async () => {
    mockInventory([
      [OPENSTACK_PROJECT, "payments"],
      [OTHER_PROJECT, "admin"],
      {
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
        name: "web-1",
        openStackProjectId: OPENSTACK_PROJECT,
      },
    ]);

    // An admin, acting from their own project.
    const event: NormalizedSecurityEvent = call(OTHER_PROJECT);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      OPENSTACK_PROJECT,
    );
    expect(event.attributes[OpenStackAuditAttribute.ProjectName]).toBe(
      "payments",
    );
    expect(event.attributes[OpenStackAuditAttribute.InitiatorProjectId]).toBe(
      OTHER_PROJECT,
    );
    expect(event.targetResource).toBe("project payments instance web-1");
    expect(event.observables).toContain("project payments");
    expect(event.observables).not.toContain("project admin");
  });

  test("reads a part's project once more, when no event of the page named it", async () => {
    const { findRows } = mockInventory([
      [OPENSTACK_PROJECT, "payments"],
      {
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
        name: "web-1",
        openStackProjectId: OPENSTACK_PROJECT,
      },
    ]);
    const event: NormalizedSecurityEvent = call(OTHER_PROJECT);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(findRows).toHaveBeenCalledTimes(2);
    expect(event.attributes[OpenStackAuditAttribute.ProjectName]).toBe(
      "payments",
    );
  });

  test("a part the inventory has not seen keeps its ID, and its project is still named", async () => {
    mockInventory([[OPENSTACK_PROJECT, "payments"]]);

    const event: NormalizedSecurityEvent = call();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes[OpenStackAuditAttribute.PartName]).toBeUndefined();
    expect(event.targetResource).toBe(`project payments instance ${INSTANCE}`);
  });

  test("however many events name it, the inventory is read once", async () => {
    const { findRows } = mockInventory([[OPENSTACK_PROJECT, "payments"]]);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [call(), call(), call(), grant(), grant()],
    });

    expect(findRows).toHaveBeenCalledTimes(1);
  });
});

describe("a user", () => {
  function grantTo(user: string): NormalizedSecurityEvent {
    return OpenStackAuditLogParser.parse(
      logLine(
        JSON.stringify({
          event_type: "identity.role_assignment.created",
          payload: {
            typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
            outcome: "success",
            initiator: { id: "a", username: "alice" },
            role: "r",
            project: OPENSTACK_PROJECT,
            user,
          } as JSONObject,
        }),
        { "resource.openstack.cloud.name": "production" },
      ),
    )[0] as NormalizedSecurityEvent;
  }

  function signIn(user: string, name: string): NormalizedSecurityEvent {
    return OpenStackAuditLogParser.parse(
      logLine(
        JSON.stringify({
          event_type: "identity.authenticate",
          payload: {
            typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
            outcome: "success",
            initiator: {
              id: user,
              user_id: user,
              username: name,
              host: { address: "203.0.113.7" },
            },
          } as JSONObject,
        }),
        { "resource.openstack.cloud.name": "production" },
      ),
    )[0] as NormalizedSecurityEvent;
  }

  test("named by an event of the same page is named on the rest", async () => {
    mockInventory([]);

    const grantEvent: NormalizedSecurityEvent = grantTo(USER);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [grantEvent, signIn(USER, "bob")],
    });

    expect(grantEvent.targetUser).toBe("bob");
    expect(grantEvent.message).toBe(
      `alice granted role r to bob on project ${OPENSTACK_PROJECT}`,
    );
    expect(grantEvent.attributes[OpenStackAuditAttribute.UserName]).toBe("bob");
    // The ID stays, for what reads it exactly.
    expect(grantEvent.attributes[OpenStackAuditAttribute.UserId]).toBe(USER);
    expect(grantEvent.observables).toContain("bob");
    expect(grantEvent.observables).not.toContain(`user ${USER}`);
  });

  test("seen once is named by a later page, which only has the ID", async () => {
    mockInventory([]);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [signIn(USER, "bob")],
    });

    const later: NormalizedSecurityEvent = grantTo(USER);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [later],
    });

    expect(later.targetUser).toBe("bob");
  });

  test("nobody has named keeps their ID, said to be a user's", async () => {
    mockInventory([]);

    const event: NormalizedSecurityEvent = grantTo(USER);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.targetUser).toBe(USER);
    expect(event.observables).toContain(`user ${USER}`);
    expect(event.attributes[OpenStackAuditAttribute.UserName]).toBeUndefined();
  });

  test("of another cloud is another user, whatever the ID", async () => {
    mockInventory([]);

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [signIn(USER, "bob")],
    });

    const elsewhere: NormalizedSecurityEvent = OpenStackAuditLogParser.parse(
      logLine(
        JSON.stringify({
          event_type: "identity.role_assignment.created",
          payload: {
            typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
            outcome: "success",
            initiator: { id: "a", username: "alice" },
            role: "r",
            project: OPENSTACK_PROJECT,
            user: USER,
          } as JSONObject,
        }),
        { "resource.openstack.cloud.name": "staging" },
      ),
    )[0] as NormalizedSecurityEvent;

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [elsewhere],
    });

    expect(elsewhere.targetUser).toBe(USER);
  });

  test("a cache that is down loses no event, and throws nothing", async () => {
    mockInventory([]);
    jest.spyOn(GlobalCache, "getStrings").mockImplementation((async () => {
      throw new Error("Redis is down");
    }) as never);

    const event: NormalizedSecurityEvent = grantTo(USER);

    await expect(
      OpenStackAuditJoin.enrichEvents({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).resolves.toBeUndefined();
    expect(event.targetUser).toBe(USER);
  });

  test("a name that looks like a marker is written as text", () => {
    const event: NormalizedSecurityEvent = grantTo(USER);

    OpenStackAuditJoin.nameUser({ event, id: USER, name: "$& **bold**" });

    expect(event.targetUser).toBe("$& **bold**");
    expect(event.message).toContain("to $& **bold** on");
  });
});

describe("one request", () => {
  function ruleOpened(): NormalizedSecurityEvent {
    return OpenStackAuditLogParser.parse(
      logLine(
        JSON.stringify({
          event_type: "security_group_rule.create.end",
          payload: {
            security_group_rule: {
              direction: "ingress",
              protocol: "tcp",
              remote_ip_prefix: "0.0.0.0/0",
              security_group_id: "group-id",
              port_range_min: 22,
              port_range_max: 22,
            },
          },
        }),
        {
          "resource.openstack.cloud.name": "production",
          "openstack.user_name": "alice",
          "openstack.request_id": "req-1",
        },
      ),
    )[0] as NormalizedSecurityEvent;
  }

  test("says where a notification came from, through its audit filter's event", async () => {
    mockInventory([]);

    const event: NormalizedSecurityEvent = ruleOpened();

    expect(event.principalIp).toBe("");

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event, call()],
    });

    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.attributes[OpenStackAuditAttribute.InitiatorAddress]).toBe(
      "203.0.113.7",
    );
    expect(event.attributes[OpenStackAuditAttribute.InitiatorId]).toBe(USER);
    expect(event.observables).toContain("203.0.113.7");
  });

  test("with no audit filter on, it says nothing it does not know", async () => {
    mockInventory([]);

    const event: NormalizedSecurityEvent = ruleOpened();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.principalIp).toBe("");
    expect(event.principalUser).toBe("alice");
  });
});
