/*
 * botbuilder, the Bot Framework SDK, the one way OneUptime imports it.
 *
 * botbuilder runs on zod 4 with two zod 3 names put back (BotbuilderOnZod4),
 * and they have to be back before botbuilder is loaded: its Teams activity
 * handler calls one of them as it loads. This module adds them first and
 * then hands botbuilder on unchanged, so `import { TurnContext } from
 * "./Botbuilder"` is `import { TurnContext } from "botbuilder"` with the order
 * taken care of. BotbuilderImportsGuard fails on any other file that imports
 * botbuilder, botbuilder-core, botframework-connector or botframework-schema.
 */
import "./BotbuilderOnZod4";

export * from "botbuilder";
