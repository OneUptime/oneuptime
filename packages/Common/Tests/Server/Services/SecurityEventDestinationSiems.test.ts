import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import SecurityEventDestinationService, {
  Service as SecurityEventDestinationServiceClass,
} from "../../../Server/Services/SecurityEventDestinationService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DataSourceEgressGuard from "../../../Server/Utils/DataSource/EgressGuard";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../Types/Exception/EgressGuardException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { ConnectorField } from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { readSentinelCloud } from "../../../Server/Utils/SecurityEvent/Destinations/MicrosoftSentinel/MicrosoftSentinelSender";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Splunk, Microsoft Sentinel and Elastic Security as places OneUptime sends
 * to: each SIEM's settings are checked when a destination is saved - the
 * catalog's shape, then the SIEM's own rules - and an address a person
 * typed goes through the egress policy then, so a blocked address is a
 * form error, not a send that fails on every run.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43101",
);

const VALID: Record<string, { config: JSONObject; secrets: JSONObject }> = {
  [SecurityEventDestinationProvider.Splunk]: {
    config: { hecUrl: "https://splunk.example.com:8088", index: "security" },
    secrets: { hecToken: "00000000-1111-2222-3333-444444444444" },
  },
  [SecurityEventDestinationProvider.MicrosoftSentinel]: {
    config: {
      tenantId: "11111111-2222-3333-4444-555555555555",
      clientId: "66666666-7777-8888-9999-000000000000",
      logsIngestionEndpoint:
        "https://oneuptime-dce-ab12.eastus-1.ingest.monitor.azure.com",
      dcrImmutableId: "dcr-0123456789abcdef0123456789abcdef",
      cloud: "public",
    },
    secrets: { clientSecret: "s3cr3t" },
  },
  [SecurityEventDestinationProvider.ElasticSecurity]: {
    config: { elasticsearchUrl: "https://acme.es.us-east-1.aws.elastic.cloud" },
    secrets: { apiKey: "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWky" },
  },
};

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityEventDestination>,
  ) => Promise<OnCreate<SecurityEventDestination>>;
};

const service: HookCaller =
  SecurityEventDestinationService as unknown as HookCaller;

function createBy(
  provider: string,
  config: JSONObject,
  secrets: JSONObject,
): CreateBy<SecurityEventDestination> {
  const destination: SecurityEventDestination = new SecurityEventDestination();
  destination.projectId = PROJECT_ID;
  destination.name = "SIEM";
  destination.provider = provider as SecurityEventDestinationProvider;
  destination.config = config;
  destination.secrets = JSON.stringify(secrets);

  return {
    data: destination,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as CreateBy<SecurityEventDestination>;
}

let egressSpy: Spy;

beforeEach(() => {
  egressSpy = getJestSpyOn(
    DataSourceEgressGuard,
    "assertUrlAllowed",
  ).mockResolvedValue({
    url: new URL("https://x.example.com"),
    addresses: [],
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each new SIEM", () => {
  test.each([
    SecurityEventDestinationProvider.Splunk,
    SecurityEventDestinationProvider.MicrosoftSentinel,
    SecurityEventDestinationProvider.ElasticSecurity,
  ])(
    "%s saves with its settings, its address checked by the egress policy",
    async (provider: string) => {
      const valid: { config: JSONObject; secrets: JSONObject } =
        VALID[provider]!;

      await expect(
        service.onBeforeCreate(createBy(provider, valid.config, valid.secrets)),
      ).resolves.toBeDefined();

      const definition: SecurityEventDestinationDefinition =
        getSecurityEventDestinationDefinition(provider)!;
      const urlFields: Array<string> = definition.configFields
        .filter((field: { type: string }): boolean => {
          return field.type === "url";
        })
        .map((field: { key: string }): string => {
          return field.key;
        });

      expect(urlFields).toHaveLength(1);
      expect(egressSpy).toHaveBeenCalledWith(valid.config[urlFields[0]!], {
        targetLabel: definition.configFields.find(
          (field: { key: string }): boolean => {
            return field.key === urlFields[0];
          },
        )!.title,
      });
    },
  );

  test("an address the egress policy refuses is a form error", async () => {
    egressSpy.mockRejectedValue(
      new EgressGuardException(
        "HEC URL host 10.0.0.5 is not allowed.",
        EgressFailureReason.InvalidTarget,
      ) as never,
    );

    await expect(
      service.onBeforeCreate(
        createBy(
          SecurityEventDestinationProvider.Splunk,
          { hecUrl: "https://10.0.0.5:8088" },
          VALID[SecurityEventDestinationProvider.Splunk]!.secrets,
        ),
      ),
    ).rejects.toThrow("HEC URL host 10.0.0.5 is not allowed.");
  });

  test.each([
    [
      SecurityEventDestinationProvider.Splunk,
      { hecUrl: "http://splunk.example.com:8088" },
      "HEC URL must start with https://",
    ],
    [
      SecurityEventDestinationProvider.MicrosoftSentinel,
      { dcrImmutableId: "rule-1" },
      "immutable ID must look like dcr-",
    ],
    [
      SecurityEventDestinationProvider.ElasticSecurity,
      { dataStream: "Logs" },
      "Data stream must be",
    ],
  ])(
    "%s's own rules are held at save time: %j",
    async (provider: string, change: JSONObject, message: string) => {
      const valid: { config: JSONObject; secrets: JSONObject } =
        VALID[provider]!;

      await expect(
        service.onBeforeCreate(
          createBy(provider, { ...valid.config, ...change }, valid.secrets),
        ),
      ).rejects.toThrow(message);
    },
  );

  test.each([
    [
      SecurityEventDestinationProvider.Splunk,
      "HEC token is required for Splunk.",
    ],
    [
      SecurityEventDestinationProvider.MicrosoftSentinel,
      "Client secret is required for Microsoft Sentinel.",
    ],
    [
      SecurityEventDestinationProvider.ElasticSecurity,
      "API key is required for Elastic Security.",
    ],
  ])("%s needs its credential", async (provider: string, message: string) => {
    await expect(
      service.onBeforeCreate(createBy(provider, VALID[provider]!.config, {})),
    ).rejects.toThrow(message);
  });

  test("Google SecOps names no address of a person's: nothing for the egress policy", async () => {
    expect(
      getSecurityEventDestinationDefinition(
        SecurityEventDestinationProvider.GoogleSecOps,
      )!.configFields.some((field: { type: string }): boolean => {
        return field.type === "url";
      }),
    ).toBe(false);
  });
});

describe("the catalog", () => {
  test("offers four SIEMs, each never sent back what OneUptime imported from it", () => {
    expect(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition): Array<unknown> => {
          return [definition.provider, definition.importedProductNames];
        },
      ),
    ).toEqual([
      ["google-secops", ["Google SecOps"]],
      ["splunk", ["Splunk Enterprise Security"]],
      ["microsoft-sentinel", ["Microsoft Sentinel"]],
      ["elastic-security", ["Elastic Security"]],
    ]);
  });

  test("every SIEM's setup guide is a section of its integration page", () => {
    for (const definition of SecurityEventDestinationCatalog) {
      expect(definition.docsPath).toMatch(
        /^\/docs\/integrations\/[a-z-]+#send-security-events-to-[a-z-]+$/,
      );
    }
  });

  test("what a SIEM's form folds under More fields is optional, and says what empty means", () => {
    const folded: Array<[string, string]> = [];

    for (const definition of SecurityEventDestinationCatalog) {
      for (const field of [
        ...definition.configFields,
        ...definition.secretFields,
      ] as Array<ConnectorField>) {
        if (!field.isAdvanced) {
          continue;
        }

        folded.push([definition.provider, field.key]);
        // Nobody has to open the fold: the field may be left as it is.
        expect(field.required).toBe(false);
        // And its description, or its default, says what that means.
        expect(
          field.defaultValue !== undefined ||
            field.description.includes("Leave empty for"),
        ).toBe(true);
      }

      // A credential is never folded away.
      for (const field of definition.secretFields) {
        expect(field.isAdvanced).toBeFalsy();
      }
    }

    expect(folded).toEqual([
      ["splunk", "index"],
      ["splunk", "sourceType"],
      ["microsoft-sentinel", "streamName"],
      ["microsoft-sentinel", "cloud"],
      ["elastic-security", "dataStream"],
    ]);
  });

  test("a Sentinel destination saved without a cloud is in the public cloud", async () => {
    const valid: { config: JSONObject; secrets: JSONObject } =
      VALID[SecurityEventDestinationProvider.MicrosoftSentinel]!;
    const withoutCloud: JSONObject = { ...valid.config };
    delete withoutCloud["cloud"];

    await expect(
      service.onBeforeCreate(
        createBy(
          SecurityEventDestinationProvider.MicrosoftSentinel,
          withoutCloud,
          valid.secrets,
        ),
      ),
    ).resolves.toBeDefined();

    // The sender reads no cloud, or any but Azure Government, as public.
    expect(readSentinelCloud("")).toBe("public");
    expect(readSentinelCloud("public")).toBe("public");
    expect(readSentinelCloud("usgov")).toBe("usgov");
  });

  test("validateSettings is the same check the hooks make", () => {
    expect(() => {
      SecurityEventDestinationServiceClass.validateSettings({
        provider: SecurityEventDestinationProvider.Splunk,
        config: {
          hecUrl: "https://splunk.example.com:8088",
          index: "Bad Index",
        },
        secrets: { hecToken: "t" },
        requireRequiredSecrets: true,
      });
    }).toThrow("Index must be a Splunk index name");
  });
});
