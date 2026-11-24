import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  handleHelperTool,
  isHelperTool,
} from "../../../FeatureSet/MCP/Tools/HelperTools";
import { isPublicStatusPageTool } from "../../../FeatureSet/MCP/Tools/PublicStatusPageTools";
import { generateAllTools } from "../../../FeatureSet/MCP/Tools/ToolGenerator";
import { isWorkflowTool } from "../../../FeatureSet/MCP/Tools/WorkflowTools";
import { McpToolInfo } from "../../../FeatureSet/MCP/Types/McpTypes";
import ModelType from "../../../FeatureSet/MCP/Types/ModelType";
import OneUptimeOperation from "../../../FeatureSet/MCP/Types/OneUptimeOperation";
import { readPage } from "./DocsContentSupport";
import { readRepoFile } from "./InventoryAndApiDocsSupport";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Probe from "Common/Models/DatabaseModels/Probe";
import Query from "Common/Server/Types/Database/Query";
import SortValidator from "Common/Server/Types/Database/Permissions/SortValidator";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../FeatureSet/MCP/Utils/MCPLogger");

/*
 * THE DOCS SAY HOW A LIST IS SORTED, AS THE API SORTS IT (#8852).
 *
 * The API sorts a list by a field's { direction, nulls }, and through a
 * relation of one record by a field of the related record (#8141); the
 * OpenAPI spec and the MCP list tools take both (#8840). The developer
 * docs said a sort takes ASC or DESC, and the MCP server page said nothing
 * of a record list's sort. Now the API reference's "Filter, sort and page"
 * and the MCP server page's "Querying Telemetry" say both, in every docs
 * language, each beside the sort the page already showed.
 *
 * Every sort they quote is held here to what answers it: SortValidator,
 * which the API reads a sort with; the OpenAPI spec's sort schema, read by
 * Ajv as a client generated from it reads it; and the MCP tool, read as the
 * MCP SDK checks a call. Every refusal they name is the one the API gives,
 * with the status code they say.
 */

const API_REFERENCE: string = "api-reference/api-reference";
const MCP_SERVER: string = "ai/mcp-server";

// The paragraph each page added, by its line: the same line in every language.
const API_REFERENCE_SORT_LINE: number = 98;
const MCP_SERVER_SORT_LINE: number = 382;

// The sorts and values the paragraphs quote, as inline code.
const BY_DECLARED_NULLS_LAST: string =
  '{ "declaredAt": { "direction": "DESC", "nulls": "LAST" } }';
const BY_SEVERITY_ORDER: string = '{ "incidentSeverity": { "order": "ASC" } }';
const SEVERITY_DIRECTION_ONLY: string = '{ "incidentSeverity": "DESC" }';
const NULLS_LAST: string = '{ "direction": "DESC", "nulls": "LAST" }';

const API_REFERENCE_CODE: Array<string> = [
  BY_DECLARED_NULLS_LAST,
  "FIRST",
  BY_SEVERITY_ORDER,
  SEVERITY_DIRECTION_ONLY,
  "400",
  "labels",
  "422",
];

const MCP_SERVER_CODE: Array<string> = [
  "list_",
  NULLS_LAST,
  BY_SEVERITY_ORDER,
  "oneuptime_describe_resource",
  "sort",
  "sortBy",
];

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const PROJECT_ID: ObjectID = ObjectID.generate();

const VALIDATOR: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

// The list tools of the resources, each by its own model.
const LIST_TOOLS: Array<McpToolInfo> = generateAllTools().filter(
  (tool: McpToolInfo): boolean => {
    return (
      tool.operation === OneUptimeOperation.List &&
      !isHelperTool(tool.name) &&
      !isPublicStatusPageTool(tool.name) &&
      !isWorkflowTool(tool.name)
    );
  },
);

let SCHEMAS: JSONObject = {};

beforeAll(() => {
  SCHEMAS = (OpenAPIUtil.generateOpenAPISpec()["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
});

// The inline code of one line, in order.
function inlineCodeOf(line: string): Array<string> {
  return Array.from(line.matchAll(/`([^`\n]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function lineOf(language: string, page: string, line: number): string {
  return readPage(language, page).split("\n")[line - 1] as string;
}

function englishLine(page: string, line: number): string {
  return lineOf("en", page, line);
}

// A person of the project who holds exactly these permissions.
function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

// What the API says of a sort's shape: null when it takes it.
function refusalOf(
  modelType: DatabaseBaseModelType,
  sort: unknown,
): Error | null {
  try {
    SortValidator.checkSort({ modelType, sort, props: ROOT });
    return null;
  } catch (error) {
    return error as Error;
  }
}

// What the API says of who may sort by it: null when they may.
function permissionRefusalOf(
  modelType: DatabaseBaseModelType,
  sort: JSONObject,
  props: DatabaseCommonInteractionProps,
): Error | null {
  try {
    SortValidator.checkSortPermission({
      modelType,
      query: {} as Query<BaseModel>,
      sort,
      props,
    });
    return null;
  } catch (error) {
    return error as Error;
  }
}

// The schemas `value` refers to, and those they refer to.
function referredFrom(value: JSONValue, found: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const member of value) {
      referredFrom(member as JSONValue, found);
    }
  } else if (value && typeof value === "object") {
    for (const [key, member] of Object.entries(value as JSONObject)) {
      if (key === "$ref" && typeof member === "string") {
        const name: string = member.replace("#/components/schemas/", "");

        if (!found.has(name)) {
          found.add(name);
          referredFrom(SCHEMAS[name] as JSONValue, found);
        }
      } else {
        referredFrom(member as JSONValue, found);
      }
    }
  }

  return found;
}

// Whether the spec's sort schema of a model allows a sort, as Ajv reads it.
function specAllows(modelType: DatabaseBaseModelType, sort: unknown): boolean {
  const root: JSONObject = {
    $ref: `#/components/schemas/${new modelType().tableName}SortSchema`,
  };
  const components: JSONObject = {};

  for (const name of referredFrom(root, new Set())) {
    components[name] = SCHEMAS[name] as JSONValue;
  }

  return VALIDATOR.getValidator({
    ...root,
    components: { schemas: components },
  } as never)(sort).valid;
}

function toolNamed(name: string): McpToolInfo {
  return LIST_TOOLS.find((tool: McpToolInfo): boolean => {
    return tool.name === name;
  }) as McpToolInfo;
}

// Whether a list tool takes a sort, as the MCP SDK checks a call.
function toolTakes(tool: McpToolInfo, sort: unknown): boolean {
  return VALIDATOR.getValidator(tool.inputSchema as never)({ sort }).valid;
}

describe("the API reference says how a sort orders a list", () => {
  test("in every language, beside the sort it shows, with the same sorts quoted", () => {
    expect(LANGUAGES.length).toBe(17);

    for (const language of LANGUAGES) {
      // The line before is the one that says a sort takes ASC or DESC.
      expect([
        language,
        inlineCodeOf(
          lineOf(language, API_REFERENCE, API_REFERENCE_SORT_LINE - 2),
        ),
      ]).toEqual([language, expect.arrayContaining(["sort", "ASC", "DESC"])]);
      expect([
        language,
        inlineCodeOf(lineOf(language, API_REFERENCE, API_REFERENCE_SORT_LINE)),
      ]).toEqual([language, API_REFERENCE_CODE]);
    }

    expect(englishLine(API_REFERENCE, API_REFERENCE_SORT_LINE)).toBe(
      'A field\'s order can also say where the records with no value in it go: `{ "declaredAt": { "direction": "DESC", "nulls": "LAST" } }` puts the latest first and those with none last, and `FIRST` puts them first. A relation of one record sorts by a field of the record it names: `{ "incidentSeverity": { "order": "ASC" } }` lists incidents in the order of their severities. A relation given only a direction, as in `{ "incidentSeverity": "DESC" }`, is refused with a `400` that names a field to sort by instead, and so is a relation of many records, such as an incident\'s `labels`: each incident has a list of them, and a list has no one value to put incidents in order by. Sorting by a field needs permission to read it too, through a relation as on the resource itself: a sort by a field you may not read is refused with a `422`.',
    );
  });

  test("a field's { direction, nulls }, LAST and FIRST, is a sort the API, the spec and the incident list tool take", () => {
    const declaredNullsLast: JSONObject = JSON.parse(
      BY_DECLARED_NULLS_LAST,
    ) as JSONObject;
    const declaredNullsFirst: JSONObject = {
      declaredAt: { direction: "DESC", nulls: "FIRST" },
    };

    expect(getTableColumns(new Incident())["declaredAt"]?.type).toBe(
      TableColumnType.Date,
    );

    for (const sort of [declaredNullsLast, declaredNullsFirst]) {
      expect([sort, refusalOf(Incident, sort)]).toEqual([sort, null]);
      expect([sort, specAllows(Incident, sort)]).toEqual([sort, true]);
      expect([sort, toolTakes(toolNamed("list_incidents"), sort)]).toEqual([
        sort,
        true,
      ]);
    }
  });

  test("a relation of one record sorts by a field of its record: incidents by their severity's place in the list", () => {
    const sort: JSONObject = JSON.parse(BY_SEVERITY_ORDER) as JSONObject;

    expect(refusalOf(Incident, sort)).toBeNull();
    expect(specAllows(Incident, sort)).toBe(true);
    expect(toolTakes(toolNamed("list_incidents"), sort)).toBe(true);

    // The incident's severity is one record, and its order its place in the list.
    expect(getTableColumns(new Incident())["incidentSeverity"]?.type).toBe(
      TableColumnType.Entity,
    );
    expect(new IncidentSeverity().getListOrder()?.column).toBe("order");
  });

  test("a relation given only a direction is refused with a 400 that names a field to sort by instead", () => {
    const sort: JSONObject = JSON.parse(SEVERITY_DIRECTION_ONLY) as JSONObject;
    const refusal: Error | null = refusalOf(Incident, sort);

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as BadDataException).code).toBe(
      ExceptionCode.BadDataException,
    );
    expect(String(ExceptionCode.BadDataException)).toBe("400");
    expect(specAllows(Incident, sort)).toBe(false);

    // The field it names is one the API and the spec take.
    const named: RegExpMatchArray = (refusal as Error).message.match(
      /Send (\{.+?\}) to sort by/,
    ) as RegExpMatchArray;
    const instead: JSONObject = JSON.parse(named[1] as string) as JSONObject;

    expect(Object.keys(instead)).toEqual(["incidentSeverity"]);
    expect(refusalOf(Incident, instead)).toBeNull();
    expect(specAllows(Incident, instead)).toBe(true);
  });

  test("a relation of many records, an incident's labels, is refused with a 400: a list has no one value to sort by", () => {
    expect(getTableColumns(new Incident())["labels"]?.type).toBe(
      TableColumnType.EntityArray,
    );

    for (const sort of [{ labels: { name: "ASC" } }, { labels: "ASC" }]) {
      const refusal: Error | null = refusalOf(Incident, sort);

      expect([sort, refusal]).toEqual([sort, expect.any(BadDataException)]);
      expect((refusal as Error).message).toContain(
        "a list of records cannot order a list, as it has no one value to sort by",
      );
      expect([sort, specAllows(Incident, sort)]).toEqual([sort, false]);
    }
  });

  test("a sort by a field you may not read is refused with a 422, on the resource and through a relation", () => {
    expect(String(ExceptionCode.NotAuthorizedException)).toBe("422");

    // Every list read is held to it, as it is to its select (#8839).
    expect(
      readRepoFile(
        "Common/Server/Types/Database/Permissions/BasePermission.ts",
      ),
    ).toContain("SortValidator.checkSortPermission({");

    // A probe's key, which a member may list probes without reading.
    const member: DatabaseCommonInteractionProps = personWith([
      Permission.ProjectMember,
    ]);
    const onTheResource: Error | null = permissionRefusalOf(
      Probe,
      { key: "ASC" },
      member,
    );

    expect(onTheResource).toBeInstanceOf(NotAuthorizedException);
    expect((onTheResource as NotAuthorizedException).code).toBe(
      ExceptionCode.NotAuthorizedException,
    );

    /*
     * Through a relation: a field of an incident's related record that no
     * relation read may name, refused to someone who may read the relation
     * and nothing of the related record.
     */
    const incident: BaseModel = new Incident();
    const columns: Record<string, TableColumnMetadata> =
      getTableColumns(incident);
    let refusedThroughRelation: number = 0;

    for (const [relation, column] of Object.entries(columns)) {
      if (column.type !== TableColumnType.Entity || !column.modelType) {
        continue;
      }

      const reader: DatabaseCommonInteractionProps = personWith(
        incident.getColumnAccessControlFor(relation)?.read || [],
      );

      for (const [field, related] of Object.entries(
        getTableColumns(new (column.modelType as DatabaseBaseModelType)()),
      )) {
        if (
          related.canReadOnRelationQuery ||
          related.type === TableColumnType.Entity ||
          related.type === TableColumnType.EntityArray
        ) {
          continue;
        }

        if (
          permissionRefusalOf(
            Incident,
            { [relation]: { [field]: "ASC" } },
            reader,
          ) instanceof NotAuthorizedException
        ) {
          refusedThroughRelation++;
        }
      }
    }

    expect(refusedThroughRelation).toBeGreaterThan(0);
  });
});

describe("the MCP server page says how a record list tool sorts", () => {
  test("in every language, after the telemetry list's sort, with the same sorts quoted", () => {
    for (const language of LANGUAGES) {
      expect([
        language,
        inlineCodeOf(lineOf(language, MCP_SERVER, MCP_SERVER_SORT_LINE - 2)),
      ]).toEqual([
        language,
        expect.arrayContaining(["oneuptime_describe_resource"]),
      ]);
      expect([
        language,
        inlineCodeOf(lineOf(language, MCP_SERVER, MCP_SERVER_SORT_LINE)),
      ]).toEqual([language, MCP_SERVER_CODE]);
    }

    expect(englishLine(MCP_SERVER, MCP_SERVER_SORT_LINE)).toBe(
      'The other `list_` tools, of incidents, monitors and every other kind of record, sort the way the API does: a field takes a direction, or `{ "direction": "DESC", "nulls": "LAST" }` to put the records with no value in it last, and a relation of one record sorts by a field of the record it names, as in `{ "incidentSeverity": { "order": "ASC" } }`. `oneuptime_describe_resource` marks each such relation `sort`, and names the fields it sorts by under `sortBy`.',
    );
  });

  test("every record list tool takes a direction, { direction, nulls } and a relation's field, and the API takes them", () => {
    const records: Array<McpToolInfo> = LIST_TOOLS.filter(
      (tool: McpToolInfo): boolean => {
        return tool.modelType === ModelType.Database;
      },
    );
    const nullsLast: JSONObject = JSON.parse(NULLS_LAST) as JSONObject;

    expect(records.length).toBeGreaterThan(50);

    for (const tool of records) {
      expect([tool.name, toolTakes(tool, { createdAt: "DESC" })]).toEqual([
        tool.name,
        true,
      ]);
      expect([tool.name, toolTakes(tool, { createdAt: nullsLast })]).toEqual([
        tool.name,
        true,
      ]);
      expect([
        tool.name,
        toolTakes(tool, { anyRelation: { anyField: "ASC" } }),
      ]).toEqual([tool.name, true]);
    }

    expect(refusalOf(Incident, { declaredAt: nullsLast })).toBeNull();
    expect(
      toolTakes(toolNamed("list_incidents"), JSON.parse(BY_SEVERITY_ORDER)),
    ).toBe(true);
  });

  test("a telemetry list tool still takes ASC or DESC alone, as the telemetry section says", () => {
    const telemetry: Array<McpToolInfo> = LIST_TOOLS.filter(
      (tool: McpToolInfo): boolean => {
        return tool.modelType === ModelType.Analytics;
      },
    );

    expect(telemetry.length).toBeGreaterThan(5);
    expect(englishLine(MCP_SERVER, MCP_SERVER_SORT_LINE - 4)).toContain(
      'Sort values are `"ASC"` or `"DESC"`.',
    );

    for (const tool of telemetry) {
      expect([tool.name, toolTakes(tool, { time: "DESC" })]).toEqual([
        tool.name,
        true,
      ]);
      expect([
        tool.name,
        toolTakes(tool, { time: JSON.parse(NULLS_LAST) }),
      ]).toEqual([tool.name, false]);
    }
  });

  test("oneuptime_describe_resource marks a relation that sorts, and names the fields it sorts by under sortBy", () => {
    const described: {
      fields: Record<string, { sort?: boolean; sortBy?: Array<string> }>;
    } = JSON.parse(
      handleHelperTool(
        "oneuptime_describe_resource",
        { resource: "Incident" },
        LIST_TOOLS,
      ),
    ) as {
      fields: Record<string, { sort?: boolean; sortBy?: Array<string> }>;
    };

    expect(described.fields["incidentSeverity"]).toMatchObject({
      sort: true,
      sortBy: expect.arrayContaining(["order"]),
    });
    // A relation of many records sorts nothing.
    expect(described.fields["labels"]?.sort).toBeUndefined();
  });
});
