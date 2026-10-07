import ExceptionInstanceService, {
  ExceptionInstanceService as ExceptionInstanceServiceClass,
} from "../../../Server/Services/ExceptionInstanceService";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import FindBy from "../../../Server/Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../../../Server/Types/AnalyticsDatabase/Hooks";
import { RealtimeReader } from "../../../Server/Utils/Realtime/RealtimeReadAccess";
import { TelemetryReadScope } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * Who may hear that a telemetry row was written: whoever its read lets read
 * it. A telemetry row is not looked up by id; the read is asked the way a
 * telemetry read applies it - the read check itself (table, a block with
 * no labels, the plan), then the caller's read scope (their label and Owned
 * grants, less what a block with labels takes away) against the resource
 * the row belongs to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const READABLE_SERVICE: string = "11111111-1111-4111-8111-111111111111";
const OTHER_SERVICE: string = "22222222-2222-4222-8222-222222222222";
const BLOCKED_SERVICE: string = "33333333-3333-4333-8333-333333333333";

function row(resourceId: string | null): ExceptionInstance {
  const item: ExceptionInstance = new ExceptionInstance();
  item.id = ObjectID.generate();
  item.projectId = PROJECT_ID;

  if (resourceId) {
    item.primaryEntityId = new ObjectID(resourceId);
  }

  return item;
}

function readerWith(
  props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  },
): RealtimeReader {
  const remembered: Map<string, Promise<unknown>> = new Map<
    string,
    Promise<unknown>
  >();

  return {
    key: "reader",
    props: props,
    remember: <T>(name: string, work: () => Promise<T>): Promise<T> => {
      if (!remembered.has(name)) {
        remembered.set(name, work());
      }

      return remembered.get(name) as Promise<T>;
    },
  };
}

function scope(
  readableIds: Array<string> | null,
  blockedIds: Array<string> = [],
): TelemetryReadScope {
  return { readableIds: readableIds, blockedIds: blockedIds };
}

function idsOf(items: Array<ExceptionInstance>): Array<ObjectID> {
  return items.map((item: ExceptionInstance): ObjectID => {
    return item.id!;
  });
}

function asText(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

describe("AnalyticsDatabaseService.getRealtimeReadAccess", () => {
  let checked: jest.SpyInstance;
  let scoped: jest.SpyInstance;

  function readsWith(readScope: TelemetryReadScope): void {
    checked = jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockResolvedValue({ query: {}, select: null });
    scoped = jest
      .spyOn(ModelPermission, "getReadScope")
      .mockResolvedValue(readScope);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a scope over every resource reads every row, with no row looked at", async () => {
    readsWith(scope(null));
    const items: Array<ExceptionInstance> = [row(READABLE_SERVICE), row(null)];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    await expect(access.readsEveryRecord(reader)).resolves.toBe(true);
    await expect(access.getReadableIds(reader, idsOf(items))).resolves.toEqual(
      asText(idsOf(items)),
    );
  });

  test("a scope limited to some resources reads the rows of those resources only", async () => {
    readsWith(scope([READABLE_SERVICE]));
    const readable: ExceptionInstance = row(READABLE_SERVICE);
    const other: ExceptionInstance = row(OTHER_SERVICE);
    const unattributed: ExceptionInstance = row(null);
    const items: Array<ExceptionInstance> = [readable, other, unattributed];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    await expect(access.readsEveryRecord(reader)).resolves.toBe(false);
    await expect(access.getReadableIds(reader, idsOf(items))).resolves.toEqual(
      [readable.id!.toString()],
    );
  });

  test("a block with labels takes its resources' rows away from a scope over every resource", async () => {
    readsWith(scope(null, [BLOCKED_SERVICE]));
    const readable: ExceptionInstance = row(READABLE_SERVICE);
    const blocked: ExceptionInstance = row(BLOCKED_SERVICE.toUpperCase());
    const unattributed: ExceptionInstance = row(null);
    const items: Array<ExceptionInstance> = [readable, blocked, unattributed];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    await expect(access.readsEveryRecord(reader)).resolves.toBe(false);
    await expect(access.getReadableIds(reader, idsOf(items))).resolves.toEqual(
      [readable.id!.toString(), unattributed.id!.toString()],
    );
  });

  test("a refused read reads no row at all", async () => {
    jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockRejectedValue(new NotAuthorizedException("Blocked"));
    scoped = jest.spyOn(ModelPermission, "getReadScope");
    const items: Array<ExceptionInstance> = [row(READABLE_SERVICE)];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    await expect(access.readsEveryRecord(reader)).resolves.toBe(false);
    await expect(access.getReadableIds(reader, idsOf(items))).resolves.toEqual(
      [],
    );
    expect(scoped).not.toHaveBeenCalled();
  });

  test("the read is asked with the reader's props, and worked out once for them", async () => {
    readsWith(scope([READABLE_SERVICE]));
    const props: DatabaseCommonInteractionProps = {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
    };
    const reader: RealtimeReader = readerWith(props);
    const items: Array<ExceptionInstance> = [row(READABLE_SERVICE)];

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    await access.readsEveryRecord(reader);
    await access.getReadableIds(reader, idsOf(items));

    expect(checked).toHaveBeenCalledTimes(1);
    expect(checked.mock.calls[0]![0]).toBe(ExceptionInstance);
    expect(checked.mock.calls[0]![3]).toBe(props);
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(scoped.mock.calls[0]![1]).toBe(props);
  });

  test("a row this write did not name is read like one that names no resource: only a scope over every resource reaches it", async () => {
    readsWith(scope(null));
    const items: Array<ExceptionInstance> = [row(READABLE_SERVICE)];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<
      typeof ExceptionInstanceService.getRealtimeReadAccess
    > = ExceptionInstanceService.getRealtimeReadAccess(items);

    /*
     * Over every resource, a row this write did not name is read like an
     * unattributed one: the scope reaches it. Narrowed, it is not.
     */
    await expect(
      access.getReadableIds(reader, [ObjectID.generate()]),
    ).resolves.toHaveLength(1);

    jest.restoreAllMocks();
    readsWith(scope([READABLE_SERVICE]));

    await expect(
      ExceptionInstanceService.getRealtimeReadAccess(items).getReadableIds(
        readerWith(),
        [ObjectID.generate()],
      ),
    ).resolves.toEqual([]);
  });

  test("a service that narrows its reads on its own: nobody hears about its rows rather than everybody", async () => {
    readsWith(scope(null));

    class NarrowsOnItsOwn extends ExceptionInstanceServiceClass {
      protected override async onBeforeFind(
        findBy: FindBy<ExceptionInstance>,
      ): Promise<OnFind<ExceptionInstance>> {
        return { findBy: findBy, carryForward: null };
      }
    }

    const service: NarrowsOnItsOwn = new NarrowsOnItsOwn();
    const items: Array<ExceptionInstance> = [row(READABLE_SERVICE)];
    const reader: RealtimeReader = readerWith();

    const access: ReturnType<typeof service.getRealtimeReadAccess> =
      service.getRealtimeReadAccess(items);

    await expect(access.readsEveryRecord(reader)).resolves.toBe(false);
    await expect(access.getReadableIds(reader, idsOf(items))).resolves.toEqual(
      [],
    );
    expect(checked).not.toHaveBeenCalled();
  });
});
