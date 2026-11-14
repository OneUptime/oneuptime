import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import { SetUpWebsiteMonitoringTool } from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  TOOLS_OF_NO_PRODUCT,
  TOOL_PRODUCTS,
  getToolProducts,
} from "../../../../../Server/Utils/AI/Toolbox/ToolProducts";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ServerProducts from "../../../../../Server/Utils/ServerProducts/ServerProducts";
import { AIToolRefusal } from "../../../../../Types/AI/AIChatTypes";
import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  AI_SETUP_ACTION_TOOL_NAMES,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  WHO_IS_TOLD_TOOL_NAME,
} from "../../../../../Types/AI/AISetupActions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ProductKey from "../../../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsOff,
  isSwitchableProduct,
} from "../../../../../Types/Product/ServerProducts";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ASK AI LEAVES A PRODUCT THAT IS OFF ALONE (#6815).
 *
 * A setup action for a product switched off on the server is not proposed:
 * it is refused before its approval card, with a sentence that says the
 * product is off and who can switch it on, and nothing runs. Every other
 * tool of the product is refused the same way when it is asked to run.
 * Every tool is placed on purpose: it names its products, or is one of no
 * product.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

type GetOffSpy = SpyInstance<typeof ServerProducts.getOff>;
type ExecuteSpy = SpyInstance<ObservabilityTool["execute"]>;

afterEach(() => {
  jest.restoreAllMocks();
});

function asMember(permissions: Array<Permission>): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: customDomainCaller({ permissions, projectId: PROJECT_ID }),
  };
}

const switchOff: (off: ServerProductsOff) => GetOffSpy = (
  off: ServerProductsOff,
): GetOffSpy => {
  return jest.spyOn(ServerProducts, "getOff").mockResolvedValue(off);
};

const SETUP_TOOL: { execute: ObservabilityTool["execute"] } =
  SetUpWebsiteMonitoringTool as unknown as {
    execute: ObservabilityTool["execute"];
  };

describe("every tool belongs to its products, or to none", () => {
  const toolNames: Array<string> = AIToolbox.getTools().map(
    (tool: ObservabilityTool): string => {
      return tool.name;
    },
  );

  test("each tool of the toolbox is placed in exactly one list", () => {
    for (const name of toolNames) {
      const inProducts: boolean = Object.prototype.hasOwnProperty.call(
        TOOL_PRODUCTS,
        name,
      );
      const inNone: boolean = TOOLS_OF_NO_PRODUCT.includes(name);

      expect({ name, placedOnce: inProducts !== inNone }).toEqual({
        name,
        placedOnce: true,
      });
    }
  });

  test("the lists name only tools the toolbox has", () => {
    for (const name of [
      ...Object.keys(TOOL_PRODUCTS),
      ...TOOLS_OF_NO_PRODUCT,
    ]) {
      expect({ name, registered: toolNames.includes(name) }).toEqual({
        name,
        registered: true,
      });
    }
  });

  test("every product a tool names is one a server can switch off", () => {
    for (const [name, products] of Object.entries(TOOL_PRODUCTS)) {
      expect(products.length).toBeGreaterThan(0);

      for (const product of products) {
        expect({
          name,
          product,
          switchable: isSwitchableProduct(product),
        }).toEqual({ name, product, switchable: true });
      }
    }
  });

  test("the setup actions and who_is_told belong to the products they make or read", () => {
    expect(getToolProducts(SET_UP_WEBSITE_MONITORING_TOOL_NAME)).toEqual([
      ProductKey.Monitors,
    ]);
    expect(getToolProducts(SET_UP_PAGING_TOOL_NAME)).toEqual([
      ProductKey.OnCall,
    ]);
    expect(getToolProducts(PUBLISH_STATUS_PAGE_TOOL_NAME)).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(getToolProducts(ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME)).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(getToolProducts(WHO_IS_TOLD_TOOL_NAME)).toEqual([
      ProductKey.Monitors,
    ]);

    for (const name of AI_SETUP_ACTION_TOOL_NAMES) {
      expect(getToolProducts(name).length).toBeGreaterThan(0);
    }
  });

  test("a tool of no product needs nothing on", () => {
    expect(getToolProducts("search_docs")).toEqual([]);
    expect(getToolProducts("not_a_tool")).toEqual([]);
    expect(getToolProducts("constructor")).toEqual([]);
  });
});

describe("a setup action for a product that is off is never proposed", () => {
  test("it is refused before its card, saying who can switch it on, and nothing runs", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });
    const execute: ExecuteSpy = jest.spyOn(SETUP_TOOL, "execute");

    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
        args: { address: "example.com" },
        ctx: asMember([Permission.ProjectOwner]),
      },
    );

    expect(refused?.success).toBe(false);
    expect(refused?.refusal).toBe(AIToolRefusal.ProductOff);
    expect(refused?.errorMessage).toBe(
      "Monitors is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
    expect(refused?.textForLlm).toContain("Do not retry it");
    expect(refused?.textForLlm).toContain("who can switch it on");
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([
    [SET_UP_PAGING_TOOL_NAME, ProductKey.OnCall, "On-Call"],
    [PUBLISH_STATUS_PAGE_TOOL_NAME, ProductKey.StatusPages, "Status Pages"],
    [
      ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
      ProductKey.StatusPages,
      "Status Pages",
    ],
  ])(
    "%s is refused while %s is off",
    async (name: string, product: ProductKey, title: string) => {
      switchOff({ [product]: ServerProductOffReason.SwitchedOff });

      const refused: ToolCallOutcome | null =
        await AIToolbox.checkBeforeApproval({
          name: name,
          args: {},
          ctx: asMember([Permission.ProjectOwner]),
        });

      expect(refused?.refusal).toBe(AIToolRefusal.ProductOff);
      expect(refused?.errorMessage).toContain(
        `${title} is switched off on this server.`,
      );
    },
  );

  test("the person's permissions are asked first: a refusal names the real problem", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });

    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
        args: { address: "example.com" },
        ctx: asMember([Permission.ReadProjectMonitor]),
      },
    );

    expect(refused?.refusal).toBe(AIToolRefusal.Permission);
  });

  test("a product that is on is not refused for it", async () => {
    const getOff: GetOffSpy = switchOff({
      [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
    });

    expect(
      await AIToolbox.refuseProductsOffOnServer(
        AIToolbox.getToolByName(SET_UP_WEBSITE_MONITORING_TOOL_NAME)!,
      ),
    ).toBeNull();
    expect(getOff).toHaveBeenCalled();
  });
});

describe("a tool of a product that is off does not run", () => {
  test("who_is_told reads nothing while Monitors is off", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });
    const tool: ObservabilityTool = AIToolbox.getToolByName(
      WHO_IS_TOLD_TOOL_NAME,
    )!;
    const execute: ExecuteSpy = jest.spyOn(
      tool as unknown as { execute: ObservabilityTool["execute"] },
      "execute",
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: WHO_IS_TOLD_TOOL_NAME,
      args: { monitor: "example.com" },
      ctx: asMember([Permission.ProjectOwner]),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.refusal).toBe(AIToolRefusal.ProductOff);
    expect(execute).not.toHaveBeenCalled();
  });

  test("a telemetry read names DISABLE_TELEMETRY_INGESTION while ingestion is stopped", async () => {
    switchOff({
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
    });

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "search_logs",
      args: {},
      ctx: asMember([Permission.ProjectOwner]),
    });

    expect(outcome.refusal).toBe(AIToolRefusal.ProductOff);
    expect(outcome.errorMessage).toContain("DISABLE_TELEMETRY_INGESTION");
  });

  test("a tool of no product runs whatever is off", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });

    expect(
      await AIToolbox.refuseProductsOffOnServer(
        AIToolbox.getToolByName("search_docs")!,
      ),
    ).toBeNull();
  });
});
