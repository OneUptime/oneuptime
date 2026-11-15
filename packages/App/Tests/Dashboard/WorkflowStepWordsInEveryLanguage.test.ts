// UX rule: Docs/ux/README.md#in-every-language
import {
  ExtractedString,
  SOURCE_ROOTS,
  SourceRoot,
  scanSourceRoots,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "Common/Tests/Helpers/DashboardLocales";
import ComponentMetadata, {
  Argument,
  ArgumentChoice,
  ComponentCategory,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components, { Categories } from "Common/Types/Workflow/Components";
import BaseModelComponent from "Common/Types/Workflow/Components/BaseModel";
import { FROM_ANOTHER_TOOL_KINDS } from "Common/Types/Workflow/Components/FromAnotherTool";
import {
  WHAT_HAPPENED_ID,
  WhatHappened,
} from "Common/Types/Workflow/CreateOrUpdateTrigger";
import { ComposedWords, composedWordsOf } from "Common/Types/ComposedWords";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY WORD OF A BUILT-IN WORKFLOW STEP, IN EVERY LANGUAGE (#8359).
 *
 * The builder looks every word of a built-in step up as it draws it - the
 * canvas card's title, what the step does and its outputs, the settings
 * form's names, help and choices, the Outputs and Returns lists, the value
 * picker, a reference's chip and the run log - but the step catalogue
 * (Common/Types/Workflow/Components) was never extracted. A word read in
 * the reader's language only where another page happened to use the same
 * English, so most of the builder drew English in every language: API
 * Post's Returns read "Fehler, Response Status, Antwort-Header,
 * Antworttext" in German, and the IRC step's form mixed "IRC Server" and
 * "Nickname" with "Kanal" and "Port".
 *
 * The catalogue marks each word it draws with translationKey() and is a
 * "keys" root of the extractor, so ids, the references a workflow stores
 * ({{local.components...}}), example values and a Switch / Case's cases
 * stay as written. These hold every word to a key of en.json, worded in
 * every language - or kept as written on purpose, on a same-as-English list
 * (a product's name, "JSON 1") - and hold the catalogue itself to marking
 * every word a step draws, so a step added later is translated with it.
 */

const CATALOGUE_ROOTS: Array<SourceRoot> = [
  { directory: "packages/Common/Types/Workflow/Components", kind: "keys" },
  { directory: "packages/Common/Types/Workflow/Components.ts", kind: "keys" },
  {
    directory: "packages/Common/Types/Workflow/AffectedResourcesSetting.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Workflow/CreateFromTemplate.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Workflow/OwnersOnCreateSetting.ts",
    kind: "keys",
  },
];

const LETTER: RegExp = /\p{L}/u;

// What an id has and a word has not: "request-body", "page_as".
const ID_SEPARATOR: RegExp = /[-_]/;

/*
 * The line a setting's help is drawn in, on the settings form
 * (ArgumentsForm's REQUIRED_ARGUMENT_HELP and OPTIONAL_ARGUMENT_HELP).
 */
const REQUIRED_ARGUMENT_HELP: string = "Required. {{description}}";
const OPTIONAL_ARGUMENT_HELP: string = "Optional. {{description}}";

const ARGUMENTS_FORM: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../Common/UI/Components/Workflow/ArgumentsForm.tsx",
  ),
  "utf8",
);

const ENGLISH: Record<string, string> = readDashboardLocale("en");

// Every key the catalogue marks, once each, with the file that marks it.
function catalogueKeys(): Map<string, string> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(CATALOGUE_ROOTS)
    .strings as Array<ExtractedString>) {
    if (!keys.has(entry.text)) {
      keys.set(entry.text, entry.file);
    }
  }

  return keys;
}

const CATALOGUE_KEYS: Map<string, string> = catalogueKeys();

interface DrawnWord {
  text: string;
  where: string;
}

/*
 * Every word the builder draws for one step: its title and what it does,
 * the group it is listed under, each setting's name, help and choices,
 * each output's name and help, and each returned value's name and what it
 * holds. A placeholder is an example of what to type, and stays as written
 * (the prose ones are marked too, and read through PROSE_PLACEHOLDERS).
 */
function drawnWordsOf(component: ComponentMetadata): Array<DrawnWord> {
  const words: Array<DrawnWord> = [];
  const add: (text: string | undefined, where: string) => void = (
    text: string | undefined,
    where: string,
  ): void => {
    if (text && LETTER.test(text)) {
      words.push({ text, where: `${component.id}: ${where}` });
    }
  };

  add(component.title, "title");
  add(component.description, "description");
  add(component.category, "category");

  for (const argument of [
    ...(component.arguments as Array<Argument>),
    ...((component.runWorkflowManuallyArguments || []) as Array<Argument>),
  ]) {
    add(argument.name, `${argument.id}: name`);
    add(argument.description, `${argument.id}: description`);

    for (const choice of (argument.choices || []) as Array<ArgumentChoice>) {
      add(choice.label, `${argument.id}: choice ${choice.value}`);
      add(choice.description, `${argument.id}: choice ${choice.value} help`);
    }
  }

  for (const port of [
    ...component.inPorts,
    ...component.outPorts,
  ] as Array<Port>) {
    add(port.title, `port ${port.id}`);
    add(port.description, `port ${port.id} help`);
  }

  for (const returnValue of component.returnValues as Array<ReturnValue>) {
    add(returnValue.name, `returns ${returnValue.id}`);
    add(returnValue.description, `returns ${returnValue.id} help`);
  }

  return words;
}

const CATALOGUE: Array<ComponentMetadata> =
  Components as Array<ComponentMetadata>;

const DRAWN_WORDS: Array<DrawnWord> = [
  ...CATALOGUE.flatMap(drawnWordsOf),
  ...(Categories as Array<ComponentCategory>).flatMap(
    (category: ComponentCategory): Array<DrawnWord> => {
      return [
        { text: category.name, where: `group ${category.name}` },
        { text: category.description, where: `group ${category.name} help` },
      ];
    },
  ),
];

// The placeholders that are a sentence, not an example of what to type.
const PROSE_PLACEHOLDERS: ReadonlyArray<string> = [
  "Pick a value with { } or paste an ID",
  "The ID in the address of the cloud's page",
  "Select a workflow",
  "The project's second most severe",
  "The project's third most severe",
];

// What a record step names its settings, outputs and counts, for any model.
const RECORD_STEP_NAMES: ReadonlyArray<string> = [
  "Query",
  "Fields to pass on",
  "Skip",
  "Limit",
  "JSON Object",
  "JSON Array",
  "Data (JSON Object)",
  "Fields to watch",
  "Items Deleted",
  "Items Updated",
  "In",
  "Success",
  "Error",
];

/*
 * What stays as written in every language, on the Dashboard's
 * same-as-English list: a product's or a protocol's name, and the names
 * that only number what they hold.
 */
const KEPT_AS_WRITTEN: ReadonlyArray<{ text: string; why: string }> = [
  { text: "Discord", why: "The product's name: the Discord step's group." },
  { text: "IRC", why: "The protocol's name: the IRC step's group." },
  { text: "Zabbix", why: "The product's name: the Zabbix step's group." },
  {
    text: "Zabbix 6.0",
    why: "A version of Zabbix: the setting is on for that version.",
  },
  {
    text: "JSON 1",
    why: "Merge JSON's first object: a format's name and a number.",
  },
  {
    text: "JSON 2",
    why: "Merge JSON's second object: a format's name and a number.",
  },
];

/*
 * A record step's words are built from its model's name (#8642): each is a
 * sentence the catalogue marks, with the name in it ("Find One
 * {{itemName}}"), and the English built from it is remembered as built
 * from that sentence (ComposedWords), so the builder reads it in the
 * reader's language. The models these build them for, plural names and
 * names of two words among them.
 */
const RECORD_MODELS: Array<DatabaseBaseModel> = [
  new Incident(),
  new Alert(),
  new Monitor(),
  new StatusPage(),
];

const MODEL_NAME: RegExp = /\{\{(itemName|itemsName)\}\}/;
const PLACEHOLDERS: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

function modelCase(model: DatabaseBaseModel): {
  name: string;
  model: DatabaseBaseModel;
} {
  return { name: model.singularName || model.tableName || "", model };
}

// The words a record step draws that are neither a key, its name, nor built from a marked sentence.
function unmarkedRecordStepWords(
  model: DatabaseBaseModel,
  steps: Array<ComponentMetadata> = BaseModelComponent.getComponents(model),
): Array<string> {
  const names: Array<string | null | undefined> = [
    model.singularName,
    model.pluralName,
  ];

  return steps
    .flatMap(drawnWordsOf)
    .filter((word: DrawnWord): boolean => {
      if (CATALOGUE_KEYS.has(word.text) || names.includes(word.text)) {
        return false;
      }

      const composed: ComposedWords | undefined = composedWordsOf(word.text);

      return !(composed && CATALOGUE_KEYS.has(composed.template));
    })
    .map((word: DrawnWord): string => {
      return `${word.where}: ${word.text}`;
    });
}

// The sentences a model's record steps are built from, once each.
function recordStepSentences(model: DatabaseBaseModel): Array<string> {
  const sentences: Set<string> = new Set<string>();

  for (const word of BaseModelComponent.getComponents(model).flatMap(
    drawnWordsOf,
  )) {
    const composed: ComposedWords | undefined = composedWordsOf(word.text);

    if (composed) {
      sentences.add(composed.template);
    }
  }

  return Array.from(sentences);
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDERS) || []).sort();
}

function unwordedIn(language: string, keys: Iterable<string>): Array<string> {
  return Array.from(keys).filter((key: string): boolean => {
    return !isWordedInDashboardLocale(key, language);
  });
}

describe("the step catalogue's words are keys", () => {
  test("the catalogue is a keys root of the extractor", () => {
    for (const root of CATALOGUE_ROOTS) {
      expect(
        SOURCE_ROOTS.some((entry: SourceRoot): boolean => {
          return entry.directory === root.directory && entry.kind === root.kind;
        }),
      ).toBe(true);
    }
  });

  test("it marks hundreds of words, each a key of en.json", () => {
    expect(CATALOGUE_KEYS.size).toBeGreaterThan(500);
    expect(
      Array.from(CATALOGUE_KEYS.keys()).filter((key: string): boolean => {
        return typeof ENGLISH[key] !== "string";
      }),
    ).toEqual([]);
  });

  test("the names #8359 found drawn in English are among them", () => {
    for (const name of [
      // Step titles.
      "Send Message to Slack",
      "If / Else",
      "Switch / Case",
      "API Post (JSON)",
      "Run Custom JavaScript",
      "Page Users",
      "Incident From Another Tool",
      // Settings.
      "Fields to pass on",
      "Limit",
      "Page About",
      "Outside ID",
      "IRC Server",
      "Nickname",
      "SASL Password",
      "Teams Incoming Webhook URL",
      // Returned values.
      "Paged Users",
      "Response Status",
      "Received At",
      "Items Deleted",
      // Choices and outputs.
      "A new alert",
      "An incident",
      "Execute",
    ]) {
      expect({ name, key: CATALOGUE_KEYS.has(name) }).toEqual({
        name,
        key: true,
      });
    }
  });

  test("every word a built-in step draws is marked, so a step added later is translated with it", () => {
    expect(DRAWN_WORDS.length).toBeGreaterThan(700);
    expect(
      DRAWN_WORDS.filter((word: DrawnWord): boolean => {
        return !CATALOGUE_KEYS.has(word.text);
      }).map((word: DrawnWord): string => {
        return `${word.where}: ${word.text}`;
      }),
    ).toEqual([]);
  });

  test("the incident and the alert step say each sentence for their own kind", () => {
    for (const kind of FROM_ANOTHER_TOOL_KINDS) {
      const step: ComponentMetadata = CATALOGUE.find(
        (component: ComponentMetadata): boolean => {
          return component.id === kind.componentId;
        },
      ) as ComponentMetadata;

      expect(step.title).toBe(`${kind.Noun} From Another Tool`);

      for (const word of drawnWordsOf(step)) {
        expect({ word: word.text, key: CATALOGUE_KEYS.has(word.text) }).toEqual(
          { word: word.text, key: true },
        );
      }
    }
  });

  test("a record step's fixed names are keys too", () => {
    const names: Set<string> = new Set<string>(
      BaseModelComponent.getComponents(new Incident()).flatMap(
        (component: ComponentMetadata): Array<string> => {
          return drawnWordsOf(component).map((word: DrawnWord): string => {
            return word.text;
          });
        },
      ),
    );

    for (const name of RECORD_STEP_NAMES) {
      expect({ name, drawn: names.has(name) }).toEqual({ name, drawn: true });
      expect({ name, key: CATALOGUE_KEYS.has(name) }).toEqual({
        name,
        key: true,
      });
    }
  });

  test.each(RECORD_MODELS.map(modelCase))(
    "every word $name's record steps draw is a key, its name, or a sentence with its name in it (#8642)",
    ({ model }: { model: DatabaseBaseModel }) => {
      expect(
        BaseModelComponent.getComponents(model).flatMap(drawnWordsOf).length,
      ).toBeGreaterThan(80);
      expect(unmarkedRecordStepWords(model)).toEqual([]);
    },
  );

  test("a record step's words are built from sentences that name the model, as English always read", () => {
    const sentences: Array<string> = recordStepSentences(new Incident());

    expect(sentences.length).toBeGreaterThan(40);

    for (const sentence of sentences) {
      expect({ sentence, named: MODEL_NAME.test(sentence) }).toEqual({
        sentence,
        named: true,
      });
    }

    const titles: Array<string> = BaseModelComponent.getComponents(
      new Incident(),
    ).map((component: ComponentMetadata): string => {
      return component.title;
    });

    expect(titles).toEqual(
      expect.arrayContaining([
        "Find One Incident",
        "Find Many Incidents",
        "On Create Incident",
        "On Create or Update Incident",
        "Delete Many Incidents",
      ]),
    );
    expect(composedWordsOf("Find Many Incidents")).toEqual({
      template: "Find Many {{itemsName}}",
      terms: { itemName: "Incident", itemsName: "Incidents" },
      inSentence: false,
    });
    expect(composedWordsOf("Database query to find one Incident")).toEqual({
      template: "Database query to find one {{itemName}}",
      terms: { itemName: "Incident", itemsName: "Incidents" },
      inSentence: true,
    });
  });

  test("What Happened's help names the two values the trigger hands on", () => {
    const trigger: ComponentMetadata = BaseModelComponent.getComponents(
      new Incident(),
    ).find((component: ComponentMetadata): boolean => {
      return component.title === "On Create or Update Incident";
    }) as ComponentMetadata;
    const whatHappened: ReturnValue = trigger.returnValues.find(
      (returnValue: ReturnValue): boolean => {
        return returnValue.id === WHAT_HAPPENED_ID;
      },
    ) as ReturnValue;

    expect(whatHappened.description).toBe(
      `"${WhatHappened.Created}" for a new Incident, "${WhatHappened.Updated}" for a change to one.`,
    );
  });

  test("a placeholder that is a sentence is a key, and one that shows what to type is not", () => {
    for (const placeholder of PROSE_PLACEHOLDERS) {
      expect({ placeholder, key: CATALOGUE_KEYS.has(placeholder) }).toEqual({
        placeholder,
        key: true,
      });
    }

    for (const example of [
      "https://api.yourcompany.com",
      "irc.libera.chat",
      "#ops",
      "Test Slack message from OneUptime",
      '{"key1": "value1", "key2": "value2"}',
      "{{local.components.alert-on-create-1.returnValues.model._id}}",
    ]) {
      expect({ example, key: CATALOGUE_KEYS.has(example) }).toEqual({
        example,
        key: false,
      });
    }
  });

  test("the settings form draws a setting's help in the lines these check", () => {
    for (const line of [REQUIRED_ARGUMENT_HELP, OPTIONAL_ARGUMENT_HELP]) {
      expect(ARGUMENTS_FORM).toContain(`"${line}"`);
      expect(ENGLISH[line]).toBe(line);
    }

    expect(ARGUMENTS_FORM).toContain(
      "{ description: translatableTerm(arg.description) }",
    );
  });

  test("ids and the references a workflow stores are not keys", () => {
    const ids: Array<string> = CATALOGUE.flatMap(
      (component: ComponentMetadata): Array<string> => {
        return [
          component.id,
          ...(component.arguments as Array<Argument>).map(
            (argument: Argument): string => {
              return argument.id;
            },
          ),
        ];
      },
    ).filter((id: string): boolean => {
      // A few ids read as a word too ("json", "text"); a key of their own is not this one.
      return ID_SEPARATOR.test(id);
    });

    expect(ids.length).toBeGreaterThan(50);
    expect(
      ids.filter((id: string): boolean => {
        return CATALOGUE_KEYS.has(id);
      }),
    ).toEqual([]);
    expect(CATALOGUE_KEYS.has(ComponentID.ApiPost)).toBe(false);
  });
});

describe("what stays as written", () => {
  test.each(KEPT_AS_WRITTEN)(
    "$text is on the Dashboard's same-as-English list: $why",
    (word: { text: string; why: string }) => {
      expect(CATALOGUE_KEYS.has(word.text)).toBe(true);
      expect(word.why.length).toBeGreaterThan(10);

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          kept: readDashboardSameAsEnglish(language).includes(word.text),
        }).toEqual({ language, kept: true });
      }
    },
  );
});

describe.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
  test("words every word of the step catalogue", () => {
    expect(unwordedIn(language, CATALOGUE_KEYS.keys())).toEqual([]);
  });

  /*
   * A setting's help is drawn inside one of these: a language that words
   * the help but not the line around it reads the whole line in English.
   */
  test("words the line every setting's help is drawn in", () => {
    expect(
      unwordedIn(language, [REQUIRED_ARGUMENT_HELP, OPTIONAL_ARGUMENT_HELP]),
    ).toEqual([]);
  });

  test("words every sentence a record step is built from, the model's name still in it (#8642)", () => {
    const locale: Record<string, string> = readDashboardLocale(language);
    const sentences: Array<string> = recordStepSentences(new Incident());

    expect(unwordedIn(language, sentences)).toEqual([]);

    for (const sentence of sentences) {
      expect({
        sentence,
        placeholders: placeholdersOf(locale[sentence] || ""),
      }).toEqual({ sentence, placeholders: placeholdersOf(sentence) });
    }
  });

  test("words the step names #8359 found in English its own way", () => {
    const locale: Record<string, string> = readDashboardLocale(language);

    for (const name of [
      "Send Message to Slack",
      "If / Else",
      "API Post (JSON)",
      "Response Status",
      "IRC Server",
      "Fields to pass on",
      "Paged Users",
      "Page About",
    ]) {
      expect({ name, worded: locale[name] !== name }).toEqual({
        name,
        worded: true,
      });
    }
  });
});

describe("the check itself", () => {
  test("finds a word set back to English, and leaves a kept name alone", () => {
    const locale: Record<string, string> = readDashboardLocale("de");
    const was: string | undefined = locale["Response Status"];

    expect(was).toBe("Antwortstatus");

    try {
      locale["Response Status"] = "Response Status";
      expect(unwordedIn("de", ["Response Status", "Zabbix"])).toEqual([
        "Response Status",
      ]);
    } finally {
      locale["Response Status"] = was as string;
    }

    expect(unwordedIn("de", ["Response Status"])).toEqual([]);
  });

  test("finds a record step's word built from the name with no sentence of its own", () => {
    const incident: Incident = new Incident();
    const step: ComponentMetadata = BaseModelComponent.getComponents(
      incident,
    )[0] as ComponentMetadata;
    const unmarked: ComponentMetadata = {
      ...step,
      title: `Find Every ${incident.singularName}`,
    };

    expect(unmarkedRecordStepWords(incident, [step])).toEqual([]);
    expect(unmarkedRecordStepWords(incident, [unmarked])).toEqual([
      `${step.id}: title: Find Every Incident`,
    ]);
  });

  test("finds a step word the catalogue does not mark", () => {
    const unmarked: ComponentMetadata = {
      ...(CATALOGUE[0] as ComponentMetadata),
      title: "A step nobody marked",
    };

    expect(
      drawnWordsOf(unmarked)
        .filter((word: DrawnWord): boolean => {
          return !CATALOGUE_KEYS.has(word.text);
        })
        .map((word: DrawnWord): string => {
          return word.text;
        }),
    ).toEqual(["A step nobody marked"]);
  });
});
