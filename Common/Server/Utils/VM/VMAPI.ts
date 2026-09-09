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
      // See VMRunner.runCodeInSandbox — decided by the caller, not here.
      allowPrivateNetworkRequests?: boolean | undefined;
      privateNetworkAccessIsAllowed?: boolean | undefined;
      privateNetworkHint?: string | undefined;
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

    if (typeof valueToReplaceInPlace === "string") {
      const exactPlaceholderPattern: RegExp = /^{{([^{}]*)}}$/;
      const exactPlaceholder: RegExpExecArray | null =
        exactPlaceholderPattern.exec(valueToReplaceInPlace.trim());
      const exactValue: JSONValue = exactPlaceholder
        ? VMUtil.deepFind(storageMap, exactPlaceholder[1]!)
        : undefined;

      /*
       * Preserve the exact-placeholder contract: numbers, booleans and null stay
       * typed, and objects/arrays become JSON. Embedded values are text and use
       * the caller's JSON escaping rules instead.
       */
      if (exactValue !== undefined) {
        valueToReplaceInPlace = (
          typeof exactValue === "object" && exactValue !== null
            ? JSON.stringify(exactValue, null, 2)
            : exactValue
        ) as string;
      } else {
        valueToReplaceInPlace = VMUtil.renderTemplate(
          storageMap,
          valueToReplaceInPlace,
          shouldEscapeForJSON,
          true,
        );
      }
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
    return VMUtil.renderTemplate(storageMap, template, isJSON, false);
  }

  /**
   * Parse only the original template. Rendered values are appended directly to
   * the output and never scanned for more template syntax. This matters for
   * untrusted webhook/comment text: a value containing {{local.variables.key}}
   * or {{#each ...}} is data, even if another source placeholder uses that key.
   * Nested loops recurse into their original source body, not rendered text.
   */
  private static renderTemplate(
    storageMap: JSONObject,
    template: string,
    isJSON: boolean | undefined,
    replaceVariables: boolean,
    element?: JSONValue,
    index?: number,
    nestingDepth: number = 0,
  ): string {
    if (nestingDepth > 100) {
      // Bound authored nesting without evaluating the remaining source.
      return template;
    }

    const tokens: RegExp = /\{\{([\s\S]*?)\}\}/g;
    const eachExpressionPattern: RegExp = /^#each\s+([\s\S]+)$/;
    const eachOpeningPattern: RegExp = /^#each\s+/;
    const output: Array<string> = [];
    let cursor: number = 0;
    let token: RegExpExecArray | null;

    while ((token = tokens.exec(template)) !== null) {
      output.push(template.slice(cursor, token.index));
      cursor = tokens.lastIndex;
      const expression: string = token[1]!;
      const each: RegExpExecArray | null =
        eachExpressionPattern.exec(expression);

      if (each) {
        const bodyStart: number = cursor;
        const closingTokens: RegExp = /\{\{([\s\S]*?)\}\}/g;
        closingTokens.lastIndex = bodyStart;
        let depth: number = 1;
        let closing: RegExpExecArray | null;
        let bodyEnd: number = -1;
        let blockEnd: number = -1;
        while ((closing = closingTokens.exec(template)) !== null) {
          if (eachOpeningPattern.test(closing[1]!)) {
            depth++;
          } else if (closing[1] === "/each") {
            depth--;
            if (depth === 0) {
              bodyEnd = closing.index;
              blockEnd = closingTokens.lastIndex;
              break;
            }
          }
        }
        if (bodyEnd === -1) {
          /*
           * Retain the historical unmatched-opening-tag behavior: remove the
           * tag, then process the remaining source normally.
           */
          continue;
        }

        const arrayValue: JSONValue = VMUtil.resolveTemplateValue(
          storageMap,
          each[1]!.trim(),
          element,
          index,
        );
        if (Array.isArray(arrayValue)) {
          const loopBody: string = template.slice(bodyStart, bodyEnd);
          const scopedStorageMap: JSONObject =
            typeof element === "object" && element !== null
              ? { ...storageMap, ...(element as JSONObject) }
              : storageMap;
          for (
            let itemIndex: number = 0;
            itemIndex < arrayValue.length;
            itemIndex++
          ) {
            output.push(
              VMUtil.renderTemplate(
                scopedStorageMap,
                loopBody,
                isJSON,
                true,
                arrayValue[itemIndex],
                itemIndex,
                nestingDepth + 1,
              ),
            );
          }
        }
        cursor = blockEnd;
        tokens.lastIndex = blockEnd;
        continue;
      }

      if (!replaceVariables || expression === "/each") {
        output.push(token[0]);
        continue;
      }
      const value: JSONValue = VMUtil.resolveTemplateValue(
        storageMap,
        index === undefined ? expression : expression.trim(),
        element,
        index,
      );
      if (value === undefined) {
        output.push(token[0]);
        continue;
      }
      const replacement: string =
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : `${value}`;
      output.push(
        isJSON ? VMUtil.serializeValueForJSON(replacement) : replacement,
      );
    }
    output.push(template.slice(cursor));
    return output.join("");
  }

  private static resolveTemplateValue(
    storageMap: JSONObject,
    path: string,
    element?: JSONValue,
    index?: number,
  ): JSONValue {
    if (index !== undefined) {
      if (path === "@index") {
        return index;
      }
      if (path === "this") {
        return element;
      }
      if (typeof element === "object" && element !== null) {
        const scopedValue: JSONValue = VMUtil.deepFind(
          element as JSONObject,
          path,
        );
        if (scopedValue !== undefined) {
          return scopedValue;
        }
      }
    }
    return VMUtil.deepFind(storageMap, path);
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
