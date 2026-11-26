import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  buildAzureInventoryQuery,
  buildAzureSubnetQuery,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureInventory";
import { kql } from "../../../../Server/Utils/CloudConnection/Azure/AzureKql";
import { AZURE_DATA_SECURITY_QUERY } from "../../../../Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityReader";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import {
  RESOURCE_GRAPH_MAX_MV_EXPAND_ROW_LIMIT,
  kqlSyntaxProblems,
  operatorsOf,
  resourceGraphProblems,
} from "./AzureKqlGrammar";
import {
  RECORDED_PARSER_FAILURE,
  strictResourceGraph,
} from "./StrictResourceGraph";

/*
 * EVERY RESOURCE GRAPH QUERY AN AZURE CONNECTION SENDS, READ BY MICROSOFT'S
 * OWN PARSER (#11142).
 *
 * Testing an Azure connection said "Could not list the subnets: Azure
 * resource graph query failed with HTTP 400", and Resource Graph's answer
 * named a ParserFailure at line 3, character 18. Line 3 of the subnet query
 * that shipped in 16.0.0 (#9375) was
 *
 *   | mv-expand limit 2000 subnet = properties.subnets
 *
 * and mv-expand's syntax names what it expands first and its row limit
 * last: `mv-expand subnet = properties.subnets limit 2000`. Resource Graph
 * read `limit` as the name of a column to expand and met 2000 where a
 * comma, `to typeof(...)`, `limit` or the next "|" must follow - character
 * 18, counted from 0 as its parser counts. No subnet was ever listed.
 *
 * The suites before this one held the query to its own text, the mistake
 * included, and their fake Resource Graph answered every query it was sent.
 * Here each query is read by Kusto.Language (AzureKqlGrammar) - parsed,
 * bound against Resource Graph's Resources table, and held to the
 * operators and limits Resource Graph documents - so a query Resource
 * Graph would refuse fails here first.
 */

// The subnet query as 16.0.0 to 17.3.0 sent it, which Resource Graph refused.
const SHIPPED_SUBNET_QUERY: string = [
  "Resources",
  "| where type =~ 'microsoft.network/virtualnetworks'",
  "| mv-expand limit 2000 subnet = properties.subnets",
  "| where isnotempty(tostring(subnet.id))",
  "| project id = tostring(subnet.id), name = strcat(name, '/', tostring(subnet.name)), type = 'microsoft.network/virtualnetworks/subnets', location, resourceGroup, subscriptionId,",
  "  provisioningState = tostring(subnet.properties.provisioningState),",
  "  addressPrefix = tostring(subnet.properties.addressPrefix),",
  "  addressPrefixes = subnet.properties.addressPrefixes,",
  "  networkSecurityGroupId = tostring(subnet.properties.networkSecurityGroup.id),",
  "  routeTableId = tostring(subnet.properties.routeTable.id),",
  "  delegations = subnet.properties.delegations",
].join("\n");

const QUERIES: Array<[string, () => string]> = [
  [
    "the inventory's query",
    (): string => {
      return String(buildAzureInventoryQuery());
    },
  ],
  [
    "the subnet query",
    (): string => {
      return String(buildAzureSubnetQuery());
    },
  ],
  [
    "Data Security's query of the data stores",
    (): string => {
      return String(AZURE_DATA_SECURITY_QUERY);
    },
  ],
];

describe("the subnet query that shipped in 16.0.0", () => {
  test("is refused by Microsoft's parser on its third line, where mv-expand's limit comes before what it expands", () => {
    const problems: Array<string> = kqlSyntaxProblems(SHIPPED_SUBNET_QUERY);

    expect(problems.length).toBeGreaterThan(0);

    for (const problem of problems) {
      expect(problem).toMatch(/^line 3, character \d+: /);
    }

    expect(problems[0]).toContain("the keyword 'limit'");
    // A query that does not parse is not bound: its syntax is all that is said of it.
    expect(resourceGraphProblems(SHIPPED_SUBNET_QUERY)).toEqual(problems);
  });

  test("character 18 of line 3, where Resource Graph's parser stopped, is the 2000 it met after reading limit as a column", () => {
    const line: string = SHIPPED_SUBNET_QUERY.split("\n")[2]!;

    expect(line).toBe("| mv-expand limit 2000 subnet = properties.subnets");
    expect(line.slice(0, 18)).toBe("| mv-expand limit ");
    expect(line.slice(18)).toMatch(/^2000 /);
  });

  test("with its row limit last, as mv-expand's syntax writes it, the same query is one Resource Graph runs", () => {
    const fixed: string = SHIPPED_SUBNET_QUERY.replace(
      "| mv-expand limit 2000 subnet = properties.subnets",
      "| mv-expand subnet = properties.subnets limit 2000",
    );

    expect(fixed).not.toBe(SHIPPED_SUBNET_QUERY);
    expect(resourceGraphProblems(fixed)).toEqual([]);
  });

  test("without a row limit it parses, but Resource Graph would expand only 128 subnets of a network", () => {
    const unlimited: string = SHIPPED_SUBNET_QUERY.replace(
      "| mv-expand limit 2000 subnet = properties.subnets",
      "| mv-expand subnet = properties.subnets",
    );

    expect(kqlSyntaxProblems(unlimited)).toEqual([]);
    expect(resourceGraphProblems(unlimited)).toEqual([
      "line 3, character 2: mv-expand states no row limit, and Resource Graph expands 128 rows of a row unless it does.",
    ]);
  });
});

describe("every Resource Graph query OneUptime builds is one Resource Graph runs", () => {
  test.each(QUERIES)(
    "%s parses, binds against the Resources table and keeps to Resource Graph's operators and limits",
    (_name: string, build: () => string) => {
      expect(resourceGraphProblems(build())).toEqual([]);
    },
  );

  test.each(QUERIES)(
    "%s is the same text each time it is built",
    (_name: string, build: () => string) => {
      expect(build()).toBe(build());
    },
  );

  test("the subnet query expands each network's subnets once, up to Resource Graph's most, then keeps and shapes them", () => {
    const query: string = String(buildAzureSubnetQuery());

    expect(operatorsOf(query)).toEqual([
      "where",
      "mv-expand",
      "where",
      "project",
    ]);
    expect(query).toContain(
      `| mv-expand subnet = properties.subnets limit ${RESOURCE_GRAPH_MAX_MV_EXPAND_ROW_LIMIT}`,
    );
    expect(query).not.toContain("mv-expand limit");
  });

  test("the inventory's query and Data Security's filter and project, and expand nothing", () => {
    expect(operatorsOf(String(buildAzureInventoryQuery()))).toEqual([
      "where",
      "project",
    ]);
    expect(operatorsOf(String(AZURE_DATA_SECURITY_QUERY))).toEqual([
      "where",
      "where",
      "project",
    ]);
  });
});

describe("a Resource Graph that reads its queries (StrictResourceGraph)", () => {
  const ROWS: Array<JSONObject> = [{ id: "row-1" }];

  async function send(query: string): Promise<FakeResponse> {
    const request: DataSourceHttpRequest = {
      method: "POST",
      url: "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
      body: JSON.stringify({
        subscriptions: ["aaaaaaaa-0000-4000-8000-000000000001"],
        query,
        options: { $top: 1000, resultFormat: "objectArray" },
      }),
    };

    return await strictResourceGraph((): FakeResponse => {
      return json({ data: ROWS });
    })(request, new URL(request.url));
  }

  function detailsOf(response: FakeResponse): Array<JSONObject> {
    return ((response.body as JSONObject)["error"] as JSONObject)[
      "details"
    ] as Array<JSONObject>;
  }

  test("refuses the subnet query of 16.0.0 as Azure did: HTTP 400, the query invalid, a ParserFailure on line 3", async () => {
    const response: FakeResponse = await send(SHIPPED_SUBNET_QUERY);
    const recorded: Array<JSONObject> = (
      RECORDED_PARSER_FAILURE["error"] as JSONObject
    )["details"] as Array<JSONObject>;

    expect(response.status).toBe(400);
    expect(detailsOf(response)[0]).toEqual({
      code: "InvalidQuery",
      message: recorded[0]!["message"],
    });
    expect(detailsOf(response)[1]).toMatchObject({
      code: "ParserFailure",
      message: "ParserFailure",
      line: recorded[1]!["line"],
    });
    expect(recorded[1]!["line"]).toBe(3);
  });

  test("answers the subnet query OneUptime sends now with its rows", async () => {
    const response: FakeResponse = await send(String(buildAzureSubnetQuery()));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: ROWS });
  });

  test("refuses a query that parses but that Resource Graph would not run, saying why", async () => {
    const response: FakeResponse = await send(
      "Resources | mv-expand z = zones | project id",
    );

    expect(response.status).toBe(400);
    expect(detailsOf(response)[1]).toEqual({
      code: "InvalidQuery",
      message:
        "line 1, character 12: mv-expand states no row limit, and Resource Graph expands 128 rows of a row unless it does.",
    });
  });
});

describe("what AzureArm.queryResourceGraph sends", () => {
  const TENANT: string = "00000000-0000-4000-8000-000000000001";
  const PRODUCTION: string = "aaaaaaaa-0000-4000-8000-000000000001";
  const STAGING: string = "AAAAAAAA-0000-4000-8000-000000000002";

  function fakeAzure(): { api: FakeProviderApi; bodies: Array<JSONObject> } {
    const bodies: Array<JSONObject> = [];
    const api: FakeProviderApi = createFakeProviderApi([
      {
        host: "login.microsoftonline.com",
        path: `/${TENANT}/oauth2/v2.0/token`,
        method: "POST",
        respond: (): FakeResponse => {
          return json({ access_token: "arm-token", expires_in: 3599 });
        },
      },
      {
        host: "management.azure.com",
        path: "/providers/Microsoft.ResourceGraph/resources",
        method: "POST",
        respond: strictResourceGraph(
          (request: DataSourceHttpRequest): FakeResponse => {
            bodies.push(bodyOf(request));
            return json({ data: [{ id: "row-1" }] });
          },
        ),
      },
    ]);

    return { api, bodies };
  }

  function armOf(api: FakeProviderApi): AzureArm {
    return new AzureArm({
      tenantId: TENANT,
      clientId: "00000000-0000-4000-8000-000000000002",
      clientSecret: "secret-value-123",
      cloud: "public",
      transport: api.transport,
      sleep: async (): Promise<void> => {
        return undefined;
      },
    });
  }

  test("the query's own text, and the subscriptions in the request beside it - never in the query", async () => {
    const { api, bodies } = fakeAzure();
    const result: { rows: Array<JSONObject>; complete: boolean } = await armOf(
      api,
    ).queryResourceGraph({
      subscriptionIds: [` ${PRODUCTION} `, STAGING],
      query: buildAzureSubnetQuery(),
    });

    expect(result).toEqual({ rows: [{ id: "row-1" }], complete: true });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!["query"]).toBe(buildAzureSubnetQuery().toString());
    expect(bodies[0]!["subscriptions"]).toEqual([PRODUCTION, STAGING]);
    expect(String(bodies[0]!["query"])).not.toContain(PRODUCTION);
  });

  test.each([
    "",
    "not-a-guid",
    `${PRODUCTION}' | take 1`,
    "aaaaaaaa-0000-4000-\n8000-000000000001",
    "../../providers/Microsoft.Authorization",
  ])(
    "refuses the subscription %j before anything is sent",
    async (subscriptionId: string) => {
      const { api } = fakeAzure();

      await expect(
        armOf(api).queryResourceGraph({
          subscriptionIds: [PRODUCTION, subscriptionId],
          query: kql`Resources | project id`,
        }),
      ).rejects.toThrow(
        "Each subscription must be a GUID such as 00000000-0000-0000-0000-000000000000.",
      );
      expect(api.requests).toEqual([]);
    },
  );
});

describe("the reading of a query is strict enough to have caught it", () => {
  test("a column the Resources table does not have", () => {
    expect(
      resourceGraphProblems("Resources | project id, nmae").join("\n"),
    ).toContain("The name 'nmae' does not refer to any known column");
  });

  test("a function KQL does not have, and one called with the wrong arguments", () => {
    expect(
      resourceGraphProblems("Resources | project x = tostrnig(name)").join(
        "\n",
      ),
    ).toContain("tostrnig");
    expect(
      resourceGraphProblems("Resources | project x = strcat()").length,
    ).toBeGreaterThan(0);
  });

  test("an operator KQL has but Resource Graph does not run", () => {
    expect(
      resourceGraphProblems("Resources | evaluate bag_unpack(properties)").join(
        "\n",
      ),
    ).toContain(
      "EvaluateOperator is not one of Resource Graph's tabular operators.",
    );
    expect(
      resourceGraphProblems("Resources | mv-apply z = zones on (take 1)").join(
        "\n",
      ),
    ).toContain(
      "MvApplyOperator is not one of Resource Graph's tabular operators.",
    );
  });

  test("a statement before the query", () => {
    expect(
      resourceGraphProblems("let x = 1;\nResources | project id").join("\n"),
    ).toContain("Resource Graph runs one query, not a LetStatement.");
  });

  test("an mv-expand row limit past Resource Graph's 2,000, and one that is no whole number", () => {
    expect(
      resourceGraphProblems(
        "Resources | mv-expand z = zones limit 2001 | project id",
      ),
    ).toEqual([
      "line 1, character 12: mv-expand's row limit is 2001; Resource Graph takes a whole number up to 2000.",
    ]);
    expect(
      resourceGraphProblems(
        "Resources | mv-expand z = zones limit 0 | project id",
      ),
    ).toEqual([
      "line 1, character 12: mv-expand's row limit is 0; Resource Graph takes a whole number up to 2000.",
    ]);
    expect(
      resourceGraphProblems(
        "Resources | mv-expand z = zones limit 2000 | project id",
      ),
    ).toEqual([]);
  });

  test("more mv-expand, or more join and union, than one query may hold", () => {
    expect(
      resourceGraphProblems(
        [
          "Resources",
          "| mv-expand a = zones limit 10",
          "| mv-expand b = zones limit 10",
          "| mv-expand c = zones limit 10",
          "| mv-expand d = zones limit 10",
          "| project id",
        ].join("\n"),
      ),
    ).toEqual(["The query holds 4 mv-expand; Resource Graph runs 3 at most."]);
    expect(
      resourceGraphProblems(
        [
          "Resources",
          "| union (Resources | where type == 'a')",
          "| union (Resources | where type == 'b')",
          "| union (Resources | where type == 'c')",
          "| union (Resources | where type == 'd')",
          "| project id",
        ].join("\n"),
      ),
    ).toEqual([
      "The query holds 4 join and union; Resource Graph runs 3 at most.",
    ]);
  });

  test("a literal that a line break ends early", () => {
    expect(
      kqlSyntaxProblems("Resources | where id =~ 'one\ntwo' | project id")
        .length,
    ).toBeGreaterThan(0);
  });
});
