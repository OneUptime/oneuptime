import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import KubernetesCluster from "../../../../../Models/DatabaseModels/KubernetesCluster";
import ReadAudiencePermission from "../../../../../Server/Types/Database/Permissions/ReadAudiencePermission";
import RemediationReadAudience from "../../../../../Server/Utils/AI/Remediation/RemediationReadAudience";
import ReadAudienceReader, {
  ReadAudienceSubject,
} from "../../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  keptForAudience,
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";

/*
 * WHO READS WHAT A FIX POSTS (#9612). A fix's plan, reasoning and outcome
 * are posted where everyone who may see its incident or alert reads them,
 * so a fix reads as an investigation does - for the subject's readers - and
 * names what it acts on beside what the subject names itself: its cluster
 * or resource, the Runners and runbooks its AI rule names. Named, a target
 * is read whoever owns it and whatever labels it carries; a fix is never
 * refused for acting on it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CLUSTER_ID: string = "44444444-4444-4444-8444-44444444444A";
const RUNNER_ID: string = "55555555-5555-4555-8555-555555555555";
const RUNBOOK_ID: string = "66666666-6666-4666-8666-666666666666";
const RESOURCE_ID: string = "77777777-7777-4777-8777-77777777777B";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a fix acts on, by model name", () => {
  test("its cluster, Runners and runbooks, lower case and each once", () => {
    expect(
      RemediationReadAudience.getNamedTargets({
        kubernetesClusterIds: [CLUSTER_ID, CLUSTER_ID.toLowerCase()],
        runnerIds: [new ObjectID(RUNNER_ID)],
        runbookIds: [RUNBOOK_ID],
      }),
    ).toEqual({
      KubernetesCluster: [CLUSTER_ID.toLowerCase()],
      Runbook: [RUNBOOK_ID],
      Runner: [RUNNER_ID],
    });
  });

  test("a resource round's resource, under its own model", () => {
    const expected: Record<AiResourceType, string> = {
      [AiResourceType.DockerHost]: "DockerHost",
      [AiResourceType.PodmanHost]: "PodmanHost",
      [AiResourceType.DockerSwarmCluster]: "DockerSwarmCluster",
      [AiResourceType.ProxmoxCluster]: "ProxmoxCluster",
      [AiResourceType.VMwareVCenter]: "VMwareVCenter",
      [AiResourceType.CephCluster]: "CephCluster",
      [AiResourceType.DatabaseServer]: "DatabaseServer",
      [AiResourceType.Host]: "Host",
      [AiResourceType.AwsAccount]: "CloudAccount",
      [AiResourceType.AzureSubscription]: "CloudAccount",
      [AiResourceType.GoogleCloudProject]: "CloudAccount",
      [AiResourceType.OpenStackCloud]: "OpenStackCloud",
    };

    for (const [resourceType, kind] of Object.entries(expected)) {
      expect({
        resourceType,
        named: RemediationReadAudience.getNamedTargets({
          resource: { resourceType, resourceId: RESOURCE_ID },
        }),
      }).toEqual({
        resourceType,
        named: { [kind]: [RESOURCE_ID.toLowerCase()] },
      });
    }
  });

  test("a resource of a type OneUptime does not know, or no id, names nothing", () => {
    expect(
      RemediationReadAudience.getNamedTargets({
        resource: { resourceType: "Mainframe", resourceId: RESOURCE_ID },
      }),
    ).toEqual({});
    expect(
      RemediationReadAudience.getNamedTargets({
        resource: {
          resourceType: AiResourceType.DockerHost,
          resourceId: undefined,
        },
        kubernetesClusterIds: [""],
      }),
    ).toEqual({});
  });

  test("nothing to act on names nothing", () => {
    expect(RemediationReadAudience.getNamedTargets({})).toEqual({});
  });
});

describe("the readers of a fix", () => {
  let subjects: Array<ReadAudienceSubject>;

  beforeEach(() => {
    subjects = [];
    jest
      .spyOn(ReadAudienceReader, "forSubject")
      .mockImplementation(
        async (subject: ReadAudienceSubject): Promise<ReadAudience> => {
          subjects.push(subject);
          return readAudienceOf({ projectId: subject.projectId });
        },
      );
  });

  test("are its incident's readers, with what it acts on named", async () => {
    await RemediationReadAudience.forFix({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      targets: { kubernetesClusterIds: [CLUSTER_ID] },
    });

    expect(subjects).toEqual([
      {
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: undefined,
        targets: { KubernetesCluster: [CLUSTER_ID.toLowerCase()] },
      },
    ]);
  });

  test("are its alert's readers for an alert's fix, and a fix that acts on nothing named names nothing more", async () => {
    await RemediationReadAudience.forFix({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });

    expect(subjects).toEqual([
      {
        projectId: PROJECT_ID,
        incidentId: undefined,
        alertId: ALERT_ID,
        targets: {},
      },
    ]);
  });

  test("a cluster set apart that the fix acts on is still read: it is named; another set apart is not", () => {
    const OTHER_CLUSTER_ID: string = "88888888-8888-4888-8888-888888888888";
    const narrowed: ReadAudience = readAudienceOf({
      projectId: PROJECT_ID,
      ownedOnlyPermissions: [Permission.ProjectMember],
      named: RemediationReadAudience.getNamedTargets({
        kubernetesClusterIds: [CLUSTER_ID],
      }),
    });

    expect(
      ReadAudiencePermission.isNarrowedByOwners(KubernetesCluster, narrowed),
    ).toBe(true);
    expect(
      ReadAudiencePermission.isNamed(KubernetesCluster, CLUSTER_ID, narrowed),
    ).toBe(true);
    // Both owned by somebody: the read keeps the fix's own, and only it.
    expect(
      keptForAudience({
        modelType: KubernetesCluster,
        rows: [
          new KubernetesCluster(new ObjectID(CLUSTER_ID)),
          new KubernetesCluster(new ObjectID(OTHER_CLUSTER_ID)),
        ],
        props: readAudienceProps(narrowed),
        setApartIds: [CLUSTER_ID, OTHER_CLUSTER_ID],
      }).map((row: KubernetesCluster): string => {
        return row.id!.toString().toLowerCase();
      }),
    ).toEqual([CLUSTER_ID.toLowerCase()]);
  });

  test("readers that cannot be read stop the fix: it is retried, never run as OneUptime", async () => {
    jest
      .spyOn(ReadAudienceReader, "forSubject")
      .mockRejectedValue(new Error("database down"));

    await expect(
      RemediationReadAudience.forFix({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).rejects.toThrow("database down");
  });
});
