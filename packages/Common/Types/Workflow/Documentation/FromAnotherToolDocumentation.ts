/*
 * Help for Incident From Another Tool and Alert From Another Tool
 * (Types/Workflow/Components/FromAnotherTool): one builder, told which.
 */

import {
  ALERT_FROM_ANOTHER_TOOL,
  DEFAULT_OUTSIDE_ID_FIELD,
  FromAnotherToolKind,
  INCIDENT_FROM_ANOTHER_TOOL,
} from "../Components/FromAnotherTool";
import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";

export type FromAnotherToolDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

type GetFromAnotherToolDocumentationFunction = (
  kind: FromAnotherToolKind,
) => FromAnotherToolDocumentationFunction;

const getFromAnotherToolDocumentation: GetFromAnotherToolDocumentationFunction =
  (kind: FromAnotherToolKind): FromAnotherToolDocumentationFunction => {
    const n: string = kind.noun;
    const opened: string = kind.hasStatusPages ? "opened" : "created";

    return (context: ComponentDocumentationContext): ComponentDocumentation => {
      return {
        summary: `Keeps one ${n} per problem in another tool, by the tool's ID: ${kind.opens}, acknowledges or resolves it, or adds a note.`,
        steps: [
          "Put the event's kind in **What Happened**, usually a value from the trigger, and the tool's ID for the problem in **Outside ID**.",
          `Fill in **Title**, **Description** and **Severity** for when the step ${kind.opens} the ${n}, and **Note** for what it adds later.`,
          `Connect **${kind.Opened}** to what should happen for a new ${n}, such as a Page step.`,
        ],
        examples: [
          {
            title: "Grafana or Alertmanager alerts",
            fields: [
              {
                name: "What Happened",
                value:
                  "{{local.components.webhook-1.returnValues.request-body.status}}",
              },
              {
                name: "Outside ID",
                value:
                  "{{local.components.webhook-1.returnValues.request-body.groupKey}}",
              },
              {
                name: "Title",
                value:
                  "{{local.components.webhook-1.returnValues.request-body.commonLabels.alertname}}",
              },
            ],
            description: `With a Webhook trigger called webhook-1 that Grafana or Alertmanager calls: firing ${kind.opens} the ${n}, and resolved resolves it. A Page step reads the new ${n}'s ID with \`${ownReference(
              context,
              "record",
              ["_id"],
            )}\`.`,
          },
        ],
        notes: [
          {
            type: ComponentDocumentationNoteType.Tip,
            text: `An ${n} that already has the Outside ID is never ${opened} again, even once resolved. Use an ID that is new for each problem, such as a Zabbix event ID.`,
          },
          {
            type: ComponentDocumentationNoteType.Tip,
            text: `An ${n} only moves forward: one at the state, or past it, is left as it is, and the step goes on by **Unchanged**.`,
          },
        ],
        learnMore: [
          {
            title: "What What Happened can say",
            paragraphs: [
              `open, problem, firing, triggered or created ${kind.opens} an ${n}. acknowledge or acknowledged acknowledges it. resolve, resolved, recovery, ok or closed resolves it. note, update or comment adds the **Note** as a private note.`,
              `Anything else is read as the name of one of your ${n} states, and moves the ${n} there. Empty, nothing happens. To name a state called like one of these words, write state: before its name, such as state: Open.`,
            ],
          },
          {
            title: "Where the ID is kept",
            paragraphs: [
              `The ${n} keeps the Outside ID in the custom field **Outside ID Field** names, ${DEFAULT_OUTSIDE_ID_FIELD} unless you change it. Only that field is written, so the ${n}'s other custom fields are kept.`,
              `To act on an ${n} the other tool knows by its ${kind.Noun} ID instead, put that in **${kind.Noun} ID**, under the advanced settings. **Custom Fields** gives a new ${n} more custom fields, such as the tool's own number for the problem.`,
            ],
          },
          {
            title: "Severity",
            paragraphs: [
              `**Severity** is the name or the ID of one of your ${n} severities, in any case, or where it sits among them: most severe, middle or least severe. A tool with levels of its own is spread over yours that way, whatever you named them.`,
              `Empty, or naming none of them, the ${n} is ${opened} at your most severe, and the run log says so.`,
            ],
          },
          {
            title: "A note and a state change at once",
            paragraphs: [
              `Some tools say something as they acknowledge or resolve a problem. Put why in **Reason**, under the advanced settings, and what the tool said in **Note**: the step adds the **Note** as a private note, then moves the ${n} with the **Reason** on its timeline.`,
            ],
          },
        ],
        links: [
          docsLink(
            "Incidents and alerts from other tools",
            WorkflowDocsPaths.fromOtherTools,
          ),
        ],
      };
    };
  };

export const getIncidentFromAnotherToolDocumentation: FromAnotherToolDocumentationFunction =
  getFromAnotherToolDocumentation(INCIDENT_FROM_ANOTHER_TOOL);

export const getAlertFromAnotherToolDocumentation: FromAnotherToolDocumentationFunction =
  getFromAnotherToolDocumentation(ALERT_FROM_ANOTHER_TOOL);
