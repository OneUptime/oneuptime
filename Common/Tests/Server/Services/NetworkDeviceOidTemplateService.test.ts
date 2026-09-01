import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import { Service as NetworkDeviceOidTemplateServiceType } from "../../../Server/Services/NetworkDeviceOidTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import BadDataException from "../../../Types/Exception/BadDataException";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import { MAX_OIDS_PER_TEMPLATE } from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * An OID Collection Template is shared config: one bad row in it breaks every
 * device linked to it, not one device. Before this service existed nothing
 * validated an OID list anywhere in the product, so these hooks are the only
 * thing standing between a typo and a fleet that silently collects nothing.
 *
 * The delete guard matters for a different reason. The FK is ON DELETE SET
 * NULL, so deleting a template devices still use does not fail — it quietly
 * drops those devices back to their own (usually empty) lists on the next
 * poll, with nothing anywhere to say what happened.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDeviceOidTemplate>,
  ) => Promise<OnCreate<NetworkDeviceOidTemplate>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDeviceOidTemplate>,
  ) => Promise<OnUpdate<NetworkDeviceOidTemplate>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<NetworkDeviceOidTemplate>,
  ) => Promise<OnDelete<NetworkDeviceOidTemplate>>;
  findBy: jest.Mock;
};

function buildService(): {
  service: NetworkDeviceOidTemplateServiceType;
  internals: ServiceInternals;
} {
  const service: NetworkDeviceOidTemplateServiceType =
    new NetworkDeviceOidTemplateServiceType();

  const internals: ServiceInternals =
    service as unknown as ServiceInternals;

  return { service, internals };
}

function createBy(
  oids: Array<SnmpOid> | undefined,
): CreateBy<NetworkDeviceOidTemplate> {
  const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
  template.projectId = PROJECT_ID;
  template.name = "Cisco Catalyst 9300";

  if (oids !== undefined) {
    template.oids = oids;
  }

  return {
    data: template,
    props: { isRoot: true },
  } as CreateBy<NetworkDeviceOidTemplate>;
}

function updateBy(
  oids: Array<SnmpOid> | undefined,
): UpdateBy<NetworkDeviceOidTemplate> {
  return {
    query: { _id: TEMPLATE_ID.toString() },
    data: oids === undefined ? {} : { oids: oids },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDeviceOidTemplate>;
}

describe("NetworkDeviceOidTemplateService write validation", () => {
  test("normalizes every OID on create, so criteria can compare with equality", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkDeviceOidTemplate> =
      await internals.onBeforeCreate(
        createBy([
          { oid: ".1.3.6.1.4.1.9.1", name: "cpu" },
          { oid: "  1.3.6.1.4.1.9.2  ", name: "memory" },
        ]),
      );

    expect(result.createBy.data.oids).toEqual([
      { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
      { oid: "1.3.6.1.4.1.9.2", name: "memory" },
    ]);
  });

  test("refuses a malformed OID and names it", async () => {
    const { internals } = buildService();

    await expect(
      internals.onBeforeCreate(createBy([{ oid: "sysUpTime.0" }])),
    ).rejects.toThrow(BadDataException);

    await expect(
      internals.onBeforeCreate(createBy([{ oid: "sysUpTime.0" }])),
    ).rejects.toThrow(/"sysUpTime.0" is not a numeric OID/);
  });

  /*
   * Blank rows are what the editor's "Add OID" button leaves behind for a
   * click somebody thought better of. Refusing them would turn a stray click
   * into an unsaveable form.
   */
  test("drops blank rows rather than refusing the save", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkDeviceOidTemplate> =
      await internals.onBeforeCreate(
        createBy([
          { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
          { oid: "", name: "", description: "" },
        ]),
      );

    expect(result.createBy.data.oids).toHaveLength(1);
  });

  test("collapses a duplicate, comparing normalized forms", async () => {
    const { internals } = buildService();

    const result: OnCreate<NetworkDeviceOidTemplate> =
      await internals.onBeforeCreate(
        createBy([
          { oid: "1.3.6.1.4.1.9.1", name: "first" },
          { oid: ".1.3.6.1.4.1.9.1", name: "second" },
        ]),
      );

    expect(result.createBy.data.oids).toHaveLength(1);
    expect(result.createBy.data.oids![0]!.name).toBe("first");
  });

  test("refuses a list over the per-template cap", async () => {
    const { internals } = buildService();

    const tooMany: Array<SnmpOid> = Array.from(
      { length: MAX_OIDS_PER_TEMPLATE + 1 },
      (_unused: unknown, index: number) => {
        return { oid: `1.3.6.1.4.1.${index}` };
      },
    );

    await expect(
      internals.onBeforeCreate(createBy(tooMany)),
    ).rejects.toThrow(
      new RegExp(`more than the limit of ${MAX_OIDS_PER_TEMPLATE}`),
    );
  });

  test("validates on update too", async () => {
    const { internals } = buildService();

    await expect(
      internals.onBeforeUpdate(updateBy([{ oid: "not-an-oid" }])),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * An explicit empty array is a legitimate "this template collects nothing"
   * edit, which is why the hook guards on the key being present rather than
   * on truthiness.
   */
  test("accepts an explicit empty list as a deliberate edit", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkDeviceOidTemplate> =
      await internals.onBeforeUpdate(updateBy([]));

    expect(result.updateBy.data.oids).toEqual([]);
  });

  test("leaves an update that does not touch oids alone", async () => {
    const { internals } = buildService();

    const result: OnUpdate<NetworkDeviceOidTemplate> =
      await internals.onBeforeUpdate(updateBy(undefined));

    expect(result.updateBy.data.oids).toBeUndefined();
  });
});

describe("NetworkDeviceOidTemplateService delete guard", () => {
  /*
   * Typed loosely on purpose: jest.spyOn's SpiedFunction and this repo's
   * @types/jest disagree about the optionality of mock.lastCall, and the
   * assertion below only reads mock.calls.
   */
  let countBySpy: {
    mockResolvedValue: (value: never) => unknown;
    mock: { calls: Array<Array<unknown>> };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    countBySpy = jest.spyOn(
      NetworkDeviceService,
      "countBy",
    ) as unknown as typeof countBySpy;
  });

  function templateBeingDeleted(): NetworkDeviceOidTemplate {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
      TEMPLATE_ID,
    );
    template.projectId = PROJECT_ID;
    template.name = "Cisco Catalyst 9300";
    return template;
  }

  function deleteBy(): DeleteBy<NetworkDeviceOidTemplate> {
    return {
      query: { _id: TEMPLATE_ID.toString() },
      props: { isRoot: true },
    } as unknown as DeleteBy<NetworkDeviceOidTemplate>;
  }

  test("refuses to delete a template devices are still using, and says how many", async () => {
    const { service, internals } = buildService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([templateBeingDeleted()] as never);
    countBySpy.mockResolvedValue(new PositiveNumber(42) as never);

    await expect(internals.onBeforeDelete(deleteBy())).rejects.toThrow(
      /still used by 42 network device\(s\)/,
    );
  });

  test("names the template in the refusal, so the operator knows which one", async () => {
    const { service, internals } = buildService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([templateBeingDeleted()] as never);
    countBySpy.mockResolvedValue(new PositiveNumber(1) as never);

    await expect(internals.onBeforeDelete(deleteBy())).rejects.toThrow(
      /Cisco Catalyst 9300/,
    );
  });

  test("allows the delete when nothing is linked", async () => {
    const { service, internals } = buildService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([templateBeingDeleted()] as never);
    countBySpy.mockResolvedValue(new PositiveNumber(0) as never);

    await expect(internals.onBeforeDelete(deleteBy())).resolves.toBeDefined();
  });

  /*
   * The count must be scoped to the template's own project. A root countBy
   * that forgot projectId would block a delete on the strength of another
   * tenant's devices.
   */
  test("counts only devices in the template's own project", async () => {
    const { service, internals } = buildService();

    jest
      .spyOn(service, "findBy")
      .mockResolvedValue([templateBeingDeleted()] as never);
    countBySpy.mockResolvedValue(new PositiveNumber(0) as never);

    await internals.onBeforeDelete(deleteBy());

    expect(countBySpy.mock.calls).toHaveLength(1);
    const countArgs: {
      query: { projectId?: ObjectID; oidTemplateId?: ObjectID };
    } = countBySpy.mock.calls[0]![0] as unknown as {
      query: { projectId?: ObjectID; oidTemplateId?: ObjectID };
    };

    expect(countArgs.query.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(countArgs.query.oidTemplateId?.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
  });
});
