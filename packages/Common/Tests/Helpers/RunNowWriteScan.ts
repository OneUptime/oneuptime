import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHAT A RULE'S RUN NOW WRITES, AND WHETHER EACH WRITE SAYS WHO RAN IT
 * (issues #6300, #6323, #6324).
 *
 * A rule's Run now is one method of its engine - syncResourcesForRule,
 * applyRuleToCompletedScans - and the methods of the same file it reaches
 * through `this`. Written as plain root, what it changes is System's in the
 * audit log; written with RuleRunWriteProps of the props the run was handed,
 * it is the person's who ran it. readRunNow reads a file through the
 * TypeScript AST and answers, from that entry:
 *
 *   - the writes it reaches: a call of one of DatabaseService's writing
 *     methods (create, updateOneById, deleteOneById...) on a service, or on
 *     `this` where the file declares no method of that name (the service's
 *     own, as NetworkDeviceService moves a device);
 *   - those made with anything but `RuleRunWriteProps.get(data.props)`, or
 *     `RuleRunWriteProps.getInProject(data.props, ...)` for a service that
 *     creates only in a project;
 *   - the recorders it reaches (AuditLogService.record*, RuleAddedLabels)
 *     handed anything but the run's props;
 *   - the methods it calls that write - by themselves, or through another
 *     method that does - without handing on `props: data.props`.
 *
 * What it cannot see is a write made through another file's method that is
 * none of these: a service's own helper. The routes, the runner and the
 * behaviour tests (OwnerAndPrivacyRuleRunAuditLog and each engine's suite)
 * cover those.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// DatabaseService's writes, and the owner helpers that write through them.
export const RUN_NOW_WRITE_METHODS: ReadonlySet<string> = new Set<string>([
  "addOwners",
  "create",
  "createMany",
  "createOwner",
  "deleteBy",
  "deleteOneBy",
  "deleteOneById",
  "updateBy",
  "updateOneBy",
  "updateOneById",
]);

// What a run's write is made with: who ran it, as RuleRunWriteProps says.
const WRITE_PROPS: ReadonlyArray<RegExp> = [
  /^RuleRunWriteProps\.get\(data\.props\)$/,
  /^RuleRunWriteProps\.getInProject\(data\.props, [^()]+\)$/,
];

// The recorders a run may call itself, and what they must be handed.
const RECORDER: RegExp =
  /^(AuditLogService\.record(Create|Update|Delete)|RuleAddedLabels\.(add|recordInAuditLog))$/;
const RECORDER_PROPS: ReadonlySet<string> = new Set<string>([
  "data.props",
  "RuleRunWriteProps.get(data.props)",
]);

export interface RunNowReading {
  file: string;
  entry: string;
  // Whether the file declares the entry at all.
  hasEntry: boolean;
  // The entry and the methods of its file it reaches, in the order reached.
  reached: Array<string>;
  // Every write it reaches, as "<file>:<line> <call> in <method> with <props>".
  writes: Array<string>;
  writesWithoutWhoRanIt: Array<string>;
  // Every recorder it reaches, the same way.
  recorders: Array<string>;
  recordersWithoutWhoRanIt: Array<string>;
  // Methods it calls that write, called without `props: data.props`.
  callsDroppingProps: Array<string>;
}

interface FoundCall {
  // The method the call is in ("" outside any).
  caller: string;
  call: ts.CallExpression;
}

// The object a call is handed, when it is handed one.
function objectArgument(
  call: ts.CallExpression,
): ts.ObjectLiteralExpression | null {
  const argument: ts.Expression | undefined = call.arguments[0];

  return argument && ts.isObjectLiteralExpression(argument) ? argument : null;
}

// The text of `key` in an object literal, or null when it has none.
export function propertyText(
  literal: ts.ObjectLiteralExpression,
  key: string,
  source: ts.SourceFile,
): string | null {
  for (const property of literal.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === key
    ) {
      return property.initializer.getText(source);
    }

    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === key
    ) {
      return key;
    }
  }

  return null;
}

/*
 * The props a write or a recorder is handed: its object's `props`, or the
 * last of a list of arguments (addOwners hands them last).
 */
function propsOf(call: ts.CallExpression, source: ts.SourceFile): string {
  const literal: ts.ObjectLiteralExpression | null = objectArgument(call);

  if (literal) {
    return propertyText(literal, "props", source) || "(none)";
  }

  const last: ts.Expression | undefined =
    call.arguments[call.arguments.length - 1];

  return last ? last.getText(source) : "(none)";
}

function methodNameOf(node: ts.Node, source: ts.SourceFile): string {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isMethodDeclaration(current)) {
    current = current.parent;
  }

  return current && ts.isMethodDeclaration(current)
    ? current.name.getText(source)
    : "";
}

export function readRunNow(data: {
  file: string;
  entry: string;
  // The file's text, when it is not to be read from disk.
  text?: string | undefined;
}): RunNowReading {
  const text: string =
    data.text === undefined ? fs.readFileSync(data.file, "utf8") : data.text;
  const source: ts.SourceFile = ts.createSourceFile(
    data.file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const name: string = path.basename(data.file);
  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  };

  // Every method the file's classes declare.
  const declared: Set<string> = new Set<string>();
  const calls: Array<FoundCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node)) {
      declared.add(node.name.getText(source));
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      calls.push({ caller: methodNameOf(node, source), call: node });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  const isThisCall: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    const callee: ts.PropertyAccessExpression =
      call.expression as ts.PropertyAccessExpression;

    return (
      callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
      declared.has(callee.name.text)
    );
  };

  const isWrite: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    const callee: ts.PropertyAccessExpression =
      call.expression as ts.PropertyAccessExpression;

    return RUN_NOW_WRITE_METHODS.has(callee.name.text) && !isThisCall(call);
  };

  const isRecorder: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    return RECORDER.test(call.expression.getText(source));
  };

  // The methods that write or record, by themselves or through another.
  const writing: Set<string> = new Set<string>();

  for (const found of calls) {
    if (isWrite(found.call) || isRecorder(found.call)) {
      writing.add(found.caller);
    }
  }

  let grew: boolean = true;

  while (grew) {
    grew = false;

    for (const found of calls) {
      const callee: string = (
        found.call.expression as ts.PropertyAccessExpression
      ).name.text;

      if (
        isThisCall(found.call) &&
        writing.has(callee) &&
        !writing.has(found.caller)
      ) {
        writing.add(found.caller);
        grew = true;
      }
    }
  }

  // The methods the entry reaches through `this`.
  const reached: Array<string> = [];
  const queue: Array<string> = declared.has(data.entry) ? [data.entry] : [];

  while (queue.length > 0) {
    const method: string = queue.shift()!;

    if (reached.includes(method)) {
      continue;
    }

    reached.push(method);

    for (const found of calls) {
      if (found.caller === method && isThisCall(found.call)) {
        queue.push(
          (found.call.expression as ts.PropertyAccessExpression).name.text,
        );
      }
    }
  }

  const reading: RunNowReading = {
    file: data.file,
    entry: data.entry,
    hasEntry: declared.has(data.entry),
    reached: reached,
    writes: [],
    writesWithoutWhoRanIt: [],
    recorders: [],
    recordersWithoutWhoRanIt: [],
    callsDroppingProps: [],
  };

  for (const found of calls) {
    if (!reached.includes(found.caller)) {
      continue;
    }

    const call: ts.CallExpression = found.call;
    const where: string = `${name}:${lineOf(call)} ${call.expression.getText(source)} in ${found.caller}`;

    if (isWrite(call)) {
      const props: string = propsOf(call, source);

      reading.writes.push(`${where} with ${props}`);

      if (
        !WRITE_PROPS.some((accepted: RegExp): boolean => {
          return accepted.test(props);
        })
      ) {
        reading.writesWithoutWhoRanIt.push(`${where} with ${props}`);
      }

      continue;
    }

    if (isRecorder(call)) {
      const props: string = propsOf(call, source);

      reading.recorders.push(`${where} with ${props}`);

      if (!RECORDER_PROPS.has(props)) {
        reading.recordersWithoutWhoRanIt.push(`${where} with ${props}`);
      }

      continue;
    }

    const callee: string = (call.expression as ts.PropertyAccessExpression)
      .name.text;

    if (isThisCall(call) && writing.has(callee)) {
      const literal: ts.ObjectLiteralExpression | null = objectArgument(call);
      const passesProps: boolean = Boolean(
        literal && propertyText(literal, "props", source) === "data.props",
      );

      if (!passesProps) {
        reading.callsDroppingProps.push(where);
      }
    }
  }

  return reading;
}
