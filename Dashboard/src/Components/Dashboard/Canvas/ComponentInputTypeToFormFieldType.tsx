import { ComponentInputType } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

export default class ComponentInputTypeToFormFieldType {
  public static getFormFieldTypeByComponentInputType(
    componentInputType: ComponentInputType,
  ): {
    fieldType: FormFieldSchemaType;
    dropdownOptions?: Array<DropdownOption> | undefined;
  } {
    if (componentInputType === ComponentInputType.Boolean) {
      return {
        fieldType: FormFieldSchemaType.Toggle,
        dropdownOptions: [],
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

    if (componentInputType === ComponentInputType.Number) {
      return {
        fieldType: FormFieldSchemaType.Number,
      };
    }

    if (componentInputType === ComponentInputType.LongText) {
      return {
        fieldType: FormFieldSchemaType.LongText,
      };
    }

    if (componentInputType === ComponentInputType.MetricsQueryConfig) {
      return {
        fieldType: FormFieldSchemaType.CustomComponent,
      };
    }

    return {
      fieldType: FormFieldSchemaType.Text,
      dropdownOptions: [],
    };
  }
}
