// UX rule: Docs/ux/README.md#help-dialogs
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import getHelpDocumentProblems, {
  HELP_LEAD_MAX_LENGTH,
  HelpDocumentProblem,
} from "../../../UI/Components/Help/HelpDocumentRules";
import {
  getLabelRuleHelpMarkdown,
  getOwnerRuleHelpMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Help/ResourceRuleHelp";
import { getMeasurementsHelpMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementHelp";
import { getRunbookRuleDocumentation } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRulesTable";
import { guideToMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import DetectionRulesGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import ThreatIntelGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { getEntityRiskGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide";
import { securityEventConnectionsHelpMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable";
import { buildMappingHelp } from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Base/CustomFieldsPageBase";
import { getErasureHelpMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCopy";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";
import { MeasurementDomain } from "../../../Utils/Measurement/MeasurementMoments";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";
import { CustomFieldMappingSourceInfo } from "../../../Types/CustomField/CustomFieldMappingCatalog";

/*
 * EVERY HELP DIALOG SAYS WHAT THE THING IS FIRST, THEN ITS TOPICS (#8889).
 *
 * A list's help (?) opened a page of markdown as wide as the screen: "How
 * SLOs Work" was six headings, a rule between each and paragraph after
 * paragraph of bold, with nothing to say what was further down. The help
 * dialog (Common HelpModal) now reads a document as a lead, shown as "In
 * short", and "##" topics opened one at a time. A document only reads that
 * way when it is written that way, so this reads every page's help:
 *
 *   - every helpContent in the Dashboard, its markdown found where the page
 *     writes it - a literal in the page, or a builder this suite calls for
 *     every kind of page it serves (KNOWN_BUILDERS);
 *   - and holds each to HelpDocumentRules: a lead of at most three
 *     sentences, "##" topics, no heading that repeats the dialog's title,
 *     and no line drawn between the topics.
 *
 * A page that writes its help any other way - a builder this suite does not
 * know - fails until the builder is added here, with the documents it
 * builds.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

interface FoundHelp {
  file: string;
  title: string | undefined;
  // The markdown, when the page writes it as a literal.
  markdown: string | undefined;
  // The builder it calls, when it calls one.
  builder: string | undefined;
}

// The builders a page may write its help with, each checked below.
const KNOWN_BUILDERS: ReadonlyArray<string> = [
  "getLabelRuleHelpMarkdown",
  "getOwnerRuleHelpMarkdown",
  "getMeasurementsHelpMarkdown",
  "getRunbookRuleDocumentation",
  "guideToMarkdown",
  "securityEventConnectionsHelpMarkdown",
  "buildMappingHelp",
  // Erasure Requests' help, in the reader's language (#10908).
  "getErasureHelpMarkdown",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

// A template's text, each ${...} read as a word: its shape is what counts.
const templateText: (node: ts.Node) => string | undefined = (
  node: ts.Node,
): string | undefined => {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span: ts.TemplateSpan): string => {
        return `X${span.literal.text}`;
      }),
    ].join("");
  }

  return undefined;
};

const findVariable: (
  sourceFile: ts.SourceFile,
  name: string,
) => ts.Expression | undefined = (
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | undefined => {
  let found: ts.Expression | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

const propertyOf: (
  object: ts.ObjectLiteralExpression,
  name: string,
) => ts.Expression | undefined = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined => {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      return property.initializer;
    }
  }

  return undefined;
};

const readHelp: (
  file: string,
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
) => FoundHelp = (
  file: string,
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
): FoundHelp => {
  const titleNode: ts.Expression | undefined = propertyOf(object, "title");
  let markdownNode: ts.Expression | undefined = propertyOf(object, "markdown");

  if (markdownNode && ts.isIdentifier(markdownNode)) {
    markdownNode = findVariable(sourceFile, markdownNode.text);
  }

  const builder: string | undefined =
    markdownNode &&
    ts.isCallExpression(markdownNode) &&
    ts.isIdentifier(markdownNode.expression)
      ? markdownNode.expression.text
      : undefined;

  return {
    file: path.relative(DASHBOARD_SOURCE, file),
    title: titleNode ? templateText(titleNode) : undefined,
    markdown: markdownNode ? templateText(markdownNode) : undefined,
    builder: builder,
  };
};

// Every helpContent the Dashboard writes: as a JSX attribute or a property.
const findHelp: () => Array<FoundHelp> = (): Array<FoundHelp> => {
  const found: Array<FoundHelp> = [];

  for (const file of listSourceFiles(DASHBOARD_SOURCE)) {
    const source: string = fs.readFileSync(file, "utf8");

    if (!source.includes("helpContent")) {
      continue;
    }

    const sourceFile: ts.SourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(sourceFile) === "helpContent" &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        ts.isObjectLiteralExpression(node.initializer.expression)
      ) {
        found.push(readHelp(file, sourceFile, node.initializer.expression));
      }

      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "helpContent" &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        found.push(readHelp(file, sourceFile, node.initializer));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return found;
};

const FOUND: Array<FoundHelp> = findHelp();

describe("the help of every page", () => {
  test("the walk found every page's help", () => {
    // 108 when #8889 shaped them all: lists, rules, settings and guides.
    expect(FOUND.length).toBeGreaterThanOrEqual(100);
    // Most of them written on their page, where this suite reads them.
    expect(
      FOUND.filter((help: FoundHelp): boolean => {
        return help.markdown !== undefined;
      }).length,
    ).toBeGreaterThanOrEqual(40);
  });

  test("each is a literal on its page, or written by a builder this suite checks", () => {
    const unknown: Array<string> = FOUND.filter((help: FoundHelp): boolean => {
      return (
        help.markdown === undefined &&
        (!help.builder || !KNOWN_BUILDERS.includes(help.builder))
      );
    }).map((help: FoundHelp): string => {
      return `${help.file}: ${help.builder || "markdown not found"}`;
    });

    expect(unknown).toEqual([]);
  });

  test("each says what the thing is first, then its ## topics, with no title repeated and no line drawn", () => {
    const problems: Array<string> = [];

    for (const help of FOUND) {
      if (help.markdown === undefined) {
        continue;
      }

      for (const problem of getHelpDocumentProblems(help.markdown, {
        title: help.title,
      })) {
        problems.push(`${help.file} (${help.title || "help"}): ${problem}`);
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("the help the builders write", () => {
  const SOURCES: Array<CustomFieldMappingSourceInfo> = [
    {
      title: "Monitor",
      isManySources: true,
    } as CustomFieldMappingSourceInfo,
  ];

  const BUILT: Array<[string, string]> = [
    [
      "a label rule",
      getLabelRuleHelpMarkdown({
        nouns: { singular: "host", plural: "hosts" },
        topics: [{ topic: "A Page's Own Topic", markdown: "Text." }],
      }),
    ],
    [
      "an owner rule",
      getOwnerRuleHelpMarkdown({
        nouns: { singular: "host", plural: "hosts" },
        topics: [{ topic: "A Page's Own Topic", markdown: "Text." }],
      }),
    ],
    ...Object.values(MeasurementDomain).map(
      (domain: MeasurementDomain): [string, string] => {
        return [`${domain} measurements`, getMeasurementsHelpMarkdown(domain)];
      },
    ),
    ...Object.values(RunbookRuleTriggerEntity).map(
      (trigger: RunbookRuleTriggerEntity): [string, string] => {
        return [
          `${trigger} runbook rules`,
          getRunbookRuleDocumentation({
            triggerEntityType: trigger,
            entityLabel: "record",
          }),
        ];
      },
    ),
    ["the Detection Rules guide", guideToMarkdown(DetectionRulesGuide)],
    ["the Threat Intel guide", guideToMarkdown(ThreatIntelGuide)],
    ["the Entity Risk guide", guideToMarkdown(getEntityRiskGuide(50))],
    ["the security event connections", securityEventConnectionsHelpMarkdown()],
    ["copied custom fields", buildMappingHelp(SOURCES)],
    // Every language's wording, as the dialog draws it for its reader.
    ...["en", ...DASHBOARD_LANGUAGES].map(
      (language: string): [string, string] => {
        return [
          `erasure requests, in ${language}`,
          getErasureHelpMarkdown(dashboardTranslator(language)),
        ];
      },
    ),
  ];

  test.each(BUILT)(
    "%s: a lead, then ## topics",
    (_name: string, markdown: string) => {
      expect(getHelpDocumentProblems(markdown)).toEqual([]);
    },
  );
});

describe("the rules, on small documents", () => {
  test("a lead and ## topics pass", () => {
    expect(
      getHelpDocumentProblems("What it is.\n\n## One\n\nText.", {
        title: "How It Works",
      }),
    ).toEqual([]);
  });

  test("a document of only a lead passes: it is the help itself", () => {
    expect(getHelpDocumentProblems("What a monitor is.")).toEqual([]);
  });

  test("no lead, ### topics, the title repeated and drawn lines each fail", () => {
    expect(
      getHelpDocumentProblems(
        "### How SLOs Work\n\nA target.\n\n---\n\n### Archiving\n\nText.",
        { title: "How SLOs Work" },
      ),
    ).toEqual([
      HelpDocumentProblem.NoLead,
      HelpDocumentProblem.TopicsNotLevelTwo,
      HelpDocumentProblem.HeadingRepeatsTitle,
      HelpDocumentProblem.DrawnLine,
    ]);
  });

  test("a lead longer than three sentences fails", () => {
    expect(
      getHelpDocumentProblems(
        `${"word ".repeat(HELP_LEAD_MAX_LENGTH / 4)}\n\n## Topic\n\nText.`,
      ),
    ).toEqual([HelpDocumentProblem.LongLead]);
  });

  test("a line drawn in a code sample is code, not a line between topics", () => {
    expect(
      getHelpDocumentProblems(
        "Lead.\n\n## Topic\n\n```yaml\n---\nkey: value\n```",
      ),
    ).toEqual([]);
  });
});
