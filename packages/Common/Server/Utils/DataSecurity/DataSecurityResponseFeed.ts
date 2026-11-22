import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  DataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { DataSecurityResponseOutcome } from "./Cloud/DataSecurityCloudTypes";

/*
 * A RESPONSE ACTION, AS THE STORE'S FEED SAYS IT. Data Security's response
 * writes one line on the store's feed for each action it takes
 * (DataSecurityResponse.run); the security event of a change OneUptime made
 * in its own session is tied to that line (DataSecurityChangeSignals,
 * #10428). Both read it from here, so the line is written and read the one
 * way: an action that changed the store opens "**<action>**, through the
 * store's cloud connection:", one that found nothing to change
 * "**<action>** changed nothing:".
 */

export function getResponseActionStoreFeedMarkdown(data: {
  action: DataSecurityResponseAction;
  outcome: DataSecurityResponseOutcome;
}): MarkdownText {
  return data.outcome.changed
    ? mdText`**${data.action}**, through the store's cloud connection: ${data.outcome.summary} The store is being checked again.`
    : mdText`**${data.action}** changed nothing: ${data.outcome.summary}`;
}

// The action a line of the store's feed records, and whether it changed the store; null for any other line.
export function readResponseActionOfStoreFeed(
  markdown: string,
): { action: DataSecurityResponseAction; changed: boolean } | null {
  const text: string = markdown || "";

  for (const action of ALL_DATA_SECURITY_RESPONSE_ACTIONS) {
    for (const changed of [true, false]) {
      // The line as it is written, cut after its fixed words: the action's name rendered the one way.
      const rendered: string = getResponseActionStoreFeedMarkdown({
        action,
        outcome: { changed, summary: "" },
      }).toString();
      const words: string = changed
        ? ", through the store's cloud connection:"
        : " changed nothing:";
      const end: number = rendered.indexOf(words);

      if (end >= 0 && text.startsWith(rendered.slice(0, end + words.length))) {
        return { action, changed };
      }
    }
  }

  return null;
}
