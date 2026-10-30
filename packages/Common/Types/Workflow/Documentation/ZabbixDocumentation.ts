/*
 * Help for Update Zabbix Problem (Types/Workflow/Components/Zabbix).
 */

import { ZABBIX_MESSAGE_MAX_LENGTH } from "../Components/Zabbix";
import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";

export type ZabbixDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export const getZabbixUpdateProblemDocumentation: ZabbixDocumentationFunction =
  (context: ComponentDocumentationContext): ComponentDocumentation => {
    return {
      summary:
        "Acknowledges or closes a problem in Zabbix, or adds a message to it, through Zabbix's API.",
      steps: [
        "Fill in **Zabbix URL**, and **API Token** with a secret variable that holds a Zabbix API token.",
        "Put the problem's event ID in **Event ID**, usually the one an incident keeps in its custom fields.",
        "Set **What To Do** to acknowledge, close or message, and write the **Message** Zabbix keeps on the problem.",
      ],
      examples: [
        {
          title: "Close the problem of a resolved incident",
          fields: [
            {
              name: "Event ID",
              value:
                "{{local.components.incident-on-update-1.returnValues.model.customFields.zabbixEventId}}",
            },
            { name: "What To Do", value: "close" },
            {
              name: "Message",
              value: "Resolved in OneUptime.",
            },
          ],
          description: `With an On Update Incident trigger called incident-on-update-1. A later step reads what it did with \`${ownReference(context, "summary")}\`.`,
        },
      ],
      notes: [
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "A problem Zabbix already resolved, or already acknowledged when that is all you ask, is left as it is, and the step goes on by **Unchanged**.",
        },
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "A problem whose trigger does not allow closing problems by hand is acknowledged instead, and its message says it stays open until Zabbix sees it recover.",
        },
      ],
      learnMore: [
        {
          title: "What it sends",
          paragraphs: [
            `To acknowledge or close, it reads the problem with event.get first, then sends event.acknowledge with the message. Zabbix keeps at most ${ZABBIX_MESSAGE_MAX_LENGTH} characters of a message, so a longer one is cut.`,
            "Zabbix answers a refused request with a success status and the reason in its answer: the step reads it, and goes on by **Error** with Zabbix's reason.",
          ],
        },
        {
          title: "On Zabbix 6.0",
          paragraphs: [
            "Zabbix 6.0 reads the API token from the request body, not from a header. Turn on **Zabbix 6.0**, under the advanced settings. Turn it off again when you upgrade: Zabbix 7.2 and later refuse a token in the body.",
          ],
        },
      ],
      links: [
        docsLink("Update Zabbix Problem guide", WorkflowDocsPaths.zabbix),
        docsLink("Zabbix integration", "/integrations/zabbix"),
      ],
    };
  };
