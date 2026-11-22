import DataStoreService from "../../../Server/Services/DataStoreService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreKind,
} from "../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A STORE ONEUPTIME DECLARES IS NEVER ADDED BY HAND (#10398).
 *
 * Security Events, Network Flows and the address vault are declared by
 * OneUptime, one of each, for every project that has one
 * (DeclaredDataStores). One a person added through the API would be a
 * second, holding nothing, and the record of processing would list both;
 * so the kind is refused for anyone but OneUptime, saying OneUptime adds
 * it - while a database a team runs itself is added as ever.
 */

type CreateHook = (createBy: CreateBy<DataStore>) => Promise<OnCreate<DataStore>>;

function onBeforeCreate(): CreateHook {
  const service: { onBeforeCreate: CreateHook } =
    DataStoreService as unknown as { onBeforeCreate: CreateHook };

  return service.onBeforeCreate.bind(DataStoreService);
}

function storeOf(kind: DataStoreKind, name: string): DataStore {
  const store: DataStore = new DataStore();
  store.projectId = ObjectID.generate();
  store.kind = kind;
  store.name = name;
  return store;
}

describe("adding a store by hand", () => {
  test.each([...DECLARED_DATA_STORE_KINDS])(
    "of the kind %s, which OneUptime declares, is refused",
    async (kind: DataStoreKind) => {
      await expect(
        onBeforeCreate()({
          data: storeOf(kind, "My own security events"),
          props: { tenantId: ObjectID.generate(), userId: ObjectID.generate() },
        }),
      ).rejects.toThrow(
        new BadDataException(
          `OneUptime adds the ${kind} store itself, once your project has such data.`,
        ),
      );
    },
  );

  test("of a database a team runs itself is made as ever", async () => {
    const created: OnCreate<DataStore> = await onBeforeCreate()({
      data: storeOf(DataStoreKind.PostgreSql, " orders-db "),
      props: { tenantId: ObjectID.generate(), userId: ObjectID.generate() },
    });

    expect(created.createBy.data.name).toBe("orders-db");
    expect(created.createBy.data.discoveredFrom).toBe("Manual");
    expect(created.createBy.data.storeKey?.startsWith("manual:")).toBe(true);
  });

  test("as OneUptime, a declared store is made: the declarer makes them", async () => {
    const created: OnCreate<DataStore> = await onBeforeCreate()({
      data: storeOf(DataStoreKind.SecurityEvents, "Security Events"),
      props: { isRoot: true },
    });

    expect(created.createBy.data.kind).toBe(DataStoreKind.SecurityEvents);
  });
});
