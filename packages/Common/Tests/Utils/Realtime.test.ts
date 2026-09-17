import RealtimeUtil from "../../Utils/Realtime";
import ObjectID from "../../Types/ObjectID";
import ModelEventType from "../../Types/Realtime/ModelEventType";

describe("RealtimeUtil.getRoomId", () => {
  test("joins tenant, model and event type with hyphens", () => {
    expect(
      RealtimeUtil.getRoomId("tenant1", "Monitor", ModelEventType.Create),
    ).toBe("tenant1-Monitor-Create");
  });

  test("appends the model id when one is given", () => {
    expect(
      RealtimeUtil.getRoomId(
        "tenant1",
        "Monitor",
        ModelEventType.Update,
        "model9",
      ),
    ).toBe("tenant1-Monitor-Update-model9");
  });

  test("accepts ObjectID for tenant and model id, using their string form", () => {
    const tenant: ObjectID = new ObjectID(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const modelId: ObjectID = new ObjectID(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(
      RealtimeUtil.getRoomId(
        tenant,
        "Incident",
        ModelEventType.Delete,
        modelId,
      ),
    ).toBe(`${tenant.toString()}-Incident-Delete-${modelId.toString()}`);
  });

  test("the room id changes with the event type (rooms are per-event)", () => {
    const create: string = RealtimeUtil.getRoomId(
      "t",
      "Monitor",
      ModelEventType.Create,
    );
    const update: string = RealtimeUtil.getRoomId(
      "t",
      "Monitor",
      ModelEventType.Update,
    );
    expect(create).not.toBe(update);
  });

  test("the id-scoped room is distinct from the collection-wide room", () => {
    // A subscriber to one model must not collect the whole collection's events.
    const collectionRoom: string = RealtimeUtil.getRoomId(
      "t",
      "Monitor",
      ModelEventType.Update,
    );
    const itemRoom: string = RealtimeUtil.getRoomId(
      "t",
      "Monitor",
      ModelEventType.Update,
      "m1",
    );
    expect(itemRoom).not.toBe(collectionRoom);
    expect(itemRoom.startsWith(collectionRoom)).toBe(true);
  });

  test("an empty-string model id is falsy, so no id segment is appended", () => {
    // Documents the `if (modelId)` guard: "" behaves like an omitted id.
    expect(
      RealtimeUtil.getRoomId("t", "Monitor", ModelEventType.Create, ""),
    ).toBe("t-Monitor-Create");
  });
});
