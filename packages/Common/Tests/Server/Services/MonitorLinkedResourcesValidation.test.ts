import MonitorService from "../../../Server/Services/MonitorService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ServiceService from "../../../Server/Services/ServiceService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * What a monitor is linked to is copied onto every incident and alert it
 * opens, where it puts the record on that resource's pages and hands
 * OneUptime AI a cluster or host to investigate and fix. So a monitor may
 * only be linked to its own project's resources: every id a create or an
 * update adds goes through the project check, once per project the write
 * touches, and a refusal refuses the write. Removing links (an empty list)
 * needs no check, and neither does a write that leaves the links alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CLUSTER_ID: string = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const SERVICE_ID: string = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";

type Validate = (data: {
  payload: unknown;
  getProjectIds: () => Promise<Array<ObjectID>>;
}) => Promise<void>;

const validate: Validate = (
  MonitorService as unknown as {
    validateLinkedResourcesBelongToProject: Validate;
  }
).validateLinkedResourcesBelongToProject.bind(MonitorService);

function projects(...ids: Array<ObjectID>): () => Promise<Array<ObjectID>> {
  return async (): Promise<Array<ObjectID>> => {
    return ids;
  };
}

describe("MonitorService links a monitor only to its own project's resources", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("checks every linked id against the monitor's project", async () => {
    const check: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);

    await validate({
      payload: {
        kubernetesClusters: [{ _id: CLUSTER_ID }],
        services: [SERVICE_ID],
        name: "Checkout website",
      },
      getProjectIds: projects(PROJECT_ID),
    });

    expect(check).toHaveBeenCalledTimes(1);
    const args: Parameters<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    >[0] = check.mock.calls[0]![0];
    expect(args.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(args.subject).toBe("monitor");

    const references: Array<{
      modelName: string;
      id: string;
      service: unknown;
    }> = args.references.map((reference: ProjectScopedReference) => {
      return {
        modelName: reference.modelName,
        id: String(reference.id),
        service: reference.service,
      };
    });

    expect(references).toEqual(
      expect.arrayContaining([
        {
          modelName: "Kubernetes Cluster",
          id: CLUSTER_ID,
          service: KubernetesClusterService,
        },
        { modelName: "Service", id: SERVICE_ID, service: ServiceService },
      ]),
    );
    expect(references).toHaveLength(2);
  });

  it("checks once per project a bulk update touches", async () => {
    const check: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);

    await validate({
      payload: { hosts: ["h0000000-0000-4000-8000-000000000001"] },
      getProjectIds: projects(PROJECT_ID, OTHER_PROJECT_ID),
    });

    expect(
      check.mock.calls.map(
        (
          call: Parameters<
            typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
          >,
        ) => {
          return call[0].projectId?.toString();
        },
      ),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  it("refuses the write when a linked resource is another project's", async () => {
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockRejectedValue(
        new BadDataException(
          "Kubernetes Cluster does not belong to this project.",
        ),
      );

    await expect(
      validate({
        payload: { kubernetesClusters: [CLUSTER_ID] },
        getProjectIds: projects(PROJECT_ID),
      }),
    ).rejects.toThrow("Kubernetes Cluster does not belong to this project.");
  });

  it("checks nothing, and reads no project, when the write leaves the links alone or only removes them", async () => {
    const check: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest.spyOn(
      ProjectScopedReferenceValidator,
      "validateReferencesBelongToProject",
    );
    const getProjectIds: Mock<() => Promise<Array<ObjectID>>> = jest.fn(
      projects(PROJECT_ID),
    );

    await validate({ payload: { name: "Renamed" }, getProjectIds });
    await validate({
      payload: { kubernetesClusters: [], services: [] },
      getProjectIds,
    });
    await validate({ payload: undefined, getProjectIds });

    expect(check).not.toHaveBeenCalled();
    expect(getProjectIds).not.toHaveBeenCalled();
  });

  it("does not treat a monitor's other relations as linked resources", async () => {
    const check: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest.spyOn(
      ProjectScopedReferenceValidator,
      "validateReferencesBelongToProject",
    );

    await validate({
      payload: {
        labels: ["l0000000-0000-4000-8000-000000000001"],
        dependsOnMonitors: ["m0000000-0000-4000-8000-000000000001"],
      },
      getProjectIds: projects(PROJECT_ID),
    });

    expect(check).not.toHaveBeenCalled();
  });
});
