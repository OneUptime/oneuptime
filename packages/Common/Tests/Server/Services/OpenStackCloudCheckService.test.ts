import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "../../../Models/DatabaseModels/OpenStackCloudCheck";
import Probe from "../../../Models/DatabaseModels/Probe";
import { Service as OpenStackCloudCheckServiceType } from "../../../Server/Services/OpenStackCloudCheckService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";

/*
 * A cloud's checks, through the service: the rules are OpenStackCheckSettings' and have their own
 * suite. This holds the service to asking the right rows. The cloud is read within the check's own
 * project, the probe is held to what may hold a cloud's credential, and another project's of either
 * is answered like one that does not exist.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CLOUD_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<OpenStackCloudCheck>,
  ) => Promise<OnCreate<OpenStackCloudCheck>>;
  getRelationsCheckedByService: () => Array<string>;
};

function createByOf(data: Partial<OpenStackCloudCheck>): CreateBy<OpenStackCloudCheck> {
  const model: OpenStackCloudCheck = new OpenStackCloudCheck();

  Object.assign(model, data);

  return {
    data: model,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<OpenStackCloudCheck>;
}

function cloudOf(projectId: ObjectID = PROJECT_ID): OpenStackCloud {
  const cloud: OpenStackCloud = new OpenStackCloud();

  cloud.projectId = projectId;
  cloud.collectionMethod = OpenStackCollectionMethod.Probe;
  cloud.authUrl = "https://keystone.example.com:5000";
  cloud.endpointInterface = "public";
  cloud.collectionRegions = ["RegionOne"];
  cloud.trustedCertificateFingerprints = [];
  cloud.collectionProbeId = PROBE_ID;
  cloud.isCredentialSet = true;

  return cloud;
}

function probeOf(projectId: ObjectID = PROJECT_ID): Probe {
  const probe: Probe = new Probe();

  probe.projectId = projectId;
  probe.isGlobalProbe = false;

  return probe;
}

describe("OpenStackCloudCheckService", () => {
  let service: OpenStackCloudCheckServiceType;
  let internals: ServiceInternals;

  beforeEach(() => {
    service = new OpenStackCloudCheckServiceType();
    internals = service as unknown as ServiceInternals;

    jest.spyOn(service, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue(cloudOf());
    jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probeOf());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the probe and the cloud are checked here, and not by the generic check", () => {
    expect(internals.getRelationsCheckedByService()).toEqual([
      "probe",
      "openStackCloud",
    ]);
  });

  test("turns on with one click on a cloud a probe collects, and says when it is next due", async () => {
    const created: OnCreate<OpenStackCloudCheck> =
      await internals.onBeforeCreate(
        createByOf({ openStackCloudId: CLOUD_ID, isApiCheckEnabled: true }),
      );

    expect(
      (created.carryForward as { serverColumns: Record<string, unknown> })
        .serverColumns["nextApiCheckAt"],
    ).toBeInstanceOf(Date);
  });

  test("a cloud of another project is answered like one that does not exist", async () => {
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue(cloudOf(OTHER_PROJECT_ID));

    await expect(
      internals.onBeforeCreate(
        createByOf({ openStackCloudId: CLOUD_ID, isApiCheckEnabled: true }),
      ),
    ).rejects.toThrow(new BadDataException("OpenStack cloud not found."));
  });

  test("a cloud that is not there is answered the same", async () => {
    jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue(null);

    await expect(
      internals.onBeforeCreate(
        createByOf({ openStackCloudId: CLOUD_ID, isApiCheckEnabled: true }),
      ),
    ).rejects.toThrow(new BadDataException("OpenStack cloud not found."));
  });

  test("a probe of another project may not hold this cloud's credential", async () => {
    jest
      .spyOn(ProbeService, "findOneById")
      .mockResolvedValue(probeOf(OTHER_PROJECT_ID));

    await expect(
      internals.onBeforeCreate(
        createByOf({
          openStackCloudId: CLOUD_ID,
          probeId: PROBE_ID,
          isApiCheckEnabled: true,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("a cloud has one row of these", async () => {
    jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(new OpenStackCloudCheck());

    await expect(
      internals.onBeforeCreate(
        createByOf({ openStackCloudId: CLOUD_ID, isApiCheckEnabled: true }),
      ),
    ).rejects.toThrow("has its checks already");
  });

  test("it has to say which cloud", async () => {
    await expect(
      internals.onBeforeCreate(createByOf({ isApiCheckEnabled: true })),
    ).rejects.toThrow("Say which OpenStack cloud");
  });

  test("the rules are the rules: a lifecycle check needs a credential of its own", async () => {
    await expect(
      internals.onBeforeCreate(
        createByOf({
          openStackCloudId: CLOUD_ID,
          isLifecycleCheckEnabled: true,
          lifecycleProjectName: "oneuptime-checks",
        }),
      ),
    ).rejects.toThrow("credential of its own");
  });
});
