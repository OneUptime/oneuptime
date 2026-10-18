import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnerTableRegistry from "Common/Server/Types/Database/Permissions/OwnerTableRegistry";
import { generateToolsForDatabaseModel } from "../Tools/ToolGenerator";
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";

/*
 * MCP ADDS AND REMOVES NO OWNERS OF ITS OWN.
 *
 * Who owns a resource decides what a member whose permissions are scoped to
 * Owned may manage, so adding and removing owners is held to the scope of
 * the permission that does it: on the resources the member or their team
 * own (OwnedScopePermission.getOwnedThrough). The API routes of the owner
 * tables, which the dashboard's Owners tab and create forms call, ask it.
 *
 * MCP's tools call those same routes with the person's own credential. This
 * holds that MCP offers no tool of its own that adds or removes an owner -
 * no owner table is exposed as one - and that a resource's create tool
 * takes no owners beside it: an agent changes who owns what only through
 * the routes that ask the rule. A model whose tools MCP generates calls its
 * own API route, which a tool for an owner table would have to as well.
 */

type ModelClass = { new (): DatabaseBaseModel };

const OWNER_TABLE_NAME: RegExp = /Owner(User|Team)$/;

// A tool input that would name owners.
const OWNER_PROPERTY: RegExp = /owner/i;

const MODELS: Array<ModelClass> = DatabaseModels as Array<ModelClass>;

const OWNER_TABLES: Array<ModelClass> = MODELS.filter(
  (modelType: ModelClass): boolean => {
    return OWNER_TABLE_NAME.test(new modelType().tableName || "");
  },
);

function toolsFor(modelType: ModelClass): ModelToolsResult {
  return generateToolsForDatabaseModel(new modelType(), modelType);
}

describe("MCP adds and removes no owners of its own", () => {
  test("the sweep finds every owner table, and those the Owned scope reads", () => {
    // Every kind that carries owners: a people table and a team table each.
    expect(OWNER_TABLES.length).toBeGreaterThanOrEqual(74);

    for (const pair of OwnerTableRegistry.values()) {
      for (const service of [pair.ownerUserService, pair.ownerTeamService]) {
        expect(OWNER_TABLES).toContain(service.modelType);
      }
    }
  });

  const OWNER_TABLE_CASES: Array<[string, ModelClass]> = OWNER_TABLES.map(
    (modelType: ModelClass): [string, ModelClass] => {
      return [modelType.name, modelType];
    },
  );

  test.each(OWNER_TABLE_CASES)(
    "%s is no MCP tool",
    (_name: string, modelType: ModelClass) => {
      expect(toolsFor(modelType).tools).toEqual([]);
    },
  );

  test("a resource's create tool takes no owners beside it", () => {
    let createTools: number = 0;

    for (const kind of OwnerTableRegistry.keys()) {
      const modelType: ModelClass | undefined = MODELS.find(
        (each: ModelClass): boolean => {
          return each.name === kind;
        },
      );

      expect([kind, Boolean(modelType)]).toEqual([kind, true]);

      for (const tool of toolsFor(modelType!).tools) {
        if (!tool.name.startsWith("create_")) {
          continue;
        }

        createTools++;

        const properties: Array<string> = Object.keys(
          (tool.inputSchema.properties || {}) as Record<string, unknown>,
        );

        expect([
          kind,
          properties.filter((property: string): boolean => {
            return OWNER_PROPERTY.test(property);
          }),
        ]).toEqual([kind, []]);
      }
    }

    // Monitors, incidents, alerts and the rest are created over MCP.
    expect(createTools).toBeGreaterThan(5);
  });

  test("a model's tools call its own API route, as an owner table's would", () => {
    let models: number = 0;

    for (const modelType of MODELS) {
      const result: ModelToolsResult = toolsFor(modelType);

      if (result.tools.length === 0) {
        continue;
      }

      models++;

      const route: string | undefined = new modelType()
        .getCrudApiPath()
        ?.toString();

      for (const tool of result.tools) {
        expect([tool.name, (tool as McpToolInfo).apiPath]).toEqual([
          tool.name,
          route,
        ]);
      }
    }

    expect(models).toBeGreaterThan(20);
  });
});
