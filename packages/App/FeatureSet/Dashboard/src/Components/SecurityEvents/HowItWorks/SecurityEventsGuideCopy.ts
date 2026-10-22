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
};
