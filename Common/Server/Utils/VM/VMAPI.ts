import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import VMRunner from "./VMRunner";

export default class VMUtil {
  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      args?: JSONObject | undefined;
      timeout?: number;
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

    if (
      typeof valueToReplaceInPlace === "string" &&
      valueToReplaceInPlace.toString().includes("{{") &&
      valueToReplaceInPlace.toString().includes("}}")
    ) {
      let valueToReplaceInPlaceCopy: string = valueToReplaceInPlace.toString();

      // First, expand {{#each path}}...{{/each}} loops before variable substitution
      valueToReplaceInPlaceCopy = VMUtil.expandEachLoops(
        storageMap,
        valueToReplaceInPlaceCopy,
        isJSON,
      );

      const variablesInArgument: Array<string> = [];

      const regex: RegExp = /{{(.*?)}}/g; // Find all matches of the regular expression and capture the word between the braces {{x}} => x

      let match: RegExpExecArray | null = null;

      while ((match = regex.exec(valueToReplaceInPlaceCopy)) !== null) {
        if (match[1]) {
          variablesInArgument.push(match[1]);
        }
      }

      for (const variable of variablesInArgument) {
        const foundValue: JSONValue = VMUtil.deepFind(
          storageMap as any,
          variable as any,
        );

        // Skip replacement if the variable is not found in the storageMap.
        if (foundValue === undefined) {
          continue;
        }

        let valueToReplaceInPlace: string;

        // Properly serialize objects to JSON strings
        if (typeof foundValue === "object" && foundValue !== null) {
          valueToReplaceInPlace = JSON.stringify(foundValue, null, 2);
        } else {
          valueToReplaceInPlace = foundValue as string;
        }

        if (valueToReplaceInPlaceCopy.trim() === "{{" + variable + "}}") {
          valueToReplaceInPlaceCopy = valueToReplaceInPlace;
        } else {
          valueToReplaceInPlaceCopy = valueToReplaceInPlaceCopy.replace(
            "{{" + variable + "}}",
            isJSON
              ? VMUtil.serializeValueForJSON(valueToReplaceInPlace)
              : `${valueToReplaceInPlace}`,
          );
        }
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
  ): string {
    let result: string = template;
    const maxIterations: number = 100; // safety limit to prevent infinite loops
    let iterations: number = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Find the first (outermost) {{#each ...}} tag
      const openTag: RegExp = /\{\{#each\s+(.*?)\}\}/;
      const openMatch: RegExpExecArray | null = openTag.exec(result);

      if (!openMatch) {
        break; // no more {{#each}} blocks
      }

      const blockStart: number = openMatch.index!;
      const arrayPath: string = openMatch[1]!.trim();
      const bodyStart: number = blockStart + openMatch[0]!.length;

      // Find the matching {{/each}} by counting nesting depth
      let depth: number = 1;
      let searchPos: number = bodyStart;
      let matchEnd: number = -1;
      let bodyEnd: number = -1;

      while (depth > 0 && searchPos < result.length) {
        const nextOpen: number = result.indexOf("{{#each ", searchPos);
        const nextClose: number = result.indexOf("{{/each}}", searchPos);

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
        // Unmatched {{#each}} — remove it to prevent infinite loop
        result =
          result.slice(0, blockStart) +
          result.slice(blockStart + openMatch[0]!.length);
        continue;
      }

      const loopBody: string = result.slice(bodyStart, bodyEnd);

      // Resolve the array from the storage map
      const arrayValue: JSONValue = VMUtil.deepFind(storageMap, arrayPath);

      if (!Array.isArray(arrayValue)) {
        // Not an array — remove the block entirely
        result = result.slice(0, blockStart) + result.slice(matchEnd);
        continue;
      }

      // Expand the loop body for each element in the array
      const expandedParts: Array<string> = [];

      for (let i: number = 0; i < arrayValue.length; i++) {
        const element: JSONValue = arrayValue[i]!;
        let iterationBody: string = loopBody;

        // Replace {{@index}} with the current index
        iterationBody = iterationBody.replace(/\{\{@index\}\}/g, i.toString());

        if (typeof element === "object" && element !== null) {
          /*
           * Merge element properties into a scoped storageMap so that:
           * 1. Element properties can be accessed directly (e.g., {{status}})
           * 2. Parent storageMap properties are still accessible (e.g., {{requestBody.receiver}})
           */
          const scopedStorageMap: JSONObject = {
            ...storageMap,
            ...(element as JSONObject),
          };

          // Recursively expand any nested {{#each}} blocks within the iteration body
          iterationBody = VMUtil.expandEachLoops(
            scopedStorageMap,
            iterationBody,
            isJSON,
          );

          // Replace remaining {{variable}} placeholders
          iterationBody = VMUtil.replaceLoopVariables(
            element as JSONObject,
            storageMap,
            iterationBody,
            isJSON,
          );
        } else {
          // For primitive array elements, replace {{this}} with the value
          iterationBody = iterationBody.replace(
            /\{\{this\}\}/g,
            isJSON ? VMUtil.serializeValueForJSON(`${element}`) : `${element}`,
          );
        }

        expandedParts.push(iterationBody);
      }

      result =
        result.slice(0, blockStart) +
        expandedParts.join("") +
        result.slice(matchEnd);
    }

    return result;
  }

  /**
   * Replace {{variable}} placeholders inside a loop body.
   * Variables are resolved first against the current element (scoped),
   * then fall back to the parent storageMap.
   */
  @CaptureSpan()
  private static replaceLoopVariables(
    element: JSONObject,
    parentStorageMap: JSONObject,
    body: string,
    isJSON: boolean | undefined,
  ): string {
    const variableRegex: RegExp = /\{\{((?!#each\b|\/each\b|@index\b).*?)\}\}/g;
    let match: RegExpExecArray | null = null;
    const variables: Array<string> = [];

    while ((match = variableRegex.exec(body)) !== null) {
      if (match[1]) {
        variables.push(match[1]);
      }
    }

    for (const variable of variables) {
      // First try resolving relative to the current element
      let foundValue: JSONValue = VMUtil.deepFind(element, variable.trim());

      // Fall back to the parent storage map (for absolute paths)
      if (foundValue === undefined) {
        foundValue = VMUtil.deepFind(parentStorageMap, variable.trim());
      }

      if (foundValue === undefined) {
        continue; // leave unresolved
      }

      let replacement: string;

      if (typeof foundValue === "object" && foundValue !== null) {
        replacement = JSON.stringify(foundValue, null, 2);
      } else {
        replacement = `${foundValue}`;
      }

      body = body.replace(
        "{{" + variable + "}}",
        isJSON ? VMUtil.serializeValueForJSON(replacement) : replacement,
      );
    }

    return body;
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
