import { generateAllFieldsSelect } from "../Services/SelectFieldGenerator";
import ModelType from "../Types/ModelType";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Probe from "Common/Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN MCP AGENT WITH A VIEWER'S API KEY READS OF AN LLM PROVIDER, A
 * PROBE AND AN AI AGENT.
 *
 * MCP list and read tools ask for every readable field by default
 * (generateAllFieldsSelect), and OneUptimeApiService drops each column the
 * API refuses ("You do not have permissions to select on - <column>") and
 * asks again. These run that loop against the real permission layer for a
 * project API key holding Viewer: the read succeeds, and what the key may not
 * read - an LLM provider's API key, a probe's or an AI agent's key - is
 * dropped rather than read. An LLM provider's Additional Parameters, read
 * like its key, are not in the default select at all (a JSON column is left
 * out for size); whether any are saved is.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const SELECT_REFUSAL: RegExp = /permissions to select on\s*-\s*([A-Za-z0-9_]+)/;

function viewerApiKey(): DatabaseCommonInteractionProps {
  return {
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.Viewer,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          } as UserPermission,
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

/*
 * The MCP server's retry, against the permission layer: what the read ends
 * up selecting, and what it had to drop.
 */
async function readAsMcpWould(
  modelType: { new (): BaseModel },
  select: JSONObject,
): Promise<{ finalSelect: JSONObject; dropped: Array<string> }> {
  const finalSelect: JSONObject = { ...select };
  const dropped: Array<string> = [];

  for (let attempt: number = 0; attempt < 50; attempt++) {
    try {
      await ModelPermission.checkReadQueryPermission(
        modelType as never,
        {},
        finalSelect as never,
        viewerApiKey(),
      );

      return { finalSelect, dropped };
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }

      const column: string | undefined = (error as Error).message.match(
        SELECT_REFUSAL,
      )?.[1];

      if (!column || !(column in finalSelect)) {
        throw error;
      }

      delete finalSelect[column];
      dropped.push(column);
    }
  }

  throw new Error("The read never succeeded.");
}

describe("MCP reads with a Viewer's API key", () => {
  test("an LLM provider: the key is dropped, the parameters are never asked for, whether any are saved is read", async () => {
    const select: JSONObject = generateAllFieldsSelect(
      "LlmProvider",
      ModelType.Database,
    );

    expect(select["additionalParams"]).toBeUndefined();
    expect(select["hasAdditionalParams"]).toBe(true);
    expect(select["apiKey"]).toBe(true);

    const { finalSelect, dropped } = await readAsMcpWould(LlmProvider, select);

    expect(dropped).toContain("apiKey");
    expect(finalSelect["apiKey"]).toBeUndefined();
    expect(finalSelect["hasAdditionalParams"]).toBe(true);
    expect(finalSelect["name"]).toBe(true);
    expect(finalSelect["baseUrl"]).toBe(true);
  });

  test("an LLM provider: asking for the parameters by name is refused, and dropped", async () => {
    const { finalSelect, dropped } = await readAsMcpWould(LlmProvider, {
      name: true,
      additionalParams: true,
    });

    expect(dropped).toEqual(["additionalParams"]);
    expect(finalSelect).toEqual({ name: true });
  });

  test.each([
    ["Probe", Probe],
    ["AIAgent", AIAgent],
  ])(
    "a %s: its key is dropped, and its name and description are read",
    async (tableName: string, modelType: { new (): BaseModel }) => {
      const select: JSONObject = generateAllFieldsSelect(
        tableName,
        ModelType.Database,
      );

      expect(select["key"]).toBe(true);

      const { finalSelect, dropped } = await readAsMcpWould(modelType, select);

      expect(dropped).toContain("key");
      expect(finalSelect["key"]).toBeUndefined();
      expect(finalSelect["name"]).toBe(true);
      expect(finalSelect["description"]).toBe(true);
    },
  );
});
