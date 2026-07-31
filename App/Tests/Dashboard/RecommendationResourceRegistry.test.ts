import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

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
  [MonitorRecommendationResourceType.Ceph]: "name",
  [MonitorRecommendationResourceType.IoTDevice]: "name",
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

        expect(model.hasColumn(definition.identifierFieldName)).toBe(true);
        expect(model.hasColumn(definition.displayNameFieldName)).toBe(true);

        /*
         * These models declare their columns as optional public properties
         * initialised to `undefined`, so the property is a real own property of
         * a fresh instance. `readResourceFields` indexes the instance directly,
         * so this is the exact lookup it performs.
         */
        expect(definition.identifierFieldName in model).toBe(true);
        expect(definition.displayNameFieldName in model).toBe(true);
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

    test("every resource type names its monitors from the name column", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        expect(getDefinitionOrFail(resourceType).displayNameFieldName).toBe(
          "name",
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

    test("selects nothing beyond the two declared fields", () => {
      for (const resourceType of ALL_RESOURCE_TYPES) {
        const definition: RecommendationResourceDefinition =
          getDefinitionOrFail(resourceType);

        const allowed: Set<string> = new Set<string>([
          definition.identifierFieldName,
          definition.displayNameFieldName,
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
        expect(
          MonitorRecommendationCatalog.getRecommendations(
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
});
