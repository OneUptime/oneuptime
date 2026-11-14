import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Home's words for Setup health (#6812): the Setup section that ends
 * "Needs attention" while something in the setup needs a look. Kept apart
 * from the page's words (SetupHealthWords), so Home loads only these.
 */
export const SETUP_HEALTH_HOME_WORDS: Readonly<{
  group: string;
  line: PluralTemplate;
}> = {
  group: translationKey("Setup"),
  line: {
    one: "{{count}} thing in your setup needs a look.",
    other: "{{count}} things in your setup need a look.",
  },
};
