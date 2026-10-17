import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostService from "../../../Server/Services/HostService";
import logger from "../../../Server/Utils/Logger";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { KubernetesClusterAiAccessStatus } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiAccessStatus } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - getStatusesViewableBy on KubernetesClusterAiAccess
 * Service and ResourceAiAccessService: which of an incident's or alert's
 * linked clusters and resources the person asking in its shared AI
 * conversation may VIEW, so the conversation's read-only kubectl and
 * infrastructure commands reach those alone
 * (InvestigationThread.buildTurnContext).
 *
 * - the read is the model layer's, under the caller's own props pinned to
 *   the project of the subject (a caller acting in another project, or
 *   across projects, is read in this one), so labels, owners, blocks and
 *   custom roles decide it exactly as a read through the API does - the
 *   label and owner SQL is held on a real Postgres by
 *   Tests/Server/API/KubernetesClusterEditScopePostgres;
 * - only the rows that read returns are kept, in the order given, whatever
 *   the case of their ids;
 * - a refusal of the read means none (and is not an error to log); any
 *   other failure means none too, logged: what runs for the caller fails
 *   closed;
 * - for resources, each kind is read on its own, so a refusal for one kind
 *   leaves the others as they are;
 * - root and master admins view every one, and nothing is read for them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const STAGING_CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const PROD_CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";
const SANDBOX_CLUSTER_ID: string = "55555555-5555-4555-8555-555555555555";

const WEB_HOST_ID: string = "66666666-6666-4666-8666-666666666666";
const PAYMENTS_HOST_ID: string = "77777777-7777-4777-8777-777777777777";
const DB_SERVER_HOST_ID: string = "88888888-8888-4888-8888-888888888888";

function memberProps(
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    isMultiTenantRequest: false,
    ...overrides,
  } as DatabaseCommonInteractionProps;
}

function clusterStatus(
  clusterId: string,
  name: string,
): KubernetesClusterAiAccessStatus {
  return {
    clusterId,
    clusterName: name,
    clusterIdentifier: name,
    isInvestigationReady: true,
    isRemediationReady: false,
    gaps: [],
  } as unknown as KubernetesClusterAiAccessStatus;
}

function resourceStatus(
  resourceType: AiResourceType,
  resourceId: string,
): ResourceAiAccessStatus {
  return {
    resourceType,
    resourceId,
    resourceName: resourceId,
    isInvestigationReady: true,
    isRemediationReady: false,
    gaps: [],
  } as unknown as ResourceAiAccessStatus;
}

function clusterRow(id: string): KubernetesCluster {
  const model: KubernetesCluster = new KubernetesCluster();
  model.id = new ObjectID(id);
  return model;
}

function dockerHostRow(id: string): DockerHost {
  const model: DockerHost = new DockerHost();
  model.id = new ObjectID(id);
  return model;
}

function hostRow(id: string): Host {
  const model: Host = new Host();
  model.id = new ObjectID(id);
  return model;
}

/*
 * The ids an id filter of the any kind asks for (its parameter
 * is named at random, so the operator itself is never compared).
 */
function anyValues(operator: unknown): Array<string> {
  return Object.values(
    (operator as { objectLiteralParameters: Record<string, Array<string>> })
      .objectLiteralParameters,
  )[0]!.map((value: string): string => {
    return value.toString();
  });
}

interface FindByCall {
  query: { _id: unknown; projectId: unknown };
  select: unknown;
  limit: unknown;
  skip: unknown;
  props: unknown;
}

// The read's arguments, with its id filter as the ids it asks for.
function readOf(spy: jest.SpyInstance, index: number = 0): unknown {
  const call: FindByCall = spy.mock.calls[index]![0] as FindByCall;

  return {
    ...call,
    query: { ...call.query, _id: anyValues(call.query._id) },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KubernetesClusterAiAccessService.getStatusesViewableBy", () => {
  let findBy: jest.SpyInstance;
  let logError: jest.SpyInstance;

  const statuses: Array<KubernetesClusterAiAccessStatus> = [
    clusterStatus(PROD_CLUSTER_ID, "prod-us"),
    clusterStatus(STAGING_CLUSTER_ID, "staging-us"),
    clusterStatus(SANDBOX_CLUSTER_ID, "sandbox"),
  ];

  beforeEach(() => {
    findBy = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([clusterRow(STAGING_CLUSTER_ID)] as never);
    logError = jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  it("keeps the clusters the caller's read returns, and only those", async () => {
    const viewable: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses,
      });

    expect(
      viewable.map((status: KubernetesClusterAiAccessStatus): string => {
        return status.clusterName;
      }),
    ).toEqual(["staging-us"]);
  });

  it("reads them as the caller, pinned to this project, one query for all of them", async () => {
    await KubernetesClusterAiAccessService.getStatusesViewableBy({
      // A caller acting in another project, across projects, is read in this one.
      props: memberProps({
        tenantId: OTHER_PROJECT_ID,
        isMultiTenantRequest: true,
      }),
      projectId: PROJECT_ID,
      statuses,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(readOf(findBy)).toEqual({
      query: {
        _id: [PROD_CLUSTER_ID, STAGING_CLUSTER_ID, SANDBOX_CLUSTER_ID],
        projectId: PROJECT_ID,
      },
      select: { _id: true },
      limit: 3,
      skip: 0,
      props: {
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
        isMultiTenantRequest: false,
      },
    });
  });

  it("keeps the order given and matches ids whatever their case", async () => {
    findBy.mockResolvedValue([
      clusterRow(SANDBOX_CLUSTER_ID),
      clusterRow(PROD_CLUSTER_ID),
    ] as never);

    const viewable: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses: [
          clusterStatus(PROD_CLUSTER_ID.toUpperCase(), "prod-us"),
          clusterStatus(STAGING_CLUSTER_ID, "staging-us"),
          clusterStatus(SANDBOX_CLUSTER_ID, "sandbox"),
        ],
      });

    expect(
      viewable.map((status: KubernetesClusterAiAccessStatus): string => {
        return status.clusterName;
      }),
    ).toEqual(["prod-us", "sandbox"]);
    // One id, asked once, however it is written.
    expect(
      (readOf(findBy) as { query: { _id: Array<string> } }).query._id,
    ).toEqual([PROD_CLUSTER_ID, STAGING_CLUSTER_ID, SANDBOX_CLUSTER_ID]);
  });

  it("never offers, nor asks about, a status whose cluster id is not an id", async () => {
    const viewable: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses: [
          clusterStatus("not-a-cluster", "odd"),
          clusterStatus(STAGING_CLUSTER_ID, "staging-us"),
        ],
      });

    expect(
      viewable.map((status: KubernetesClusterAiAccessStatus): string => {
        return status.clusterName;
      }),
    ).toEqual(["staging-us"]);
    expect(
      (readOf(findBy) as { query: { _id: Array<string> } }).query._id,
    ).toEqual([STAGING_CLUSTER_ID]);
  });

  it("reads nothing for no statuses, or none with an id", async () => {
    expect(
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses: [],
      }),
    ).toEqual([]);
    expect(
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses: [clusterStatus("", "nameless")],
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  it.each([
    ["a refusal", new NotAuthorizedException("no read")],
    ["no session", new NotAuthenticatedException("signed out")],
    ["a missing record", new NotFoundException("gone")],
  ])(
    "%s of the read offers none, and is not logged as an error",
    async (_name: string, error: Error) => {
      findBy.mockRejectedValue(error as never);

      expect(
        await KubernetesClusterAiAccessService.getStatusesViewableBy({
          props: memberProps(),
          projectId: PROJECT_ID,
          statuses,
        }),
      ).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it("any other failure offers none too, and is logged", async () => {
    findBy.mockRejectedValue(new Error("database down") as never);

    expect(
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: memberProps(),
        projectId: PROJECT_ID,
        statuses,
      }),
    ).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]![0])).toContain("database down");
  });

  it.each([
    ["root", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ])(
    "%s views every cluster, and nothing is read",
    async (
      _name: string,
      overrides: Partial<DatabaseCommonInteractionProps>,
    ) => {
      expect(
        await KubernetesClusterAiAccessService.getStatusesViewableBy({
          props: memberProps(overrides),
          projectId: PROJECT_ID,
          statuses,
        }),
      ).toEqual(statuses);
      expect(findBy).not.toHaveBeenCalled();
    },
  );
});

describe("ResourceAiAccessService.getStatusesViewableBy", () => {
  let dockerFindBy: jest.SpyInstance;
  let hostFindBy: jest.SpyInstance;
  let logError: jest.SpyInstance;

  const statuses: Array<ResourceAiAccessStatus> = [
    resourceStatus(AiResourceType.DockerHost, PAYMENTS_HOST_ID),
    resourceStatus(AiResourceType.Host, DB_SERVER_HOST_ID),
    resourceStatus(AiResourceType.DockerHost, WEB_HOST_ID),
  ];

  beforeEach(() => {
    dockerFindBy = jest
      .spyOn(DockerHostService, "findBy")
      .mockResolvedValue([dockerHostRow(WEB_HOST_ID)] as never);
    hostFindBy = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([hostRow(DB_SERVER_HOST_ID)] as never);
    logError = jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  function ids(viewable: Array<ResourceAiAccessStatus>): Array<string> {
    return viewable.map((status: ResourceAiAccessStatus): string => {
      return status.resourceId;
    });
  }

  it("keeps the resources each kind's read returns, in the order given", async () => {
    expect(
      ids(
        await ResourceAiAccessService.getStatusesViewableBy({
          props: memberProps(),
          projectId: PROJECT_ID,
          statuses,
        }),
      ),
    ).toEqual([DB_SERVER_HOST_ID, WEB_HOST_ID]);
  });

  it("reads each kind once, as the caller, pinned to this project", async () => {
    await ResourceAiAccessService.getStatusesViewableBy({
      props: memberProps({
        tenantId: OTHER_PROJECT_ID,
        isMultiTenantRequest: true,
      }),
      projectId: PROJECT_ID,
      statuses,
    });

    const pinned: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      userType: UserType.User,
      tenantId: PROJECT_ID,
      isMultiTenantRequest: false,
    } as DatabaseCommonInteractionProps;

    expect(dockerFindBy).toHaveBeenCalledTimes(1);
    expect(readOf(dockerFindBy)).toEqual({
      query: {
        _id: [PAYMENTS_HOST_ID, WEB_HOST_ID],
        projectId: PROJECT_ID,
      },
      select: { _id: true },
      limit: 2,
      skip: 0,
      props: pinned,
    });
    expect(hostFindBy).toHaveBeenCalledTimes(1);
    expect(readOf(hostFindBy)).toEqual({
      query: {
        _id: [DB_SERVER_HOST_ID],
        projectId: PROJECT_ID,
      },
      select: { _id: true },
      limit: 1,
      skip: 0,
      props: pinned,
    });
  });

  it("a refusal for one kind leaves the other kinds as they are", async () => {
    dockerFindBy.mockRejectedValue(new NotAuthorizedException("no") as never);

    expect(
      ids(
        await ResourceAiAccessService.getStatusesViewableBy({
          props: memberProps(),
          projectId: PROJECT_ID,
          statuses,
        }),
      ),
    ).toEqual([DB_SERVER_HOST_ID]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("any other failure offers none of that kind, and is logged", async () => {
    hostFindBy.mockRejectedValue(new Error("database down") as never);

    expect(
      ids(
        await ResourceAiAccessService.getStatusesViewableBy({
          props: memberProps(),
          projectId: PROJECT_ID,
          statuses,
        }),
      ),
    ).toEqual([WEB_HOST_ID]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]![0])).toContain("database down");
  });

  it("never offers, nor asks about, a status that is not a resource kind or has no id", async () => {
    expect(
      ids(
        await ResourceAiAccessService.getStatusesViewableBy({
          props: memberProps(),
          projectId: PROJECT_ID,
          statuses: [
            resourceStatus(
              "Mainframe" as unknown as AiResourceType,
              PAYMENTS_HOST_ID,
            ),
            resourceStatus(AiResourceType.DockerHost, "not-a-host"),
            resourceStatus(AiResourceType.DockerHost, WEB_HOST_ID),
          ],
        }),
      ),
    ).toEqual([WEB_HOST_ID]);
    expect(
      (readOf(dockerFindBy) as { query: { _id: Array<string> } }).query._id,
    ).toEqual([WEB_HOST_ID]);
    expect(hostFindBy).not.toHaveBeenCalled();
  });

  it.each([
    ["root", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ])(
    "%s views every resource, and nothing is read",
    async (
      _name: string,
      overrides: Partial<DatabaseCommonInteractionProps>,
    ) => {
      expect(
        await ResourceAiAccessService.getStatusesViewableBy({
          props: memberProps(overrides),
          projectId: PROJECT_ID,
          statuses,
        }),
      ).toEqual(statuses);
      expect(dockerFindBy).not.toHaveBeenCalled();
      expect(hostFindBy).not.toHaveBeenCalled();
    },
  );
});
