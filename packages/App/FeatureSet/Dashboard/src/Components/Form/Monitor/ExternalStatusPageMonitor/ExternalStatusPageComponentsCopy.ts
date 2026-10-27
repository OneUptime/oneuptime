import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import ExternalStatusPageComponentNames from "Common/Utils/Monitor/ExternalStatusPageComponentNames";
import { ExternalStatusPageComponent } from "Common/Utils/Monitor/ExternalStatusPageReading";
import { ExternalStatusPageComponentStatusValue } from "Common/Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import ExternalStatusPageComponentStatusDisplayUtil from "../../../../Utils/ExternalStatusPageComponentStatusDisplay";
import { ExternalStatusPageCatalogProblem } from "../../../../Utils/ExternalStatusPageComponentCatalog";

/*
 * The words of the Components field of an External Status Page monitor
 * (ExternalStatusPageComponentsField), and how a page's components are
 * offered in it. Kept free of React, so its tests and the docs suites read
 * these exact words; each English sentence is a translation key.
 */

export interface ComponentChoiceOptions {
  // The components the page lists outside any group, first, as it does.
  ungrouped: Array<DropdownOption>;
  // Then each group's, under its name, in the page's order.
  groups: Array<DropdownOptionGroup>;
}

/*
 * What the field is for, said as what to do: an empty field watches the
 * whole page, so the help starts from the person's own components.
 */
const DESCRIPTION: string = translationKey(
  "Pick the components you depend on: only their incidents and statuses count. Leave empty to watch the whole page.",
);

// What the description leaves out: names the list does not have, and *.
const TOOLTIP: string = translationKey(
  "Not in the list? Type its name and press Enter. A * stands for any text: *us-east-1* watches every component with us-east-1 in its name. On an RSS or Atom feed, an item counts when its title has one of the names.",
);

// In the product's words for a list on its way: "Loading …", "Could not load …".
const READING: string = translationKey("Loading the components of {{host}}…");

const ADD: string = translationKey("Add “{{name}}”");

const ADD_PATTERN: string = translationKey(
  "Watch every component that matches “{{name}}”",
);

const UNMATCHED: string = translationKey(
  "Not on this page, so not watched: {{names}}",
);

/*
 * With a component group set, a name the page lists in another group is on
 * the page all the same: it is missing from the group.
 */
const UNMATCHED_IN_GROUP: string = translationKey(
  "Not in {{group}}, so not watched: {{names}}",
);

const FEED: string = translationKey(
  "An RSS or Atom feed lists no components. Type words from its items' titles, then press Enter.",
);

const NO_ADDRESS: string = translationKey(
  "Enter the status page URL to pick from its components, or type a name and press Enter.",
);

const TYPE_NAMES: string = translationKey(
  "Type a component's name as the page shows it, then press Enter.",
);

const ALL_CHOSEN: string = translationKey("Every component is chosen.");

const PROBLEMS: Record<ExternalStatusPageCatalogProblem, string> = {
  [ExternalStatusPageCatalogProblem.NotRead]: translationKey(
    "Could not load the components of {{host}}.",
  ),
  [ExternalStatusPageCatalogProblem.NoComponents]: translationKey(
    "{{host}} lists no components to pick from.",
  ),
  [ExternalStatusPageCatalogProblem.TimedOut]: translationKey(
    "{{host}} took too long to answer.",
  ),
  [ExternalStatusPageCatalogProblem.Feed]: FEED,
  [ExternalStatusPageCatalogProblem.NoAddress]: NO_ADDRESS,
};

export default class ExternalStatusPageComponentsCopy {
  public static readonly DESCRIPTION: string = DESCRIPTION;
  public static readonly TOOLTIP: string = TOOLTIP;
  public static readonly READING: string = READING;
  public static readonly UNMATCHED: string = UNMATCHED;
  public static readonly UNMATCHED_IN_GROUP: string = UNMATCHED_IN_GROUP;

  /*
   * A page's components, as the field offers them: by the page's own names,
   * drawn as written, in the page's groups; a component that is not
   * operational says its status, in the words of the Component Status
   * criteria.
   */
  public static getOptions(data: {
    components: Array<ExternalStatusPageComponent>;
    translator: Translator;
  }): ComponentChoiceOptions {
    const ungrouped: Array<DropdownOption> = [];
    const groups: Array<DropdownOptionGroup> = [];
    const groupIndex: Map<string, DropdownOptionGroup> = new Map();
    const seen: Set<string> = new Set();

    for (const component of data.components) {
      const name: string = component.name.trim();
      const groupName: string = (component.groupName || "").trim();
      // One option a name, in a group: two of one name pick the same.
      const identity: string = `${groupName}\u0000${ExternalStatusPageComponentNames.comparable(name)}`;

      if (!name || seen.has(identity)) {
        continue;
      }

      seen.add(identity);

      const option: DropdownOption = {
        value: name,
        label: name,
        isUserContent: true,
      };

      if (
        component.status &&
        component.status !== ExternalStatusPageComponentStatusValue.Operational
      ) {
        option.description =
          ExternalStatusPageComponentStatusDisplayUtil.getDisplay(
            component.status,
          ).label;
      }

      if (!groupName) {
        ungrouped.push(option);
        continue;
      }

      let group: DropdownOptionGroup | undefined = groupIndex.get(groupName);

      if (!group) {
        group = { label: groupName, options: [] };
        groupIndex.set(groupName, group);
        groups.push(group);
      }

      group.options.push(option);
    }

    return { ungrouped: ungrouped, groups: groups };
  }

  // The menu's row that adds what was typed.
  public static addLabel(translator: Translator, name: string): string {
    return translator.translateTemplate(
      ExternalStatusPageComponentNames.isPattern(name) ? ADD_PATTERN : ADD,
      { name: name },
    );
  }

  // What was read: how many components the page offers, and where.
  public static readSentence(data: {
    translator: Translator;
    count: number;
    host: string;
    componentGroupName?: string | undefined;
  }): string {
    if (data.componentGroupName) {
      return data.translator.translatePlural(
        {
          one: "{{count}} component in {{group}} on {{host}}.",
          other: "{{count}} components in {{group}} on {{host}}.",
        },
        data.count,
        { group: data.componentGroupName, host: data.host },
      );
    }

    return data.translator.translatePlural(
      {
        one: "{{count}} component on {{host}}.",
        other: "{{count}} components on {{host}}.",
      },
      data.count,
      { host: data.host },
    );
  }

  // Whether reading the page again may help.
  public static canTryAgain(
    problem: ExternalStatusPageCatalogProblem,
  ): boolean {
    return (
      problem === ExternalStatusPageCatalogProblem.NotRead ||
      problem === ExternalStatusPageCatalogProblem.TimedOut
    );
  }

  // Why the page's components could not be read.
  public static problemSentence(
    translator: Translator,
    problem: ExternalStatusPageCatalogProblem,
    host: string,
  ): string {
    return translator.translateTemplate(PROBLEMS[problem], { host: host });
  }

  /*
   * Why the page's components could not be read, then what to do: two
   * sentences, each whole in one language.
   */
  public static failureMessage(
    translator: Translator,
    problem: ExternalStatusPageCatalogProblem,
    host: string,
  ): string {
    return `${ExternalStatusPageComponentsCopy.problemSentence(
      translator,
      problem,
      host,
    )} ${ExternalStatusPageComponentsCopy.typeNamesMessage(translator)}`;
  }

  public static feedMessage(translator: Translator): string {
    return translator.translateTemplate(FEED);
  }

  public static noAddressMessage(translator: Translator): string {
    return translator.translateTemplate(NO_ADDRESS);
  }

  public static typeNamesMessage(translator: Translator): string {
    return translator.translateTemplate(TYPE_NAMES);
  }

  public static allChosenMessage(translator: Translator): string {
    return translator.translateTemplate(ALL_CHOSEN);
  }
}
