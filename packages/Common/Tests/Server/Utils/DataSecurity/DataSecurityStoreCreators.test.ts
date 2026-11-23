import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import DataSecurityStoreCreators, {
  MAX_STORES_PER_CREATOR_READ,
  StoreToFindCreatorOf,
} from "../../../../Server/Utils/DataSecurity/DataSecurityStoreCreators";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { DATA_STORE_CREATE_OPERATIONS } from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * WHO CREATED A STORE, WHERE THE CLOUD'S CHANGE LOG NAMES IT (#10370): the
 * earliest create of each store, matched to it by its Cloud Resource or its
 * id at the provider - never a row two stores could both be - and read in
 * one bounded query per batch, whose failure names no creator and stops
 * nothing.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which store each row is", () => {
  const stores: Array<StoreToFindCreatorOf> = [
    { id: "a", cloudResourceId: "AAAAAAAA-0000-4000-8000-000000000001" },
    { id: "b", providerResourceId: "arn:aws:s3:::orders-exports" },
    { id: "c", providerResourceId: "arn:aws:s3:::shared-name" },
    { id: "d", providerResourceId: "projects/x/buckets/shared-name" },
    { id: "e", providerResourceId: "arn:aws:rds:us-east-1:1:db:billing" },
  ];

  test("by its Cloud Resource, its whole id, or a last segment only it has", () => {
    const creators: Map<string, string> = DataSecurityStoreCreators.matchRows({
      stores,
      rows: [
        {
          cloudResourceId: "aaaaaaaa-0000-4000-8000-000000000001",
          providerResourceId: "",
          creator: "arn:aws:sts::111122223333:assumed-role/terraform-ci/run-1",
        },
        {
          cloudResourceId: "",
          providerResourceId: "orders-exports",
          creator: "arn:aws:iam::111122223333:user/alice",
        },
        {
          cloudResourceId: "",
          providerResourceId: "shared-name",
          creator: "arn:aws:iam::111122223333:user/bob",
        },
        {
          cloudResourceId: "",
          providerResourceId: "arn:aws:rds:us-east-1:1:db:billing",
          creator: "  ",
        },
      ],
    });

    expect(Object.fromEntries(creators)).toEqual({
      a: "role/terraform-ci",
      b: "user/alice",
    });
  });
});

describe("the read", () => {
  test("asks for the creates of the stores, by their ids, as parameters", () => {
    const statement: Statement | null =
      DataSecurityStoreCreators.buildStatement({
        projectId: PROJECT,
        stores: [
          { id: "a", cloudResourceId: "cloud-resource-1" },
          { id: "b", providerResourceId: "arn:aws:s3:::orders-exports" },
        ],
      });

    expect(statement).not.toBeNull();

    const query: string = statement!.query;

    expect(query).toContain("argMin(");
    expect(query).toContain("GROUP BY cloudResourceId, providerResourceId");
    expect(query).not.toContain("orders-exports");

    const values: Array<unknown> = Object.values(statement!.query_params);

    expect(values).toContainEqual([...DATA_STORE_CREATE_OPERATIONS]);
    expect(values).toContainEqual(["cloud-resource-1"]);
    expect(values).toContainEqual([
      "arn:aws:s3:::orders-exports",
      "orders-exports",
    ]);
  });

  test("a store with no id to find it by asks nothing", () => {
    expect(
      DataSecurityStoreCreators.buildStatement({
        projectId: PROJECT,
        stores: [{ id: "a" }],
      }),
    ).toBeNull();
  });

  test("is batched, and a failed read names no creator and stops nothing", async () => {
    const stores: Array<StoreToFindCreatorOf> = [];

    for (
      let index: number = 0;
      index < MAX_STORES_PER_CREATOR_READ + 1;
      index++
    ) {
      stores.push({ id: `s${index}`, providerResourceId: `bucket-${index}` });
    }

    const execute: SpyInstance<typeof ChangeEventService.executeQuery> = jest
      .spyOn(ChangeEventService, "executeQuery")
      .mockRejectedValueOnce(new Error("ClickHouse is down") as never)
      .mockResolvedValueOnce({
        json: async () => {
          return {
            data: [
              {
                cloudResourceId: "",
                providerResourceId: `bucket-${MAX_STORES_PER_CREATOR_READ}`,
                creator: "arn:aws:iam::1:user/carol",
              },
            ],
          };
        },
      } as never);

    const creators: Map<string, string> = await DataSecurityStoreCreators.read({
      projectId: PROJECT,
      stores,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(creators)).toEqual({
      [`s${MAX_STORES_PER_CREATOR_READ}`]: "user/carol",
    });
  });
});
