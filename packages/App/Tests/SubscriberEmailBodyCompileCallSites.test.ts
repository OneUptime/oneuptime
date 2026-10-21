import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The body of a status page's custom EMAIL template is HTML, so its values
 * must go in through StatusPageSubscriberNotificationTemplateService.
 * compileEmailBodyTemplate, which escapes every plain value (a title, a name,
 * a URL) and inserts only SafeHtml values as markup. compileTemplate inserts
 * values as written: right for an email subject, SMS, Slack and Teams, and an
 * HTML injection hole for an email body - an incident titled
 * `<a href="https://evil.example">Reset your password</a>` became a live link
 * in an email subscribers trust.
 *
 * Which compile a call site needs depends on the template's channel, which
 * the variable types cannot see (a string is a string). So this test reads
 * the TypeScript AST of every file that compiles subscriber templates, finds
 * which channel each template was looked up for (the notificationMethod
 * handed to getTemplateForStatusPage, directly or through Promise.all), and
 * fails on:
 *
 *   - an email template's body compiled with compileTemplate;
 *   - an SMS, Slack or Teams template's body, or any subject, compiled with
 *     compileEmailBodyTemplate (it would show the reader "&amp;");
 *   - a compile whose template this test cannot trace to a lookup - make it
 *     traceable rather than guess.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Workers"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Notification"),
  path.join(PACKAGES_DIR, "Common", "Server"),
];

// Where the two compile methods are defined, not called.
const DEFINITION_FILES: Array<string> = [
  "Common/Server/Services/StatusPageSubscriberNotificationTemplateService.ts",
];

// Every file known to compile a custom email template's body.
const EXPECTED_EMAIL_BODY_FILES: Array<string> = [
  "App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
  "Common/Server/API/StatusPageAPI.ts",
  "Common/Server/Services/ScheduledMaintenanceService.ts",
  "Common/Server/Services/StatusPageSubscriberService.ts",
  /*
   * The incident created and public note emails, for the jobs and the
   * notification preview alike (the jobs no longer compile them).
   */
  "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts",
];

const TEXT_COMPILE: string = "compileTemplate";
const EMAIL_BODY_COMPILE: string = "compileEmailBodyTemplate";
const TEMPLATE_LOOKUP: string = "getTemplateForStatusPage";

interface CompileCall {
  file: string;
  line: number;
  method: string;
  template: string;
  // The channel the template was looked up for, or null when not traced.
  notificationMethod: string | null;
  // "templateBody" or "emailSubject", or null for anything else.
  part: string | null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function calledMethodName(call: ts.CallExpression): string | null {
  const callee: ts.Expression = unwrap(call.expression);

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  return null;
}

/*
 * The notificationMethod a getTemplateForStatusPage call asks for, as the
 * member name of StatusPageSubscriberNotificationMethod ("Email", "SMS").
 */
function lookupNotificationMethod(expression: ts.Expression): string | null {
  const value: ts.Expression = unwrap(expression);

  if (
    !ts.isCallExpression(value) ||
    calledMethodName(value) !== TEMPLATE_LOOKUP
  ) {
    return null;
  }

  const argument: ts.Expression | undefined = value.arguments[0];

  if (!argument || !ts.isObjectLiteralExpression(unwrap(argument))) {
    return null;
  }

  for (const property of (unwrap(argument) as ts.ObjectLiteralExpression)
    .properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "notificationMethod"
    ) {
      const method: ts.Expression = unwrap(property.initializer);

      if (ts.isPropertyAccessExpression(method)) {
        return method.name.text;
      }
    }
  }

  return null;
}

// Template variable name -> the channel it was looked up for, in one file.
function templateChannels(source: ts.SourceFile): Map<string, string> {
  const channels: Map<string, string> = new Map<string, string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      // const emailTemplate = await Service.getTemplateForStatusPage({...})
      if (ts.isIdentifier(node.name)) {
        const method: string | null = lookupNotificationMethod(
          node.initializer,
        );

        if (method) {
          channels.set(node.name.text, method);
        }
      }

      // const [emailTemplate, smsTemplate] = await Promise.all([lookup, lookup])
      if (ts.isArrayBindingPattern(node.name)) {
        const initializer: ts.Expression = unwrap(node.initializer);

        if (
          ts.isCallExpression(initializer) &&
          calledMethodName(initializer) === "all" &&
          initializer.arguments[0] &&
          ts.isArrayLiteralExpression(unwrap(initializer.arguments[0]))
        ) {
          const lookups: ts.NodeArray<ts.Expression> = (
            unwrap(initializer.arguments[0]) as ts.ArrayLiteralExpression
          ).elements;

          node.name.elements.forEach(
            (element: ts.ArrayBindingElement, index: number): void => {
              if (
                ts.isBindingElement(element) &&
                ts.isIdentifier(element.name) &&
                lookups[index]
              ) {
                const method: string | null = lookupNotificationMethod(
                  lookups[index]!,
                );

                if (method) {
                  channels.set(element.name.text, method);
                }
              }
            },
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return channels;
}

function compileCalls(file: string, text: string): Array<CompileCall> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const channels: Map<string, string> = templateChannels(source);
  const calls: Array<CompileCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method: string | null = calledMethodName(node);

      if (method === TEXT_COMPILE || method === EMAIL_BODY_COMPILE) {
        const argument: ts.Expression | undefined = node.arguments[0];
        let notificationMethod: string | null = null;
        let part: string | null = null;

        if (argument) {
          const template: ts.Expression = unwrap(argument);

          if (ts.isPropertyAccessExpression(template)) {
            const owner: ts.Expression = unwrap(template.expression);
            part = template.name.text;

            if (ts.isIdentifier(owner)) {
              notificationMethod = channels.get(owner.text) || null;
            }
          }
        }

        calls.push({
          file: file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          method: method,
          template: argument ? argument.getText(source) : "",
          notificationMethod: notificationMethod,
          part: part,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "build", "dist", "Tests"].includes(entry.name)) {
        continue;
      }
      files.push(...sourceFiles(fullPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function allCompileCalls(): Array<CompileCall> {
  const calls: Array<CompileCall> = [];

  for (const directory of SCAN_DIRS) {
    for (const fullPath of sourceFiles(directory)) {
      const file: string = path
        .relative(PACKAGES_DIR, fullPath)
        .split(path.sep)
        .join("/");

      if (DEFINITION_FILES.includes(file)) {
        continue;
      }

      const text: string = fs.readFileSync(fullPath, "utf8");

      if (!text.includes(TEXT_COMPILE) && !text.includes(EMAIL_BODY_COMPILE)) {
        continue;
      }

      calls.push(...compileCalls(file, text));
    }
  }

  return calls;
}

// Why a call is wrong, or null when it is right.
function problemWith(call: CompileCall): string | null {
  if (!call.notificationMethod || !call.part) {
    return "cannot tell which channel this template is for; compile a template looked up with getTemplateForStatusPage";
  }

  const isEmailBody: boolean =
    call.notificationMethod === "Email" && call.part === "templateBody";

  if (isEmailBody && call.method !== EMAIL_BODY_COMPILE) {
    return "an email template's body is HTML: compile it with compileEmailBodyTemplate so plain values are escaped";
  }

  if (!isEmailBody && call.method !== TEXT_COMPILE) {
    return "this template is not an HTML email body: compile it with compileTemplate so its text is not HTML-escaped";
  }

  if (call.part !== "templateBody" && call.part !== "emailSubject") {
    return `unexpected template part ${call.part}`;
  }

  return null;
}

describe("subscriber template compile call sites", () => {
  const calls: Array<CompileCall> = allCompileCalls();

  test("finds the known call sites, so the scan is not vacuous", () => {
    const emailBodyFiles: Array<string> = Array.from(
      new Set(
        calls
          .filter((call: CompileCall): boolean => {
            return call.method === EMAIL_BODY_COMPILE;
          })
          .map((call: CompileCall): string => {
            return call.file;
          }),
      ),
    ).sort();

    expect(emailBodyFiles).toEqual([...EXPECTED_EMAIL_BODY_FILES].sort());

    // Subjects, SMS, Slack and Teams still use the text compile.
    expect(
      calls.filter((call: CompileCall): boolean => {
        return call.method === TEXT_COMPILE;
      }).length,
    ).toBeGreaterThan(40);
  });

  test("every template is compiled for its own channel", () => {
    const problems: Array<string> = calls
      .map((call: CompileCall): string | null => {
        const problem: string | null = problemWith(call);

        return problem
          ? `${call.file}:${call.line} ${call.method}(${call.template}): ${problem}`
          : null;
      })
      .filter((problem: string | null): problem is string => {
        return problem !== null;
      });

    expect(problems).toEqual([]);
  });

  /*
   * The rule itself, on small sources, so a change to the scanner that stops
   * it finding anything is caught here rather than by an empty result above.
   */
  describe("the scanner", () => {
    function problemsIn(text: string): Array<string | null> {
      return compileCalls("Example.ts", text).map(problemWith);
    }

    const LOOKUPS: string = `
      const [emailTemplate, smsTemplate] = await Promise.all([
        Service.getTemplateForStatusPage({ statusPageId: id, eventType: e, notificationMethod: StatusPageSubscriberNotificationMethod.Email }),
        Service.getTemplateForStatusPage({ statusPageId: id, eventType: e, notificationMethod: StatusPageSubscriberNotificationMethod.SMS }),
      ]);
      const customTemplate = await Service.getTemplateForStatusPage({
        statusPageId: id,
        eventType: e,
        notificationMethod: StatusPageSubscriberNotificationMethod.Email,
      });
    `;

    test("accepts each channel compiled the right way", () => {
      expect(
        problemsIn(`${LOOKUPS}
          Service.compileEmailBodyTemplate(emailTemplate.templateBody, vars);
          Service.compileTemplate(emailTemplate.emailSubject, vars);
          Service.compileTemplate(smsTemplate!.templateBody, vars);
          Service.compileEmailBodyTemplate(customTemplate?.templateBody as string, vars);
        `),
      ).toEqual([null, null, null, null]);
    });

    test("rejects an email body compiled as text", () => {
      expect(
        problemsIn(`${LOOKUPS}
          Service.compileTemplate(emailTemplate.templateBody, vars);
          Service.compileTemplate(customTemplate.templateBody, vars);
        `),
      ).toEqual([
        expect.stringContaining("compileEmailBodyTemplate"),
        expect.stringContaining("compileEmailBodyTemplate"),
      ]);
    });

    test("rejects an SMS body or a subject compiled as HTML", () => {
      expect(
        problemsIn(`${LOOKUPS}
          Service.compileEmailBodyTemplate(smsTemplate.templateBody, vars);
          Service.compileEmailBodyTemplate(emailTemplate.emailSubject, vars);
        `),
      ).toEqual([
        expect.stringContaining("compileTemplate"),
        expect.stringContaining("compileTemplate"),
      ]);
    });

    test("rejects a template it cannot trace to a lookup", () => {
      expect(
        problemsIn(`
          Service.compileTemplate(someString, vars);
          Service.compileEmailBodyTemplate(template.body, vars);
        `),
      ).toEqual([
        expect.stringContaining("cannot tell"),
        expect.stringContaining("cannot tell"),
      ]);
    });
  });
});
