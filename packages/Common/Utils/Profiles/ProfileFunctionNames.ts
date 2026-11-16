/*
 * HOW A FUNCTION'S NAME IS SHOWN.
 *
 * Profilers name a function the way its runtime does, and that name is
 * often a path: Go writes the module's import path before the package
 * ("go.opentelemetry.io/otel/sdk/metric/aggregate.(*Builder).Sum"), Java
 * its package ("org.springframework.web.servlet.DispatcherServlet.doDispatch").
 * In a flame graph frame or a table row only the start of such a name
 * fits, and the start is the part that says least. The short name keeps
 * what a person reads code by - the package's last segment, the type and
 * the method ("aggregate.(*Builder).Sum", "DispatcherServlet.doDispatch") -
 * and the full name stays one hover away.
 *
 * Native code built without symbols has no name at all: the profiler
 * records the address it ran at ("0x7f3a2c"). Such a frame is "unnamed":
 * the Profiler groups those frames and says why they have no name, rather
 * than drawing a forest of addresses.
 *
 * Pure: the server and the Dashboard import it alike.
 */

// An address the profiler could not name: "0x270675".
const ADDRESS_PATTERN: RegExp = /^0x[0-9a-f]+$/i;

// Names a profiler writes for a frame it knows nothing about.
const PLACEHOLDER_NAMES: ReadonlyArray<string> = ["<unknown>", "unknown"];

export function isUnnamedProfileFunction(
  functionName: string | null | undefined,
): boolean {
  const name: string = (functionName || "").trim();

  if (!name) {
    return true;
  }

  return ADDRESS_PATTERN.test(name) || PLACEHOLDER_NAMES.includes(name);
}

/*
 * The index of the last "/" that is not inside brackets or parentheses:
 * a Go generic's type argument can hold a path of its own
 * ("aggregate.Builder[go.opentelemetry.io/otel/attribute.Set].Sum").
 */
function lastTopLevelSlash(name: string): number {
  let depth: number = 0;
  let found: number = -1;

  for (let index: number = 0; index < name.length; index++) {
    const character: string = name.charAt(index);

    if (character === "[" || character === "(" || character === "<") {
      depth++;
    } else if (character === "]" || character === ")" || character === ">") {
      depth = Math.max(0, depth - 1);
    } else if (character === "/" && depth === 0) {
      found = index;
    }
  }

  return found;
}

// A Java (or Kotlin, Scala) package segment: lower case, no punctuation.
const PACKAGE_SEGMENT_PATTERN: RegExp = /^[a-z][a-z0-9_]*$/;

// A class name: starts with a capital ("OrderService", "HashMap$Entry").
const CLASS_SEGMENT_PATTERN: RegExp = /^[A-Z][A-Za-z0-9_$]*$/;

// A character no plain dotted (Java, Kotlin, Scala) name holds.
const NOT_A_DOTTED_NAME_PATTERN: RegExp = /[^A-Za-z0-9_$.<>]/;

/*
 * "com.example.shop.OrderService.parse" to "OrderService.parse": the
 * package is dropped when at least two lower-case segments come before a
 * class. One is no package to drop - Go's "json.Marshal" keeps its
 * package, which is how Go code names it.
 */
function withoutJavaPackage(name: string): string {
  // Only a plain dotted name: anything else is some other language's.
  if (NOT_A_DOTTED_NAME_PATTERN.test(name)) {
    return name;
  }

  const segments: Array<string> = name.split(".");
  let index: number = 0;

  while (
    index < segments.length &&
    PACKAGE_SEGMENT_PATTERN.test(segments[index] || "")
  ) {
    index++;
  }

  if (
    index < 2 ||
    index >= segments.length - 1 ||
    !CLASS_SEGMENT_PATTERN.test(segments[index] || "")
  ) {
    return name;
  }

  return segments.slice(index).join(".");
}

/*
 * The name a person reads a function by. Unchanged when there is nothing
 * to shorten, and never empty for a name that is not.
 */
export function getShortProfileFunctionName(
  functionName: string | null | undefined,
): string {
  const name: string = (functionName || "").trim();

  if (!name || isUnnamedProfileFunction(name)) {
    return name;
  }

  let short: string = name;
  const slash: number = lastTopLevelSlash(short);

  if (slash >= 0 && slash < short.length - 1) {
    short = short.substring(slash + 1);
  }

  short = withoutJavaPackage(short);

  return short || name;
}
