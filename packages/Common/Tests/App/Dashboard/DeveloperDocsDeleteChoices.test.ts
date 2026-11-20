import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEVELOPER_DOCS_DELETE_CHOICE_WORDS,
  DeveloperDocsDeleteChoiceStep,
  DeveloperDocsDeleteChoiceWords,
  DeveloperDocsDeleteTab,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsStep,
  getDeveloperDocsDeleteChoiceStep,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PARENT_PAGES,
  DeveloperDocsPageType,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import { SetupGuideStepVariant } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import Models from "../../../Models/DatabaseModels/Index";
import WorkflowsOfDeletedRoles, {
  WorkflowsRunAsInstead,
} from "../../../Server/Utils/Workflow/WorkflowsOfDeletedRoles";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import {
  getCliDeleteChoiceWays,
  getCliDeleteExample,
} from "../../../Utils/DeveloperDocs/CliExamples";
import {
  DeleteChoiceWay,
  getDeleteChoiceWays,
  getTablesWithDeleteChoices,
  readDeleteChoices,
} from "../../../Utils/DeveloperDocs/DeleteChoices";
import { getFixtureLiveData } from "../../Utils/DeveloperDocs/DeveloperDocsLiveFixture";

/*
 * A CUSTOM ROLE'S DELETE IT STEP SAYS WHAT ITS WORKFLOWS NEED (#10031).
 *
 * OneUptime deletes a custom role that workflows run as only when the
 * delete says what they run as instead, and refuses one that doesn't,
 * naming them (#9767). The API has always taken the choice in the
 * DELETE's body, and the CLI takes it as flags since #10000. The Developer
 * > API and CLI pages' Delete it step showed a bare delete, so whoever
 * copied it met the refusal first.
 *
 * For a table whose delete takes choices (DeleteChoices.ts), the step now
 * says when they are needed and has a tab for each way: the plain delete,
 * then each choice as the request body (API) or the flags (CLI), written
 * from the facts the server reads. Every other resource's Delete it step
 * is the one it was.
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";
const ORIGIN: string = "https://oneuptime.example.com";
const API_KEYS_URL: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/settings/api-keys";

const DESCRIPTION: string =
  "This deletes the custom role for good. If workflows run as it, say what they run as from now on, or OneUptime refuses the delete and names them. For another custom role, put its ID in place of <custom-role-id>.";

const TAB_LABELS: Array<string> = [
  "No workflow runs as it",
  "Default permissions",
  "Another custom role",
];

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function readLocale(file: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, string>;
}

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .sort();

function roleJson(): JSONObject {
  const role: CustomRole = new CustomRole();
  role._id = ROLE_ID;
  role.name = "Incident Automation";
  role.description = "What the incident workflows may do.";
  return BaseModel.toJSON(role, CustomRole);
}

function viewContext(
  modelType: DatabaseBaseModelType,
  record: { id: string; displayName: string; json: JSONObject },
): DeveloperDocsGuideContext {
  return {
    resource: getDeveloperDocsResource(modelType),
    scope: DeveloperDocsScope.View,
    oneuptimeUrl: ORIGIN,
    platformVersion: "14.0.11",
    apiKeysUrl: API_KEYS_URL,
    live: getFixtureLiveData(),
    record,
  };
}

function roleGuide(page: DeveloperDocsPageType): DeveloperDocsGuide {
  return getDeveloperDocsGuide(
    page,
    viewContext(CustomRole, {
      id: ROLE_ID,
      displayName: "Incident Automation",
      json: roleJson(),
    }),
  );
}

function deleteStepOf(guide: DeveloperDocsGuide): DeveloperDocsStep {
  const found: DeveloperDocsStep | undefined = guide.steps.find(
    (step: DeveloperDocsStep): boolean => {
      return step.title === "Delete it";
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function labelsOf(step: DeveloperDocsStep): Array<string> {
  return (step.variants || []).map((variant: SetupGuideStepVariant): string => {
    return variant.label;
  });
}

function tabMarkdown(step: DeveloperDocsStep, label: string): string {
  const variant: SetupGuideStepVariant | undefined = (step.variants || []).find(
    (candidate: SetupGuideStepVariant): boolean => {
      return candidate.label === label;
    },
  );

  expect(variant).toBeDefined();

  return variant!.markdown;
}

// The JSON a curl command sends, as -d writes it; null when it sends none.
function curlBody(markdown: string): JSONObject | null {
  const match: RegExpMatchArray | null = markdown.match(/-d '([\s\S]*?)'\n/);

  return match ? (JSON.parse(match[1]!) as JSONObject) : null;
}

// The command in a bash code block, read back onto one line.
function commandOf(markdown: string): string {
  return markdown
    .replace(/^```bash\n/, "")
    .replace(/\n```$/, "")
    .split(" \\\n")
    .map((line: string): string => {
      return line.trim();
    })
    .join(" ");
}

describe("a custom role's API page", () => {
  const step: DeveloperDocsStep = deleteStepOf(
    roleGuide(DeveloperDocsPageType.Api),
  );

  test("ends with Delete it, which says when a delete needs more and where the other role's ID goes", () => {
    const guide: DeveloperDocsGuide = roleGuide(DeveloperDocsPageType.Api);

    expect(guide.steps[guide.steps.length - 1]).toBe(
      guide.steps.find((candidate: DeveloperDocsStep): boolean => {
        return candidate.title === "Delete it";
      }),
    );
    expect(step.description).toBe(DESCRIPTION);
    expect(step.markdown).toBeUndefined();
  });

  test("has a tab for the plain delete, then one for each way the workflows can run instead", () => {
    expect(labelsOf(step)).toEqual(TAB_LABELS);
  });

  test("the plain delete sends no body, as it always did", () => {
    const markdown: string = tabMarkdown(step, "No workflow runs as it");

    expect(markdown).toContain(
      `curl -X DELETE ${ORIGIN}/api/custom-role/${ROLE_ID}`,
    );
    expect(markdown).toContain('-H "ApiKey: $ONEUPTIME_API_KEY"');
    expect(markdown).not.toContain("-d ");
    expect(markdown).not.toContain("Content-Type");
    expect(markdown).not.toContain("miscDataProps");
  });

  test("the default permissions: the body the API reads, with its content type", () => {
    const markdown: string = tabMarkdown(step, "Default permissions");

    expect(markdown).toContain(
      `curl -X DELETE ${ORIGIN}/api/custom-role/${ROLE_ID}`,
    );
    expect(markdown).toContain('-H "Content-Type: application/json"');
    expect(curlBody(markdown)).toEqual({
      miscDataProps: { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default },
    });
  });

  test("another custom role: CustomRole, and the other role's ID to fill in", () => {
    expect(curlBody(tabMarkdown(step, "Another custom role"))).toEqual({
      miscDataProps: {
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "<custom-role-id>",
      },
    });
  });

  test("each body is one the server takes, once the other role's ID is filled in", () => {
    const read: Array<WorkflowsRunAsInstead | null> = [
      "Default permissions",
      "Another custom role",
    ].map((label: string): WorkflowsRunAsInstead | null => {
      const body: JSONObject = curlBody(tabMarkdown(step, label))!;
      const miscDataProps: JSONObject = JSON.parse(
        JSON.stringify(body["miscDataProps"]).replace(
          "<custom-role-id>",
          OTHER_ROLE_ID,
        ),
      ) as JSONObject;

      return WorkflowsOfDeletedRoles.readInstead(miscDataProps);
    });

    expect(read).toEqual([
      { runAs: WorkflowRunAs.Default },
      {
        runAs: WorkflowRunAs.CustomRole,
        customRoleId: new ObjectID(OTHER_ROLE_ID),
      },
    ]);
  });

  test("never offers Project Owner: deleting a role never raises what a workflow can do", () => {
    const text: string = JSON.stringify(step);

    expect(text).not.toContain(WorkflowRunAs.ProjectOwner);
    expect(text).not.toContain("Project Owner");
  });
});

describe("a custom role's CLI page", () => {
  const step: DeveloperDocsStep = deleteStepOf(
    roleGuide(DeveloperDocsPageType.Cli),
  );

  test("ends with the same Delete it step, in the same words and tabs", () => {
    const guide: DeveloperDocsGuide = roleGuide(DeveloperDocsPageType.Cli);

    expect(guide.steps[guide.steps.length - 1]?.title).toBe("Delete it");
    expect(step.description).toBe(DESCRIPTION);
    expect(labelsOf(step)).toEqual(TAB_LABELS);
  });

  test("each tab is the CLI's delete with the flags that say it", () => {
    expect(
      TAB_LABELS.map((label: string): string => {
        return commandOf(tabMarkdown(step, label));
      }),
    ).toEqual([
      `oneuptime custom-role delete ${ROLE_ID}`,
      `oneuptime custom-role delete ${ROLE_ID} --workflows-run-as Default`,
      // Quoted: unquoted, a shell would read <custom-role-id> as a redirection.
      `oneuptime custom-role delete ${ROLE_ID} --workflows-run-as CustomRole --workflows-run-as-custom-role-id '<custom-role-id>'`,
    ]);
  });

  test("a long one goes a flag a line, as the page's other commands do", () => {
    expect(tabMarkdown(step, "Another custom role")).toBe(
      [
        "```bash",
        `oneuptime custom-role delete ${ROLE_ID} \\`,
        "  --workflows-run-as CustomRole \\",
        "  --workflows-run-as-custom-role-id '<custom-role-id>'",
        "```",
      ].join("\n"),
    );
  });

  test("the flags are the ones the CLI's own help gives for each way", () => {
    expect(
      TAB_LABELS.slice(1).map((label: string): string => {
        return commandOf(tabMarkdown(step, label))
          .replace(`oneuptime custom-role delete ${ROLE_ID} `, "")
          .replace(/'/g, "");
      }),
    ).toEqual(
      getCliDeleteChoiceWays("CustomRole").map((way: Array<string>): string => {
        return way.join(" ");
      }),
    );
  });

  test("the CLI reads each one as the body the API page sends", () => {
    const apiStep: DeveloperDocsStep = deleteStepOf(
      roleGuide(DeveloperDocsPageType.Api),
    );

    for (const way of getDeleteChoiceWays("CustomRole")) {
      const label: string =
        DEVELOPER_DOCS_DELETE_CHOICE_WORDS["CustomRole"]!.ways[way.value]!;
      const args: Array<string> = getCliDeleteExample({
        modelType: CustomRole,
        id: ROLE_ID,
        choices:
          (curlBody(tabMarkdown(apiStep, label))![
            "miscDataProps"
          ] as JSONObject) || undefined,
      }).args;

      // The flags after the ID, read back into what the delete sends.
      const flags: Array<string> = args.slice(3);
      const given: Record<string, unknown> = {};

      for (let index: number = 0; index < flags.length; index += 2) {
        given[
          flags[index] === "--workflows-run-as"
            ? WORKFLOWS_RUN_AS_INSTEAD_KEY
            : WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY
        ] =
          flags[index + 1] === "<custom-role-id>"
            ? OTHER_ROLE_ID
            : flags[index + 1];
      }

      expect(
        readDeleteChoices({
          tableName: "CustomRole",
          given,
          deletedId: ROLE_ID,
          nameOf: (key: string): string => {
            return key;
          },
        }),
      ).toEqual(
        JSON.parse(
          JSON.stringify(
            curlBody(tabMarkdown(apiStep, label))!["miscDataProps"],
          ).replace("<custom-role-id>", OTHER_ROLE_ID),
        ),
      );
    }
  });
});

function modelOf(tableName: string): DatabaseBaseModelType {
  return (Models as Array<DatabaseBaseModelType>).find(
    (modelType: DatabaseBaseModelType): boolean => {
      return new modelType().tableName === tableName;
    },
  )!;
}

/*
 * The step is seen where a table whose delete takes choices has a page of
 * its own: a custom role's (#10139). Until then no page drew it.
 */
describe("the pages that draw the step", () => {
  const WITH_CHOICES: Array<DeveloperDocsParentPage> =
    DEVELOPER_DOCS_PARENT_PAGES.filter(
      (parent: DeveloperDocsParentPage): boolean => {
        return getTablesWithDeleteChoices().includes(parent.tableName);
      },
    );

  test("every table whose delete takes choices has a page of its own, and a custom role's is its page", () => {
    expect(
      WITH_CHOICES.filter((parent: DeveloperDocsParentPage): boolean => {
        return parent.scope === DeveloperDocsScope.View;
      })
        .map((parent: DeveloperDocsParentPage): string => {
          return parent.tableName;
        })
        .sort(),
    ).toEqual(getTablesWithDeleteChoices().sort());

    expect(
      WITH_CHOICES.map((parent: DeveloperDocsParentPage): Array<string> => {
        return [parent.tableName, parent.scope, parent.pageKey];
      }),
    ).toEqual([["CustomRole", DeveloperDocsScope.View, "TEAM_ROLE_VIEW"]]);
  });

  test.each(
    WITH_CHOICES.map((parent: DeveloperDocsParentPage): [string] => {
      return [parent.tableName];
    }),
  )(
    "%s: the API and CLI pages of its own page end with the step and its tabs",
    (tableName: string) => {
      const modelType: DatabaseBaseModelType = modelOf(tableName);
      const choiceStep: DeveloperDocsDeleteChoiceStep | null =
        getDeveloperDocsDeleteChoiceStep(modelType);

      expect(choiceStep).not.toBeNull();

      for (const page of [
        DeveloperDocsPageType.Api,
        DeveloperDocsPageType.Cli,
      ]) {
        const steps: Array<DeveloperDocsStep> = getDeveloperDocsGuide(
          page,
          viewContext(modelType, {
            id: ROLE_ID,
            displayName: "Example",
            json: { _id: ROLE_ID },
          }),
        ).steps;
        const last: DeveloperDocsStep | undefined = steps[steps.length - 1];

        expect({ page, title: last?.title }).toEqual({
          page,
          title: "Delete it",
        });
        expect(last?.description).toBe(choiceStep!.description);
        expect(
          (last?.variants || []).map(
            (variant: SetupGuideStepVariant): string => {
              return variant.label;
            },
          ),
        ).toEqual(
          choiceStep!.tabs.map((tab: DeveloperDocsDeleteTab): string => {
            return tab.label;
          }),
        );
      }
    },
  );
});

describe("every other resource's Delete it step", () => {
  // The resources with a page of their own whose delete takes no choices.
  const VIEW_PAGES: Array<DeveloperDocsParentPage> =
    DEVELOPER_DOCS_PARENT_PAGES.filter(
      (parent: DeveloperDocsParentPage): boolean => {
        return (
          parent.scope === DeveloperDocsScope.View &&
          !getTablesWithDeleteChoices().includes(parent.tableName)
        );
      },
    );

  test("covers every resource with a page of its own", () => {
    expect(VIEW_PAGES.length).toBeGreaterThan(30);
  });

  test.each(
    VIEW_PAGES.map((parent: DeveloperDocsParentPage): [string] => {
      return [parent.tableName];
    }),
  )("%s: one plain delete, as before", (tableName: string) => {
    const modelType: DatabaseBaseModelType = modelOf(tableName);

    expect(getDeveloperDocsDeleteChoiceStep(modelType)).toBeNull();

    for (const page of [DeveloperDocsPageType.Api, DeveloperDocsPageType.Cli]) {
      const step: DeveloperDocsStep | undefined = getDeveloperDocsGuide(
        page,
        viewContext(modelType, {
          id: ROLE_ID,
          displayName: "Example",
          json: { _id: ROLE_ID },
        }),
      ).steps.find((candidate: DeveloperDocsStep): boolean => {
        return candidate.title === "Delete it";
      });

      if (!step) {
        continue;
      }

      expect(step.variants).toBeUndefined();
      expect(step.description).toMatch(/^This deletes the .+ for good\.$/);
      expect(step.markdown).not.toContain("miscDataProps");
      expect(step.markdown).not.toContain("--workflows-run-as");
    }
  });
});

describe("the step's words", () => {
  test("every table whose delete takes choices has them, and only those tables", () => {
    expect(Object.keys(DEVELOPER_DOCS_DELETE_CHOICE_WORDS).sort()).toEqual(
      getTablesWithDeleteChoices().sort(),
    );
  });

  test.each(getTablesWithDeleteChoices())(
    "%s: a tab for each way, each tab its own label",
    (tableName: string) => {
      const words: DeveloperDocsDeleteChoiceWords =
        DEVELOPER_DOCS_DELETE_CHOICE_WORDS[tableName]!;
      const values: Array<string> = getDeleteChoiceWays(tableName).map(
        (way: DeleteChoiceWay): string => {
          return way.value;
        },
      );

      expect(Object.keys(words.ways).sort()).toEqual([...values].sort());

      const labels: Array<string> = [
        words.withoutChoices,
        ...values.map((value: string): string => {
          return words.ways[value]!;
        }),
      ];

      expect(new Set(labels).size).toBe(labels.length);
    },
  );

  test("the description names where a record's ID goes, once", () => {
    for (const words of Object.values(DEVELOPER_DOCS_DELETE_CHOICE_WORDS)) {
      expect(words.description.split("{{placeholder}}")).toHaveLength(2);
    }
  });

  test("the step for a custom role, as the page builds it", () => {
    const built: DeveloperDocsDeleteChoiceStep | null =
      getDeveloperDocsDeleteChoiceStep(CustomRole);

    expect(built?.description).toBe(DESCRIPTION);
    expect(
      built?.tabs.map((tab: DeveloperDocsDeleteTab): JSONObject | null => {
        return tab.miscDataProps;
      }),
    ).toEqual([
      null,
      { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default },
      {
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "<custom-role-id>",
      },
    ]);
  });

  /*
   * A missing key shows English, so this is what notices. Every word of
   * the step is in en.json as itself, and translated in every other
   * locale, keeping its placeholder and OneUptime's name.
   */
  const WORDS: Array<string> = Object.values(
    DEVELOPER_DOCS_DELETE_CHOICE_WORDS,
  ).flatMap((words: DeveloperDocsDeleteChoiceWords): Array<string> => {
    return [
      words.description,
      words.withoutChoices,
      ...Object.values(words.ways),
    ];
  });

  test("there are seventeen other locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(WORDS)("%s: in every Dashboard locale", (text: string) => {
    expect(readLocale("en.json")[text]).toBe(text);

    for (const file of LOCALE_FILES) {
      const translated: string | undefined = readLocale(file)[text];

      expect({ file, translated: Boolean(translated?.trim()) }).toEqual({
        file,
        translated: true,
      });
      expect({ file, english: translated === text }).toEqual({
        file,
        english: false,
      });

      for (const kept of ["{{placeholder}}", "OneUptime"]) {
        if (text.includes(kept)) {
          expect({ file, kept: translated!.includes(kept) }).toEqual({
            file,
            kept: true,
          });
        }
      }
    }
  });
});
