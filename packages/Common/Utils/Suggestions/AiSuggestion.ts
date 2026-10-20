/*
 * AI ACTIONS ARE OFFERED ONLY WHERE AI CAN RUN.
 *
 * Project.enableAi is the project's one AI switch (Project Settings > AI >
 * AI Features). With it off, every AI action in the product - "Draft with
 * AI", "Generate with AI", "Explain with AI", "Fix performance with AI",
 * "Improve logging with AI" and the rest - would only lead to a refusal, so
 * none of them is drawn. The one place that stays is Ask AI in the header:
 * opening it says AI is off and links to the switch, which is the quiet way
 * back for someone who wants AI.
 *
 * Strictly `=== false`, as every server read of the switch: the column is
 * NOT NULL DEFAULT true, so a project whose value was not loaded (an older
 * server, a read the person may not make) is treated as on. The server
 * refuses the action either way; this only decides what the page draws, and
 * a missing value must never hide a working feature.
 */

export interface AiSwitchHolder {
  enableAi?: boolean | undefined;
}

export function isAiOffered(
  project: AiSwitchHolder | null | undefined,
): boolean {
  return project?.enableAi !== false;
}
