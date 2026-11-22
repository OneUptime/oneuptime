import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CrowdStrikeBlockDestinationSource,
  MicrosoftDefenderBlockDestinationSource,
  resetEndpointBlockTransportForTests,
  setEndpointBlockTransportForTests,
} from "../../../../Server/Utils/SecurityBlocklist/Destinations/EndpointBlockDestinationSources";
import SecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityBlockIndicatorType } from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlockHolder } from "../../../../Types/SecurityBlocklist/SecurityBlockHolders";
import { BLOCK_INDICATORS_KEY } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where a project's blocklist is enforced on every machine (#10346): one
 * destination per Microsoft Defender XDR or CrowdStrike Falcon connection
 * whose blocking switch is on - the opt-in - and none for a connection
 * made to import alerts only. Finding them calls nothing.
 */

const PROJECT: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function connection(data: {
  id: string;
  name: string;
  provider: SecurityEventConnectorProvider;
  blocking: unknown;
}): SecurityEventConnection {
  const model: SecurityEventConnection = new SecurityEventConnection();
  model._id = data.id;
  model.name = data.name;
  model.provider = data.provider;
  model.config = {
    tenantId: "tenant-1",
    clientId: "client-1",
    ...(data.blocking === undefined
      ? {}
      : { [BLOCK_INDICATORS_KEY]: data.blocking }),
  } as JSONObject;
  return model;
}

// The project's connections to a product: two blocking, one reading, one turned off.
function connectionsOf(
  provider: SecurityEventConnectorProvider,
): Array<SecurityEventConnection> {
  return [
    connection({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Production",
      provider,
      blocking: true,
    }),
    connection({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "EU",
      provider,
      blocking: true,
    }),
    // A switch is turned on, never written: text that says so is not the switch.
    connection({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Written by hand",
      provider,
      blocking: "true",
    }),
    connection({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Alerts only",
      provider,
      blocking: undefined,
    }),
    connection({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Turned off",
      provider,
      blocking: false,
    }),
  ];
}

let asked: Array<JSONObject>;
let requests: Array<DataSourceHttpRequest>;
let found: (
  provider: SecurityEventConnectorProvider,
) => Array<SecurityEventConnection>;

beforeEach(() => {
  asked = [];
  requests = [];
  found = connectionsOf;

  jest.spyOn(SecurityEventConnectionService, "findBy").mockImplementation(((
    args: unknown,
  ): Promise<Array<SecurityEventConnection>> => {
    const query: JSONObject = (args as { query: JSONObject }).query;
    asked.push(query);

    return Promise.resolve(
      found(query["provider"] as SecurityEventConnectorProvider),
    );
  }) as never);
  jest
    .spyOn(SecurityEventConnectionService, "getConnectorSettings")
    .mockImplementation(((model: SecurityEventConnection) => {
      return Promise.resolve({
        provider: model.provider!,
        config: model.config || {},
        secrets: { clientSecret: "SECRET" },
        alertingOnly: true,
      });
    }) as never);

  setEndpointBlockTransportForTests(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      throw new Error("No call leaves a test.");
    },
  );
});

afterEach(() => {
  resetEndpointBlockTransportForTests();
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("the endpoint destinations a project has", () => {
  test("one Microsoft Defender destination per connection with its switch on, named by its connection when there are more", async () => {
    const destinations: Array<SecurityBlockDestination> =
      await MicrosoftDefenderBlockDestinationSource.findForProject(PROJECT);

    expect(asked).toEqual([
      {
        projectId: PROJECT,
        provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      },
    ]);
    expect(
      destinations.map((destination: SecurityBlockDestination) => {
        return [
          destination.key,
          destination.name,
          destination.provider,
          destination.enforcesOnEveryMachine,
        ];
      }),
    ).toEqual([
      [
        "MicrosoftDefender:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "Microsoft Defender (Production)",
        SecurityBlockDestinationProvider.MicrosoftDefender,
        true,
      ],
      [
        "MicrosoftDefender:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "Microsoft Defender (EU)",
        SecurityBlockDestinationProvider.MicrosoftDefender,
        true,
      ],
    ]);
    // Finding them calls nothing.
    expect(requests).toEqual([]);
  });

  test("one CrowdStrike destination per connection with its switch on, calling through the connection's own client", async () => {
    const destinations: Array<SecurityBlockDestination> =
      await CrowdStrikeBlockDestinationSource.findForProject(PROJECT);

    expect(asked[0]!["provider"]).toBe(
      SecurityEventConnectorProvider.CrowdStrikeFalcon,
    );
    expect(
      destinations.map((destination: SecurityBlockDestination): string => {
        return destination.name;
      }),
    ).toEqual(["CrowdStrike Falcon (Production)", "CrowdStrike Falcon (EU)"]);

    // The transport every client calls through is the one set for tests.
    await expect(destinations[0]!.readBack()).rejects.toThrow();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]!.url).toContain("crowdstrike.com");
  });

  test("a project with one blocking connection names the product alone; one with none has no destination", async () => {
    found = (
      provider: SecurityEventConnectorProvider,
    ): Array<SecurityEventConnection> => {
      return connectionsOf(provider).slice(0, 1);
    };

    expect(
      (
        await MicrosoftDefenderBlockDestinationSource.findForProject(PROJECT)
      ).map((destination: SecurityBlockDestination): string => {
        return destination.name;
      }),
    ).toEqual(["Microsoft Defender"]);

    found = (
      provider: SecurityEventConnectorProvider,
    ): Array<SecurityEventConnection> => {
      return connectionsOf(provider).slice(2);
    };

    // None of the rest has the switch on.

    expect(
      await CrowdStrikeBlockDestinationSource.findForProject(PROJECT),
    ).toEqual([]);
  });

  test("what the project's destinations hold: domains, URLs, addresses and files with Defender, SHA-256 and MD5 files with CrowdStrike", async () => {
    SecurityBlockDestinations.resetSourcesForTests();
    found = (
      provider: SecurityEventConnectorProvider,
    ): Array<SecurityEventConnection> => {
      return connectionsOf(provider).slice(0, 1);
    };

    const holders: Array<SecurityBlockHolder> =
      SecurityBlockDestinations.getHolders(
        (await SecurityBlockDestinations.findForProject(PROJECT)).destinations,
      );

    expect(holders).toEqual(
      expect.arrayContaining([
        {
          name: "Microsoft Defender",
          provider: SecurityBlockDestinationProvider.MicrosoftDefender,
          enforcesOnEveryMachine: true,
          blocks: [
            SecurityBlockIndicatorType.IpAddress,
            SecurityBlockIndicatorType.Domain,
            SecurityBlockIndicatorType.Url,
            SecurityBlockIndicatorType.FileSha256,
            SecurityBlockIndicatorType.FileSha1,
            SecurityBlockIndicatorType.FileMd5,
          ],
          quarantinesFiles: true,
        },
        {
          name: "CrowdStrike Falcon",
          provider: SecurityBlockDestinationProvider.CrowdStrike,
          enforcesOnEveryMachine: true,
          blocks: [
            SecurityBlockIndicatorType.FileSha256,
            SecurityBlockIndicatorType.FileMd5,
          ],
          quarantinesFiles: false,
        },
      ]),
    );
    expect(requests).toEqual([]);
  });
});
