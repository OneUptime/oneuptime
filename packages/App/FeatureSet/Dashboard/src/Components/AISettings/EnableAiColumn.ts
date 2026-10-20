/*
 * Project Settings → AI → AI Features: Enable AI, the project's one AI switch
 * (Project.enableAi). Turning it off stops every AI feature at once, so it
 * asks first.
 *
 * A module of its own so the code that follows the switch everywhere - the
 * selected project (Utils/SelectedProjectSwitches) and whether any AI action
 * is drawn (Utils/UseAiOffered) - can name the column without loading the AI
 * settings pages' copy into the dashboard's first chunk.
 */
export type EnableAiColumn = "enableAi";

export const ENABLE_AI_COLUMN: EnableAiColumn = "enableAi";
