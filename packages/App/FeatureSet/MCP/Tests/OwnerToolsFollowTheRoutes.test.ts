import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnerTableRegistry from "Common/Server/Types/Database/Permissions/OwnerTableRegistry";
import {
  generateAllTools,
  generateToolsForDatabaseModel,
} from "../Tools/ToolGenerator";
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";
import {
  OWNER_TEAMS_ON_CREATE_KEY,
  OWNER_USERS_ON_CREATE_KEY,
  TABLES_TAKING_OWNERS_ON_CREATE,
  takesOwnersOnCreate,
} from "Common/Types/Database/OwnersOnCreate";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { handleHelperTool } from "../Tools/HelperTools";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

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
 * takes no owners beside it, but an incident's and an alert's: their create
 * route asks the rule of the owners handed over with the create before
 * anything is saved (OwnerRuleAssignment.checkOwnersPickedOnCreate), so
 * their tools take ownerUsers and ownerTeams, and send them to it as the
 * create's misc data, never as fields (#8198, Types/Database/OwnersOnCreate).
 * An agent changes who owns what only through the routes that ask the rule.
 * A model whose tools MCP generates calls its own API route, which a tool
 * for an owner table would have to as well.
 */

type ModelClass = { new (): DatabaseBaseModel };

const OWNER_TABLE_NAME: RegExp = /Owner(User|Team)$/;

// A create hook asking the rule of the owners its misc data hands over.
const CHECKS_OWNERS_HANDED_OVER: RegExp =
  /OwnerRuleAssignment\.checkOwnersPickedOnCreate\(\{[\s\S]*?miscDataProps:/;

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

  test("a resource's create tool takes no owners beside it, but an incident's and an alert's, whose route asks the rule", () => {
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
        ]).toEqual([
          kind,
          takesOwnersOnCreate(new modelType!().tableName || undefined)
            ? [OWNER_USERS_ON_CREATE_KEY, OWNER_TEAMS_ON_CREATE_KEY]
            : [],
        ]);
      }
    }

    // Monitors, incidents, alerts and the rest are created over MCP.
    expect(createTools).toBeGreaterThan(5);
  });

  test("the incident's and the alert's create tools are the only ones that take owners, and both take them", () => {
    expect([...TABLES_TAKING_OWNERS_ON_CREATE].sort()).toEqual([
      "Alert",
      "Incident",
    ]);

    for (const tableName of TABLES_TAKING_OWNERS_ON_CREATE) {
      const modelType: ModelClass = MODELS.find((each: ModelClass): boolean => {
        return new each().tableName === tableName;
      })!;

      const create: McpToolInfo = toolsFor(modelType).tools.find(
        (tool: McpToolInfo): boolean => {
          return tool.operation === OneUptimeOperation.Create;
        },
      )!;

      expect(create.inputSchema.properties).toEqual(
        expect.objectContaining({
          [OWNER_USERS_ON_CREATE_KEY]: expect.objectContaining({
            type: "array",
            items: { type: "string" },
          }),
          [OWNER_TEAMS_ON_CREATE_KEY]: expect.objectContaining({
            type: "array",
            items: { type: "string" },
          }),
        }),
      );
      // Never required: an incident or an alert with no owners is told to the project's owners.
      expect(create.inputSchema.required || []).not.toContain(
        OWNER_USERS_ON_CREATE_KEY,
      );
      expect(create.inputSchema.required || []).not.toContain(
        OWNER_TEAMS_ON_CREATE_KEY,
      );
    }
  });

  test("their owners go to the create route as its misc data - which the route asks the rule of - and never as fields", () => {
    const buildRequestData: (
      operation: OneUptimeOperation,
      args: JSONObject,
      tableName: string,
      modelType: ModelType,
    ) => JSONObject = (
      OneUptimeApiService as unknown as {
        buildRequestData: (
          operation: OneUptimeOperation,
          args: JSONObject,
          tableName: string,
          modelType: ModelType,
        ) => JSONObject;
      }
    ).buildRequestData.bind(OneUptimeApiService);

    const userId: string = "550e8400-e29b-41d4-a716-446655440000";
    const teamId: string = "550e8400-e29b-41d4-a716-446655440001";

    for (const tableName of TABLES_TAKING_OWNERS_ON_CREATE) {
      expect(
        buildRequestData(
          OneUptimeOperation.Create,
          {
            title: "Checkout is down",
            ownerUsers: [userId, userId.toUpperCase()],
            ownerTeams: [teamId],
          },
          tableName,
          ModelType.Database,
        ),
      ).toEqual({
        data: { title: "Checkout is down" },
        miscDataProps: { ownerUsers: [userId], ownerTeams: [teamId] },
      });
    }

    // Any other create sends what it is given, as fields, as before.
    expect(
      buildRequestData(
        OneUptimeOperation.Create,
        { name: "Payments", ownerUsers: [userId] },
        "Monitor",
        ModelType.Database,
      ),
    ).toEqual({ data: { name: "Payments", ownerUsers: [userId] } });

    // An owner that is not an id is refused before any request is made.
    expect(() => {
      buildRequestData(
        OneUptimeOperation.Create,
        { title: "Checkout is down", ownerUsers: ["jane@acme.test"] },
        "Incident",
        ModelType.Database,
      );
    }).toThrow("Invalid ownerUsers entry 'jane@acme.test'");
    expect(() => {
      buildRequestData(
        OneUptimeOperation.Create,
        { title: "Checkout is down", ownerTeams: ["Platform"] },
        "Alert",
        ModelType.Database,
      );
    }).toThrow("Use the list_teams tool to find one.");

    // None given, or an empty list: no misc data at all.
    expect(
      buildRequestData(
        OneUptimeOperation.Create,
        { title: "Checkout is down", ownerUsers: [] },
        "Incident",
        ModelType.Database,
      ),
    ).toEqual({ data: { title: "Checkout is down" } });
  });

  test("oneuptime_describe_resource says what the owner inputs are, for the incident and the alert alone", () => {
    const tools: Array<McpToolInfo> = generateAllTools();

    const usageOf: (resource: string) => JSONObject = (
      resource: string,
    ): JSONObject => {
      return (
        JSON.parse(
          handleHelperTool("oneuptime_describe_resource", { resource }, tools),
        ) as { usage: JSONObject }
      ).usage;
    };

    for (const resource of ["Incident", "Alert"]) {
      expect(String(usageOf(resource)["owners"])).toBe(
        "The create tool takes ownerUsers and ownerTeams beside the fields: the IDs of the users and teams who own it from the start, who are told it was created. A caller who may not add them is refused before anything is saved. Owners added later may miss the created notification.",
      );
    }

    for (const resource of ["Monitor", "Scheduled Maintenance"]) {
      expect(usageOf(resource)).not.toHaveProperty("owners");
    }
  });

  test("the incident's and the alert's create routes ask the rule of the owners handed over with the create, before anything is saved", () => {
    const services: string = path.resolve(
      __dirname,
      "../../../../Common/Server/Services",
    );

    for (const file of ["IncidentService.ts", "AlertService.ts"]) {
      const source: string = fs.readFileSync(path.join(services, file), "utf8");
      const onBeforeCreate: string = source.slice(
        source.indexOf("protected override async onBeforeCreate("),
      );

      expect([file, CHECKS_OWNERS_HANDED_OVER.test(onBeforeCreate)]).toEqual([
        file,
        true,
      ]);
    }
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
