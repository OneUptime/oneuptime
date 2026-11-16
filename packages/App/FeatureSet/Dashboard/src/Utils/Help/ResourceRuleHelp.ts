/*
 * THE HELP OF A RESOURCE'S LABEL RULES AND OWNER RULES (#8889).
 *
 * Every resource with label and owner rules - hosts, monitors, clusters,
 * queues, on-call policies and the rest - had its own copy of the same two
 * help texts, fifty of them, each saying a little less than it should:
 * none said a rule runs only as a resource is added, or how to reach the
 * resources you already have (Run Now), and most called the conditions
 * "any-of (M2M)". These write the two texts once, for the resource's
 * nouns, in the help dialog's shape (Common HelpContent): what a rule does
 * in short, how it works, its Match Criteria - a section the table
 * rewrites for the conditions its form offers (RuleCriteriaModelTable) -
 * and what a page has to add about its own resource.
 *
 * What they say is what the rule engines do (Common/Server/Services/
 * *LabelRuleEngineService, *OwnerRuleEngineService): a rule runs when a
 * resource is created - label rules first, then owner rules, which read
 * the labels just added - and on Run Now; it only ever adds; every
 * matching rule adds what it names.
 *
 * React-free, so the guards and tests read it as text.
 */

export interface ResourceRuleHelpNouns {
  // The resource as it reads in the middle of a sentence: "Kubernetes cluster".
  singular: string;
  // "Kubernetes clusters".
  plural: string;
}

// A page's own topic, after the shared ones: what it adds about its resource.
export interface ResourceRuleHelpTopic {
  title: string;
  markdown: string;
}

export interface ResourceRuleHelpData {
  nouns: ResourceRuleHelpNouns;
  topics?: Array<ResourceRuleHelpTopic> | undefined;
}

// The heading the table rewrites for its own conditions.
export const RULE_HELP_MATCH_CRITERIA_HEADING: string = "## Match Criteria";

const getMatchCriteriaTopic: (nouns: ResourceRuleHelpNouns) => string = (
  nouns: ResourceRuleHelpNouns,
): string => {
  return `${RULE_HELP_MATCH_CRITERIA_HEADING}

Add conditions on what a ${nouns.singular} carries, such as its labels, name or description, and choose whether all of them or any one must match.`;
};

const getPageTopics: (
  topics: Array<ResourceRuleHelpTopic> | undefined,
) => Array<string> = (
  topics: Array<ResourceRuleHelpTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: ResourceRuleHelpTopic): string => {
    return `## ${topic.title}\n\n${topic.markdown.trim()}`;
  });
};

export const getLabelRuleHelpMarkdown: (
  data: ResourceRuleHelpData,
) => string = (data: ResourceRuleHelpData): string => {
  const { singular, plural } = data.nouns;

  return [
    `A label rule adds labels to every ${singular} it matches, so each new ${singular} is labelled without anyone having to remember.`,
    `## How It Works

- A rule runs as each new ${singular} is added, and adds its labels if the ${singular} matches.
- To label the ${plural} you already have, open the rule and select **Run Now**.
- Labels are only ever added. A rule never takes a label away, even when the ${singular} stops matching or the rule is deleted.
- When several rules match, the ${singular} gets the labels of every one of them, and a label it already has is not added twice.
- A disabled rule does not run.
- Label rules run before owner rules, so an owner rule can match a label a label rule has just added.`,
    getMatchCriteriaTopic(data.nouns),
    ...getPageTopics(data.topics),
  ].join("\n\n");
};

export const getOwnerRuleHelpMarkdown: (
  data: ResourceRuleHelpData,
) => string = (data: ResourceRuleHelpData): string => {
  const { singular, plural } = data.nouns;

  return [
    `An owner rule makes people and teams owners of every ${singular} it matches, so each new ${singular} has someone responsible for it from the start.`,
    `## How It Works

- A rule runs as each new ${singular} is added, and adds its owners if the ${singular} matches.
- To add owners to the ${plural} you already have, open the rule and select **Run Now**. You choose there whether the people it adds are told.
- Owners are only ever added. A rule never removes an owner.
- When several rules match, the ${singular} gets the owners of every one of them, and an owner it already has is not added twice.
- A disabled rule does not run.
- Label rules run first, so an owner rule can match a label a label rule has just added.`,
    getMatchCriteriaTopic(data.nouns),
    `## Telling the New Owners

With **Notify Owners** on, the people and teams a rule adds are told they now own the ${singular}. It is on for a new rule, under **More fields** on the rule's **Owners** step. Turn it off to add owners quietly.`,
    ...getPageTopics(data.topics),
  ].join("\n\n");
};
