import ts from "typescript";
import { ScanFinding, unwrap } from "./ReferenceNameScan";

/*
 * The columns a service's write hooks write on the write they are handed.
 *
 * DatabaseService checks a create's record and an update's data AS THE
 * HOOKS LEFT THEM against the CALLER's column permissions
 * (ModelPermission.checkCreatePermissions after onBeforeCreate,
 * checkUpdateQueryPermissions after onBeforeUpdate). So a value a hook
 * writes - a null included - is asked of the caller as if they had sent it:
 * a hook that writes a column its callers may not write refuses every write
 * they make, with "User is not allowed to create on <column> column of
 * <Model>". That is how starting a packet capture was refused for every
 * project member (PacketCaptureService stamped fileId null), and how adding
 * Slack as a notification method was before it.
 *
 * findHookColumnWrites reads one service file and answers every column its
 * create hooks (onBeforeCreate, checkCreateBeforeReferences) and update
 * hooks (onBeforeUpdate, checkUpdateBeforeReferences) write on the write's
 * payload - directly, or in a method of the same class they call, however
 * deep - as:
 *
 *   createBy.data.status = ...            (and data["status"] = ..., an alias)
 *   createBy.data.status ??= ...          (||=, &&=, ??= too)
 *   RelationIdUtil.stamp(data, KEYS, id)  (KEYS' first name: the ID column)
 *   createBy.data.setColumnValue("x", v)
 *   Object.assign(createBy.data, { x: v })
 *
 * A write of `undefined` is no write - the column is left out of the write,
 * and no permission is asked for it - and RelationIdUtil.leaveOut writes
 * nothing. The payload is `createBy.data` / `updateBy.data` (and
 * `onCreate.createBy.data`), a variable that holds it (`const data =
 * createBy.data as ...`), a parameter typed CreateBy / UpdateBy / OnCreate
 * (`<param>.data`), and a parameter a payload is passed to. Only real syntax
 * is read, through the TypeScript AST.
 *
 * A write that only rewrites what the write itself carries - trims it,
 * normalizes it - is marked `onlyWhenSent`: it sits under a test that the
 * payload holds the column (`if (data.x !== undefined) { data.x = ... }`,
 * `if (data.x) ...`, `"x" in data`, RelationIdUtil.isPresent / isWritten),
 * or after a branch that leaves when it does not (`if (data.x ===
 * undefined) { return; }`). The caller sent that column, so they are held
 * to its list for what they sent, hook or no hook. A write made when the
 * payload does NOT hold the column (`if (data.x === undefined) { data.x =
 * ... }`) is the hook's own value, and is not marked.
 */

export type HookWriteKind = "create" | "update";

export interface HookColumnWrite extends ScanFinding {
  kind: HookWriteKind;
  // The method the write is in: the hook itself, or a method it calls.
  method: string;
  column: string;
  // Only made when the write carries the column itself. See above.
  onlyWhenSent: boolean;
}

export const HOOK_ENTRY_METHODS: Record<HookWriteKind, Array<string>> = {
  create: ["onBeforeCreate", "checkCreateBeforeReferences"],
  update: ["onBeforeUpdate", "checkUpdateBeforeReferences"],
};

const PAYLOAD_ROOTS: Record<HookWriteKind, Array<string>> = {
  create: ["createBy.data", "onCreate.createBy.data"],
  update: ["updateBy.data", "onUpdate.updateBy.data"],
};

// A parameter of this type hands a method the write: `<param>.data`.
const WRITE_PARAMETER_TYPES: Record<HookWriteKind, Array<string>> = {
  create: ["CreateBy"],
  update: ["UpdateBy"],
};

// A parameter of this type hands it the hook's result: `<param>.createBy.data`.
const HOOK_RESULT_PARAMETER_TYPES: Record<HookWriteKind, Array<string>> = {
  create: ["OnCreate"],
  update: ["OnUpdate"],
};

const HOOK_RESULT_PAYLOAD_PATH: Record<HookWriteKind, string> = {
  create: "createBy.data",
  update: "updateBy.data",
};

const ASSIGNMENT_OPERATORS: Array<ts.SyntaxKind> = [
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
];

const WHITESPACE: RegExp = /\s+/g;

type MethodNode =
  | ts.MethodDeclaration
  | ts.PropertyDeclaration
  | ts.GetAccessorDeclaration;

interface ServiceClass {
  name: string | null;
  methods: Map<string, MethodNode>;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function compactText(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(WHITESPACE, "");
}

function memberName(member: ts.ClassElement): string | null {
  if (!member.name) {
    return null;
  }

  if (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) {
    return member.name.text;
  }

  if (ts.isStringLiteral(member.name)) {
    return member.name.text;
  }

  return null;
}

function classesOf(source: ts.SourceFile): Array<ServiceClass> {
  const classes: Array<ServiceClass> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const methods: Map<string, MethodNode> = new Map();

      for (const member of node.members) {
        const name: string | null = memberName(member);

        if (
          name &&
          (ts.isMethodDeclaration(member) ||
            ts.isPropertyDeclaration(member) ||
            ts.isGetAccessorDeclaration(member))
        ) {
          methods.set(name, member);
        }
      }

      classes.push({ name: node.name ? node.name.text : null, methods });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return classes;
}

// The function a class member runs: a method's own, or an arrow it holds.
function functionOf(
  member: MethodNode,
): ts.FunctionLikeDeclaration | ts.GetAccessorDeclaration | null {
  if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
    return member;
  }

  if (
    member.initializer &&
    (ts.isArrowFunction(member.initializer) ||
      ts.isFunctionExpression(member.initializer))
  ) {
    return member.initializer;
  }

  return null;
}

/*
 * Top-level `const KEYS: Array<string> = ["probeId", "probe"]` lists, by
 * name: the keys a stamp names through a constant.
 */
function keyListsOf(source: ts.SourceFile): Map<string, Array<string>> {
  const lists: Map<string, Array<string>> = new Map();

  for (const statement of source.statements) {
    const declarations: ts.NodeArray<ts.VariableDeclaration> | null =
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
        : null;

    for (const declaration of declarations || []) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(unwrap(declaration.initializer))
      ) {
        const elements: ts.NodeArray<ts.Expression> = (
          unwrap(declaration.initializer) as ts.ArrayLiteralExpression
        ).elements;

        if (
          elements.length > 0 &&
          elements.every((element: ts.Expression): boolean => {
            return ts.isStringLiteralLike(element);
          })
        ) {
          lists.set(
            declaration.name.text,
            elements.map((element: ts.Expression): string => {
              return (element as ts.StringLiteralLike).text;
            }),
          );
        }
      }
    }
  }

  return lists;
}

// `undefined` or `void 0`: a column left out of the write.
function isNoValue(node: ts.Expression): boolean {
  const expression: ts.Expression = unwrap(node);

  return (
    (ts.isIdentifier(expression) && expression.text === "undefined") ||
    ts.isVoidExpression(expression)
  );
}

function typeNameOf(parameter: ts.ParameterDeclaration): string | null {
  const type: ts.TypeNode | undefined = parameter.type;

  if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeName.text;
  }

  return null;
}

/*
 * The method a call runs in the same class - `this.x(...)`,
 * `Service.x(...)` / `<ClassName>.x(...)` for a static one - or null.
 */
function calledMethod(
  call: ts.CallExpression,
  serviceClass: ServiceClass,
): string | null {
  const callee: ts.Expression = unwrap(call.expression);

  if (!ts.isPropertyAccessExpression(callee)) {
    return null;
  }

  const target: ts.Expression = unwrap(callee.expression);
  const name: string = callee.name.text;

  if (!serviceClass.methods.has(name)) {
    return null;
  }

  if (target.kind === ts.SyntaxKind.ThisKeyword) {
    return name;
  }

  if (
    ts.isIdentifier(target) &&
    (target.text === "Service" || target.text === serviceClass.name)
  ) {
    return name;
  }

  return null;
}

interface MethodVisit {
  method: string;
  // Parameter positions a payload was passed in, by a call to this method.
  payloadParameters: Set<number>;
}

/*
 * What a condition says about whether the payload carries a value for one
 * column: what follows when it is true, and what follows when it is false -
 * "sent" (a value, null included), "not sent" (undefined), or null when it
 * says neither. `data.x` being truthy says sent; being falsy says nothing
 * (null, "" and 0 are values too). `data.x === undefined` says not sent when
 * true and sent when false.
 */
type Sent = "sent" | "not sent" | null;

interface SentTest {
  whenTrue: Sent;
  whenFalse: Sent;
}

const SAYS_NOTHING: SentTest = { whenTrue: null, whenFalse: null };

// Both halves of an `a && b` are true, so what either says holds.
function eitherHolds(left: Sent, right: Sent): Sent {
  return left || right;
}

// One half of an `a || b` is true, but which: only what both say holds.
function bothHold(left: Sent, right: Sent): Sent {
  return left === right ? left : null;
}

// A branch that never falls through: it ends in a return or a throw.
function alwaysLeaves(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    return true;
  }

  if (ts.isBlock(statement)) {
    const last: ts.Statement | undefined =
      statement.statements[statement.statements.length - 1];

    return Boolean(last && alwaysLeaves(last));
  }

  return false;
}

export function findHookColumnWrites(
  fileName: string,
  text: string,
): Array<HookColumnWrite> {
  const source: ts.SourceFile = parse(fileName, text);
  const keyLists: Map<string, Array<string>> = keyListsOf(source);
  const found: Array<HookColumnWrite> = [];
  const seen: Set<string> = new Set();

  for (const serviceClass of classesOf(source)) {
    for (const kind of ["create", "update"] as Array<HookWriteKind>) {
      const queue: Array<MethodVisit> = HOOK_ENTRY_METHODS[kind]
        .filter((method: string): boolean => {
          return serviceClass.methods.has(method);
        })
        .map((method: string): MethodVisit => {
          return { method: method, payloadParameters: new Set() };
        });

      // Each method once per set of payload parameters it was called with.
      const visited: Set<string> = new Set();

      while (queue.length > 0) {
        const visit: MethodVisit = queue.shift()!;
        const visitKey: string = `${visit.method}#${Array.from(
          visit.payloadParameters,
        )
          .sort()
          .join(",")}`;

        if (visited.has(visitKey)) {
          continue;
        }

        visited.add(visitKey);

        const member: MethodNode | undefined = serviceClass.methods.get(
          visit.method,
        );
        const fn: ts.FunctionLikeDeclaration | ts.GetAccessorDeclaration | null =
          member ? functionOf(member) : null;

        if (!fn || !fn.body) {
          continue;
        }

        const roots: Set<string> = new Set(PAYLOAD_ROOTS[kind]);

        fn.parameters.forEach(
          (parameter: ts.ParameterDeclaration, index: number): void => {
            if (!ts.isIdentifier(parameter.name)) {
              return;
            }

            const name: string = parameter.name.text;
            const typeName: string | null = typeNameOf(parameter);

            if (typeName && WRITE_PARAMETER_TYPES[kind].includes(typeName)) {
              roots.add(`${name}.data`);
            }

            if (
              typeName &&
              HOOK_RESULT_PARAMETER_TYPES[kind].includes(typeName)
            ) {
              roots.add(`${name}.${HOOK_RESULT_PAYLOAD_PATH[kind]}`);
            }

            if (visit.payloadParameters.has(index)) {
              roots.add(name);
            }
          },
        );

        const isPayload: (node: ts.Expression) => boolean = (
          node: ts.Expression,
        ): boolean => {
          return roots.has(compactText(unwrap(node), source));
        };

        // `const data = createBy.data as ...`, and so on down.
        for (let grew: boolean = true; grew; ) {
          grew = false;

          const collect: (node: ts.Node) => void = (node: ts.Node): void => {
            if (
              ts.isVariableDeclaration(node) &&
              ts.isIdentifier(node.name) &&
              node.initializer &&
              !roots.has(node.name.text) &&
              isPayload(node.initializer)
            ) {
              roots.add(node.name.text);
              grew = true;
            }

            ts.forEachChild(node, collect);
          };

          collect(fn.body);
        }

        // The column `target` names on a payload, or null.
        const writtenColumn: (target: ts.Expression) => string | null = (
          target: ts.Expression,
        ): string | null => {
          const expression: ts.Expression = unwrap(target);

          if (
            ts.isPropertyAccessExpression(expression) &&
            isPayload(expression.expression)
          ) {
            return expression.name.text;
          }

          if (
            ts.isElementAccessExpression(expression) &&
            ts.isStringLiteralLike(expression.argumentExpression) &&
            isPayload(expression.expression)
          ) {
            return expression.argumentExpression.text;
          }

          return null;
        };

        // What `condition` says about whether the payload carries `column`.
        const sentTestOf: (
          condition: ts.Expression,
          column: string,
        ) => SentTest = (
          condition: ts.Expression,
          column: string,
        ): SentTest => {
          const expression: ts.Expression = unwrap(condition);

          // data.x: truthy says a value; falsy says nothing.
          if (writtenColumn(expression) === column) {
            return { whenTrue: "sent", whenFalse: null };
          }

          if (
            ts.isPrefixUnaryExpression(expression) &&
            expression.operator === ts.SyntaxKind.ExclamationToken
          ) {
            const inner: SentTest = sentTestOf(expression.operand, column);

            return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
          }

          // RelationIdUtil.isPresent(data, [..., "x", ...]): some name holds a value.
          if (
            ts.isCallExpression(expression) &&
            ts.isPropertyAccessExpression(expression.expression) &&
            expression.expression.name.text === "isPresent" &&
            expression.arguments[0] &&
            isPayload(expression.arguments[0]) &&
            expression.arguments[1]
          ) {
            const keysArgument: ts.Expression = unwrap(
              expression.arguments[1],
            );
            const keys: Array<string> = ts.isArrayLiteralExpression(
              keysArgument,
            )
              ? keysArgument.elements
                  .filter((element: ts.Expression): boolean => {
                    return ts.isStringLiteralLike(element);
                  })
                  .map((element: ts.Expression): string => {
                    return (element as ts.StringLiteralLike).text;
                  })
              : ts.isIdentifier(keysArgument)
                ? keyLists.get(keysArgument.text) || []
                : [];

            if (keys.includes(column)) {
              return { whenTrue: "sent", whenFalse: "not sent" };
            }

            return SAYS_NOTHING;
          }

          if (!ts.isBinaryExpression(expression)) {
            return SAYS_NOTHING;
          }

          const operator: ts.SyntaxKind = expression.operatorToken.kind;

          if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
            const left: SentTest = sentTestOf(expression.left, column);
            const right: SentTest = sentTestOf(expression.right, column);

            return {
              whenTrue: eitherHolds(left.whenTrue, right.whenTrue),
              whenFalse: bothHold(left.whenFalse, right.whenFalse),
            };
          }

          if (operator === ts.SyntaxKind.BarBarToken) {
            const left: SentTest = sentTestOf(expression.left, column);
            const right: SentTest = sentTestOf(expression.right, column);

            return {
              whenTrue: bothHold(left.whenTrue, right.whenTrue),
              whenFalse: eitherHolds(left.whenFalse, right.whenFalse),
            };
          }

          const isStrict: boolean =
            operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            operator === ts.SyntaxKind.ExclamationEqualsEqualsToken;
          const isLoose: boolean =
            operator === ts.SyntaxKind.EqualsEqualsToken ||
            operator === ts.SyntaxKind.ExclamationEqualsToken;
          const isNegated: boolean =
            operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
            operator === ts.SyntaxKind.ExclamationEqualsToken;

          if (!isStrict && !isLoose) {
            return SAYS_NOTHING;
          }

          // The column on one side, what it is compared with on the other.
          const left: ts.Expression = unwrap(expression.left);
          const right: ts.Expression = unwrap(expression.right);
          let other: ts.Expression | null = null;
          let isTypeOf: boolean = false;

          for (const [side, opposite] of [
            [left, right],
            [right, left],
          ] as Array<[ts.Expression, ts.Expression]>) {
            if (writtenColumn(side) === column) {
              other = opposite;
            }

            if (
              ts.isTypeOfExpression(side) &&
              writtenColumn(side.expression) === column
            ) {
              other = opposite;
              isTypeOf = true;
            }
          }

          if (!other) {
            return SAYS_NOTHING;
          }

          let equal: SentTest = SAYS_NOTHING;

          if (isTypeOf) {
            // typeof data.x === "undefined", or any other type: a value.
            equal =
              ts.isStringLiteralLike(other) && other.text === "undefined"
                ? { whenTrue: "not sent", whenFalse: "sent" }
                : { whenTrue: "sent", whenFalse: null };
          } else if (isNoValue(other)) {
            // === undefined says not sent; == undefined lets null through.
            equal = isStrict
              ? { whenTrue: "not sent", whenFalse: "sent" }
              : { whenTrue: null, whenFalse: "sent" };
          } else if (other.kind === ts.SyntaxKind.NullKeyword) {
            // === null is a value; == null lets undefined through.
            equal = isStrict
              ? { whenTrue: "sent", whenFalse: null }
              : { whenTrue: null, whenFalse: "sent" };
          } else {
            // Equal to anything else: a value.
            equal = { whenTrue: "sent", whenFalse: null };
          }

          return isNegated
            ? { whenTrue: equal.whenFalse, whenFalse: equal.whenTrue }
            : equal;
        };

        /*
         * Whether the write at `node` is made only when the payload carries
         * `column` itself: under an `if` that says so, or after one that
         * leaves when it does not.
         */
        const isOnlyWhenSent: (node: ts.Node, column: string) => boolean = (
          node: ts.Node,
          column: string,
        ): boolean => {
          let child: ts.Node = node;

          for (
            let parent: ts.Node | undefined = node.parent;
            parent && child !== fn.body;
            child = parent, parent = parent.parent
          ) {
            if (ts.isIfStatement(parent)) {
              const test: SentTest = sentTestOf(parent.expression, column);

              if (child === parent.thenStatement && test.whenTrue === "sent") {
                return true;
              }

              if (child === parent.elseStatement && test.whenFalse === "sent") {
                return true;
              }
            }

            if (ts.isBlock(parent)) {
              const index: number = parent.statements.indexOf(
                child as ts.Statement,
              );

              for (const earlier of parent.statements.slice(
                0,
                Math.max(index, 0),
              )) {
                if (
                  ts.isIfStatement(earlier) &&
                  !earlier.elseStatement &&
                  alwaysLeaves(earlier.thenStatement) &&
                  sentTestOf(earlier.expression, column).whenFalse === "sent"
                ) {
                  return true;
                }
              }
            }
          }

          return false;
        };

        const record: (node: ts.Node, column: string) => void = (
          node: ts.Node,
          column: string,
        ): void => {
          const line: number =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;
          const key: string = `${kind}:${line}:${column}`;

          if (seen.has(key)) {
            return;
          }

          seen.add(key);

          found.push({
            file: fileName,
            line: line,
            text: node.getText(source).replace(WHITESPACE, " ").slice(0, 160),
            kind: kind,
            method: visit.method,
            column: column,
            onlyWhenSent: isOnlyWhenSent(node, column),
          });
        };

        const walk: (node: ts.Node) => void = (node: ts.Node): void => {
          // createBy.data.status = ..., ??= ..., data["status"] = ...
          if (
            ts.isBinaryExpression(node) &&
            ASSIGNMENT_OPERATORS.includes(node.operatorToken.kind)
          ) {
            const column: string | null = writtenColumn(node.left);

            if (column && !isNoValue(node.right)) {
              record(node, column);
            }
          }

          if (ts.isCallExpression(node)) {
            const callee: ts.Expression = unwrap(node.expression);

            // RelationIdUtil.stamp(data, KEYS, value)
            if (
              ts.isPropertyAccessExpression(callee) &&
              callee.name.text === "stamp" &&
              ts.isIdentifier(unwrap(callee.expression)) &&
              (unwrap(callee.expression) as ts.Identifier).text ===
                "RelationIdUtil" &&
              node.arguments.length >= 3 &&
              isPayload(node.arguments[0]!) &&
              !isNoValue(node.arguments[2]!)
            ) {
              const keysArgument: ts.Expression = unwrap(node.arguments[1]!);
              let keys: Array<string> = [];

              if (ts.isArrayLiteralExpression(keysArgument)) {
                keys = keysArgument.elements
                  .filter((element: ts.Expression): boolean => {
                    return ts.isStringLiteralLike(element);
                  })
                  .map((element: ts.Expression): string => {
                    return (element as ts.StringLiteralLike).text;
                  });
              } else if (ts.isIdentifier(keysArgument)) {
                keys = keyLists.get(keysArgument.text) || [];
              }

              if (keys[0]) {
                record(node, keys[0]);
              }
            }

            // createBy.data.setColumnValue("status", value)
            if (
              ts.isPropertyAccessExpression(callee) &&
              callee.name.text === "setColumnValue" &&
              isPayload(callee.expression) &&
              node.arguments[0] &&
              ts.isStringLiteralLike(node.arguments[0]) &&
              node.arguments[1] &&
              !isNoValue(node.arguments[1])
            ) {
              record(node, node.arguments[0].text);
            }

            // Object.assign(createBy.data, { status: value })
            if (
              ts.isPropertyAccessExpression(callee) &&
              callee.name.text === "assign" &&
              ts.isIdentifier(unwrap(callee.expression)) &&
              (unwrap(callee.expression) as ts.Identifier).text === "Object" &&
              node.arguments[0] &&
              isPayload(node.arguments[0])
            ) {
              for (const argument of node.arguments.slice(1)) {
                const literal: ts.Expression = unwrap(argument);

                if (!ts.isObjectLiteralExpression(literal)) {
                  continue;
                }

                for (const property of literal.properties) {
                  if (
                    ts.isPropertyAssignment(property) &&
                    (ts.isIdentifier(property.name) ||
                      ts.isStringLiteralLike(property.name)) &&
                    !isNoValue(property.initializer)
                  ) {
                    record(property, property.name.text);
                  }

                  if (ts.isShorthandPropertyAssignment(property)) {
                    record(property, property.name.text);
                  }
                }
              }
            }

            // A method of the class the hook calls: read it too.
            const method: string | null = calledMethod(node, serviceClass);

            if (method) {
              const payloadParameters: Set<number> = new Set();

              node.arguments.forEach(
                (argument: ts.Expression, index: number): void => {
                  if (isPayload(argument)) {
                    payloadParameters.add(index);
                  }
                },
              );

              queue.push({
                method: method,
                payloadParameters: payloadParameters,
              });
            }
          }

          ts.forEachChild(node, walk);
        };

        walk(fn.body);
      }
    }
  }

  return found;
}
