import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import VMRunner from "./VMRunner";

/*
 * What the body of an {{#each}} block is rendered against, for one element.
 */
interface EachLoopScope {
  /*
   * Where a {{name}} in the body is looked up, first hit wins: the current
   * element, each enclosing element outwards, then the storage map. Only
   * object elements are listed — a string or a number has no keys.
   */
  lookupChain: Array<JSONObject>;
  /*
   * What a nested {{#each path}} resolves against: the storage map with the
   * keys of each enclosing object element spread over it.
   */
  eachPathScope: JSONObject;
  /*
   * The plain value {{this}} stands for. The outermost loop over plain values
   * sets it and the loops nested inside it keep it, as they did when the value
   * was written into the body's text.
   */
  thisElement?: { value: JSONValue } | undefined;
}

/*
 * How many more {{#each}} blocks an expansion may expand. The template and
 * each object element's body start with MAX_EACH_BLOCKS_PER_EXPANSION, and a
 * loop over plain values draws on its parent's — the reach the limit always
 * had. Blocks past it are left as written.
 */
interface EachBlockBudget {
  remaining: number;
}

const MAX_EACH_BLOCKS_PER_EXPANSION: number = 100;

export default class VMUtil {
  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      args?: JSONObject | undefined;
      timeout?: number;
      // See VMRunner.runCodeInSandbox — decided by the caller, not here.
      allowPrivateNetworkRequests?: boolean | undefined;
      privateNetworkAccessIsAllowed?: boolean | undefined;
      privateNetworkHint?: string | undefined;
      includeResolutionDetailInError?: boolean | undefined;
    };
  }): Promise<ReturnResult> {
    return VMRunner.runCodeInSandbox(data);
  }

  @CaptureSpan()
  public static replaceValueInPlace(
    storageMap: JSONObject,
    valueToReplaceInPlace: string,
    isJSON: boolean | undefined,
  ): string {
    let didStringify: boolean = false;

    if (typeof valueToReplaceInPlace === "object") {
      try {
        valueToReplaceInPlace = JSON.stringify(valueToReplaceInPlace);
        didStringify = true;
      } catch (err) {
        logger.error(err);
        return valueToReplaceInPlace;
      }
    }

    /*
     * When we stringified the value ourselves just above, every placeholder in
     * the text we are about to substitute into sits inside a JSON string
     * literal — that is what JSON.stringify did to it. A resolved value
     * carrying a quote or a newline therefore has to be escaped, or the
     * JSON.parse at the bottom of this method fails and the caller silently
     * receives a corrupted string where it asked for an object.
     *
     * This is separate from the caller's isJSON flag, which describes text the
     * caller wrote and where a placeholder may legitimately stand in for a bare
     * JSON value rather than sit inside a string.
     */
    const shouldEscapeForJSON: boolean = Boolean(isJSON) || didStringify;

    if (
      typeof valueToReplaceInPlace === "string" &&
      valueToReplaceInPlace.toString().includes("{{") &&
      valueToReplaceInPlace.toString().includes("}}")
    ) {
      let valueToReplaceInPlaceCopy: string = valueToReplaceInPlace.toString();

      type ResolveVariableFunction = (variable: string) => string | undefined;

      const resolveVariable: ResolveVariableFunction = (
        variable: string,
      ): string | undefined => {
        const foundValue: JSONValue = VMUtil.deepFind(
          storageMap as any,
          variable as any,
        );

        // Skip replacement if the variable is not found in the storageMap.
        if (foundValue === undefined) {
          return undefined;
        }

        // Properly serialize objects to JSON strings
        if (typeof foundValue === "object" && foundValue !== null) {
          return JSON.stringify(foundValue, null, 2);
        }

        return foundValue as string;
      };

      const regex: RegExp = /{{(.*?)}}/g; // Find all matches of the regular expression and capture the word between the braces {{x}} => x

      const firstMatch: RegExpMatchArray | null =
        valueToReplaceInPlaceCopy.match(/{{(.*?)}}/);

      /*
       * The whole template is a single placeholder, so it becomes the raw
       * value: a number stays a number, and an object arrives as JSON rather
       * than escaped into a string literal.
       *
       * Asked of the template as written. It used to be asked of the text the
       * {{#each}} loops had expanded to, so a loop that rendered nothing but
       * an element's own "{{...}}" text lost the whitespace around it and came
       * out as whatever that text named. A single placeholder that does not
       * resolve is rendered like any other template, and so left as written.
       */
      const rawValue: string | undefined =
        firstMatch && firstMatch[0] === valueToReplaceInPlaceCopy.trim()
          ? resolveVariable(firstMatch[1]!)
          : undefined;

      if (rawValue !== undefined) {
        valueToReplaceInPlaceCopy = rawValue;
      } else {
        /*
         * One pass over the template, never a rescan. Substituting one
         * variable at a time into the progressively rewritten string let a
         * resolved value that itself carried {{...}} text — an email subject,
         * a request body, an API response — be matched by a later
         * placeholder: that substitution landed inside the value, and the
         * placeholder the template author wrote was left unrendered. A global
         * replace only matches placeholders in the template it started with.
         *
         * The {{#each}} loops are expanded in the same walk, and only the
         * template's own text around them comes through here, so nothing a
         * loop wrote is scanned again either.
         *
         * Function form, not the string form. String.replace treats $&, $1,
         * $` and $' in the REPLACEMENT as substitution patterns, so a
         * resolved value of "50$" or "a$&b" rewrote itself using the matched
         * text. A function replacement is taken literally.
         */
        valueToReplaceInPlaceCopy = VMUtil.expandEachLoops(
          storageMap,
          valueToReplaceInPlaceCopy,
          shouldEscapeForJSON,
          (text: string): string => {
            return text.replace(
              regex,
              (placeholder: string, variable: string): string => {
                const value: string | undefined = resolveVariable(variable);

                if (value === undefined) {
                  return placeholder;
                }

                return shouldEscapeForJSON
                  ? VMUtil.serializeValueForJSON(value)
                  : `${value}`;
              },
            );
          },
        );
      }

      valueToReplaceInPlace = valueToReplaceInPlaceCopy;
    }

    if (didStringify) {
      try {
        valueToReplaceInPlace = JSON.parse(valueToReplaceInPlace);
      } catch (err) {
        logger.error(err);
        return valueToReplaceInPlace;
      }
    }

    return valueToReplaceInPlace;
  }

  /**
   * Expand {{#each path}}...{{/each}} loop blocks by iterating over arrays.
   *
   * Supports:
   *  - {{variableName}} inside the loop body resolves relative to the current array element
   *  - {{@index}} resolves to the 0-based index of the current iteration
   *  - {{this}} resolves to the current element value (useful for primitive arrays)
   *  - Nested {{#each}} blocks for multi-level array traversal
   *  - If the resolved path is not an array, the block is removed (replaced with empty string)
   *
   * Template text outside every block is returned as written, or passed
   * through renderTextOutsideLoops when one is given — replaceValueInPlace
   * hands in its own substitution, so a template is rendered in one walk.
   *
   * Example:
   *   {{#each requestBody.alerts}}
   *     Alert {{@index}}: {{labels.label}} - {{status}}
   *   {{/each}}
   */
  @CaptureSpan()
  public static expandEachLoops(
    storageMap: JSONObject,
    template: string,
    isJSON: boolean | undefined,
    renderTextOutsideLoops?: ((text: string) => string) | undefined,
  ): string {
    return VMUtil.renderEachLoops({
      template: template,
      scope: {
        lookupChain: [storageMap],
        eachPathScope: storageMap,
      },
      isJSON: isJSON,
      budget: { remaining: MAX_EACH_BLOCKS_PER_EXPANSION },
      renderText:
        renderTextOutsideLoops ||
        ((text: string): string => {
          return text;
        }),
    });
  }

  /*
   * Walk the template once, front to back, expanding its {{#each}} blocks.
   * Every block that is expanded and every {{...}} that is resolved is found
   * in the template's own text; what an element or a variable resolves to is
   * appended to the output and never read again.
   *
   * It used to be read again. Each expansion was spliced back into the text
   * and the search for the next {{#each}} started over from the top, the
   * enclosing loop substituted its names across the expanded body, and
   * replaceValueInPlace substituted across all of it. A value that carried
   * {{...}} or {{#each}} text of its own — a request body, an API response —
   * was then rendered as though the template author had written it, rather
   * than as written.
   *
   * Template text around the blocks goes to renderText. Text either side of a
   * block that rendered nothing is still one run of text, as it was.
   */
  @CaptureSpan()
  private static renderEachLoops(data: {
    template: string;
    scope: EachLoopScope;
    isJSON: boolean | undefined;
    budget: EachBlockBudget;
    renderText: (text: string) => string;
  }): string {
    const template: string = data.template;
    const openTag: RegExp = /\{\{#each\s+(.*?)\}\}/g;

    let output: string = "";
    let pendingText: string = "";
    let position: number = 0;

    while (data.budget.remaining > 0) {
      // Find the next (outermost) {{#each ...}} tag
      openTag.lastIndex = position;
      const openMatch: RegExpExecArray | null = openTag.exec(template);

      if (!openMatch) {
        break; // no more {{#each}} blocks
      }

      data.budget.remaining--;

      const blockStart: number = openMatch.index;
      const arrayPath: string = openMatch[1]!.trim();
      const bodyStart: number = blockStart + openMatch[0]!.length;

      pendingText += template.slice(position, blockStart);

      // Find the matching {{/each}} by counting nesting depth
      let depth: number = 1;
      let searchPos: number = bodyStart;
      let matchEnd: number = -1;
      let bodyEnd: number = -1;

      while (depth > 0 && searchPos < template.length) {
        const nextOpen: number = template.indexOf("{{#each ", searchPos);
        const nextClose: number = template.indexOf("{{/each}}", searchPos);

        if (nextClose === -1) {
          // Unmatched {{#each}} — break out to avoid infinite loop
          break;
        }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          // Found a nested {{#each}} before the next {{/each}}
          depth++;
          searchPos = nextOpen + 8; // skip past "{{#each "
        } else {
          // Found {{/each}}
          depth--;
          if (depth === 0) {
            bodyEnd = nextClose;
            matchEnd = nextClose + "{{/each}}".length;
          }
          searchPos = nextClose + "{{/each}}".length;
        }
      }

      if (matchEnd === -1 || bodyEnd === -1) {
        // Unmatched {{#each}} — drop the tag and carry on after it
        position = bodyStart;
        continue;
      }

      position = matchEnd;

      // Resolve the array from the enclosing scope
      const arrayValue: JSONValue = VMUtil.deepFind(
        data.scope.eachPathScope,
        arrayPath,
      );

      if (!Array.isArray(arrayValue)) {
        // Not an array — the block renders as nothing
        continue;
      }

      const loopBody: string = template.slice(bodyStart, bodyEnd);

      // Expand the loop body for each element in the array
      const expandedParts: Array<string> = [];

      for (let i: number = 0; i < arrayValue.length; i++) {
        const element: JSONValue = arrayValue[i]!;

        /*
         * Replace {{@index}} with the current index throughout the body's
         * text, nested blocks included, so a nested loop's {{@index}} is this
         * loop's. Only digits go in, so the body is still the template's text.
         */
        const iterationBody: string = loopBody.replace(
          /\{\{@index\}\}/g,
          i.toString(),
        );

        const isObjectElement: boolean =
          typeof element === "object" && element !== null;

        /*
         * An object element's properties can be accessed directly (e.g.,
         * {{status}}) and the enclosing ones are still reachable (e.g.,
         * {{requestBody.receiver}}). A plain value is what {{this}} stands
         * for, unless a loop over plain values around this one already set it.
         */
        const iterationScope: EachLoopScope = isObjectElement
          ? {
              lookupChain: [element as JSONObject, ...data.scope.lookupChain],
              eachPathScope: {
                ...data.scope.eachPathScope,
                ...(element as JSONObject),
              },
              thisElement: data.scope.thisElement,
            }
          : {
              lookupChain: data.scope.lookupChain,
              eachPathScope: data.scope.eachPathScope,
              thisElement: data.scope.thisElement || { value: element },
            };

        expandedParts.push(
          VMUtil.renderEachLoops({
            template: iterationBody,
            scope: iterationScope,
            isJSON: data.isJSON,
            budget: isObjectElement
              ? { remaining: MAX_EACH_BLOCKS_PER_EXPANSION }
              : data.budget,
            renderText: (text: string): string => {
              return VMUtil.replaceLoopVariables(
                iterationScope,
                text,
                data.isJSON,
              );
            },
          }),
        );
      }

      const expanded: string = expandedParts.join("");

      if (expanded !== "") {
        output += data.renderText(pendingText) + expanded;
        pendingText = "";
      }
    }

    return output + data.renderText(pendingText + template.slice(position));
  }

  /**
   * Replace {{variable}} placeholders in a run of a loop body's own text.
   * Variables are resolved first against the current element (scoped),
   * then against each enclosing element, then the storage map.
   */
  @CaptureSpan()
  private static replaceLoopVariables(
    scope: EachLoopScope,
    body: string,
    isJSON: boolean | undefined,
  ): string {
    type FormatValueFunction = (value: JSONValue) => string;

    const formatValue: FormatValueFunction = (value: JSONValue): string => {
      const replacement: string =
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : `${value}`;

      return isJSON ? VMUtil.serializeValueForJSON(replacement) : replacement;
    };

    type ReplaceVariablesFunction = (text: string) => string;

    const replaceVariables: ReplaceVariablesFunction = (
      text: string,
    ): string => {
      // Function form — see the note on the same call in replaceValueInPlace.
      return text.replace(
        /\{\{((?!#each\b|\/each\b|@index\b).*?)\}\}/g,
        (placeholder: string, variable: string): string => {
          for (const candidate of scope.lookupChain) {
            const foundValue: JSONValue = VMUtil.deepFind(
              candidate,
              variable.trim(),
            );

            if (foundValue !== undefined) {
              return formatValue(foundValue);
            }
          }

          return placeholder; // leave unresolved
        },
      );
    };

    if (!scope.thisElement) {
      return replaceVariables(body);
    }

    /*
     * {{this}} is taken out before the names around it are looked for, which
     * is the precedence it always had: "{{{this}}}" is still the value in
     * braces. Joining the pieces back on the value, rather than replacing,
     * keeps the value out of that search and reads no $ patterns in it.
     */
    return body
      .split("{{this}}")
      .map(replaceVariables)
      .join(formatValue(scope.thisElement.value));
  }

  @CaptureSpan()
  public static serializeValueForJSON(value: string): string {
    if (!value) {
      return value;
    }

    if (typeof value !== "string") {
      value = JSON.stringify(value);
    } else {
      value = value
        /*
         * Backslash first, and only first. It was missing entirely, so a value
         * like a Windows path or a regex ("C:\Users", "\d+") produced an
         * invalid escape sequence in the surrounding document and the
         * JSON.parse that followed threw. Escaping it after the others would
         * instead double-escape the backslashes they just introduced.
         */
        .split("\\")
        .join("\\\\")
        .split("\t")
        .join("\\t")
        .split("\n")
        .join("\\n")
        .split("\r")
        .join("\\r")
        .split("\b")
        .join("\\b")
        .split("\f")
        .join("\\f")
        .split('"')
        .join('\\"');
    }

    return value;
  }

  @CaptureSpan()
  public static deepFind(obj: JSONObject, path: string): JSONValue {
    const paths: Array<string> = path.split(".");
    let current: any = JSON.parse(JSON.stringify(obj));

    for (let i: number = 0; i < paths.length; ++i) {
      const key: string | undefined = paths[i];

      if (!key) {
        return undefined;
      }
      const openBracketIndex: number = key.indexOf("[");
      const closeBracketIndex: number = key.indexOf("]");

      if (openBracketIndex !== -1 && closeBracketIndex !== -1) {
        const arrayKey: string = key.slice(0, openBracketIndex);
        const indexString: string = key.slice(
          openBracketIndex + 1,
          closeBracketIndex,
        );
        let index: number = 0;

        if (indexString !== "last") {
          index = parseInt(indexString);
        } else {
          /*
           * `current[arrayKey].length` was read unguarded, so `items[last]`
           * against a key that is missing (or is not an array) threw a
           * TypeError out of deepFind and killed the entire run — the one
           * resolution failure in here that was not silent. Fall through to the
           * undefined return that every other miss produces.
           */
          if (!Array.isArray(current[arrayKey])) {
            return undefined;
          }

          index = current[arrayKey].length - 1;
        }

        if (Array.isArray(current[arrayKey]) && current[arrayKey][index]) {
          current = current[arrayKey][index];
        } else {
          return undefined;
        }
      } else if (current && current[key] !== undefined) {
        current = current[key];
      } else {
        return undefined;
      }
    }

    return current;
  }
}
