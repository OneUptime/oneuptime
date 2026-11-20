import { beforeAll, describe, expect, test } from "@jest/globals";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import {
  CrossplaneReference,
  getCrossplaneConnectionSecretKeys,
  getCrossplaneKindOf,
  getCrossplaneReferences,
  getProviderAttributeName,
  isCrossplaneSecretField,
} from "../../../Utils/DeveloperDocs/CrossplaneSchema";
import { getCrossplaneKind } from "../../../Utils/DeveloperDocs/CrossplaneNames";
import {
  getTerraformAttributes,
  getTerraformDeleteChoiceAttributes,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  TerraformDeleteChoiceAttribute,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { StringUtils } from "../../../../../Scripts/TerraformProvider/Core/StringUtils";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import {
  collectReferences,
  ReferenceMap,
} from "../../../../../Scripts/CrossplaneProvider/Core/References";
import {
  collectServerOwned,
  ServerOwnedMap,
} from "../../../../../Scripts/CrossplaneProvider/Core/ServerOwned";

/*
 * The dashboard writes manifests of the Crossplane provider (Developer >
 * Crossplane, #6615) from what it works out in the browser about each kind
 * (Common/Utils/DeveloperDocs/CrossplaneSchema.ts). This holds that to the
 * generators themselves: the real OpenAPI spec, read by the Terraform
 * provider's parser, and the Crossplane generator's own collectReferences
 * and collectServerOwned, which write the provider's configuration
 * (config/zz_references.go, zz_server_owned.go). For every resource:
 *
 *   - its kind, one per resource;
 *   - the fields that take a reference, and the resource each refers to;
 *   - the secrets a manifest gives from a Secret (the provider's sensitive
 *     arguments), and the ones OneUptime makes, which the provider writes
 *     to the connection Secret (its sensitive read-only attributes);
 *   - a value a record starts with (after-create), which a manifest gives
 *     under spec.initProvider, and none of what only OneUptime writes.
 *
 * A change to the models, ModelSchema, the parser or the Crossplane
 * generator that would make the page's manifests wrong fails here first.
 */

let resources: Map<string, TerraformResource>;
let references: ReferenceMap;
let serverOwned: ServerOwnedMap;

beforeAll(() => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(OpenAPIUtil.generateOpenAPISpec() as JSONObject as never);

  const all: Array<TerraformResource> = parser.getResources();

  resources = new Map<string, TerraformResource>();

  for (const resource of all) {
    resources.set(`oneuptime_${resource.name}`, resource);
  }

  references = collectReferences(all);
  serverOwned = collectServerOwned(all);
});

function modelsWithKinds(): Array<[string, DatabaseBaseModelType]> {
  return (Models as Array<DatabaseBaseModelType>)
    .filter((modelType: DatabaseBaseModelType): boolean => {
      return Boolean(getCrossplaneKindOf(modelType));
    })
    .map(
      (modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
        return [modelType.name, modelType];
      },
    );
}

function resourceOf(modelType: DatabaseBaseModelType): TerraformResource {
  const resource: TerraformResource | undefined = resources.get(
    getTerraformTypeName(modelType) as string,
  );

  if (!resource) {
    throw new Error(`The provider has no ${getTerraformTypeName(modelType)}`);
  }

  return resource;
}

describe("the dashboard's view of each kind is the Crossplane provider's", () => {
  test("every resource has a kind of its own", () => {
    const kinds: Array<string> = Array.from(resources.keys()).map(
      (typeName: string): string => {
        return getCrossplaneKind(typeName);
      },
    );

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(modelsWithKinds().length).toBe(resources.size);
  });

  test.each(modelsWithKinds())(
    "%s: references, secrets and what OneUptime keeps",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const typeName: string = getTerraformTypeName(modelType) as string;
      const resource: TerraformResource = resourceOf(modelType);
      const schema: Record<string, TerraformAttribute> = resource.schema;

      /*
       * The fields with a reference, and what each refers to. What a delete
       * takes (workflows_run_as_custom_role_id_on_delete, DeleteChoices.ts)
       * takes one too, but a manifest of a record never sets it: its state
       * says nothing of its delete.
       */
      const deleteChoices: Array<string> = getTerraformDeleteChoiceAttributes(
        modelType,
      ).map((choice: TerraformDeleteChoiceAttribute): string => {
        return choice.attributeName;
      });
      const generated: Record<string, string> = Object.fromEntries(
        Object.entries(references[typeName] || {}).filter(
          ([field]: [string, string]): boolean => {
            return !deleteChoices.includes(field);
          },
        ),
      );

      expect(
        Object.fromEntries(
          getCrossplaneReferences(modelType).map(
            (reference: CrossplaneReference): [string, string] => {
              return [
                reference.descriptor.attributeName,
                getTerraformTypeName(reference.targetModelType) as string,
              ];
            },
          ),
        ),
      ).toEqual(generated);

      // A secret a manifest gives is the provider's sensitive argument.
      const descriptors: Array<TerraformAttributeDescriptor> =
        getTerraformAttributes(modelType);

      expect(
        descriptors
          .filter((descriptor: TerraformAttributeDescriptor): boolean => {
            return isCrossplaneSecretField(modelType, descriptor);
          })
          .map((descriptor: TerraformAttributeDescriptor): string => {
            return descriptor.attributeName;
          })
          .sort(),
      ).toEqual(
        Object.keys(schema)
          .filter((name: string): boolean => {
            const attribute: TerraformAttribute = schema[name]!;
            return Boolean(
              attribute.sensitive && (attribute.required || attribute.optional),
            );
          })
          .sort(),
      );

      // What OneUptime makes: a sensitive attribute no manifest sets.
      expect(getCrossplaneConnectionSecretKeys(modelType).sort()).toEqual(
        Object.keys(schema)
          .filter((name: string): boolean => {
            const attribute: TerraformAttribute = schema[name]!;
            return Boolean(
              attribute.sensitive &&
                !attribute.required &&
                !attribute.optional &&
                name !== "id",
            );
          })
          .map((name: string): string => {
            return `attribute.${StringUtils.toTerraformAttributeName(name)}`;
          })
          .sort(),
      );

      // A value a record starts with, and nothing only OneUptime writes.
      const owned: Record<string, string> = serverOwned[typeName] || {};

      expect(
        descriptors
          .filter((descriptor: TerraformAttributeDescriptor): boolean => {
            return descriptor.startsAtCreate;
          })
          .map((descriptor: TerraformAttributeDescriptor): string => {
            return getProviderAttributeName(descriptor.attributeName);
          })
          .sort(),
      ).toEqual(
        Object.keys(owned)
          .filter((field: string): boolean => {
            return owned[field] === "after-create";
          })
          .sort(),
      );

      for (const field of Object.keys(owned)) {
        if (owned[field] !== "always") {
          continue;
        }

        expect({
          field,
          descriptor: descriptors.some(
            (descriptor: TerraformAttributeDescriptor): boolean => {
              return (
                getProviderAttributeName(descriptor.attributeName) === field
              );
            },
          ),
        }).toEqual({ field, descriptor: false });
      }
    },
  );

  test("the sweep checks the kinds people manage, and the ones with secrets", () => {
    const checked: Array<string> = modelsWithKinds().map(
      ([name]: [string, DatabaseBaseModelType]): string => {
        return name;
      },
    );

    expect(checked).toEqual(
      expect.arrayContaining([
        "Monitor",
        "Incident",
        "StatusPage",
        "OnCallDutyPolicy",
        "Team",
        "TelemetryIngestionKey",
        "ApiKey",
      ]),
    );
    expect(checked.length).toBeGreaterThan(300);
  });
});
