import { DropdownOption } from "../Dropdown/Dropdown";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentInputType,
} from "../../../Types/Workflow/Component";
import Components, { Categories } from "../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../Types/Workflow/Components/BaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import { ConditionOperator } from "../../../Types/Workflow/Components/Condition";

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

    for (const model of Entities) {
      initComponents = initComponents.concat(
        BaseModelComponentFactory.getComponents(new model()),
      );
      initCategories.push({
        name: new model().singularName || "Model",
        description: `Interact with ${
          new model().singularName
        } in your workflow.`,
        icon: new model().icon || IconProp.Database,
      });
    }

    return { components: initComponents, categories: initCategories };
  };

type ComponentInputTypeToFormFieldTypeFunction = (
  componentInputType: ComponentInputType,
  argValue: unknown,
) => {
  fieldType: FormFieldSchemaType;
  dropdownOptions?: Array<DropdownOption> | undefined;
};

export const componentInputTypeToFormFieldType: ComponentInputTypeToFormFieldTypeFunction =
  (
    componentInputType: ComponentInputType,
    argValue: unknown,
  ): {
    fieldType: FormFieldSchemaType;
    dropdownOptions?: Array<DropdownOption> | undefined;
  } => {
    // first priority.

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

    if (componentInputType === ComponentInputType.Markdown) {
      return {
        fieldType: FormFieldSchemaType.Markdown,
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

    if (componentInputType === ComponentInputType.StringDictionary) {
      return {
        fieldType: FormFieldSchemaType.JSON,
      };
    }

    if (componentInputType === ComponentInputType.LongText) {
      return {
        fieldType: FormFieldSchemaType.LongText,
      };
    }

    // Second priority.

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

    if (componentInputType === ComponentInputType.HTML) {
      return {
        fieldType: FormFieldSchemaType.HTML,
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

    if (componentInputType === ComponentInputType.Operator) {
      return {
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          {
            label: "Equal To",
            value: ConditionOperator.EqualTo,
          },
          {
            label: "Not Equal To",
            value: ConditionOperator.NotEqualTo,
          },
          {
            label: "Greater Than",
            value: ConditionOperator.GreaterThan,
          },
          {
            label: "Less Than",
            value: ConditionOperator.LessThan,
          },
          {
            label: "Greater Than or Equal",
            value: ConditionOperator.GreaterThanOrEqualTo,
          },
          {
            label: "Less Than or Equal",
            value: ConditionOperator.LessThanOrEqualTo,
          },
          {
            label: "Contains",
            value: ConditionOperator.Contains,
          },
          {
            label: "Does Not Contain",
            value: ConditionOperator.DoesNotContain,
          },
          {
            label: "Starts With",
            value: ConditionOperator.StartsWith,
          },
          {
            label: "Ends With",
            value: ConditionOperator.EndsWith,
          },
        ],
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
