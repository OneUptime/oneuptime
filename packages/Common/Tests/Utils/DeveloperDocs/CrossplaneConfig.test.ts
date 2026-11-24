import { describe, expect, test } from "@jest/globals";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import Incident from "../../../Models/DatabaseModels/Incident";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Models from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Dictionary from "../../../Types/Dictionary";
import ServerOwned from "../../../Types/Database/ServerOwned";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  CROSSPLANE_API_KEY_SECRET_KEY,
  CROSSPLANE_API_KEY_SECRET_NAME,
  CROSSPLANE_EXTERNAL_NAME_ANNOTATION,
  CROSSPLANE_NAMESPACE,
  CROSSPLANE_PACKAGE_REPOSITORY,
  CrossplaneCreateExample,
  CrossplaneRecordManifest,
  CrossplaneSharedField,
  getCrossplaneApiKeySecretCommands,
  getCrossplaneConnectionSecretReadCommand,
  getCrossplaneCreateExample,
  getCrossplaneObjectName,
  getCrossplaneObserveManifests,
  getCrossplanePackageTag,
  getCrossplaneProviderConfigYaml,
  getCrossplaneProviderYaml,
  getCrossplaneRecordManifest,
  getCrossplaneSecretCommand,
  getKindObjectName,
  MONITOR_STEP_SECRET_ATTRIBUTES,
} from "../../../Utils/DeveloperDocs/CrossplaneConfig";
import {
  CROSSPLANE_PROVIDER_CONFIG_API_VERSION,
  CROSSPLANE_RESOURCE_API_VERSION,
  getCrossplaneFieldName,
} from "../../../Utils/DeveloperDocs/CrossplaneNames";
import {
  getCrossplaneFieldOf,
  getCrossplaneKindOf,
  getProviderAttributeName,
  isCrossplaneSecretField,
} from "../../../Utils/DeveloperDocs/CrossplaneSchema";
import { DeveloperDocsExampleContext } from "../../../Utils/DeveloperDocs/ExampleBuilder";
import {
  getTerraformAttributes,
  TerraformAttributeDescriptor,
  toTerraformSnakeCase,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  fixtureRecordId,
  getEmptyFixtureLiveData,
  getFixtureLiveData,
} from "./DeveloperDocsLiveFixture";
import { getCrossplaneProviderVersion } from "../../../../App/FeatureSet/Docs/Utils/Placeholders";

/*
 * The manifests the Developer > Crossplane pages write (#6615). What matters
 * most: the provider takes them as written - kinds and fields as it names
 * them, read back as the values they were - and they never fight OneUptime.
 * A record's manifest takes it over by its ID and sets the fields its
 * Terraform configuration sets; nothing OneUptime keeps is under
 * spec.forProvider (#9985), and what OneUptime changes too is left to it
 * unless the record needs it (#10052); no secret is in any of them.
 */

type YamlObject = Record<string, unknown>;

function parse(text: string): YamlObject {
  return yaml.load(text) as YamlObject;
}

function spec(text: string): YamlObject {
  return parse(text)["spec"] as YamlObject;
}

function forProvider(text: string): YamlObject {
  return (spec(text)["forProvider"] as YamlObject) || {};
}

const MONITOR_ID: string = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
const OPERATIONAL: string = fixtureRecordId("MonitorStatus", "Operational");
const OFFLINE: string = fixtureRecordId("MonitorStatus", "Offline");
const CRITICAL: string = fixtureRecordId(
  "IncidentSeverity",
  "Critical Incident",
);
const HIGH: string = fixtureRecordId("AlertSeverity", "High");

// A website monitor with the criteria a new one starts with, as the API answers it.
function websiteMonitorJson(
  editStep?: (step: JSONObject) => void,
): Dictionary<unknown> {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "Checkout API";
  monitor.description = "on";
  monitor.monitorType = MonitorType.Website;
  monitor.monitoringInterval = "*/5 * * * *";
  monitor.currentMonitorStatusId = new ObjectID(OPERATIONAL);
  monitor.telemetryMonitorLastMonitorAt = new Date("2026-10-01T10:00:00Z");
  monitor.monitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Website,
    monitorName: "Checkout API",
    defaultMonitorStatusId: new ObjectID(OPERATIONAL),
    onlineMonitorStatusId: new ObjectID(OPERATIONAL),
    offlineMonitorStatusId: new ObjectID(OFFLINE),
    defaultIncidentSeverityId: new ObjectID(CRITICAL),
    defaultAlertSeverityId: new ObjectID(HIGH),
  });

  const json: Dictionary<unknown> = BaseModel.toJSON(
    monitor,
    Monitor,
  ) as Dictionary<unknown>;
  const steps: JSONObject = (json["monitorSteps"] as JSONObject)[
    "value"
  ] as JSONObject;
  const step: JSONObject = (
    steps["monitorStepsInstanceArray"] as Array<JSONObject>
  )[0]!["value"] as JSONObject;

  step["monitorDestination"] = { _type: "URL", value: "https://example.com" };
  editStep?.(step);

  return json;
}

function describeFixture(id: string): string | undefined {
  return getFixtureLiveData().namesById[id];
}

function monitorManifest(
  editStep?: (step: JSONObject) => void,
): CrossplaneRecordManifest {
  return getCrossplaneRecordManifest({
    modelType: Monitor,
    json: websiteMonitorJson(editStep),
    describeId: describeFixture,
  })!;
}

describe("the package and the ProviderConfig", () => {
  test("the package is the release's, by its tag, as the docs name it", () => {
    for (const version of [
      "17.1.0",
      "v17.1.0",
      " 17.1.0\n",
      "1.0.0",
      "",
      null,
      "17.1",
    ]) {
      expect({
        version,
        tag: getCrossplanePackageTag(version),
      }).toEqual({ version, tag: getCrossplaneProviderVersion(version) });
    }

    expect(getCrossplanePackageTag("17.1.0")).toBe("v17.1.0");
    expect(getCrossplanePackageTag("1.0.0")).toBe("v<version>");
    expect(getCrossplanePackageTag(undefined)).toBe("v<version>");
  });

  test("the Provider installs it", () => {
    expect(parse(getCrossplaneProviderYaml("17.1.0"))).toEqual({
      apiVersion: "pkg.crossplane.io/v1",
      kind: "Provider",
      metadata: { name: "provider-oneuptime" },
      spec: { package: `${CROSSPLANE_PACKAGE_REPOSITORY}:v17.1.0` },
    });
  });

  test("the API key goes into a Secret from the environment, never into a file", () => {
    const commands: string =
      getCrossplaneApiKeySecretCommands("ONEUPTIME_API_KEY");

    expect(commands).toBe(
      [
        `kubectl create namespace ${CROSSPLANE_NAMESPACE}`,
        `kubectl -n ${CROSSPLANE_NAMESPACE} create secret generic ${CROSSPLANE_API_KEY_SECRET_NAME} --from-literal=${CROSSPLANE_API_KEY_SECRET_KEY}="$ONEUPTIME_API_KEY"`,
      ].join("\n"),
    );
  });

  test("the ProviderConfig reads it, and points the provider at this OneUptime", () => {
    expect(
      parse(getCrossplaneProviderConfigYaml("https://oneuptime.example.com/")),
    ).toEqual({
      apiVersion: CROSSPLANE_PROVIDER_CONFIG_API_VERSION,
      kind: "ProviderConfig",
      metadata: { name: "default", namespace: CROSSPLANE_NAMESPACE },
      spec: {
        url: "https://oneuptime.example.com",
        credentials: {
          secretRef: {
            name: CROSSPLANE_API_KEY_SECRET_NAME,
            key: CROSSPLANE_API_KEY_SECRET_KEY,
          },
        },
      },
    });
    // With no address, the provider's own default: OneUptime Cloud.
    expect(spec(getCrossplaneProviderConfigYaml(null))["url"]).toBeUndefined();
  });
});

describe("Kubernetes names", () => {
  test("are made from a record's name, as DNS labels", () => {
    expect(getCrossplaneObjectName("Checkout API!", "monitor")).toBe(
      "checkout-api",
    );
    expect(getCrossplaneObjectName("  Café   Über ", "monitor")).toBe(
      "cafe-uber",
    );
    expect(getCrossplaneObjectName("監視", "monitor-1a2b3c4d")).toBe(
      "monitor-1a2b3c4d",
    );
    expect(getCrossplaneObjectName(null, "Team")).toBe("team");
    expect(getCrossplaneObjectName("", "")).toBe("resource");
  });

  test("a long name is cut at a hyphen, to 63 characters at most", () => {
    const name: string = getCrossplaneObjectName(
      "The production checkout API that every customer in every region pays through",
      "monitor",
    );

    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(name.endsWith("-")).toBe(false);
  });

  test("a kind's name is its words joined by hyphens", () => {
    expect(getKindObjectName("IncidentSeverity")).toBe("incident-severity");
    expect(getKindObjectName("MonitorStatusDefinition")).toBe(
      "monitor-status-definition",
    );
    expect(getKindObjectName("APIKey")).toBe("api-key");
  });
});

describe("a record's manifest", () => {
  test("takes the record over by its ID, in the provider's group, kind and namespace", () => {
    const workflow: Workflow = new Workflow();
    workflow._id = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
    workflow.name = "Send weekly report";
    workflow.description = "Mails the ops team";
    workflow.isEnabled = true;

    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: Workflow,
      json: BaseModel.toJSON(workflow, Workflow),
    })!;
    const document: YamlObject = parse(manifest.yaml);

    expect(manifest.kind).toBe("Workflow");
    expect(manifest.objectName).toBe("send-weekly-report");
    expect(document["apiVersion"]).toBe(CROSSPLANE_RESOURCE_API_VERSION);
    expect(document["kind"]).toBe("Workflow");
    expect(document["metadata"]).toEqual({
      name: "send-weekly-report",
      namespace: CROSSPLANE_NAMESPACE,
      annotations: {
        [CROSSPLANE_EXTERNAL_NAME_ANNOTATION]: workflow._id,
      },
    });
    expect(spec(manifest.yaml)["providerConfigRef"]).toEqual({
      kind: "ProviderConfig",
      name: "default",
    });
    expect(forProvider(manifest.yaml)).toEqual(
      expect.objectContaining({
        name: "Send weekly report",
        description: "Mails the ops team",
      }),
    );
    // A takeover changes nothing: it sets no management policy of its own.
    expect(spec(manifest.yaml)["managementPolicies"]).toBeUndefined();
    expect(manifest.getCommand).toBe(
      `kubectl -n ${CROSSPLANE_NAMESPACE} get workflow.crossplane.oneuptime.com send-weekly-report`,
    );
  });

  test("its Observe variant reads the record by its ID and never changes it", () => {
    const manifest: CrossplaneRecordManifest = monitorManifest();
    const observe: YamlObject = parse(manifest.observeYaml);

    expect(observe["metadata"]).toEqual(parse(manifest.yaml)["metadata"]);
    expect(spec(manifest.observeYaml)).toEqual({
      managementPolicies: ["Observe"],
      providerConfigRef: { kind: "ProviderConfig", name: "default" },
      forProvider: {},
    });
    expect(manifest.observeYaml).toContain('managementPolicies: ["Observe"]');
  });

  test("a monitor's steps are the Terraform page's, field for field, in camelCase", () => {
    const manifest: CrossplaneRecordManifest = monitorManifest();
    const fields: YamlObject = forProvider(manifest.yaml);
    const step: YamlObject = (fields["monitorSteps"] as Array<YamlObject>)[0]!;
    const criteria: Array<YamlObject> = step["criteria"] as Array<YamlObject>;

    expect(fields["monitorType"]).toBe("Website");
    expect(fields["monitoringInterval"]).toBe("*/5 * * * *");
    // "on" is a string, never YAML 1.1's true.
    expect(fields["description"]).toBe("on");
    expect(manifest.yaml).toContain('description: "on"');
    expect(step["monitorDestination"]).toBe("https://example.com");
    expect(step["monitorDestinationType"]).toBe("URL");
    expect(criteria.length).toBeGreaterThan(0);
    expect(criteria[0]).toEqual(
      expect.objectContaining({
        filterCondition: expect.any(String),
        monitorStatusId: OFFLINE,
        changeMonitorStatus: true,
      }),
    );
    // A filter's "False" stays the string the provider compares.
    expect(
      (criteria[0]!["filters"] as Array<YamlObject>).some(
        (filter: YamlObject): boolean => {
          return filter["filterType"] === "False";
        },
      ),
    ).toBe(true);
    // The name of the record an ID stands for, after it.
    expect(manifest.yaml).toContain(`monitorStatusId: ${OFFLINE} # Offline`);
    expect(manifest.yaml).toContain(
      `incidentSeverityId: ${CRITICAL} # Critical Incident`,
    );
  });

  test("never writes what OneUptime keeps: a status it moves, a time only it writes", () => {
    const fields: YamlObject = forProvider(monitorManifest().yaml);

    // ServerOwned.AfterCreate: given to create a monitor, then OneUptime's.
    expect(fields["currentMonitorStatusId"]).toBeUndefined();
    // ServerOwned.Always: no field of the kind at all.
    expect(fields["telemetryMonitorLastMonitorAt"]).toBeUndefined();
    expect(spec(monitorManifest().yaml)["initProvider"]).toBeUndefined();
  });

  test("a step's TLS key is read from a Secret, named, never written", () => {
    const manifest: CrossplaneRecordManifest = monitorManifest(
      (step: JSONObject) => {
        step["tlsClientKey"] = "-----BEGIN PRIVATE KEY----- leaked";
        step["tlsClientKeyPassphrase"] = "hunter2";
      },
    );
    const step: YamlObject = (
      forProvider(manifest.yaml)["monitorSteps"] as Array<YamlObject>
    )[0]!;

    expect(step["tlsClientKeySecretRef"]).toEqual({
      name: "checkout-api-secrets",
      key: "tls_client_key",
    });
    expect(step["tlsClientKeyPassphraseSecretRef"]).toEqual({
      name: "checkout-api-secrets",
      key: "tls_client_key_passphrase",
    });
    expect(step["tlsClientKey"]).toBeUndefined();
    expect(manifest.yaml).not.toContain("leaked");
    expect(manifest.yaml).not.toContain("hunter2");
    expect(manifest.secret).toEqual({
      name: "checkout-api-secrets",
      keys: ["tls_client_key", "tls_client_key_passphrase"],
    });
    expect(getCrossplaneSecretCommand(manifest.secret!)).toBe(
      [
        `kubectl -n ${CROSSPLANE_NAMESPACE} create secret generic checkout-api-secrets`,
        '  --from-literal=tls_client_key="..."',
        '  --from-literal=tls_client_key_passphrase="..."',
      ].join(" \\\n"),
    );
  });

  test("steps with a secret header no Secret can stand for are left out whole, and the manifest says so", () => {
    const manifest: CrossplaneRecordManifest = monitorManifest(
      (step: JSONObject) => {
        step["requestHeaders"] = { Authorization: "Bearer leaked-token" };
      },
    );

    expect(forProvider(manifest.yaml)["monitorSteps"]).toBeUndefined();
    expect(manifest.leftOutForSecrets).toEqual(["monitorSteps"]);
    expect(manifest.yaml).not.toContain("leaked-token");
    expect(manifest.yaml).toContain(
      "# Left out, because a secret is in them that only a value could carry: monitorSteps.",
    );
  });

  test("a header that reads a monitor secret is kept: it is no secret itself", () => {
    const manifest: CrossplaneRecordManifest = monitorManifest(
      (step: JSONObject) => {
        step["requestHeaders"] = {
          Authorization: "{{monitorSecrets.checkout_token}}",
          Accept: "application/json",
        };
      },
    );
    const step: YamlObject = (
      forProvider(manifest.yaml)["monitorSteps"] as Array<YamlObject>
    )[0]!;

    // Header names are the reader's own: never camelCased.
    expect(step["requestHeaders"]).toEqual({
      Authorization: "{{monitorSecrets.checkout_token}}",
      Accept: "application/json",
    });
    expect(manifest.leftOutForSecrets).toEqual([]);
  });

  test("a value the record starts with, which the record needs, goes under initProvider", () => {
    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: MessageQueue,
      json: {
        _id: "3a2b3c4d-1234-4b2c-9d8e-0123456789ab",
        name: "orders.created",
        messagingSystem: "kafka",
      },
    })!;

    expect(spec(manifest.yaml)["initProvider"]).toEqual({
      messagingSystem: "kafka",
    });
    expect(forProvider(manifest.yaml)["messagingSystem"]).toBeUndefined();
  });

  /*
   * A permission is its key (#10300): written as it is, never as the JSON
   * text of it the spec's object made it, nor left out as a JSON value the
   * manifest could not write back.
   */
  test.each([
    ["a team's", TeamPermission, "teamId"],
    ["a custom role's", CustomRolePermission, "customRoleId"],
  ])(
    "%s permission is its key",
    (_label: string, modelType: DatabaseBaseModelType, parent: string) => {
      const fields: YamlObject = forProvider(
        getCrossplaneRecordManifest({
          modelType,
          json: {
            _id: "4a2b3c4d-1234-4b2c-9d8e-0123456789ab",
            [parent]: "5a2b3c4d-1234-4b2c-9d8e-0123456789ab",
            permission: "IncidentMember",
          },
        })!.yaml,
      );

      expect(fields["permission"]).toBe("IncidentMember");
    },
  );

  test("a cloud account's provider, a name Terraform reserves, is providerValue", () => {
    const account: CloudAccount = new CloudAccount();
    account._id = "2a2b3c4d-1234-4b2c-9d8e-0123456789ab";
    account.name = "Production";
    account.provider = CloudProvider.AWS;
    account.accountId = "123456789012";

    const fields: YamlObject = forProvider(
      getCrossplaneRecordManifest({
        modelType: CloudAccount,
        json: BaseModel.toJSON(account, CloudAccount),
      })!.yaml,
    );

    expect(fields["providerValue"]).toBe("aws");
    expect(fields["provider"]).toBeUndefined();
    // An account's ID is all digits: a string, never a number.
    expect(fields["accountId"]).toBe("123456789012");
  });

  test("a secret the record needs is read from a Secret; the record's own value is never on the page", () => {
    const found:
      | {
          modelType: DatabaseBaseModelType;
          descriptor: TerraformAttributeDescriptor;
        }
      | undefined = (Models as Array<DatabaseBaseModelType>)
      .map((modelType: DatabaseBaseModelType) => {
        const descriptor: TerraformAttributeDescriptor | undefined =
          getTerraformAttributes(modelType).find(
            (item: TerraformAttributeDescriptor): boolean => {
              return (
                item.isRequired && isCrossplaneSecretField(modelType, item)
              );
            },
          );
        return descriptor ? { modelType, descriptor } : undefined;
      })
      .find(Boolean);

    expect(found).toBeDefined();

    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: found!.modelType,
      json: { _id: "4a2b3c4d-1234-4b2c-9d8e-0123456789ab" },
    })!;
    const fields: YamlObject = forProvider(manifest.yaml);
    const attribute: string = getProviderAttributeName(
      found!.descriptor.attributeName,
    );

    expect(fields[getCrossplaneFieldName(attribute)]).toBeUndefined();
    expect(Object.values(fields)).toContainEqual({
      name: `${manifest.objectName}-secrets`,
      key: attribute,
    });
    expect(manifest.secret?.keys).toEqual([attribute]);
  });

  test("a telemetry ingestion key's secret arrives in its connection Secret", () => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key._id = "5a2b3c4d-1234-4b2c-9d8e-0123456789ab";
    key.name = "Collector";

    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: TelemetryIngestionKey,
      json: BaseModel.toJSON(key, TelemetryIngestionKey),
    })!;

    expect(manifest.connectionSecret).toEqual({
      name: "collector-connection",
      keys: ["attribute.secret_key"],
    });
    expect(spec(manifest.yaml)["writeConnectionSecretToRef"]).toEqual({
      name: "collector-connection",
    });
    expect(
      getCrossplaneConnectionSecretReadCommand(
        "collector-connection",
        "attribute.secret_key",
      ),
    ).toBe(
      `kubectl -n ${CROSSPLANE_NAMESPACE} get secret collector-connection -o jsonpath='{.data.attribute\\.secret_key}' | base64 -d`,
    );
  });

  test("a monitor has a connection Secret only when its type has a key OneUptime makes", () => {
    expect(monitorManifest().connectionSecret).toBeNull();

    for (const [type, key] of [
      [MonitorType.Server, "attribute.server_monitor_secret_key"],
      [MonitorType.IncomingRequest, "attribute.incoming_request_secret_key"],
      [MonitorType.IncomingEmail, "attribute.incoming_email_secret_key"],
    ] as Array<[MonitorType, string]>) {
      const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
        modelType: Monitor,
        json: { _id: MONITOR_ID, name: "Agent", monitorType: type },
      })!;

      expect({ type, keys: manifest.connectionSecret?.keys }).toEqual({
        type,
        keys: [key],
      });
    }
  });

  /*
   * Every kind, with a value in every column OneUptime keeps or changes too
   * (TableColumnMetadata.serverOwned), each by what its kind means:
   *
   *   - always: only OneUptime writes it, so no manifest has it at all;
   *   - after-create: under initProvider when the record needs it, never
   *     under forProvider, where the provider would put it back;
   *   - shared: left to OneUptime, and named in a comment, unless the record
   *     needs it: then under forProvider, with a comment that OneUptime
   *     changes it too.
   */
  test("each kind of field OneUptime keeps, or changes too, is written as it means, for every kind", () => {
    const problems: Array<string> = [];
    const seen: Dictionary<number> = {
      always: 0,
      afterCreate: 0,
      sharedWritten: 0,
      sharedLeftOut: 0,
    };

    for (const modelType of Models as Array<DatabaseBaseModelType>) {
      if (!getCrossplaneKindOf(modelType)) {
        continue;
      }

      const columns: Dictionary<TableColumnMetadata> = getTableColumns(
        new modelType(),
      );
      const json: Dictionary<unknown> = {
        _id: "6a2b3c4d-1234-4b2c-9d8e-0123456789ab",
      };
      const serverOwned: Array<string> = Object.keys(columns).filter(
        (column: string): boolean => {
          return Boolean(columns[column]?.serverOwned);
        },
      );

      // Every column OneUptime keeps or changes too, with a value.
      for (const column of serverOwned) {
        json[column] = "6b1d0e2a-1234-4b2c-9d8e-0123456789ab";
      }

      const manifest: CrossplaneRecordManifest | null =
        getCrossplaneRecordManifest({ modelType, json });

      if (!manifest) {
        continue;
      }

      const fields: YamlObject = forProvider(manifest.yaml);
      const initProvider: YamlObject =
        (spec(manifest.yaml)["initProvider"] as YamlObject) || {};
      const sharedWritten: Array<string> = manifest.sharedFields.map(
        (shared: CrossplaneSharedField): string => {
          return shared.field;
        },
      );
      const required: Set<string> = new Set(
        getTerraformAttributes(modelType)
          .filter((descriptor: TerraformAttributeDescriptor): boolean => {
            return descriptor.isRequired;
          })
          .map((descriptor: TerraformAttributeDescriptor): string => {
            return descriptor.columnName;
          }),
      );

      for (const column of serverOwned) {
        const field: string = getCrossplaneFieldName(
          getProviderAttributeName(toTerraformSnakeCase(column)),
        );
        const where: string = `${modelType.name}.${column} (${field})`;
        const kind: ServerOwned | undefined = columns[column]?.serverOwned;

        if (kind === ServerOwned.Always) {
          seen["always"]!++;
          if (field in fields || field in initProvider) {
            problems.push(`${where}: only OneUptime writes it`);
          }
        } else if (kind === ServerOwned.AfterCreate) {
          seen["afterCreate"]!++;
          if (field in fields) {
            problems.push(`${where}: under forProvider`);
          }
        } else if (kind === ServerOwned.Shared) {
          if (field in initProvider) {
            problems.push(`${where}: under initProvider`);
          }
          if (required.has(column)) {
            seen["sharedWritten"]!++;
            if (!(field in fields) || !sharedWritten.includes(field)) {
              problems.push(`${where}: needed, and not written as shared`);
            }
          } else if (field in fields) {
            problems.push(`${where}: written, and OneUptime changes it too`);
          } else if (manifest.leftOutShared.includes(field)) {
            seen["sharedLeftOut"]!++;
          }
        } else {
          problems.push(`${where}: serverOwned is ${String(kind)}`);
        }
      }

      // The comments say what the manifest does with them.
      if (
        sharedWritten.length > 0 !==
        manifest.yaml.includes("# OneUptime changes")
      ) {
        problems.push(`${modelType.name}: comment on what it writes`);
      }
      if (
        manifest.leftOutShared.length > 0 !==
        manifest.yaml.includes("# Left to OneUptime, which changes")
      ) {
        problems.push(`${modelType.name}: comment on what it leaves out`);
      }
    }

    expect(problems).toEqual([]);
    // Each kind of field was there to check.
    expect(seen["always"]).toBeGreaterThan(10);
    expect(seen["afterCreate"]).toBeGreaterThan(0);
    // An episode's title, a host's identifier: shared, and needed.
    expect(seen["sharedWritten"]).toBeGreaterThanOrEqual(6);
    expect(seen["sharedLeftOut"]).toBeGreaterThan(20);
  });

  test("an episode's settings OneUptime changes too are left to it, but for the title it needs", () => {
    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: AlertEpisode,
      json: {
        _id: "5a2b3c4d-1234-4b2c-9d8e-0123456789ab",
        title: "Disk full",
        description: "All disks on the database servers.",
        labels: [{ _id: fixtureRecordId("Label", "production") }],
      },
    })!;

    expect(forProvider(manifest.yaml)).toEqual({ title: "Disk full" });
    expect(manifest.sharedFields).toEqual([{ field: "title", isList: false }]);
    expect(manifest.leftOutShared).toEqual(["description", "labels"]);
    expect(manifest.yaml).toContain(
      [
        "    title: Disk full",
        "    # OneUptime changes title too. The provider sends it when you change it here,",
        "    # and keeps OneUptime's changes in between.",
        "    # Left to OneUptime, which changes them too: description and labels.",
        "    # The provider leaves them as they are. Write one here to manage it from this manifest.",
      ].join("\n"),
    );
  });

  test("an incident's labels are left to OneUptime, whose label rules add to them", () => {
    const manifest: CrossplaneRecordManifest = getCrossplaneRecordManifest({
      modelType: Incident,
      json: {
        _id: "7a2b3c4d-1234-4b2c-9d8e-0123456789ab",
        title: "Checkout is down",
        incidentSeverityId: CRITICAL,
        labels: [{ _id: fixtureRecordId("Label", "production") }],
      },
    })!;

    expect(forProvider(manifest.yaml)["labels"]).toBeUndefined();
    expect(manifest.sharedFields).toEqual([]);
    expect(manifest.leftOutShared).toEqual(["labels"]);
    expect(manifest.yaml).toContain(
      "    # Left to OneUptime, which changes it too: labels.\n    # The provider leaves it as it is. Write it here to manage it from this manifest.",
    );
    expect(manifest.yaml).not.toContain("# OneUptime changes");
  });
});

// A row of a field OneUptime changes too ends by saying so.
const SAYS_ONEUPTIME_CHANGES_IT_TOO: RegExp =
  /OneUptime may (change|add to) it too\.$/;

// The comment a manifest writes about the fields OneUptime changes too.
const SHARED_FIELDS_COMMENT: RegExp = /# OneUptime (changes|adds to)/;

function project(): DeveloperDocsExampleContext {
  return { live: getFixtureLiveData() };
}

describe("a new resource's manifest", () => {
  test("a monitor: the fields the Terraform page sets, filled in from this project", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: Monitor,
      context: project(),
    })!;
    const fields: YamlObject = forProvider(example.yaml);

    expect(example.kind).toBe("Monitor");
    expect(parse(example.yaml)["metadata"]).toEqual({
      name: example.objectName,
      namespace: CROSSPLANE_NAMESPACE,
    });
    expect(fields["monitorType"]).toBe("Website");
    expect(fields["monitorSteps"]).toEqual(expect.any(Array));
    expect(fields["labels"]).toEqual([fixtureRecordId("Label", "production")]);
    expect(example.usesProjectData).toBe(true);
    expect(example.isPlaceholder).toBe(false);
    // What each field is for, by the kind's names for them.
    expect(
      example.rows.map((row: { name: string }): string => {
        return row.name;
      }),
    ).toEqual(expect.arrayContaining(["name", "monitorType", "monitorSteps"]));
    expect(example.getCommand).toBe(
      `kubectl -n ${CROSSPLANE_NAMESPACE} get monitor.crossplane.oneuptime.com ${example.objectName}`,
    );
  });

  test("an incident takes the project's severity, and its IDs as references to resources of the namespace", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: Incident,
      context: project(),
    })!;

    expect(forProvider(example.yaml)["incidentSeverityId"]).toBe(CRITICAL);
    expect(example.yaml).toContain(
      `incidentSeverityId: ${CRITICAL} # Critical Incident`,
    );
    expect(forProvider(example.referencesYaml!)).toEqual(
      expect.objectContaining({
        incidentSeverityIdRef: { name: "critical-incident" },
        monitorsRefs: [{ name: "checkout-api" }],
        labelsRefs: [{ name: "production" }],
      }),
    );
  });

  test("a description says Crossplane manages it, never Terraform", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: TelemetryIngestionKey,
      context: project(),
    })!;

    expect(forProvider(example.yaml)["description"]).toBe(
      "Managed with Crossplane.",
    );
    expect(example.connectionSecret?.keys).toEqual(["attribute.secret_key"]);
  });

  test("with nothing looked up, an ID the resource needs is a placeholder to replace", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: Incident,
      context: { live: getEmptyFixtureLiveData() },
    })!;

    expect(example.isPlaceholder).toBe(true);
    expect(forProvider(example.yaml)["incidentSeverityId"]).toBe(
      "<incident severity id>",
    );
  });

  /*
   * Every kind's example, by each kind of field OneUptime keeps or changes
   * too: never one only OneUptime writes, never under forProvider one a
   * record starts with, and one people set and OneUptime changes too only
   * with a comment and a row that say OneUptime changes it too.
   */
  test("every kind's example reads back as YAML, and writes each field OneUptime keeps, or changes too, as it means", () => {
    const problems: Array<string> = [];
    let sharedSeen: number = 0;

    for (const modelType of Models as Array<DatabaseBaseModelType>) {
      if (!getCrossplaneKindOf(modelType)) {
        continue;
      }

      const example: CrossplaneCreateExample | null =
        getCrossplaneCreateExample({ modelType, context: project() });

      if (!example) {
        continue;
      }

      const fields: YamlObject = forProvider(example.yaml);
      const initProvider: YamlObject =
        (spec(example.yaml)["initProvider"] as YamlObject) || {};
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(
        new modelType(),
      );
      const shared: Array<string> = example.sharedFields.map(
        (field: CrossplaneSharedField): string => {
          return field.field;
        },
      );

      for (const descriptor of getTerraformAttributes(modelType)) {
        const field: string = getCrossplaneFieldOf(descriptor);
        const where: string = `${modelType.name}.${field}`;
        const kind: ServerOwned | undefined =
          columns[descriptor.columnName]?.serverOwned;
        const isWritten: boolean = field in fields || field in initProvider;

        if (kind === ServerOwned.Always && isWritten) {
          problems.push(`${where}: only OneUptime writes it`);
        }

        if (kind === ServerOwned.AfterCreate && field in fields) {
          problems.push(`${where}: under forProvider`);
        }

        if (kind === ServerOwned.Shared && isWritten) {
          sharedSeen++;
          const row: { name: string; about: string } | undefined =
            example.rows.find((candidate: { name: string }): boolean => {
              return candidate.name === field;
            });

          if (!shared.includes(field) || field in initProvider) {
            problems.push(`${where}: not written as shared`);
          }
          if (row && !SAYS_ONEUPTIME_CHANGES_IT_TOO.test(row.about)) {
            problems.push(`${where}: its row does not say so`);
          }
        }

        if (kind !== ServerOwned.Shared && shared.includes(field)) {
          problems.push(`${where}: called shared`);
        }

        // No secret is ever a value: a Secret is named instead.
        if (isCrossplaneSecretField(modelType, descriptor) && field in fields) {
          problems.push(`${where} is a secret`);
        }
      }

      if (shared.length > 0 !== SHARED_FIELDS_COMMENT.test(example.yaml)) {
        problems.push(`${modelType.name}: comment on what it writes`);
      }
    }

    expect(problems).toEqual([]);
    expect(sharedSeen).toBeGreaterThan(10);
  });

  test("a new monitor's labels: OneUptime adds to them too, and the provider keeps what it adds", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: Monitor,
      context: project(),
    })!;

    expect(forProvider(example.yaml)["labels"]).toEqual([
      fixtureRecordId("Label", "production"),
    ]);
    expect(example.sharedFields).toEqual([{ field: "labels", isList: true }]);
    expect(example.yaml).toContain(
      "    # OneUptime adds to labels too. The provider removes only the entries you take out here.\n",
    );
    expect(
      example.rows.find((row: { name: string }): boolean => {
        return row.name === "labels";
      }),
    ).toEqual({
      name: "labels",
      about: "Labels to find and filter it by. OneUptime may add to it too.",
      required: false,
    });
  });

  test("a new episode: its title is needed, and OneUptime changes it too", () => {
    const example: CrossplaneCreateExample = getCrossplaneCreateExample({
      modelType: AlertEpisode,
      context: project(),
    })!;
    const title: { required: boolean; about: string } | undefined =
      example.rows.find((row: { name: string }): boolean => {
        return row.name === "title";
      });

    expect(forProvider(example.yaml)["title"]).toEqual(expect.any(String));
    expect(title?.required).toBe(true);
    expect(title?.about).toMatch(/ OneUptime may change it too\.$/);
    expect(example.yaml).toContain(
      "    # OneUptime changes these too: title, description and alertSeverityId.\n    # The provider sends each when you change it here, and keeps OneUptime's changes in between.\n",
    );
  });
});

describe("observing the records there are", () => {
  test("one manifest each, by its ID, every one with a name of its own", () => {
    const text: string = getCrossplaneObserveManifests({
      modelType: Monitor,
      targets: [
        {
          id: "1a2b3c4d-1234-4b2c-9d8e-0123456789ab",
          displayName: "Checkout API",
        },
        {
          id: "2a2b3c4d-1234-4b2c-9d8e-0123456789ab",
          displayName: "Checkout API",
        },
        { id: "3a2b3c4d-1234-4b2c-9d8e-0123456789ab", displayName: "監視" },
      ],
    })!;
    const documents: Array<YamlObject> = yaml.loadAll(
      text,
    ) as Array<YamlObject>;

    expect(
      documents.map((document: YamlObject): unknown => {
        return (document["metadata"] as YamlObject)["name"];
      }),
    ).toEqual(["checkout-api", "checkout-api-2", "monitor-3a2b3c4d"]);

    for (const document of documents) {
      expect((document["spec"] as YamlObject)["managementPolicies"]).toEqual([
        "Observe",
      ]);
      expect(
        ((document["metadata"] as YamlObject)["annotations"] as YamlObject)[
          CROSSPLANE_EXTERNAL_NAME_ANNOTATION
        ],
      ).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test("nothing to observe is nothing", () => {
    expect(
      getCrossplaneObserveManifests({ modelType: Monitor, targets: [] }),
    ).toBeNull();
  });
});

describe("a monitor step's secrets", () => {
  test("are the attributes monitorsteps.go marks Sensitive", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
      ),
      "utf8",
    );
    const sensitive: Array<string> = Array.from(
      source.matchAll(
        /"([a-z_]+)":\s*schema\.\w+Attribute\{(?:(?!\n\t\t"[a-z_]+":)[\s\S])*?Sensitive:\s*true/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect([...sensitive].sort()).toEqual(
      [...MONITOR_STEP_SECRET_ATTRIBUTES].sort(),
    );
  });
});
