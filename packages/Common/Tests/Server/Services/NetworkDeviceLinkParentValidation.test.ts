import NetworkDeviceLinkService from "../../../Server/Services/NetworkDeviceLinkService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLink from "../../../Models/DatabaseModels/NetworkDeviceLink";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - the declared-parent invariant on NetworkDeviceLink
 * (OneUptime/oneuptime#3192):
 *
 *   a link's parentDeviceId, when set, must name one of the two devices that
 *   link connects.
 *
 * A parent that is not an end is not a statement about this link at all. The
 * topology builder ignores it (buildTopology only stamps edge.parentNodeId
 * when parentDeviceId matches an end), so the operator would declare a
 * hierarchy, save it successfully, and watch the map not move. Hence both
 * write paths refuse it up front rather than storing a row that means nothing.
 *
 * onBeforeUpdate carries the harder half of the invariant, because an update
 * can break it from the other side: leave the parent alone and move an END out
 * from under it. So the post-update state is what gets validated, assembled
 * from the payload where it speaks and from the stored row where it does not -
 * for every row the update's query matches, not just one.
 *
 * All of it runs against stubbed reads. No database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const DEVICE_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
// The third wheel: a real device in the project that this link does not touch.
const DEVICE_C_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const LINK_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_LINK_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const PARENT_NOT_AN_END_MESSAGE: string =
  "The parent device must be one of the two devices this link connects.";

/*
 * onBeforeCreate reads both ends back to prove they exist and are in the
 * project. Every create test needs that read to succeed before the parent
 * check is even reached, so it gets its own helper.
 */
function mockBothEndsExist(): jest.SpyInstance {
  return jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([
    {
      _id: DEVICE_A_ID.toString(),
      id: DEVICE_A_ID,
    } as unknown as NetworkDevice,
    {
      _id: DEVICE_B_ID.toString(),
      id: DEVICE_B_ID,
    } as unknown as NetworkDevice,
  ]);
}

function makeCreateBy(
  data: Record<string, unknown>,
): CreateBy<NetworkDeviceLink> {
  return {
    data: {
      projectId: PROJECT_ID,
      ...data,
    } as unknown as NetworkDeviceLink,
    props: { isRoot: true },
  };
}

function storedLink(data: {
  _id?: ObjectID;
  fromDeviceId?: ObjectID | undefined;
  toDeviceId?: ObjectID | undefined;
  parentDeviceId?: ObjectID | undefined;
}): NetworkDeviceLink {
  return {
    _id: (data._id || LINK_ID).toString(),
    id: data._id || LINK_ID,
    /*
     * Carried because moving an end re-checks that the new device belongs
     * to the link's project, exactly as create does — the FK is global, so
     * without that check an update could re-point an end at another
     * project's device and surface its name on this project's map.
     */
    projectId: PROJECT_ID,
    fromDeviceId: data.fromDeviceId,
    toDeviceId: data.toDeviceId,
    parentDeviceId: data.parentDeviceId,
  } as unknown as NetworkDeviceLink;
}

/*
 * The device read that the moved-end tenancy check performs. Returns all
 * three project devices, so any end move is legitimate unless a test
 * deliberately overrides it — which the tenancy tests do.
 */
function mockProjectDevicesExist(): jest.SpyInstance {
  return jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue(
    [DEVICE_A_ID, DEVICE_B_ID, DEVICE_C_ID].map((id: ObjectID) => {
      return {
        _id: id.toString(),
        id: id,
      } as unknown as NetworkDevice;
    }),
  );
}

function makeUpdateBy(
  data: Record<string, unknown>,
): UpdateBy<NetworkDeviceLink> {
  return {
    query: { _id: LINK_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDeviceLink>;
}

// The stored rows an update is validated against.
function mockStoredLinks(links: Array<NetworkDeviceLink>): jest.SpyInstance {
  /*
   * Installed alongside, so a test about the PARENT invariant is never
   * incidentally failed by the tenancy check on an end it moved to set
   * the scene. Tests about tenancy itself re-stub this.
   */
  mockProjectDevicesExist();
  return jest
    .spyOn(NetworkDeviceLinkService, "findBy")
    .mockResolvedValue(links);
}

describe("NetworkDeviceLinkService.onBeforeCreate (declared parent)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a parent that is the link's from-device", async () => {
    mockBothEndsExist();

    const result: OnCreate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeCreate(
      makeCreateBy({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  it("accepts a parent that is the link's to-device", async () => {
    mockBothEndsExist();

    const result: OnCreate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeCreate(
      makeCreateBy({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_B_ID,
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  /*
   * The common case, and the one that must stay cheap: most links are peers
   * (two access switches on the same trunk), and declaring nothing is how an
   * operator says "these are siblings, let the layout decide".
   */
  it("accepts a link with no declared parent at all", async () => {
    mockBothEndsExist();

    const result: OnCreate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeCreate(
      makeCreateBy({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  it("rejects a parent naming a third device, and says why", async () => {
    mockBothEndsExist();

    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_B_ID,
          parentDeviceId: DEVICE_C_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);

    /*
     * The message is the whole user experience of this guard - it is what the
     * dashboard renders when the save fails - so it has to name the constraint
     * rather than say "bad data".
     */
    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_B_ID,
          parentDeviceId: DEVICE_C_ID,
        }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  /*
   * The dashboard's link form posts the RELATION (`{ parentDevice: { _id } }`),
   * never the FK column, because DatabaseBaseModel serialises the entity
   * column it was handed. A guard that read only `parentDeviceId` would wave
   * every UI-authored declaration straight through.
   */
  it("rejects a third-device parent posted as the `parentDevice` relation", async () => {
    mockBothEndsExist();

    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDevice: { _id: DEVICE_A_ID.toString() },
          toDevice: { _id: DEVICE_B_ID.toString() },
          parentDevice: { _id: DEVICE_C_ID.toString() },
        }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  it("accepts a valid parent posted as the `parentDevice` relation", async () => {
    mockBothEndsExist();

    const result: OnCreate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeCreate(
      makeCreateBy({
        fromDevice: { _id: DEVICE_A_ID.toString() },
        toDevice: { _id: DEVICE_B_ID.toString() },
        parentDevice: { _id: DEVICE_A_ID.toString() },
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  /*
   * Determinism: the two spellings are the same statement, so a payload that
   * mixes them - column for the ends, relation for the parent, or the reverse
   * - has to land on the same verdict as either pure form.
   */
  it("reaches the same verdict whichever spelling each reference uses", async () => {
    mockBothEndsExist();

    const payloads: Array<Record<string, unknown>> = [
      {
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDevice: { _id: DEVICE_C_ID.toString() },
      },
      {
        fromDevice: { _id: DEVICE_A_ID.toString() },
        toDevice: { _id: DEVICE_B_ID.toString() },
        parentDeviceId: DEVICE_C_ID,
      },
      // Key order reversed: the reader must not depend on insertion order.
      {
        parentDeviceId: DEVICE_C_ID,
        toDeviceId: DEVICE_B_ID,
        fromDeviceId: DEVICE_A_ID,
      },
    ];

    for (const payload of payloads) {
      await expect(
        (NetworkDeviceLinkService as any).onBeforeCreate(makeCreateBy(payload)),
      ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
    }
  });

  /*
   * The parent check sits behind the existing guards on purpose: a link with
   * one end missing, or both ends the same device, has no "two ends" for a
   * parent to be one of. Those errors must stay the ones reported.
   */
  it("still reports the self-link error before looking at the parent", async () => {
    mockBothEndsExist();

    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_A_ID,
          parentDeviceId: DEVICE_C_ID,
        }),
      ),
    ).rejects.toThrow("A device cannot be linked to itself.");
  });
});

describe("NetworkDeviceLinkService.onBeforeUpdate (declared parent)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The whole reason the hook computes `touchesHierarchy` first. Link rows are
   * rewritten by every port rename and every monitor rebind; making each of
   * those pay for a LIMIT_MAX read of the matched rows would be a real cost
   * for a guard that could not possibly fire.
   */
  it("performs no read when the payload touches neither an end nor the parent", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceLinkService,
      "findBy",
    );

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(
      makeUpdateBy({
        fromPort: "Gi1/0/24",
        description: "patch panel B",
      }),
    );

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  it("rejects setting the parent to a device the stored link does not touch", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ parentDeviceId: DEVICE_C_ID }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  it("accepts setting the parent to one of the stored link's own ends", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ parentDeviceId: DEVICE_B_ID }));

    expect(result.carryForward).toBeNull();
  });

  it("rejects a third-device parent posted as the `parentDevice` relation", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ parentDevice: { _id: DEVICE_C_ID.toString() } }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  /*
   * The non-obvious half of the invariant. Nobody touched the parent here -
   * the payload only re-points an end - but A->B with parent A becomes C->B,
   * and A is suddenly a device this link has never heard of. Checking only the
   * written parent would let this through and leave a stored row that the
   * topology builder silently ignores forever.
   */
  it("rejects moving an end out from under an already-declared parent", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ fromDeviceId: DEVICE_C_ID }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  it("rejects moving an end out from under a parent given as the `fromDevice` relation", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ fromDevice: { _id: DEVICE_C_ID.toString() } }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  /*
   * The other end may move freely as long as the declared parent survives it:
   * A->B with parent A becomes A->C, and A is still an end. Re-patching a
   * downlink to a different access switch is routine and must not be blocked.
   */
  it("accepts moving the end that is NOT the declared parent", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ toDeviceId: DEVICE_C_ID }));

    expect(result.carryForward).toBeNull();
  });

  // Moving an end AND re-declaring the parent onto the new end in one write.
  it("accepts moving an end when the payload re-points the parent at the same time", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(
      makeUpdateBy({
        fromDeviceId: DEVICE_C_ID,
        parentDeviceId: DEVICE_C_ID,
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  /*
   * The isParentWritten branch, which is the subtle one. Demoting a hierarchy
   * back to a peer link means writing the parent key with an empty value -
   * and RelationIdUtil reads that as null, exactly like "not written at all".
   * If the hook decided on the VALUE it would fall back to the stored parent
   * A, find it absent from the new C->B ends, and refuse the very write that
   * was removing the offending declaration. The KEY's presence is what
   * decides.
   */
  it("accepts clearing the parent with null even while an end moves away from it", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(
      makeUpdateBy({
        fromDeviceId: DEVICE_C_ID,
        parentDeviceId: null,
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  // Same branch, reached through the other empty values the UI can send.
  it("treats empty-string and a null relation as clearing the parent too", async () => {
    const emptyValues: Array<Record<string, unknown>> = [
      { fromDeviceId: DEVICE_C_ID, parentDeviceId: "" },
      { fromDeviceId: DEVICE_C_ID, parentDevice: null },
    ];

    for (const data of emptyValues) {
      mockStoredLinks([
        storedLink({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_B_ID,
          parentDeviceId: DEVICE_A_ID,
        }),
      ]);

      const result: OnUpdate<NetworkDeviceLink> = await (
        NetworkDeviceLinkService as any
      ).onBeforeUpdate(makeUpdateBy(data));

      expect(result.carryForward).toBeNull();
      jest.restoreAllMocks();
    }
  });

  /*
   * undefined is NOT one of them, and the difference is not pedantry.
   * TypeORM drops undefined-valued keys before building the SET list, so
   * such a key writes nothing at all. Reading it as "the parent is being
   * cleared" makes this hook validate a row that will never exist: it
   * would wave the write through, and the stored parent would survive on
   * a link whose end had just moved out from under it — precisely the
   * state the hook exists to prevent.
   */
  it("refuses a moved end when a present-but-undefined parent key would leave the stored parent stranded", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({
          fromDeviceId: DEVICE_C_ID,
          parentDeviceId: undefined,
        }),
      ),
    ).rejects.toThrow(
      "The parent device must be one of the two devices this link connects.",
    );
  });

  // And a payload of nothing BUT undefined writes nothing, so it reads nothing.
  it("takes the early return when every hierarchy key present holds undefined", async () => {
    const findBySpy: jest.SpyInstance = mockStoredLinks([]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(
      makeUpdateBy({
        fromDeviceId: undefined,
        parentDeviceId: undefined,
      }),
    );

    expect(result.carryForward).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  /*
   * Clearing the parent still counts as touching the hierarchy, so it must not
   * take the early return - the same write can be moving an end, and that end
   * move is what the read exists to check.
   */
  it("still reads the stored rows when the only hierarchy key present clears the parent", async () => {
    const findBySpy: jest.SpyInstance = mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_A_ID,
      }),
    ]);

    await (NetworkDeviceLinkService as any).onBeforeUpdate(
      makeUpdateBy({ parentDeviceId: null }),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
  });

  /*
   * An update matches a QUERY. "Set parent = A on every link into rack 3" can
   * land on rows with completely different ends, and only some of them touch
   * A. Fixing the ones that fit while leaving the rest self-contradicting
   * would be far harder to notice than a refusal, so one bad row rejects the
   * whole write.
   */
  it("validates every matched row and rejects the write when any one of them fails", async () => {
    mockStoredLinks([
      storedLink({
        _id: LINK_ID,
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
      }),
      storedLink({
        _id: OTHER_LINK_ID,
        fromDeviceId: DEVICE_B_ID,
        toDeviceId: DEVICE_C_ID,
      }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ parentDeviceId: DEVICE_A_ID }),
      ),
    ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);
  });

  /*
   * Determinism: the read has no ORDER BY, so which row Postgres hands back
   * first is not something the caller controls. The verdict must not depend on
   * it - a rejection has to be a rejection with the bad row first or last.
   */
  it("rejects the same multi-row write regardless of the order the rows come back", async () => {
    const goodRow: NetworkDeviceLink = storedLink({
      _id: LINK_ID,
      fromDeviceId: DEVICE_A_ID,
      toDeviceId: DEVICE_B_ID,
    });
    const badRow: NetworkDeviceLink = storedLink({
      _id: OTHER_LINK_ID,
      fromDeviceId: DEVICE_B_ID,
      toDeviceId: DEVICE_C_ID,
    });

    for (const rows of [
      [goodRow, badRow],
      [badRow, goodRow],
    ]) {
      mockStoredLinks(rows);

      await expect(
        (NetworkDeviceLinkService as any).onBeforeUpdate(
          makeUpdateBy({ parentDeviceId: DEVICE_A_ID }),
        ),
      ).rejects.toThrow(PARENT_NOT_AN_END_MESSAGE);

      jest.restoreAllMocks();
    }
  });

  it("accepts a multi-row write when the parent is an end of every matched row", async () => {
    mockStoredLinks([
      storedLink({
        _id: LINK_ID,
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
      }),
      storedLink({
        _id: OTHER_LINK_ID,
        fromDeviceId: DEVICE_C_ID,
        toDeviceId: DEVICE_A_ID,
      }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ parentDeviceId: DEVICE_A_ID }));

    expect(result.carryForward).toBeNull();
  });

  /*
   * The self-link guard has to hold on the update path too: a link the map
   * would drop as a self-edge is invisible and permanently confusing, whether
   * it was created that way or edited into that shape.
   */
  it("rejects an update that would point both ends at the same device", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ toDeviceId: DEVICE_A_ID }),
      ),
    ).rejects.toThrow("A device cannot be linked to itself.");
  });

  it("rejects an update that points both written ends at the same device", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({
          fromDeviceId: DEVICE_C_ID,
          toDeviceId: DEVICE_C_ID,
        }),
      ),
    ).rejects.toThrow("A device cannot be linked to itself.");
  });

  /*
   * A row mid-migration - written before both ends were mandatory - has no two
   * ends for a parent to be one of, so there is no invariant to check and the
   * hook must not invent one and block unrelated writes.
   */
  it("skips a stored row that is missing an end rather than failing the write", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: undefined }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ parentDeviceId: DEVICE_C_ID }));

    expect(result.carryForward).toBeNull();
  });

  // Nothing matched, nothing to contradict.
  it("accepts a write whose query matched no rows", async () => {
    mockStoredLinks([]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ parentDeviceId: DEVICE_C_ID }));

    expect(result.carryForward).toBeNull();
  });

  /*
   * Determinism again, on the payload side: the hook reads keys by name, so
   * shuffling them (as any JSON body may arrive shuffled) must not move the
   * verdict.
   */
  it("reaches the same verdict whatever order the payload keys arrive in", async () => {
    const shuffles: Array<Record<string, unknown>> = [
      { fromDeviceId: DEVICE_C_ID, parentDeviceId: DEVICE_B_ID },
      { parentDeviceId: DEVICE_B_ID, fromDeviceId: DEVICE_C_ID },
    ];

    for (const data of shuffles) {
      mockStoredLinks([
        storedLink({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_B_ID,
          parentDeviceId: DEVICE_A_ID,
        }),
      ]);

      const result: OnUpdate<NetworkDeviceLink> = await (
        NetworkDeviceLinkService as any
      ).onBeforeUpdate(makeUpdateBy(data));

      expect(result.carryForward).toBeNull();
      jest.restoreAllMocks();
    }
  });

  /*
   * The hook validates; it does not rewrite. Anything it silently normalised
   * into updateBy.data would be written to the row without the caller ever
   * having asked for it.
   */
  it("passes the caller's payload through untouched when the write is accepted", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    const updateBy: UpdateBy<NetworkDeviceLink> = makeUpdateBy({
      parentDeviceId: DEVICE_A_ID,
    });

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(updateBy);

    expect(result.updateBy).toBe(updateBy);
    expect(
      Object.keys(result.updateBy.data as unknown as Record<string, unknown>),
    ).toEqual(["parentDeviceId"]);
  });

  /*
   * The read runs as root so it can see the rows the caller is about to write,
   * which means the caller's tenant has to be re-applied by hand - otherwise
   * a project could be handed another project's links to validate against.
   */
  it("scopes the validation read to the caller's project", async () => {
    const findBySpy: jest.SpyInstance = mockStoredLinks([]);

    await (NetworkDeviceLinkService as any).onBeforeUpdate({
      query: { _id: LINK_ID.toString() },
      data: { parentDeviceId: DEVICE_A_ID },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkDeviceLink>);

    const query: any = findBySpy.mock.calls[0]![0].query;
    expect(query._id).toBe(LINK_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(findBySpy.mock.calls[0]![0].props.isRoot).toBe(true);
  });

  // The stored parent can only be honoured if the read actually fetches it.
  it("selects the ends and the stored parent the check compares", async () => {
    const findBySpy: jest.SpyInstance = mockStoredLinks([]);

    await (NetworkDeviceLinkService as any).onBeforeUpdate(
      makeUpdateBy({ fromDeviceId: DEVICE_C_ID }),
    );

    const select: any = findBySpy.mock.calls[0]![0].select;
    expect(select.fromDeviceId).toBe(true);
    expect(select.toDeviceId).toBe(true);
    expect(select.parentDeviceId).toBe(true);
  });
});

/*
 * The tenancy half of the invariant.
 *
 * onBeforeCreate has always refused an end outside the caller's project,
 * and says why in its own comment: the FK only requires the device row to
 * exist, so without the check a tenant could draw a line to another
 * project's device and read its name off the map. Updates never re-ran it,
 * which left the guard one PUT away from being bypassed - and the declared
 * parent would have inherited the hole, since a parent is only allowed to
 * be an end.
 */
describe("NetworkDeviceLinkService.onBeforeUpdate (moved ends stay in the project)", () => {
  const FOREIGN_DEVICE_ID: ObjectID = new ObjectID(
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses an end moved to a device outside the link's project", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);
    // The project read finds nothing: that device is not in this project.
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ toDeviceId: FOREIGN_DEVICE_ID }),
      ),
    ).rejects.toThrow("Both devices must exist and belong to this project.");
  });

  it("refuses the same move made through the relation spelling", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({ toDevice: { _id: FOREIGN_DEVICE_ID.toString() } }),
      ),
    ).rejects.toThrow("Both devices must exist and belong to this project.");
  });

  it("scopes the device read to the link's own project", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);
    const deviceFindBy: jest.SpyInstance = mockProjectDevicesExist();

    await (NetworkDeviceLinkService as any).onBeforeUpdate(
      makeUpdateBy({ toDeviceId: DEVICE_C_ID }),
    );

    expect(deviceFindBy).toHaveBeenCalled();
    const query: any = deviceFindBy.mock.calls[0]![0].query;
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  it("accepts an end moved to another device in the same project", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(makeUpdateBy({ toDeviceId: DEVICE_C_ID }));

    expect(result.carryForward).toBeNull();
  });

  /*
   * A count would be satisfied by two rows for one device. The check
   * compares the ids it asked about against the ids it got back.
   */
  it("is not fooled by a duplicate row standing in for a missing device", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([
      {
        _id: DEVICE_C_ID.toString(),
        id: DEVICE_C_ID,
      } as unknown as NetworkDevice,
      {
        _id: DEVICE_C_ID.toString(),
        id: DEVICE_C_ID,
      } as unknown as NetworkDevice,
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({
          fromDeviceId: DEVICE_C_ID,
          toDeviceId: FOREIGN_DEVICE_ID,
        }),
      ),
    ).rejects.toThrow("Both devices must exist and belong to this project.");
  });

  // No end moved, so there is nothing to re-check and nothing to read.
  it("does not read devices when only the parent is written", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);
    const deviceFindBy: jest.SpyInstance = mockProjectDevicesExist();

    await (NetworkDeviceLinkService as any).onBeforeUpdate(
      makeUpdateBy({ parentDeviceId: DEVICE_A_ID }),
    );

    expect(deviceFindBy).not.toHaveBeenCalled();
  });
});

/*
 * Two shapes an id can arrive in that a naive comparison gets wrong.
 */
describe("NetworkDeviceLinkService - how ids are compared", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * These columns are Postgres `uuid`, where equality ignores case, and
   * ObjectID.isValidUUID accepts either case - so a client may legitimately
   * send an upper-case id for a row stored lower-case. A raw JS !== calls
   * that a different device and refuses a parent that IS an end. Note the
   * device-existence check could never disagree: it runs in Postgres.
   */
  it("accepts a parent that names an end in a different case", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    const result: OnUpdate<NetworkDeviceLink> = await (
      NetworkDeviceLinkService as any
    ).onBeforeUpdate(
      makeUpdateBy({
        parentDeviceId: new ObjectID(DEVICE_A_ID.toString().toUpperCase()),
      }),
    );

    expect(result.carryForward).toBeNull();
  });

  it("still catches a self-link written in mixed case", async () => {
    mockBothEndsExist();

    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: new ObjectID(DEVICE_A_ID.toString().toUpperCase()),
        }),
      ),
    ).rejects.toThrow("A device cannot be linked to itself.");
  });

  /*
   * UpdateBy.data is a QueryDeepPartialEntity, so a column may legally hold
   * a raw SQL-expression function. RelationIdUtil reads one as null -
   * indistinguishable from "cleared" - and the invariant would then be
   * checked against a row bearing no relation to what gets written. Nothing
   * writes this model that way today; refusing is what keeps that true.
   */
  it("refuses an end set to a raw SQL expression rather than mis-validating it", async () => {
    mockStoredLinks([
      storedLink({
        fromDeviceId: DEVICE_A_ID,
        toDeviceId: DEVICE_B_ID,
        parentDeviceId: DEVICE_B_ID,
      }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({
          toDeviceId: (): string => {
            return `'${DEVICE_C_ID.toString()}'`;
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("refuses a parent set to a raw SQL expression", async () => {
    mockStoredLinks([
      storedLink({ fromDeviceId: DEVICE_A_ID, toDeviceId: DEVICE_B_ID }),
    ]);

    await expect(
      (NetworkDeviceLinkService as any).onBeforeUpdate(
        makeUpdateBy({
          parentDeviceId: (): string => {
            return `'${DEVICE_C_ID.toString()}'`;
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("refuses the same on create", async () => {
    mockBothEndsExist();

    await expect(
      (NetworkDeviceLinkService as any).onBeforeCreate(
        makeCreateBy({
          fromDeviceId: DEVICE_A_ID,
          toDeviceId: DEVICE_B_ID,
          parentDeviceId: (): string => {
            return `'${DEVICE_C_ID.toString()}'`;
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});
