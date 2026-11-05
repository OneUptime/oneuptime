/*
 * Help for Propose an OpenStack fix. What a builder most needs to know is what it can't do:
 * it asks a person, and it never makes the change.
 */

import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";

export type OpenStackDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export const getOpenStackProposeFixDocumentation: OpenStackDocumentationFunction =
  (context: ComponentDocumentationContext): ComponentDocumentation => {
    return {
      summary:
        "Asks a person to approve one change to the OpenStack cloud an alert or incident is about, and never makes the change itself.",
      steps: [
        "Start from an alert or incident trigger, and put its ID in **Alert ID** or **Incident ID**. The cloud comes from what the record is linked to.",
        "Write the change in **Command**. It can use values from earlier steps, such as the host an alert names.",
        "Say why in **Why**. It's what the person approving it reads first.",
        "Connect **Error** to what should happen when nothing could be proposed.",
      ],
      examples: [
        {
          title: "Keep new instances off a host",
          code: 'openstack compute service set --disable --disable-reason "Reported down" compute-01 nova-compute',
        },
        {
          title: "The waiting fix, in a later step",
          code: ownReference(context, "suggestion-id"),
        },
      ],
      notes: [
        {
          type: ComponentDocumentationNoteType.Warning,
          text: "A workflow can't approve what it proposes, whatever the cloud's fix mode is. A person approves it on the alert or incident, and **Success** runs without waiting for them.",
        },
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "The same change on the same cloud is one card, however often it is asked for, and **Already Waiting** says when that was the case.",
        },
      ],
      learnMore: [
        {
          title: "What it can propose",
          paragraphs: [
            "The changes a person can approve on a cloud, and nothing else: anything that deletes, anything in Keystone, quotas, security groups and forcing a state are refused, and take **Error**. Each change has one spelling.",
            "Fixes have to be allowed on the cloud first. If they aren't, **Error** says what's missing.",
          ],
        },
      ],
      links: [
        docsLink("Propose an OpenStack fix guide", WorkflowDocsPaths.openStack),
      ],
    };
  };
