/*
 * The "How to use" help of every workflow step: each of the 22 built-in steps
 * and all eleven generated database steps of every model a workflow can use.
 *
 * The feedback was that the help should be "simpler to understand and use".
 * It used to be Markdown shared by whole families of steps, and it drifted:
 * On Delete's described a Select Fields setting it does not have, and Create
 * One's spent most of its length on Create Many. So beyond checking that every
 * step has help, this holds the help to what makes it usable:
 *
 *   - it stays short where it is not collapsed;
 *   - every setting, port or button it names exists, so it cannot drift again;
 *   - its examples are built from the step's own identifier and the steps
 *     really in the workflow, and anything meant to be pasted is valid;
 *   - its links land on headings that exist.
 */

import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import MarkdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationLink,
  ComponentDocumentationLinkSite,
  ComponentDocumentationNote,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import {
  DatabaseOperation,
  getDatabaseOperation,
} from "../../../Types/Workflow/Documentation/DatabaseDocumentation";
import {
  documentationTextToPlain,
  getDocumentationTextNames,
} from "../../../Types/Workflow/Documentation/DocumentationText";
import {
  BUILT_IN_COMPONENT_DOCUMENTATION,
  getComponentDocumentation,
} from "../../../Types/Workflow/Documentation/Index";
import {
  EXAMPLE_ID,
  getRequiredCreateColumns,
} from "../../../Types/Workflow/Documentation/ModelExamples";
import { isSystemColumnId } from "../../../Types/Workflow/SystemColumns";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpressionKind,
  checkJSONSyntax,
  parseReferencePath,
  parseTemplateExpressions,
} from "../../../Types/Workflow/TemplateSyntax";
import CronTab from "../../../Utils/CronTab";
import { DISCORD_WEBHOOK_DOMAINS } from "../../../Server/Types/Workflow/Components/IncomingWebhookUtils";
import { MAX_SLEEP_IN_MS } from "../../../Server/Types/Workflow/Components/Sleep";
import { MICROSOFT_TEAMS_WEBHOOK_DOMAINS } from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { componentInputTypeToFormFieldType } from "../../../UI/Components/Workflow/Utils";
import {
  CONDITION_COMPARISONS,
  ConditionComparison,
} from "../../../Types/Workflow/Components/ConditionComparison";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// `<key>` and the like: a placeholder for whatever the caller sends.
const PLACEHOLDER: RegExp = /^<[a-z-]+>$/;

const CANNOT_BE_UNDONE: RegExp = /cannot be undone/;

const CREATE_STEP: RegExp = /-create-(one|many)$/;

// A distinctive identifier, so an example built from it cannot be a coincidence.
const STEP_ID: string = "my-step-7";

// packages/Common/Tests/Types/Workflow -> packages
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const BUILT_IN: Array<ComponentMetadata> = Components;

const DATABASE: Array<ComponentMetadata> = Entities.flatMap(
  (modelType: { new (): BaseModel }): Array<ComponentMetadata> => {
    return BaseModelComponent.getComponents(new modelType());
  },
);

const INCIDENT_STEPS: Array<ComponentMetadata> =
  BaseModelComponent.getComponents(new Incident());

type MakeNodeFunction = (
  metadata: ComponentMetadata,
  id: string,
) => NodeDataProp;

const makeNode: MakeNodeFunction = (
  metadata: ComponentMetadata,
  id: string,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

type FindStepFunction = (
  steps: Array<ComponentMetadata>,
  idOrSuffix: string,
) => ComponentMetadata;

const findStep: FindStepFunction = (
  steps: Array<ComponentMetadata>,
  idOrSuffix: string,
): ComponentMetadata => {
  const found: ComponentMetadata | undefined = steps.find(
    (metadata: ComponentMetadata) => {
      return metadata.id === idOrSuffix || metadata.id.endsWith(idOrSuffix);
    },
  );

  if (!found) {
    throw new Error(`No step ${idOrSuffix}`);
  }

  return found;
};

// The trigger most workflows in the feedback started from.
const INCIDENT_TRIGGER: NodeDataProp = makeNode(
  findStep(INCIDENT_STEPS, "-on-create"),
  "incident-on-create-1",
);

type DocsOfFunction = (
  metadata: ComponentMetadata,
  graph?: Array<NodeDataProp> | undefined,
) => ComponentDocumentation;

const docsOf: DocsOfFunction = (
  metadata: ComponentMetadata,
  graph?: Array<NodeDataProp> | undefined,
): ComponentDocumentation => {
  const documentation: ComponentDocumentation | null =
    getComponentDocumentation({
      metadata: metadata,
      stepId: STEP_ID,
      graphComponents: graph || [],
    });

  if (!documentation) {
    throw new Error(`${metadata.id} has no help`);
  }

  return documentation;
};

type AllExamplesFunction = (
  documentation: ComponentDocumentation,
) => Array<ComponentDocumentationExample>;

const allExamples: AllExamplesFunction = (
  documentation: ComponentDocumentation,
): Array<ComponentDocumentationExample> => {
  return [
    ...documentation.examples,
    ...documentation.learnMore
      .map((topic: ComponentDocumentationTopic) => {
        return topic.example;
      })
      .filter(
        (
          example: ComponentDocumentationExample | undefined,
        ): example is ComponentDocumentationExample => {
          return Boolean(example);
        },
      ),
  ];
};

type AllTextFunction = (documentation: ComponentDocumentation) => Array<string>;

// Every piece of help text, marks and all: what a reader reads.
const allText: AllTextFunction = (
  documentation: ComponentDocumentation,
): Array<string> => {
  return [
    documentation.summary,
    ...documentation.steps,
    ...documentation.notes.map((note: ComponentDocumentationNote) => {
      return note.text;
    }),
    ...documentation.learnMore.flatMap((topic: ComponentDocumentationTopic) => {
      return topic.paragraphs;
    }),
    ...allExamples(documentation).flatMap(
      (example: ComponentDocumentationExample) => {
        return example.description ? [example.description] : [];
      },
    ),
  ];
};

type AllPastableFunction = (
  documentation: ComponentDocumentation,
) => Array<string>;

// Everything meant to be typed or pasted: code and the values of settings.
const allPastable: AllPastableFunction = (
  documentation: ComponentDocumentation,
): Array<string> => {
  return allExamples(documentation).flatMap(
    (example: ComponentDocumentationExample) => {
      return [
        ...(example.code ? [example.code] : []),
        ...(example.fields || []).map((field: { value: string }) => {
          return field.value;
        }),
      ];
    },
  );
};

type ComponentReferencesFunction = (
  text: string,
) => Array<{ componentId: string; returnValueId: string }>;

// Every {{local.components.<id>.returnValues.<value>...}} in a piece of text.
const componentReferences: ComponentReferencesFunction = (
  text: string,
): Array<{ componentId: string; returnValueId: string }> => {
  const found: Array<{ componentId: string; returnValueId: string }> = [];

  for (const expression of parseTemplateExpressions(text)) {
    const inner: string =
      expression.kind === TemplateExpressionKind.EachOpen
        ? expression.inner.replace(/^#each\s+/, "")
        : expression.inner;

    if (
      expression.kind !== TemplateExpressionKind.Reference &&
      expression.kind !== TemplateExpressionKind.EachOpen
    ) {
      continue;
    }

    const parsed: ParsedReferencePath = parseReferencePath(inner);

    if (parsed.rootType === ReferenceRootType.ComponentReturnValue) {
      found.push({
        componentId: parsed.componentId as string,
        returnValueId: parsed.returnValueId as string,
      });
    }
  }

  return found;
};

type NamesOnStepFunction = (metadata: ComponentMetadata) => Set<string>;

// What a step calls its own settings, ports and values.
const namesOnStep: NamesOnStepFunction = (
  metadata: ComponentMetadata,
): Set<string> => {
  return new Set<string>([
    ...metadata.arguments.map((argument: Argument) => {
      return argument.name;
    }),
    ...(metadata.runWorkflowManuallyArguments || []).map(
      (argument: Argument) => {
        return argument.name;
      },
    ),
    ...[...metadata.inPorts, ...metadata.outPorts].map((port: Port) => {
      return port.title;
    }),
    ...metadata.returnValues.map((returnValue: ReturnValue) => {
      return returnValue.name;
    }),
  ]);
};

/*
 * Names the help uses that are not on the step itself: buttons and sections
 * of the builder, and places in the dashboard. Each is checked below against
 * the source that draws it, so renaming one fails here rather than leaving the
 * help pointing at a button that is not there.
 */
const UI_LABELS: Record<string, Array<{ file: string; text: string }>> = {
  "Run Workflow": [
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder.tsx",
      text: 'title="Run Workflow"',
    },
  ],
  "Try it": [
    {
      file: "Common/UI/Components/Workflow/WebhookTriggerPanel.tsx",
      text: 'tryIt: "Try it"',
    },
  ],
  Returns: [
    {
      file: "Common/UI/Components/Workflow/ComponentSettingsModal.tsx",
      text: 'title="Returns"',
    },
  ],
  "Edit as JSON": [
    {
      file: "Common/UI/Components/Workflow/ModelColumnEditor.tsx",
      text: '"Edit as JSON"',
    },
  ],
  "Add a field": [
    {
      file: "Common/UI/Components/Workflow/ColumnEditor/ModelRecordForm.tsx",
      text: 'triggerLabel={translationKey("Add a field")}',
    },
  ],
  "Compare as": [
    {
      file: "Common/UI/Components/Workflow/Condition/ConditionModel.ts",
      text: 'COMPARE_AS_LABEL: string = translationKey("Compare as")',
    },
  ],
  "Project Settings → AI → LLM Providers": [
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Settings/Layout.tsx",
      text: '"Project Settings"',
    },
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
      text: 'title: "AI",',
    },
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
      text: 'title: "LLM Providers"',
    },
  ],
  "Project Settings → AI → AI Logs": [
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Settings/Layout.tsx",
      text: '"Project Settings"',
    },
    {
      file: "App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
      text: 'title: "AI Logs"',
    },
  ],
};

const BUILT_IN_TITLES: Set<string> = new Set<string>(
  BUILT_IN.map((metadata: ComponentMetadata) => {
    return metadata.title;
  }),
);

type UnknownNamesFunction = (
  metadata: ComponentMetadata,
  documentation: ComponentDocumentation,
) => Array<string>;

// The names a step's help uses that nothing on screen is called.
const unknownNames: UnknownNamesFunction = (
  metadata: ComponentMetadata,
  documentation: ComponentDocumentation,
): Array<string> => {
  const known: Set<string> = namesOnStep(metadata);

  return allText(documentation)
    .flatMap(getDocumentationTextNames)
    .filter((name: string) => {
      return (
        !known.has(name) &&
        !BUILT_IN_TITLES.has(name) &&
        !Object.keys(UI_LABELS).includes(name)
      );
    });
};

type EscapeRegExpFunction = (text: string) => string;

const escapeRegExp: EscapeRegExpFunction = (text: string): string => {
  return text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
};

type ReadPackageFileFunction = (file: string) => string;

const readPackageFile: ReadPackageFileFunction = (file: string): string => {
  return fs.readFileSync(path.join(PACKAGES_DIR, file), "utf8");
};

type DocsAnchorsFunction = (page: string) => Set<string> | null;

// The anchors of an English docs page, as the docs site renders them.
const docsAnchors: DocsAnchorsFunction = (page: string): Set<string> | null => {
  const file: string = path.join(
    PACKAGES_DIR,
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    `${page}.md`,
  );

  if (!fs.existsSync(file)) {
    return null;
  }

  const anchors: Set<string> = new Set<string>();
  let isInFence: boolean = false;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("```")) {
      isInFence = !isInFence;
      continue;
    }

    const heading: RegExpMatchArray | null = isInFence
      ? null
      : line.match(/^#{1,6}\s+(.+?)\s*$/);

    if (heading) {
      anchors.add(MarkdownSlugify(heading[1] as string));
    }
  }

  return anchors;
};

describe("every step has help", () => {
  test("the table of built-in help covers every ComponentID", () => {
    expect(Object.keys(BUILT_IN_COMPONENT_DOCUMENTATION).sort()).toEqual(
      Object.values(ComponentID).sort(),
    );
  });

  test("every built-in step has help", () => {
    const missing: Array<string> = BUILT_IN.filter(
      (metadata: ComponentMetadata) => {
        return !getComponentDocumentation({
          metadata,
          stepId: STEP_ID,
        });
      },
    ).map((metadata: ComponentMetadata) => {
      return metadata.id;
    });

    expect(BUILT_IN.length).toBe(Object.values(ComponentID).length);
    expect(missing).toEqual([]);
  });

  test("every database step of every model has help", () => {
    const missing: Array<string> = DATABASE.filter(
      (metadata: ComponentMetadata) => {
        return !getComponentDocumentation({
          metadata,
          stepId: STEP_ID,
        });
      },
    ).map((metadata: ComponentMetadata) => {
      return metadata.id;
    });

    // Hundreds of models, so the check is not vacuous.
    expect(DATABASE.length).toBeGreaterThan(1000);
    expect(missing).toEqual([]);
  });

  test("no step carries a link to a Markdown file any more", () => {
    for (const metadata of [...BUILT_IN, ...DATABASE]) {
      expect(Object.keys(metadata)).not.toContain("documentationLink");
    }

    expect(
      fs.existsSync(
        path.join(
          PACKAGES_DIR,
          "App",
          "FeatureSet",
          "Workflow",
          "Docs",
          "ComponentDocumentation",
        ),
      ),
    ).toBe(false);
    expect(readPackageFile("App/FeatureSet/Workflow/Index.ts")).not.toMatch(
      /\/docs\/:componentName/,
    );
  });

  test("a step that is neither built in nor generated has none, rather than someone else's", () => {
    const stranger: ComponentMetadata = {
      ...findStep(BUILT_IN, ComponentID.Log),
      id: "not-a-real-step",
    };

    expect(
      getComponentDocumentation({ metadata: stranger, stepId: STEP_ID }),
    ).toBeNull();
  });
});

describe("what is not collapsed stays short", () => {
  /*
   * The help sits at the bottom of the step's dialog. What shows before Learn
   * more is opened is what most people will read, so it is held to a budget:
   * one sentence on what the step does, at most four steps, two examples and
   * three callouts, each of them short.
   */
  const SAMPLE: Array<ComponentMetadata> = [...BUILT_IN, ...INCIDENT_STEPS];

  test.each(
    SAMPLE.map((metadata: ComponentMetadata) => {
      return [metadata.id, metadata] as [string, ComponentMetadata];
    }),
  )("%s", (_id: string, metadata: ComponentMetadata) => {
    for (const graph of [[], [INCIDENT_TRIGGER]]) {
      const documentation: ComponentDocumentation = docsOf(metadata, graph);
      const summary: string = documentationTextToPlain(documentation.summary);

      // One sentence, which says what the step does.
      expect(summary).toMatch(/^[A-Z].*\.$/);
      expect(summary.length).toBeLessThanOrEqual(130);
      expect(summary.slice(0, -1)).not.toMatch(/\.\s/);

      expect(documentation.steps.length).toBeGreaterThanOrEqual(2);
      expect(documentation.steps.length).toBeLessThanOrEqual(4);

      for (const step of documentation.steps) {
        expect(documentationTextToPlain(step).length).toBeLessThanOrEqual(200);
      }

      expect(documentation.examples.length).toBeGreaterThanOrEqual(1);
      expect(documentation.examples.length).toBeLessThanOrEqual(2);
      expect(documentation.notes.length).toBeLessThanOrEqual(3);

      for (const note of documentation.notes) {
        expect(documentationTextToPlain(note.text).length).toBeLessThanOrEqual(
          220,
        );
      }

      for (const topic of documentation.learnMore) {
        expect(topic.title.length).toBeGreaterThan(0);
        expect(topic.paragraphs.length).toBeGreaterThan(0);
      }

      // Somewhere to go for the rest.
      expect(documentation.links.length).toBeGreaterThan(0);
    }
  });
});

describe("every name the help uses is real", () => {
  test("built-in steps name only their own settings, ports and values, other steps and real buttons", () => {
    const unknown: Array<string> = [];

    for (const metadata of BUILT_IN) {
      for (const graph of [[], [INCIDENT_TRIGGER]]) {
        for (const name of unknownNames(metadata, docsOf(metadata, graph))) {
          unknown.push(`${metadata.id}: ${name}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  test("so do the database steps of every model", () => {
    const unknown: Array<string> = [];

    for (const metadata of DATABASE) {
      for (const name of unknownNames(metadata, docsOf(metadata))) {
        unknown.push(`${metadata.id}: ${name}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  test("the help actually names things, so the check above is not vacuous", () => {
    const names: Array<string> = allText(
      docsOf(findStep(INCIDENT_STEPS, "-on-update")),
    ).flatMap(getDocumentationTextNames);

    expect(names).toEqual(
      expect.arrayContaining(["Listen on", "Select Fields", "Success"]),
    );
  });

  test.each(Object.keys(UI_LABELS))(
    '"%s" is still what the dashboard calls it',
    (label: string) => {
      for (const where of UI_LABELS[label] || []) {
        expect({
          label: label,
          file: where.file,
          found: readPackageFile(where.file).includes(where.text),
        }).toEqual({ label: label, file: where.file, found: true });
      }
    },
  );

  test("On Delete never mentions Select Fields, which it does not have", () => {
    for (const metadata of DATABASE.filter((step: ComponentMetadata) => {
      return step.id.endsWith("-on-delete");
    })) {
      expect(allText(docsOf(metadata)).join(" ")).not.toContain(
        "Select Fields",
      );
      expect(metadata.arguments).toEqual([]);
    }
  });

  test("Create One never talks about Create Many", () => {
    const text: string = allText(
      docsOf(findStep(INCIDENT_STEPS, "-create-one")),
    ).join(" ");

    expect(text).not.toMatch(/Create Many|JSON Array/);
  });
});

describe("examples are built from this step and this workflow", () => {
  test("a step that returns something shows how to read it, by its own identifier", () => {
    const withoutOwnReference: Array<string> = [];

    for (const metadata of [...BUILT_IN, ...INCIDENT_STEPS]) {
      if (metadata.returnValues.length === 0) {
        continue;
      }

      const documentation: ComponentDocumentation = docsOf(metadata);
      const own: Array<{ componentId: string }> = [
        ...allPastable(documentation),
        ...allText(documentation),
      ]
        .flatMap(componentReferences)
        .filter((reference: { componentId: string }) => {
          return reference.componentId === STEP_ID;
        });

      if (own.length === 0) {
        withoutOwnReference.push(metadata.id);
      }
    }

    expect(withoutOwnReference).toEqual([]);
  });

  test("every reference to this step names a value it really returns", () => {
    const wrong: Array<string> = [];

    for (const metadata of [...BUILT_IN, ...DATABASE]) {
      const documentation: ComponentDocumentation = docsOf(metadata, [
        INCIDENT_TRIGGER,
      ]);
      const returnValueIds: Array<string> = metadata.returnValues.map(
        (returnValue: ReturnValue) => {
          return returnValue.id;
        },
      );

      for (const reference of [
        ...allPastable(documentation),
        ...allText(documentation),
      ].flatMap(componentReferences)) {
        if (reference.componentId !== STEP_ID) {
          continue;
        }

        // `<key>` stands for whatever key the caller sends.
        if (PLACEHOLDER.test(reference.returnValueId)) {
          continue;
        }

        if (!returnValueIds.includes(reference.returnValueId)) {
          wrong.push(`${metadata.id}: ${reference.returnValueId}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /*
   * Two examples are about a step that is not in this workflow, and say so:
   * If / Else's, when the workflow has nothing to compare yet, reads "an API
   * step called api-get-1"; Execute Workflow's is about the other workflow's
   * Manual trigger. Every other reference is to this step or a real one.
   */
  const HYPOTHETICAL_STEPS: Record<string, Array<string>> = {
    [ComponentID.IfElse]: ["api-get-1"],
    [ComponentID.WorkflowRun]: ["manual-1"],
  };

  test("every other step an example reads from is in the workflow", () => {
    const invented: Array<string> = [];

    for (const metadata of [...BUILT_IN, ...INCIDENT_STEPS]) {
      for (const graph of [[], [INCIDENT_TRIGGER]]) {
        const inGraph: Array<string> = [
          STEP_ID,
          ...graph.map((step: NodeDataProp) => {
            return step.id;
          }),
          ...(HYPOTHETICAL_STEPS[metadata.id] || []),
        ];

        for (const reference of [
          ...allPastable(docsOf(metadata, graph)),
          ...allText(docsOf(metadata, graph)),
        ].flatMap(componentReferences)) {
          if (!inGraph.includes(reference.componentId)) {
            invented.push(`${metadata.id}: ${reference.componentId}`);
          }
        }
      }
    }

    expect(invented).toEqual([]);
  });

  test("renaming the step renames it in every example", () => {
    const metadata: ComponentMetadata = findStep(BUILT_IN, ComponentID.Webhook);

    for (const stepId of ["webhook-1", "ci-webhook"]) {
      const documentation: ComponentDocumentation | null =
        getComponentDocumentation({ metadata, stepId });

      expect(documentation?.examples[0]?.code).toBe(
        `{{local.components.${stepId}.returnValues.request-body.message}}`,
      );
    }
  });

  test("message steps put in a value from the workflow's own trigger", () => {
    for (const id of [
      ComponentID.SlackSendMessageToChannel,
      ComponentID.MicrosoftTeamsSendMessageToChannel,
      ComponentID.DiscordSendMessageToChannel,
      ComponentID.TelegramSendMessageToChat,
      ComponentID.SendEmail,
      ComponentID.Log,
    ]) {
      const metadata: ComponentMetadata = findStep(BUILT_IN, id);
      const example: ComponentDocumentationExample | undefined = docsOf(
        metadata,
        [INCIDENT_TRIGGER, makeNode(metadata, STEP_ID)],
      ).examples[0];

      expect({ id, code: example?.code }).toEqual({
        id,
        code: expect.stringContaining(
          "{{local.components.incident-on-create-1.returnValues.model.title}}",
        ),
      });
      expect(example?.description).toContain(
        "Title of the Incident from `incident-on-create-1`",
      );
    }
  });

  test("with nothing to read from yet, a message example invents no step", () => {
    const example: ComponentDocumentationExample | undefined = docsOf(
      findStep(BUILT_IN, ComponentID.SlackSendMessageToChannel),
    ).examples[0];

    expect(example?.code).not.toContain("{{");
  });

  test("a Schedule trigger, which returns nothing, is passed over for a step that does", () => {
    const schedule: NodeDataProp = makeNode(
      findStep(BUILT_IN, ComponentID.Schedule),
      "schedule-1",
    );
    const api: NodeDataProp = makeNode(
      findStep(BUILT_IN, ComponentID.ApiGet),
      "status-check",
    );

    expect(
      docsOf(findStep(BUILT_IN, ComponentID.SlackSendMessageToChannel), [
        schedule,
        api,
      ]).examples[0]?.code,
    ).toBe(
      "*Heads up:* {{local.components.status-check.returnValues.response-body}}",
    );
  });
});

describe("what is meant to be pasted is valid", () => {
  test("every JSON example parses once its references are filled in", () => {
    const broken: Array<string> = [];

    for (const metadata of [...BUILT_IN, ...DATABASE]) {
      for (const value of allPastable(docsOf(metadata, [INCIDENT_TRIGGER]))) {
        const trimmed: string = value.trim();

        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
          continue;
        }

        // A lone reference is a reference, not a JSON document.
        if (trimmed.startsWith("{{") && !trimmed.startsWith("{{#each")) {
          continue;
        }

        if (!checkJSONSyntax(trimmed).isValid) {
          broken.push(`${metadata.id}: ${trimmed}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  test("an example that fills in settings names settings the step has", () => {
    const wrong: Array<string> = [];
    let fieldsSeen: number = 0;

    for (const metadata of BUILT_IN) {
      const names: Array<string> = metadata.arguments.map(
        (argument: Argument) => {
          return argument.name;
        },
      );

      for (const graph of [[], [INCIDENT_TRIGGER]]) {
        for (const example of allExamples(docsOf(metadata, graph))) {
          for (const field of example.fields || []) {
            fieldsSeen++;

            if (!names.includes(field.name)) {
              wrong.push(`${metadata.id}: ${field.name}`);
            }
          }
        }
      }
    }

    expect(fieldsSeen).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  test("If / Else's examples pick comparisons its list offers", () => {
    const comparisonLabels: Array<string> = CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison) => {
        return comparison.label;
      },
    );
    const typeLabels: Array<string> = (
      componentInputTypeToFormFieldType(ComponentInputType.ValueType, null)
        .dropdownOptions || []
    ).map((option: DropdownOption) => {
      return option.label;
    });

    const metadata: ComponentMetadata = findStep(BUILT_IN, ComponentID.IfElse);
    let comparisonsSeen: number = 0;

    for (const graph of [[], [INCIDENT_TRIGGER]]) {
      for (const example of docsOf(metadata, graph).examples) {
        for (const field of example.fields || []) {
          if (field.name === "Comparison") {
            comparisonsSeen++;
            expect(comparisonLabels).toContain(field.value);
          }

          if (field.name.endsWith(" type")) {
            expect(typeLabels).toContain(field.value);
          }
        }
      }
    }

    expect(comparisonsSeen).toBeGreaterThanOrEqual(2);
  });

  test("the Schedule example is a cron expression the schedule field accepts", () => {
    const code: string =
      docsOf(findStep(BUILT_IN, ComponentID.Schedule)).examples[0]?.code || "";

    expect(CronTab.isValid(code)).toBe(true);
  });
});

describe("links land on something", () => {
  test("every docs link is an English page with that heading", () => {
    const broken: Array<string> = [];
    const links: Array<ComponentDocumentationLink> = [
      ...BUILT_IN,
      ...INCIDENT_STEPS,
    ].flatMap((metadata: ComponentMetadata) => {
      return docsOf(metadata).links;
    });

    for (const link of links) {
      if (link.site !== ComponentDocumentationLinkSite.Docs) {
        continue;
      }

      const [page, anchor] = link.path.replace(/^\//, "").split("#");
      const anchors: Set<string> | null = docsAnchors(page as string);

      if (!anchors || (anchor && !anchors.has(anchor))) {
        broken.push(link.path);
      }
    }

    expect(links.length).toBeGreaterThan(20);
    expect(broken).toEqual([]);
  });

  test("links out of the product are https", () => {
    for (const metadata of BUILT_IN) {
      for (const link of docsOf(metadata).links) {
        if (link.site === ComponentDocumentationLinkSite.External) {
          expect(link.path).toMatch(/^https:\/\//);
        }
      }
    }
  });

  test("a database step links to its own model's page in the API reference", () => {
    for (const model of [new Incident(), new Monitor(), new TeamMember()]) {
      for (const metadata of BaseModelComponent.getComponents(model)) {
        const reference: ComponentDocumentationLink | undefined = docsOf(
          metadata,
        ).links.find((link: ComponentDocumentationLink) => {
          return link.site === ComponentDocumentationLinkSite.APIReference;
        });

        expect(reference).toEqual({
          title: `Every ${model.singularName} field`,
          site: ComponentDocumentationLinkSite.APIReference,
          path: `/${model.getAPIDocumentationPath()}`,
        });
      }
    }
  });
});

describe("built-in help says what each step really does", () => {
  test("Webhook does not repeat the URL the dialog shows above it", () => {
    const text: string = [
      ...allText(docsOf(findStep(BUILT_IN, ComponentID.Webhook))),
      ...allPastable(docsOf(findStep(BUILT_IN, ComponentID.Webhook))),
    ].join(" ");

    expect(text).toContain("at the top of this dialog");
    expect(text).not.toContain("workflow/trigger/");
    expect(text).not.toContain("{{webhookSecretKey}}");
    expect(text).not.toContain("{{serverUrl}}");
  });

  test("Manual says how another workflow's values arrive", () => {
    const documentation: ComponentDocumentation = docsOf(
      findStep(BUILT_IN, ComponentID.Manual),
    );

    expect(documentation.examples[0]?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.value}}`,
    );
    expect(allText(documentation).join(" ")).toContain(
      `{{local.components.${STEP_ID}.returnValues.<key>}}`,
    );
  });

  test("Slack's warning is the prefix the step checks", () => {
    expect(
      allText(
        docsOf(findStep(BUILT_IN, ComponentID.SlackSendMessageToChannel)),
      ).join(" "),
    ).toContain("`https://hooks.slack.com/services/`");
  });

  test("Teams and Discord name exactly the hosts the steps accept", () => {
    const teams: string = allText(
      docsOf(
        findStep(BUILT_IN, ComponentID.MicrosoftTeamsSendMessageToChannel),
      ),
    ).join(" ");
    const discord: string = allText(
      docsOf(findStep(BUILT_IN, ComponentID.DiscordSendMessageToChannel)),
    ).join(" ");

    for (const domain of MICROSOFT_TEAMS_WEBHOOK_DOMAINS) {
      expect(teams).toContain(`\`${domain}\``);
    }

    for (const domain of DISCORD_WEBHOOK_DOMAINS) {
      expect(discord).toContain(`\`${domain}\``);
    }
  });

  test("Sleep's longest wait is the one the step enforces", () => {
    const days: number = MAX_SLEEP_IN_MS / (24 * 60 * 60 * 1000);

    expect(
      allText(docsOf(findStep(BUILT_IN, ComponentID.Sleep))).join(" "),
    ).toContain(`The longest wait is ${days} days.`);
  });

  test("the API steps only mention a body where they send one", () => {
    for (const id of [ComponentID.ApiPost, ComponentID.ApiPut]) {
      expect(docsOf(findStep(BUILT_IN, id)).steps[0]).toContain(
        "**Request Body**",
      );
    }

    for (const id of [ComponentID.ApiGet, ComponentID.ApiDelete]) {
      expect(docsOf(findStep(BUILT_IN, id)).steps[0]).not.toContain(
        "Request Body",
      );
    }
  });

  test("callouts are tips or warnings, and the irreversible ones are warnings", () => {
    for (const metadata of [...BUILT_IN, ...INCIDENT_STEPS]) {
      for (const note of docsOf(metadata).notes) {
        expect(Object.values(ComponentDocumentationNoteType)).toContain(
          note.type,
        );

        if (CANNOT_BE_UNDONE.test(note.text)) {
          expect(note.type).toBe(ComponentDocumentationNoteType.Warning);
        }
      }
    }
  });
});

describe("database help, operation by operation", () => {
  type IncidentDocsFunction = (
    suffix: string,
    graph?: Array<NodeDataProp> | undefined,
  ) => ComponentDocumentation;

  const incidentDocs: IncidentDocsFunction = (
    suffix: string,
    graph?: Array<NodeDataProp> | undefined,
  ): ComponentDocumentation => {
    return docsOf(findStep(INCIDENT_STEPS, suffix), graph);
  };

  test("the operation is read off the step's id", () => {
    for (const metadata of INCIDENT_STEPS) {
      const operation: DatabaseOperation | null = getDatabaseOperation({
        componentId: metadata.id,
        tableName: metadata.tableName as string,
      });

      expect(operation).not.toBeNull();
      expect(metadata.id.endsWith(`-${operation}`)).toBe(true);
    }

    expect(
      getDatabaseOperation({
        componentId: "incident-something-else",
        tableName: "Incident",
      }),
    ).toBeNull();
    expect(
      getDatabaseOperation({
        componentId: "monitor-find-one",
        tableName: "Incident",
      }),
    ).toBeNull();
  });

  test("every step's summary names its model", () => {
    for (const model of Entities.map((modelType: { new (): BaseModel }) => {
      return new modelType();
    })) {
      for (const metadata of BaseModelComponent.getComponents(model)) {
        const summary: string = docsOf(metadata).summary;

        const names: RegExp = new RegExp(
          [model.singularName || "", model.pluralName || ""]
            .map(escapeRegExp)
            .join("|"),
        );

        expect({ id: metadata.id, summary: summary }).toEqual({
          id: metadata.id,
          summary: expect.stringMatching(names),
        });
      }
    }
  });

  test('no sentence puts "a" or "an" in front of a model\'s name', () => {
    const wrong: Array<string> = [];

    for (const model of Entities.map((modelType: { new (): BaseModel }) => {
      return new modelType();
    })) {
      const pattern: RegExp = new RegExp(
        `\\b(?:a|an|A|An) ${escapeRegExp(model.singularName || "")}\\b`,
      );

      for (const metadata of BaseModelComponent.getComponents(model)) {
        const documentation: ComponentDocumentation = docsOf(metadata);

        for (const text of [
          ...allText(documentation),
          ...allExamples(documentation).map(
            (example: ComponentDocumentationExample) => {
              return example.title;
            },
          ),
        ]) {
          if (pattern.test(documentationTextToPlain(text))) {
            wrong.push(`${metadata.id}: ${text}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("Find One reads the field that names an incident, and says it must be selected", () => {
    const example: ComponentDocumentationExample | undefined =
      incidentDocs("-find-one").examples[0];

    expect(example?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.model.title}}`,
    );
    expect(example?.description).toContain("**Select Fields**");
  });

  test("Find Many reads the first one in the list", () => {
    expect(incidentDocs("-find-many").examples[0]?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.models[0].title}}`,
    );
  });

  test("a model with no name or title is read by its ID", () => {
    const steps: Array<ComponentMetadata> = BaseModelComponent.getComponents(
      new TeamMember(),
    );

    expect(docsOf(findStep(steps, "-find-one")).examples[0]?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.model._id}}`,
    );
  });

  test("Create One shows how to read the new record's ID", () => {
    expect(incidentDocs("-create-one").examples[0]?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.model._id}}`,
    );
  });

  type RecordExamplesFunction = (
    model: BaseModel,
  ) => Array<Dictionary<unknown>>;

  // The records the Create steps' examples write, for one model.
  const recordExamples: RecordExamplesFunction = (
    model: BaseModel,
  ): Array<Dictionary<unknown>> => {
    const records: Array<Dictionary<unknown>> = [];

    for (const metadata of BaseModelComponent.getComponents(model)) {
      if (!CREATE_STEP.test(metadata.id)) {
        continue;
      }

      for (const example of allExamples(docsOf(metadata))) {
        const code: string = (example.code || "").trim();

        if (code.startsWith("[")) {
          records.push(...(JSON.parse(code) as Array<Dictionary<unknown>>));
        } else if (code.startsWith("{") && !code.startsWith("{{")) {
          records.push(JSON.parse(code) as Dictionary<unknown>);
        }
      }
    }

    return records;
  };

  test("the create examples write the fields a create needs, and nothing OneUptime fills in", () => {
    const problems: Array<string> = [];

    for (const model of Entities.map((modelType: { new (): BaseModel }) => {
      return new modelType();
    })) {
      if (!model.enableWorkflowOn?.create) {
        continue;
      }

      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
      const required: Array<string> = getRequiredCreateColumns(model).map(
        (column: { id: string }) => {
          return column.id;
        },
      );

      for (const record of recordExamples(model)) {
        for (const key of Object.keys(record)) {
          if (!columns[key]) {
            problems.push(`${model.tableName}: ${key} is not a column`);
          }

          if (
            isSystemColumnId(key) ||
            key === model.getTenantColumn() ||
            columns[key]?.computed
          ) {
            problems.push(
              `${model.tableName}: ${key} is filled in by OneUptime`,
            );
          }
        }

        // Up to three fields are shown; the required ones come first.
        for (const key of required.slice(0, 3)) {
          if (!(key in record)) {
            problems.push(`${model.tableName}: required ${key} is missing`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("Create Many is a list, and says which fields every item needs", () => {
    const example: ComponentDocumentationExample | undefined =
      incidentDocs("-create-many").examples[0];
    const list: Array<Dictionary<unknown>> = JSON.parse(
      example?.code || "",
    ) as Array<Dictionary<unknown>>;

    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toEqual({
      title: "Database connection failure in production",
      incidentSeverityId: EXAMPLE_ID,
    });
    expect(example?.description).toBe(
      "Every Incident needs `title`, `incidentSeverityId`.",
    );
  });

  test("Update One and Delete One pick the trigger's own record by ID when there is one", () => {
    for (const suffix of ["-update-one", "-delete-one", "-find-one"]) {
      const documentation: ComponentDocumentation = incidentDocs(suffix, [
        INCIDENT_TRIGGER,
      ]);
      const query: ComponentDocumentationExample | undefined = allExamples(
        documentation,
      ).find((example: ComponentDocumentationExample) => {
        return example.title.startsWith("Query");
      });

      expect(query?.code).toBe(
        '{"_id": "{{local.components.incident-on-create-1.returnValues.model._id}}"}',
      );
    }
  });

  test("without such a step, and on the Many steps, the query matches on a field", () => {
    expect(incidentDocs("-update-one").examples[0]?.code).toBe(
      '{"title": "Database connection failure in production"}',
    );
    expect(
      incidentDocs("-delete-many", [INCIDENT_TRIGGER]).examples[0]?.code,
    ).toBe('{"title": "Database connection failure in production"}');
  });

  test("a trigger of another model is not mistaken for this one's record", () => {
    const monitorTrigger: NodeDataProp = makeNode(
      findStep(BaseModelComponent.getComponents(new Monitor()), "-on-create"),
      "monitor-on-create-1",
    );

    expect(
      incidentDocs("-update-one", [monitorTrigger]).examples[0]?.code,
    ).not.toContain("monitor-on-create-1");
  });

  test("Update Many and Delete Many warn about the limit their Limit setting describes", () => {
    for (const suffix of ["-update-many", "-delete-many"]) {
      const metadata: ComponentMetadata = findStep(INCIDENT_STEPS, suffix);
      const limit: Argument | undefined = metadata.arguments.find(
        (argument: Argument) => {
          return argument.id === "limit";
        },
      );

      expect(limit?.description).toContain("Defaults to 10");
      expect(
        docsOf(metadata)
          .notes.map((note: ComponentDocumentationNote) => {
            return note.text;
          })
          .join(" "),
      ).toMatch(/at most 10 .*\*\*Limit\*\*/);
    }
  });

  test("deleting says it cannot be undone, as a warning", () => {
    for (const suffix of ["-delete-one", "-delete-many"]) {
      const warnings: Array<string> = incidentDocs(suffix)
        .notes.filter((note: ComponentDocumentationNote) => {
          return note.type === ComponentDocumentationNoteType.Warning;
        })
        .map((note: ComponentDocumentationNote) => {
          return note.text;
        });

      expect(warnings.join(" ")).toContain("cannot be undone");
    }

    expect(
      incidentDocs("-delete-many")
        .notes.map((note: ComponentDocumentationNote) => {
          return note.text;
        })
        .join(" "),
    ).toContain("an empty query matches every Incident");
  });

  test("the triggers say how to start a test run, with Run Workflow", () => {
    for (const suffix of ["-on-create", "-on-update", "-on-delete"]) {
      const metadata: ComponentMetadata = findStep(INCIDENT_STEPS, suffix);

      expect(metadata.componentType).toBe(ComponentType.Trigger);
      expect(allText(docsOf(metadata)).join(" ")).toContain("**Run Workflow**");
    }
  });

  test("On Update explains Listen on; On Create does not mention it", () => {
    expect(incidentDocs("-on-update").steps.join(" ")).toContain(
      "**Listen on**",
    );
    expect(allText(incidentDocs("-on-create")).join(" ")).not.toContain(
      "Listen on",
    );
  });

  test("On Delete says only the ID is passed on, because that is all the event carries", () => {
    const documentation: ComponentDocumentation = incidentDocs("-on-delete");

    expect(documentation.examples[0]?.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.model._id}}`,
    );
    expect(
      documentation.notes
        .map((note: ComponentDocumentationNote) => {
          return note.text;
        })
        .join(" "),
    ).toContain("Only the ID is passed on.");

    // DatabaseService posts { _id, miscData } to the trigger, and nothing else.
    expect(
      readPackageFile("Common/Server/Services/DatabaseService.ts"),
    ).toMatch(/data: \{\s*data: \{\s*_id: id\.toString\(\),\s*miscData/);
  });
});
