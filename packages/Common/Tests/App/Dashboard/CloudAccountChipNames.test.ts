import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  CloudAccountEnvironment,
  CloudAccountName,
  getCloudAccountColumnQueryValue,
  getCloudAccountFacetOptions,
  getCloudAccountIdsInEveryCase,
  getEnvironmentIdsForAccounts,
  getResourcesCloudAccountFacet,
  CLOUD_ACCOUNT_FACET_KEY,
  CLOUD_ACCOUNT_FACET_LABEL,
  CLOUD_ACCOUNT_FACET_OPERATORS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import { fetchEnvironmentCloudAccountOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountOptions";
import {
  CLOUD_RESOURCE_ACCOUNT_MAX_READS,
  CLOUD_RESOURCE_ACCOUNT_READ_SIZE,
  fetchCloudAccountNames,
  fetchCloudResourceAccounts,
  fetchResourcesCloudAccountOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAccountChipReads";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";

/*
 * THE CLOUD ACCOUNT CHIP NAMES ITS ACCOUNTS, AND FINDS EVERY ACCOUNT'S ROWS
 * WHICHEVER WAY ITS ID IS WRITTEN (#6149's follow-up).
 *
 * The chip on App Platforms' All Environments and All Apps, and now on
 * Cloud's All Resources, listed raw account ids: "123456789012",
 * "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b". Each account is offered by the
 * name Cloud > Accounts gives it - its cloud's own name until someone
 * renames it - with its id under it, where the reader may read the
 * accounts; a reader who may not, and an account no connection reads,
 * keep the id. The chip asks for each id as written and in lower and upper
 * case: an Azure subscription's id is written both ways, and the server
 * counts both as one account (CloudAccountScope).
 *
 * All Resources' accounts are found from its resources a few rows at a
 * time, each read leaving out the accounts already found, so a list of
 * thousands of resources costs a read per account, not a read of every
 * row.
 */

type Args = Record<string, any>;

const AWS_ACCOUNT: string = "123456789012";
const OTHER_AWS_ACCOUNT: string = "999999999999";
const AZURE_SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const GCP_PROJECT: string = "shop-prod";

function name(
  provider: string,
  accountId: string,
  text: string,
): CloudAccountName {
  return { provider, accountId, name: text };
}

function environment(
  provider: string,
  accountId: string | undefined,
): CloudAccountEnvironment {
  return { cloudProvider: provider, cloudAccountId: accountId };
}

function shapes(
  options: Array<FilterChipDropdownOption>,
): Array<Array<string | undefined>> {
  return options.map(
    (option: FilterChipDropdownOption): Array<string | undefined> => {
      return [option.value, option.label, option.sublabel, option.group];
    },
  );
}

// What an Includes or IncludesNone holds, as strings.
function valuesOf(value: unknown): Array<string> {
  return ((value as Includes).values as Array<unknown>).map(
    (item: unknown): string => {
      return String(item);
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each account by its name", () => {
  test("as Cloud > Accounts names it, its id under it; an account it does not name keeps its id; by cloud, then by what each says", () => {
    const options: Array<FilterChipDropdownOption> =
      getCloudAccountFacetOptions(
        [
          environment("aws", AWS_ACCOUNT),
          environment("aws", OTHER_AWS_ACCOUNT),
          environment("gcp", GCP_PROJECT),
          environment("azure", AZURE_SUBSCRIPTION),
        ],
        [
          name("aws", AWS_ACCOUNT, "Production"),
          name("azure", AZURE_SUBSCRIPTION, "Contoso production"),
          name("gcp", GCP_PROJECT, "Shop"),
        ],
      );

    expect(shapes(options)).toEqual([
      [OTHER_AWS_ACCOUNT, OTHER_AWS_ACCOUNT, undefined, "AWS"],
      [AWS_ACCOUNT, "Production", AWS_ACCOUNT, "AWS"],
      [AZURE_SUBSCRIPTION, "Contoso production", AZURE_SUBSCRIPTION, "Azure"],
      [GCP_PROJECT, "Shop", GCP_PROJECT, "Google Cloud"],
    ]);
  });

  test("the value is always the id the rows hold: picking a name filters by its account", () => {
    const [option] = getCloudAccountFacetOptions(
      [environment("aws", AWS_ACCOUNT)],
      [name("aws", AWS_ACCOUNT, "Production")],
    );

    expect(option!.value).toBe(AWS_ACCOUNT);
    expect(
      valuesOf(getCloudAccountColumnQueryValue([option!.value], "is")),
    ).toEqual([AWS_ACCOUNT]);
  });

  test("another cloud's account of the same id lends it no name", () => {
    expect(
      shapes(
        getCloudAccountFacetOptions(
          [environment("aws", AWS_ACCOUNT)],
          [name("gcp", AWS_ACCOUNT, "A Google Cloud project")],
        ),
      ),
    ).toEqual([[AWS_ACCOUNT, AWS_ACCOUNT, undefined, "AWS"]]);
  });

  test("an id written in another case is the same account: named all the same, and offered once", () => {
    const upper: string = AZURE_SUBSCRIPTION.toUpperCase();

    expect(
      shapes(
        getCloudAccountFacetOptions(
          [
            environment("azure", upper),
            environment("azure", AZURE_SUBSCRIPTION),
            environment("azure", ` ${upper} `),
          ],
          [name("azure", AZURE_SUBSCRIPTION, "Contoso production")],
        ),
      ),
    ).toEqual([[upper, "Contoso production", upper, "Azure"]]);
  });

  test("a name that is only the id again, or blank, says nothing: the id alone", () => {
    expect(
      shapes(
        getCloudAccountFacetOptions(
          [environment("aws", AWS_ACCOUNT), environment("gcp", GCP_PROJECT)],
          [
            name("aws", AWS_ACCOUNT, AWS_ACCOUNT),
            name("gcp", GCP_PROJECT, "   "),
          ],
        ),
      ),
    ).toEqual([
      [AWS_ACCOUNT, AWS_ACCOUNT, undefined, "AWS"],
      [GCP_PROJECT, GCP_PROJECT, undefined, "Google Cloud"],
    ]);
  });

  test("a name is drawn as Cloud > Accounts keeps it, trimmed; the first of two names for one account wins", () => {
    expect(
      shapes(
        getCloudAccountFacetOptions(
          [environment("aws", AWS_ACCOUNT)],
          [
            name("aws", AWS_ACCOUNT, "  Production  "),
            name("aws", AWS_ACCOUNT, "Staging"),
          ],
        ),
      ),
    ).toEqual([[AWS_ACCOUNT, "Production", AWS_ACCOUNT, "AWS"]]);
  });

  test("with no names to read, the chip is what it was: each id, under its cloud", () => {
    expect(
      shapes(
        getCloudAccountFacetOptions([
          environment("aws", AWS_ACCOUNT),
          environment("gcp", GCP_PROJECT),
          environment("aws", undefined),
        ]),
      ),
    ).toEqual([
      [AWS_ACCOUNT, AWS_ACCOUNT, undefined, "AWS"],
      [GCP_PROJECT, GCP_PROJECT, undefined, "Google Cloud"],
    ]);
  });
});

describe("an account's rows, whichever way its id is written", () => {
  test("each id picked, as written and in lower and upper case, once", () => {
    expect(
      getCloudAccountIdsInEveryCase([
        AZURE_SUBSCRIPTION,
        "Shop-Prod",
        AWS_ACCOUNT,
        ` ${AWS_ACCOUNT} `,
      ]),
    ).toEqual([
      AZURE_SUBSCRIPTION,
      AZURE_SUBSCRIPTION.toUpperCase(),
      "Shop-Prod",
      "shop-prod",
      "SHOP-PROD",
      AWS_ACCOUNT,
    ]);
  });

  test("a blank pick matches no account rather than lifting the chip", () => {
    expect(getCloudAccountIdsInEveryCase(["", "  "])).toEqual([""]);
    expect(valuesOf(getCloudAccountColumnQueryValue([" "], "is"))).toEqual([
      "",
    ]);
  });

  test("'is' asks for one of them, 'is not' for none of them", () => {
    const is: unknown = getCloudAccountColumnQueryValue(
      [AZURE_SUBSCRIPTION],
      "is",
    );
    const isNot: unknown = getCloudAccountColumnQueryValue(
      [AZURE_SUBSCRIPTION],
      "is_not",
    );

    expect(is).toBeInstanceOf(Includes);
    expect(valuesOf(is)).toEqual([
      AZURE_SUBSCRIPTION,
      AZURE_SUBSCRIPTION.toUpperCase(),
    ]);
    expect(isNot).toBeInstanceOf(IncludesNone);
    expect(valuesOf(isNot)).toEqual(valuesOf(is));
  });

  test("All Apps keeps the environments of an account written in another case", () => {
    const environments: Map<string, CloudAccountEnvironment> = new Map<
      string,
      CloudAccountEnvironment
    >([
      [
        "71000000-0000-4000-8000-000000000001",
        environment("azure", AZURE_SUBSCRIPTION.toUpperCase()),
      ],
      [
        "71000000-0000-4000-8000-000000000002",
        environment("azure", AZURE_SUBSCRIPTION),
      ],
      ["71000000-0000-4000-8000-000000000003", environment("aws", AWS_ACCOUNT)],
    ]);

    expect(
      getEnvironmentIdsForAccounts({
        environments,
        accountIds: [AZURE_SUBSCRIPTION],
        operator: "is",
      }),
    ).toEqual([
      "71000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000002",
    ]);
    expect(
      getEnvironmentIdsForAccounts({
        environments,
        accountIds: [AZURE_SUBSCRIPTION.toUpperCase()],
        operator: "is_not",
      }),
    ).toEqual(["71000000-0000-4000-8000-000000000003"]);
  });
});

describe("All Resources' chip", () => {
  test("filters the list's own account column, one of the accounts or none of them, its options read once", async () => {
    const options: Array<FilterChipDropdownOption> = [
      { value: AWS_ACCOUNT, label: "Production" },
    ];
    const facet: ResourceFacet = getResourcesCloudAccountFacet(
      async (): Promise<Array<FilterChipDropdownOption>> => {
        return options;
      },
    );

    expect(facet.key).toBe(CLOUD_ACCOUNT_FACET_KEY);
    expect(facet.label).toBe(CLOUD_ACCOUNT_FACET_LABEL);
    expect(facet.isMultiSelect).toBe(true);
    expect(facet.supportedOperators).toEqual(CLOUD_ACCOUNT_FACET_OPERATORS);
    expect(facet.queryField).toBeUndefined();
    expect(facet.options).toBeUndefined();
    expect(facet.loadOptions).toBeUndefined();
    expect(await facet.fetchOptions!(undefined as never)).toBe(options);
    expect(valuesOf(facet.toQueryValue!(["Shop-Prod"], "is"))).toEqual([
      "Shop-Prod",
      "shop-prod",
      "SHOP-PROD",
    ]);
    expect(facet.toQueryValue!([AWS_ACCOUNT], "is_not")).toBeInstanceOf(
      IncludesNone,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The reads
 * ---------------------------------------------------------------------------
 */

interface StoredResource {
  cloudProvider: string;
  cloudAccountId: string | null;
  cloudResourceKind: string;
  isArchived: boolean;
}

/*
 * A server's answer to the chip's reads: Cloud Accounts as stored, and Cloud
 * Resources filtered as the query asks - its kind, whether archived, and an
 * IncludesNone of account ids, which NOT IN answers (a row with no account
 * is never in it) - a page at a time, in the order stored.
 */
function answerReads(data: {
  accounts?: Array<CloudAccountName>;
  resources?: Array<StoredResource>;
  refuseAccounts?: boolean;
  ignoreExclusions?: boolean;
}): { reads: Array<Args> } {
  const reads: Array<Args> = [];

  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (args: Args): Promise<unknown> => {
      reads.push(args);

      if (args["modelType"] === CloudAccount) {
        if (data.refuseAccounts) {
          throw new HTTPErrorResponse(
            422,
            {
              message:
                "You do not have permissions to read Cloud Account. You need one of these permissions: Read Cloud Resource",
            },
            {},
          );
        }

        const rows: Array<CloudAccount> = (data.accounts || []).map(
          (account: CloudAccountName): CloudAccount => {
            const row: CloudAccount = new CloudAccount();
            Object.assign(row, {
              provider: account.provider,
              accountId: account.accountId,
              name: account.name,
            });
            return row;
          },
        );

        return {
          data: rows,
          count: rows.length,
          skip: 0,
          limit: args["limit"],
        };
      }

      const query: Args = args["query"] || {};
      const excluded: Array<string> =
        query["cloudAccountId"] instanceof IncludesNone &&
        !data.ignoreExclusions
          ? (query["cloudAccountId"].values as Array<string>)
          : [];
      const matching: Array<StoredResource> = (data.resources || []).filter(
        (resource: StoredResource): boolean => {
          if (
            query["cloudResourceKind"] !== undefined &&
            resource.cloudResourceKind !== query["cloudResourceKind"]
          ) {
            return false;
          }

          if (
            query["isArchived"] !== undefined &&
            resource.isArchived !== query["isArchived"]
          ) {
            return false;
          }

          if (query["cloudAccountId"] instanceof IncludesNone) {
            return (
              resource.cloudAccountId !== null &&
              (data.ignoreExclusions ||
                !excluded.includes(resource.cloudAccountId))
            );
          }

          return true;
        },
      );
      const page: Array<CloudResource> = matching
        .slice(0, args["limit"])
        .map((resource: StoredResource): CloudResource => {
          const row: CloudResource = new CloudResource();
          Object.assign(row, {
            cloudProvider: resource.cloudProvider,
            cloudAccountId: resource.cloudAccountId,
          });
          return row;
        });

      return {
        data: page,
        count: matching.length,
        skip: 0,
        limit: args["limit"],
      };
    },
  );

  return { reads };
}

function resources(
  count: number,
  provider: string,
  accountId: string | null,
  fields: Partial<StoredResource> = {},
): Array<StoredResource> {
  return Array.from({ length: count }, (): StoredResource => {
    return {
      cloudProvider: provider,
      cloudAccountId: accountId,
      cloudResourceKind: CloudResourceKind.Resource,
      isArchived: false,
      ...fields,
    };
  });
}

function accountReads(reads: Array<Args>): Array<Args> {
  return reads.filter((read: Args): boolean => {
    return read["modelType"] === CloudAccount;
  });
}

function resourceReads(reads: Array<Args>): Array<Args> {
  return reads.filter((read: Args): boolean => {
    return read["modelType"] === CloudResource;
  });
}

describe("the names, read as the reader may", () => {
  test("every account's cloud, id and name, and nothing else of it", async () => {
    const { reads } = answerReads({
      accounts: [
        name("aws", AWS_ACCOUNT, "Production"),
        name("azure", AZURE_SUBSCRIPTION, "Contoso production"),
        name("gcp", "", "A project with no id"),
        name("gcp", GCP_PROJECT, ""),
      ],
    });

    expect(await fetchCloudAccountNames()).toEqual([
      name("aws", AWS_ACCOUNT, "Production"),
      name("azure", AZURE_SUBSCRIPTION, "Contoso production"),
    ]);

    const [read] = accountReads(reads);
    expect(read!["select"]).toEqual({
      provider: true,
      accountId: true,
      name: true,
    });
    expect(read!["query"]).toEqual({});
    expect(read!["limit"]).toBe(LIMIT_PER_PROJECT);
  });

  test("a reader who may not read Cloud Accounts gets no names, and the chip its ids, as before", async () => {
    answerReads({
      refuseAccounts: true,
      resources: [...resources(2, "aws", AWS_ACCOUNT)],
    });

    expect(await fetchCloudAccountNames()).toEqual([]);
    expect(shapes(await fetchResourcesCloudAccountOptions())).toEqual([
      [AWS_ACCOUNT, AWS_ACCOUNT, undefined, "AWS"],
    ]);
  });
});

describe("All Resources' accounts, found a few rows at a time", () => {
  test("each account its resources are in, once - archived resources, environments and rows with no account left out", async () => {
    const { reads } = answerReads({
      resources: [
        ...resources(250, "aws", AWS_ACCOUNT),
        ...resources(3, "azure", AZURE_SUBSCRIPTION),
        // The same subscription, as another API writes its id.
        ...resources(2, "azure", AZURE_SUBSCRIPTION.toUpperCase()),
        ...resources(4, "gcp", null),
        ...resources(1, "gcp", "archived-project", { isArchived: true }),
        ...resources(1, "aws", OTHER_AWS_ACCOUNT, {
          cloudResourceKind: CloudResourceKind.Environment,
        }),
        ...resources(1, "gcp", GCP_PROJECT),
      ],
    });

    expect(await fetchCloudResourceAccounts()).toEqual([
      { cloudProvider: "aws", cloudAccountId: AWS_ACCOUNT },
      { cloudProvider: "azure", cloudAccountId: AZURE_SUBSCRIPTION },
      { cloudProvider: "gcp", cloudAccountId: GCP_PROJECT },
    ]);

    const asked: Array<Args> = resourceReads(reads);

    // A read for the first hundred rows, then one leaving out the account they were all in.
    expect(asked).toHaveLength(2);
    for (const read of asked) {
      expect(read["query"]["isArchived"]).toBe(false);
      expect(read["query"]["cloudResourceKind"]).toBe(
        CloudResourceKind.Resource,
      );
      expect(read["select"]).toEqual({
        cloudProvider: true,
        cloudAccountId: true,
      });
      expect(read["limit"]).toBe(CLOUD_RESOURCE_ACCOUNT_READ_SIZE);
      expect(read["query"]["cloudAccountId"]).toBeInstanceOf(IncludesNone);
    }
    // The first leaves out only rows that name no account.
    expect(valuesOf(asked[0]!["query"]["cloudAccountId"])).toEqual([""]);
    // The next, every way the account found is written too.
    expect(valuesOf(asked[1]!["query"]["cloudAccountId"]).sort()).toEqual(
      ["", AWS_ACCOUNT].sort(),
    );
  });

  test("a read per account at most: a project of many accounts stops at the last of its reads", async () => {
    const { reads } = answerReads({
      resources: Array.from(
        { length: CLOUD_RESOURCE_ACCOUNT_MAX_READS + 5 },
        (_value: unknown, index: number): Array<StoredResource> => {
          return resources(
            CLOUD_RESOURCE_ACCOUNT_READ_SIZE + 10,
            "aws",
            String(100000000000 + index),
          );
        },
      ).flat(),
    });

    const found: Array<CloudAccountEnvironment> =
      await fetchCloudResourceAccounts();

    expect(resourceReads(reads)).toHaveLength(CLOUD_RESOURCE_ACCOUNT_MAX_READS);
    expect(found).toHaveLength(CLOUD_RESOURCE_ACCOUNT_MAX_READS);
  });

  test("a project with a few small accounts is read once", async () => {
    const { reads } = answerReads({
      resources: [
        ...resources(5, "aws", AWS_ACCOUNT),
        ...resources(5, "aws", OTHER_AWS_ACCOUNT),
        ...resources(5, "gcp", GCP_PROJECT),
      ],
    });

    expect(await fetchCloudResourceAccounts()).toHaveLength(3);
    expect(resourceReads(reads)).toHaveLength(1);
  });

  test("an answer that brings nothing new ends the reads: no endless asking", async () => {
    const { reads } = answerReads({
      ignoreExclusions: true,
      resources: resources(
        CLOUD_RESOURCE_ACCOUNT_READ_SIZE,
        "aws",
        AWS_ACCOUNT,
      ),
    });

    expect(await fetchCloudResourceAccounts()).toEqual([
      { cloudProvider: "aws", cloudAccountId: AWS_ACCOUNT },
    ]);
    expect(resourceReads(reads)).toHaveLength(2);
  });

  test("an empty list has no accounts, after one read", async () => {
    const { reads } = answerReads({ resources: [] });

    expect(await fetchCloudResourceAccounts()).toEqual([]);
    expect(resourceReads(reads)).toHaveLength(1);
  });

  test("the chip's options: the accounts found, named where the reader may read the names", async () => {
    answerReads({
      accounts: [
        name("aws", AWS_ACCOUNT, "Production"),
        name("azure", AZURE_SUBSCRIPTION, "Contoso production"),
      ],
      resources: [
        ...resources(2, "aws", AWS_ACCOUNT),
        ...resources(1, "azure", AZURE_SUBSCRIPTION),
        ...resources(1, "gcp", GCP_PROJECT),
      ],
    });

    expect(shapes(await fetchResourcesCloudAccountOptions())).toEqual([
      [AWS_ACCOUNT, "Production", AWS_ACCOUNT, "AWS"],
      [AZURE_SUBSCRIPTION, "Contoso production", AZURE_SUBSCRIPTION, "Azure"],
      [GCP_PROJECT, GCP_PROJECT, undefined, "Google Cloud"],
    ]);
  });
});

describe("All Environments' accounts", () => {
  test("the environments' accounts, named, from one read of the environments and one of the names", async () => {
    const { reads } = answerReads({
      accounts: [name("aws", AWS_ACCOUNT, "Production")],
      resources: [
        ...resources(1, "aws", AWS_ACCOUNT, {
          cloudResourceKind: CloudResourceKind.Environment,
        }),
        ...resources(1, "gcp", GCP_PROJECT, {
          cloudResourceKind: CloudResourceKind.Environment,
        }),
      ],
    });

    expect(shapes(await fetchEnvironmentCloudAccountOptions())).toEqual([
      [AWS_ACCOUNT, "Production", AWS_ACCOUNT, "AWS"],
      [GCP_PROJECT, GCP_PROJECT, undefined, "Google Cloud"],
    ]);
    expect(accountReads(reads)).toHaveLength(1);
    expect(resourceReads(reads)).toHaveLength(1);
    expect(resourceReads(reads)[0]!["query"]).toEqual({
      isArchived: false,
      cloudResourceKind: CloudResourceKind.Environment,
    });
  });

  test("names that cannot be read leave the environments' accounts as ids", async () => {
    answerReads({
      refuseAccounts: true,
      resources: resources(1, "aws", AWS_ACCOUNT, {
        cloudResourceKind: CloudResourceKind.Environment,
      }),
    });

    expect(shapes(await fetchEnvironmentCloudAccountOptions())).toEqual([
      [AWS_ACCOUNT, AWS_ACCOUNT, undefined, "AWS"],
    ]);
  });
});
