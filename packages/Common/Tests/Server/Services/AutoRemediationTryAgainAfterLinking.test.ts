import AutoRemediationRuleEngineService, {
  doesWriteRemediationLinks,
  isLinkedToNothing,
  REMEDIATION_LINK_COLUMNS,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
} from "../../../Types/AI/AiAffectedResources";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * LINKING AN INCIDENT OR ALERT TO WHAT IT IS ABOUT MAKES ONEUPTIME AI TRY
 * AGAIN (#5293).
 *
 * The Remediation card of an incident linked to nothing says: add the
 * host, cluster or database it is about under Affected Resources, and
 * OneUptime AI tries again. These tests hold that promise, and its limits:
 *
 *   - an update that writes one of the lists a fix reads (its clusters, its
 *     resources with an AI agent, its monitors) asks the engine; any other
 *     update - a title, a severity - asks nothing;
 *   - the engine tries again only when its latest evaluation found the
 *     subject linked to nothing, the subject is open, and it is now linked
 *     to a cluster or resource a fix can reach - every gate of a new
 *     incident deciding after that, as before;
 *   - it is serialized per subject and decided again inside the lock, so
 *     two edits made together evaluate once; without the lock it does not
 *     try at all; and it never throws into the edit.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const HOST_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const LINKED_TO_NOTHING: Array<AutoRemediationDecisionEntry> = [
  {
    lane: AutoRemediationDecisionLane.KubernetesCluster,
    reason: AutoRemediationDecisionReason.ClusterNoneLinked,
  },
  {
    lane: AutoRemediationDecisionLane.Resource,
    reason: AutoRemediationDecisionReason.ResourceNoneLinked,
  },
];

function decision(
  entries: Array<AutoRemediationDecisionEntry>,
): AutoRemediationDecision {
  const row: AutoRemediationDecision = new AutoRemediationDecision();
  row.stage = AutoRemediationDecisionStage.Evaluated;
  row.entries = entries as unknown as JSONArray;
  return row;
}

interface Spies {
  latestDecision: jest.SpiedFunction<
    typeof AutoRemediationDecisionService.findOneBy
  >;
  isIncidentResolved: jest.SpiedFunction<
    typeof IncidentService.isIncidentResolved
  >;
  isAlertResolved: jest.SpiedFunction<typeof AlertService.isAlertResolved>;
  clusters: jest.SpiedFunction<
    typeof KubernetesClusterAiAccessService.getClustersForSubject
  >;
  resources: jest.SpiedFunction<
    typeof ResourceAiAccessService.getResourcesForSubject
  >;
  lock: jest.SpiedFunction<typeof Semaphore.lock>;
  release: jest.SpiedFunction<typeof Semaphore.release>;
  applyToIncident: jest.SpiedFunction<
    typeof AutoRemediationRuleEngineService.applyRulesToIncidentById
  >;
  applyToAlert: jest.SpiedFunction<
    typeof AutoRemediationRuleEngineService.applyRulesToAlertById
  >;
}

function installSpies(data?: {
  latest?: AutoRemediationDecision | null;
  isResolved?: boolean;
  linkedClusters?: number;
  linkedResources?: number;
}): Spies {
  const latest: AutoRemediationDecision | null =
    data && Object.prototype.hasOwnProperty.call(data, "latest")
      ? data.latest!
      : decision(LINKED_TO_NOTHING);

  return {
    latestDecision: jest
      .spyOn(AutoRemediationDecisionService, "findOneBy")
      .mockResolvedValue(latest as never),
    isIncidentResolved: jest
      .spyOn(IncidentService, "isIncidentResolved")
      .mockResolvedValue((data?.isResolved ?? false) as never),
    isAlertResolved: jest
      .spyOn(AlertService, "isAlertResolved")
      .mockResolvedValue((data?.isResolved ?? false) as never),
    clusters: jest
      .spyOn(KubernetesClusterAiAccessService, "getClustersForSubject")
      .mockResolvedValue(
        Array.from({ length: data?.linkedClusters ?? 0 }, () => {
          return new KubernetesCluster();
        }) as never,
      ),
    resources: jest
      .spyOn(ResourceAiAccessService, "getResourcesForSubject")
      .mockResolvedValue(
        Array.from({ length: data?.linkedResources ?? 1 }, () => {
          return { resourceType: AiResourceType.Host, resourceId: HOST_ID };
        }) as never,
      ),
    lock: jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ identifier: "lock" } as never),
    release: jest.spyOn(Semaphore, "release").mockResolvedValue(undefined),
    applyToIncident: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockResolvedValue(undefined),
    applyToAlert: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which updates link something a fix acts on", () => {
  test("the lists a fix reads: clusters, the resources with an AI agent, and monitors", () => {
    expect([...REMEDIATION_LINK_COLUMNS].sort()).toEqual(
      [
        "kubernetesClusters",
        "hosts",
        "dockerHosts",
        "podmanHosts",
        "dockerSwarmClusters",
        "proxmoxClusters",
        "vmwareVCenters",
        "cephClusters",
        "databaseServers",
        "monitors",
        "monitor",
        "monitorId",
      ].sort(),
    );
  });

  test("every one of them is a reference of an incident or an alert", () => {
    for (const column of REMEDIATION_LINK_COLUMNS) {
      const isOnIncident: boolean = new Incident().hasColumn(column);
      const isOnAlert: boolean = new Alert().hasColumn(column);

      expect({ column, isReference: isOnIncident || isOnAlert }).toEqual({
        column,
        isReference: true,
      });
    }

    // The lists of what a fix acts on are lists on both.
    for (const info of AI_AFFECTED_RESOURCE_KINDS.filter(
      (kind: AiAffectedResourceKindInfo): boolean => {
        return kind.isFixedByOneUptimeAi;
      },
    )) {
      expect(new Incident().getTableColumnMetadata(info.relation).type).toBe(
        TableColumnType.EntityArray,
      );
      expect(new Alert().getTableColumnMetadata(info.relation).type).toBe(
        TableColumnType.EntityArray,
      );
    }
  });

  test.each([
    [{ hosts: [{ _id: HOST_ID }] }],
    [{ kubernetesClusters: [] }],
    [{ databaseServers: [{ _id: HOST_ID }] }],
    [{ monitors: [{ _id: HOST_ID }] }],
    [{ monitorId: HOST_ID }],
    [{ monitor: null }],
  ])("%j does", (data: JSONObject) => {
    expect(doesWriteRemediationLinks(data)).toBe(true);
  });

  test.each([
    [{ title: "Checkout down" }],
    [{ incidentSeverityId: HOST_ID }],
    [{ services: [{ _id: HOST_ID }] }],
    [{ storageArrays: [{ _id: HOST_ID }] }],
    [{ labels: [{ _id: HOST_ID }] }],
    [{ hosts: undefined }],
    [{}],
  ])("%j does not", (data: JSONObject) => {
    expect(doesWriteRemediationLinks(data)).toBe(false);
  });

  test("nothing that is not an object does", () => {
    expect(doesWriteRemediationLinks(undefined)).toBe(false);
    expect(doesWriteRemediationLinks(null)).toBe(false);
    expect(doesWriteRemediationLinks("hosts")).toBe(false);
  });
});

describe("an evaluation that found its subject linked to nothing", () => {
  test("needs both lanes to have found nothing", () => {
    expect(isLinkedToNothing(LINKED_TO_NOTHING)).toBe(true);
    expect(isLinkedToNothing([LINKED_TO_NOTHING[0]!])).toBe(false);
    expect(isLinkedToNothing([LINKED_TO_NOTHING[1]!])).toBe(false);
    expect(
      isLinkedToNothing([
        LINKED_TO_NOTHING[0]!,
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceFixesOff,
          resourceType: "Host",
          resourceId: HOST_ID,
          resourceName: "test01",
        },
      ]),
    ).toBe(false);
  });

  test("reads stored JSON defensively", () => {
    expect(isLinkedToNothing(undefined)).toBe(false);
    expect(isLinkedToNothing("ClusterNoneLinked")).toBe(false);
    expect(
      isLinkedToNothing([
        { lane: "KubernetesCluster", reason: "ClusterNoneLinked" },
        { lane: "Resource", reason: "ResourceNoneLinked" },
      ]),
    ).toBe(true);
  });
});

describe("an update hands its subject to the engine (onSubjectUpdated)", () => {
  test("linking a host to an incident found linked to nothing makes OneUptime AI try again", async () => {
    const spies: Spies = installSpies();

    const triedAgain: boolean =
      await AutoRemediationRuleEngineService.onSubjectUpdated({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        written: { hosts: [{ _id: HOST_ID }] },
      });

    expect(triedAgain).toBe(true);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });
    expect(spies.applyToAlert).not.toHaveBeenCalled();
  });

  test("an update that links nothing a fix acts on asks nothing at all", async () => {
    const spies: Spies = installSpies();

    const triedAgain: boolean =
      await AutoRemediationRuleEngineService.onSubjectUpdated({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        written: { title: "A clearer title" },
      });

    expect(triedAgain).toBe(false);
    expect(spies.latestDecision).not.toHaveBeenCalled();
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("an alert linked to a host tries the alert again", async () => {
    const spies: Spies = installSpies();

    await AutoRemediationRuleEngineService.onSubjectUpdated({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      written: { hosts: [{ _id: HOST_ID }] },
    });

    expect(spies.applyToAlert).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });
    expect(spies.applyToIncident).not.toHaveBeenCalled();

    // The alert's own resolved check, and its own decisions.
    expect(spies.isAlertResolved).toHaveBeenCalledWith({ alertId: ALERT_ID });
    const query: JSONObject = (
      spies.latestDecision.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(query["alertId"]).toBe(ALERT_ID);
    expect(query["incidentId"]).toBeUndefined();
  });
});

describe("when OneUptime AI tries again (onSubjectLinksChanged)", () => {
  test("it reads the subject's latest evaluation only, newest first, as OneUptime", async () => {
    const spies: Spies = installSpies();

    await AutoRemediationRuleEngineService.onSubjectLinksChanged({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    const read: {
      query: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    } = spies.latestDecision.mock.calls[0]![0] as unknown as {
      query: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    };
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.query["incidentId"]).toBe(INCIDENT_ID);
    // A wait for the investigation is never "the latest evaluation".
    expect(read.query["stage"]).toBe(AutoRemediationDecisionStage.Evaluated);
    expect(read.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("not when it was never evaluated: the investigation's hand-off reads the new links itself", async () => {
    const spies: Spies = installSpies({ latest: null });

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test.each([
    [
      "found a host with fixes off",
      [
        LINKED_TO_NOTHING[0]!,
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceFixesOff,
          resourceType: "Host",
          resourceId: HOST_ID,
          resourceName: "test01",
        },
      ],
    ],
    [
      "had fixing switched off",
      [
        {
          lane: AutoRemediationDecisionLane.Project,
          reason: AutoRemediationDecisionReason.RemediationOff,
        },
      ],
    ],
    [
      "started a fix",
      [
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceRoundStarted,
          resourceType: "Host",
          resourceId: HOST_ID,
          resourceName: "test01",
        },
      ],
    ],
  ] as Array<[string, Array<AutoRemediationDecisionEntry>]>)(
    "not when its latest evaluation %s - that card says why, and linking is not its next step",
    async (_found: string, entries: Array<AutoRemediationDecisionEntry>) => {
      const spies: Spies = installSpies({ latest: decision(entries) });

      expect(
        await AutoRemediationRuleEngineService.onSubjectLinksChanged({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        }),
      ).toBe(false);
      expect(spies.applyToIncident).not.toHaveBeenCalled();
      expect(spies.lock).not.toHaveBeenCalled();
    },
  );

  test("not once it is resolved", async () => {
    const spies: Spies = installSpies({ isResolved: true });

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("not while it is still linked to nothing a fix can reach (a service, a storage array)", async () => {
    const spies: Spies = installSpies({
      linkedClusters: 0,
      linkedResources: 0,
    });

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("a linked Kubernetes cluster is enough, without reading the resources", async () => {
    const spies: Spies = installSpies({
      linkedClusters: 1,
      linkedResources: 0,
    });

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(true);
    expect(spies.resources).not.toHaveBeenCalled();
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("serialized per subject: the lock names it, and is released after", async () => {
    const spies: Spies = installSpies();

    await AutoRemediationRuleEngineService.onSubjectLinksChanged({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    const lock: { key: string; namespace: string } = spies.lock.mock
      .calls[0]![0] as { key: string; namespace: string };
    expect(lock.key).toBe(
      `auto-remediation-relinked-${INCIDENT_ID.toString()}`,
    );
    expect(lock.namespace).toBe("AutoRemediationRuleEngine");
    expect(spies.release).toHaveBeenCalledTimes(1);
    expect(spies.release.mock.invocationCallOrder[0]!).toBeGreaterThan(
      spies.applyToIncident.mock.invocationCallOrder[0]!,
    );
  });

  test("decided again inside the lock: an edit that waited behind one that tried evaluates nothing", async () => {
    const spies: Spies = installSpies();
    // The first read says linked to nothing; by the time the lock is held,
    // the other edit's evaluation found the host.
    spies.latestDecision
      .mockResolvedValueOnce(decision(LINKED_TO_NOTHING) as never)
      .mockResolvedValueOnce(
        decision([
          {
            lane: AutoRemediationDecisionLane.Resource,
            reason: AutoRemediationDecisionReason.ResourceRoundStarted,
          },
        ]) as never,
      );

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    // The lock is still given back.
    expect(spies.release).toHaveBeenCalledTimes(1);
  });

  test("without the lock it does not try again, rather than risk two fixes at once", async () => {
    const spies: Spies = installSpies();
    spies.lock.mockRejectedValue(new Error("Redis client is not connected"));

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("never throws into the edit that linked it", async () => {
    const spies: Spies = installSpies();
    spies.latestDecision.mockRejectedValue(new Error("database is down"));

    await expect(
      AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toBe(false);

    const failing: Spies = installSpies();
    failing.applyToIncident.mockRejectedValue(new Error("engine failed"));

    await expect(
      AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toBe(false);
    // The lock is given back even then.
    expect(failing.release).toHaveBeenCalled();
  });

  test("a subject with neither id asks nothing", async () => {
    const spies: Spies = installSpies();

    expect(
      await AutoRemediationRuleEngineService.onSubjectLinksChanged({
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
    expect(spies.latestDecision).not.toHaveBeenCalled();
  });
});
