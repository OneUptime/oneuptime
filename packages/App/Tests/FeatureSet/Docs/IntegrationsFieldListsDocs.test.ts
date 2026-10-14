import {
  ADD_FIELD,
  EDIT_AS_JSON,
  FIELD_LIST_SETTINGS,
  FieldListInstruction,
  FieldListJson,
  FieldPick,
  TriggerReference,
  boldSpansOf,
  codeSpansOf,
  fieldListInstructions,
  fieldListJsonBeforeEditAsJson,
  fieldListJsonOn,
  isFieldListJson,
  isPassedOn,
  modeOf,
  newTriggerFields,
  pickedField,
  pickerFields,
  recordComponent,
  schemaColumns,
  sectionsAround,
  storedFieldPaths,
  triggerComponentId,
  triggerOfLine,
  triggerReferences,
} from "./IntegrationsFieldLists";
import { DYNAMICS, JIRA } from "./IntegrationsDocsPages";
import {
  DOCS_LANGUAGES,
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { englishPage, readRepoFile } from "./InventoryAndApiDocsSupport";
import Incident from "Common/Models/DatabaseModels/Incident";
import { JSONObject } from "Common/Types/JSON";
import ComponentMetadata, { Argument } from "Common/Types/Workflow/Component";
import {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  getTemplateGraphSpec,
  getWorkflowTemplates,
  WorkflowTemplate,
} from "Common/Types/Workflow/Templates";
import { getWatchedColumns } from "Common/Types/Workflow/WatchedFields";
import {
  ChosenFields,
  FieldOption,
  FieldPickerMode,
  readChosenFields,
} from "Common/UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { ModelSchemaColumn } from "Common/UI/Components/Workflow/ModelSchema";
import { describe, expect, it } from "@jest/globals";

/*
 * The integration guides build a record trigger's two field lists the way
 * the Builder draws them, in every docs language.
 *
 * Since #4779, Fields to pass on and Fields to watch are chips picked from
 * Add field's list, with Edit as JSON behind them for anyone who wants the
 * JSON. The Jira and Microsoft Dynamics 365 guides still gave both as JSON
 * - `{"_id": true, "title": true, ...}` - which only goes in after Edit as
 * JSON, and they never said so; Opsgenie, PagerDuty and ServiceNow gave the
 * resolved check that way, and every guide named fields by their keys
 * (`title`, `currentIncidentStateId`), which the list never shows.
 *
 * Held here, for every integrations page, in English and in every
 * translation:
 *
 *   - a field a guide picks is one the list offers, under the name the list
 *     gives it - its own field, or a related record's field under the
 *     record it is opened from - in the list it is picked in (Fields to
 *     watch offers less than Fields to pass on); what a new trigger starts
 *     with is what the Builder gives it;
 *   - a line that builds a field list names no field by its key;
 *   - JSON for a field list comes only after Edit as JSON, and reads, as
 *     the list reads it, as the very fields the guide picks;
 *   - every field a later step reads of a trigger's record is one the guide
 *     has the trigger pass on (or the template the section names does);
 *   - a translation names the buttons and fields on the English line's own
 *     line, as its language's Dashboard draws them.
 *
 * The fields come from the real /model-schema endpoint and the picker's own
 * rules (FieldPickerOptions), so a renamed or regrouped field fails here,
 * on the guide that names it.
 */

const INTEGRATIONS: string = "integrations/";

// Every integrations page, by its English page.
const PAGES: Array<string> = listPages("en").filter((page: string): boolean => {
  return page.startsWith(INTEGRATIONS);
});

// The pages that build a field list.
const BUILDING_PAGES: Array<string> = PAGES.filter((page: string): boolean => {
  return fieldListInstructions(englishPage(page)).length > 0;
});

/*
 * OnTriggerBaseModel reads the record with the ID and every field passed
 * on: `select: { _id: true, ...select }`.
 */
const ALWAYS_SELECTS_ID: RegExp =
  /select:\s*\{\s*_id:\s*true,\s*\.\.\.select,?\s*\}/;
const ID_ALWAYS_PASSED_ON: string = "The ID is always passed on.";

function argumentNames(metadata: ComponentMetadata): Array<string> {
  return metadata.arguments.map((argument: Argument): string => {
    return argument.name;
  });
}

function bold(text: string): string {
  return `**${text}**`;
}

/*
 * The record step a field list belongs to: the trigger the steps around it
 * read, else the trigger the line names.
 */
function stepOf(
  page: string,
  instruction: FieldListInstruction,
): ComponentMetadata {
  const markdown: string = englishPage(page);
  const trigger: string | null = triggerOfLine(markdown, instruction.line);

  if (trigger) {
    return recordComponent(triggerComponentId(trigger));
  }

  const line: string = markdown.split("\n")[instruction.line - 1] as string;

  for (const span of boldSpansOf(line)) {
    try {
      return recordComponent(span);
    } catch {
      // Not a record step's name: another button or field.
    }
  }

  throw new Error(
    `${page}:${instruction.line} builds a field list for no trigger it names`,
  );
}

// The labels a field list's line names as the picker draws them.
function pickerLabels(instruction: FieldListInstruction): Array<string> {
  const labels: Array<string> = [...instruction.startsWith];

  if (instruction.addsFields) {
    labels.push(ADD_FIELD);
  }

  for (const pick of instruction.picks) {
    if (pick.relation) {
      labels.push(pick.relation);
    }

    labels.push(pick.label);
  }

  if (instruction.editAsJson) {
    labels.push(EDIT_AS_JSON);
  }

  return labels;
}

interface ResolvedInstruction {
  instruction: FieldListInstruction;
  step: ComponentMetadata;
  // The trigger's identifier the steps around it read, if any.
  trigger: string | null;
  options: Array<FieldOption>;
  // What it starts with and what it picks, as the list stores them.
  startsWith: Array<string | null>;
  picks: Array<string | null>;
}

async function resolved(page: string): Promise<Array<ResolvedInstruction>> {
  const markdown: string = englishPage(page);
  const found: Array<ResolvedInstruction> = [];

  for (const instruction of fieldListInstructions(markdown)) {
    const step: ComponentMetadata = stepOf(page, instruction);
    const options: Array<FieldOption> = await pickerFields(
      step.tableName as string,
      instruction.setting,
    );

    found.push({
      instruction: instruction,
      step: step,
      trigger: triggerOfLine(markdown, instruction.line),
      options: options,
      startsWith: instruction.startsWith.map((label: string) => {
        return pickedField(options, { label })?.path || null;
      }),
      picks: instruction.picks.map((pick: FieldPick) => {
        return pickedField(options, pick)?.path || null;
      }),
    });
  }

  return found;
}

/*
 * The field lists a page writes as JSON with nothing before them saying
 * Edit as JSON, as the page's language draws it: "line: JSON".
 */
function jsonWithoutEditAsJson(language: string, page: string): Array<string> {
  return fieldListJsonBeforeEditAsJson(
    readPage(language, page),
    drawnActionLabel(language, EDIT_AS_JSON),
  );
}

describe("the field lists, as the guides name them", () => {
  it("are named as the record triggers name them, with Add field and Edit as JSON as the list draws them", () => {
    const picker: string = readRepoFile(
      "Common/UI/Components/Workflow/ModelFieldPicker.tsx",
    );

    expect(SELECT_FIELDS_NAME).toBe("Fields to pass on");
    expect(WATCHED_FIELDS_NAME).toBe("Fields to watch");
    expect(FIELD_LIST_SETTINGS).toEqual([
      SELECT_FIELDS_NAME,
      WATCHED_FIELDS_NAME,
    ]);
    expect(picker).toContain(`addField: translationKey("${ADD_FIELD}")`);
    expect(picker).toContain(`editAsJson: translationKey("${EDIT_AS_JSON}")`);
    // On Create passes a record on; On Update watches it too.
    expect(argumentNames(recordComponent("incident-on-create"))).toEqual([
      SELECT_FIELDS_NAME,
    ]);
    expect(argumentNames(recordComponent("incident-on-update"))).toEqual([
      WATCHED_FIELDS_NAME,
      SELECT_FIELDS_NAME,
    ]);
    expect(recordComponent("On Create Alert").id).toBe("alert-on-create");
  });

  it("a new trigger passes on the field that names its record, which the list calls Title for incidents and alerts", async () => {
    for (const [step, table] of [
      ["incident-on-create", "Incident"],
      ["incident-on-update", "Incident"],
      ["alert-on-create", "Alert"],
    ] as Array<[string, string]>) {
      const options: Array<FieldOption> = await pickerFields(
        table,
        SELECT_FIELDS_NAME,
      );

      expect(newTriggerFields(step)).toEqual(["title"]);
      expect(pickedField(options, { label: "Title" })?.path).toBe("title");
    }
  });

  it("passes the record's ID on whatever is picked, as the Jira and Dynamics 365 guides say", () => {
    expect(
      readRepoFile(
        "Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts",
      ),
    ).toMatch(ALWAYS_SELECTS_ID);

    for (const page of [JIRA, DYNAMICS]) {
      expect(englishPage(page)).toContain(ID_ALWAYS_PASSED_ON);
    }
  });

  it("offers the project's ID to pass on, which the Jira guide's link back to the incident is built from, and never to watch", async () => {
    const passOn: Array<FieldOption> = await pickerFields(
      "Incident",
      SELECT_FIELDS_NAME,
    );
    const watch: Array<FieldOption> = await pickerFields(
      "Incident",
      WATCHED_FIELDS_NAME,
    );
    const columns: Array<ModelSchemaColumn> = await schemaColumns("Incident");

    // The endpoint marks it as the project's, as the picker reads it.
    expect(
      columns.find((column: ModelSchemaColumn): boolean => {
        return column.id === "projectId";
      })?.isTenantColumn,
    ).toBe(true);
    expect(pickedField(passOn, { label: "Project ID" })?.path).toBe(
      "projectId",
    );
    expect(pickedField(watch, { label: "Project ID" })).toBeNull();
    expect(englishPage(JIRA)).toContain(
      `click ${bold(ADD_FIELD)} and pick ${bold("Project ID")} for this, and keep the \`.value\``,
    );
  });

  it("watches the incident's state as the column an update reports, so the On Update guides run when it changes", async () => {
    const watch: Array<FieldOption> = await pickerFields(
      "Incident",
      WATCHED_FIELDS_NAME,
    );
    const state: FieldOption | null = pickedField(watch, {
      label: "Current Incident State",
    });

    expect(state?.path).toBe("currentIncidentStateId");
    expect(
      getWatchedColumns({
        listenOn: { [state?.path as string]: true },
        model: new Incident(),
      }),
    ).toContain("currentIncidentStateId");
  });

  it("finds a field list on every page that builds one", () => {
    expect(BUILDING_PAGES).toEqual(
      expect.arrayContaining([
        "integrations/index",
        "integrations/jira",
        "integrations/microsoft-dynamics-365",
        "integrations/opsgenie",
        "integrations/pagerduty",
        "integrations/servicenow",
        "integrations/github",
        "integrations/gitlab",
        "integrations/discord",
        "integrations/telegram",
        "integrations/irc",
      ]),
    );
  });
});

describe.each(BUILDING_PAGES)("%s, in English", (page: string) => {
  it("picks every field it names from the list it names, as the list names it", async () => {
    const missing: Array<string> = [];

    for (const found of await resolved(page)) {
      const where: string = `${found.instruction.line} ${found.instruction.setting}`;

      // The setting is the step's own.
      if (!argumentNames(found.step).includes(found.instruction.setting)) {
        missing.push(`${where}: ${found.step.title} has no such setting`);
      }

      found.instruction.picks.forEach((pick: FieldPick, index: number) => {
        if (!found.picks[index]) {
          missing.push(
            `${where}: ${pick.relation ? `${pick.relation} › ` : ""}${pick.label}`,
          );
        }
      });

      // A list said to start with a field starts with it.
      if (found.instruction.startsWith.length > 0) {
        expect({ where, startsWith: found.startsWith }).toEqual({
          where,
          startsWith: newTriggerFields(found.step.id),
        });
      }

      // A pick is made from Add field's list, which the line names.
      if (found.instruction.picks.length > 0) {
        expect({ where, addsFields: found.instruction.addsFields }).toEqual({
          where,
          addsFields: true,
        });
      }
    }

    expect(missing).toEqual([]);
  });

  it("names on the line the trigger it builds the field list for, when it names one", async () => {
    const markdown: string = englishPage(page);

    for (const found of await resolved(page)) {
      const line: string = markdown.split("\n")[
        found.instruction.line - 1
      ] as string;
      const named: Array<string> = boldSpansOf(line).filter(
        (span: string): boolean => {
          try {
            return recordComponent(span).id.includes("-on-");
          } catch {
            return false;
          }
        },
      );

      for (const title of named) {
        expect({ line: found.instruction.line, title }).toEqual({
          line: found.instruction.line,
          title: found.step.title,
        });
      }
    }
  });

  it("names no field by its key on a line that builds a field list", async () => {
    const markdown: string = englishPage(page);
    const keyed: Array<string> = [];

    for (const found of await resolved(page)) {
      const keys: Set<string> = new Set(
        (await schemaColumns(found.step.tableName as string)).map(
          (column: ModelSchemaColumn): string => {
            return column.id;
          },
        ),
      );
      const line: string = markdown.split("\n")[
        found.instruction.line - 1
      ] as string;

      for (const code of codeSpansOf(line)) {
        if (keys.has(code) || isFieldListJson(code)) {
          keyed.push(`${found.instruction.line}: ${code}`);
        }
      }
    }

    expect(keyed).toEqual([]);
  });

  it("gives as JSON only what it picks, and the list reads that JSON as those fields", async () => {
    for (const found of await resolved(page)) {
      if (!found.instruction.json) {
        // Edit as JSON is named only where JSON is given to put there.
        expect({
          line: found.instruction.line,
          editAsJson: found.instruction.editAsJson,
        }).toEqual({ line: found.instruction.line, editAsJson: false });
        continue;
      }

      const chosen: ChosenFields = readChosenFields({
        value: found.instruction.json,
        options: found.options,
        mode: modeOf(found.instruction.setting),
      });

      expect(chosen.problems).toEqual([]);
      expect(chosen.unknownPaths).toEqual([]);
      // The ID is passed on anyway; the rest are the picks.
      expect(
        chosen.paths
          .filter((path: string): boolean => {
            return path !== "_id";
          })
          .sort(),
      ).toEqual([...(found.picks as Array<string>)].sort());
    }
  });

  it("reads of each trigger's record only what the guide has it pass on, picked or given as JSON", async () => {
    const markdown: string = englishPage(page);
    const instructions: Array<ResolvedInstruction> = await resolved(page);
    const unread: Array<string> = [];

    for (const reference of triggerReferences(markdown)) {
      const passing: Array<ResolvedInstruction> = instructions.filter(
        (found: ResolvedInstruction): boolean => {
          return (
            found.trigger === reference.trigger &&
            found.instruction.setting === SELECT_FIELDS_NAME
          );
        },
      );

      if (passing.length === 0) {
        continue;
      }

      const picked: Array<string> = passing.flatMap(
        (found: ResolvedInstruction): Array<string> => {
          return found.picks as Array<string>;
        },
      );
      const passedOn: Set<string> = new Set([
        ...newTriggerFields(triggerComponentId(reference.trigger)),
        ...picked,
      ]);

      if (!isPassedOn(reference.path, passedOn)) {
        unread.push(
          `${reference.line}: ${reference.trigger}.${reference.path}`,
        );
      }

      // Given the JSON instead, the list holds the JSON's fields and no more.
      for (const found of passing) {
        if (!found.instruction.json) {
          continue;
        }

        const instead: Set<string> = new Set([
          ...passing
            .filter((other: ResolvedInstruction): boolean => {
              return other !== found;
            })
            .flatMap((other: ResolvedInstruction): Array<string> => {
              return other.picks as Array<string>;
            }),
          ...storedFieldPaths(JSON.parse(found.instruction.json) as JSONObject),
        ]);

        if (!isPassedOn(reference.path, instead)) {
          unread.push(
            `${reference.line}: ${reference.trigger}.${reference.path}, given the JSON on ${found.instruction.line}`,
          );
        }
      }
    }

    expect(unread).toEqual([]);
  });

  it("reads of a template's trigger only what the template the section names passes on", () => {
    const markdown: string = englishPage(page);
    const built: Set<string> = new Set(
      fieldListInstructions(markdown)
        .map((instruction: FieldListInstruction): string | null => {
          return triggerOfLine(markdown, instruction.line);
        })
        .filter((trigger: string | null): trigger is string => {
          return Boolean(trigger);
        }),
    );
    const templates: Array<WorkflowTemplate> = getWorkflowTemplates();
    const unread: Array<string> = [];

    for (const reference of triggerReferences(markdown)) {
      if (built.has(reference.trigger)) {
        continue;
      }

      // The innermost section that names a template.
      let named: Array<WorkflowTemplate> = [];

      for (const section of sectionsAround(markdown, reference.line)) {
        const text: string = markdown
          .split("\n")
          .slice(section.start - 1, section.end)
          .join("\n");

        named = templates.filter((template: WorkflowTemplate): boolean => {
          return text.includes(bold(template.name));
        });

        if (named.length > 0) {
          break;
        }
      }

      const passedOn: Set<string> = new Set();

      for (const template of named) {
        for (const node of getTemplateGraphSpec(template.id)?.nodes || []) {
          if (node.componentId === reference.trigger && node.args?.["select"]) {
            for (const path of storedFieldPaths(
              node.args["select"] as JSONObject,
            )) {
              passedOn.add(path);
            }
          }
        }
      }

      if (passedOn.size === 0 || !isPassedOn(reference.path, passedOn)) {
        unread.push(
          `${reference.line}: ${reference.trigger}.${reference.path}`,
        );
      }
    }

    expect(unread).toEqual([]);
  });
});

describe.each(DOCS_LANGUAGES)(
  "%s gives a field list as JSON only after Edit as JSON, as its Dashboard draws it",
  (language: string) => {
    it.each(PAGES)("%s", (page: string) => {
      expect(jsonWithoutEditAsJson(language, page)).toEqual([]);
    });
  },
);

describe.each(TRANSLATED_LANGUAGES)("%s", (language: string) => {
  it("has every integrations page", () => {
    for (const page of PAGES) {
      expect({ page, translated: hasPage(language, page) }).toEqual({
        page,
        translated: true,
      });
    }
  });

  describe.each(PAGES)("%s", (page: string) => {
    it("names on each field-list line the buttons and fields the English line names, as this language's Dashboard draws them", () => {
      const lines: Array<string> = readPage(language, page).split("\n");
      const missing: Array<string> = [];

      for (const instruction of fieldListInstructions(englishPage(page))) {
        const line: string = lines[instruction.line - 1] || "";
        const spans: Array<string> = boldSpansOf(line);

        // The list itself, as the step names it in every language.
        if (!spans.includes(instruction.setting)) {
          missing.push(`${instruction.line}: ${instruction.setting}`);
        }

        for (const label of pickerLabels(instruction)) {
          const drawn: string = drawnActionLabel(language, label);

          if (!spans.includes(drawn)) {
            missing.push(`${instruction.line}: ${drawn}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });
  });
});

describe("the reading of a guide's field lists, on lines of its own", () => {
  it("reads what a list starts with, the fields picked, a related record's field, and Edit as JSON", () => {
    const instructions: Array<FieldListInstruction> = fieldListInstructions(
      [
        "Its **Fields to pass on** starts with **Title**: click **Add field** and pick **Description** and **Incident Number**. Leave its **Identifier** as `x`.",
        "In **Fields to watch**, click **Add field** and pick **Current Incident State**, so it runs. In **Fields to pass on**, click **Add field**, open **Current Incident State** and pick **Is Resolved State**. Or click **Edit as JSON** and replace the JSON with:",
        "",
        "```json",
        '{ "_id": true, "currentIncidentState": { "isResolvedState": true } }',
        "```",
      ].join("\n"),
    );

    expect(instructions).toEqual([
      {
        line: 1,
        setting: SELECT_FIELDS_NAME,
        startsWith: ["Title"],
        picks: [{ label: "Description" }, { label: "Incident Number" }],
        addsFields: true,
        editAsJson: false,
        json: undefined,
      },
      {
        line: 2,
        setting: WATCHED_FIELDS_NAME,
        startsWith: [],
        picks: [{ label: "Current Incident State" }],
        addsFields: true,
        editAsJson: false,
        json: undefined,
      },
      {
        line: 2,
        setting: SELECT_FIELDS_NAME,
        startsWith: [],
        picks: [
          { label: "Is Resolved State", relation: "Current Incident State" },
        ],
        addsFields: true,
        editAsJson: true,
        json: '{ "_id": true, "currentIncidentState": { "isResolvedState": true } }',
      },
    ]);
  });

  it("reads no field list inside a code block, and no JSON a line does not end on", () => {
    expect(
      fieldListInstructions(
        [
          "```text",
          "**Fields to pass on** in a code block",
          "```",
          "Click **Edit as JSON** under **Fields to pass on**. Then:",
          "",
          "```json",
          '{ "title": true }',
          "```",
        ].join("\n"),
      ).map((instruction: FieldListInstruction) => {
        return [instruction.line, instruction.editAsJson, instruction.json];
      }),
    ).toEqual([[4, true, '{ "title": true }']]);
  });

  it("tells a field list's JSON from other JSON", () => {
    expect(isFieldListJson('{"title": true}')).toBe(true);
    expect(isFieldListJson('{"_id": true, "state": {"name": true}}')).toBe(
      true,
    );
    expect(isFieldListJson('{"a": {"b": {"c": true}}}')).toBe(false);
    expect(isFieldListJson('{"_type": "ObjectID", "value": "..."}')).toBe(
      false,
    );
    expect(isFieldListJson('{"confidential": true, "due": "x"}')).toBe(false);
    expect(isFieldListJson("{}")).toBe(false);
    expect(isFieldListJson('"confidential": true')).toBe(false);
    expect(isFieldListJson("title")).toBe(false);
  });

  it("finds JSON for a field list that no Edit as JSON comes before", () => {
    const markdown: string = [
      'Set it to `{"title": true}` or click **Edit as JSON** first.',
      'Click **Edit as JSON** and type `{"title": true}`.',
      "",
      "```json",
      '{ "_id": true }',
      "```",
      "Click **Als JSON bearbeiten** and paste:",
      "",
      "```json",
      '{ "title": true }',
      "```",
      'Send `{"_type": "ObjectID", "value": "x"}` as it is.',
    ].join("\n");

    expect(
      fieldListJsonOn(markdown).map((found: FieldListJson) => {
        return [found.line, found.isBlock];
      }),
    ).toEqual([
      [1, false],
      [2, false],
      [4, true],
      [9, true],
    ]);
    // Edit as JSON after the JSON, or none above the block, is none at all.
    expect(fieldListJsonBeforeEditAsJson(markdown, EDIT_AS_JSON)).toEqual([
      '1: {"title": true}',
      '9: { "title": true }',
    ]);
    // A German page says it in German.
    expect(
      fieldListJsonBeforeEditAsJson(markdown, "Als JSON bearbeiten"),
    ).toEqual([
      '1: {"title": true}',
      '2: {"title": true}',
      '4: { "_id": true }',
    ]);
  });

  it("finds the trigger a line's field list is for in the steps around it, the innermost section first", () => {
    const markdown: string = [
      "## Both",
      "### One",
      "In **Fields to pass on**, pick.",
      "`{{local.components.incident-on-create-1.returnValues.model.title}}`",
      "### Two",
      "In **Fields to pass on**, pick.",
      "### Three",
      "`{{local.components.incident-on-update-1.returnValues.model._id}}`",
    ].join("\n");

    expect(triggerOfLine(markdown, 3)).toBe("incident-on-create-1");
    // Its own section reads none; the section around it reads two.
    expect(triggerOfLine(markdown, 6)).toBeNull();
    expect(
      triggerReferences(markdown).map((reference: TriggerReference) => {
        return [reference.line, reference.trigger, reference.path];
      }),
    ).toEqual([
      [4, "incident-on-create-1", "title"],
      [8, "incident-on-update-1", "_id"],
    ]);
  });

  it("reads a field as passed on by its own field or its related record's, and the ID always", () => {
    const passedOn: Set<string> = new Set([
      "title",
      "projectId",
      "currentIncidentState.name",
    ]);

    expect(isPassedOn("title", passedOn)).toBe(true);
    expect(isPassedOn("projectId.value", passedOn)).toBe(true);
    expect(isPassedOn("currentIncidentState.name", passedOn)).toBe(true);
    expect(isPassedOn("_id", passedOn)).toBe(true);
    expect(isPassedOn("description", passedOn)).toBe(false);
    expect(isPassedOn("currentIncidentState.isResolvedState", passedOn)).toBe(
      false,
    );
    expect(storedFieldPaths({ _id: true, state: { name: true } })).toEqual([
      "_id",
      "state.name",
    ]);
  });

  it("picks a related record's field only under the record it is opened from", () => {
    const options: Array<FieldOption> = [
      {
        path: "state",
        title: "State",
        shortTitle: "State",
        typeLabel: "Record",
        columnType: "Entity",
        group: "main" as FieldOption["group"],
        isRelation: true,
        aliases: [],
      },
      {
        path: "state.name",
        title: "State › Name",
        shortTitle: "Name",
        typeLabel: "Text",
        columnType: "ShortText",
        group: "main" as FieldOption["group"],
        relationPath: "state",
        aliases: [],
      },
      {
        path: "name",
        title: "Name",
        shortTitle: "Name",
        typeLabel: "Text",
        columnType: "ShortText",
        group: "main" as FieldOption["group"],
        aliases: [],
      },
    ];

    expect(pickedField(options, { label: "Name" })?.path).toBe("name");
    expect(
      pickedField(options, { label: "Name", relation: "State" })?.path,
    ).toBe("state.name");
    expect(pickedField(options, { label: "State" })).toBeNull();
    expect(
      pickedField(options, { label: "Name", relation: "Other" }),
    ).toBeNull();
    expect(modeOf(WATCHED_FIELDS_NAME)).toBe(FieldPickerMode.Watch);
    expect(modeOf(SELECT_FIELDS_NAME)).toBe(FieldPickerMode.PassOn);
  });
});
