import { IsolatedVMHostname } from "../../../Server/EnvironmentConfig";
import ClusterKeyAuthorization from "../../Middleware/ClusterKeyAuthorization";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import API from "../../../Utils/API";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class VMUtil {
  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      args?: JSONObject | undefined;
      timeout?: number | undefined;
    };
  }): Promise<ReturnResult> {
    const returnResultHttpResponse:
      | HTTPErrorResponse
      | HTTPResponse<JSONObject> = await API.post<JSONObject>({
      url: new URL(
        Protocol.HTTP,
        IsolatedVMHostname,
        new Route("/isolated-vm/run-code"),
      ),
      data: {
        ...data,
      },
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });

    if (returnResultHttpResponse instanceof HTTPErrorResponse) {
      throw returnResultHttpResponse;
    }

    const returnResult: ReturnResult = returnResultHttpResponse.data as any;

    return returnResult;
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
