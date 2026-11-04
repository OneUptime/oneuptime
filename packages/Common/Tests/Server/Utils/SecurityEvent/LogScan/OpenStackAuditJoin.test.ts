import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackCloud from "../../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../../Models/DatabaseModels/OpenStackResource";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../../Server/Services/OpenStackResourceService";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OpenStackAuditLogParser, {
  OpenStackAuditAttribute,
} from "../../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { logLine } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * An audit event names its project by ID, and a case should name it the way a person does. So a
 * project's name goes in from the cloud's inventory, and an ID the inventory has not seen keeps
 * its ID, which is still exact.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const OPENSTACK_PROJECT: string = "fedcba9876543210fedcba9876543210";

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

function mockInventory(rows: Array<[string, string]>): void {
  const cloud: OpenStackCloud = new OpenStackCloud();

  cloud.id = ObjectID.generate();
  cloud.name = "production";

  jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async () => {
    return [cloud];
  }) as never);
  jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async () => {
      return rows.map(([externalId, name]: [string, string]): OpenStackResource => {
        const row: OpenStackResource = new OpenStackResource();
        row.externalId = externalId;
        row.name = name;
        return row;
      });
    }) as never);
}

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
    expect(event.message).toBe("alice granted role r to target on project payments");
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

    expect(event.attributes[OpenStackAuditAttribute.ProjectName]).toBeUndefined();
    expect(event.targetResource).toBe(`project ${OPENSTACK_PROJECT}`);
  });

  test("a cloud it cannot find keeps its IDs", async () => {
    jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async () => {
      return [];
    }) as never);

    const event: NormalizedSecurityEvent = grant();

    await OpenStackAuditJoin.enrichEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes[OpenStackAuditAttribute.ProjectName]).toBeUndefined();
  });

  test("a read that fails loses no event, and throws nothing", async () => {
    jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async () => {
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
});
