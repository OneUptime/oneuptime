import { DropdownOption } from "../Dropdown/Dropdown";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ComponentMetadata, {
  ComponentCategory,
  ComponentInputType,
} from "../../../Types/Workflow/Component";
import Components, { Categories } from "../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../Types/Workflow/Components/BaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ConditionValueType } from "../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARISONS,
  CONDITION_VALUE_TYPE_LABELS,
  ConditionComparison,
  ConditionComparisonKind,
} from "../../../Types/Workflow/Components/ConditionComparison";

type LoadComponentsAndCategoriesFunction = () => {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
};

export const loadComponentsAndCategories: LoadComponentsAndCategoriesFunction =
  (): {
    components: Array<ComponentMetadata>;
    categories: Array<ComponentCategory>;
  } => {
    let initComponents: Array<ComponentMetadata> = [];
    const initCategories: Array<ComponentCategory> = [...Categories];

    initComponents = initComponents.concat(Components);

    for (const modelType of Entities) {
      const model: BaseModel = new modelType();
      const modelComponents: Array<ComponentMetadata> =
        BaseModelComponentFactory.getComponents(model);

      // A model with no workflow steps has nothing for its category to hold.
      if (modelComponents.length === 0) {
        continue;
      }

      initComponents = initComponents.concat(modelComponents);

      /*
       * The model's own description says what the resource is ("Manage
       * incidents for your project"); the Add Component picker shows it when
       * the resource is opened.
       */
      initCategories.push({
        name: model.singularName || "Model",
        description:
          model.tableDescription ||
          `Interact with ${model.singularName} in your workflow.`,
        icon: model.icon || IconProp.Database,
        tableName: model.tableName || undefined,
      });
    }

    return { components: initComponents, categories: initCategories };
  };

export type ParseStringDictionaryValueFunction = (
  argValue: unknown,
) => JSONObject | null;

/**
 * The key/value view of a StringDictionary argument, or null when the value
 * cannot be shown that way and belongs in the JSON editor instead.
 *
 * Editable as rows:
 *   - nothing yet (a new component)
 *   - an object of primitives, whether stored as an object (written by the row
 *     editor) or as a JSON string (written by the old JSON editor, and by
 *     every workflow that already exists)
 *
 * Not editable as rows, so left in the JSON editor:
 *   - a whole-field template such as {{local.components.x.returnValues.headers}},
 *     which substitutes an entire object at run time and is not JSON as written
 *   - text that does not parse, which is exactly the case where the builder
 *     most needs to see and fix what they typed
 *   - nested objects or arrays, which the row editor cannot represent and would
 *     therefore quietly discard
 */
export const parseStringDictionaryValue: ParseStringDictionaryValueFunction = (
  argValue: unknown,
): JSONObject | null => {
  if (argValue === null || argValue === undefined || argValue === "") {
    return {};
  }

  let candidate: unknown = argValue;

  if (typeof candidate === "string") {
    if (candidate.trim() === "") {
      return {};
    }

    /*
     * JSONFunctions.parse is JSON5, which is what the components themselves use
     * on these values (ApiComponentUtils.sanitizeArgs). Parsing more strictly
     * here than the runtime does would push a value that works today into the
     * JSON editor for no reason.
     */
    try {
      candidate = JSONFunctions.parse(candidate);
    } catch {
      return null;
    }
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return null;
  }

  const entries: JSONObject = candidate as JSONObject;

  for (const key of Object.keys(entries)) {
    const value: unknown = entries[key];

    const isPrimitive: boolean =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean";

    if (!isPrimitive) {
      return null;
    }
  }

  return entries;
};

/*
 * Free text that runs past a line as often as not: a message, a prompt, a
 * value written to the run log. Each of these is a plain box that grows with
 * what is typed, and it stays one whatever the value holds - a message with a
 * {{...}} reference in it is still a message.
 *
 * Markdown is in this list on purpose. The visual Markdown editor rebuilds the
 * whole value from what it shows on every keystroke, and on the way it rewrites
 * anything that looks like formatting to it: the underscores in
 * {{local.variables.my_var}} ... {{global.variables.your_var}} come back as
 * asterisks, which breaks both references, and Slack's own _italic_ comes back
 * as *italic*, which Slack shows in bold. A step hands its arguments on exactly
 * as they are stored, so they have to be stored exactly as typed.
 *
 * AnyValue is anything at all that is typed by hand, which is text: a word, a
 * sentence, a JSON document.
 */
export const MULTI_LINE_TEXT_INPUT_TYPES: ReadonlyArray<ComponentInputType> = [
  ComponentInputType.LongText,
  ComponentInputType.Markdown,
  ComponentInputType.AnyValue,
];

export interface ArgumentFormFieldType {
  fieldType: FormFieldSchemaType;
  dropdownOptions?: Array<DropdownOption> | undefined;
  // See Field.autoGrow. Set for the multi-line text types above.
  autoGrow?: boolean | undefined;
}

type ComponentInputTypeToFormFieldTypeFunction = (
  componentInputType: ComponentInputType,
  argValue: unknown,
) => ArgumentFormFieldType;

/**
 * The form control for an argument of a given type. This is the one place a
 * workflow step's settings, and the Run Workflow form, decide which control a
 * type gets; ArgumentsForm only overrides it for the editors that need the
 * component's database table (row editors, field picker) and for the cron
 * picker.
 */
export const componentInputTypeToFormFieldType: ComponentInputTypeToFormFieldTypeFunction =
  (
    componentInputType: ComponentInputType,
    argValue: unknown,
  ): ArgumentFormFieldType => {
    /*
     * First priority: types whose control does not depend on the value. Each
     * of these can hold a {{...}} reference as it is.
     */

    if (MULTI_LINE_TEXT_INPUT_TYPES.includes(componentInputType)) {
      return {
        fieldType: FormFieldSchemaType.LongText,
        autoGrow: true,
      };
    }

    /*
     * An email body is HTML, and a reference inside it is part of that HTML.
     * This used to sit below the {{ check, so the moment a body gained a
     * reference it was shown in a one-line text box the next time the step was
     * opened, and a whole email had to be read and edited through a slot.
     */
    if (componentInputType === ComponentInputType.HTML) {
      return {
        fieldType: FormFieldSchemaType.HTML,
      };
    }

    if (componentInputType === ComponentInputType.BaseModel) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.BaseModelArray) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.JSON) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.JSONArray) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.JavaScript) {
      return {
        fieldType: FormFieldSchemaType.JavaScript,
      };
    }

    if (componentInputType === ComponentInputType.Query) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.Select) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    /*
     * A dictionary of strings is a list of key/value pairs — request headers,
     * query params — and asking someone to hand-write the braces and commas
     * for that is where a good share of workflow JSON mistakes come from. Give
     * it the key/value row editor instead.
     *
     * Values written before this change are JSON strings, and a value can also
     * be something the row editor cannot represent (a whole-field
     * {{...}} substitution, or nested objects). parseStringDictionaryValue
     * decides; anything it cannot represent stays in the JSON editor, so no
     * existing value is ever silently dropped on the floor.
     */
    if (componentInputType === ComponentInputType.StringDictionary) {
      return {
        fieldType:
          parseStringDictionaryValue(argValue) === null
            ? FormFieldSchemaType.JSON
            : FormFieldSchemaType.Dictionary,
      };
    }

    /*
     * Second priority: a control that holds one value of its own kind - a
     * toggle, a dropdown, a number, a date, an address - cannot show a
     * {{...}} reference, so a value holding one is shown as the one line of
     * text it is.
     */

    if (typeof argValue === "string" && argValue.includes("{{")) {
      return {
        fieldType: FormFieldSchemaType.Text,
        dropdownOptions: [],
      };
    }

    if (componentInputType === ComponentInputType.Boolean) {
      return {
        fieldType: FormFieldSchemaType.Toggle,
        dropdownOptions: [],
      };
    }

    if (componentInputType === ComponentInputType.CronTab) {
      return {
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          {
            label: "Every Minute",
            value: "* * * * *",
          },
          {
            label: "Every 30 minutes",
            value: "*/30 * * * *",
          },
          {
            label: "Every Hour",
            value: "0 * * * *",
          },
          {
            label: "Every Day",
            value: "0 0 * * *",
          },
          {
            label: "Every Week",
            value: "0 0 * * 0",
          },
          {
            label: "Every Month",
            value: "0 0 1 * *",
          },
          {
            label: "Every Three Months",
            value: "0 0 1 */3 *",
          },
          {
            label: "Every Six Months",
            value: "0 0 1 */6 *",
          },
        ],
      };
    }

    /*
     * If / Else draws its own comparison list (Workflow/Condition); this is
     * the same list of stored operators, in the same words, for anything else
     * that has an Operator setting.
     */
    if (componentInputType === ComponentInputType.Operator) {
      return {
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: CONDITION_COMPARISONS.filter(
          (comparison: ConditionComparison) => {
            return comparison.kind !== ConditionComparisonKind.TrueOrFalse;
          },
        ).map((comparison: ConditionComparison) => {
          return {
            label: comparison.label,
            value: comparison.operator,
          };
        }),
      };
    }

    if (componentInputType === ComponentInputType.WorkflowSelect) {
      /*
       * Dropdown options are injected at render time by ArgumentsForm,
       * which fetches the list of workflows in the current project.
       */
      return {
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [],
      };
    }

    if (componentInputType === ComponentInputType.ValueType) {
      return {
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: Object.values(ConditionValueType).map(
          (type: ConditionValueType) => {
            return {
              label: CONDITION_VALUE_TYPE_LABELS[type],
              value: type,
            };
          },
        ),
      };
    }

    if (componentInputType === ComponentInputType.Date) {
      return {
        fieldType: FormFieldSchemaType.Date,
      };
    }

    if (componentInputType === ComponentInputType.DateTime) {
      return {
        fieldType: FormFieldSchemaType.DateTime,
      };
    }

    if (componentInputType === ComponentInputType.Decimal) {
      return {
        fieldType: FormFieldSchemaType.Number,
      };
    }

    if (componentInputType === ComponentInputType.Email) {
      return {
        fieldType: FormFieldSchemaType.Email,
      };
    }

    if (componentInputType === ComponentInputType.Number) {
      return {
        fieldType: FormFieldSchemaType.Number,
      };
    }

    if (componentInputType === ComponentInputType.Password) {
      return {
        fieldType: FormFieldSchemaType.Password,
      };
    }

    if (componentInputType === ComponentInputType.URL) {
      return {
        fieldType: FormFieldSchemaType.URL,
      };
    }

    return {
      fieldType: FormFieldSchemaType.Text,
      dropdownOptions: [],
    };
  };
