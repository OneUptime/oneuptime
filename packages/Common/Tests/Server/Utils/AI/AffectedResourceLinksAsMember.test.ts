import AffectedResourceLinks, {
  LinkedAffectedResource,
} from "../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import HostService from "../../../../Server/Services/HostService";
import logger from "../../../../Server/Utils/Logger";
import { AiAffectedResourceKind } from "../../../../Types/AI/AiAffectedResources";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { useInMemoryTable } from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT ASK AI LINKS, AS THE MEMBER WHO ASKED (#5293).
 *
 * An incident or alert OneUptime AI declares or changes is linked only to
 * the resources the person who asked may view: each one is read with their
 * own props, by the permission layer for real (the table is held in
 * memory). A member who may read hosts links the project's host; another
 * project's host, an archived one, and every host for a member whose role
 * reads no hosts at all are left out, each with the reason the model passes
 * on - so a conversation can never link what the person could not have
 * picked on the Declare Incident form.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const ARCHIVED_HOST_ID: string = "55555555-5555-4555-8555-555555555555";

function memberContext(permissions: Array<Permission>): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
      ...ON_HIGHEST_PLAN,
    },
  };
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  useInMemoryTable(HostService, [
    {
      _id: HOST_ID,
      projectId: PROJECT_ID.toString(),
      name: "test01",
      hostIdentifier: "test01",
      isArchived: false,
      version: 1,
    },
    {
      _id: OTHER_PROJECT_HOST_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "their-box",
      hostIdentifier: "their-box",
      isArchived: false,
      version: 1,
    },
    {
      _id: ARCHIVED_HOST_ID,
      projectId: PROJECT_ID.toString(),
      name: "old-box",
      hostIdentifier: "old-box",
      isArchived: true,
      version: 1,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function resolveHosts(
  ctx: ToolContext,
  ids: Array<string>,
): Promise<{
  linked: Array<LinkedAffectedResource>;
  notLinked: Array<string>;
}> {
  return await AffectedResourceLinks.resolve({
    refs: ids.map((id: string) => {
      return { kind: AiAffectedResourceKind.Host, id };
    }),
    ctx,
  });
}

describe("what Ask AI links, as the member who asked", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["someone holding Read Host", [Permission.ReadHost]],
  ])(
    "%s links the project's host they are looking at",
    async (_who: string, permissions: Array<Permission>) => {
      const result: {
        linked: Array<LinkedAffectedResource>;
        notLinked: Array<string>;
      } = await resolveHosts(memberContext(permissions), [HOST_ID]);

      expect(result.linked).toEqual([
        { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "test01" },
      ]);
      expect(result.notLinked).toEqual([]);
    },
  );

  test("another project's host is never linked, whatever its ID", async () => {
    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await resolveHosts(memberContext([Permission.ProjectOwner]), [
      OTHER_PROJECT_HOST_ID,
    ]);

    expect(result.linked).toEqual([]);
    expect(result.notLinked).toEqual([
      `No host with ID ${OTHER_PROJECT_HOST_ID} that the current user may view exists in this project, so it was not linked.`,
    ]);
  });

  test("an archived host is left out, and the reason says how to link it", async () => {
    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await resolveHosts(memberContext([Permission.ProjectMember]), [
      ARCHIVED_HOST_ID,
      HOST_ID,
    ]);

    expect(result.linked).toEqual([
      { kind: AiAffectedResourceKind.Host, id: HOST_ID, name: "test01" },
    ]);
    expect(result.notLinked).toEqual([
      'host "old-box" is archived, so it was not linked. Unarchive it in OneUptime to link it.',
    ]);
  });

  test("a member whose role reads no hosts links none of them", async () => {
    const result: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await resolveHosts(
      memberContext([
        Permission.CreateProjectIncident,
        Permission.ReadProjectIncident,
      ]),
      [HOST_ID],
    );

    expect(result.linked).toEqual([]);
    expect(result.notLinked).toEqual([
      "The host named could not be read for the current user (they may not view hosts), so it was not linked.",
    ]);
  });
});
