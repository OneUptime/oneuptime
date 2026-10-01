import { beforeAll, describe, expect, test } from "@jest/globals";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import {
  getTerraformAttributes,
  getTerraformModelOperations,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * The dashboard writes Terraform configuration for real resources
 * (Developer > Terraform). It works out each resource's attributes in the
 * browser (Common/Utils/DeveloperDocs/TerraformSchema.ts), from the same model
 * metadata the provider is generated from. This holds that to the provider
 * itself: the real OpenAPI spec, read by the real generator's parser
 * (Scripts/TerraformProvider/Core/OpenAPIParser.ts), for every model.
 *
 * For every resource the provider has: the same name, the same attributes,
 * and for each attribute the same type, the same "required", the same
 * default (the provider plans a default whenever an attribute is left out,
 * so the dashboard needs it to know what it may leave out), and the same
 * "changing it replaces the resource". A change to the models, ModelSchema or
 * the generator that would make the dashboard's configuration wrong fails
 * here first.
 */

/*
 * Two models that share a singular name share a provider resource: the
 * generator groups operations by name, so one model's endpoints win. Those
 * are left out (and no Developer page documents them).
 */
const SHARED_NAME_TYPES: ReadonlyArray<string> = [
  "oneuptime_subscriber_notification_template",
];

const PROVIDER_TYPES_BY_KIND: Readonly<Record<TerraformValueKind, Array<string>>> =
  {
    [TerraformValueKind.String]: ["string"],
    [TerraformValueKind.DateTime]: ["string"],
    [TerraformValueKind.Json]: ["string"],
    [TerraformValueKind.Number]: ["number"],
    [TerraformValueKind.Bool]: ["bool"],
    [TerraformValueKind.IdSet]: ["set", "list"],
    [TerraformValueKind.StringSet]: ["set", "list"],
    [TerraformValueKind.MonitorSteps]: ["monitor_steps"],
    [TerraformValueKind.Unsupported]: ["string"],
  };

/*
 * Column types whose API value is a wrapper object ({_type: "Color", value:
 * "#ff0000"}). The provider keeps them as JSON strings it unwraps on read, and
 * configuration gives them as their plain value (`color = "#ff0000"`), which
 * is why the dashboard treats them as strings.
 */
const WRAPPER_COLUMN_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.Color,
  TableColumnType.Email,
  TableColumnType.Phone,
  TableColumnType.Name,
  TableColumnType.Domain,
  TableColumnType.IP,
  TableColumnType.Port,
  TableColumnType.Version,
];

interface ProviderAttribute {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  isComplexObject: boolean;
  isDateTime: boolean;
  forceNew: boolean;
}

interface MirroredAttribute {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  isComplexObject: boolean;
  isDateTime: boolean;
  forceNew: boolean;
}

let providerResources: Map<string, TerraformResource>;

beforeAll(() => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(OpenAPIUtil.generateOpenAPISpec() as JSONObject as never);

  providerResources = new Map<string, TerraformResource>();

  for (const resource of parser.getResources()) {
    providerResources.set(`oneuptime_${resource.name}`, resource);
  }
});

function modelsWithResources(): Array<[string, DatabaseBaseModelType]> {
  return Models.filter((modelType: DatabaseBaseModelType): boolean => {
    const typeName: string | null = getTerraformTypeName(modelType);

    return (
      Boolean(typeName) &&
      !SHARED_NAME_TYPES.includes(typeName as string) &&
      getTerraformAttributes(modelType).length > 0
    );
  }).map((modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
    return [modelType.name, modelType];
  });
}

function providerAttributes(resource: TerraformResource): Array<ProviderAttribute> {
  return Object.entries(resource.schema)
    .filter(([name, attribute]: [string, TerraformAttribute]): boolean => {
      return name !== "id" && Boolean(attribute.required || attribute.optional);
    })
    .map(([name, attribute]: [string, TerraformAttribute]): ProviderAttribute => {
      return {
        name,
        type: attribute.type,
        required: Boolean(attribute.required),
        default: attribute.default ?? null,
        isComplexObject: Boolean(attribute.isComplexObject),
        isDateTime: Boolean(attribute.isDateTime),
        forceNew: Boolean(attribute.forceNew),
      };
    })
    .sort((a: ProviderAttribute, b: ProviderAttribute): number => {
      return a.name.localeCompare(b.name);
    });
}

function mirroredAttributes(
  modelType: DatabaseBaseModelType,
  provider: Array<ProviderAttribute>,
): Array<MirroredAttribute> {
  const hasUpdate: boolean = getTerraformModelOperations(modelType).canUpdate;

  return getTerraformAttributes(modelType)
    .map((descriptor: TerraformAttributeDescriptor): MirroredAttribute => {
      const providerType: string | undefined = provider.find(
        (attribute: ProviderAttribute): boolean => {
          return attribute.name === descriptor.attributeName;
        },
      )?.type;
      const allowed: Array<string> = PROVIDER_TYPES_BY_KIND[descriptor.kind];

      return {
        name: descriptor.attributeName,
        // A set or a list (ordered columns are lists) are written the same way.
        type:
          providerType && allowed.includes(providerType)
            ? providerType
            : (allowed[0] as string),
        required: descriptor.isRequired,
        default: descriptor.defaultValue ?? null,
        isComplexObject:
          descriptor.kind === TerraformValueKind.Json ||
          WRAPPER_COLUMN_TYPES.includes(descriptor.columnType),
        isDateTime: descriptor.kind === TerraformValueKind.DateTime,
        forceNew:
          descriptor.inCreateSchema && !descriptor.inUpdateSchema && hasUpdate,
      };
    })
    .sort((a: MirroredAttribute, b: MirroredAttribute): number => {
      return a.name.localeCompare(b.name);
    });
}

describe("the dashboard's view of each Terraform resource is the provider's", () => {
  test.each(modelsWithResources())(
    "%s",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const typeName: string = getTerraformTypeName(modelType) as string;
      const resource: TerraformResource | undefined =
        providerResources.get(typeName);

      expect({ typeName, inProvider: Boolean(resource) }).toEqual({
        typeName,
        inProvider: true,
      });

      const provider: Array<ProviderAttribute> = providerAttributes(
        resource as TerraformResource,
      );

      expect(mirroredAttributes(modelType, provider)).toEqual(provider);
    },
  );
});

describe("the provider has no resource the dashboard does not know", () => {
  test("every provider resource comes from a model the mirror recognises", () => {
    const mirrored: Set<string> = new Set<string>(
      Models.map((modelType: DatabaseBaseModelType): string | null => {
        return getTerraformAttributes(modelType).length > 0
          ? getTerraformTypeName(modelType)
          : null;
      }).filter((typeName: string | null): typeName is string => {
        return typeName !== null;
      }),
    );

    expect(
      [...providerResources.keys()].filter((typeName: string): boolean => {
        return !mirrored.has(typeName);
      }),
    ).toEqual([]);
  });

  test("the sweep checks the resources people manage", () => {
    const checked: Array<string> = modelsWithResources().map(
      ([name]: [string, DatabaseBaseModelType]): string => {
        return name;
      },
    );

    expect(checked).toEqual(
      expect.arrayContaining([
        "Workflow",
        "Monitor",
        "StatusPage",
        "Incident",
        "Alert",
        "ScheduledMaintenance",
        "OnCallDutyPolicy",
        "Team",
      ]),
    );
    expect(checked.length).toBeGreaterThan(300);
  });
});
