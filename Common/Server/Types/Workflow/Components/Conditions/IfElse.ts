import VMUtil from "../../../../Utils/VM/VMAPI";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ReturnResult from "../../../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components, {
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class IfElse extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = Components.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.IfElse;
      },
    );

    if (!Component) {
      throw new BadDataException("Custom JavaScript Component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const yesPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "yes";
      },
    );

    if (!yesPort) {
      throw options.onError(new BadDataException("Yes port not found"));
    }

    const noPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "no";
      },
    );

    if (!noPort) {
      throw options.onError(new BadDataException("No port not found"));
    }

    try {
      /*
       * Set timeout
       * Inject args
       * Inject dependencies
       */

      // Get explicit types from dropdowns, default to text
      let input1Type: ConditionValueType =
        (args["input-1-type"] as ConditionValueType) || ConditionValueType.Text;
      let input2Type: ConditionValueType =
        (args["input-2-type"] as ConditionValueType) || ConditionValueType.Text;

      /*
       * When types differ, coerce both to the more specific type
       * so comparisons like text "true" == boolean true work correctly.
       * Priority: Null/Undefined keep as-is, Boolean > Number > Text.
       */
      if (input1Type !== input2Type) {
        type IsNullishFunction = (t: ConditionValueType) => boolean;

        const isNullish: IsNullishFunction = (
          t: ConditionValueType,
        ): boolean => {
          return (
            t === ConditionValueType.Null || t === ConditionValueType.Undefined
          );
        };

        if (!isNullish(input1Type) && !isNullish(input2Type)) {
          const typePriority: Record<string, number> = {
            [ConditionValueType.Boolean]: 2,
            [ConditionValueType.Number]: 1,
            [ConditionValueType.Text]: 0,
          };

          const p1: number = typePriority[input1Type] ?? 0;
          const p2: number = typePriority[input2Type] ?? 0;
          const commonType: ConditionValueType =
            p1 >= p2 ? input1Type : input2Type;
          input1Type = commonType;
          input2Type = commonType;
        }
      }

      type FormatValueFunction = (
        value: JSONValue,
        valueType: ConditionValueType,
      ) => string;

      const formatValue: FormatValueFunction = (
        value: JSONValue,
        valueType: ConditionValueType,
      ): string => {
        const strValue: string =
          typeof value === "object"
            ? JSON.stringify(value)
            : String(value ?? "");

        switch (valueType) {
          case ConditionValueType.Boolean:
            return strValue === "true" ? "true" : "false";
          case ConditionValueType.Number:
            return isNaN(Number(strValue)) ? "0" : String(Number(strValue));
          case ConditionValueType.Null:
            return "null";
          case ConditionValueType.Undefined:
            return "undefined";
          case ConditionValueType.Text:
          default:
            return `"${strValue}"`;
        }
      };

      args["input-1"] = formatValue(args["input-1"], input1Type);
      args["input-2"] = formatValue(args["input-2"], input2Type);

      type SerializeFunction = (arg: string) => string;

      const serialize: SerializeFunction = (arg: string): string => {
        if (typeof arg === "string") {
          return arg.replace(/\n/g, "--newline--");
        }

        return arg;
      };

      let code: string = `
                    const input1 = ${
                      serialize(args["input-1"] as string) || ""
                    };

                    const input2 = ${
                      serialize(args["input-2"] as string) || ""
                    };
                    
                    `;

      if (args["operator"] === ConditionOperator.Contains) {
        code += `return String(input1).includes(String(input2));`;
      } else if (args["operator"] === ConditionOperator.DoesNotContain) {
        code += `return !String(input1).includes(String(input2));`;
      } else if (args["operator"] === ConditionOperator.StartsWith) {
        code += `return String(input1).startsWith(String(input2));`;
      } else if (args["operator"] === ConditionOperator.EndsWith) {
        code += `return String(input1).endsWith(String(input2));`;
      } else {
        code += `return input1 ${(args["operator"] as string) || "=="} input2;`;
      }

      const returnResult: ReturnResult = await VMUtil.runCodeInSandbox({
        code,
        options: {
          args: args as JSONObject,
        },
      });

      const logMessages: string[] = returnResult.logMessages;

      // add to option.log
      logMessages.forEach((msg: string) => {
        options.log(msg);
      });

      if (returnResult.returnValue) {
        return {
          returnValues: {},
          executePort: yesPort,
        };
      }

      return {
        returnValues: {},
        executePort: noPort,
      };
    } catch (err: any) {
      options.log("Error running script");
      options.log(err.message ? err.message : JSON.stringify(err, null, 2));
      throw options.onError(err);
    }
  }
}
