/*
 * The database definition's loadContext asks the analytics API (see
 * DatabaseEngineMetricsProbe), whose real module needs a browser `window`.
 * Nothing here calls it — its behaviour is pinned in Common/Tests/App/
 * Dashboard/DatabaseRecommendationsEngineMetrics.test.ts — so a stand-in
 * lets this node-environment suite import the registry.
 */
jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<never> => {
        return Promise.reject(new Error("not available in this suite"));
      },
    },
  };
});

/*
 * A queue's broker series are read from its telemetry
 * (fetchMessageQueueObservedSeries), whose real module needs a browser
 * `window`. What each answer does to the context is pinned below.
 */
const mockQueueObservedSeries: jest.Mock = jest.fn();

jest.mock(
  "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries",
  () => {
    return {
      __esModule: true,
      fetchMessageQueueObservedSeries: (data: unknown): Promise<unknown> => {
        return mockQueueObservedSeries(data);
      },
    };
  },
);

/*
 * What a cloud runs is the server's to say (fetchOpenStackInventorySummary), whose real module needs
 * a browser `window` too. What each answer does to the context is pinned below.
 */
const mockOpenStackSummary: jest.Mock = jest.fn();
const mockOpenStackChecksOn: jest.Mock = jest.fn();

jest.mock(
  "../../FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackResourceUtils",
  () => {
    return {
      __esModule: true,
      fetchOpenStackInventorySummary: (id: unknown): Promise<unknown> => {
        return mockOpenStackSummary(id);
      },
      fetchOpenStackChecksOn: async (id: unknown): Promise<unknown> => {
        return (
          (await mockOpenStackChecksOn(id)) || {
            isApiCheckOn: false,
            isLifecycleCheckOn: false,
          }
        );
      },
    };
  },
);

/*
 * An App Platforms app's context is finished by reading its environment
 * (loadCloudAppRecommendationContext), with the real client, which needs a
 * browser `window`. What each answer does to the context is pinned below.
 */
const mockModelApiGetItem: jest.Mock = jest.fn();

/*
 * A Kubernetes cluster's context is finished by counting its nodes with an
 * image disk of their own (hasKubernetesClusterSeparateImageDisk), with the
 * same client. What each answer does to the context is pinned below.
 */
const mockModelApiCount: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (data: unknown): Promise<unknown> => {
        return mockModelApiGetItem(data);
      },
      count: (data: unknown): Promise<unknown> => {
        return mockModelApiCount(data);
      },
    },
  };
});

import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
  describeCloudReadIntervalCost,
  getMessageQueueRecommendableMetrics,
  joinCloudRecommendationNotes,
  loadMessageQueueRecommendationContext,
  readCloudConnectionRecommendationContext,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import {
  RdsConnectionEngine,
  RdsConnectionLimitGap,
} from "Common/Types/Cloud/RdsConnectionLimits";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import {
  MESSAGE_QUEUE_METRICS,
  getMessageQueueMetricId,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import { buildMessageQueueIdentifier } from "Common/Types/MessageQueue/MessageQueueIdentity";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Service from "Common/Models/DatabaseModels/Service";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import { OPENSHIFT_KUBERNETES_PROVIDER } from "Common/Types/Kubernetes/KubernetesClusterProvider";
import {
  OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID,
  OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID,
  OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
} from "Common/Types/Monitor/OpenShiftAlertTemplates";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Permission from "Common/Types/Permission";
import TechStack from "Common/Types/Service/TechStack";
import MonitorRecommendationCatalog, {
  KUBERNETES_IMAGE_DISK_TEMPLATE_ID,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * This registry is the only place that knows which Postgres model a resource
 * type is, and which of that model's columns carries the identifier the
 * telemetry is tagged with. Both `RecommendationsPage` and
 * `RecommendationsSideMenuItem` ask it and then quietly give up when the answer
 * is `undefined` — the page renders nothing, the badge never appears, and no
 * error is logged anywhere. Every failure mode of this file is silent, which is
 * why the assertions below are deliberately paranoid about things that "cannot"
 * be wrong.
 *
 * These enumerate the ENUM rather than a hand-kept list, so adding a member to
 * `MonitorRecommendationResourceType` fails here until it is wired into the
 * table.
 */

const ALL_RESOURCE_TYPES: Array<MonitorRecommendationResourceType> =
  Object.values(MonitorRecommendationResourceType);

/*
 * A value that is not in the enum, standing in for the two ways an unknown
 * resource type actually reaches this code: a page still mounted from a
 * previous deploy, and a caller that widened the parameter to `string`.
 */
const UNKNOWN_RESOURCE_TYPE: MonitorRecommendationResourceType =
  "SomeResourceTypeThatDoesNotExist" as MonitorRecommendationResourceType;

/*
 * The documented per-type identifier mapping, restated here so a change to the
 * registry has to be made twice, on purpose.
 *
 * This is not redundancy for its own sake: `identifierFieldName` is the value
 * every monitor already created for that resource type was scoped to. Changing
 * a row silently orphans all of them from the already-created diff — every
 * recommendation the user already acted on reappears as available, and
 * accepting it a second time creates duplicate monitors. Nothing throws.
 *
 * Typed as a total Record over the enum, so a new enum member is a compile
 * error here as well as a runtime failure below.
 */
const EXPECTED_IDENTIFIER_FIELD: Record<
  MonitorRecommendationResourceType,
  string
> = {
  [MonitorRecommendationResourceType.Kubernetes]: "clusterIdentifier",
  [MonitorRecommendationResourceType.Host]: "hostIdentifier",
  [MonitorRecommendationResourceType.Docker]: "hostIdentifier",
  [MonitorRecommendationResourceType.Podman]: "hostIdentifier",
  [MonitorRecommendationResourceType.DockerSwarm]: "name",
  [MonitorRecommendationResourceType.Proxmox]: "name",
  [MonitorRecommendationResourceType.OpenStack]: "name",
  [MonitorRecommendationResourceType.VMware]: "name",
  [MonitorRecommendationResourceType.Ceph]: "name",
  [MonitorRecommendationResourceType.StorageArray]: "name",
  [MonitorRecommendationResourceType.IoTDevice]: "name",
  [MonitorRecommendationResourceType.RumApplication]: "_id",
  [MonitorRecommendationResourceType.Service]: "_id",
  [MonitorRecommendationResourceType.DatabaseServer]: "_id",
  [MonitorRecommendationResourceType.DataStore]: "_id",
  [MonitorRecommendationResourceType.DataPipeline]: "_id",
  // Every template names the CloudResource row in its queries' event scope.
  [MonitorRecommendationResourceType.CloudResource]: "_id",
  /*
   * An app's monitors are scoped by its telemetry filter (its spans carry no
   * row id); `_id` names the app the tab is for, as a cloud resource's does.
   */
  [MonitorRecommendationResourceType.CloudApp]: "_id",
  // A function's spans are read by its faas.name, a context column.
  [MonitorRecommendationResourceType.ServerlessFunction]: "_id",
  // A queue's broker series are read from telemetry, as context.
  [MonitorRecommendationResourceType.MessageQueue]: "_id",
  // Its devices' check-ins carry the connection's row id (#9835).
  [MonitorRecommendationResourceType.DeviceManagementConnection]: "_id",
};

function getDefinitionOrFail(
  resourceType: MonitorRecommendationResourceType,
): RecommendationResourceDefinition {
  const definition: RecommendationResourceDefinition | undefined =
    RecommendationResourceRegistry.getDefinition(resourceType);

  if (!definition) {
    throw new Error(`No registry definition for resource type ${resourceType}`);
  }

  return definition;
}

/* Build a model instance for a resource type with both fields populated. */
/*
 * A Service row carrying only the technology columns, for the context tests.
 * Written straight onto the instance the way the API response is, so this is
 * the exact shape `readContext` indexes into.
 */
function buildServiceModel(values: {
  telemetrySdkLanguage?: string | undefined;
  runtimeName?: string | undefined;
  techStack?: Array<TechStack> | undefined;
}): BaseModel {
  const model: Service = new Service();

  /*
   * Written through an index signature rather than through the typed
   * properties, for the same reason `buildModel` above does it: the model
   * declares these columns as optional, and under `exactOptionalPropertyTypes`
   * assigning an explicit `undefined` to an optional property is an error even
   * though that is exactly the state the API leaves an unselected column in.
   * Indexing reproduces the real shape `readContext` has to cope with —
   * including a column that is present and undefined.
   */
  const record: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  record["telemetrySdkLanguage"] = values.telemetrySdkLanguage;
  record["runtimeName"] = values.runtimeName;
  record["techStack"] = values.techStack;

  return model;
}

function buildModel(
  resourceType: MonitorRecommendationResourceType,
  values: { identifier?: unknown; displayName?: unknown },
): BaseModel {
  const definition: RecommendationResourceDefinition =
    getDefinitionOrFail(resourceType);

  const model: BaseModel = new definition.modelType();
  const record: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  if ("identifier" in values) {
    record[definition.identifierFieldName] = values.identifier;
  }

  if ("displayName" in values) {
    record[definition.displayNameFieldName] = values.displayName;
  }

  return model;
}

describe("RecommendationResourceRegistry", () => {
  describe("coverage of the resource type enum", () => {
    test("every resource type in the enum has a definition", () => {
      /*
       * The load-bearing assertion of this file. A resource type present in the
       * enum but absent from the table produces a page that renders
       * "no recommendations" and a side menu with no badge — indistinguishable
       * from a resource that genuinely has nothing to recommend.
       */
      for (const resourceType of ALL_RESOURCE_TYPES) {
        expect(
          RecommendationResourceRegistry.getDefinition(resourceType),
        ).toBeDefined();
      }
    });

    test("there is exactly one definition per resource type and no extras", () => {
      const definitions: Array<RecommendationResourceDefinition> =
        RecommendationResourceRegistry.getDefinitions();

      const resourceTypes: Array<MonitorRecommendationResourceType> =
        definitions.map((definition: RecommendationResourceDefinition) => {
          return definition.resourceType;
        });

      /*
       * `getDefinition` uses `find`, so a duplicate row is not an error — the
       * second one is simply never reached. That makes a copy-paste mistake
       * (duplicating Docker's row and forgetting to change `resourceType` to
       * Podman) look like a working registry while Podman silently uses
       * Docker's model.
       */
      expect(new Set<string>(resourceTypes).size).toBe(definitions.length);
      expect(definitions.length).toBe(ALL_RESOURCE_TYPES.length);
    });

    test("no definition names a resource type that is not in the enum", () => {
      for (const definition of RecommendationResourceRegistry.getDefinitions()) {
        expect(ALL_RESOURCE_TYPES).toContain(definition.resourceType);
      }
    });

    test("getDefinition returns undefined for a resource type that is not registered", () => {
      expect(
        RecommendationResourceRegistry.getDefinition(UNKNOWN_RESOURCE_TYPE),
      ).toBeUndefined();
    });
  });

  describe("getDefinitions", () => {
    test("does not hand out the internal array", () => {
      /*
       * Callers iterate this to build menus and counts. If the internal array
       * leaked, one caller doing `.sort()`, `.push()` or `.splice()` would
       * reorder or destroy the registry for every later caller in the same
       * browser session — a bug that only shows up after a particular
       * navigation order.
       */
      const first: Array<RecommendationResourceDefinition> =
        RecommendationResourceRegistry.getDefinitions();
      const originalLength: number = first.length;
      const originalFirstType: MonitorRecommendationResourceType =
        first[0]!.resourceType;

      first.push({
        resourceType: UNKNOWN_RESOURCE_TYPE,
        modelType: first[0]!.modelType,
        identifierFieldName: "nope",
        displayNameFieldName: "nope",
      });

      const afterPush: Array<RecommendationResourceDefinition> =
        RecommendationResourceRegistry.getDefinitions();

      expect(afterPush.length).toBe(originalLength);
      expect(
        RecommendationResourceRegistry.getDefinition(UNKNOWN_RESOURCE_TYPE),
      ).toBeUndefined();

      afterPush.reverse();

      expect(
        RecommendationResourceRegistry.getDefinitions()[0]!.resourceType,
      ).toBe(originalFirstType);
    });

    test("returns a distinct array object on each call", () => {
      expect(RecommendationResourceRegistry.getDefinitions()).not.toBe(
        RecommendationResourceRegistry.getDefinitions(),
      );
    });
  });

  describe("declared fields exist on the declared model", () => {
    test("every modelType constructs", () => {
      for (const definition of RecommendationResourceRegistry.getDefinitions()) {
        expect(new definition.modelType()).toBeInstanceOf(BaseModel);
      }
    });

    test("every declared field is a real column on the model", () => {
      /*
       * Checked against the model itself rather than a hardcoded list of column
       * names, so this keeps working when a model gains columns and still fails
       * when one is renamed.
       *
       * A renamed or mistyped column here is the worst failure mode in the
       * file: `readResourceFields` reads `undefined` off the instance and
       * returns "", `getSelect` asks the API for a column that does not exist,
       * and the monitors that do get created are scoped to an empty identifier
       * — they match every resource, or none, depending on the template.
       */
      for (const definition of RecommendationResourceRegistry.getDefinitions()) {
        const model: BaseModel = new definition.modelType();

        /*
         * Context columns are held to exactly the same bar as the two
         * mandatory ones. They fail more quietly than either: a mistyped
         * context column does not blank the page, it silently narrows a Java
         * service's recommendations down to the language-agnostic subset,
         * which looks like a correct page with fewer cards on it.
         */
        const declaredFields: Array<string> = [
          definition.identifierFieldName,
          definition.displayNameFieldName,
          ...(definition.contextFieldNames || []),
        ];

        for (const fieldName of declaredFields) {
          expect(model.hasColumn(fieldName)).toBe(true);

          /*
           * These models declare their columns as optional public properties
           * initialised to `undefined`, so the property is a real own property
           * of a fresh instance. `readResourceFields` indexes the instance
           * directly, so this is the exact lookup it performs.
           */
          expect(fieldName in model).toBe(true);
        }
      }
    });

    test("every declared field is listed in the model's own table columns", () => {
      for (const definition of RecommendationResourceRegistry.getDefinitions()) {
        const columns: Array<string> = new definition.modelType()
          .getTableColumns()
          .columns.map((column: string) => {
            return column;
          });

        expect(columns).toContain(definition.identifierFieldName);
        expect(columns).toContain(definition.displayNameFieldName);

        for (const contextFieldName of definition.contextFieldNames || []) {
          expect(columns).toContain(contextFieldName);
        }
      }
    });
  });

  describe("identifier and display name field mapping", () => {
    test.each(ALL_RESOURCE_TYPES)(
      "%s scopes its monitors by the documented column",
      (resourceType: MonitorRecommendationResourceType) => {
        expect(getDefinitionOrFail(resourceType).identifierFieldName).toBe(
          EXPECTED_IDENTIFIER_FIELD[resourceType],
        );
      },
    );

    test("every resource type names its monitors from its name column", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        expect(getDefinitionOrFail(resourceType).displayNameFieldName).toBe(
          // A pipeline is named by its job: it has no name of its own.
          resourceType === MonitorRecommendationResourceType.DataPipeline
            ? "jobName"
            : "name",
        );
      }
    });

    test("no two resource types share a model", () => {
      /*
       * Two rows pointing at the same model means one of them fetches the wrong
       * record entirely: the id in the URL belongs to a different table, so the
       * API returns nothing and the page reads a null model — again, silently.
       */
      const modelTypes: Array<unknown> =
        RecommendationResourceRegistry.getDefinitions().map(
          (definition: RecommendationResourceDefinition) => {
            return definition.modelType;
          },
        );

      expect(new Set<unknown>(modelTypes).size).toBe(modelTypes.length);
    });
  });

  describe("getSelect", () => {
    test("selects both declared fields for every resource type", () => {
      /*
       * A field missing from the select comes back `undefined` from the API,
       * which `readResourceFields` turns into "" — the page then behaves as if
       * the resource has no telemetry yet rather than reporting an error.
       */
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        const select: Record<string, boolean> =
          RecommendationResourceRegistry.getSelect(resourceType);

        expect(select[definition.identifierFieldName]).toBe(true);
        expect(select[definition.displayNameFieldName]).toBe(true);
      }
    });

    test("selects nothing beyond the declared fields", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        const allowed: Set<string> = new Set<string>([
          definition.identifierFieldName,
          definition.displayNameFieldName,
          ...(definition.contextFieldNames || []),
        ]);

        for (const key of Object.keys(
          RecommendationResourceRegistry.getSelect(resourceType),
        )) {
          expect(allowed.has(key)).toBe(true);
        }
      }
    });

    test("returns an empty select for an unregistered resource type", () => {
      /*
       * Must be `{}` and not `undefined`: callers spread this straight into a
       * `ModelAPI.getItem` request, and `undefined` there would fetch every
       * column of the table instead of failing loudly.
       */
      expect(
        RecommendationResourceRegistry.getSelect(UNKNOWN_RESOURCE_TYPE),
      ).toEqual({});
    });

    test("returns a fresh select object each call", () => {
      const select: Record<string, boolean> =
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.Kubernetes,
        );

      select["injected"] = true;

      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.Kubernetes,
        )["injected"],
      ).toBeUndefined();
    });
  });

  describe("readResourceFields", () => {
    test("reads both fields off a model for every resource type", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        const model: BaseModel = buildModel(resourceType, {
          identifier: "resource-identifier-value",
          displayName: "Resource Display Name",
        });

        const fields: {
          resourceIdentifier: string;
          resourceDisplayName: string;
        } = RecommendationResourceRegistry.readResourceFields({
          resourceType: resourceType,
          model: model,
        });

        /*
         * The four `name`-identified types write both values into the same
         * column, so the second write wins for them. Asserting per definition
         * rather than per literal keeps this test honest for both shapes.
         */
        const isSameColumn: boolean =
          definition.identifierFieldName === definition.displayNameFieldName;

        expect(fields.resourceIdentifier).toBe(
          isSameColumn ? "Resource Display Name" : "resource-identifier-value",
        );
        expect(fields.resourceDisplayName).toBe("Resource Display Name");
      }
    });

    test("falls back to the identifier when the display name is blank", () => {
      /*
       * Without the fallback, a cluster saved with an empty name produces
       * monitors literally called " - Node Not Ready" — a list of monitors that
       * all sort together and none of which say what they watch.
       */
      const fields: {
        resourceIdentifier: string;
        resourceDisplayName: string;
      } = RecommendationResourceRegistry.readResourceFields({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        model: buildModel(MonitorRecommendationResourceType.Kubernetes, {
          identifier: "prod-cluster-01",
          displayName: "",
        }),
      });

      expect(fields.resourceIdentifier).toBe("prod-cluster-01");
      expect(fields.resourceDisplayName).toBe("prod-cluster-01");
    });

    test("falls back to the identifier when the display name column was not selected", () => {
      const fields: {
        resourceIdentifier: string;
        resourceDisplayName: string;
      } = RecommendationResourceRegistry.readResourceFields({
        resourceType: MonitorRecommendationResourceType.Host,
        model: buildModel(MonitorRecommendationResourceType.Host, {
          identifier: "host-abc",
        }),
      });

      expect(fields.resourceIdentifier).toBe("host-abc");
      expect(fields.resourceDisplayName).toBe("host-abc");
    });

    test("keeps the display name when it is set and differs from the identifier", () => {
      const fields: {
        resourceIdentifier: string;
        resourceDisplayName: string;
      } = RecommendationResourceRegistry.readResourceFields({
        resourceType: MonitorRecommendationResourceType.Docker,
        model: buildModel(MonitorRecommendationResourceType.Docker, {
          identifier: "docker-host-7",
          displayName: "Build Runner",
        }),
      });

      expect(fields.resourceIdentifier).toBe("docker-host-7");
      expect(fields.resourceDisplayName).toBe("Build Runner");
    });

    test("returns empty strings for a null model", () => {
      /*
       * The real path: the API call is still in flight, or returned nothing.
       * Both callers render before the fetch resolves, so this runs on the
       * first paint of every recommendations page.
       */
      expect(
        RecommendationResourceRegistry.readResourceFields({
          resourceType: MonitorRecommendationResourceType.Kubernetes,
          model: null,
        }),
      ).toEqual({ resourceIdentifier: "", resourceDisplayName: "" });
    });

    test("returns empty strings for an unregistered resource type", () => {
      expect(
        RecommendationResourceRegistry.readResourceFields({
          resourceType: UNKNOWN_RESOURCE_TYPE,
          model: buildModel(MonitorRecommendationResourceType.Kubernetes, {
            identifier: "prod-cluster-01",
            displayName: "Prod Cluster",
          }),
        }),
      ).toEqual({ resourceIdentifier: "", resourceDisplayName: "" });
    });

    test("returns empty strings, not undefined, when neither field is set", () => {
      /*
       * A resource created before the agent ever reported in has a null
       * identifier column. These values are concatenated into monitor names and
       * interpolated into monitor steps, so `undefined` leaking out would
       * surface as the literal text "undefined" in incident titles.
       */
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const fields: {
          resourceIdentifier: string;
          resourceDisplayName: string;
        } = RecommendationResourceRegistry.readResourceFields({
          resourceType: resourceType,
          model: buildModel(resourceType, {}),
        });

        expect(fields).toEqual({
          resourceIdentifier: "",
          resourceDisplayName: "",
        });
      }
    });

    test("returns empty strings when a field holds a non-string value", () => {
      /*
       * JSON off the wire is not type checked. A column that comes back as a
       * number or an object must not be handed on as-is, or it reaches
       * `MonitorStep` where it is compared against telemetry attributes and
       * never matches.
       */
      const fields: {
        resourceIdentifier: string;
        resourceDisplayName: string;
      } = RecommendationResourceRegistry.readResourceFields({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        model: buildModel(MonitorRecommendationResourceType.Kubernetes, {
          identifier: 42,
          displayName: { toString: "not a string" },
        }),
      });

      expect(fields.resourceIdentifier).toBe("");
      expect(fields.resourceDisplayName).toBe("");
    });
  });

  describe("agreement with the Common catalog", () => {
    test("every registered resource type also has a catalog definition", () => {
      /*
       * The two registries are edited in different packages by different
       * changes. If they drift, the symptom depends on which side is missing:
       * a registry row with no catalog entry renders a page with zero cards but
       * a working header, and the reverse renders nothing at all. Neither
       * throws.
       */
      for (const definition of RecommendationResourceRegistry.getDefinitions()) {
        expect(
          MonitorRecommendationCatalog.getResourceTypeDefinition(
            definition.resourceType,
          ),
        ).toBeDefined();
        /*
         * Every recommendation the type can ever produce: a database's
         * context-free set is empty by design (no engine, nothing applies).
         */
        expect(
          MonitorRecommendationCatalog.getAllPossibleRecommendations(
            definition.resourceType,
          ).length,
        ).toBeGreaterThan(0);
      }
    });

    test("every catalog resource type also has a registry definition", () => {
      for (const catalogDefinition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        expect(
          RecommendationResourceRegistry.getDefinition(
            catalogDefinition.resourceType,
          ),
        ).toBeDefined();
      }
    });

    test("the two registries cover exactly the same set of resource types", () => {
      const registryTypes: Array<MonitorRecommendationResourceType> =
        RecommendationResourceRegistry.getDefinitions().map(
          (definition: RecommendationResourceDefinition) => {
            return definition.resourceType;
          },
        );

      const catalogTypes: Array<MonitorRecommendationResourceType> =
        MonitorRecommendationCatalog.getResourceTypeDefinitions().map(
          (definition: { resourceType: MonitorRecommendationResourceType }) => {
            return definition.resourceType;
          },
        );

      expect([...registryTypes].sort()).toEqual([...catalogTypes].sort());
    });
  });

  /*
   * The context reader — the half of this registry that decides WHICH
   * recommendations a resource is offered, rather than which resource they are
   * scoped to.
   *
   * Every failure here is quiet in a new way. The identifier reader failing
   * produces a visible "No telemetry yet" empty state; the context reader
   * failing produces a page that looks completely normal with six fewer cards
   * on it, and nobody can tell by looking whether that is correct.
   */
  describe("readContext", () => {
    test("reads a service's runtime from the SDK language attribute", () => {
      const model: BaseModel = buildServiceModel({
        telemetrySdkLanguage: "java",
      });

      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: model,
        }),
      ).toEqual({ serviceLanguage: "java" });
    });

    test("falls back to the runtime name, then to the tech stack", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: buildServiceModel({ runtimeName: "OpenJDK Runtime" }),
        }),
      ).toEqual({ serviceLanguage: "java" });

      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: buildServiceModel({ techStack: [TechStack.Go] }),
        }),
      ).toEqual({ serviceLanguage: "go" });
    });

    test("reports an unknown runtime as null, never as a guess", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: buildServiceModel({}),
        }),
      ).toEqual({ serviceLanguage: null });
    });

    /*
     * `techStack` is a JSON column, so what comes back is whatever was stored.
     * A string would be iterated character by character by the detector, and
     * a single stray character matching a tech stack value would assign a
     * language from nothing at all.
     */
    test("ignores a techStack that is not an array", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: buildServiceModel({
            techStack: "Java" as unknown as Array<TechStack>,
          }),
        }),
      ).toEqual({ serviceLanguage: null });
    });

    test("returns an empty context for a null model", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.Service,
          model: null,
        }),
      ).toEqual({});
    });

    test("returns an empty context for an unregistered resource type", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: UNKNOWN_RESOURCE_TYPE,
          model: new Service(),
        }),
      ).toEqual({});
    });

    test("returns an empty context for every resource type without a reader", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        if (definition.readContext) {
          continue;
        }

        expect(
          RecommendationResourceRegistry.readContext({
            resourceType: resourceType,
            model: new definition.modelType(),
          }),
        ).toEqual({});
      }
    });

    /*
     * The load-bearing one. `readContext` indexes the fetched model directly,
     * so a column it reads but `getSelect` does not request comes back
     * undefined — and undefined here does not throw, it silently narrows a
     * Java service down to the language-agnostic recommendations.
     */
    test("every column the reader reads is a column the fetch requests", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        const select: Record<string, boolean> =
          RecommendationResourceRegistry.getSelect(resourceType);

        for (const contextFieldName of definition.contextFieldNames || []) {
          expect(select[contextFieldName]).toBe(true);
        }
      }
    });

    test("explains the runtime it detected, and what it means when it did not", () => {
      const known: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.Service,
          context: { serviceLanguage: "dotnet" },
        });

      expect(known).toContain(".NET");

      const unknown: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.Service,
          context: { serviceLanguage: null },
        });

      /*
       * The unknown case is the one worth pinning. Without a note the page is
       * eight cards with no explanation, and the user cannot tell whether that
       * is everything OneUptime has or a gap they can close. The note has to
       * name what to do about it.
       */
      expect(unknown).toBeTruthy();
      expect(unknown).toContain("telemetry.sdk.language");
      expect(unknown).not.toBe(known);
    });

    test("says nothing for resource types whose list is a constant", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        if (getDefinitionOrFail(resourceType).describeContext) {
          continue;
        }

        expect(
          RecommendationResourceRegistry.describeContext({
            resourceType: resourceType,
            context: {},
          }),
        ).toBeUndefined();
      }

      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: UNKNOWN_RESOURCE_TYPE,
          context: {},
        }),
      ).toBeUndefined();
    });

    test("a reader and its column list are declared together, or not at all", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        expect(Boolean(definition.readContext)).toBe(
          Boolean(definition.contextFieldNames?.length),
        );

        /*
         * And a describer only makes sense where there is a context to
         * describe — a note on a resource type whose list never varies would
         * be a permanent, meaningless banner.
         */
        expect(Boolean(definition.describeContext)).toBe(
          Boolean(definition.readContext),
        );

        // Telemetry only ever completes a context the row started.
        if (definition.loadContext) {
          expect(definition.readContext).toBeDefined();
        }
      }
    });
  });

  /*
   * A database's recommendations depend on its engine AND on whether its
   * engine metrics ever arrived. Both are read off the fetched row; a slip in
   * either reads as a normal page with the wrong cards on it — PostgreSQL
   * monitors on a Redis server, or a batch of monitors over metrics a
   * span-discovered database will never send.
   */
  describe("database context", () => {
    function buildDatabaseModel(values: {
      dbSystem?: unknown;
      collectorLastSeenAt?: unknown;
    }): BaseModel {
      const model: DatabaseServer = new DatabaseServer();
      const record: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;

      record["dbSystem"] = values.dbSystem;
      record["collectorLastSeenAt"] = values.collectorLastSeenAt;

      return model;
    }

    function readDatabaseContext(values: {
      dbSystem?: unknown;
      collectorLastSeenAt?: unknown;
    }): MonitorRecommendationContext {
      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.DatabaseServer,
        model: buildDatabaseModel(values),
      });
    }

    test("selects the engine, the collector heartbeat and the project along with the id and name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.DatabaseServer,
        ),
      ).toEqual({
        _id: true,
        name: true,
        dbSystem: true,
        collectorLastSeenAt: true,
        // The engine-metrics probe (loadContext) is scoped by it.
        projectId: true,
      });
    });

    /*
     * The heartbeat is stamped by ANY batch attributed to the database, so
     * the row alone cannot say whether the monitors' own metrics arrived:
     * the database is the one resource type whose context is completed from
     * telemetry. (Behaviour: Common/Tests/App/Dashboard/
     * DatabaseRecommendationsEngineMetrics.test.ts.)
     */
    test("completes its context from telemetry, on top of what the row says", () => {
      const definition: RecommendationResourceDefinition = getDefinitionOrFail(
        MonitorRecommendationResourceType.DatabaseServer,
      );
      expect(definition.loadContext).toBeDefined();
      expect(definition.readContext).toBeDefined();
    });

    test("reads the engine and whether engine metrics were ever seen", () => {
      expect(
        readDatabaseContext({
          dbSystem: "postgresql",
          collectorLastSeenAt: new Date(),
        }),
      ).toEqual({
        databaseEngine: "postgresql",
        databaseEngineMetricsReported: true,
      });
    });

    test("accepts the heartbeat as the JSON string the API may hand back", () => {
      expect(
        readDatabaseContext({
          dbSystem: "redis",
          collectorLastSeenAt: "2026-09-01T10:00:00.000Z",
        }).databaseEngineMetricsReported,
      ).toBe(true);
    });

    test("reports a database that never had engine metrics as such", () => {
      for (const collectorLastSeenAt of [undefined, null, "", "   ", 0, {}]) {
        expect(
          readDatabaseContext({
            dbSystem: "postgresql",
            collectorLastSeenAt: collectorLastSeenAt,
          }).databaseEngineMetricsReported,
        ).toBe(false);
      }
    });

    test("reports a missing or non-string engine as null, never as a guess", () => {
      for (const dbSystem of [undefined, null, "", "  ", 42, ["postgresql"]]) {
        expect(readDatabaseContext({ dbSystem: dbSystem }).databaseEngine).toBe(
          null,
        );
      }
    });

    test("the context narrows the catalog to the engine's recommendations", () => {
      const forPostgres: Array<string> =
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DatabaseServer,
          readDatabaseContext({
            dbSystem: "postgresql",
            collectorLastSeenAt: new Date(),
          }),
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.templateId;
        });

      expect(forPostgres.length).toBeGreaterThan(0);
      for (const templateId of forPostgres) {
        expect(templateId.startsWith("database-postgresql-")).toBe(true);
      }

      // Same engine, no engine metrics yet: nothing.
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.DatabaseServer,
          readDatabaseContext({ dbSystem: "postgresql" }),
        ),
      ).toEqual([]);
    });

    test("explains each of the three states the page can be in", () => {
      const connected: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.DatabaseServer,
          context: {
            databaseEngine: "postgresql",
            databaseEngineMetricsReported: true,
          },
        });

      const notConnected: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.DatabaseServer,
          context: {
            databaseEngine: "postgresql",
            databaseEngineMetricsReported: false,
          },
        });

      const noLibrary: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.DatabaseServer,
          context: {
            databaseEngine: "cassandra",
            databaseEngineMetricsReported: true,
          },
        });

      const noEngine: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.DatabaseServer,
          context: { databaseEngine: null },
        });

      // Every state gets a note, and no two states share one.
      for (const note of [connected, notConnected, noLibrary, noEngine]) {
        expect(note).toBeTruthy();
      }
      expect(
        new Set<string | undefined>([
          connected,
          notConnected,
          noLibrary,
          noEngine,
        ]).size,
      ).toBe(4);

      // Each names the engine and what the user can do about it.
      expect(connected).toContain("PostgreSQL");
      expect(connected).toContain("oneuptime.database.server.id");
      expect(notConnected).toContain("PostgreSQL");
      expect(notConnected).toContain("Database Agent");
      expect(noLibrary).toContain("Cassandra");
      expect(noLibrary).toContain("oneuptime.database.server.id");
    });
  });

  /*
   * A storage array's recommendations depend on its platform: FlashArray
   * and FlashBlade export different metric families, and a template over the
   * other platform's series would sit on the array never firing. The
   * platform is the row's own `storageSystem`, written by ingest.
   */
  describe("storage array context", () => {
    function readStorageArrayContext(
      storageSystem: unknown,
    ): MonitorRecommendationContext {
      const model: StorageArray = new StorageArray();
      (model as unknown as Record<string, unknown>)["storageSystem"] =
        storageSystem;

      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.StorageArray,
        model: model,
      });
    }

    function templateIdsFor(
      context: MonitorRecommendationContext,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.StorageArray,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    test("selects the platform along with the name it is scoped by", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.StorageArray,
        ),
      ).toEqual({ name: true, storageSystem: true });
    });

    test("reads the platform the array reported", () => {
      expect(readStorageArrayContext("purestorage.flasharray")).toEqual({
        storageSystem: StorageSystem.PureStorageFlashArray,
      });
      expect(
        readStorageArrayContext("  purestorage.flashblade ").storageSystem,
      ).toBe(StorageSystem.PureStorageFlashBlade);
    });

    test("reports a missing or non-string platform as null, never as a guess", () => {
      for (const storageSystem of [undefined, null, "", "   ", 7, ["x"]]) {
        expect(readStorageArrayContext(storageSystem).storageSystem).toBe(null);
      }
    });

    test("the context narrows the catalog to the platform's templates", () => {
      const all: Array<StorageArrayAlertTemplate> =
        getAllStorageArrayAlertTemplates();

      for (const system of [
        StorageSystem.PureStorageFlashArray,
        StorageSystem.PureStorageFlashBlade,
      ]) {
        const offered: Array<string> = templateIdsFor(
          readStorageArrayContext(system),
        );
        const expected: Array<string> = all
          .filter((template: StorageArrayAlertTemplate) => {
            return template.storageSystems.includes(system);
          })
          .map((template: StorageArrayAlertTemplate) => {
            return template.id;
          });

        expect(offered.length).toBeGreaterThan(0);
        expect([...offered].sort()).toEqual([...expected].sort());
      }

      /*
       * Not reported yet, or a platform with no templates: nothing, as for
       * a database with no engine - every template reads one platform's
       * own series.
       */
      expect(templateIdsFor(readStorageArrayContext(null))).toEqual([]);
      expect(templateIdsFor(readStorageArrayContext("netapp.ontap"))).toEqual(
        [],
      );
    });

    test("explains the platform it narrowed to, an unknown one, and none at all", () => {
      const flashArray: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.StorageArray,
          context: { storageSystem: StorageSystem.PureStorageFlashArray },
        });
      const flashBlade: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.StorageArray,
          context: { storageSystem: StorageSystem.PureStorageFlashBlade },
        });
      const unknownPlatform: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.StorageArray,
          context: { storageSystem: "netapp.ontap" },
        });
      const notReported: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.StorageArray,
          context: { storageSystem: null },
        });

      for (const note of [
        flashArray,
        flashBlade,
        unknownPlatform,
        notReported,
      ]) {
        expect(note).toBeTruthy();
      }
      expect(
        new Set<string | undefined>([
          flashArray,
          flashBlade,
          unknownPlatform,
          notReported,
        ]).size,
      ).toBe(4);

      expect(flashArray).toContain("Pure Storage FlashArray");
      expect(flashBlade).toContain("Pure Storage FlashBlade");
      expect(unknownPlatform).toContain("netapp.ontap");
      // Both empty states say nothing is offered, and why.
      expect(notReported).toContain("none are offered");
      expect(unknownPlatform).toContain("no recommended monitors");
    });
  });

  /*
   * A Kubernetes cluster's list depends on its provider alone: an OpenShift
   * cluster is offered its operators' and its update's alerts too, and the
   * page says so. Any other cluster - one whose provider no telemetry named
   * yet included - is offered the same list as ever, with no note.
   */
  describe("Kubernetes cluster context", () => {
    const OPENSHIFT_TEMPLATE_IDS: Array<string> = [
      OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID,
      OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID,
      OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
    ];

    function readClusterContext(
      provider: unknown,
    ): MonitorRecommendationContext {
      const model: KubernetesCluster = new KubernetesCluster();
      (model as unknown as Record<string, unknown>)["provider"] = provider;

      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        model: model,
      });
    }

    function noteFor(provider: unknown): string | undefined {
      return RecommendationResourceRegistry.describeContext({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        context: readClusterContext(provider),
      });
    }

    function templateIdsFor(provider: unknown): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
        readClusterContext(provider),
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    test("selects the provider along with the identifier and the name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.Kubernetes,
        ),
      ).toEqual({ clusterIdentifier: true, name: true, provider: true });
    });

    test("reads the provider as stored, and anything but a string as none", () => {
      expect(readClusterContext(OPENSHIFT_KUBERNETES_PROVIDER)).toEqual({
        kubernetesProvider: OPENSHIFT_KUBERNETES_PROVIDER,
      });
      expect(readClusterContext("EKS").kubernetesProvider).toBe("EKS");

      for (const provider of [undefined, null, 7, ["OpenShift"]]) {
        expect(readClusterContext(provider).kubernetesProvider).toBe(null);
      }
    });

    test("an OpenShift cluster is told why its list has the OpenShift alerts", () => {
      expect(noteFor(OPENSHIFT_KUBERNETES_PROVIDER)).toBe(
        "This cluster runs OpenShift, so the recommendations below include alerts on its cluster operators and its cluster updates.",
      );

      for (const id of OPENSHIFT_TEMPLATE_IDS) {
        expect(templateIdsFor(OPENSHIFT_KUBERNETES_PROVIDER)).toContain(id);
      }
    });

    test.each([
      ["no provider reported yet", null],
      ["the column's default", "unknown"],
      ["an empty one", ""],
      ["a cloud's", "EKS"],
      ["another distribution's", "Tencent EKS"],
      ["OpenShift spelt as the catalog does not offer to", "openshift"],
    ])(
      "%s gets no note, as its list holds no OpenShift alert",
      (_label: string, provider: string | null) => {
        expect(noteFor(provider)).toBeUndefined();

        for (const id of OPENSHIFT_TEMPLATE_IDS) {
          expect(templateIdsFor(provider)).not.toContain(id);
        }
      },
    );
  });

  /*
   * Node Image Disk Almost Full is recommended only where some node of the
   * cluster keeps its container images on a disk of its own (#10056): the
   * cluster's row cannot say, so loadContext counts its nodes whose rows
   * hold an image disk reading, which ingest writes for such a node alone.
   * The page says why, when it is offered.
   */
  describe("Kubernetes cluster image disk context", () => {
    const CLUSTER_ID: string = "71000000-0000-4000-8000-0000000000aa";
    const IMAGE_DISK_NOTE: string =
      "At least one node of this cluster keeps its container images on a disk of its own, so the recommendations below include an alert on that disk.";

    function clusterOf(provider: unknown = null): KubernetesCluster {
      const model: KubernetesCluster = new KubernetesCluster();
      const fields: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;
      fields["_id"] = CLUSTER_ID;
      fields["provider"] = provider;
      return model;
    }

    async function loadedContext(
      count: number | Error,
      provider: unknown = null,
    ): Promise<MonitorRecommendationContext> {
      mockModelApiCount.mockReset();
      if (count instanceof Error) {
        mockModelApiCount.mockRejectedValue(count);
      } else {
        mockModelApiCount.mockResolvedValue(count);
      }
      return await RecommendationResourceRegistry.loadContext({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        model: clusterOf(provider),
      });
    }

    function idsOffered(context: MonitorRecommendationContext): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
        context,
      ).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      });
    }

    test("counts the cluster's nodes whose row reads an image disk of their own", async () => {
      await loadedContext(2);

      expect(mockModelApiCount).toHaveBeenCalledTimes(1);
      const request: {
        modelType: unknown;
        query: Record<string, unknown>;
      } = mockModelApiCount.mock.calls[0]![0];
      expect(request.modelType).toBe(KubernetesResource);
      expect(Object.keys(request.query).sort()).toEqual([
        "kind",
        "kubernetesClusterId",
        "latestImageFsCapacityBytes",
      ]);
      expect(String(request.query["kubernetesClusterId"])).toBe(CLUSTER_ID);
      expect(request.query["kind"]).toBe("Node");
      expect(request.query["latestImageFsCapacityBytes"]).toBeInstanceOf(
        NotNull,
      );
    });

    test("a cluster with such a node is offered the image disk alert, and told why", async () => {
      const context: MonitorRecommendationContext = await loadedContext(1);

      expect(context.kubernetesHasSeparateImageDisk).toBe(true);
      expect(idsOffered(context)).toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.Kubernetes,
          context: context,
        }),
      ).toBe(IMAGE_DISK_NOTE);
    });

    test("a cluster with none is not, and gets no note", async () => {
      const context: MonitorRecommendationContext = await loadedContext(0);

      expect(context.kubernetesHasSeparateImageDisk).toBe(false);
      expect(idsOffered(context)).not.toContain(
        KUBERNETES_IMAGE_DISK_TEMPLATE_ID,
      );
      expect(idsOffered(context)).toContain("k8s-high-disk-usage");
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.Kubernetes,
          context: context,
        }),
      ).toBeUndefined();
    });

    test("a count that fails leaves it withheld, and the rest of the context standing", async () => {
      const context: MonitorRecommendationContext = await loadedContext(
        new Error("connection reset"),
        OPENSHIFT_KUBERNETES_PROVIDER,
      );

      expect(context.kubernetesHasSeparateImageDisk).toBeUndefined();
      expect(context.kubernetesProvider).toBe(OPENSHIFT_KUBERNETES_PROVIDER);
      expect(idsOffered(context)).not.toContain(
        KUBERNETES_IMAGE_DISK_TEMPLATE_ID,
      );
    });

    test("keeps the provider it read, and an OpenShift cluster with such a node is told both", async () => {
      const context: MonitorRecommendationContext = await loadedContext(
        3,
        OPENSHIFT_KUBERNETES_PROVIDER,
      );

      expect(context).toEqual({
        kubernetesProvider: OPENSHIFT_KUBERNETES_PROVIDER,
        kubernetesHasSeparateImageDisk: true,
      });
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.Kubernetes,
          context: context,
        }),
      ).toBe(
        `This cluster runs OpenShift, so the recommendations below include alerts on its cluster operators and its cluster updates. ${IMAGE_DISK_NOTE}`,
      );
    });

    test("selects nothing more of the cluster's row: the fact is the nodes'", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.Kubernetes,
        ),
      ).toEqual({ clusterIdentifier: true, name: true, provider: true });
    });
  });

  /*
   * The page fetches the row with every context column selected, and the API
   * refuses a select naming a column the viewer may not read - the whole
   * `ModelAPI.getItem` fails, not just that column, and the Recommendations
   * page shows an error instead of cards. So anyone who can read the
   * resource's name must be able to read every context column too.
   */
  describe("OpenStack cloud context", () => {
    const CLOUD_ID: string = "71000000-0000-4000-8000-000000000001";

    function cloudOf(collectionMethod: unknown): OpenStackCloud {
      const model: OpenStackCloud = new OpenStackCloud();
      const fields: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;
      fields["_id"] = CLOUD_ID;
      fields["collectionMethod"] = collectionMethod;
      return model;
    }

    async function loadedContext(
      summary: unknown,
      collectionMethod: unknown = OpenStackCollectionMethod.Agent,
    ): Promise<MonitorRecommendationContext> {
      mockOpenStackSummary.mockReset();
      if (summary instanceof Error) {
        mockOpenStackSummary.mockRejectedValue(summary);
      } else {
        // The real read always says which services this credential is closed out of.
        mockOpenStackSummary.mockResolvedValue(
          summary
            ? { closedServices: [], ...(summary as Record<string, unknown>) }
            : summary,
        );
      }
      return await RecommendationResourceRegistry.loadContext({
        resourceType: MonitorRecommendationResourceType.OpenStack,
        model: cloudOf(collectionMethod),
      });
    }

    function idsOffered(context: MonitorRecommendationContext): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.OpenStack,
        context,
      ).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      });
    }

    test("how a cloud is collected comes from its row, which selects the column", () => {
      expect(
        getDefinitionOrFail(MonitorRecommendationResourceType.OpenStack)
          .contextFieldNames,
      ).toEqual(["collectionMethod"]);
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.OpenStack,
          model: cloudOf(OpenStackCollectionMethod.Probe),
        }).openStackIsCollectedByProbe,
      ).toBe(true);
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.OpenStack,
          model: cloudOf(OpenStackCollectionMethod.Agent),
        }).openStackIsCollectedByProbe,
      ).toBe(false);
    });

    test("a check's alerts are offered only where that check is on", async () => {
      mockOpenStackChecksOn.mockResolvedValueOnce({
        isApiCheckOn: true,
        isLifecycleCheckOn: false,
      });

      const apiOnly: MonitorRecommendationContext = await loadedContext({
        services: [],
      });

      expect(idsOffered(apiOnly)).toContain("openstack-token-issue-failing");
      expect(idsOffered(apiOnly)).not.toContain(
        "openstack-instance-boot-failing",
      );

      mockOpenStackChecksOn.mockResolvedValueOnce({
        isApiCheckOn: false,
        isLifecycleCheckOn: false,
      });

      const off: MonitorRecommendationContext = await loadedContext({
        services: [],
      });

      expect(idsOffered(off)).not.toContain("openstack-token-issue-failing");
    });

    test("what it runs comes from the server, asked about this cloud", async () => {
      const context: MonitorRecommendationContext = await loadedContext({
        services: ["orchestration"],
      });

      expect(mockOpenStackSummary).toHaveBeenCalledTimes(1);
      expect(mockOpenStackSummary.mock.calls[0]?.[0]?.toString()).toBe(
        CLOUD_ID,
      );
      expect(context.openStackServices).toEqual(["orchestration"]);
      expect(idsOffered(context)).toContain("openstack-stack-failed");
      expect(idsOffered(context)).not.toContain(
        "openstack-container-cluster-failed",
      );
    });

    test("a cloud that runs neither is offered neither, and told nothing about them", async () => {
      const context: MonitorRecommendationContext = await loadedContext({
        services: [],
      });

      expect(context.openStackServices).toEqual([]);
      const orchestration: RegExp =
        /openstack-stack-|container|orchestration|heat|magnum/;
      expect(
        idsOffered(context).filter((id: string): boolean => {
          return orchestration.test(id);
        }),
      ).toEqual([]);
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.OpenStack,
          context,
        }),
      ).toBeUndefined();
    });

    test("one that runs them is told why the list is longer, by what people call them", async () => {
      const note: string | undefined =
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.OpenStack,
          context: await loadedContext({
            services: ["orchestration", "container-infra"],
          }),
        });

      expect(note).toContain("Orchestration (Heat)");
      expect(note).toContain("Kubernetes Clusters (Magnum)");
    });

    test("only a probe's cloud is offered what only a probe sends", async () => {
      const summary: unknown = { services: ["orchestration"] };

      expect(
        idsOffered(
          await loadedContext(summary, OpenStackCollectionMethod.Probe),
        ),
      ).toContain("openstack-orchestration-engine-down");
      expect(
        idsOffered(
          await loadedContext(summary, OpenStackCollectionMethod.Agent),
        ),
      ).not.toContain("openstack-orchestration-engine-down");
    });

    test("a question that failed, or a summary that says nothing, leaves what every cloud has", async () => {
      for (const summary of [new Error("not now"), null]) {
        const context: MonitorRecommendationContext =
          await loadedContext(summary);

        expect(idsOffered(context)).toContain("openstack-compute-api-down");
        expect(idsOffered(context)).not.toContain("openstack-stack-failed");
      }
    });
  });

  describe("context columns are readable by whoever can read the name", () => {
    test.each(
      RecommendationResourceRegistry.getDefinitions().filter(
        (definition: RecommendationResourceDefinition) => {
          return Boolean(definition.contextFieldNames?.length);
        },
      ),
    )("$resourceType", (definition: RecommendationResourceDefinition) => {
      const model: BaseModel = new definition.modelType();
      const nameAccess: ColumnAccessControl | null =
        model.getColumnAccessControlFor(definition.displayNameFieldName);

      expect(nameAccess?.read.length).toBeGreaterThan(0);

      for (const contextFieldName of definition.contextFieldNames || []) {
        const readers: Array<Permission> =
          model.getColumnAccessControlFor(contextFieldName)?.read || [];

        const missing: Array<Permission> = (nameAccess?.read || []).filter(
          (permission: Permission) => {
            return !readers.includes(permission);
          },
        );

        expect(`${contextFieldName}: ${missing.join(", ")}`).toBe(
          `${contextFieldName}: `,
        );
      }
    });
  });

  /*
   * A RUM application is offered its session replay budget alerts only once
   * the budget sweep can write the series they watch: replay on and at least
   * one replay recorded for the daily pair, plus a monthly budget for the
   * monthly pair. All three facts are read off the fetched row, and a slip in
   * any of them reads as a normal page - either every RUM application's badge
   * grows by monitors that can never fire, or a recording application never
   * sees them.
   */
  describe("RUM application context", () => {
    function buildRumApplicationModel(values: {
      clientType?: unknown;
      isSessionReplayEnabled?: unknown;
      sessionReplayLastChunkReceivedAt?: unknown;
      sessionReplayMonthlyBudgetInGB?: unknown;
      sessionReplayFrustrationSignals?: unknown;
    }): BaseModel {
      const model: RumApplication = new RumApplication();
      const record: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;

      record["clientType"] = values.clientType;
      record["isSessionReplayEnabled"] = values.isSessionReplayEnabled;
      record["sessionReplayLastChunkReceivedAt"] =
        values.sessionReplayLastChunkReceivedAt;
      record["sessionReplayMonthlyBudgetInGB"] =
        values.sessionReplayMonthlyBudgetInGB;
      record["sessionReplayFrustrationSignals"] =
        values.sessionReplayFrustrationSignals;

      return model;
    }

    function readRumContext(values: {
      clientType?: unknown;
      isSessionReplayEnabled?: unknown;
      sessionReplayLastChunkReceivedAt?: unknown;
      sessionReplayMonthlyBudgetInGB?: unknown;
      sessionReplayFrustrationSignals?: unknown;
    }): MonitorRecommendationContext {
      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.RumApplication,
        model: buildRumApplicationModel(values),
      });
    }

    function describeRumContext(
      context: MonitorRecommendationContext,
    ): string | undefined {
      return RecommendationResourceRegistry.describeContext({
        resourceType: MonitorRecommendationResourceType.RumApplication,
        context: context,
      });
    }

    function offeredTemplateIds(
      context: MonitorRecommendationContext,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.RumApplication,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    const RECORDING_WITH_BUDGET: {
      isSessionReplayEnabled: boolean;
      sessionReplayLastChunkReceivedAt: Date;
      sessionReplayMonthlyBudgetInGB: number;
    } = {
      isSessionReplayEnabled: true,
      sessionReplayLastChunkReceivedAt: new Date("2026-09-29T10:00:00.000Z"),
      sessionReplayMonthlyBudgetInGB: 10,
    };

    const DAILY_ONLY_NOTE: string =
      "Of the session replay storage budget alerts, only the two for the project's shared daily limit are offered: this application has no monthly budget. Set a Monthly budget (GB) on its Replay Policy page and the monthly-budget alerts appear here too.";
    const REPLAY_OFF_NOTE: string =
      "Session replay is off for this application, so its storage budget alerts are not offered. Turn it back on under Replay Policy and they appear here.";
    const REPLAY_OFF_NEVER_RECORDED_NOTE: string =
      "Session replay is off for this application, so its storage budget alerts are not offered. Turn it on under Replay Policy and they appear here once it records its first replay.";
    const NOT_RECORDED_NOTE: string =
      "The session replay budget alerts appear here once this application records its first replay.";

    test("selects the kind, the switch, the last chunk, the monthly budget and its own signals along with the id and name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.RumApplication,
        ),
      ).toEqual({
        _id: true,
        name: true,
        clientType: true,
        isSessionReplayEnabled: true,
        sessionReplayLastChunkReceivedAt: true,
        sessionReplayMonthlyBudgetInGB: true,
        sessionReplayFrustrationSignals: true,
      });
    });

    test("reads a recording application with a budget", () => {
      expect(readRumContext(RECORDING_WITH_BUDGET)).toEqual({
        rumClientKind: null,
        sessionReplayEnabled: true,
        sessionReplayHasRecorded: true,
        sessionReplayMonthlyBudgetInGB: 10,
        customSignals: [],
      });
    });

    /*
     * Ingest writes "browser" or "mobile" (RumClientKind); nothing else is
     * read as a kind, and an application nothing has arrived from has none
     * (#9589).
     */
    test("reads the application's kind as ingest writes it", () => {
      expect(readRumContext({ clientType: "mobile" }).rumClientKind).toBe(
        "mobile",
      );
      expect(readRumContext({ clientType: "Browser" }).rumClientKind).toBe(
        "browser",
      );

      for (const clientType of [undefined, null, "", "desktop", 1, {}]) {
        expect(readRumContext({ clientType }).rumClientKind).toBeNull();
      }
    });

    test("a mobile application is offered its own monitors and no Web Vital", () => {
      const mobile: Array<string> = offeredTemplateIds(
        readRumContext({ ...RECORDING_WITH_BUDGET, clientType: "mobile" }),
      );

      expect(mobile).toEqual([
        "rum-app-crashes",
        "rum-app-not-responding",
        // The crash and ANR rates (#9716).
        "rum-app-crash-rate",
        "rum-app-anr-rate",
        /*
         * And per install a day, as Android vitals and the Play Console
         * judge them (#9924): the share of the day's installs a crash or
         * an ANR happened on, from at least 250 installs.
         */
        "rum-app-daily-crash-rate",
        "rum-app-daily-anr-rate",
        "rum-failed-user-operations",
        "rum-slow-cold-start",
        "rum-frozen-frames",
        "rum-app-stopped-reporting",
        // One alert per device that goes quiet (#9711).
        "rum-device-stopped-reporting",
        "rum-session-replay-daily-budget-nearly-spent",
        "rum-session-replay-daily-budget-spent",
        "rum-session-replay-monthly-budget-nearly-spent",
        "rum-session-replay-monthly-budget-spent",
      ]);

      for (const templateId of mobile) {
        expect(templateId).not.toMatch(
          /^rum-(poor|slow)-(lcp|inp|cls|fcp|ttfb)$/,
        );
      }
    });

    test("a browser application, or one of no known kind yet, keeps the browser monitors", () => {
      const browser: Array<string> = offeredTemplateIds(
        readRumContext({ ...RECORDING_WITH_BUDGET, clientType: "browser" }),
      );
      const unknown: Array<string> = offeredTemplateIds(
        readRumContext(RECORDING_WITH_BUDGET),
      );

      expect(browser).toEqual(unknown);
      expect(browser).toContain("rum-poor-lcp");
      expect(browser).toContain("rum-unhandled-exceptions");
      expect(browser).not.toContain("rum-app-crashes");
    });

    /*
     * #9589 beside #6518: an application's own signals are offered alerts
     * whatever its kind, and its kind still picks the shipped ones - a
     * mobile app's crash and ANR monitors, a browser app's Web Vitals.
     */
    test("a mobile and a browser application are each offered their own monitors and their signals' alerts", () => {
      const signals: { customSignals: Array<Record<string, unknown>> } = {
        customSignals: [
          {
            id: "signal-payment",
            name: "Payment failed",
            trigger: "page",
            match: "/checkout/error",
          },
        ],
      };
      const mobile: Array<string> = offeredTemplateIds(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          clientType: "mobile",
          sessionReplayFrustrationSignals: signals,
        }),
      );
      const browser: Array<string> = offeredTemplateIds(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          clientType: "browser",
          sessionReplayFrustrationSignals: signals,
        }),
      );

      expect(mobile).toContain("rum-app-crashes");
      expect(mobile).toContain("rum-custom-signal-signal-payment");
      expect(mobile).not.toContain("rum-poor-lcp");
      expect(mobile[mobile.length - 1]).toBe(
        "rum-custom-signal-signal-payment",
      );

      expect(browser).toContain("rum-poor-lcp");
      expect(browser).toContain("rum-custom-signal-signal-payment");
      expect(browser).not.toContain("rum-app-crashes");
      expect(browser[browser.length - 1]).toBe(
        "rum-custom-signal-signal-payment",
      );
    });

    /*
     * Issue #6518: each of its own signals that is switched on is offered
     * an alert of its own, by the id a rename keeps.
     */
    test("reads its own signals that are switched on, by id and name, and offers each an alert", () => {
      const context: MonitorRecommendationContext = readRumContext({
        ...RECORDING_WITH_BUDGET,
        sessionReplayFrustrationSignals: {
          customSignals: [
            {
              id: "signal-payment",
              name: "Payment failed",
              trigger: "page",
              match: "/checkout/error",
            },
            {
              id: "signal-banner",
              name: "Old banner",
              trigger: "click",
              match: ".banner",
              isEnabled: false,
            },
            // Saved before signals had ids: nothing to keep a monitor on.
            { name: "No id", trigger: "event", match: "no_id" },
          ],
        },
      });

      expect(context.customSignals).toEqual([
        { id: "signal-payment", name: "Payment failed" },
      ]);
      expect(offeredTemplateIds(context)).toContain(
        "rum-custom-signal-signal-payment",
      );
      expect(offeredTemplateIds(context)).not.toContain(
        "rum-custom-signal-signal-banner",
      );
      /* A damaged column is no signals, never a failed page. */
      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayFrustrationSignals: "not settings",
        }).customSignals,
      ).toEqual([]);
    });

    test("says when an application's signals will be offered alerts, before it records", () => {
      const signals: { customSignals: Array<Record<string, unknown>> } = {
        customSignals: [
          {
            id: "signal-payment",
            name: "Payment failed",
            trigger: "page",
            match: "/checkout/error",
          },
        ],
      };

      expect(
        describeRumContext(
          readRumContext({
            isSessionReplayEnabled: true,
            sessionReplayLastChunkReceivedAt: null,
            sessionReplayFrustrationSignals: signals,
          }),
        ),
      ).toBe(
        "Alerts on this application's own signals appear here once session replay is on for it and it records its first replay.",
      );
      expect(
        offeredTemplateIds(
          readRumContext({
            isSessionReplayEnabled: true,
            sessionReplayLastChunkReceivedAt: null,
            sessionReplayFrustrationSignals: signals,
          }),
        ),
      ).not.toContain("rum-custom-signal-signal-payment");
      /* Recording, the alert is offered and nothing needs saying. */
      expect(
        describeRumContext(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            sessionReplayFrustrationSignals: signals,
          }),
        ),
      ).toBeUndefined();
    });

    test("accepts the last chunk as the JSON string the API may hand back", () => {
      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayLastChunkReceivedAt: "2026-09-29T10:00:00.000Z",
        }).sessionReplayHasRecorded,
      ).toBe(true);
    });

    test("reports an application that never recorded as such", () => {
      for (const lastChunk of [undefined, null, "", "   ", 0, 1, {}, []]) {
        expect(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            sessionReplayLastChunkReceivedAt: lastChunk,
          }).sessionReplayHasRecorded,
        ).toBe(false);
      }
    });

    test("reads the switch as a boolean, and anything else as not known", () => {
      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          isSessionReplayEnabled: false,
        }).sessionReplayEnabled,
      ).toBe(false);

      for (const enabled of [undefined, null, "true", 1, 0]) {
        expect(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            isSessionReplayEnabled: enabled,
          }).sessionReplayEnabled,
        ).toBeNull();
      }
    });

    /*
     * "0 or blank means no application-level ceiling" is what the Replay
     * Policy form tells the user, and the gate agrees - so neither may offer
     * the monthly alerts. A numeric string is a real budget: JSON off the
     * wire is not type checked.
     */
    test("reads only a finite budget above zero as a budget", () => {
      for (const budget of [
        undefined,
        null,
        0,
        -1,
        NaN,
        Infinity,
        "",
        "   ",
        "0",
        "abc",
        "10GB",
        true,
        {},
      ]) {
        expect(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            sessionReplayMonthlyBudgetInGB: budget,
          }).sessionReplayMonthlyBudgetInGB,
        ).toBeNull();
      }

      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayMonthlyBudgetInGB: 0.5,
        }).sessionReplayMonthlyBudgetInGB,
      ).toBe(0.5);
      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayMonthlyBudgetInGB: "10",
        }).sessionReplayMonthlyBudgetInGB,
      ).toBe(10);
      expect(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayMonthlyBudgetInGB: " 2.5 ",
        }).sessionReplayMonthlyBudgetInGB,
      ).toBe(2.5);
    });

    test("the context narrows the catalog to what the sweep writes for the application", () => {
      const all: Array<string> = offeredTemplateIds(
        readRumContext(RECORDING_WITH_BUDGET),
      );
      const withoutBudget: Array<string> = offeredTemplateIds(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayMonthlyBudgetInGB: null,
        }),
      );
      const disabled: Array<string> = offeredTemplateIds(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          isSessionReplayEnabled: false,
        }),
      );
      const neverRecorded: Array<string> = offeredTemplateIds(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayLastChunkReceivedAt: null,
        }),
      );
      // A row fetched without the context columns: nothing known.
      const unselected: Array<string> = offeredTemplateIds(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.RumApplication,
          model: new RumApplication(),
        }),
      );

      expect(all).toHaveLength(11);
      expect(withoutBudget).toHaveLength(9);
      expect(withoutBudget).toContain(
        "rum-session-replay-daily-budget-nearly-spent",
      );
      expect(withoutBudget).toContain("rum-session-replay-daily-budget-spent");
      expect(withoutBudget).not.toContain(
        "rum-session-replay-monthly-budget-nearly-spent",
      );
      expect(disabled).toHaveLength(7);
      expect(neverRecorded).toHaveLength(7);
      expect(unselected).toHaveLength(7);

      for (const withheld of [disabled, neverRecorded, unselected]) {
        for (const templateId of withheld) {
          expect(templateId.startsWith("rum-session-replay-")).toBe(false);
        }
      }
    });

    test("explains a recording application with no monthly budget", () => {
      expect(
        describeRumContext(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            sessionReplayMonthlyBudgetInGB: null,
          }),
        ),
      ).toBe(DAILY_ONLY_NOTE);
    });

    test("explains an application whose replay was turned off after it recorded, or while it has a budget", () => {
      // Recorded, then turned off - budget or not.
      for (const budget of [10, null]) {
        expect(
          describeRumContext(
            readRumContext({
              ...RECORDING_WITH_BUDGET,
              isSessionReplayEnabled: false,
              sessionReplayMonthlyBudgetInGB: budget,
            }),
          ),
        ).toBe(REPLAY_OFF_NOTE);
      }

      /*
       * Never recorded, but someone set a budget: it clearly matters to them.
       * Turning replay on is not the whole answer here - the alerts are only
       * offered once the application has recorded - so the note says so.
       */
      const neverRecorded: MonitorRecommendationContext = readRumContext({
        ...RECORDING_WITH_BUDGET,
        isSessionReplayEnabled: false,
        sessionReplayLastChunkReceivedAt: null,
      });

      expect(describeRumContext(neverRecorded)).toBe(
        REPLAY_OFF_NEVER_RECORDED_NOTE,
      );
      expect(offeredTemplateIds(neverRecorded)).toHaveLength(7);

      // Switched back on, it is still withheld until the first replay.
      expect(
        offeredTemplateIds(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            isSessionReplayEnabled: true,
            sessionReplayLastChunkReceivedAt: null,
          }),
        ),
      ).toHaveLength(7);
    });

    test("explains a budget set on an application that has not recorded yet", () => {
      expect(
        describeRumContext(
          readRumContext({
            ...RECORDING_WITH_BUDGET,
            sessionReplayLastChunkReceivedAt: null,
          }),
        ),
      ).toBe(NOT_RECORDED_NOTE);
    });

    /*
     * No note where nothing needs explaining: an application offered every
     * alert, one that never used session replay (most RUM applications - it
     * would be a permanent banner about a feature they do not use), and one
     * whose facts are not known.
     */
    test("says nothing when everything is offered, when replay was never used, or when nothing is known", () => {
      const silentContexts: Array<MonitorRecommendationContext> = [
        readRumContext(RECORDING_WITH_BUDGET),
        // On by default, never recorded, no budget: never used replay.
        readRumContext({
          isSessionReplayEnabled: true,
          sessionReplayLastChunkReceivedAt: null,
          sessionReplayMonthlyBudgetInGB: null,
        }),
        // Turned off before it ever recorded, no budget.
        readRumContext({
          isSessionReplayEnabled: false,
          sessionReplayLastChunkReceivedAt: null,
          sessionReplayMonthlyBudgetInGB: null,
        }),
        // The switch unreadable: not known, whatever the rest says.
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          isSessionReplayEnabled: undefined,
        }),
        readRumContext({}),
        {},
      ];

      for (const context of silentContexts) {
        expect(describeRumContext(context)).toBeUndefined();
      }
    });

    /*
     * The note and the list render from the same context, so each note has
     * to describe what the catalog actually did with it.
     */
    test("each note matches what the catalog offers for the same context", () => {
      const dailyOnly: MonitorRecommendationContext = readRumContext({
        ...RECORDING_WITH_BUDGET,
        sessionReplayMonthlyBudgetInGB: null,
      });
      const replayOff: MonitorRecommendationContext = readRumContext({
        ...RECORDING_WITH_BUDGET,
        isSessionReplayEnabled: false,
      });
      const notRecorded: MonitorRecommendationContext = readRumContext({
        ...RECORDING_WITH_BUDGET,
        sessionReplayLastChunkReceivedAt: null,
      });

      expect(describeRumContext(dailyOnly)).toBe(DAILY_ONLY_NOTE);
      expect(offeredTemplateIds(dailyOnly)).toHaveLength(9);

      expect(describeRumContext(replayOff)).toBe(REPLAY_OFF_NOTE);
      expect(offeredTemplateIds(replayOff)).toHaveLength(7);

      expect(describeRumContext(notRecorded)).toBe(NOT_RECORDED_NOTE);
      expect(offeredTemplateIds(notRecorded)).toHaveLength(7);
    });

    test("the three notes are distinct and each names what to do", () => {
      // Read off the registry, not the constants above, so this checks code.
      const dailyOnly: string | undefined = describeRumContext(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayMonthlyBudgetInGB: null,
        }),
      );
      const replayOff: string | undefined = describeRumContext(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          isSessionReplayEnabled: false,
        }),
      );
      const notRecorded: string | undefined = describeRumContext(
        readRumContext({
          ...RECORDING_WITH_BUDGET,
          sessionReplayLastChunkReceivedAt: null,
        }),
      );

      expect(
        new Set<string | undefined>([dailyOnly, replayOff, notRecorded]),
      ).toEqual(
        new Set<string>([DAILY_ONLY_NOTE, REPLAY_OFF_NOTE, NOT_RECORDED_NOTE]),
      );
      expect(dailyOnly).toContain("Monthly budget (GB)");
      expect(dailyOnly).toContain("Replay Policy");
      expect(replayOff).toContain("Replay Policy");
      expect(notRecorded).toContain("first replay");
    });

    test("completes nothing from telemetry: the row says everything", () => {
      const definition: RecommendationResourceDefinition = getDefinitionOrFail(
        MonitorRecommendationResourceType.RumApplication,
      );

      expect(definition.readContext).toBeDefined();
      expect(definition.describeContext).toBeDefined();
      expect(definition.loadContext).toBeUndefined();
    });
  });

  /*
   * A cloud resource's recommended monitors depend on what its own row says:
   * its cloud and its type pick its templates, the attributes its metrics are
   * stored with filter each query, its readings name the stored names of its
   * Azure metrics, its inventory gives an RDS instance's allocated storage,
   * and whether a connection reads it says whether its Azure templates wait
   * for readings. Each monitor made from one is linked to the resource.
   */
  describe("cloud resource context", () => {
    const CLOUD_RESOURCE_ID: string = "6f1c4f2a-0c1e-4a43-9a3b-2c1d6c1a7b10";

    const EC2_ATTRIBUTES: Record<string, string> = {
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-0abc123def",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "eu-west-1",
    };

    function readCloudContext(
      values: Record<string, unknown>,
    ): MonitorRecommendationContext {
      const model: CloudResource = new CloudResource();

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }

      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.CloudResource,
        model: model,
      });
    }

    function describeCloud(
      context: MonitorRecommendationContext,
    ): string | undefined {
      return RecommendationResourceRegistry.describeContext({
        resourceType: MonitorRecommendationResourceType.CloudResource,
        context: context,
      });
    }

    function templateIdsFor(
      context: MonitorRecommendationContext,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudResource,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    test("selects every column its recommendations depend on, beside its name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.CloudResource,
        ),
      ).toEqual({
        _id: true,
        name: true,
        cloudProvider: true,
        cloudResourceType: true,
        telemetryAttributes: true,
        cloudReadings: true,
        cloudProperties: true,
        cloudConnectionId: true,
        // What its account's stream is read by (#10028).
        cloudAccountId: true,
        cloudRegion: true,
      });
    });

    test("reads its cloud, type, name, attributes, readings, storage and connection off the row", () => {
      expect(
        readCloudContext({
          name: "orders-db",
          cloudProvider: "aws",
          cloudResourceType: "AWS::RDS::DBInstance",
          telemetryAttributes: { ...EC2_ATTRIBUTES, count: 3 },
          cloudReadings: {
            "aws/rds/cpuutilization": {
              value: 12,
              time: "2026-11-02T12:00:00.000Z",
            },
          },
          cloudProperties: { AllocatedStorage: "200" },
          cloudConnectionId: new ObjectID(
            "70000000-0000-4000-8000-000000000001",
          ),
        }),
      ).toEqual({
        cloudProvider: "aws",
        cloudResourceType: "AWS::RDS::DBInstance",
        cloudResourceName: "orders-db",
        cloudTelemetryAttributes: EC2_ATTRIBUTES,
        cloudReadings: {
          "aws/rds/cpuutilization": {
            value: 12,
            time: "2026-11-02T12:00:00.000Z",
          },
        },
        cloudAllocatedStorageGiB: 200,
        // Its class and engine are not listed yet (RdsConnectionLimits).
        cloudConnectionLimit: {
          gap: RdsConnectionLimitGap.NotListed,
          instanceClass: null,
          engine: null,
        },
        cloudReadByConnection: true,
      });
    });
    /*
     * An RDS instance's Connections Near the Limit is a share of its own
     * connection limit, which its inventory's class, engine and parameter
     * group say (RdsConnectionLimits): offered once that is known, and its
     * page says why it is not, or what the line assumes when the instance's
     * parameter group is the team's own.
     */
    describe("an RDS instance's connection limit", () => {
      const RDS_ATTRIBUTES: Record<string, string> = {
        Namespace: "AWS/RDS",
        "Dimensions.DBInstanceIdentifier": "orders-db",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "eu-west-1",
      };

      function rds(
        properties: Record<string, unknown>,
      ): MonitorRecommendationContext {
        return readCloudContext({
          cloudProvider: "aws",
          cloudResourceType: "AWS::RDS::DBInstance",
          telemetryAttributes: RDS_ATTRIBUTES,
          cloudProperties: properties,
        });
      }

      const LISTED: Record<string, unknown> = {
        DBInstanceClass: "db.r6g.large",
        Engine: "postgres",
        EngineVersion: "16.4",
        AllocatedStorage: 200,
      };

      test("is read from the inventory's class, engine and parameter group", () => {
        expect(
          rds({ ...LISTED, DBParameterGroupName: "default.postgres16" })
            .cloudConnectionLimit,
        ).toEqual({
          limit: {
            limit: 1691,
            instanceClass: "db.r6g.large",
            engine: RdsConnectionEngine.PostgreSql,
            parameterGroup: "default.postgres16",
            isOwnParameterGroup: false,
          },
        });
        expect(
          rds({ ...LISTED, DBParameterGroupName: "prod-postgres16" })
            .cloudConnectionLimit?.limit?.isOwnParameterGroup,
        ).toBe(true);
        // Not listed yet: why, with what is known.
        expect(rds({}).cloudConnectionLimit).toEqual({
          gap: RdsConnectionLimitGap.NotListed,
          instanceClass: null,
          engine: null,
        });
      });

      test("no other resource carries one", () => {
        const ec2: MonitorRecommendationContext = readCloudContext({
          cloudProvider: "aws",
          cloudResourceType: "AWS::EC2::Instance",
          telemetryAttributes: EC2_ATTRIBUTES,
          cloudProperties: LISTED,
        });
        const azure: MonitorRecommendationContext = readCloudContext({
          cloudProvider: "azure",
          cloudResourceType: "AWS::RDS::DBInstance",
          cloudProperties: LISTED,
        });

        expect("cloudConnectionLimit" in ec2).toBe(false);
        expect("cloudConnectionLimit" in azure).toBe(false);
      });

      test("Connections Near the Limit is offered once the limit is known, with 90% of it as its line", () => {
        expect(templateIdsFor(rds(LISTED))).toEqual([
          "cloud-aws-rds-high-cpu",
          "cloud-aws-rds-low-storage",
          "cloud-aws-rds-connections-near-limit",
        ]);
        expect(templateIdsFor(rds({ AllocatedStorage: 200 }))).toEqual([
          "cloud-aws-rds-high-cpu",
          "cloud-aws-rds-low-storage",
        ]);
        expect(
          templateIdsFor(rds({ ...LISTED, Engine: "sqlserver-se" })),
        ).not.toContain("cloud-aws-rds-connections-near-limit");
        expect(
          templateIdsFor(rds({ ...LISTED, DBInstanceClass: "db.serverless" })),
        ).not.toContain("cloud-aws-rds-connections-near-limit");

        // The monitor it makes alerts at 90% of the instance's own limit.
        const recommendation: MonitorRecommendation | undefined =
          MonitorRecommendationCatalog.getRecommendations(
            MonitorRecommendationResourceType.CloudResource,
            rds(LISTED),
          ).find((candidate: MonitorRecommendation): boolean => {
            return (
              candidate.templateId === "cloud-aws-rds-connections-near-limit"
            );
          });
        const step: MonitorStep = recommendation!.getMonitorStep({
          resourceIdentifier: CLOUD_RESOURCE_ID,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "orders-db",
        });

        expect(
          Number(
            step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
              .data!.filters[0]!.value,
          ),
        ).toBe(1521);
      });

      test("says once that both wait for an instance the inventory has not listed", () => {
        expect(describeCloud(rds({}))).toBe(
          "Low Free Storage and Connections Near the Limit are offered once the account's inventory lists the instance.",
        );
      });

      test("says what waits when only its class and engine are missing, or only its storage", () => {
        expect(describeCloud(rds({ AllocatedStorage: 200 }))).toBe(
          "Connections Near the Limit is offered once the account's inventory lists the instance's class and engine.",
        );
        expect(
          describeCloud(
            rds({ DBInstanceClass: "db.r6g.large", Engine: "postgres" }),
          ),
        ).toBe(
          "Low Free Storage is offered once the account's inventory lists the instance's allocated storage.",
        );
      });

      test("says plainly a class whose limit it does not know, and an engine its class does not limit", () => {
        expect(
          describeCloud(rds({ ...LISTED, DBInstanceClass: "db.serverless" })),
        ).toBe(
          "Connections Near the Limit is not offered: OneUptime does not know the connection limit of a db.serverless instance yet. You can still alert on its connections: open DatabaseConnections on its Metrics tab and create a monitor from the view.",
        );
        expect(describeCloud(rds({ ...LISTED, Engine: "sqlserver-se" }))).toBe(
          "Connections Near the Limit is for MySQL, MariaDB, PostgreSQL and Aurora, whose connection limit follows their class. You can still alert on this instance's connections: open DatabaseConnections on its Metrics tab and create a monitor from the view.",
        );
        /*
         * The engine is never named as the inventory writes it: AWS's
         * identifiers ("oracle-se2-cdb") read as code in a sentence.
         */
        for (const engine of ["sqlserver-se", "oracle-se2-cdb", "db2-ae"]) {
          expect(
            describeCloud(rds({ ...LISTED, Engine: engine })),
          ).not.toContain(engine);
        }
      });

      test("names the limit its line assumes when the parameter group is the team's own, and says nothing on an engine's default group", () => {
        expect(
          describeCloud(
            rds({ ...LISTED, DBParameterGroupName: "prod-postgres16" }),
          ),
        ).toBe(
          "Connections Near the Limit alerts at 1,521 connections: 90% of 1,691, the default limit of a db.r6g.large instance running PostgreSQL. If its parameter group, prod-postgres16, sets max_connections, change the monitor's threshold to 90% of that.",
        );
        expect(
          describeCloud(
            rds({ ...LISTED, DBParameterGroupName: "default.postgres16" }),
          ),
        ).toBeUndefined();
        // A group it does not know of: the card's description says the rest.
        expect(describeCloud(rds(LISTED))).toBeUndefined();
      });

      test("says both, one after the other, when its storage waits and its group is its own", () => {
        expect(
          describeCloud(
            rds({
              DBInstanceClass: "db.t3.micro",
              Engine: "mysql",
              DBParameterGroupName: "orders-mysql8",
            }),
          ),
        ).toBe(
          "Low Free Storage is offered once the account's inventory lists the instance's allocated storage. Connections Near the Limit alerts at 54 connections: 90% of 60, the default limit of a db.t3.micro instance running MySQL. If its parameter group, orders-mysql8, sets max_connections, change the monitor's threshold to 90% of that.",
        );
      });

      test("joins sentences as each language writes them: no space after a full-width full stop", () => {
        expect(joinCloudRecommendationNotes([])).toBeUndefined();
        expect(joinCloudRecommendationNotes(["One."])).toBe("One.");
        expect(joinCloudRecommendationNotes(["One.", "Two."])).toBe(
          "One. Two.",
        );
        expect(joinCloudRecommendationNotes(["あります。", "ない。"])).toBe(
          "あります。ない。",
        );
        expect(joinCloudRecommendationNotes(["是？", "对。"])).toBe("是？对。");
      });
    });

    test("a row with nothing recorded yet reads as nothing known", () => {
      expect(readCloudContext({})).toEqual({
        cloudProvider: null,
        cloudResourceType: null,
        cloudResourceName: null,
        cloudTelemetryAttributes: {},
        cloudReadings: {},
        cloudAllocatedStorageGiB: null,
        cloudReadByConnection: false,
      });
    });

    /*
     * #9741: a Compute Engine VM's memory and disks, which only the Ops
     * Agent on it reports, are offered once it reports them, with a first
     * command that names the VM as gcloud does: by its name.
     */
    describe("a Compute Engine VM's memory and disk monitors", () => {
      const GCE_ATTRIBUTES: Record<string, string> = {
        "resource.gcp.resource_type": "gce_instance",
        "resource.project_id": "shop-prod",
        "resource.zone": "us-central1-a",
        "resource.instance_id": "4718294310295840123",
      };
      const AGENT_NOTE: string =
        "Memory and disk monitors are offered once the Ops Agent runs on the VM and reports them.";

      function vm(
        readings: Record<string, unknown>,
      ): MonitorRecommendationContext {
        return readCloudContext({
          name: "web-1",
          cloudProvider: "gcp",
          cloudResourceType: "gce_instance",
          telemetryAttributes: GCE_ATTRIBUTES,
          cloudReadings: readings,
          cloudConnectionId: new ObjectID(CLOUD_RESOURCE_ID),
        });
      }

      function agentReading(): { value: number; time: string } {
        return { value: 41, time: "2026-11-19T10:00:00.000Z" };
      }

      test("reads the VM's name, which its first command names it by", () => {
        expect(vm({}).cloudResourceName).toBe("web-1");
        expect(readCloudContext({ name: "  " }).cloudResourceName).toBe(null);
      });

      test("a VM without the Ops Agent is offered its CPU, and told what would offer the rest", () => {
        expect(templateIdsFor(vm({}))).toEqual(["cloud-gcp-compute-high-cpu"]);
        expect(describeCloud(vm({}))).toBe(AGENT_NOTE);
      });

      test("a VM whose agent reports them is offered them, and told nothing", () => {
        const context: MonitorRecommendationContext = vm({
          "agent.googleapis.com/memory/percent_used": agentReading(),
          "agent.googleapis.com/disk/percent_used": agentReading(),
        });

        expect(templateIdsFor(context)).toEqual([
          "cloud-gcp-compute-high-cpu",
          "cloud-gcp-compute-memory-nearly-full",
          "cloud-gcp-compute-disk-nearly-full",
          "cloud-gcp-compute-disk-full",
        ]);
        expect(describeCloud(context)).toBeUndefined();
      });

      test("a VM that reports one of them is told nothing: the agent runs", () => {
        expect(
          describeCloud(
            vm({ "agent.googleapis.com/memory/percent_used": agentReading() }),
          ),
        ).toBeUndefined();
      });

      test("the monitor it makes says the first command, for the VM by its name", () => {
        const recommendation: MonitorRecommendation | undefined =
          MonitorRecommendationCatalog.getRecommendations(
            MonitorRecommendationResourceType.CloudResource,
            vm({ "agent.googleapis.com/disk/percent_used": agentReading() }),
          ).find((candidate: MonitorRecommendation): boolean => {
            return (
              candidate.templateId === "cloud-gcp-compute-disk-nearly-full"
            );
          });
        const step: MonitorStep = recommendation!.getMonitorStep({
          resourceIdentifier: CLOUD_RESOURCE_ID,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "web-1",
        });

        expect(
          step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
            .data!.incidents[0]!.description,
        ).toContain(
          "First, run this in Google Cloud Shell: `gcloud compute ssh web-1 --zone us-central1-a --project shop-prod --command 'df -h'`",
        );
      });
    });

    test("the context offers the resource its cloud's and its type's templates", () => {
      expect(
        templateIdsFor(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::EC2::Instance",
            telemetryAttributes: EC2_ATTRIBUTES,
          }),
        ),
      ).toEqual([
        "cloud-aws-ec2-status-check-failed",
        "cloud-aws-ec2-high-cpu",
      ]);
      expect(templateIdsFor(readCloudContext({}))).toEqual([]);
    });

    test("says why a resource is offered nothing, or less than its type has", () => {
      // A type OneUptime has no recommended monitors for.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::S3::Bucket",
            telemetryAttributes: { Namespace: "AWS/S3" },
          }),
        ),
      ).toContain("no recommended monitors");

      // Its metrics have not arrived.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::EC2::Instance",
          }),
        ),
      ).toContain("metrics have not arrived");

      // A network load balancer: its namespace has no template.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
            telemetryAttributes: { Namespace: "AWS/NetworkELB" },
          }),
        ),
      ).toContain("AWS/NetworkELB");

      // Metrics in the JSON stream shape, which no template reads.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::EC2::Instance",
            telemetryAttributes: { "resource.service.name": "EC2" },
          }),
        ),
      ).toContain("JSON stream");

      // An RDS instance the inventory has not listed: storage and connections wait.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::RDS::DBInstance",
            telemetryAttributes: { Namespace: "AWS/RDS" },
          }),
        ),
      ).toContain("Low Free Storage and Connections Near the Limit");

      // An Azure resource its connection read before readings kept names.
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "azure",
            cloudResourceType: "Microsoft.Sql/servers/databases",
            telemetryAttributes: {
              "azuremonitor.resource_id": "/subscriptions/x/databases/orders",
            },
            cloudReadings: {
              storage_percent: { value: 10, time: "2026-11-02T12:00:00.000Z" },
            },
            cloudConnectionId: "70000000-0000-4000-8000-000000000001",
          }),
        ),
      ).toContain("reads its metrics again");
    });

    test("says nothing when the resource is offered all its type has", () => {
      expect(
        describeCloud(
          readCloudContext({
            cloudProvider: "aws",
            cloudResourceType: "AWS::EC2::Instance",
            telemetryAttributes: EC2_ATTRIBUTES,
          }),
        ),
      ).toBeUndefined();
    });

    test("the card names the service its numbers come from", () => {
      const card: (provider: string) => string | undefined = (
        provider: string,
      ): string | undefined => {
        return RecommendationResourceRegistry.getCardDescription({
          resourceType: MonitorRecommendationResourceType.CloudResource,
          context: { cloudProvider: provider },
        });
      };

      expect(card("aws")).toContain("Amazon CloudWatch");
      expect(card("azure")).toContain("Azure Monitor");
      expect(card("gcp")).toContain("Google Cloud Monitoring");
      // A cloud OneUptime does not read: the card's own words.
      expect(card("oracle")).toBeUndefined();
      // Every other resource type keeps the card's own words.
      expect(
        RecommendationResourceRegistry.getCardDescription({
          resourceType: MonitorRecommendationResourceType.Host,
          context: {},
        }),
      ).toBeUndefined();
    });

    test("a monitor made from one of its recommendations is linked to it", () => {
      const link: ((monitor: Monitor) => void) | undefined =
        RecommendationResourceRegistry.getMonitorLinker({
          resourceType: MonitorRecommendationResourceType.CloudResource,
          resourceId: new ObjectID(CLOUD_RESOURCE_ID),
        });

      expect(link).toBeDefined();

      const monitor: Monitor = new Monitor();
      link!(monitor);

      expect(
        (monitor.cloudResources || []).map((resource: CloudResource) => {
          return resource.id?.toString();
        }),
      ).toEqual([CLOUD_RESOURCE_ID]);
    });

    test("no other resource type links its monitors to anything", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        if (
          resourceType === MonitorRecommendationResourceType.CloudResource ||
          // An app's monitors are linked to its environment (below).
          resourceType === MonitorRecommendationResourceType.CloudApp
        ) {
          continue;
        }

        expect(
          RecommendationResourceRegistry.getMonitorLinker({
            resourceType: resourceType,
            resourceId: new ObjectID(CLOUD_RESOURCE_ID),
          }),
        ).toBeUndefined();
      }
    });

    /*
     * #10028: each recommended monitor's window follows how often its
     * connection reads it, and what its account's stream writes instead -
     * read off its connection when its tab loads.
     */
    describe("what its connection says of how its metrics come", () => {
      const CONNECTION_ID: string = "1b2c3d4e-0000-4000-8000-00000000c0de";

      function ec2Row(): CloudResource {
        const model: CloudResource = new CloudResource();
        const record: Record<string, unknown> = model as unknown as Record<
          string,
          unknown
        >;

        record["_id"] = CLOUD_RESOURCE_ID;
        record["name"] = "web-1";
        record["cloudProvider"] = "aws";
        record["cloudResourceType"] = "AWS::EC2::Instance";
        record["telemetryAttributes"] = EC2_ATTRIBUTES;
        record["cloudConnectionId"] = new ObjectID(CONNECTION_ID);
        record["cloudAccountId"] = "123456789012";
        record["cloudRegion"] = "eu-west-1";

        return model;
      }

      function loadEc2(): Promise<MonitorRecommendationContext> {
        return RecommendationResourceRegistry.loadContext({
          resourceType: MonitorRecommendationResourceType.CloudResource,
          model: ec2Row(),
        });
      }

      function windowsOf(context: MonitorRecommendationContext): Array<string> {
        return MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.CloudResource,
          context,
        ).map((recommendation: MonitorRecommendation): string => {
          return String(
            recommendation.getMonitorStep({
              resourceIdentifier: CLOUD_RESOURCE_ID,
              onlineMonitorStatusId: ObjectID.generate(),
              offlineMonitorStatusId: ObjectID.generate(),
              defaultIncidentSeverityId: ObjectID.generate(),
              defaultAlertSeverityId: ObjectID.generate(),
              monitorName: "web-1",
            }).data?.metricMonitor?.rollingTime,
          );
        });
      }

      beforeEach(() => {
        mockModelApiGetItem.mockReset();
      });

      test("its interval is read off its connection, and its monitors read the windows it gives", async () => {
        mockModelApiGetItem.mockResolvedValue({
          provider: "aws",
          config: { readIntervalInMinutes: "60" },
        });

        const context: MonitorRecommendationContext = await loadEc2();
        const read: {
          modelType: unknown;
          id: ObjectID;
          select: Record<string, boolean>;
        } = mockModelApiGetItem.mock.calls[0]![0] as {
          modelType: unknown;
          id: ObjectID;
          select: Record<string, boolean>;
        };

        expect(read.modelType).toBe(CloudConnection);
        expect(read.id.toString()).toBe(CONNECTION_ID);
        expect(read.select).toEqual({
          provider: true,
          config: true,
          streamSummary: true,
        });
        expect(context.cloudReadIntervalInMinutes).toBe(60);
        expect(context.cloudStreamedMetrics).toEqual([]);
        expect(windowsOf(context)).toEqual(["Past 2 Hours", "Past 2 Hours"]);
        expect(describeCloud(context)).toBe(
          // A page holds a figure to its word (getGlobalTranslator).
          "Its connection reads metrics every 60\u00A0minutes, so an alert can come that long after a problem, and these monitors read longer windows to miss no reading. To alert sooner, read more often in Cloud > Connect.",
        );
      });

      test("read at its cloud's default, or one it does not offer: its templates' windows, and no note", async () => {
        for (const value of ["10", undefined, "7", "abc"]) {
          mockModelApiGetItem.mockResolvedValue({
            provider: "aws",
            config: value === undefined ? {} : { readIntervalInMinutes: value },
          });

          const context: MonitorRecommendationContext = await loadEc2();

          expect(context.cloudReadIntervalInMinutes).toBe(10);
          expect(windowsOf(context)).toEqual([
            "Past 30 Minutes",
            "Past 30 Minutes",
          ]);
          expect(describeCloud(context)).toBeUndefined();
        }
      });

      test("its account's stream writes its metrics: they come within minutes, so its windows stay", async () => {
        mockModelApiGetItem.mockResolvedValue({
          provider: "aws",
          config: { readIntervalInMinutes: "60" },
          streamSummary: {
            metricSources: [
              {
                accountId: "123456789012",
                region: "eu-west-1",
                namespaces: ["AWS/EC2"],
                lastAt: new Date(Date.now() - 60 * 1000).toISOString(),
              },
            ],
            logSources: [],
          },
        });

        const context: MonitorRecommendationContext = await loadEc2();

        expect(context.cloudStreamedMetrics).toEqual([
          "aws|aws/ec2|cpuutilization",
          "aws|aws/ec2|statuscheckfailed",
        ]);
        expect(windowsOf(context)).toEqual([
          "Past 30 Minutes",
          "Past 30 Minutes",
        ]);
        expect(describeCloud(context)).toBeUndefined();
      });

      test("no connection, or one that cannot be read: the row's context, its templates' windows", async () => {
        const unread: CloudResource = ec2Row();

        (unread as unknown as Record<string, unknown>)["cloudConnectionId"] =
          undefined;

        const withoutConnection: MonitorRecommendationContext =
          await RecommendationResourceRegistry.loadContext({
            resourceType: MonitorRecommendationResourceType.CloudResource,
            model: unread,
          });

        expect(mockModelApiGetItem).not.toHaveBeenCalled();
        expect(withoutConnection.cloudReadIntervalInMinutes).toBeUndefined();

        for (const answer of [
          (): Promise<unknown> => {
            return Promise.reject(new Error("403"));
          },
          (): Promise<unknown> => {
            return Promise.resolve(null);
          },
        ]) {
          mockModelApiGetItem.mockReset();
          mockModelApiGetItem.mockImplementation(answer);

          const context: MonitorRecommendationContext = await loadEc2();

          expect(context.cloudReadIntervalInMinutes).toBeUndefined();
          expect(windowsOf(context)).toEqual([
            "Past 30 Minutes",
            "Past 30 Minutes",
          ]);
        }
      });

      test("readCloudConnectionRecommendationContext: a connection of a cloud it does not know adds nothing", () => {
        const context: MonitorRecommendationContext = {
          cloudProvider: "oracle",
          cloudResourceType: "x",
        };

        expect(
          readCloudConnectionRecommendationContext({
            context,
            record: {},
            connection: { provider: "oracle", config: {} },
            now: new Date(),
          }),
        ).toBe(context);
      });

      test("the account's sentence names it, not the resource", () => {
        expect(
          describeCloudReadIntervalCost({
            readIntervalInMinutes: 30,
            isAccount: true,
          }),
        ).toBe(
          "This account's connection reads metrics every 30\u00A0minutes, so an alert can come that long after a problem, and these monitors read longer windows to miss no reading. To alert sooner, read more often in Cloud > Connect.",
        );
      });
    });
  });

  describe("App Platforms app context", () => {
    const APP_ID: string = "0a000000-0000-4000-8000-000000000001";
    const ENVIRONMENT_ID: string = "0b000000-0000-4000-8000-000000000002";

    // What ingest stored for checkout, an ECS service of cluster production.
    const CHECKOUT_ATTRIBUTES: Record<string, string> = {
      "aws.ecs.task.family": "checkout",
      "aws.ecs.cluster.arn":
        "arn:aws:ecs:us-east-1:123456789012:cluster/production",
    };

    function appRow(values: Record<string, unknown>): CloudApp {
      const model: CloudApp = new CloudApp();

      model.id = new ObjectID(APP_ID);

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }

      return model;
    }

    function environmentRow(values: Record<string, unknown>): CloudResource {
      const model: CloudResource = new CloudResource();

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }

      return model;
    }

    function describeApp(
      context: MonitorRecommendationContext,
    ): string | undefined {
      return RecommendationResourceRegistry.describeContext({
        resourceType: MonitorRecommendationResourceType.CloudApp,
        context: context,
      });
    }

    function templateIdsFor(
      context: MonitorRecommendationContext,
    ): Array<string> {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudApp,
        context,
      ).map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      });
    }

    beforeEach(() => {
      mockModelApiGetItem.mockReset();
    });

    test("selects its name, its own attributes and its environment", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.CloudApp,
        ),
      ).toEqual({
        _id: true,
        name: true,
        telemetryAttributes: true,
        cloudResourceId: true,
      });
    });

    test("reads its own attributes, under resource., and its environment off the row", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          model: appRow({
            telemetryAttributes: { ...CHECKOUT_ATTRIBUTES, count: 3 },
            cloudResourceId: new ObjectID(ENVIRONMENT_ID),
          }),
        }),
      ).toEqual({
        cloudAppEnvironmentId: ENVIRONMENT_ID,
        cloudAppTelemetryFilters: {
          "resource.aws.ecs.cluster.arn":
            "arn:aws:ecs:us-east-1:123456789012:cluster/production",
          "resource.aws.ecs.task.family": "checkout",
        },
      });
    });

    test("read alone, an app is offered nothing: its environment's platform is not known", () => {
      const context: MonitorRecommendationContext =
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          model: appRow({
            telemetryAttributes: CHECKOUT_ATTRIBUTES,
            cloudResourceId: new ObjectID(ENVIRONMENT_ID),
          }),
        });

      expect(templateIdsFor(context)).toEqual([]);
      expect(describeApp(context)).toContain("platform is not known yet");
    });

    test("loaded, it reads its environment and is offered every app template", async () => {
      mockModelApiGetItem.mockResolvedValue(
        environmentRow({
          cloudPlatform: "aws_ecs",
          cloudAccountId: "123456789012",
          cloudRegion: "us-east-1",
        }),
      );

      const context: MonitorRecommendationContext =
        await RecommendationResourceRegistry.loadContext({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          model: appRow({
            telemetryAttributes: CHECKOUT_ATTRIBUTES,
            cloudResourceId: new ObjectID(ENVIRONMENT_ID),
          }),
        });

      expect(mockModelApiGetItem).toHaveBeenCalledTimes(1);

      const read: {
        modelType: unknown;
        id: ObjectID;
        select: Record<string, boolean>;
      } = mockModelApiGetItem.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: Record<string, boolean>;
      };

      expect(read.modelType).toBe(CloudResource);
      expect(read.id.toString()).toBe(ENVIRONMENT_ID);
      expect(read.select).toEqual({
        cloudPlatform: true,
        cloudAccountId: true,
        cloudRegion: true,
      });

      // The filter its Traces tab reads its spans by.
      expect(context.cloudAppTelemetryFilters).toEqual({
        "resource.cloud.platform": "aws_ecs",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
        "resource.aws.ecs.cluster.arn":
          "arn:aws:ecs:us-east-1:123456789012:cluster/production",
        "resource.aws.ecs.task.family": "checkout",
      });
      expect(templateIdsFor(context)).toEqual([
        "cloud-app-failed-operations",
        "cloud-app-error-burst",
        "cloud-app-traffic-stopped",
        "cloud-app-latency-p95",
        "cloud-app-latency-p99",
      ]);
      expect(describeApp(context)).toBeUndefined();
    });

    test("an environment that cannot be read, or is gone, leaves the app offered nothing", async () => {
      for (const answer of [
        (): Promise<unknown> => {
          return Promise.reject(new Error("Permission denied"));
        },
        (): Promise<unknown> => {
          return Promise.resolve(null);
        },
      ]) {
        mockModelApiGetItem.mockReset();
        mockModelApiGetItem.mockImplementation(answer);

        const context: MonitorRecommendationContext =
          await RecommendationResourceRegistry.loadContext({
            resourceType: MonitorRecommendationResourceType.CloudApp,
            model: appRow({
              telemetryAttributes: CHECKOUT_ATTRIBUTES,
              cloudResourceId: new ObjectID(ENVIRONMENT_ID),
            }),
          });

        expect(templateIdsFor(context)).toEqual([]);
        expect(describeApp(context)).toContain("platform is not known yet");
      }
    });

    test("an app with no environment on its row reads nothing more", async () => {
      const context: MonitorRecommendationContext =
        await RecommendationResourceRegistry.loadContext({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          model: appRow({ telemetryAttributes: CHECKOUT_ATTRIBUTES }),
        });

      expect(mockModelApiGetItem).not.toHaveBeenCalled();
      expect(context.cloudAppEnvironmentId).toBeNull();
      expect(templateIdsFor(context)).toEqual([]);
    });

    test("an app whose name was too long to filter by is told why, whatever its environment", async () => {
      mockModelApiGetItem.mockResolvedValue(
        environmentRow({ cloudPlatform: "aws_ecs" }),
      );

      const context: MonitorRecommendationContext =
        await RecommendationResourceRegistry.loadContext({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          model: appRow({
            telemetryAttributes: {},
            cloudResourceId: new ObjectID(ENVIRONMENT_ID),
          }),
        });

      // The environment's platform alone: every app of it.
      expect(context.cloudAppTelemetryFilters).toEqual({
        "resource.cloud.platform": "aws_ecs",
      });
      expect(templateIdsFor(context)).toEqual([]);
      expect(describeApp(context)).toContain("too long to filter");
    });

    test("the card says its monitors read what the app's OpenTelemetry reports", () => {
      expect(
        RecommendationResourceRegistry.getCardDescription({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          context: {},
        }),
      ).toContain("OpenTelemetry");
    });

    test("a monitor made for an app is linked to its environment, where its incidents list", () => {
      const link: ((monitor: Monitor) => void) | undefined =
        RecommendationResourceRegistry.getMonitorLinker({
          resourceType: MonitorRecommendationResourceType.CloudApp,
          resourceId: new ObjectID(APP_ID),
          context: { cloudAppEnvironmentId: ENVIRONMENT_ID },
        });

      expect(link).toBeDefined();

      const monitor: Monitor = new Monitor();
      link!(monitor);

      expect(
        (monitor.cloudResources || []).map((resource: CloudResource) => {
          return resource.id?.toString();
        }),
      ).toEqual([ENVIRONMENT_ID]);

      // Without an environment there is nothing to link it to.
      const unlinked: Monitor = new Monitor();

      RecommendationResourceRegistry.getMonitorLinker({
        resourceType: MonitorRecommendationResourceType.CloudApp,
        resourceId: new ObjectID(APP_ID),
      })!(unlinked);

      expect(unlinked.cloudResources).toBeUndefined();
    });
  });

  describe("serverless function context", () => {
    function functionRow(values: Record<string, unknown>): ServerlessFunction {
      const model: ServerlessFunction = new ServerlessFunction();

      model.id = new ObjectID("0c000000-0000-4000-8000-000000000001");

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }

      return model;
    }

    function contextOf(
      values: Record<string, unknown>,
    ): MonitorRecommendationContext {
      return RecommendationResourceRegistry.readContext({
        resourceType: MonitorRecommendationResourceType.ServerlessFunction,
        model: functionRow(values),
      });
    }

    test("selects its name and its faas.name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.ServerlessFunction,
        ),
      ).toEqual({ _id: true, name: true, functionIdentifier: true });
    });

    test("a function with a faas.name is offered its two, and the page says nothing more", () => {
      const context: MonitorRecommendationContext = contextOf({
        name: "Orders",
        functionIdentifier: "orders-handler",
      });

      expect(context.serverlessFunctionTelemetryFilters).toEqual({
        "resource.faas.name": "orders-handler",
      });
      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.ServerlessFunction,
          context,
        ).map((recommendation: MonitorRecommendation) => {
          return recommendation.templateId;
        }),
      ).toEqual(["serverless-failed-invocations", "serverless-error-burst"]);
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.ServerlessFunction,
          context: context,
        }),
      ).toBeUndefined();
    });

    test("a function with no faas.name yet is offered nothing, and the page says why", () => {
      const context: MonitorRecommendationContext = contextOf({
        name: "Orders",
        functionIdentifier: "",
      });

      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.ServerlessFunction,
          context,
        ),
      ).toEqual([]);
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.ServerlessFunction,
          context: context,
        }),
      ).toContain("faas.name");
    });

    test("its card says the monitors come from its invocations", () => {
      expect(
        RecommendationResourceRegistry.getCardDescription({
          resourceType: MonitorRecommendationResourceType.ServerlessFunction,
          context: {},
        }),
      ).toContain("invocations");
    });

    test("its monitors are linked to nothing beyond their filter", () => {
      expect(
        RecommendationResourceRegistry.getMonitorLinker({
          resourceType: MonitorRecommendationResourceType.ServerlessFunction,
          resourceId: ObjectID.generate(),
        }),
      ).toBeUndefined();
    });
  });

  describe("message queue context", () => {
    const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";

    // A system that has broker templates, and its queue's identifier.
    const SYSTEM: string = MESSAGE_QUEUE_METRICS[0]!.system;

    function queueRow(values: Record<string, unknown>): MessageQueue {
      const model: MessageQueue = new MessageQueue();

      model.id = new ObjectID("0e000000-0000-4000-8000-000000000002");

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }

      return model;
    }

    beforeEach(() => {
      mockQueueObservedSeries.mockReset();
    });

    test("selects its name, its identifier, its system and its project", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.MessageQueue,
        ),
      ).toEqual({
        _id: true,
        name: true,
        queueIdentifier: true,
        messagingSystem: true,
        projectId: true,
      });
    });

    test("read alone, a queue is offered nothing, and the page says why", () => {
      const context: MonitorRecommendationContext =
        RecommendationResourceRegistry.readContext({
          resourceType: MonitorRecommendationResourceType.MessageQueue,
          model: queueRow({ name: "orders", messagingSystem: SYSTEM }),
        });

      expect(
        MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.MessageQueue,
          context,
        ),
      ).toEqual([]);
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType: MonitorRecommendationResourceType.MessageQueue,
          context: context,
        }),
      ).toContain("No broker metric");
    });

    test("only the metrics a template reads are asked about", () => {
      const metrics: Array<string> = getMessageQueueRecommendableMetrics(
        SYSTEM,
      ).map((descriptor: (typeof MESSAGE_QUEUE_METRICS)[number]) => {
        return getMessageQueueMetricId(descriptor);
      });

      expect(metrics.length).toBeGreaterThan(0);
      expect(getMessageQueueRecommendableMetrics("not-a-system")).toEqual([]);
      expect(getMessageQueueRecommendableMetrics(undefined)).toEqual([]);
    });

    test("a queue with no identifier asks its telemetry nothing", async () => {
      const context: MonitorRecommendationContext =
        await loadMessageQueueRecommendationContext({
          model: queueRow({ projectId: PROJECT_ID, messagingSystem: SYSTEM }),
          context: {},
        });

      expect(mockQueueObservedSeries).not.toHaveBeenCalled();
      expect(context.messageQueueObservedSeries).toBeUndefined();
    });

    test("keeps the metrics that arrived, by catalog entry, and only those", async () => {
      const descriptors: ReturnType<
        typeof getMessageQueueRecommendableMetrics
      > = getMessageQueueRecommendableMetrics(SYSTEM);
      const reported: string = descriptors[0]!.metricName;

      mockQueueObservedSeries.mockImplementation(
        async (data: {
          descriptor: { metricName: string };
          keys: Array<string>;
          start: Date;
          end: Date;
        }): Promise<Array<Record<string, string>>> => {
          return data.descriptor.metricName === reported
            ? [{ queue: "orders" }]
            : [];
        },
      );

      const identifier: string = buildMessageQueueIdentifier({
        system: SYSTEM,
        brokerScope: "",
        destination: "orders",
      })!;
      const context: MonitorRecommendationContext =
        await loadMessageQueueRecommendationContext({
          model: queueRow({
            projectId: PROJECT_ID,
            queueIdentifier: identifier,
            messagingSystem: SYSTEM,
          }),
          context: {},
        });

      expect(identifier).toBeTruthy();
      expect(mockQueueObservedSeries).toHaveBeenCalledTimes(descriptors.length);
      const call: {
        keys: Array<string>;
        start: Date;
        end: Date;
      } = mockQueueObservedSeries.mock.calls[0]![0];
      expect(call.keys.length).toBe(1);
      expect(call.end.getTime() - call.start.getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
      expect(Object.keys(context.messageQueueObservedSeries || {})).toEqual([
        getMessageQueueMetricId(descriptors[0]!),
      ]);
    });

    test("its card says the monitors come from its broker metrics", () => {
      expect(
        RecommendationResourceRegistry.getCardDescription({
          resourceType: MonitorRecommendationResourceType.MessageQueue,
          context: {},
        }),
      ).toContain("broker metrics");
    });
  });

  /*
   * #9837: a device management connection is offered its own service's
   * templates, so its row's service is its context.
   */
  describe("device management connection context", () => {
    function connectionRow(provider: unknown): BaseModel {
      const model: DeviceManagementConnection =
        new DeviceManagementConnection();
      (model as unknown as Record<string, unknown>)["provider"] = provider;
      return model;
    }

    test("selects the connection's service and settings with its name", () => {
      expect(
        RecommendationResourceRegistry.getSelect(
          MonitorRecommendationResourceType.DeviceManagementConnection,
        ),
      ).toEqual({ _id: true, name: true, provider: true, config: true });
    });

    test("reads the service off the row, and none as none", () => {
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType:
            MonitorRecommendationResourceType.DeviceManagementConnection,
          model: connectionRow("esper"),
        }),
      ).toEqual({
        deviceManagementProvider: "esper",
        deviceManagementReadIntervalInMinutes: null,
      });
      expect(
        RecommendationResourceRegistry.readContext({
          resourceType:
            MonitorRecommendationResourceType.DeviceManagementConnection,
          model: connectionRow(undefined),
        }),
      ).toEqual({
        deviceManagementProvider: null,
        deviceManagementReadIntervalInMinutes: null,
      });
    });

    /*
     * #10006: Connection Stopped Reading waits three of the connection's
     * read intervals, so how often it is read is its context too.
     */
    test("reads how often the connection is read off its settings, an interval it does not take as the default", () => {
      const row: (config: unknown) => BaseModel = (
        config: unknown,
      ): BaseModel => {
        const model: BaseModel = connectionRow("soti");
        (model as unknown as Record<string, unknown>)["config"] = config;
        return model;
      };

      for (const [config, interval] of [
        [
          { tenant: "acme.mobicontrolcloud.com", readIntervalInMinutes: 60 },
          60,
        ],
        [{ tenant: "acme.mobicontrolcloud.com", readIntervalInMinutes: 5 }, 5],
        [{ tenant: "acme.mobicontrolcloud.com", readIntervalInMinutes: 7 }, 15],
        [{ tenant: "acme.mobicontrolcloud.com" }, 15],
      ] as Array<[Record<string, unknown>, number]>) {
        expect(
          RecommendationResourceRegistry.readContext({
            resourceType:
              MonitorRecommendationResourceType.DeviceManagementConnection,
            model: row(config),
          }),
        ).toEqual({
          deviceManagementProvider: "soti",
          deviceManagementReadIntervalInMinutes: interval,
        });
      }

      // The page's context reaches the template: an hourly connection waits 190 minutes.
      const step: MonitorStep = MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.DeviceManagementConnection,
        RecommendationResourceRegistry.readContext({
          resourceType:
            MonitorRecommendationResourceType.DeviceManagementConnection,
          model: row({
            tenant: "acme.mobicontrolcloud.com",
            readIntervalInMinutes: 60,
          }),
        }),
      )[0]!.getMonitorStep({
        resourceIdentifier: "55555555-5555-4555-8555-555555555555",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "MobiControl stores",
      });

      expect(
        Number(
          step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
            .data!.filters[0]!.value,
        ),
      ).toBe(190);
    });

    test("says nothing while its service has templates, and why the list is empty when it has none", () => {
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType:
            MonitorRecommendationResourceType.DeviceManagementConnection,
          context: { deviceManagementProvider: "esper" },
        }),
      ).toBeUndefined();
      expect(
        RecommendationResourceRegistry.describeContext({
          resourceType:
            MonitorRecommendationResourceType.DeviceManagementConnection,
          context: { deviceManagementProvider: "another-service" },
        }),
      ).toBe(
        "OneUptime has no recommended monitor for this connection's devices yet.",
      );
    });
  });
});
