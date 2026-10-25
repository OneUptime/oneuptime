import { jest } from "@jest/globals";
import { addBotbuilderZod3Names } from "../../Server/Utils/Workspace/MicrosoftTeams/BotbuilderOnZod4";

/*
 * The real botbuilder for a test, loaded as production loads it.
 *
 * Common's jest maps botbuilder (and botbuilder-core, botframework-connector
 * and @azure/*) to small stubs. A test that needs the real Bot Framework
 * stack - CloudAdapter, TeamsActivityHandler, the connector client talking
 * HTTP to a fake Bot Connector - mocks "botbuilder" with this:
 *
 *   jest.mock("botbuilder", () => {
 *     return (
 *       jest.requireActual("<path>/Tests/Helpers/RealBotbuilder") as {
 *         loadRealBotbuilder: (fromFile: string) => unknown;
 *       }
 *     ).loadRealBotbuilder(__filename);
 *   });
 *
 * It loads botbuilder with NODE's require, not jest's. Inside jest,
 * require("module") is jest's own shim whose createRequire() still applies
 * moduleNameMapper; process.getBuiltinModule("module") (Node >= 22.3) is the
 * real node:module, so its createRequire() loads botbuilder and everything
 * under it (botbuilder-core, botframework-connector, @azure/*, zod) through
 * Node's own loader, outside jest's registry.
 *
 * That loader has its own copy of zod - Common's zod 4, which botbuilder
 * shares in production through the package.json override - and botbuilder
 * needs the two zod 3 names BotbuilderOnZod4 adds before it can be loaded.
 * Production adds them through Common/Server/Utils/Workspace/MicrosoftTeams/
 * Botbuilder, but jest's copy of that module patches jest's zod, not
 * Node's. So this adds them to Node's zod first, exactly as that module does,
 * and only then loads botbuilder.
 */

type NodeModuleBuiltin = typeof import("module");

export function getRealNodeModuleBuiltin(): NodeModuleBuiltin {
  if (typeof process.getBuiltinModule === "function") {
    return process.getBuiltinModule("module");
  }

  // Fallback: jest's shim subclasses the real Module class.
  return Object.getPrototypeOf(
    jest.requireActual("module"),
  ) as NodeModuleBuiltin;
}

// Node's own require, resolving from `fromFile`.
export function getNativeRequire(fromFile: string): NodeJS.Require {
  return getRealNodeModuleBuiltin().createRequire(fromFile);
}

export function loadRealBotbuilder(fromFile: string): unknown {
  const nativeRequire: NodeJS.Require = getNativeRequire(fromFile);

  addBotbuilderZod3Names(
    nativeRequire("zod") as Parameters<typeof addBotbuilderZod3Names>[0],
  );

  return nativeRequire("botbuilder");
}
