import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The full guides' titles and lines, which the How it works card looks up
 * when it opens a guide. The guides keep plain strings - they stay free of
 * Common/UI, so App's tests load them without the UI (App
 * SecurityEventsHowItWorksWiring) - and the extractor finds a string by the
 * property it is in, which guideTitle and guideDescription are not: these
 * only put the same words in the locale files. A test holds the two
 * together (Common/Tests/App/Dashboard/SecurityEventsHowItWorksInLocale).
 */
export const SECURITY_EVENTS_GUIDE_TITLES: Record<
  string,
  { title: string; description: string }
> = {
  "detection-rules": {
    title: translationKey("Detection Rules Guide"),
    description: translationKey(
      "How Sigma rules are evaluated, counted and turned into alerts — and how to write them.",
    ),
  },
  "threat-intel": {
    title: translationKey("Threat Intel Guide"),
    description: translationKey(
      "Where feeds come from, how indicators reach your events, and how confidence becomes a threat level.",
    ),
  },
  "entity-risk": {
    title: translationKey("Entity Risk Guide"),
    description: translationKey(
      "What adds to an entity's risk, how its score is counted and weighed, and when it opens a case.",
    ),
  },
};

/*
 * The Entity Risk guide's sentences and labels (EntityRiskGuide.ts), for the
 * same reason: the guide is built from the project's threshold at run time,
 * out of reach of the extractor, so these put its words in the locale files.
 */
export const ENTITY_RISK_GUIDE_WORDS: Array<string> = [
  translationKey("How entity risk works"),
  translationKey(
    "Everything found about one user, host or address adds up to its risk. The riskiest come first, and one that reaches the threshold opens a case.",
  ),
  translationKey("Findings add points"),
  translationKey(
    "Each finding adds points to the user, host or address it is about: {{low}} for Low, {{medium}} for Medium, {{high}} for High and {{critical}} for Critical, or the rule's own Risk Points.",
  ),
  translationKey("Each source counts once"),
  translationKey(
    "A detection rule, a threat intel feed or a product's rule counts once in {{days}} days, at the most it added, however often it fires. Different sources add up.",
  ),
  translationKey("What matters more counts more"),
  translationKey(
    "Entity Criticality weighs the score: Low counts it ×{{low}}, High ×{{high}}, Extreme ×{{extreme}}.",
  ),
  translationKey("At the threshold, a case opens"),
  translationKey(
    "When the risk from sources new since its last risk case reaches {{threshold}}, a case opens about the entity - or its open case takes the risk in.",
  ),
  translationKey("Risk levels"),
  translationKey("What each level means"),
  translationKey(
    "What a score reads as against the project's threshold. From High up, a case opens.",
  ),
  translationKey("{{from}} to {{to}}"),
  translationKey("{{from}} or more"),
  translationKey("Risk Points"),
  translationKey("Levels and Cases"),
  translationKey("Criticality"),
];
