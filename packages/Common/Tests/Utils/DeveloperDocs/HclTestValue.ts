import {
  HclExpression,
  HclObjectAttribute,
  HclTupleItem,
} from "../../../Utils/DeveloperDocs/Hcl";

/*
 * An HCL expression as a plain value, so a test can compare a whole
 * converted structure with one toEqual: objects become objects, lists arrays,
 * scalars themselves, a reference `{ ref: "var.x" }` and a function call
 * `{ call: "jsonencode", args: [...] }`.
 */
export type HclTestValue =
  | string
  | number
  | boolean
  | null
  | Array<HclTestValue>
  | { [key: string]: HclTestValue };

export function toTestValue(expression: HclExpression | null): HclTestValue {
  if (!expression) {
    return null;
  }

  switch (expression.kind) {
    case "string":
    case "number":
    case "bool":
      return expression.value;
    case "null":
      return null;
    case "raw":
      return { ref: expression.code };
    case "tuple":
      return expression.items.map((item: HclTupleItem): HclTestValue => {
        return toTestValue(item.value);
      });
    case "object": {
      const object: { [key: string]: HclTestValue } = {};

      expression.attributes.forEach((attribute: HclObjectAttribute) => {
        object[attribute.key] = toTestValue(attribute.value);
      });

      return object;
    }
    case "call":
      return {
        call: expression.name,
        args: expression.args.map((arg: HclExpression): HclTestValue => {
          return toTestValue(arg);
        }),
      };
  }
}
