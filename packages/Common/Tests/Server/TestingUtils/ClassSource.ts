import fs from "fs";

/*
 * A service's source read as a class, for guards that hold every service to
 * a rule by reading it: its methods by name, and what a method reaches
 * through `this.<method>(` calls. Comments and string contents are blanked
 * first (keeping every offset and line), so braces and calls inside them do
 * not count.
 */

export interface MethodBody {
  start: number;
  end: number;
}

export interface ClassSource {
  // The file as it is.
  raw: string;
  // The file with comments and string contents blanked.
  source: string;
  // The class's methods, by name: a header at brace depth 1.
  methods: Map<string, Array<MethodBody>>;
}

export function stripCommentsAndStrings(source: string): string {
  let out: string = "";
  let i: number = 0;

  while (i < source.length) {
    const char: string = source[i]!;

    if (source.startsWith("//", i)) {
      let end: number = source.indexOf("\n", i);
      end = end === -1 ? source.length : end;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }

    if (source.startsWith("/*", i)) {
      let end: number = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      out += source.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let end: number = i + 1;

      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }

        if (source[end] === char) {
          end++;
          break;
        }

        end++;
      }

      out += char + source.slice(i + 1, end - 1).replace(/[^\n]/g, "_") + char;
      i = end;
      continue;
    }

    out += char;
    i++;
  }

  return out;
}

const METHOD_HEADER: RegExp =
  /\n[ \t]*(?:public|protected|private)\s+(?:static\s+)?(?:override\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;

export function methodsOf(source: string): Map<string, Array<MethodBody>> {
  const depth: Array<number> = new Array<number>(source.length + 1);
  let level: number = 0;

  for (let i: number = 0; i < source.length; i++) {
    depth[i] = level;

    if (source[i] === "{") {
      level++;
    } else if (source[i] === "}") {
      level--;
    }
  }

  const methods: Map<string, Array<MethodBody>> = new Map();

  for (const match of source.matchAll(METHOD_HEADER)) {
    const headerAt: number = match.index! + 1;

    if (depth[headerAt] !== 1) {
      continue;
    }

    // Past the parameter list.
    let i: number = match.index! + match[0].length - 1;
    let parens: number = 0;

    for (; i < source.length; i++) {
      if (source[i] === "(") {
        parens++;
      } else if (source[i] === ")") {
        parens--;

        if (parens === 0) {
          break;
        }
      }
    }

    // The body opens at the first "{" at depth 1 that is not a type literal.
    let bodyStart: number = -1;

    for (let j: number = i + 1; j < source.length; j++) {
      if (source[j] === ";" && depth[j] === 1) {
        break;
      }

      if (source[j] === "{" && depth[j] === 1) {
        const before: string = source.slice(0, j).trimEnd();
        const previous: string = before[before.length - 1] || "";

        if (":|&,<(".includes(previous)) {
          // A type literal in the return type: skip it.
          let braces: number = 0;

          for (; j < source.length; j++) {
            if (source[j] === "{") {
              braces++;
            } else if (source[j] === "}") {
              braces--;

              if (braces === 0) {
                break;
              }
            }
          }

          continue;
        }

        bodyStart = j;
        break;
      }
    }

    if (bodyStart === -1) {
      continue;
    }

    let bodyEnd: number = bodyStart + 1;

    while (
      bodyEnd < source.length &&
      !(source[bodyEnd] === "}" && depth[bodyEnd] === 2)
    ) {
      bodyEnd++;
    }

    const bodies: Array<MethodBody> = methods.get(match[1]!) || [];
    bodies.push({ start: match.index! + 1, end: bodyEnd + 1 });
    methods.set(match[1]!, bodies);
  }

  return methods;
}

export function readClassSource(file: string): ClassSource {
  const raw: string = fs.readFileSync(file, "utf8");
  const source: string = stripCommentsAndStrings(raw);

  return { raw, source, methods: methodsOf(source) };
}

// Whether the class declares the method itself.
export function hasMethod(classSource: ClassSource, name: string): boolean {
  return classSource.methods.has(name);
}

/*
 * A method's text - from its header to its closing brace, comments and
 * strings blanked - or "" when the class declares none.
 */
export function methodText(classSource: ClassSource, name: string): string {
  return (classSource.methods.get(name) || [])
    .map((body: MethodBody): string => {
      return classSource.source.slice(body.start, body.end);
    })
    .join("\n");
}

// The methods a method reaches through `this.<method>(` calls, itself included.
export function reachableFrom(
  classSource: ClassSource,
  start: string,
): Set<string> {
  const reached: Set<string> = new Set();
  const pending: Array<string> = [start];

  while (pending.length > 0) {
    const name: string = pending.pop()!;

    if (reached.has(name) || !classSource.methods.has(name)) {
      continue;
    }

    reached.add(name);

    for (const call of methodText(classSource, name).matchAll(
      /this\.([A-Za-z_]\w*)\s*\(/g,
    )) {
      pending.push(call[1]!);
    }
  }

  return reached;
}

// The text of a method and of every method of the class it reaches.
export function reachableText(classSource: ClassSource, start: string): string {
  return Array.from(reachableFrom(classSource, start))
    .map((name: string): string => {
      return methodText(classSource, name);
    })
    .join("\n");
}

/*
 * The argument text of every call to `callee(` in `text`: what is between
 * its parentheses.
 */
export function callArguments(text: string, callee: RegExp): Array<string> {
  const calls: Array<string> = [];
  const pattern: RegExp = new RegExp(callee.source + "\\s*\\(", "g");

  for (const match of text.matchAll(pattern)) {
    const open: number = match.index! + match[0].length - 1;
    let depth: number = 0;

    for (let i: number = open; i < text.length; i++) {
      if (text[i] === "(") {
        depth++;
      } else if (text[i] === ")") {
        depth--;

        if (depth === 0) {
          calls.push(text.slice(open + 1, i));
          break;
        }
      }
    }
  }

  return calls;
}
