import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - a status page lists a monitor once.
 *
 * Nothing used to stop a second resource being created for a monitor that was
 * already on the page. Selecting monitors by label re-selects every monitor
 * carrying that label, so re-adding a label after one new monitor joined it
 * wrote a duplicate resource for every monitor already there, and the public
 * page listed each of them twice (issue #3420).
 *
 * The rule engine has always refused to add a monitor that is already on the
 * page for exactly this reason. These cases pin the same promise onto the
 * service, which is the one thing every other way of creating a resource -
 * the resource form, the bulk add modal, the API - has to go through.
 *
 * Two properties matter and both are asserted from each write path:
 *
 *   1. the duplicate is judged per STATUS PAGE, not per group: a monitor in
 *      two groups is still a monitor a visitor sees twice;
 *
 *   2. the resource being edited is never a duplicate of itself, or saving
 *      the edit form without changing the monitor would start failing.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GROUP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_GROUP_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const MONITOR_GROUP_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const DUPLICATE_MONITOR_MESSAGE: string =
  "This monitor is already added to this status page. A monitor can only be added once so it is not shown twice to your customers.";
const DUPLICATE_MONITOR_GROUP_MESSAGE: string =
  "This monitor group is already added to this status page. A monitor group can only be added once so it is not shown twice to your customers.";

function resourceId(index: number): ObjectID {
  const suffix: string = index.toString().padStart(12, "0");
  return new ObjectID(`aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`);
}

function makeResource(data: {
  id: ObjectID;
  statusPageId?: ObjectID | undefined;
  statusPageGroupId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  monitorGroupId?: ObjectID | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id.toString();
  resource.projectId = PROJECT_ID;
  resource.statusPageId = data.statusPageId || STATUS_PAGE_ID;

  if (data.statusPageGroupId) {
    resource.statusPageGroupId = data.statusPageGroupId;
  }

  if (data.monitorId) {
    resource.monitorId = data.monitorId;
  }

  if (data.monitorGroupId) {
    resource.monitorGroupId = data.monitorGroupId;
  }

  return resource;
}

/*
 * `QueryHelper.notEquals` is a TypeORM Raw operator: the id it excludes lives
 * in the bound parameter bag rather than on the query object, so the fake
 * reads it back out the same way QueryHelper's own tests do.
 */
function getExcludedId(value: unknown): string | null {
  const parameters: Record<string, unknown> | undefined = (
    value as { objectLiteralParameters?: Record<string, unknown> } | undefined
  )?.objectLiteralParameters;

  if (!parameters) {
    return null;
  }

  const values: Array<unknown> = Object.values(parameters);

  return values.length > 0 ? String(values[0]) : null;
}

function getDirectId(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  return null;
}

/*
 * Stands in for the resources table. findOneBy answers the two reads the hooks
 * make - "is this monitor already on the page" and "which resource is being
 * updated" - and the order bookkeeping is stubbed so these cases only exercise
 * the duplicate rules.
 */
function mockService(rows: Array<StatusPageResource>): {
  findOneBy: jest.SpiedFunction<typeof StatusPageResourceService.findOneBy>;
  countBy: jest.SpiedFunction<typeof StatusPageResourceService.countBy>;
  updateOneBy: jest.SpiedFunction<typeof StatusPageResourceService.updateOneBy>;
} {
  const findOneBy: any = jest
    .spyOn(StatusPageResourceService, "findOneBy")
    .mockImplementation(async (findBy: any) => {
      const query: any = findBy.query || {};
      const directId: string | null = getDirectId(query._id);
      const excludedId: string | null = getExcludedId(query._id);

      const match: StatusPageResource | undefined = rows.find(
        (row: StatusPageResource) => {
          if (directId && row._id !== directId) {
            return false;
          }

          if (excludedId && row._id === excludedId) {
            return false;
          }

          if (
            query.statusPageId &&
            row.statusPageId?.toString() !== query.statusPageId.toString()
          ) {
            return false;
          }

          if (
            query.monitorId &&
            row.monitorId?.toString() !== query.monitorId.toString()
          ) {
            return false;
          }

          if (
            query.monitorGroupId &&
            row.monitorGroupId?.toString() !== query.monitorGroupId.toString()
          ) {
            return false;
          }

          return true;
        },
      );

      return match || null;
    });

  const countBy: any = jest
    .spyOn(StatusPageResourceService, "countBy")
    .mockResolvedValue(new PositiveNumber(rows.length) as never);

  jest
    .spyOn(StatusPageResourceService, "findBy")
    .mockResolvedValue([] as never);

  const updateOneBy: any = jest
    .spyOn(StatusPageResourceService, "updateOneBy")
    .mockResolvedValue(1 as never);

  return { findOneBy, countBy, updateOneBy };
}

function createBy(data: {
  statusPageId?: ObjectID | undefined;
  omitStatusPageId?: boolean | undefined;
  statusPageGroupId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  monitor?: ObjectID | undefined;
  monitorGroupId?: ObjectID | undefined;
  monitorGroup?: ObjectID | undefined;
}): CreateBy<StatusPageResource> {
  const resource: StatusPageResource = new StatusPageResource();
  resource.projectId = PROJECT_ID;
  resource.displayName = "New Resource";

  if (!data.omitStatusPageId) {
    resource.statusPageId = data.statusPageId || STATUS_PAGE_ID;
  }

  if (data.statusPageGroupId) {
    resource.statusPageGroupId = data.statusPageGroupId;
  }

  if (data.monitorId) {
    resource.monitorId = data.monitorId;
  }

  if (data.monitor) {
    const monitor: Monitor = new Monitor();
    monitor._id = data.monitor.toString();
    resource.monitor = monitor;
  }

  if (data.monitorGroupId) {
    resource.monitorGroupId = data.monitorGroupId;
  }

  if (data.monitorGroup) {
    const monitorGroup: MonitorGroup = new MonitorGroup();
    monitorGroup._id = data.monitorGroup.toString();
    resource.monitorGroup = monitorGroup;
  }

  return {
    data: resource,
    props: { isRoot: true },
  } as CreateBy<StatusPageResource>;
}

/*
 * The update body is NOT a model. BaseAPI.updateItem builds it with
 * JSONFunctions.deserialize, which revives ObjectID values but never nested
 * models - so a relation the dashboard posts arrives as the plain
 * `{ _id: "<uuid>" }` the browser sent, with no `id` on it. Building these
 * fixtures as `new Monitor()` instead is what let an earlier version of the
 * guard read nothing on every edit-form save and still pass its tests.
 */
function updateBy(data: {
  id?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  monitor?: ObjectID | undefined;
  monitorGroupId?: ObjectID | undefined;
  monitorGroup?: ObjectID | undefined;
  displayName?: string | undefined;
}): UpdateBy<StatusPageResource> {
  const updateData: Record<string, unknown> = {};

  if (data.monitorId) {
    updateData["monitorId"] = data.monitorId;
  }

  if (data.monitor) {
    updateData["monitor"] = { _id: data.monitor.toString() };
  }

  if (data.monitorGroupId) {
    updateData["monitorGroupId"] = data.monitorGroupId;
  }

  if (data.monitorGroup) {
    updateData["monitorGroup"] = { _id: data.monitorGroup.toString() };
  }

  if (data.displayName) {
    updateData["displayName"] = data.displayName;
  }

  return {
    query: data.id ? { _id: data.id.toString() } : {},
    data: updateData,
    props: { isRoot: true },
  } as unknown as UpdateBy<StatusPageResource>;
}

type OnBeforeCreateFunction = (
  createBy: CreateBy<StatusPageResource>,
) => Promise<unknown>;

const onBeforeCreate: OnBeforeCreateFunction = (
  by: CreateBy<StatusPageResource>,
): Promise<unknown> => {
  return (StatusPageResourceService as any).onBeforeCreate(by);
};

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<StatusPageResource>,
) => Promise<unknown>;

const onBeforeUpdate: OnBeforeUpdateFunction = (
  by: UpdateBy<StatusPageResource>,
): Promise<unknown> => {
  return (StatusPageResourceService as any).onBeforeUpdate(by);
};

describe("StatusPageResourceService duplicate rules", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on create", () => {
    it("adds a monitor the status page does not list yet", async () => {
      mockService([]);

      await expect(
        onBeforeCreate(createBy({ monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();
    });

    it("refuses a second resource for a monitor already on the page", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        onBeforeCreate(createBy({ monitorId: MONITOR_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    /*
     * The reported bug: the monitors already in the group come back selected
     * when the label is picked again, and adding used to duplicate every one.
     */
    it("refuses re-adding a monitor to the same group it is already in", async () => {
      mockService([
        makeResource({
          id: resourceId(1),
          monitorId: MONITOR_ID,
          statusPageGroupId: GROUP_ID,
        }),
      ]);

      await expect(
        onBeforeCreate(
          createBy({ monitorId: MONITOR_ID, statusPageGroupId: GROUP_ID }),
        ),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    it("refuses a monitor that is on the page in a different group", async () => {
      mockService([
        makeResource({
          id: resourceId(1),
          monitorId: MONITOR_ID,
          statusPageGroupId: GROUP_ID,
        }),
      ]);

      await expect(
        onBeforeCreate(
          createBy({
            monitorId: MONITOR_ID,
            statusPageGroupId: OTHER_GROUP_ID,
          }),
        ),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    it("allows the same monitor on a different status page", async () => {
      mockService([
        makeResource({
          id: resourceId(1),
          statusPageId: OTHER_STATUS_PAGE_ID,
          monitorId: MONITOR_ID,
        }),
      ]);

      await expect(
        onBeforeCreate(createBy({ monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();
    });

    it("allows a different monitor onto a page that already has one", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        onBeforeCreate(createBy({ monitorId: OTHER_MONITOR_ID })),
      ).resolves.toBeDefined();
    });

    /*
     * The dashboard's resource form posts the relation rather than the foreign
     * key column, so the check has to read both or the single-add form keeps
     * writing duplicates.
     */
    it("resolves the monitor from the relation the resource form posts", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        onBeforeCreate(createBy({ monitor: MONITOR_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    it("refuses a second resource for a monitor group already on the page", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorGroupId: MONITOR_GROUP_ID }),
      ]);

      await expect(
        onBeforeCreate(createBy({ monitorGroupId: MONITOR_GROUP_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_GROUP_MESSAGE));
    });

    it("resolves the monitor group from the relation the resource form posts", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorGroupId: MONITOR_GROUP_ID }),
      ]);

      await expect(
        onBeforeCreate(createBy({ monitorGroup: MONITOR_GROUP_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_GROUP_MESSAGE));
    });

    it("does not treat a monitor group resource as a duplicate of a monitor", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorGroupId: MONITOR_GROUP_ID }),
      ]);

      await expect(
        onBeforeCreate(createBy({ monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();
    });

    it("looks for a duplicate by status page and monitor only", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([]);

      await onBeforeCreate(
        createBy({ monitorId: MONITOR_ID, statusPageGroupId: GROUP_ID }),
      );

      const duplicateLookup: any = (mocks.findOneBy.mock.calls[0] as any)[0];
      expect(duplicateLookup.query).toEqual({
        statusPageId: STATUS_PAGE_ID,
        monitorId: MONITOR_ID,
      });
      expect(duplicateLookup.props.isRoot).toBe(true);
    });

    it("does not look for a duplicate when the resource names neither", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([]);

      await onBeforeCreate(createBy({}));

      expect(mocks.findOneBy).not.toHaveBeenCalled();
    });

    it("refuses before it renumbers the group", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeCreate(createBy({ monitorId: MONITOR_ID })),
      ).rejects.toThrow(BadDataException);

      expect(mocks.countBy).not.toHaveBeenCalled();
      expect(mocks.updateOneBy).not.toHaveBeenCalled();
    });

    it("still requires a status page id", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([]);

      await expect(
        onBeforeCreate(
          createBy({
            omitStatusPageId: true,
            monitorId: MONITOR_ID,
          }),
        ),
      ).rejects.toThrow(
        new BadDataException("Status Page Resource statusPageId is required"),
      );

      expect(mocks.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe("on update", () => {
    it("refuses pointing a resource at a monitor the page already lists", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorId: OTHER_MONITOR_ID }),
        makeResource({ id: resourceId(2), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeUpdate(updateBy({ id: resourceId(1), monitorId: MONITOR_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    it("lets a resource keep the monitor it already has", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        onBeforeUpdate(updateBy({ id: resourceId(1), monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();
    });

    /*
     * The edit form is a ModelForm: it posts the monitor on every save, even
     * one that only renamed the row. Looking for a duplicate then would be
     * both wasted work and, on a page that already carries a duplicate from
     * before this rule existed, a refusal of a rename.
     */
    it("does not even look for a duplicate when the monitor is unchanged", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
      ]);

      await onBeforeUpdate(
        updateBy({
          id: resourceId(1),
          monitorId: MONITOR_ID,
          displayName: "Renamed",
        }),
      );

      // One read: the resource being updated. No duplicate lookup after it.
      expect(mocks.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        (mocks.findOneBy.mock.calls[0] as any)[0].query.monitorId,
      ).toBeUndefined();
    });

    it("still lets both rows of a pre-existing duplicate be renamed", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
        makeResource({ id: resourceId(2), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeUpdate(
          updateBy({
            id: resourceId(1),
            monitor: MONITOR_ID,
            displayName: "Renamed",
          }),
        ),
      ).resolves.toBeDefined();

      await expect(
        onBeforeUpdate(
          updateBy({
            id: resourceId(2),
            monitor: MONITOR_ID,
            displayName: "Renamed too",
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("looks for the duplicate by status page and the new monitor", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: OTHER_MONITOR_ID }),
      ]);

      await onBeforeUpdate(
        updateBy({ id: resourceId(1), monitor: MONITOR_ID }),
      );

      const duplicateLookup: any = (mocks.findOneBy.mock.calls[1] as any)[0];
      expect(duplicateLookup.query.statusPageId).toEqual(STATUS_PAGE_ID);
      expect(duplicateLookup.query.monitorId?.toString()).toBe(
        MONITOR_ID.toString(),
      );
      expect(getExcludedId(duplicateLookup.query._id)).toBe(
        resourceId(1).toString(),
      );
    });

    it("resolves the monitor from the relation the edit form posts", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorId: OTHER_MONITOR_ID }),
        makeResource({ id: resourceId(2), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeUpdate(updateBy({ id: resourceId(1), monitor: MONITOR_ID })),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_MESSAGE));
    });

    it("refuses pointing a resource at a monitor group the page already lists", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
        makeResource({ id: resourceId(2), monitorGroupId: MONITOR_GROUP_ID }),
      ]);

      await expect(
        onBeforeUpdate(
          updateBy({ id: resourceId(1), monitorGroupId: MONITOR_GROUP_ID }),
        ),
      ).rejects.toThrow(new BadDataException(DUPLICATE_MONITOR_GROUP_MESSAGE));
    });

    it("costs nothing when the update does not touch the monitor", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeUpdate(updateBy({ id: resourceId(1), displayName: "Renamed" })),
      ).resolves.toBeDefined();

      expect(mocks.findOneBy).not.toHaveBeenCalled();
    });

    it("skips the check when the update does not name a single resource", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
      ]);

      await expect(
        onBeforeUpdate(updateBy({ monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();

      expect(mocks.findOneBy).not.toHaveBeenCalled();
    });

    it("does nothing when the resource being updated has gone", async () => {
      mockService([]);

      await expect(
        onBeforeUpdate(updateBy({ id: resourceId(1), monitorId: MONITOR_ID })),
      ).resolves.toBeDefined();
    });
  });

  describe("isResourceAlreadyOnStatusPage", () => {
    it("reports a monitor that is on the page", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        StatusPageResourceService.isResourceAlreadyOnStatusPage({
          statusPageId: STATUS_PAGE_ID,
          monitorId: MONITOR_ID,
        }),
      ).resolves.toBe(true);
    });

    it("reports a monitor that is not on the page", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        StatusPageResourceService.isResourceAlreadyOnStatusPage({
          statusPageId: STATUS_PAGE_ID,
          monitorId: OTHER_MONITOR_ID,
        }),
      ).resolves.toBe(false);
    });

    it("does not count the resource it was told to exclude", async () => {
      mockService([makeResource({ id: resourceId(1), monitorId: MONITOR_ID })]);

      await expect(
        StatusPageResourceService.isResourceAlreadyOnStatusPage({
          statusPageId: STATUS_PAGE_ID,
          monitorId: MONITOR_ID,
          excludeResourceId: resourceId(1),
        }),
      ).resolves.toBe(false);
    });

    it("still reports a duplicate held by some other resource", async () => {
      mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
        makeResource({ id: resourceId(2), monitorId: MONITOR_ID }),
      ]);

      await expect(
        StatusPageResourceService.isResourceAlreadyOnStatusPage({
          statusPageId: STATUS_PAGE_ID,
          monitorId: MONITOR_ID,
          excludeResourceId: resourceId(1),
        }),
      ).resolves.toBe(true);
    });

    it("does not read anything when no monitor or monitor group is named", async () => {
      const mocks: ReturnType<typeof mockService> = mockService([
        makeResource({ id: resourceId(1), monitorId: MONITOR_ID }),
      ]);

      await expect(
        StatusPageResourceService.isResourceAlreadyOnStatusPage({
          statusPageId: STATUS_PAGE_ID,
        }),
      ).resolves.toBe(false);

      expect(mocks.findOneBy).not.toHaveBeenCalled();
    });
  });
});
