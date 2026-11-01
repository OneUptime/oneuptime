import DataSecurityIdentity from "../../../../../Models/DatabaseModels/DataSecurityIdentity";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../../Models/DatabaseModels/DataStoreAccess";
import DataSecurityIdentityService from "../../../../../Server/Services/DataSecurityIdentityService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import SecurityCaseDataAtRisk, {
  DATA_AT_RISK_MAX_DATA_TYPES,
  getIdentityCandidates,
  isNamedIdentity,
  sortStoresAtRisk,
} from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseDataAtRisk";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_MAX_DATA_STORES,
  SecurityCaseDataAtRiskJson,
  SecurityCaseDataStoreAtRiskJson,
} from "../../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityEntity,
  SecurityEntityType,
  getDataStoreEntityValue,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The data a security case puts at risk: the stores it names, and every
 * store the identities it names can reach - a role's session as the role,
 * an email as the cloud members it is - the most sensitive first, each
 * with what it holds, how exposed it is and how many identities can reach
 * it. Read as the reader, every read bounded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  tenantId: PROJECT_ID,
};
const ROLE_ARN: string = "arn:aws:iam::123456789012:role/service/exporter";

function entity(type: SecurityEntityType, value: string): SecurityEntity {
  return { type, value };
}

function storeOf(data: {
  name: string;
  sensitivity: DataSensitivity;
  storeKey?: string | undefined;
  records?: number | undefined;
  dataTypeIds?: Array<string> | undefined;
}): DataStore {
  const store: DataStore = new DataStore(ObjectID.generate());
  store.name = data.name;
  store.kind = "AWS S3 bucket" as never;
  store.sensitivity = data.sensitivity;
  store.storeKey = data.storeKey || `cloud:aws:${data.name}`;
  store.exposure = DataStoreExposure.Private;
  store.dataTypeIds = data.dataTypeIds || [];

  if (data.records !== undefined) {
    store.estimatedRecords = data.records;
  }

  return store;
}

function identityOf(data: {
  principal: string;
  name?: string | undefined;
  riskScore?: number | undefined;
}): DataSecurityIdentity {
  const identity: DataSecurityIdentity = new DataSecurityIdentity(
    ObjectID.generate(),
  );
  identity.principal = data.principal;

  if (data.name) {
    identity.principalName = data.name;
  }

  identity.principalType = "Role";
  identity.storeCount = 2;
  identity.sensitiveStoreCount = 1;
  identity.highestSensitivity = DataSensitivity.Restricted;
  identity.riskScore = data.riskScore || 60;
  return identity;
}

function grantOf(
  store: DataStore,
  principal: string,
  isExternal: boolean = false,
): DataStoreAccess {
  const grant: DataStoreAccess = new DataStoreAccess();
  grant.dataStoreId = store.id!;
  grant.principal = principal;
  grant.isExternal = isExternal;
  return grant;
}

function includesOf(value: unknown): Array<string> {
  return ((value as Includes).values as Array<unknown>).map(
    (item: unknown): string => {
      return String(item);
    },
  );
}

describe("who an entity may be", () => {
  test("a principal as written; a role's session as the role, by its name in its account", () => {
    expect(
      getIdentityCandidates([
        entity(
          SecurityEntityType.User,
          "arn:aws:sts::123456789012:assumed-role/exporter/i-0abc",
        ),
        entity(SecurityEntityType.Other, "arn:aws:iam::123456789012:user/kim"),
      ]),
    ).toEqual({
      principals: [
        "arn:aws:sts::123456789012:assumed-role/exporter/i-0abc",
        "arn:aws:iam::123456789012:role/exporter",
        "arn:aws:iam::123456789012:user/kim",
      ],
      names: [{ name: "exporter", account: "123456789012" }],
    });
  });

  test("an email is a Google Cloud user or service account, and an Azure principal by name", () => {
    expect(
      getIdentityCandidates([
        entity(SecurityEntityType.User, "kim@acme.example"),
      ]),
    ).toEqual({
      principals: [
        "kim@acme.example",
        "user:kim@acme.example",
        "serviceAccount:kim@acme.example",
      ],
      names: [{ name: "kim@acme.example" }],
    });
  });

  test("addresses, hosts and files are no identity; blank values are nothing", () => {
    expect(
      getIdentityCandidates([
        entity(SecurityEntityType.IpAddress, "203.0.113.7"),
        entity(SecurityEntityType.Host, "web-1"),
        entity(SecurityEntityType.FileHash, "abc"),
        entity(SecurityEntityType.User, "   "),
      ]),
    ).toEqual({ principals: [], names: [] });
  });

  test("a role found by name is the case's only in the account its session named", () => {
    const names: Array<{ name: string; account?: string | undefined }> = [
      { name: "exporter", account: "123456789012" },
      { name: "Kim@Acme.Example" },
    ];

    expect(
      isNamedIdentity(
        identityOf({ principal: ROLE_ARN, name: "exporter" }),
        names,
      ),
    ).toBe(true);
    expect(
      isNamedIdentity(
        identityOf({
          principal: "arn:aws:iam::999988887777:role/exporter",
          name: "exporter",
        }),
        names,
      ),
    ).toBe(false);
    expect(
      isNamedIdentity(
        identityOf({ principal: "object-id", name: "kim@acme.example" }),
        names,
      ),
    ).toBe(true);
  });
});

describe("the stores at risk, in order", () => {
  function atRisk(
    name: string,
    sensitivity: string,
    records: number | null,
  ): SecurityCaseDataStoreAtRiskJson {
    return {
      id: name,
      name,
      kind: "",
      sensitivity,
      dataTypeIds: [],
      estimatedRecords: records,
      exposure: "",
      isNamedByCase: false,
      reachedThrough: [],
      identityCount: 0,
      externalIdentityCount: 0,
    };
  }

  test("the most sensitive first, then the most records, then by name", () => {
    expect(
      sortStoresAtRisk([
        atRisk("wiki", DataSensitivity.Internal, 9000),
        atRisk("cards-b", DataSensitivity.Restricted, 10),
        atRisk("profiles", DataSensitivity.Confidential, null),
        atRisk("cards-a", DataSensitivity.Restricted, 10),
        atRisk("cards-big", DataSensitivity.Restricted, 50000),
      ]).map((store: SecurityCaseDataStoreAtRiskJson): string => {
        return store.name;
      }),
    ).toEqual(["cards-big", "cards-a", "cards-b", "profiles", "wiki"]);
  });
});

describe("SecurityCaseDataAtRisk.read", () => {
  let storesSpy: jest.SpyInstance;
  let identitiesSpy: jest.SpyInstance;
  let grantsSpy: jest.SpyInstance;
  let stores: Array<DataStore>;
  let identities: Array<DataSecurityIdentity>;
  let grants: Array<DataStoreAccess>;

  beforeEach(() => {
    stores = [];
    identities = [];
    grants = [];
    storesSpy = jest
      .spyOn(DataStoreService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        const query: JSONObject = findBy.query;

        return stores.filter((store: DataStore): boolean => {
          if (query["storeKey"]) {
            return includesOf(query["storeKey"]).includes(store.storeKey || "");
          }

          return includesOf(query["_id"]).includes(store.id!.toString());
        });
      }) as never);
    identitiesSpy = jest
      .spyOn(DataSecurityIdentityService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        const query: JSONObject = findBy.query;

        return identities.filter((identity: DataSecurityIdentity): boolean => {
          if (query["principal"]) {
            return includesOf(query["principal"]).includes(
              identity.principal || "",
            );
          }

          return includesOf(query["principalName"]).includes(
            identity.principalName || "",
          );
        });
      }) as never);
    grantsSpy = jest
      .spyOn(DataStoreAccessService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        const query: JSONObject = findBy.query;

        return grants.filter((grant: DataStoreAccess): boolean => {
          if (query["principal"]) {
            return includesOf(query["principal"]).includes(
              grant.principal || "",
            );
          }

          return includesOf(query["dataStoreId"]).includes(
            grant.dataStoreId!.toString(),
          );
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function read(
    entities: Array<SecurityEntity>,
  ): Promise<SecurityCaseDataAtRiskJson> {
    return SecurityCaseDataAtRisk.read({
      projectId: PROJECT_ID,
      entities,
      props: CALLER,
    });
  }

  test("a case naming neither a store nor an identity reads nothing", async () => {
    expect(
      await read([entity(SecurityEntityType.IpAddress, "203.0.113.7")]),
    ).toEqual({ stores: [], identities: [], hasMoreStores: false });
    expect(storesSpy).not.toHaveBeenCalled();
    expect(identitiesSpy).not.toHaveBeenCalled();
    expect(grantsSpy).not.toHaveBeenCalled();
  });

  test("a store the case names: what it holds, how exposed it is, and who else can reach it", async () => {
    const vault: DataStore = storeOf({
      name: "card-vault",
      sensitivity: DataSensitivity.Restricted,
      records: 1200000,
      dataTypeIds: [
        "credit-card-number",
        "email-address",
        "phone-number",
        "person-name",
        "postal-address",
        "date-of-birth",
      ],
    });
    stores = [vault];
    grants = [
      grantOf(vault, "arn:aws:iam::123456789012:role/app"),
      grantOf(vault, "arn:aws:iam::123456789012:role/app"),
      grantOf(vault, "arn:aws:iam::210987654321:root", true),
    ];

    const json: SecurityCaseDataAtRiskJson = await read([
      entity(
        SecurityEntityType.DataStore,
        getDataStoreEntityValue(vault.storeKey!),
      ),
    ]);

    expect(json.stores).toEqual([
      {
        id: vault.id!.toString(),
        name: "card-vault",
        kind: "AWS S3 bucket",
        sensitivity: DataSensitivity.Restricted,
        dataTypeIds: [
          "credit-card-number",
          "email-address",
          "phone-number",
          "person-name",
          "postal-address",
        ].slice(0, DATA_AT_RISK_MAX_DATA_TYPES),
        estimatedRecords: 1200000,
        exposure: DataStoreExposure.Private,
        isNamedByCase: true,
        reachedThrough: [],
        identityCount: 2,
        externalIdentityCount: 1,
      },
    ]);
    expect(json.hasMoreStores).toBe(false);
    // Read only the project's stores that are still there.
    expect(
      (storesSpy.mock.calls[0]![0] as { query: JSONObject }).query[
        "isArchived"
      ],
    ).toBe(false);
  });

  test("an identity the case names: every store it reaches, through it, the most sensitive first", async () => {
    const vault: DataStore = storeOf({
      name: "card-vault",
      sensitivity: DataSensitivity.Restricted,
    });
    const wiki: DataStore = storeOf({
      name: "wiki",
      sensitivity: DataSensitivity.Internal,
    });
    stores = [wiki, vault];
    identities = [identityOf({ principal: ROLE_ARN, name: "exporter" })];
    grants = [grantOf(wiki, ROLE_ARN), grantOf(vault, ROLE_ARN)];

    const json: SecurityCaseDataAtRiskJson = await read([
      entity(
        SecurityEntityType.User,
        "arn:aws:sts::123456789012:assumed-role/exporter/i-0abc",
      ),
    ]);

    expect(
      json.stores.map((store: SecurityCaseDataStoreAtRiskJson) => {
        return [store.name, store.isNamedByCase, store.reachedThrough];
      }),
    ).toEqual([
      ["card-vault", false, ["exporter"]],
      ["wiki", false, ["exporter"]],
    ]);
    expect(json.identities).toEqual([
      {
        id: identities[0]!.id!.toString(),
        name: "exporter",
        principal: ROLE_ARN,
        principalType: "Role",
        storeCount: 2,
        sensitiveStoreCount: 1,
        highestSensitivity: DataSensitivity.Restricted,
        riskScore: 60,
      },
    ]);
  });

  test("a store the case names and one of its identities reaches is listed once, named", async () => {
    const vault: DataStore = storeOf({
      name: "card-vault",
      sensitivity: DataSensitivity.Restricted,
    });
    stores = [vault];
    identities = [identityOf({ principal: ROLE_ARN, name: "exporter" })];
    grants = [grantOf(vault, ROLE_ARN)];

    const json: SecurityCaseDataAtRiskJson = await read([
      entity(
        SecurityEntityType.DataStore,
        getDataStoreEntityValue(vault.storeKey!),
      ),
      entity(SecurityEntityType.User, ROLE_ARN),
    ]);

    expect(json.stores).toHaveLength(1);
    expect(json.stores[0]).toEqual(
      expect.objectContaining({
        isNamedByCase: true,
        reachedThrough: ["exporter"],
      }),
    );
  });

  test("no more stores than the impact lists, and says there are more", async () => {
    for (
      let index: number = 0;
      index < SECURITY_CASE_IMPACT_MAX_DATA_STORES + 3;
      index++
    ) {
      const store: DataStore = storeOf({
        name: `bucket-${String(index).padStart(2, "0")}`,
        sensitivity: DataSensitivity.Confidential,
      });
      stores.push(store);
      grants.push(grantOf(store, ROLE_ARN));
    }

    identities = [identityOf({ principal: ROLE_ARN })];

    const json: SecurityCaseDataAtRiskJson = await read([
      entity(SecurityEntityType.User, ROLE_ARN),
    ]);

    expect(json.stores).toHaveLength(SECURITY_CASE_IMPACT_MAX_DATA_STORES);
    expect(json.hasMoreStores).toBe(true);
  });

  test("every read is the reader's own", async () => {
    const vault: DataStore = storeOf({
      name: "card-vault",
      sensitivity: DataSensitivity.Restricted,
    });
    stores = [vault];
    identities = [identityOf({ principal: ROLE_ARN })];
    grants = [grantOf(vault, ROLE_ARN)];

    await read([
      entity(
        SecurityEntityType.DataStore,
        getDataStoreEntityValue(vault.storeKey!),
      ),
      entity(SecurityEntityType.User, ROLE_ARN),
    ]);

    for (const spy of [storesSpy, identitiesSpy, grantsSpy]) {
      for (const call of spy.mock.calls) {
        expect((call[0] as { props: unknown }).props).toBe(CALLER);
      }
    }
  });
});
