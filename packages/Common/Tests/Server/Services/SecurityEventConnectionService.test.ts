import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../../../Server/Services/SecurityEventConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DataSourceEgressGuard from "../../../Server/Utils/DataSource/EgressGuard";
import SecurityEventConnectorRegistry from "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import {
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "../../../Server/Utils/SecurityEvent/Connectors/Types";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
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
 * SecurityEventConnectionService validates at save time so a connection
 * that stores is a connection the poller can use: a wrong key, a missing
 * secret or a blocked URL surfaces to the person filling the form, not as
 * a lastError on the cron an hour later. These tests drive the hooks and
 * the static validators directly, the ThreatIntelFeedService discipline.
 *
 * The registry is mocked so validation never depends on a provider's own
 * rules: what is pinned here is that the catalog rules run, that the
 * provider's validateSettings is CALLED, and that tenant-chosen URLs go
 * through the egress guard.
 */

jest.mock(
  "../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OKTA: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.OktaSystemLog,
  )!;
const SENTINEL: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.MicrosoftSentinel,
  )!;
const AWS: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.AwsSecurityHub,
  )!;
const SECRET_VALUE: string = "okta-api-token-3f2e1d";
const ROTATED_SECRET: string = "okta-api-token-rotated-9a8b";

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityEventConnection>,
  ) => Promise<OnCreate<SecurityEventConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityEventConnection>,
  ) => Promise<OnUpdate<SecurityEventConnection>>;
};

const service: HookCaller =
  SecurityEventConnectionService as unknown as HookCaller;

/*
 * A synthetic definition carrying every field type the catalog can
 * express, so the number and toggle rules are exercised even though no
 * shipped provider uses them yet.
 */
const SYNTHETIC: SecurityEventConnectorDefinition = {
  ...OKTA,
  title: "Synthetic",
  configFields: [
    {
      key: "endpoint",
      title: "Endpoint",
      description: "",
      type: "url",
      required: true,
    },
    {
      key: "port",
      title: "Port",
      description: "",
      type: "number",
      required: false,
    },
    {
      key: "verifyTls",
      title: "Verify TLS",
      description: "",
      type: "toggle",
      required: false,
    },
    {
      key: "region",
      title: "Region",
      description: "",
      type: "dropdown",
      required: true,
      options: [
        { label: "US", value: "us" },
        { label: "EU", value: "eu" },
      ],
      defaultValue: "us",
    },
    {
      key: "label",
      title: "Label",
      description: "",
      type: "text",
      required: false,
    },
  ],
  secretFields: [
    {
      key: "token",
      title: "Token",
      description: "",
      type: "password",
      required: true,
    },
  ],
};

function validateConfig(
  values: JSONObject,
  definition: SecurityEventConnectorDefinition = SYNTHETIC,
  requireRequiredFields: boolean = true,
): void {
  SecurityEventConnectionServiceType.validateFields({
    definition,
    fields: definition.configFields,
    values,
    label: "Configuration",
    requireRequiredFields,
  });
}

function validConfig(overrides: JSONObject = {}): JSONObject {
  return { endpoint: "https://example.com", region: "us", ...overrides };
}

let connectorValidateCalls: Array<SecurityConnectorSettings>;
let connectorValidateError: Error | undefined;

function fakeConnector(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnector {
  return {
    provider,
    validateSettings: (settings: SecurityConnectorSettings): void => {
      connectorValidateCalls.push(settings);
      if (connectorValidateError) {
        throw connectorValidateError;
      }
    },
    testConnection: (): Promise<never> => {
      return Promise.reject(new Error("not used"));
    },
    fetchEvents: (): Promise<never> => {
      return Promise.reject(new Error("not used"));
    },
  };
}

function buildConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection.projectId = PROJECT_ID;
  connection.name = "Okta";
  connection.provider = SecurityEventConnectorProvider.OktaSystemLog;
  connection.config = { orgUrl: "https://acme.okta.com" };
  connection.secrets = JSON.stringify({ apiToken: SECRET_VALUE });
  Object.assign(connection, overrides);
  return connection;
}

function createBy(
  connection: SecurityEventConnection,
): CreateBy<SecurityEventConnection> {
  return {
    data: connection,
    props: { isRoot: true },
  } as CreateBy<SecurityEventConnection>;
}

function updateBy(
  data: JSONObject,
  query: JSONObject = { _id: CONNECTION_ID.toString() },
): UpdateBy<SecurityEventConnection> {
  return {
    query,
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<SecurityEventConnection>;
}

function storedConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.provider = SecurityEventConnectorProvider.OktaSystemLog;
  connection.config = { orgUrl: "https://acme.okta.com", filter: "" };
  connection.secrets = JSON.stringify({ apiToken: SECRET_VALUE });
  connection.alertingOnly = true;
  Object.assign(connection, overrides);
  return connection;
}

beforeEach(() => {
  connectorValidateCalls = [];
  connectorValidateError = undefined;
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockImplementation(((provider: SecurityEventConnectorProvider) => {
    return fakeConnector(provider);
  }) as never);
  getJestSpyOn(DataSourceEgressGuard, "assertUrlAllowed").mockResolvedValue({
    url: new URL("https://acme.okta.com"),
    addresses: [],
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

describe("SecurityEventConnectionService.parseJsonObject", () => {
  test.each([undefined, null, ""])(
    "%j is an empty object",
    (value: unknown) => {
      expect(
        SecurityEventConnectionServiceType.parseJsonObject(
          value,
          "Configuration",
        ),
      ).toEqual({});
    },
  );

  test("an object is returned as is and a JSON string is parsed", () => {
    const object: JSONObject = { orgUrl: "https://acme.okta.com" };
    expect(
      SecurityEventConnectionServiceType.parseJsonObject(
        object,
        "Configuration",
      ),
    ).toBe(object);
    expect(
      SecurityEventConnectionServiceType.parseJsonObject(
        JSON.stringify(object),
        "Configuration",
      ),
    ).toEqual(object);
  });

  test.each(["not json", "[1,2]", "42", '"text"', 42, true, [1]])(
    "%j is rejected with the field name",
    (value: unknown) => {
      expect(() => {
        SecurityEventConnectionServiceType.parseJsonObject(
          value,
          "Credentials",
        );
      }).toThrow(BadDataException);
      expect(() => {
        SecurityEventConnectionServiceType.parseJsonObject(
          value,
          "Credentials",
        );
      }).toThrow("Credentials must be a JSON object.");
    },
  );
});

describe("SecurityEventConnectionService.validateFields", () => {
  test("a valid configuration passes", () => {
    expect(() => {
      validateConfig(
        validConfig({ port: 8089, verifyTls: true, label: "prod" }),
      );
    }).not.toThrow();
  });

  test("an unknown key is rejected rather than stored", () => {
    expect(() => {
      validateConfig(validConfig({ orgUrI: "typo" }));
    }).toThrow(
      'Configuration contains an unknown setting "orgUrI" for Synthetic.',
    );
  });

  test.each([{ nested: true }, [1, 2]])(
    "a value that is not a string, number or boolean (%j) is rejected",
    (value: unknown) => {
      expect(() => {
        validateConfig(validConfig({ label: value as never }));
      }).toThrow(
        'Configuration setting "label" must be a string, number or boolean.',
      );
    },
  );

  test.each([undefined, null, "", "   "])(
    "a required field left as %j is rejected when required fields are enforced",
    (value: unknown) => {
      expect(() => {
        validateConfig(validConfig({ endpoint: value as never }));
      }).toThrow("Endpoint is required for Synthetic.");
    },
  );

  test("required fields are not enforced when the caller says so (update merges)", () => {
    expect(() => {
      validateConfig({ region: "eu" }, SYNTHETIC, false);
    }).not.toThrow();
  });

  test("an optional field left empty is fine and skips type checks", () => {
    expect(() => {
      validateConfig(validConfig({ port: "", verifyTls: null }));
    }).not.toThrow();
  });

  test("a dropdown value outside its options is rejected with the allowed list", () => {
    expect(() => {
      validateConfig(validConfig({ region: "apac" }));
    }).toThrow("Region must be one of: us, eu.");
  });

  test.each(["8089", 8089, 0])(
    "a numeric field accepts %j",
    (value: unknown) => {
      expect(() => {
        validateConfig(validConfig({ port: value as never }));
      }).not.toThrow();
    },
  );

  /*
   * Number(true) is 1, so a boolean slips through the numeric rule today;
   * only the string and non-finite cases are pinned here.
   */
  test.each(["eighty", "NaN", "Infinity"])(
    "a numeric field rejects %j",
    (value: unknown) => {
      expect(() => {
        validateConfig(validConfig({ port: value as never }));
      }).toThrow("Port must be a number.");
    },
  );

  test.each(["true", 1, "yes"])(
    "a toggle rejects the non-boolean %j",
    (value: unknown) => {
      expect(() => {
        validateConfig(validConfig({ verifyTls: value as never }));
      }).toThrow("Verify TLS must be true or false.");
    },
  );

  test.each(["example.com", "not a url", "/relative"])(
    "a url field rejects %j",
    (value: string) => {
      expect(() => {
        validateConfig(validConfig({ endpoint: value }));
      }).toThrow("Endpoint must be an absolute https URL.");
    },
  );

  test.each(["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)"])(
    "a url field rejects the non-http scheme %s",
    (value: string) => {
      expect(() => {
        validateConfig(validConfig({ endpoint: value }));
      }).toThrow("Endpoint must be an http or https URL.");
    },
  );

  test.each([
    "https://user:pass@example.com",
    "https://user@example.com",
    "https://:pass@example.com",
  ])("a url field refuses credentials embedded in %s", (value: string) => {
    expect(() => {
      validateConfig(validConfig({ endpoint: value }));
    }).toThrow("Endpoint must not embed credentials in the URL.");
  });

  test("http is accepted (the egress guard decides the host, not the scheme)", () => {
    expect(() => {
      validateConfig(validConfig({ endpoint: "http://splunk.internal:8089" }));
    }).not.toThrow();
  });

  test("the real catalog rules apply: a Sentinel cloud outside the dropdown is rejected", () => {
    expect(() => {
      SecurityEventConnectionServiceType.validateFields({
        definition: SENTINEL,
        fields: SENTINEL.configFields,
        values: {
          tenantId: "t",
          clientId: "c",
          subscriptionId: "s",
          resourceGroup: "rg",
          workspaceName: "ws",
          cloud: "china",
        },
        label: "Configuration",
        requireRequiredFields: true,
      });
    }).toThrow("Cloud must be one of: public, usgov.");
  });

  test("secrets are validated against the secret fields with their own label", () => {
    expect(() => {
      SecurityEventConnectionServiceType.validateFields({
        definition: OKTA,
        fields: OKTA.secretFields,
        values: { apiToken: SECRET_VALUE, password: "x" },
        label: "Credentials",
        requireRequiredFields: true,
      });
    }).toThrow(
      `Credentials contains an unknown setting "password" for ${OKTA.title}.`,
    );
  });
});

describe("SecurityEventConnectionService.mergeSecrets", () => {
  /*
   * The one rule both a save and the /test overlay apply (review finding
   * optional-secret-cannot-be-cleared): a value replaces, "" or undefined
   * keeps, null removes.
   */
  const STORED: JSONObject = {
    secretAccessKey: SECRET_VALUE,
    sessionToken: "session-1",
  };

  test("a value replaces the stored key and untouched keys stay", () => {
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: AWS,
        stored: STORED,
        provided: { secretAccessKey: ROTATED_SECRET },
      }),
    ).toEqual({ secretAccessKey: ROTATED_SECRET, sessionToken: "session-1" });
  });

  test.each(["", undefined])("%j keeps the stored value", (blank: unknown) => {
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: AWS,
        stored: STORED,
        provided: { sessionToken: blank as never },
      }),
    ).toEqual(STORED);
  });

  test("null removes the stored key", () => {
    const merged: JSONObject = SecurityEventConnectionServiceType.mergeSecrets({
      definition: AWS,
      stored: STORED,
      provided: { sessionToken: null },
    });

    expect(merged).toEqual({ secretAccessKey: SECRET_VALUE });
    expect(merged).not.toHaveProperty("sessionToken");
  });

  test("null for a known credential that is not stored is a harmless no-op", () => {
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: AWS,
        stored: { secretAccessKey: SECRET_VALUE },
        provided: { sessionToken: null },
      }),
    ).toEqual({ secretAccessKey: SECRET_VALUE });
  });

  test("never mutates the stored object it was given", () => {
    const stored: JSONObject = { ...STORED };

    SecurityEventConnectionServiceType.mergeSecrets({
      definition: AWS,
      stored,
      provided: { sessionToken: null, secretAccessKey: ROTATED_SECRET },
    });

    expect(stored).toEqual(STORED);
  });

  test("null naming a key that is neither a credential nor stored is refused as a typo", () => {
    expect(() => {
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: AWS,
        stored: STORED,
        provided: { sesionToken: null },
      });
    }).toThrow(
      `Credentials contains an unknown setting "sesionToken" for ${AWS.title}.`,
    );
  });

  test("null may remove a stored key the catalog no longer knows, so the row can be repaired", () => {
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: OKTA,
        stored: { apiToken: SECRET_VALUE, retiredKey: "old" },
        provided: { retiredKey: null },
      }),
    ).toEqual({ apiToken: SECRET_VALUE });
  });
});

describe("SecurityEventConnectionService.getDefinitionOrThrow", () => {
  test.each([undefined, null, "", "not-a-provider", "OKTA", 42])(
    "rejects %j",
    (provider: unknown) => {
      expect(() => {
        SecurityEventConnectionServiceType.getDefinitionOrThrow(provider);
      }).toThrow(
        "Provider must be one of the supported security event connectors.",
      );
    },
  );

  test("returns the catalog definition for a known provider", () => {
    expect(
      SecurityEventConnectionServiceType.getDefinitionOrThrow("okta"),
    ).toBe(OKTA);
  });
});

describe("SecurityEventConnectionService.validateSettings", () => {
  test("runs catalog rules, then the provider's validateSettings, then the egress guard on url fields", async () => {
    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "  https://acme.okta.com  " },
        secrets: { apiToken: SECRET_VALUE },
        alertingOnly: false,
        requireRequiredSecrets: true,
      });

    expect(settings).toEqual({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: { orgUrl: "  https://acme.okta.com  " },
      secrets: { apiToken: SECRET_VALUE },
      alertingOnly: false,
    });
    expect(SecurityEventConnectorRegistry.getConnector).toHaveBeenCalledWith(
      SecurityEventConnectorProvider.OktaSystemLog,
    );
    expect(connectorValidateCalls).toEqual([settings]);
    expect(DataSourceEgressGuard.assertUrlAllowed).toHaveBeenCalledTimes(1);
    expect(DataSourceEgressGuard.assertUrlAllowed).toHaveBeenCalledWith(
      "https://acme.okta.com",
    );
  });

  test("providers without url fields never consult the egress guard", async () => {
    await SecurityEventConnectionServiceType.validateSettings({
      provider: "microsoft-sentinel",
      config: {
        tenantId: "t",
        clientId: "c",
        subscriptionId: "s",
        resourceGroup: "rg",
        workspaceName: "ws",
        cloud: "usgov",
      },
      secrets: { clientSecret: "s3cret" },
      alertingOnly: true,
      requireRequiredSecrets: true,
    });

    expect(DataSourceEgressGuard.assertUrlAllowed).not.toHaveBeenCalled();
    expect(connectorValidateCalls).toHaveLength(1);
  });

  test("an unknown provider fails before the registry or the guard are touched", async () => {
    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "not-a-provider",
        config: {},
        secrets: {},
        alertingOnly: true,
        requireRequiredSecrets: true,
      }),
    ).rejects.toThrow("Provider must be one of the supported");
    expect(SecurityEventConnectorRegistry.getConnector).not.toHaveBeenCalled();
    expect(DataSourceEgressGuard.assertUrlAllowed).not.toHaveBeenCalled();
  });

  test("a missing required secret is rejected before the provider sees anything", async () => {
    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "https://acme.okta.com" },
        secrets: {},
        alertingOnly: true,
        requireRequiredSecrets: true,
      }),
    ).rejects.toThrow(`API token is required for ${OKTA.title}.`);
    expect(connectorValidateCalls).toHaveLength(0);
  });

  test("required secrets may be skipped (a form test with stored secrets) but unknown ones still fail", async () => {
    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "https://acme.okta.com" },
        secrets: {},
        alertingOnly: true,
        requireRequiredSecrets: false,
      }),
    ).resolves.toBeDefined();

    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { sessionToken: "x" },
        alertingOnly: true,
        requireRequiredSecrets: false,
      }),
    ).rejects.toThrow('unknown setting "sessionToken"');
  });

  test("the provider's own validation error propagates untouched", async () => {
    connectorValidateError = new BadDataException(
      "Okta organization URL must end with .okta.com or .oktapreview.com.",
    );

    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "https://acme.example.com" },
        secrets: { apiToken: SECRET_VALUE },
        alertingOnly: true,
        requireRequiredSecrets: true,
      }),
    ).rejects.toThrow("Okta organization URL must end with");
    expect(DataSourceEgressGuard.assertUrlAllowed).not.toHaveBeenCalled();
  });

  test("a blocked host fails validation with the guard's own message", async () => {
    getJestSpyOn(DataSourceEgressGuard, "assertUrlAllowed").mockRejectedValue(
      new BadDataException(
        "Data source URL resolves to a private address and is not allowed.",
      ) as never,
    );

    await expect(
      SecurityEventConnectionServiceType.validateSettings({
        provider: "okta",
        config: { orgUrl: "https://10.0.0.5" },
        secrets: { apiToken: SECRET_VALUE },
        alertingOnly: true,
        requireRequiredSecrets: true,
      }),
    ).rejects.toThrow("private address");
  });
});

describe("SecurityEventConnectionService.onBeforeCreate", () => {
  test("stores the config as an object, the secrets as a JSON string, and the catalog's default interval", async () => {
    const connection: SecurityEventConnection = buildConnection({
      config: JSON.stringify({ orgUrl: "https://acme.okta.com" }) as never,
      secrets: { apiToken: SECRET_VALUE } as never,
    });

    const result: OnCreate<SecurityEventConnection> =
      await service.onBeforeCreate(createBy(connection));

    expect(result.createBy.data.config).toEqual({
      orgUrl: "https://acme.okta.com",
    });
    expect(typeof result.createBy.data.secrets).toBe("string");
    expect(JSON.parse(result.createBy.data.secrets as string)).toEqual({
      apiToken: SECRET_VALUE,
    });
    expect(result.createBy.data.pollIntervalInMinutes).toBe(
      OKTA.defaultPollIntervalInMinutes,
    );
    expect(connectorValidateCalls).toEqual([
      {
        provider: SecurityEventConnectorProvider.OktaSystemLog,
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { apiToken: SECRET_VALUE },
        alertingOnly: true,
      },
    ]);
    expect(DataSourceEgressGuard.assertUrlAllowed).toHaveBeenCalledWith(
      "https://acme.okta.com",
    );
  });

  test("an explicit poll interval and alertingOnly=false are kept", async () => {
    const result: OnCreate<SecurityEventConnection> =
      await service.onBeforeCreate(
        createBy(
          buildConnection({ pollIntervalInMinutes: 15, alertingOnly: false }),
        ),
      );

    expect(result.createBy.data.pollIntervalInMinutes).toBe(15);
    expect(connectorValidateCalls[0]!.alertingOnly).toBe(false);
  });

  test.each([0, 1441, 2.5, -1, "5"])(
    "rejects the poll interval %j",
    async (interval: unknown) => {
      await expect(
        service.onBeforeCreate(
          createBy(
            buildConnection({ pollIntervalInMinutes: interval as never }),
          ),
        ),
      ).rejects.toThrow(
        "Poll interval must be a whole number of minutes between 1 and 1440.",
      );
    },
  );

  test.each([1, 1440])(
    "accepts the boundary interval %j",
    async (interval: number) => {
      await expect(
        service.onBeforeCreate(
          createBy(buildConnection({ pollIntervalInMinutes: interval })),
        ),
      ).resolves.toBeDefined();
    },
  );

  test.each(["true", 1])(
    "rejects a non-boolean alertingOnly %j",
    async (value: unknown) => {
      await expect(
        service.onBeforeCreate(
          createBy(buildConnection({ alertingOnly: value as never })),
        ),
      ).rejects.toThrow("Alerting records only must be true or false.");
    },
  );

  test("rejects an unsupported provider", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(
          buildConnection({
            provider: "not-a-provider" as SecurityEventConnectorProvider,
          }),
        ),
      ),
    ).rejects.toThrow("Provider must be one of the supported");
    expect(connectorValidateCalls).toHaveLength(0);
  });

  test("requires every required secret on create", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildConnection({ secrets: "{}" }))),
    ).rejects.toThrow(`API token is required for ${OKTA.title}.`);
  });

  test("requires every required config field on create", async () => {
    await expect(
      service.onBeforeCreate(createBy(buildConnection({ config: {} }))),
    ).rejects.toThrow(`Okta organization URL is required for ${OKTA.title}.`);
  });

  test("rejects unparseable config and secrets", async () => {
    await expect(
      service.onBeforeCreate(
        createBy(buildConnection({ config: "nope" as never })),
      ),
    ).rejects.toThrow("Configuration must be a JSON object.");
    await expect(
      service.onBeforeCreate(createBy(buildConnection({ secrets: "nope" }))),
    ).rejects.toThrow("Credentials must be a JSON object.");
  });
});

describe("SecurityEventConnectionService.onBeforeUpdate", () => {
  let findOneById: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    findOneById = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(storedConnection() as never);
  });

  test("the provider of a connection cannot be changed", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ provider: "splunk" })),
    ).rejects.toThrow("The provider of a connection cannot be changed.");
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("an update that touches neither config nor secrets is passed through without a read", async () => {
    const result: OnUpdate<SecurityEventConnection> =
      await service.onBeforeUpdate(
        updateBy(
          { name: "renamed", pollIntervalInMinutes: 10 },
          {
            projectId: PROJECT_ID.toString(),
          },
        ),
      );

    expect(result.updateBy.data).toEqual({
      name: "renamed",
      pollIntervalInMinutes: 10,
    });
    expect(findOneById).not.toHaveBeenCalled();
    expect(connectorValidateCalls).toHaveLength(0);
  });

  test.each([0, 1441, 1.5])(
    "still validates the poll interval %j on a plain update",
    async (interval: unknown) => {
      await expect(
        service.onBeforeUpdate(
          updateBy({ pollIntervalInMinutes: interval as never }),
        ),
      ).rejects.toThrow("Poll interval must be a whole number");
    },
  );

  test("still validates alertingOnly on a plain update", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ alertingOnly: "yes" })),
    ).rejects.toThrow("Alerting records only must be true or false.");
  });

  test.each<[string, JSONObject]>([
    ["no _id", { projectId: PROJECT_ID.toString() }],
    ["a malformed _id", { _id: "not-a-uuid" }],
    ["a list of ids", { _id: [CONNECTION_ID.toString()] }],
  ])(
    "settings can only be updated one connection at a time (%s)",
    async (_label: string, query: JSONObject) => {
      await expect(
        service.onBeforeUpdate(
          updateBy({ secrets: { apiToken: ROTATED_SECRET } }, query),
        ),
      ).rejects.toThrow(
        "Configuration and credentials can only be updated one connection at a time.",
      );
      expect(findOneById).not.toHaveBeenCalled();
    },
  );

  test.each<[string, unknown]>([
    ["a string", CONNECTION_ID.toString()],
    ["an ObjectID", CONNECTION_ID],
  ])(
    "accepts the connection id as %s and reads the stored row as root",
    async (_label: string, id: unknown) => {
      await service.onBeforeUpdate(
        updateBy(
          { secrets: { apiToken: ROTATED_SECRET } },
          { _id: id as never },
        ),
      );

      expect(findOneById).toHaveBeenCalledWith({
        id: CONNECTION_ID,
        select: {
          _id: true,
          provider: true,
          config: true,
          secrets: true,
          alertingOnly: true,
        },
        props: { isRoot: true },
      });
    },
  );

  test("a rotated secret replaces the stored one; other stored keys stay", async () => {
    findOneById.mockResolvedValue(
      storedConnection({
        provider: SecurityEventConnectorProvider.AwsSecurityHub,
        config: { region: "us-east-1", accessKeyId: "AKIA1" },
        secrets: JSON.stringify({
          secretAccessKey: SECRET_VALUE,
          sessionToken: "session-1",
        }),
      }) as never,
    );

    const result: OnUpdate<SecurityEventConnection> =
      await service.onBeforeUpdate(
        updateBy({ secrets: { secretAccessKey: ROTATED_SECRET } }),
      );

    const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
    expect(typeof stored["secrets"]).toBe("string");
    expect(JSON.parse(stored["secrets"] as string)).toEqual({
      secretAccessKey: ROTATED_SECRET,
      sessionToken: "session-1",
    });
    // The stored config is what gets validated when the update omits it.
    expect(stored["config"]).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIA1",
    });
    expect(connectorValidateCalls).toEqual([
      {
        provider: SecurityEventConnectorProvider.AwsSecurityHub,
        config: { region: "us-east-1", accessKeyId: "AKIA1" },
        secrets: { secretAccessKey: ROTATED_SECRET, sessionToken: "session-1" },
        alertingOnly: true,
      },
    ]);
  });

  /*
   * null used to be listed here too. It now removes the stored key (review
   * finding optional-secret-cannot-be-cleared); see the tests below.
   */
  test.each(["", undefined])(
    "a secret submitted as %j keeps the stored value (edit forms cannot echo secrets back)",
    async (blank: unknown) => {
      const result: OnUpdate<SecurityEventConnection> =
        await service.onBeforeUpdate(
          updateBy({
            config: {
              orgUrl: "https://acme.okta.com",
              filter: 'eventType sw "user"',
            },
            secrets: { apiToken: blank as never },
          }),
        );

      const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
      expect(JSON.parse(stored["secrets"] as string)).toEqual({
        apiToken: SECRET_VALUE,
      });
      expect(stored["config"]).toEqual({
        orgUrl: "https://acme.okta.com",
        filter: 'eventType sw "user"',
      });
    },
  );

  test("a config sent as a JSON string is stored as an object and validated with the stored secrets", async () => {
    const result: OnUpdate<SecurityEventConnection> =
      await service.onBeforeUpdate(
        updateBy({
          config: JSON.stringify({ orgUrl: "https://acme.oktapreview.com" }),
        }),
      );

    const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
    expect(stored["config"]).toEqual({
      orgUrl: "https://acme.oktapreview.com",
    });
    expect(connectorValidateCalls[0]!.secrets).toEqual({
      apiToken: SECRET_VALUE,
    });
    expect(DataSourceEgressGuard.assertUrlAllowed).toHaveBeenCalledWith(
      "https://acme.oktapreview.com",
    );
  });

  test("an unknown config key on update is rejected", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({ config: { orgUrl: "https://acme.okta.com", nope: 1 } }),
      ),
    ).rejects.toThrow('unknown setting "nope"');
  });

  test("a provided alertingOnly is what the provider validates; otherwise the stored one", async () => {
    await service.onBeforeUpdate(
      updateBy({ alertingOnly: false, secrets: { apiToken: ROTATED_SECRET } }),
    );
    findOneById.mockResolvedValue(
      storedConnection({ alertingOnly: false }) as never,
    );
    await service.onBeforeUpdate(
      updateBy({ secrets: { apiToken: ROTATED_SECRET } }),
    );

    expect(
      connectorValidateCalls.map((call: SecurityConnectorSettings): boolean => {
        return call.alertingOnly;
      }),
    ).toEqual([false, false]);
  });

  test("a connection deleted between the form load and the save is refused", async () => {
    findOneById.mockResolvedValue(null as never);

    await expect(
      service.onBeforeUpdate(
        updateBy({ secrets: { apiToken: ROTATED_SECRET } }),
      ),
    ).rejects.toThrow("The connection no longer exists.");
  });

  test("a null optional secret removes the stored key, from what is validated and from what is stored", async () => {
    /*
     * The AWS case from review finding optional-secret-cannot-be-cleared:
     * temporary STS credentials replaced by a long-lived key. A session
     * token left stored would be sent with the new key and every call
     * would be rejected.
     */
    findOneById.mockResolvedValue(
      storedConnection({
        provider: SecurityEventConnectorProvider.AwsSecurityHub,
        config: { region: "us-east-1", accessKeyId: "ASIA1" },
        secrets: JSON.stringify({
          secretAccessKey: SECRET_VALUE,
          sessionToken: "session-1",
        }),
      }) as never,
    );

    const result: OnUpdate<SecurityEventConnection> =
      await service.onBeforeUpdate(
        updateBy({
          config: { region: "us-east-1", accessKeyId: "AKIA2" },
          secrets: { secretAccessKey: ROTATED_SECRET, sessionToken: null },
        }),
      );

    const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
    expect(JSON.parse(stored["secrets"] as string)).toEqual({
      secretAccessKey: ROTATED_SECRET,
    });
    expect(connectorValidateCalls).toEqual([
      {
        provider: SecurityEventConnectorProvider.AwsSecurityHub,
        config: { region: "us-east-1", accessKeyId: "AKIA2" },
        secrets: { secretAccessKey: ROTATED_SECRET },
        alertingOnly: true,
      },
    ]);
  });

  test("a null secret sent as a JSON string removes the key too, and blank siblings keep theirs", async () => {
    // The Splunk case: a revoked token cleared in favour of username and password.
    findOneById.mockResolvedValue(
      storedConnection({
        provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
        config: { url: "https://splunk.example.com:8089", username: "svc" },
        secrets: JSON.stringify({ apiToken: SECRET_VALUE, password: "old" }),
      }) as never,
    );

    const result: OnUpdate<SecurityEventConnection> =
      await service.onBeforeUpdate(
        updateBy({
          secrets: JSON.stringify({ apiToken: null, password: "" }),
        }),
      );

    const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
    expect(JSON.parse(stored["secrets"] as string)).toEqual({
      password: "old",
    });
  });

  test("clearing a required secret with null is rejected with the field title and nothing reaches the provider", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ secrets: { apiToken: null } })),
    ).rejects.toThrow(`API token is required for ${OKTA.title}.`);
    expect(connectorValidateCalls).toHaveLength(0);
  });

  test("a null for an unknown credential key is refused instead of silently keeping the stored credential", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ secrets: { apiTokn: null } })),
    ).rejects.toThrow(
      `Credentials contains an unknown setting "apiTokn" for ${OKTA.title}.`,
    );
    expect(connectorValidateCalls).toHaveLength(0);
  });

  test("the merged secrets must still satisfy the catalog", async () => {
    findOneById.mockResolvedValue(storedConnection({ secrets: "{}" }) as never);

    await expect(
      service.onBeforeUpdate(updateBy({ secrets: { apiToken: "" } })),
    ).rejects.toThrow(`API token is required for ${OKTA.title}.`);
  });
});

describe("SecurityEventConnectionService.getConnectorSettings", () => {
  test("parses the decrypted JSON off a fully loaded row without a read", async () => {
    const findOneById: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    );

    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(
        storedConnection({ alertingOnly: false }),
      );

    expect(settings).toEqual({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: { orgUrl: "https://acme.okta.com", filter: "" },
      secrets: { apiToken: SECRET_VALUE },
      alertingOnly: false,
    });
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("loads the row as root when the caller's copy is missing secrets, config or provider", async () => {
    const findOneById: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(storedConnection() as never);
    const partial: SecurityEventConnection = new SecurityEventConnection();
    partial._id = CONNECTION_ID.toString();
    partial.provider = SecurityEventConnectorProvider.OktaSystemLog;

    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(partial);

    expect(findOneById).toHaveBeenCalledWith({
      id: CONNECTION_ID,
      select: {
        _id: true,
        provider: true,
        config: true,
        secrets: true,
        alertingOnly: true,
      },
      props: { isRoot: true },
    });
    expect(settings.secrets).toEqual({ apiToken: SECRET_VALUE });
    expect(settings.alertingOnly).toBe(true);
  });

  test("a row that vanished is an error, not empty settings", async () => {
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(null as never);
    const partial: SecurityEventConnection = new SecurityEventConnection();
    partial._id = CONNECTION_ID.toString();

    await expect(
      SecurityEventConnectionService.getConnectorSettings(partial),
    ).rejects.toThrow("The connection no longer exists.");
  });

  test("a stored provider outside the catalog is refused", async () => {
    await expect(
      SecurityEventConnectionService.getConnectorSettings(
        storedConnection({
          provider: "not-a-provider" as SecurityEventConnectorProvider,
        }),
      ),
    ).rejects.toThrow("Provider must be one of the supported");
  });

  test("corrupt stored JSON is a readable error", async () => {
    await expect(
      SecurityEventConnectionService.getConnectorSettings(
        storedConnection({ secrets: "{not json" }),
      ),
    ).rejects.toThrow("Credentials must be a JSON object.");
  });
});

describe("SecurityEventConnectionService - catalog coverage", () => {
  test("every shipped url field is validated for embedded credentials", () => {
    const urlFields: Array<[SecurityEventConnectorDefinition, ConnectorField]> =
      [];

    for (const definition of [OKTA, SENTINEL]) {
      for (const field of definition.configFields) {
        if (field.type === "url") {
          urlFields.push([definition, field]);
        }
      }
    }

    expect(urlFields.length).toBeGreaterThan(0);

    for (const [definition, field] of urlFields) {
      expect(() => {
        SecurityEventConnectionServiceType.validateFields({
          definition,
          fields: [field],
          values: { [field.key]: "https://admin:hunter2@example.com" },
          label: "Configuration",
          requireRequiredFields: false,
        });
      }).toThrow("must not embed credentials");
    }
  });
});

/*
 * Google SecOps moved into the framework (it had a connection model of its
 * own until then). What is specific to it at this layer: its service-account
 * key is a "json" secret, pasted as a multi-line document and stored as
 * that text, and a connection must round-trip create, update and the
 * poller's settings read with the text intact. The registry stays mocked:
 * the key's own rules (client_email, private_key, token_uri) belong to the
 * connector, which is not what this suite pins.
 */
const GOOGLE: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.GoogleSecOps,
  )!;
const GOOGLE_CONFIG: JSONObject = {
  region: "europe",
  instanceResourceName:
    "projects/acme-secops/locations/eu/instances/0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b",
};
const GOOGLE_REGIONS: string = (GOOGLE.configFields[0]!.options || [])
  .map((option: { value: string }): string => {
    return option.value;
  })
  .join(", ");

/*
 * Shaped like a real Google Cloud key file, pretty-printed the way the
 * console downloads it and about as long (~2.5 KB): the PEM body is the bulk
 * of it, and its newlines are escaped inside the JSON string.
 */
function serviceAccountKeyText(pemBodyCharacter: string): string {
  const pemBody: string = (
    pemBodyCharacter.repeat(1700).match(/.{1,64}/g) || []
  ).join("\n");

  return JSON.stringify(
    {
      type: "service_account",
      project_id: "acme-secops",
      private_key_id: "0123456789abcdef0123456789abcdef01234567",
      private_key: `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----\n`,
      client_email: "oneuptime-poller@acme-secops.iam.gserviceaccount.com",
      client_id: "123456789012345678901",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url:
        "https://www.googleapis.com/robot/v1/metadata/x509/oneuptime-poller%40acme-secops.iam.gserviceaccount.com",
      universe_domain: "googleapis.com",
    },
    null,
    2,
  );
}

const KEY_TEXT: string = serviceAccountKeyText("A");
const ROTATED_KEY_TEXT: string = serviceAccountKeyText("B");

function validateGoogleSecrets(
  values: JSONObject,
  requireRequiredFields: boolean = true,
): void {
  SecurityEventConnectionServiceType.validateFields({
    definition: GOOGLE,
    fields: GOOGLE.secretFields,
    values,
    label: "Credentials",
    requireRequiredFields,
  });
}

function googleConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  return buildConnection({
    name: "Google SecOps",
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    config: { ...GOOGLE_CONFIG },
    secrets: JSON.stringify({ serviceAccountJson: KEY_TEXT }),
    ...overrides,
  });
}

function storedGoogleConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  return storedConnection({
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    config: { ...GOOGLE_CONFIG },
    secrets: JSON.stringify({ serviceAccountJson: KEY_TEXT }),
    alertingOnly: true,
    ...overrides,
  });
}

describe("SecurityEventConnectionService.validateFields - json fields", () => {
  test("the Google SecOps key is declared as a required json secret", () => {
    expect(GOOGLE.secretFields).toEqual([
      expect.objectContaining({
        key: "serviceAccountJson",
        title: "Service account JSON",
        type: "json",
        required: true,
      }),
    ]);
  });

  test.each<[string, string]>([
    ["a pretty-printed key file", KEY_TEXT],
    [
      "a single-line object",
      '{"client_email":"a@b.iam.gserviceaccount.com","private_key":"k"}',
    ],
    ["an object with surrounding whitespace", '  \n{"client_email":"a"}\n\t'],
    ["an empty object (the connector names what is missing)", "{}"],
  ])("accepts %s", (_label: string, text: string) => {
    expect(() => {
      validateGoogleSecrets({ serviceAccountJson: text });
    }).not.toThrow();
  });

  test.each<[string, string]>([
    ["an array of objects", '[{"client_email":"a"}]'],
    ["an empty array", "[]"],
    ["a number", "42"],
    ["a JSON string holding an object", JSON.stringify('{"client_email":"a"}')],
    ["null written as text", "null"],
    ["true written as text", "true"],
    ["text that is not JSON", "not json"],
    ["a truncated paste", KEY_TEXT.slice(0, 200)],
    ["an object with a trailing comma", '{"client_email":"a",}'],
  ])("rejects %s as not a JSON object", (_label: string, text: string) => {
    expect(() => {
      validateGoogleSecrets({ serviceAccountJson: text });
    }).toThrow(BadDataException);
    expect(() => {
      validateGoogleSecrets({ serviceAccountJson: text });
    }).toThrow("Service account JSON must be a JSON object.");
  });

  test.each([42, 0, true, false])(
    "rejects the non-text value %j as not a JSON object",
    (value: unknown) => {
      expect(() => {
        validateGoogleSecrets({ serviceAccountJson: value as never });
      }).toThrow("Service account JSON must be a JSON object.");
    },
  );

  test.each([
    { client_email: "a", private_key: "k" },
    {},
    [{ client_email: "a" }],
    [],
  ])(
    "refuses the already-parsed document %j and says to send the text",
    (value: unknown) => {
      expect(() => {
        validateGoogleSecrets({ serviceAccountJson: value as never });
      }).toThrow(
        "Service account JSON must be sent as JSON text (a string), not as a parsed object.",
      );
    },
  );

  test.each([undefined, null, "", "   ", "\n\t"])(
    "a key left as %j is required when required fields are enforced, and skipped otherwise",
    (value: unknown) => {
      expect(() => {
        validateGoogleSecrets({ serviceAccountJson: value as never });
      }).toThrow("Service account JSON is required for Google SecOps.");
      expect(() => {
        validateGoogleSecrets({ serviceAccountJson: value as never }, false);
      }).not.toThrow();
    },
  );

  test("an unknown credential key is still refused before the json rule", () => {
    expect(() => {
      validateGoogleSecrets({ serviceAccountJson: KEY_TEXT, privateKey: "x" });
    }).toThrow(
      'Credentials contains an unknown setting "privateKey" for Google SecOps.',
    );
  });

  test("the parsed-object message is for json fields only: a password field keeps the scalar rule", () => {
    expect(() => {
      SecurityEventConnectionServiceType.validateFields({
        definition: OKTA,
        fields: OKTA.secretFields,
        values: { apiToken: { value: SECRET_VALUE } },
        label: "Credentials",
        requireRequiredFields: true,
      });
    }).toThrow(
      'Credentials setting "apiToken" must be a string, number or boolean.',
    );
  });

  test("an optional json config field is skipped when empty and checked when set", () => {
    const definition: SecurityEventConnectorDefinition = {
      ...SYNTHETIC,
      configFields: [
        {
          key: "extra",
          title: "Extra JSON",
          description: "",
          type: "json",
          required: false,
        },
      ],
    };

    expect(() => {
      validateConfig({ extra: "" }, definition);
    }).not.toThrow();
    expect(() => {
      validateConfig({ extra: '{"a":1}' }, definition);
    }).not.toThrow();
    expect(() => {
      validateConfig({ extra: "[1]" }, definition);
    }).toThrow("Extra JSON must be a JSON object.");
  });

  test("validateSettings hands the connector the key as the exact text that was pasted", async () => {
    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionServiceType.validateSettings({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: GOOGLE_CONFIG,
        secrets: { serviceAccountJson: KEY_TEXT },
        alertingOnly: false,
        requireRequiredSecrets: true,
      });

    expect(settings.secrets["serviceAccountJson"]).toBe(KEY_TEXT);
    expect(connectorValidateCalls).toHaveLength(1);
    expect(
      typeof connectorValidateCalls[0]!.secrets["serviceAccountJson"],
    ).toBe("string");
    expect(DataSourceEgressGuard.assertUrlAllowed).not.toHaveBeenCalled();
  });
});

describe("SecurityEventConnectionService - Google SecOps connections", () => {
  test("a ~2.5 KB service-account key fits: secrets is unbounded encrypted text and config is unbounded JSON", () => {
    expect(KEY_TEXT.length).toBeGreaterThan(2400);

    const model: SecurityEventConnection = new SecurityEventConnection();
    const secrets: TableColumnMetadata =
      model.getTableColumnMetadata("secrets");
    const config: TableColumnMetadata = model.getTableColumnMetadata("config");

    expect(secrets.type).toBe(TableColumnType.VeryLongText);
    expect(secrets.encrypted).toBe(true);
    expect(getMaxLengthFromTableColumnType(secrets.type)).toBeUndefined();
    expect(config.type).toBe(TableColumnType.JSON);
    expect(getMaxLengthFromTableColumnType(config.type)).toBeUndefined();
  });

  test("create stores the pasted key text byte for byte inside the secrets string, with the catalog interval", async () => {
    const result: OnCreate<SecurityEventConnection> =
      await service.onBeforeCreate(
        createBy(
          googleConnection({
            secrets: { serviceAccountJson: KEY_TEXT } as never,
            alertingOnly: false,
          }),
        ),
      );

    expect(result.createBy.data.config).toEqual(GOOGLE_CONFIG);
    expect(typeof result.createBy.data.secrets).toBe("string");
    const stored: JSONObject = JSON.parse(
      result.createBy.data.secrets as string,
    ) as JSONObject;
    expect(stored).toEqual({ serviceAccountJson: KEY_TEXT });
    expect(stored["serviceAccountJson"]).toBe(KEY_TEXT);
    expect(result.createBy.data.pollIntervalInMinutes).toBe(
      GOOGLE.defaultPollIntervalInMinutes,
    );
    expect(SecurityEventConnectorRegistry.getConnector).toHaveBeenCalledWith(
      SecurityEventConnectorProvider.GoogleSecOps,
    );
    expect(connectorValidateCalls).toEqual([
      {
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: GOOGLE_CONFIG,
        secrets: { serviceAccountJson: KEY_TEXT },
        alertingOnly: false,
      },
    ]);
    // Google SecOps has no url field, so no egress lookup runs.
    expect(DataSourceEgressGuard.assertUrlAllowed).not.toHaveBeenCalled();
  });

  test("secrets sent as one JSON string, with the key text escaped inside it, store the same key text", async () => {
    const result: OnCreate<SecurityEventConnection> =
      await service.onBeforeCreate(createBy(googleConnection()));

    expect(
      (JSON.parse(result.createBy.data.secrets as string) as JSONObject)[
        "serviceAccountJson"
      ],
    ).toBe(KEY_TEXT);
    expect(connectorValidateCalls[0]!.alertingOnly).toBe(true);
  });

  test.each<[string, JSONObject, string]>([
    [
      "a missing region (there is no default region)",
      { instanceResourceName: GOOGLE_CONFIG["instanceResourceName"]! },
      "Region is required for Google SecOps.",
    ],
    [
      "a region outside the supported list",
      {
        region: "us-central1",
        instanceResourceName: GOOGLE_CONFIG["instanceResourceName"]!,
      },
      `Region must be one of: ${GOOGLE_REGIONS}.`,
    ],
    [
      "a missing instance resource name",
      { region: "us" },
      "Instance resource name is required for Google SecOps.",
    ],
    [
      "an unknown config key",
      { ...GOOGLE_CONFIG, projectId: "acme" },
      'Configuration contains an unknown setting "projectId" for Google SecOps.',
    ],
  ])(
    "create refuses %s before the connector sees it",
    async (_label: string, config: JSONObject, message: string) => {
      await expect(
        service.onBeforeCreate(createBy(googleConnection({ config }))),
      ).rejects.toThrow(message);
      expect(connectorValidateCalls).toHaveLength(0);
    },
  );

  test.each<[string, string, string]>([
    ["no key", "{}", "Service account JSON is required for Google SecOps."],
    [
      "a key that is not a JSON object",
      JSON.stringify({ serviceAccountJson: "[]" }),
      "Service account JSON must be a JSON object.",
    ],
    [
      "a parsed key object",
      JSON.stringify({ serviceAccountJson: { client_email: "a" } }),
      "Service account JSON must be sent as JSON text (a string), not as a parsed object.",
    ],
  ])(
    "create refuses %s",
    async (_label: string, secrets: string, message: string) => {
      await expect(
        service.onBeforeCreate(createBy(googleConnection({ secrets }))),
      ).rejects.toThrow(message);
      expect(connectorValidateCalls).toHaveLength(0);
    },
  );

  describe("update", () => {
    let findOneById: ReturnType<typeof getJestSpyOn>;

    beforeEach(() => {
      findOneById = getJestSpyOn(
        SecurityEventConnectionService,
        "findOneById",
      ).mockResolvedValue(storedGoogleConnection() as never);
    });

    test("an edit that leaves the key blank keeps the stored key and validates the edited settings with it", async () => {
      const edited: JSONObject = {
        region: "eu",
        instanceResourceName:
          "projects/acme-secops/locations/eu/instances/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      };

      const result: OnUpdate<SecurityEventConnection> =
        await service.onBeforeUpdate(
          updateBy({
            config: edited,
            secrets: { serviceAccountJson: "" },
            alertingOnly: false,
          }),
        );

      const stored: JSONObject = result.updateBy.data as unknown as JSONObject;
      expect(stored["config"]).toEqual(edited);
      expect(JSON.parse(stored["secrets"] as string)).toEqual({
        serviceAccountJson: KEY_TEXT,
      });
      expect(connectorValidateCalls).toEqual([
        {
          provider: SecurityEventConnectorProvider.GoogleSecOps,
          config: edited,
          secrets: { serviceAccountJson: KEY_TEXT },
          alertingOnly: false,
        },
      ]);
      expect(findOneById).toHaveBeenCalledTimes(1);
    });

    test("an edit that sends no secrets at all keeps the stored key", async () => {
      const result: OnUpdate<SecurityEventConnection> =
        await service.onBeforeUpdate(updateBy({ config: GOOGLE_CONFIG }));

      expect(
        JSON.parse(
          (result.updateBy.data as unknown as JSONObject)["secrets"] as string,
        ),
      ).toEqual({ serviceAccountJson: KEY_TEXT });
      expect(connectorValidateCalls[0]!.alertingOnly).toBe(true);
    });

    test("a pasted replacement key replaces the stored one, as text", async () => {
      const result: OnUpdate<SecurityEventConnection> =
        await service.onBeforeUpdate(
          updateBy({ secrets: { serviceAccountJson: ROTATED_KEY_TEXT } }),
        );

      const stored: JSONObject = JSON.parse(
        (result.updateBy.data as unknown as JSONObject)["secrets"] as string,
      ) as JSONObject;
      expect(stored).toEqual({ serviceAccountJson: ROTATED_KEY_TEXT });
      expect(stored["serviceAccountJson"]).not.toBe(KEY_TEXT);
      // The stored config is what is validated when the edit omits it.
      expect(connectorValidateCalls[0]!.config).toEqual(GOOGLE_CONFIG);
    });

    test("clearing the key with null is refused with the field title", async () => {
      await expect(
        service.onBeforeUpdate(
          updateBy({ secrets: { serviceAccountJson: null } }),
        ),
      ).rejects.toThrow("Service account JSON is required for Google SecOps.");
      expect(connectorValidateCalls).toHaveLength(0);
    });

    test("a replacement that is not a JSON object is refused and nothing reaches the connector", async () => {
      await expect(
        service.onBeforeUpdate(
          updateBy({
            secrets: { serviceAccountJson: '{"client_email": "a", ' },
          }),
        ),
      ).rejects.toThrow("Service account JSON must be a JSON object.");
      expect(connectorValidateCalls).toHaveLength(0);
    });

    test("a region edit outside the supported list is refused", async () => {
      await expect(
        service.onBeforeUpdate(
          updateBy({ config: { ...GOOGLE_CONFIG, region: "mars" } }),
        ),
      ).rejects.toThrow(`Region must be one of: ${GOOGLE_REGIONS}.`);
    });
  });

  test("the poller's settings read hands the connector the stored key text and the saved Data to import", async () => {
    const findOneById: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    );

    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(
        storedGoogleConnection({ alertingOnly: false }),
      );

    expect(settings).toEqual({
      provider: SecurityEventConnectorProvider.GoogleSecOps,
      config: GOOGLE_CONFIG,
      secrets: { serviceAccountJson: KEY_TEXT },
      alertingOnly: false,
    });
    expect(typeof settings.secrets["serviceAccountJson"]).toBe("string");
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("a connection whose Data to import was never set reads as alerts only", async () => {
    const connection: SecurityEventConnection = storedGoogleConnection();
    delete connection.alertingOnly;

    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(connection);

    expect(settings.alertingOnly).toBe(true);
  });

  test("mergeSecrets on the key: '' keeps it, text replaces it, null removes it", () => {
    const stored: JSONObject = { serviceAccountJson: KEY_TEXT };

    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: GOOGLE,
        stored,
        provided: { serviceAccountJson: "" },
      }),
    ).toEqual(stored);
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: GOOGLE,
        stored,
        provided: { serviceAccountJson: ROTATED_KEY_TEXT },
      }),
    ).toEqual({ serviceAccountJson: ROTATED_KEY_TEXT });
    expect(
      SecurityEventConnectionServiceType.mergeSecrets({
        definition: GOOGLE,
        stored,
        provided: { serviceAccountJson: null },
      }),
    ).toEqual({});
  });
});
