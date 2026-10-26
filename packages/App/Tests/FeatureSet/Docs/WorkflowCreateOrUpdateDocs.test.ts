import { DOCS_LANGUAGES, listPages, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { inlineCode } from "./DocsTranslationChecks";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ComponentMetadata, {
  ComponentType,
} from "Common/Types/Workflow/Component";
import BaseModelComponent, {
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  WHAT_HAPPENED_ID,
  WHAT_HAPPENED_NAME,
  WhatHappened,
  getCreateOrUpdateTriggerId,
} from "Common/Types/Workflow/CreateOrUpdateTrigger";
import { getDatabaseOperation } from "Common/Types/Workflow/DatabaseOperation";
import { DATABASE_OPERATION_ORDER } from "Common/UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { writtenPermissionTitle } from "./DocsRoleNames";

/*
 * The docs on On Create or Update - one trigger for a new record and a
 * changed one (Common/Types/Workflow/CreateOrUpdateTrigger) - in every docs
 * language, held to the product: its name and its siblings' as the catalog
 * generates them, What Happened and its two values, the reference to it, and
 * Run Workflow's question, named the way that language's Dashboard draws it.
 * The output keeps its English name in every language: the value picker
 * lists a step's values as the step names them.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// A model's triggers, as the Add Trigger panel lists them.
function triggerTitles(model: Incident | Monitor): Array<string> {
  return BaseModelComponent.getComponents(model)
    .filter((component: ComponentMetadata): boolean => {
      return component.componentType === ComponentType.Trigger;
    })
    .sort((a: ComponentMetadata, b: ComponentMetadata): number => {
      return (
        DATABASE_OPERATION_ORDER.indexOf(
          getDatabaseOperation({
            componentId: a.id,
            tableName: model.tableName!,
          })!,
        ) -
        DATABASE_OPERATION_ORDER.indexOf(
          getDatabaseOperation({
            componentId: b.id,
            tableName: model.tableName!,
          })!,
        )
      );
    })
    .map((component: ComponentMetadata): string => {
      return component.title;
    });
}

const TRIGGERS: string = readPage("en", "workflows/triggers");

const REFERENCE: string = `{{local.components.${getCreateOrUpdateTriggerId("Incident")}-1.returnValues.${WHAT_HAPPENED_ID}}}`;

// The lines of a page that hold every needle.
function linesWith(text: string, needles: Array<string>): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return needles.every((needle: string): boolean => {
      return line.includes(needle);
    });
  });
}

/*
 * "**On Create Alert**" and the like: a model's On Create trigger, named in
 * bold. Its model is what follows "On Create " - so On Create or Update's own
 * name reads as the model "or Update Alert", and is left out by the caller.
 */
const ON_CREATE_TRIGGER: RegExp = /\*\*On Create ([^*]+)\*\*/g;

// The models a line lists On Create, On Update and On Delete triggers for.
function modelsWithTriggersListed(line: string): Array<string> {
  const models: Set<string> = new Set();

  for (const match of line.matchAll(ON_CREATE_TRIGGER)) {
    const model: string = match[1]!;

    if (
      !model.startsWith("or Update ") &&
      line.includes(`**On Update ${model}**`) &&
      line.includes(`**On Delete ${model}**`)
    ) {
      models.add(model);
    }
  }

  return Array.from(models);
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("the triggers page, in English", () => {
  it("lists the record triggers a model offers, in the panel's order", () => {
    const titles: Array<string> = triggerTitles(new Incident());

    expect(titles).toEqual([
      "On Create Incident",
      "On Update Incident",
      "On Create or Update Incident",
      "On Delete Incident",
    ]);
    expect(TRIGGERS).toContain(`Each offers up to four triggers:`);

    // One bullet each, in the same order, named without the model.
    const bullets: Array<string> = TRIGGERS.split("\n").filter(
      (line: string): boolean => {
        return line.startsWith("- **On ");
      },
    );

    expect(
      bullets.map((line: string): string => {
        return line.slice(4, line.indexOf("**", 4));
      }),
    ).toEqual(
      titles.map((title: string): string => {
        return title.replace(" Incident", "");
      }),
    );
  });

  it("says a new record always fires it, and Fields to watch narrows its updates", () => {
    expect(WATCHED_FIELDS_NAME).toBe("Fields to watch");
    expect(TRIGGERS).toContain(
      "- **On Create or Update** — fires for both: once when a new one is added, and once each time one is changed.",
    );
    expect(TRIGGERS).toContain(
      `**On Create or Update** has the same **${WATCHED_FIELDS_NAME}**, for its updates only: every new record still fires it.`,
    );
  });

  it("names What Happened, its two values and the reference to it as the step has them", () => {
    expect(WHAT_HAPPENED_NAME).toBe("What Happened");
    expect(TRIGGERS).toContain(
      `**On Create or Update** also passes **${WHAT_HAPPENED_NAME}**: \`${WhatHappened.Created}\` when a new record started the run, and \`${WhatHappened.Updated}\` when a change did, as in \`${REFERENCE}\`.`,
    );
    // The reference is to the trigger's own value, under its id.
    const trigger: ComponentMetadata = BaseModelComponent.getComponents(
      new Incident(),
    ).find((component: ComponentMetadata): boolean => {
      return component.id === getCreateOrUpdateTriggerId("Incident");
    })!;

    expect(
      trigger.returnValues.map((value: { id: string; name: string }) => {
        return [value.id, value.name];
      }),
    ).toContainEqual([WHAT_HAPPENED_ID, WHAT_HAPPENED_NAME]);
  });

  it("says one save fires it once, and how OneUptime's own changes are kept out", () => {
    expect(TRIGGERS).toContain(
      "One save fires it once. What OneUptime fills in while it creates a record is part of the create, so a new record fires it once, as `created`.",
    );
    expect(TRIGGERS).toContain(
      `to leave them out, add only the fields you care about to **${WATCHED_FIELDS_NAME}**.`,
    );
  });

  it("tests it with Run Workflow, asking what happened as the Run panel asks it", () => {
    expect(TRIGGERS).toContain(
      `For **On Create or Update**, choose under **${WHAT_HAPPENED_NAME}** whether the run is for the record being created or updated.`,
    );
    // The panel's question is drawn under the same name.
    expect(readSource("Common/UI/Components/Workflow/RunForm.tsx")).toContain(
      `whatHappened: translationKey("${WHAT_HAPPENED_NAME}")`,
    );
  });
});

describe.each(
  DOCS_LANGUAGES.filter((language: string) => {
    return language !== "en";
  }),
)("the triggers page in %s", (language: string) => {
  const page: string = readPage(language, "workflows/triggers");

  it("names On Create or Update as often as the English page does", () => {
    expect(countOf(page, "**On Create or Update**")).toBe(
      countOf(TRIGGERS, "**On Create or Update**"),
    );
  });

  it("keeps the value's own name in English, as the value picker lists it", () => {
    expect(page).toContain(`**${WHAT_HAPPENED_NAME}**`);
  });

  it("names Run Workflow's question as this language's Dashboard draws it", () => {
    const drawn: string = drawnDashboardLabel(language, WHAT_HAPPENED_NAME);

    // Every Dashboard language translates it.
    expect(drawn).not.toBe(WHAT_HAPPENED_NAME);
    expect(
      linesWith(page, ["**On Create or Update**", `**${drawn}**`]),
    ).toHaveLength(1);
  });

  it("quotes the two values and the reference exactly", () => {
    const code: Array<string> = inlineCode(page);

    expect(code).toContain(REFERENCE);
    expect(
      code.filter((span: string): boolean => {
        return span === WhatHappened.Created;
      }),
    ).toHaveLength(2);
    expect(code).toContain(WhatHappened.Updated);
  });
});

describe.each(DOCS_LANGUAGES)("the other pages in %s", (language: string) => {
  it("components: the Monitor set's four triggers, as the catalog names them", () => {
    const titles: Array<string> = triggerTitles(new Monitor());

    expect(titles).toHaveLength(4);
    expect(
      linesWith(
        readPage(language, "workflows/components"),
        titles.map((title: string): string => {
          return `**${title}**`;
        }),
      ),
    ).toHaveLength(1);
  });

  it("configuration: the triggers that act as a Project Admin include it", () => {
    const lines: Array<string> = linesWith(
      readPage(language, "workflows/configuration"),
      [
        "On Create or Update",
        `**${writtenPermissionTitle(language, "Project Admin")}**`,
      ],
    );

    expect(lines).toHaveLength(1);
    // Beside the three it stands among.
    for (const trigger of ["On Create", "On Update", "On Delete"]) {
      expect(lines[0]).toContain(trigger);
    }
  });

  it("incident settings: On Create or Update X, with its Fields to watch and what-happened", () => {
    const page: string = readPage(language, "incidents/settings");

    expect(
      linesWith(page, [
        "**On Create or Update X**",
        `**${WATCHED_FIELDS_NAME}**`,
        `\`${WHAT_HAPPENED_ID}\``,
        `\`${WhatHappened.Created}\``,
        `\`${WhatHappened.Updated}\``,
      ]),
    ).toHaveLength(1);
    // Among the headline triggers, and among those that pass a record on.
    expect(linesWith(page, ["**On Create or Update Incident**"])).toHaveLength(
      1,
    );
    expect(
      linesWith(page, ["**On Create or Update X**", "**Fields to pass on**"]),
    ).toHaveLength(1);
  });
});

describe.each(DOCS_LANGUAGES)("every page in %s", (language: string) => {
  it("lists a model's four record triggers wherever it lists its others, in the panel's order", () => {
    const lists: Array<string> = [];
    const wrong: Array<string> = [];

    for (const page of listPages(language)) {
      readPage(language, page)
        .split("\n")
        .forEach((line: string, index: number) => {
          for (const model of modelsWithTriggersListed(line)) {
            const where: string = `${page}:${index + 1} (${model})`;
            const positions: Array<number> = [
              `**On Create ${model}**`,
              `**On Update ${model}**`,
              `**On Create or Update ${model}**`,
              `**On Delete ${model}**`,
            ].map((title: string): number => {
              return line.indexOf(title);
            });
            const inOrder: boolean = positions.every(
              (position: number, at: number): boolean => {
                return (
                  position >= 0 && (at === 0 || position > positions[at - 1]!)
                );
              },
            );

            lists.push(where);

            if (!inOrder) {
              wrong.push(where);
            }
          }
        });
    }

    expect(wrong).toEqual([]);
    // The overview and settings pages of incidents and alerts, and the components page, at least.
    expect(lists.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the reader of a model's listed triggers", () => {
  it("finds the model a line lists all three others for, and not On Create or Update's own name", () => {
    expect(
      modelsWithTriggersListed(
        "The **On Create Incident**, **On Update Incident**, **On Create or Update Incident** and **On Delete Incident** triggers",
      ),
    ).toEqual(["Incident"]);
    expect(
      modelsWithTriggersListed(
        "**On Create Alert** and **On Update Alert** only, and **On Delete Monitor**",
      ),
    ).toEqual([]);
    expect(modelsWithTriggersListed("No triggers here.")).toEqual([]);
  });
});

describe("the variables page", () => {
  it("says a record trigger returns the record as model, not that it returns one value", () => {
    const page: string = readPage("en", "workflows/variables");

    expect(page).toContain(
      "Record triggers return the record as `model`, and you drill into it.",
    );
    expect(page).not.toContain("return one value");
  });
});
