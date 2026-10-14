/*
 * Help for the Page steps: Page Users, Page a Team, Page Whoever Is On Call
 * and Page an On-Call Policy.
 *
 * They share most of what there is to say - what a page is about, how
 * people are reached, that a test run pages for real - so one builder writes
 * all four from what differs: the who-to-page setting and what it does. The
 * first example is about the workflow the step is in: with an incident or
 * an alert among its steps, it pages about that one; without, it shows a
 * page about something new.
 */

import { NodeDataProp } from "../Component";
import { componentReturnValueReference } from "../TemplateSyntax";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationNote,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  findRecordStep,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";
import { ID_COLUMN_ID } from "./ModelExamples";

export type OnCallDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

// What is different about one Page step.
interface PageStepHelp {
  summary: string;
  // The step's who-to-page setting, by the name the form gives it.
  whoSetting: string;
  // How to fill it in, as the first of the help's steps.
  chooseWho: string;
  // What its example puts in it.
  whoExample: string;
  // The step's own notes, after the one every Page step has.
  notes: Array<ComponentDocumentationNote>;
  // What **Success** means for it, to end the last of the help's steps.
  successMeans: string;
  // The step's own topics, before the ones every Page step has.
  topics: Array<ComponentDocumentationTopic>;
  /*
   * What posting its Summary to a channel tells the channel, as the title
   * of that example: who was paged, or that a policy has started.
   */
  summaryExampleTitle: string;
  // What its Summary reads like.
  summaryExample: string;
}

// The three steps that page people say who they paged.
const TELL_WHO_WAS_PAGED: string = "Tell a channel who was paged";

/*
 * A test run is not a rehearsal for these steps: Run Workflow runs them as
 * they are, whether the workflow is on or off, and the people named get
 * their calls and texts.
 */
export const PAGE_TEST_RUN_WARNING: string =
  "**Run Workflow** pages people for real, whether the workflow is on or off: phones ring. Name yourself while you test.";

type AboutExampleFunction = (
  context: ComponentDocumentationContext,
  help: PageStepHelp,
) => ComponentDocumentationExample;

/*
 * A page about the incident or the alert this workflow already has - its
 * trigger's, usually - or, with neither, about something new.
 */
const aboutExample: AboutExampleFunction = (
  context: ComponentDocumentationContext,
  help: PageStepHelp,
): ComponentDocumentationExample => {
  const incidentStep: NodeDataProp | null = findRecordStep(context, "Incident");

  if (incidentStep) {
    return {
      title: "Page about this workflow's incident",
      fields: [
        { name: help.whoSetting, value: help.whoExample },
        { name: "Page About", value: "An incident" },
        {
          name: "Incident ID",
          value: componentReturnValueReference(incidentStep.id, "model", [
            ID_COLUMN_ID,
          ]),
        },
      ],
      description: `The reference puts in the ID of the Incident from \`${incidentStep.id}\`. Acknowledging the page acknowledges that incident.`,
    };
  }

  const alertStep: NodeDataProp | null = findRecordStep(context, "Alert");

  if (alertStep) {
    return {
      title: "Page about this workflow's alert",
      fields: [
        { name: help.whoSetting, value: help.whoExample },
        { name: "Page About", value: "An alert" },
        {
          name: "Alert ID",
          value: componentReturnValueReference(alertStep.id, "model", [
            ID_COLUMN_ID,
          ]),
        },
      ],
      description: `The reference puts in the ID of the Alert from \`${alertStep.id}\`. Acknowledging the page acknowledges that alert.`,
    };
  }

  return {
    title: "Page about something new",
    fields: [
      { name: help.whoSetting, value: help.whoExample },
      { name: "Page About", value: "A new alert" },
      { name: "Title", value: "Database CPU is above 90%" },
      { name: "Message", value: "Queries are queueing on db-primary." },
    ],
    description:
      "OneUptime creates an alert with that title, and acknowledging the page acknowledges it.",
  };
};

type BuildPageDocumentationFunction = (
  context: ComponentDocumentationContext,
  help: PageStepHelp,
) => ComponentDocumentation;

const buildPageDocumentation: BuildPageDocumentationFunction = (
  context: ComponentDocumentationContext,
  help: PageStepHelp,
): ComponentDocumentation => {
  return {
    summary: help.summary,
    steps: [
      help.chooseWho,
      "Choose what the page is about in **Page About**: a new alert, with a **Title**, or an incident or alert that is already there, by its ID.",
      `Connect **Success** to what runs once ${help.successMeans}, and **Error** to what should happen when nobody was paged.`,
    ],
    examples: [
      aboutExample(context, help),
      {
        title: help.summaryExampleTitle,
        code: ownReference(context, "summary"),
        description: `Put it in a message step after this one. It reads like "${help.summaryExample}"`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: PAGE_TEST_RUN_WARNING,
      },
      ...help.notes,
    ],
    learnMore: [
      ...help.topics,
      {
        title: "How people are paged",
        paragraphs: [
          "Each person is reached the way their own On-Call Rules say for the severity of the alert or incident: a call, an SMS, a push or an email, at once or after some minutes. They set those under User Settings, On-Call Rules.",
          "The paging stops when somebody acknowledges their page. That acknowledges the alert or the incident, exactly as acknowledging it in OneUptime does.",
        ],
      },
      {
        title: "What the page is about",
        paragraphs: [
          "A page is always about an alert or an incident. Choosing A new alert in **Page About** creates one from **Title** and **Message**. It is an ordinary alert: it is in the Alerts list, your alert rules apply to it, its feed says who was paged, and it stays open until somebody resolves it.",
          "**Severity**, under More fields, is the new alert's severity, and so which of each person's rules page them. Left empty, it is the project's most severe.",
          "To page about the incident or alert a workflow started on, choose An incident or An alert, and pick its ID with { }.",
        ],
      },
      {
        title: "Paging only when something is true",
        paragraphs: [
          "Put **If / Else** before this step, and connect the output that should page to it: the page then goes out only when the condition is met, such as an incident's severity being Critical. With more than two ways to go, **Switch / Case** takes a path for each value, and each path can page somebody else.",
        ],
      },
      {
        title: "When nobody is paged",
        paragraphs: [
          "The step takes **Error** when nobody was paged, and the reason is in the value below. When the alert or incident is there, **Alert ID** or **Incident ID** is still returned, so the **Error** path can page somebody else about it.",
        ],
        example: {
          title: "Why nobody was paged",
          code: ownReference(context, "error"),
        },
      },
    ],
    links: [docsLink("Paging guide", WorkflowDocsPaths.paging)],
  };
};

// What the three steps that page directly have in common.
const DIRECT_PAGE_NOTE: ComponentDocumentationNote = {
  type: ComponentDocumentationNoteType.Tip,
  text: "Everybody is paged at once, and nobody else is paged if they do not answer. For escalation and repeats, use **Page an On-Call Policy**.",
};

const WHO_IS_LEFT_OUT_TOPIC: ComponentDocumentationTopic = {
  title: "Who is left out",
  paragraphs: [
    "Somebody who is away is not paged: whoever their user override names to cover is paged instead, or nobody when it names no one. Somebody who has left the project is not paged either.",
    "**Summary** says who was left out and why, and **Paged Users** lists the people who were paged, each with an id, a name and an email.",
  ],
};

export const getPageUsersDocumentation: OnCallDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return buildPageDocumentation(context, {
    summary:
      "Pages the people you name, each by their own on-call rules, until somebody acknowledges.",
    whoSetting: "Users",
    chooseWho:
      "Choose who to page in **Users**: pick people of this project, or add a value from an earlier step with { }, such as a user's ID or email address.",
    whoExample: "Jane Doe",
    notes: [DIRECT_PAGE_NOTE],
    successMeans: "somebody is paged",
    topics: [WHO_IS_LEFT_OUT_TOPIC],
    summaryExampleTitle: TELL_WHO_WAS_PAGED,
    summaryExample: "Paged Jane Doe about Alert #12.",
  });
};

export const getPageTeamDocumentation: OnCallDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return buildPageDocumentation(context, {
    summary:
      "Pages every member of a team, each by their own on-call rules, until somebody acknowledges.",
    whoSetting: "Teams",
    chooseWho:
      "Choose the team in **Teams**: pick one or more teams, or add a team's ID from an earlier step with { }. Every member is paged.",
    whoExample: "Platform",
    notes: [DIRECT_PAGE_NOTE],
    successMeans: "somebody is paged",
    topics: [
      {
        title: "Who counts as a member",
        paragraphs: [
          "Everybody who has accepted their invitation to the team, as the team's Members page lists them. Somebody still invited is not paged, and a team with no members takes **Error**.",
        ],
      },
      WHO_IS_LEFT_OUT_TOPIC,
    ],
    summaryExampleTitle: TELL_WHO_WAS_PAGED,
    summaryExample:
      "Paged Jane Doe (member of Platform) and John Roe (member of Platform) about Alert #12.",
  });
};

export const getPageOnCallDocumentation: OnCallDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return buildPageDocumentation(context, {
    summary:
      "Pages whoever is on call in a schedule right now, by their own on-call rules.",
    whoSetting: "On-Call Schedules",
    chooseWho:
      "Choose the schedule in **On-Call Schedules**: pick one or more, or add a schedule's ID from an earlier step with { }. Whoever is on call now is paged.",
    whoExample: "Primary",
    notes: [DIRECT_PAGE_NOTE],
    successMeans: "somebody is paged",
    topics: [
      {
        title: "Who is on call",
        paragraphs: [
          "The person the schedule has on call at the moment the step runs, as its page in OneUptime shows: its layers, and anybody covering for somebody who is away. A schedule with nobody on call then pages nobody, and with no other schedule the step takes **Error**.",
        ],
      },
      WHO_IS_LEFT_OUT_TOPIC,
    ],
    summaryExampleTitle: TELL_WHO_WAS_PAGED,
    summaryExample: "Paged Jane Doe (on call in Primary) about Alert #12.",
  });
};

export const getPageOnCallPolicyDocumentation: OnCallDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return buildPageDocumentation(context, {
    summary:
      "Starts an on-call policy, which pages through its escalation rules until somebody acknowledges.",
    whoSetting: "On-Call Policies",
    chooseWho:
      "Choose the policy in **On-Call Policies**: pick one or more, or add a policy's ID from an earlier step with { }.",
    whoExample: "Critical Escalation",
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "To page a person, a team or whoever is on call without a policy, use **Page Users**, **Page a Team** or **Page Whoever Is On Call**.",
      },
    ],
    successMeans: "a policy has started",
    topics: [
      {
        title: "What the policy does",
        paragraphs: [
          "It runs as it does for an incident or alert of its own: its first escalation rule pages its people, the next rule follows if nobody acknowledges in time, and the policy repeats as often as it is set to. The step carries on as soon as the policy has started.",
          "An archived policy pages no one, and the step says so in **Summary**. A policy the incident or alert is already running is started again beside it.",
        ],
      },
    ],
    // It starts a policy: who the policy pages is the policy's to say.
    summaryExampleTitle: "Tell a channel which policy started",
    summaryExample: "Started on-call policy Critical Escalation for Alert #12.",
  });
};
