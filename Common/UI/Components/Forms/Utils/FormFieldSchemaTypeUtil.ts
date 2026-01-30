import FieldType from "../../Types/FieldType";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";

export default class FormFieldSchemaTypeUtil {
  public static toFieldType(
    formFieldSchemaType: FormFieldSchemaType,
  ): FieldType {
    switch (formFieldSchemaType) {
      case FormFieldSchemaType.ObjectID:
        return FieldType.ObjectID;
      case FormFieldSchemaType.Name:
        return FieldType.Name;
      case FormFieldSchemaType.Hostname:
        return FieldType.Hostname;
      case FormFieldSchemaType.ImageFile:
        return FieldType.ImageFile;
      case FormFieldSchemaType.URL:
        return FieldType.URL;
      case FormFieldSchemaType.Route:
        return FieldType.Route;
      case FormFieldSchemaType.Number:
        return FieldType.Number;
      case FormFieldSchemaType.Password:
        return FieldType.Password;
      case FormFieldSchemaType.Text:
        return FieldType.Text;
      case FormFieldSchemaType.Time:
        return FieldType.DateTime;
      case FormFieldSchemaType.Email:
        return FieldType.Email;
      case FormFieldSchemaType.PositiveNumber:
        return FieldType.Number;
      case FormFieldSchemaType.Date:
        return FieldType.Date;
      case FormFieldSchemaType.Phone:
        return FieldType.Phone;
      case FormFieldSchemaType.DateTime:
        return FieldType.DateTime;
      case FormFieldSchemaType.Domain:
        return FieldType.Text;
      case FormFieldSchemaType.LongText:
        return FieldType.LongText;
      case FormFieldSchemaType.Color:
        return FieldType.Color;
      case FormFieldSchemaType.Dropdown:
        return FieldType.Dropdown;
      case FormFieldSchemaType.RadioButton:
        return FieldType.Text;
      case FormFieldSchemaType.File:
        return FieldType.File;
      case FormFieldSchemaType.MultiSelectDropdown:
        return FieldType.MultiSelectDropdown;
      case FormFieldSchemaType.Toggle:
        return FieldType.Boolean;
      case FormFieldSchemaType.Port:
        return FieldType.Port;
      case FormFieldSchemaType.EncryptedText:
        return FieldType.HiddenText;
      case FormFieldSchemaType.Markdown:
        return FieldType.Markdown;
      case FormFieldSchemaType.JavaScript:
        return FieldType.JavaScript;
      case FormFieldSchemaType.CSS:
        return FieldType.CSS;
      case FormFieldSchemaType.HTML:
        return FieldType.HTML;
      case FormFieldSchemaType.OptionChooserButton:
        return FieldType.Element;
      case FormFieldSchemaType.JSON:
        return FieldType.JSON;
      case FormFieldSchemaType.Query:
        return FieldType.Element;
      case FormFieldSchemaType.CustomComponent:
        return FieldType.Element;
      case FormFieldSchemaType.Checkbox:
        return FieldType.Boolean;
      case FormFieldSchemaType.CategoryCheckbox:
        return FieldType.Boolean;
      case FormFieldSchemaType.Icon:
        return FieldType.Icon;

      default:
        return FieldType.Text;
    }
  }
}
