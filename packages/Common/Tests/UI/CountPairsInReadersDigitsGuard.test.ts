// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * TWO COUNTS SIDE BY SIDE ARE BOTH WRITTEN IN THE READER'S DIGITS.
 *
 * A count-dependent sentence writes its {{count}} the reader's way
 * (Translator.translatePlural formats it: "۵" in Persian). Every other value
 * goes into a sentence as it is given: a plain number in Latin digits. So a
 * pair of counts - "{{online}}/{{count}} devices online", "{{online}}/
 * {{total}} online", "Attempt {{number}}/{{total}}", "{{shown}} of
 * {{total}}" - read "2/۳" or "2/3" on a Persian page, where every other
 * count chip reads "۲/۳" (issues #6729, #7107).
 *
 * This reads every frontend's source through the TypeScript AST. For each
 * translateTemplate and translatePlural call and each TranslatedSentence
 * whose sentence joins two values by a slash or by " of ", or joins a value
 * to {{count}} by a slash or a colon, each value must be written by a
 * format function - translator.formatNumber, formatReaderNumber, a page's
 * formatCount built on them, or Intl with the reader's locale, directly or
 * as a composedValue's return - and so must a {{count}} that
 * translatePlural does not write itself. A value handed
 * as a slot is read inside its element. A value that names something (a
 * metric, a page, a list of steps) is no count: NOT_A_COUNT says why. The
 * pairs joined by " of " on pages this rule reached later wait in
 * LEFT_TO_WRITE, which only shrinks.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * Two values joined as a pair: by a slash or " of " ("{{shown}} of
 * {{total}}"), or by a colon when one of them is {{count}}.
 */
const JOINED_VALUES: RegExp =
  /\{\{\s*([\w.]+)\s*\}\}(\/| of |:)\{\{\s*([\w.]+)\s*\}\}/g;

// A call that writes a number the reader's way: formatNumber(...), formatCount(...).
const FORMAT_FUNCTION: RegExp = /^format[A-Z]\w*$/;

// A helper that hands back a sentence's values already in the reader's digits.
const VALUES_IN_READERS_DIGITS: RegExp = /^(format[A-Z]\w*|\w+InReaderDigits)$/;

// Intl's locale for the reader: x.toLocaleString(getReaderNumberLocale()).
const READER_LOCALE_FUNCTION: RegExp = /^get(Reader)?NumberLocale$/;

const ANY_DIGIT: RegExp = /\d/;

const WHITESPACE_RUN: RegExp = /\s+/g;

/*
 * Values a " of " sentence joins that are no count: a word, a name or a
 * figure written with its unit by the page's own formatter. Keyed by
 * "<file> {{<value>}}".
 */
const NOT_A_COUNT: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleText.ts {{aggregation}}":
    "an aggregation's name: 'the average of cpu.usage'",
  "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleText.ts {{metric}}":
    "a metric's name",
  "packages/App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowMap.tsx {{page}}":
    "a page's name: '46% of /checkout'",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleSummary.tsx {{steps}}":
    "the steps' names, listed",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard.tsx {{used}}":
    "an amount with its unit, written by the meter's own copy",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard.tsx {{limit}}":
    "an amount with its unit, written by the meter's own copy",
  "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings.tsx {{signal}}":
    "a kind of telemetry's name: 'in the logs of checkout'",
  "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueTelemetryFindings.tsx {{owner}}":
    "a service's name",
  "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudCommitmentsCard.tsx {{covered}}":
    "an amount of money, written by formatCloudMoney with the reader's translator",
  "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudCommitmentsCard.tsx {{eligible}}":
    "an amount of money, written by formatCloudMoney with the reader's translator",
  "packages/App/FeatureSet/Dashboard/src/Pages/Cloud/Budgets.tsx {{spent}}":
    "an amount of money, written by formatCloudMoney with the reader's translator",
  "packages/App/FeatureSet/Dashboard/src/Pages/Cloud/Budgets.tsx {{amount}}":
    "an amount of money, written by formatCloudMoney with the reader's translator",
};

/*
 * Pairs joined by " of " that are counts, on pages this rule reached after
 * the count chips: each still writes a value as a plain number. Fix one by
 * writing the value with translator.formatNumber (or the page's format
 * function), then delete its line here. Keyed by "<file> {{<value>}}".
 */
const LEFT_TO_WRITE: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIAssistance.tsx {{passed}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIAssistance.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayBar.tsx {{position}}",
  "packages/App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayBar.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Logs/LogsDashboard.tsx {{reporting}}",
  "packages/App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyExplorer.tsx {{to}}",
  "packages/App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyExplorer.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyExplorer.tsx {{shown}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx {{shown}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx {{visible}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx {{required}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorResponseTimeCard.tsx {{responded}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorResponseTimeCard.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog.tsx {{step}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog.tsx {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome.ts {{swept}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome.ts {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome.ts {{responded}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome.ts {{scanned}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel.ts {{inView}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel.ts {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel.ts {{down}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSearchBox.tsx {{matchCount}}",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSearchBox.tsx {{totalCount}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage.ts {{order}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage.ts {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/ScheduleTimeline.tsx {{shown}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/ScheduleTimeline.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList.tsx {{used}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx {{number}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx {{max}}",
  "packages/App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackHostGroups.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateRunner.ts {{created}}",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleSummary.tsx {{count}}",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityGettingStarted.tsx {{done}}",
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityGettingStarted.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloMonitorsSummaryCard.tsx {{monitors}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/HierarchyTopologyViewModel.ts {{levelSize}}",
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/HierarchyTopologyViewModel.ts {{devices}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx {{used}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/DataTypes.tsx {{on}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/Settings/DataTypes.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkSite/NetworkMap.tsx {{attention}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/NetworkSite/NetworkMap.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx {{verified}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx {{covered}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index.tsx {{used}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index.tsx {{total}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx {{completed}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Readiness.tsx {{covered}}",
  "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Readiness.tsx {{total}}",
  "packages/Common/UI/Components/CSVFileUpload/CSVFileUpload.tsx {{shown}}",
  "packages/Common/UI/Components/Forms/BasicForm.tsx {{current}}",
  "packages/Common/UI/Components/Forms/BasicForm.tsx {{total}}",
  "packages/Common/UI/Components/LabelRule/ImportLabelRulesModal.tsx {{page}}",
  "packages/Common/UI/Components/LabelRule/ImportLabelRulesModal.tsx {{pages}}",
];

interface CountPairSite {
  file: string;
  line: number;
  // The sentence's English, its general form for a count-dependent one.
  template: string;
  // The value joined to another: "online".
  value: string;
  // How it is filled: "translator.formatNumber(onlineDevices)", or why it is not.
  filledWith: string;
  isInReadersDigits: boolean;
}

interface Filled {
  filledWith: string;
  isInReadersDigits: boolean;
}

const stringOf: (node: ts.Node | undefined) => string | undefined = (
  node: ts.Node | undefined,
): string | undefined => {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return undefined;
};

const nameOf: (name: ts.PropertyName | undefined) => string | undefined = (
  name: ts.PropertyName | undefined,
): string | undefined => {
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
    return name.text;
  }

  return undefined;
};

const propertyNamed: (
  object: ts.ObjectLiteralExpression,
  name: string,
) => ts.ObjectLiteralElementLike | undefined = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined => {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return nameOf(property.name) === name;
    },
  );
};

const calleeName: (expression: ts.Expression) => string = (
  expression: ts.Expression,
): string => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return "";
};

const unwrap: (expression: ts.Expression) => ts.Expression = (
  expression: ts.Expression,
): ts.Expression => {
  let inner: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression;
  }

  return inner;
};

// Every pair-joined value of one module's source.
const findCountPairSites: (
  fileName: string,
  text: string,
) => Array<CountPairSite> = (
  fileName: string,
  text: string,
): Array<CountPairSite> => {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: Array<CountPairSite> = [];

  // The module's constants, by name: a template or values defined once and used below.
  const declarations: Map<string, ts.Expression> = new Map<
    string,
    ts.Expression
  >();

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      // A name declared twice is no single value to read: left unresolved.
      declarations.set(
        node.name.text,
        declarations.has(node.name.text)
          ? ts.factory.createIdentifier(node.name.text)
          : node.initializer,
      );
    }

    ts.forEachChild(node, collect);
  };

  collect(source);

  const resolve: (expression: ts.Expression) => ts.Expression = (
    expression: ts.Expression,
  ): ts.Expression => {
    const inner: ts.Expression = unwrap(expression);

    if (ts.isIdentifier(inner)) {
      const declared: ts.Expression | undefined = declarations.get(inner.text);

      if (declared && declared !== inner && !ts.isIdentifier(declared)) {
        return unwrap(declared);
      }
    }

    return inner;
  };

  // The English sentences a template expression holds: a string, its forms, a key.
  const sentencesOf: (
    expression: ts.Expression | undefined,
  ) => Array<string> = (
    expression: ts.Expression | undefined,
  ): Array<string> => {
    if (!expression) {
      return [];
    }

    const node: ts.Expression = resolve(expression);
    const text: string | undefined = stringOf(node);

    if (text !== undefined) {
      return [text];
    }

    if (ts.isConditionalExpression(node)) {
      return [...sentencesOf(node.whenTrue), ...sentencesOf(node.whenFalse)];
    }

    if (
      ts.isCallExpression(node) &&
      calleeName(node.expression) === "translationKey"
    ) {
      return sentencesOf(node.arguments[0]);
    }

    if (ts.isObjectLiteralExpression(node)) {
      return ["one", "other"].flatMap((form: string): Array<string> => {
        const property: ts.ObjectLiteralElementLike | undefined = propertyNamed(
          node,
          form,
        );

        return property && ts.isPropertyAssignment(property)
          ? sentencesOf(property.initializer)
          : [];
      });
    }

    return [];
  };

  // What a function hands back: its arrow's body, or its one return.
  const returnedBy: (
    expression: ts.Expression | undefined,
  ) => ts.Expression | undefined = (
    expression: ts.Expression | undefined,
  ): ts.Expression | undefined => {
    const node: ts.Expression | undefined = expression
      ? unwrap(expression)
      : undefined;

    if (!node || !(ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      return undefined;
    }

    if (!ts.isBlock(node.body)) {
      return node.body;
    }

    const statements: ts.NodeArray<ts.Statement> = node.body.statements;
    const only: ts.Statement | undefined =
      statements.length === 1 ? statements[0] : undefined;

    return only && ts.isReturnStatement(only) ? only.expression : undefined;
  };

  // Whether an expression writes its number the reader's way.
  const howWritten: (expression: ts.Expression, depth: number) => Filled = (
    expression: ts.Expression,
    depth: number,
  ): Filled => {
    const written: string = expression
      .getText(source)
      .replace(WHITESPACE_RUN, " ");
    const node: ts.Expression = unwrap(expression);

    /*
     * A value composed for its sentence - composedValue((sentence) =>
     * sentence.formatNumber(sent)) - is written as its function returns it.
     */
    if (
      ts.isCallExpression(node) &&
      calleeName(node.expression) === "composedValue"
    ) {
      const returned: ts.Expression | undefined = returnedBy(node.arguments[0]);

      return {
        filledWith: written,
        isInReadersDigits: returned
          ? howWritten(returned, depth).isInReadersDigits
          : false,
      };
    }

    if (ts.isCallExpression(node)) {
      const name: string = calleeName(node.expression);
      const locale: ts.Expression | undefined = node.arguments[0];

      return {
        filledWith: written,
        isInReadersDigits:
          FORMAT_FUNCTION.test(name) ||
          (name === "toLocaleString" &&
            Boolean(locale) &&
            ts.isCallExpression(unwrap(locale!)) &&
            READER_LOCALE_FUNCTION.test(
              calleeName((unwrap(locale!) as ts.CallExpression).expression),
            )),
      };
    }

    if (ts.isConditionalExpression(node)) {
      const whenTrue: Filled = howWritten(node.whenTrue, depth);
      const whenFalse: Filled = howWritten(node.whenFalse, depth);

      return {
        filledWith: written,
        isInReadersDigits:
          whenTrue.isInReadersDigits && whenFalse.isInReadersDigits,
      };
    }

    // A fixed mark with no digit in it, as "—" or "?" for a count not known.
    const text: string | undefined = stringOf(node);

    if (text !== undefined) {
      return { filledWith: written, isInReadersDigits: !ANY_DIGIT.test(text) };
    }

    if (ts.isIdentifier(node) && depth > 0) {
      const declared: ts.Expression = resolve(node);

      if (declared !== node) {
        return {
          filledWith: written,
          isInReadersDigits: howWritten(declared, depth - 1).isInReadersDigits,
        };
      }
    }

    return { filledWith: written, isInReadersDigits: false };
  };

  // How `values` fills `name`.
  const howFilled: (
    values: ts.Expression | undefined,
    name: string,
  ) => Filled = (values: ts.Expression | undefined, name: string): Filled => {
    if (!values) {
      return { filledWith: "no values", isInReadersDigits: false };
    }

    const node: ts.Expression = resolve(values);

    if (
      ts.isCallExpression(node) &&
      VALUES_IN_READERS_DIGITS.test(calleeName(node.expression))
    ) {
      return {
        filledWith: node.getText(source).replace(WHITESPACE_RUN, " "),
        isInReadersDigits: true,
      };
    }

    if (!ts.isObjectLiteralExpression(node)) {
      return {
        filledWith: `values not written out: ${values.getText(source)}`,
        isInReadersDigits: false,
      };
    }

    const property: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      node,
      name,
    );

    if (!property) {
      return { filledWith: `no ${name}`, isInReadersDigits: false };
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return howWritten(property.name, 1);
    }

    if (!ts.isPropertyAssignment(property)) {
      return {
        filledWith: property.getText(source),
        isInReadersDigits: false,
      };
    }

    return howWritten(property.initializer, 1);
  };

  // How a slot's element writes its number: every expression inside it.
  const howSlotted: (slot: ts.Expression) => Filled = (
    slot: ts.Expression,
  ): Filled => {
    const expressions: Array<ts.Expression> = [];

    const find: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isJsxExpression(node) && node.expression) {
        expressions.push(node.expression);
        return;
      }

      if (ts.isJsxAttributes(node)) {
        return;
      }

      ts.forEachChild(node, find);
    };

    find(slot);

    const filled: Array<Filled> = expressions.map(
      (expression: ts.Expression): Filled => {
        return howWritten(expression, 1);
      },
    );

    return {
      filledWith: slot.getText(source).replace(WHITESPACE_RUN, " "),
      isInReadersDigits:
        filled.length > 0 &&
        filled.every((one: Filled): boolean => {
          return one.isInReadersDigits;
        }),
    };
  };

  const record: (data: {
    at: ts.Node;
    template: ts.Expression | undefined;
    // Whether the call writes {{count}} itself, from its own count.
    writesCount: boolean;
    fill: (name: string) => Filled;
  }) => void = (data: {
    at: ts.Node;
    template: ts.Expression | undefined;
    writesCount: boolean;
    fill: (name: string) => Filled;
  }): void => {
    const seen: Set<string> = new Set<string>();

    for (const sentence of sentencesOf(data.template)) {
      for (const match of sentence.matchAll(JOINED_VALUES)) {
        const [, left, join, right] = match;

        if (join === ":" && left !== "count" && right !== "count") {
          continue;
        }

        for (const name of [left, right]) {
          if (!name || seen.has(name)) {
            continue;
          }

          seen.add(name);

          const filled: Filled = data.fill(name);

          // translatePlural writes {{count}} itself, unless it is handed one.
          if (
            name === "count" &&
            data.writesCount &&
            (filled.filledWith === "no count" ||
              filled.filledWith === "no values")
          ) {
            continue;
          }

          sites.push({
            file: fileName,
            line:
              source.getLineAndCharacterOfPosition(data.at.getStart(source))
                .line + 1,
            template: sentence,
            value: name,
            ...filled,
          });
        }
      }
    }
  };

  const attributeValue: (
    element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ) => ts.Expression | undefined = (
    element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ): ts.Expression | undefined => {
    for (const property of element.attributes.properties) {
      if (
        ts.isJsxAttribute(property) &&
        property.name.getText(source) === name &&
        property.initializer
      ) {
        if (ts.isJsxExpression(property.initializer)) {
          return property.initializer.expression;
        }

        if (ts.isStringLiteral(property.initializer)) {
          return property.initializer;
        }
      }
    }

    return undefined;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name: string = calleeName(node.expression);

      if (name === "translatePlural") {
        const values: ts.Expression | undefined = node.arguments[2];

        record({
          at: node,
          template: node.arguments[0],
          writesCount: true,
          fill: (value: string): Filled => {
            return howFilled(values, value);
          },
        });
      }

      if (name === "translateTemplate") {
        const values: ts.Expression | undefined = node.arguments[1];

        record({
          at: node,
          template: node.arguments[0],
          writesCount: false,
          fill: (value: string): Filled => {
            return howFilled(values, value);
          },
        });
      }
    }

    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source).endsWith("TranslatedSentence")
    ) {
      const values: ts.Expression | undefined = attributeValue(node, "values");
      const slots: ts.Expression | undefined = attributeValue(node, "slots");
      const hasCount: boolean = attributeValue(node, "count") !== undefined;

      record({
        at: node,
        template: attributeValue(node, "template"),
        writesCount: hasCount,
        fill: (value: string): Filled => {
          const slotted: ts.ObjectLiteralElementLike | undefined =
            slots && ts.isObjectLiteralExpression(slots)
              ? propertyNamed(slots, value)
              : undefined;

          if (slotted && ts.isPropertyAssignment(slotted)) {
            return howSlotted(slotted.initializer);
          }

          return howFilled(values, value);
        },
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
};

const SITES: Array<CountPairSite> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<CountPairSite> => {
    return listSourceFiles(root).flatMap(
      (file: string): Array<CountPairSite> => {
        const text: string = fs.readFileSync(file, "utf8");

        if (
          !text.includes("}}/{{") &&
          !text.includes("}} of {{") &&
          !text.includes("}}:{{")
        ) {
          return [];
        }

        return findCountPairSites(toRelativePath(REPOSITORY_ROOT, file), text);
      },
    );
  },
);

const keyOf: (site: CountPairSite) => string = (
  site: CountPairSite,
): string => {
  return `${site.file} {{${site.value}}}`;
};

const describeSite: (site: CountPairSite) => string = (
  site: CountPairSite,
): string => {
  return `${site.file}:${site.line} "${site.template}" {{${site.value}}} filled with ${site.filledWith}`;
};

const isLeftAlone: (site: CountPairSite) => boolean = (
  site: CountPairSite,
): boolean => {
  return (
    NOT_A_COUNT[keyOf(site)] !== undefined ||
    LEFT_TO_WRITE.includes(keyOf(site))
  );
};

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src/";

describe("two counts side by side", () => {
  test("there are such sentences: the count chips, the list cells and the attempts", () => {
    const files: Set<string> = new Set<string>(
      SITES.map((site: CountPairSite): string => {
        return site.file;
      }),
    );

    expect(SITES.length).toBeGreaterThan(100);

    for (const page of [
      "Pages/IoT/View/Index.tsx",
      "Pages/Ceph/View/Index.tsx",
      "Components/Proxmox/Part/ProxmoxPartHero.tsx",
      // The pairs of issue #7107.
      "Pages/IoT/Fleets.tsx",
      "Pages/DockerSwarm/Clusters.tsx",
      "Components/Monitor/SummaryView/ProbeAttemptsView.tsx",
      "Components/Monitor/SummaryView/CustomMonitorSummaryView.tsx",
      "Components/NetworkDevice/DeviceDiagnosticsViewModel.ts",
      "Pages/Kubernetes/View/DeploymentConfigDetail.tsx",
      "Pages/Host/View/ServiceView.tsx",
    ]) {
      expect({ page, scanned: files.has(`${DASHBOARD}${page}`) }).toEqual({
        page,
        scanned: true,
      });
    }
  });

  test("are written in the reader's digits", () => {
    expect(
      SITES.filter((site: CountPairSite): boolean => {
        return !site.isInReadersDigits && !isLeftAlone(site);
      }).map(describeSite),
    ).toEqual([]);
  });

  test("a pair joined by a slash is never left alone: every one is written", () => {
    expect(
      SITES.filter((site: CountPairSite): boolean => {
        return (
          !site.isInReadersDigits &&
          (site.template.includes(`{{${site.value}}}/`) ||
            site.template.includes(`/{{${site.value}}}`))
        );
      }).map(describeSite),
    ).toEqual([]);
  });

  test("each value left alone says why: a word, or a count still to write", () => {
    for (const [key, reason] of Object.entries(NOT_A_COUNT)) {
      expect({ key, reason: reason.length > 10 }).toEqual({
        key,
        reason: true,
      });
    }

    // A key is in one list, not both.
    for (const key of LEFT_TO_WRITE) {
      expect({ key, both: NOT_A_COUNT[key] !== undefined }).toEqual({
        key,
        both: false,
      });
    }

    expect(new Set<string>(LEFT_TO_WRITE).size).toBe(LEFT_TO_WRITE.length);
  });

  test("the lists only shrink: each entry still names a value written as a plain number or a word", () => {
    const unwritten: Set<string> = new Set<string>(
      SITES.filter((site: CountPairSite): boolean => {
        return !site.isInReadersDigits;
      }).map(keyOf),
    );

    // A value written since: delete its line from LEFT_TO_WRITE or NOT_A_COUNT.
    expect(
      [...LEFT_TO_WRITE, ...Object.keys(NOT_A_COUNT)].filter(
        (key: string): boolean => {
          return !unwritten.has(key);
        },
      ),
    ).toEqual([]);
  });

  test("the pages of issue #7107 are written, not left alone", () => {
    for (const site of SITES) {
      if (
        [
          "Pages/IoT/Fleets.tsx",
          "Pages/DockerSwarm/Clusters.tsx",
          "Components/Monitor/SummaryView/ProbeAttemptsView.tsx",
          "Components/Monitor/SummaryView/CustomMonitorSummaryView.tsx",
          "Components/NetworkDevice/DeviceDiagnosticsViewModel.ts",
        ].some((page: string): boolean => {
          return site.file === `${DASHBOARD}${page}`;
        })
      ) {
        expect({
          site: describeSite(site),
          ok: site.isInReadersDigits,
        }).toEqual({ site: describeSite(site), ok: true });
      }
    }
  });
});

describe("the guard itself", () => {
  // The IoT fleet chip as it was: its online count passed as a plain number.
  const PLAIN: string = `
    const label = translator.translatePlural(
      {
        one: "{{online}}/{{count}} device online",
        other: "{{online}}/{{count}} devices online",
      },
      totalDevices,
      { online: onlineDevices },
    );
  `;

  // The IoT Fleets list's cell as it was (issue #7107).
  const FLEETS_CELL: string = `
    translator.translateTemplate("{{online}}/{{total}} online", {
      online: online,
      total: total,
    });
  `;

  const verdicts: (sites: Array<CountPairSite>) => Array<[string, boolean]> = (
    sites: Array<CountPairSite>,
  ): Array<[string, boolean]> => {
    return sites.map((site: CountPairSite): [string, boolean] => {
      return [site.value, site.isInReadersDigits];
    });
  };

  test("finds a count passed as a plain number", () => {
    expect(findCountPairSites("Plain.ts", PLAIN)).toEqual([
      {
        file: "Plain.ts",
        line: 2,
        template: "{{online}}/{{count}} device online",
        value: "online",
        filledWith: "onlineDevices",
        isInReadersDigits: false,
      },
    ]);
  });

  test("passes it written with formatNumber, or a page's formatCount", () => {
    for (const writer of [
      "translator.formatNumber(onlineDevices)",
      "data.translator.formatNumber(onlineDevices)",
      "formatCount(onlineDevices || 0)",
      "formatReaderNumber(onlineDevices)",
      "onlineDevices.toLocaleString(getReaderNumberLocale())",
    ]) {
      const sites: Array<CountPairSite> = findCountPairSites(
        "Written.ts",
        PLAIN.replace("{ online: onlineDevices }", `{ online: ${writer} }`),
      );

      expect(
        sites.map((site: CountPairSite): boolean => {
          return site.isInReadersDigits;
        }),
      ).toEqual([true]);
    }
  });

  test("passes a value composed for its sentence only when the sentence writes it", () => {
    const composed: (body: string) => Array<[string, boolean]> = (
      body: string,
    ): Array<[string, boolean]> => {
      return verdicts(
        findCountPairSites(
          "Ping.ts",
          `translateTemplate("{{received}}/{{sent}} received", {
            received: composedValue((sentence: Translator): string => {
              ${body}
            }),
            sent: composedValue((sentence: Translator): string => sentence.formatNumber(sent)),
          });`,
        ),
      );
    };

    expect(composed("return sentence.formatNumber(received);")).toEqual([
      ["received", true],
      ["sent", true],
    ]);
    // Composed, but still the raw number: no reader's digits.
    expect(composed("return String(received);")).toEqual([
      ["received", false],
      ["sent", true],
    ]);
    expect(
      composed("const written = String(received); return written;"),
    ).toEqual([
      ["received", false],
      ["sent", true],
    ]);
  });

  test("finds a translateTemplate pair passed as plain numbers, and passes it written", () => {
    expect(verdicts(findCountPairSites("Fleets.tsx", FLEETS_CELL))).toEqual([
      ["online", false],
      ["total", false],
    ]);
    expect(
      verdicts(
        findCountPairSites(
          "Fleets.tsx",
          FLEETS_CELL.replace(
            "online: online",
            "online: translator.formatNumber(online)",
          ).replace("total: total", "total: translator.formatNumber(total)"),
        ),
      ),
    ).toEqual([
      ["online", true],
      ["total", true],
    ]);
    // English "en-US" digits are no reader's digits.
    expect(
      verdicts(
        findCountPairSites(
          "Scan.ts",
          `translateTemplate("{{swept}} of {{total}} swept", {
            swept: swept.toLocaleString("en-US"),
            total: translator.formatNumber(total),
          });`,
        ),
      ),
    ).toEqual([
      ["swept", false],
      ["total", true],
    ]);
  });

  test("a translateTemplate's {{count}} is a value like any other", () => {
    expect(
      verdicts(
        findCountPairSites(
          "Step.tsx",
          `translator.translateTemplate("Step {{step}} of {{count}}", {
            step: currentIndex + 1,
            count: steps.length,
          });`,
        ),
      ),
    ).toEqual([
      ["step", false],
      ["count", false],
    ]);
  });

  test("reads values defined once above the sentence, and a key's template", () => {
    expect(
      verdicts(
        findCountPairSites(
          "Unit.tsx",
          `const LATEST: string = translationKey("latest {{shown}} of {{total}}");
          const listValues: TemplateValues = {
            shown: translator.formatNumber(MAX_SHOWN),
            total: transitions.length,
          };
          translator.translateTemplate(LATEST, listValues);`,
        ),
      ),
    ).toEqual([
      ["shown", true],
      ["total", false],
    ]);
  });

  test("finds a shorthand value, a missing one, a TranslatedSentence's and a slot's", () => {
    const shorthand: Array<CountPairSite> = findCountPairSites(
      "Shorthand.ts",
      PLAIN.replace("{ online: onlineDevices }", "{ online }"),
    );
    const missing: Array<CountPairSite> = findCountPairSites(
      "Missing.ts",
      PLAIN.replace("{ online: onlineDevices }", "{}"),
    );
    const sentence: Array<CountPairSite> = findCountPairSites(
      "Sentence.tsx",
      `const element = (
        <TranslatedSentence
          template={{
            one: "{{count}}:{{left}} left",
            other: "{{count}}:{{left}} left",
          }}
          count={5}
          values={{ left: 3 }}
        />
      );`,
    );
    const slotted: Array<CountPairSite> = findCountPairSites(
      "Slotted.tsx",
      `const element = (
        <TranslatedSentence
          template="Showing top {{shown}} of {{total}} series"
          slots={{
            shown: <span className="font-medium">{totalSeries}</span>,
            total: <span>{translator.formatNumber(serverTotal)}</span>,
          }}
        />
      );`,
    );

    expect(
      [...shorthand, ...missing, ...sentence, ...slotted].map(
        (site: CountPairSite): [string, boolean] => {
          return [site.filledWith, site.isInReadersDigits];
        },
      ),
    ).toEqual([
      ["online", false],
      ["no online", false],
      ["3", false],
      ['<span className="font-medium">{totalSeries}</span>', false],
      ["<span>{translator.formatNumber(serverTotal)}</span>", true],
    ]);
  });

  test("leaves alone a sentence that joins no two values", () => {
    expect(
      findCountPairSites(
        "Alone.ts",
        `translator.translatePlural(
          { one: "{{count}} device of {{total}}", other: "{{count}} devices of {{total}}" },
          5,
          { total: 7 },
        );
        translator.translateTemplate("{{online}} online, {{total}} in all", { online: 3, total: 5 });
        translator.translateTemplate("{{name}}: {{value}}", { name: "a", value: 5 });`,
      ),
    ).toEqual([]);
  });

  test("a word in a ' of ' sentence is listed as no count, with its reason", () => {
    const rule: Array<CountPairSite> = SITES.filter(
      (site: CountPairSite): boolean => {
        return site.file.endsWith("TelemetryRuleText.ts");
      },
    );

    expect(rule.length).toBeGreaterThan(0);
    for (const site of rule) {
      expect(isLeftAlone(site)).toBe(true);
    }
  });
});
