import Entities from "Common/Models/DatabaseModels/Index";
import {
  ComposedWords,
  composeWords,
  composedWordsOf,
} from "Common/Types/ComposedWords";
import { createTranslator, Translator } from "Common/Types/Translator";
import ComponentMetadata, {
  Argument,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import Components from "Common/Types/Workflow/Components";
import BaseModelComponent, {
  SELECT_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISONS,
  ConditionCompareAsOption,
  ConditionComparison,
} from "Common/Types/Workflow/Components/ConditionComparison";
import { getCreateFromTemplateArgument } from "Common/Types/Workflow/CreateFromTemplate";
import {
  asTheDocsWriteIt,
  dashboardLocale,
  drawnDashboardLabel,
} from "./DocsDashboardLabels";

/*
 * A WORKFLOW STEP'S OWN NAMES, AS EACH LANGUAGE'S DASHBOARD DRAWS THEM
 * (#7511, #8316).
 *
 * The translated docs named what a built-in step defines in English - its
 * outputs (Success, Error, Yes, No, Out), its settings (Incident Template,
 * Message Text, Port, Channel), its choices and the values it returns -
 * because the builder once drew them so. It draws them in the reader's
 * language now, each looked up by its English name in the Dashboard's
 * locale, and English where the locale has no word:
 *   - the canvas card: the step's title and its outputs
 *     (Workflow/Component.tsx), and the run log's "Took" chip;
 *   - the settings form: each setting's name (ArgumentsForm hands arg.name
 *     to FieldLabel) and a Choice setting's choices (ChoiceRows), the If /
 *     Else editor's fields and comparisons (Condition/ConditionEditor), and
 *     the Run Workflow form's fields (RunForm);
 *   - the settings panel's Outputs and Returns lists, the value picker, a
 *     reference's chip and the run log's rows (ReturnValueNames, #8316).
 * Only a Switch / Case's cases keep the names the person gave them.
 *
 * A record step's title is built from its model's name ("On Create
 * Incident"), from a sentence each language words ("On Create
 * {{itemName}}", #8642): the builder reads it as that sentence, the model
 * by the language's own word for it (ComposedWords), and so do these
 * (RECORD_STEP_TITLES, #8708). The docs' "On Create X" for any model's
 * trigger reads as the same sentence, with X for the name.
 *
 * So a docs page names each as its language's Dashboard draws it
 * (drawnStepName). The pages that walk through workflow steps are listed
 * here (WORKFLOW_STEP_PAGES) with the few bold words on them that are
 * another product's, or another screen's, and stay as written.
 */

// What every record step names its settings (Types/Workflow/Components/BaseModel).
const RECORD_STEP_SETTINGS: ReadonlyArray<string> = [
  "Query",
  SELECT_FIELDS_NAME,
  "Skip",
  "Limit",
  "JSON Object",
  "JSON Array",
  "Data (JSON Object)",
  "Fields to watch",
];

// The docs' stand-in for any model's name: "On Create X".
export const ANY_MODEL: string = "X";

/*
 * Every record step's composed names - each title, and a setting's name
 * built from the model's ("Incident ID") - built as the builder builds
 * them, for every model with workflow steps: building them is what makes
 * each one read as its sentence (ComposedWords). And each title's sentence
 * with X for the name, as the docs write a trigger of any model.
 */
function collectRecordStepNames(): {
  titles: Set<string>;
  names: Set<string>;
} {
  const titles: Set<string> = new Set<string>();
  const names: Set<string> = new Set<string>();
  const titleSentences: Set<string> = new Set<string>();

  for (const modelType of Entities) {
    for (const component of BaseModelComponent.getComponents(new modelType())) {
      const composed: ComposedWords | undefined = composedWordsOf(
        component.title,
      );

      if (composed) {
        titles.add(component.title);
        titleSentences.add(composed.template);
      }

      for (const argument of [
        ...(component.arguments as Array<Argument>),
        ...((component.runWorkflowManuallyArguments || []) as Array<Argument>),
      ]) {
        if (composedWordsOf(argument.name)) {
          names.add(argument.name);
        }
      }
    }
  }

  for (const sentence of titleSentences) {
    titles.add(
      composeWords(
        sentence,
        { itemName: ANY_MODEL, itemsName: ANY_MODEL },
        { inSentence: false },
      ),
    );
  }

  for (const title of titles) {
    names.add(title);
  }

  return { titles, names };
}

const RECORD_STEP_NAMES: {
  titles: Set<string>;
  names: Set<string>;
} = collectRecordStepNames();

// Every record step's title, for every model, and with X for any model's.
export const RECORD_STEP_TITLES: ReadonlySet<string> = RECORD_STEP_NAMES.titles;

function collectStepNames(): Set<string> {
  const names: Set<string> = new Set<string>(RECORD_STEP_NAMES.names);

  for (const component of Components as Array<ComponentMetadata>) {
    names.add(component.title);

    for (const argument of [
      ...(component.arguments as Array<Argument>),
      ...((component.runWorkflowManuallyArguments || []) as Array<Argument>),
    ]) {
      names.add(argument.name);

      for (const choice of argument.choices || []) {
        names.add(choice.label);
      }
    }

    for (const port of [
      ...component.inPorts,
      ...component.outPorts,
    ] as Array<Port>) {
      names.add(port.title);
    }

    for (const returnValue of component.returnValues as Array<ReturnValue>) {
      names.add(returnValue.name);
    }
  }

  for (const name of RECORD_STEP_SETTINGS) {
    names.add(name);
  }

  // Create One Incident's template setting (Types/Workflow/CreateFromTemplate).
  const template: Argument | null = getCreateFromTemplateArgument("Incident");

  if (template) {
    names.add(template.name);
  }

  // If / Else's comparisons and its Compare as choices (ConditionEditor).
  for (const comparison of CONDITION_COMPARISONS as Array<ConditionComparison>) {
    names.add(comparison.label);
  }

  for (const option of CONDITION_COMPARE_AS_OPTIONS as Array<ConditionCompareAsOption>) {
    names.add(option.label);
  }

  names.delete("");

  return names;
}

// Every name a built-in step defines: title, settings, choices, ports, values.
export const WORKFLOW_STEP_NAMES: ReadonlySet<string> = collectStepNames();

// The outputs a built-in step defines (a Switch / Case's cases are people's).
export const WORKFLOW_STEP_OUTPUTS: ReadonlySet<string> = new Set<string>(
  (Components as Array<ComponentMetadata>).flatMap(
    (component: ComponentMetadata): Array<string> => {
      return (component.outPorts as Array<Port>).map((port: Port): string => {
        return port.title;
      });
    },
  ),
);

// The built-in steps' titles, and every record step's.
export const WORKFLOW_STEP_TITLES: ReadonlySet<string> = new Set<string>([
  ...(Components as Array<ComponentMetadata>).map(
    (component: ComponentMetadata): string => {
      return component.title;
    },
  ),
  ...RECORD_STEP_TITLES,
]);

const isKey: (name: string) => boolean = (name: string): boolean => {
  return typeof dashboardLocale("en")[name] === "string";
};

/*
 * Whether the Dashboard looks the name up: a key of its English locale, or
 * a record step's name built from a sentence that is one (#8642).
 */
export const isLookedUp: (name: string) => boolean = (
  name: string,
): boolean => {
  if (isKey(name)) {
    return true;
  }

  const composed: ComposedWords | undefined = composedWordsOf(name);

  return Boolean(composed && isKey(composed.template));
};

// The language's Dashboard locale as the builder reads it (useTranslateValue).
const translators: Map<string, Translator> = new Map<string, Translator>();

function translatorOf(language: string): Translator {
  let translator: Translator | undefined = translators.get(language);

  if (!translator) {
    const locale: Record<string, unknown> = dashboardLocale(language);

    translator = createTranslator((text: string): string | undefined => {
      const value: unknown = locale[text];

      return typeof value === "string" && value.trim() ? value : undefined;
    }, language);
    translators.set(language, translator);
  }

  return translator;
}

/*
 * What this language's builder draws for a step's name written in English:
 * the locale's word for it; a record step's title as the language words
 * the sentence it was built from, with the model's own word in it; or the
 * English where it has none.
 */
export const drawnStepName: (language: string, name: string) => string = (
  language: string,
  name: string,
): string => {
  if (language !== "en" && !isKey(name) && composedWordsOf(name)) {
    // With a plain space where the builder sets a no-break one, as a page writes it.
    return asTheDocsWriteIt(translatorOf(language).translateText(name) || name);
  }

  return drawnDashboardLabel(language, name);
};

// Whether a language's builder draws the step's name in other words.
export const isDrawnOtherwise: (language: string, name: string) => boolean = (
  language: string,
  name: string,
): boolean => {
  return (
    WORKFLOW_STEP_NAMES.has(name) &&
    isLookedUp(name) &&
    drawnStepName(language, name) !== name
  );
};

export interface OtherWord {
  // The bold word, as the English page writes it.
  name: string;
  why: string;
  /*
   * Which of the English page's bold occurrences of it are the other
   * product's (0 is the first); all of them when left out.
   */
  occurrences?: ReadonlyArray<number> | undefined;
}

export interface WorkflowStepPage {
  page: string;
  /*
   * Bold words on the page that are also a step's name but are another
   * product's or another screen's word there, which stay as written.
   */
  otherWords?: ReadonlyArray<OtherWord> | undefined;
  // Only these step names are about a workflow step on this page.
  onlyNames?: ReadonlyArray<string> | undefined;
}

const AZURE_SECRET_VALUE: string =
  "The Azure portal's column for a client secret, which Microsoft writes in English.";

// The docs pages that walk through workflow steps.
export const WORKFLOW_STEP_PAGES: ReadonlyArray<WorkflowStepPage> = [
  { page: "workflows/index" },
  { page: "workflows/authoring" },
  { page: "workflows/triggers" },
  { page: "workflows/components" },
  { page: "workflows/variables" },
  { page: "workflows/runs-and-logs" },
  { page: "workflows/configuration" },
  { page: "integrations/index" },
  { page: "integrations/irc" },
  {
    page: "integrations/jira",
    otherWords: [
      { name: "Labels", why: "A Jira issue's field, in the issue JSON." },
      {
        name: "Comment",
        why: "What the workflow does in Jira: a list item named after Jira's action.",
      },
    ],
  },
  { page: "integrations/telegram" },
  { page: "integrations/discord" },
  { page: "integrations/servicenow" },
  { page: "integrations/github" },
  { page: "integrations/gitlab" },
  { page: "integrations/opsgenie" },
  { page: "integrations/pagerduty" },
  {
    page: "integrations/microsoft-dynamics-365",
    otherWords: [
      { name: "Value", why: AZURE_SECRET_VALUE },
      { name: "Note", why: "A Dataverse table, as Dynamics 365 names it." },
      {
        name: "Organization",
        why: "The scope Power Automate's Dataverse trigger offers.",
      },
    ],
  },
  { page: "integrations/prometheus-alertmanager" },
  {
    page: "integrations/grafana",
    otherWords: [
      {
        name: "Webhook",
        why: "Grafana's contact point integration, as Grafana names it.",
        occurrences: [0],
      },
    ],
  },
  {
    page: "integrations/datadog",
    otherWords: [
      { name: "Alert", why: "The Datadog notification sent from a test." },
    ],
  },
  {
    page: "integrations/new-relic",
    otherWords: [
      {
        name: "Webhook",
        why: "New Relic's destination type, as New Relic names it.",
        occurrences: [2, 3],
      },
    ],
  },
  {
    page: "integrations/zabbix",
    otherWords: [
      {
        name: "Webhook",
        why: "Zabbix's media type, as Zabbix names it.",
        occurrences: [2],
      },
    ],
  },
  { page: "integrations/huntress" },
  { page: "incidents/settings" },
  { page: "incidents/declaring-incidents" },
  {
    page: "incidents/notes-owners-and-feed",
    otherWords: [
      {
        name: "Note",
        why: "The Slack and Microsoft Teams note modal, which is not translated.",
      },
    ],
  },
  {
    page: "installation/upgrading",
    onlyNames: ["Incident Template", "Error"],
  },
  { page: "telemetry/ai-agent-circuit-breaker" },
  {
    page: "on-call/incoming-call-policy",
    onlyNames: [
      "Yes",
      "On Create Incoming Call Log",
      "On Update Incoming Call Log",
    ],
  },
  // The pages that name a record step's trigger or action (#8708).
  { page: "incidents/index" },
  {
    page: "incidents/linked-alerts",
    otherWords: [
      {
        name: "Incident",
        why: "Link to Incident's dropdown, and the Permission Reference's group: no step's word there.",
      },
    ],
  },
  { page: "alerts/index" },
  { page: "alerts/settings" },
  { page: "scheduled-maintenance/index" },
  { page: "scheduled-maintenance/creating-events" },
  { page: "scheduled-maintenance/settings" },
  { page: "forms/index" },
  { page: "forms/on-submit" },
  { page: "status-pages/one-status-page-per-audience" },
];

export const WORKFLOW_STEP_PAGE_NAMES: ReadonlyArray<string> =
  WORKFLOW_STEP_PAGES.map((entry: WorkflowStepPage): string => {
    return entry.page;
  });

// The page's entry, for a suite that names a page by its path.
export const workflowStepPage: (
  page: string,
) => WorkflowStepPage | undefined = (
  page: string,
): WorkflowStepPage | undefined => {
  return WORKFLOW_STEP_PAGES.find((entry: WorkflowStepPage): boolean => {
    return entry.page === page;
  });
};

/*
 * Whether a bold word on a page is a step's name there: a name a built-in
 * step defines that the Dashboard looks up, and not one of the page's other
 * products' words. A suite that keeps bold words as written asks this, so
 * it no longer keeps a step's name in English.
 */
export const isStepNameOnPage: (page: string, name: string) => boolean = (
  page: string,
  name: string,
): boolean => {
  const entry: WorkflowStepPage | undefined = workflowStepPage(page);

  if (!entry || !WORKFLOW_STEP_NAMES.has(name) || !isLookedUp(name)) {
    return false;
  }

  if (entry.onlyNames && !entry.onlyNames.includes(name)) {
    return false;
  }

  return !(entry.otherWords || []).some((word: OtherWord): boolean => {
    return word.name === name && !word.occurrences;
  });
};
