import Field from "./Types/Field";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import FormValues from "./Types/FormValues";
import Hostname from "../../../Types/API/Hostname";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Domain from "../../../Types/Domain";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import GenericObject from "../../../Types/GenericObject";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Phone from "../../../Types/Phone";
import {
  JSONSyntaxCheckResult,
  checkJSONSyntax,
} from "../../../Types/Workflow/TemplateSyntax";
import {
  YamlSyntaxCheckResult,
  checkYamlSyntax,
  describeYamlSyntaxError,
} from "../../../Types/Code/YamlSyntax";
import { Logger } from "../../Utils/Logger";
import Port from "../../../Types/Port";
import Typeof from "../../../Types/Typeof";
import i18next from "i18next";

type InterpolationValues = Record<string, string | number>;

const interpolateTemplate: (
  template: string,
  values: InterpolationValues,
) => string = (template: string, values: InterpolationValues): string => {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match: string, key: string): string => {
      return key in values ? String(values[key]) : match;
    },
  );
};

/*
 * Localize a validation message (WCAG 3.1.2 Language of Parts). The English
 * template — including any {{placeholders}} — doubles as the i18next flat key,
 * so a locale file maps it to a translated template that keeps correct word
 * order. When an i18next instance is initialized (e.g. the status page) the
 * lookup + interpolation run through it; otherwise (apps that don't set up i18n)
 * we fall back to JS-interpolating the English template, so placeholders are
 * never shown literally and behavior is unchanged where i18n isn't set up.
 */
const translateValidationMessage: (
  template: string,
  values?: InterpolationValues,
) => string = (template: string, values: InterpolationValues = {}): string => {
  const englishFallback: string = interpolateTemplate(template, values);
  try {
    if (!i18next.isInitialized) {
      return englishFallback;
    }
    const translated: unknown = i18next.t(template, {
      defaultValue: template,
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      ...values,
    });
    return typeof translated === "string" ? translated : englishFallback;
  } catch {
    return englishFallback;
  }
};

export default class Validation {
  public static validateLength<T extends GenericObject>(
    content: string | undefined,
    field: Field<T>,
  ): string | null {
    if (content && field.validation) {
      if (field.validation.minLength) {
        if (content.trim().length < field.validation?.minLength) {
          return translateValidationMessage(
            "{{field}} cannot be less than {{minLength}} characters.",
            {
              field: field.title || field.name || "",
              minLength: field.validation.minLength,
            },
          );
        }
      }

      if (field.validation.maxLength) {
        if (content.trim().length > field.validation?.maxLength) {
          return translateValidationMessage(
            "{{field}} cannot be more than {{maxLength}} characters.",
            {
              field: field.title || field.name || "",
              maxLength: field.validation.maxLength,
            },
          );
        }
      }

      if (field.validation.noSpaces) {
        if (content.trim().includes(" ")) {
          return translateValidationMessage(
            "{{field}} should not have spaces.",
            { field: field.title || field.name || "" },
          );
        }
      }

      if (field.validation.noSpecialCharacters) {
        if (!content.match(/^[A-Za-z0-9_-]*$/)) {
          return translateValidationMessage(
            "{{field}} can only contain letters, numbers, hyphens (-), and underscores (_).",
            { field: field.title || field.name || "" },
          );
        }
      }

      if (field.validation.noNumbers) {
        if (!content.match(/^[A-Za-z]*$/)) {
          return translateValidationMessage(
            "{{field}} should not have numbers.",
            { field: field.title || field.name || "" },
          );
        }
      }
    }
    return null;
  }

  public static validateDate<T extends GenericObject>(
    content: string | undefined,
    field: Field<T>,
  ): string | null {
    if (content && field.validation) {
      if (field.validation.dateShouldBeInTheFuture) {
        if (OneUptimeDate.isInThePast(content.trim())) {
          return translateValidationMessage(
            "{{field}} should be a future date.",
            { field: field.title || field.name || "" },
          );
        }
      }
    }
    return null;
  }

  public static validateMaxValueAndMinValue<T extends GenericObject>(
    content: string | number | undefined,
    field: Field<T>,
  ): string | null {
    if (content && field.validation) {
      if (typeof content === "string") {
        try {
          content = parseInt(content);
        } catch (e) {
          Logger.error(e as string);
          return translateValidationMessage("{{field}} should be a number.", {
            field: field.title || field.name || "",
          });
        }
      }

      /*
       * `!== undefined`, not truthiness: a declared bound of 0 is a real
       * bound (e.g. "not less than 0" on a milliseconds field), and the
       * old falsy guard silently skipped it.
       */
      if (field.validation.maxValue !== undefined) {
        if (content > field.validation.maxValue) {
          return translateValidationMessage(
            "{{field}} should not be more than {{maxValue}}.",
            {
              field: field.title || field.name || "",
              maxValue: field.validation.maxValue,
            },
          );
        }
      }

      if (field.validation.minValue !== undefined) {
        if (content < field.validation.minValue) {
          return translateValidationMessage(
            "{{field}} should not be less than {{minValue}}.",
            {
              field: field.title || field.name || "",
              minValue: field.validation.minValue,
            },
          );
        }
      }
    }
    return null;
  }

  public static validateRequired<T extends GenericObject>(
    currentValues: FormValues<T>,
    content: string | undefined,
    field: Field<T>,
  ): string | null {
    let required: boolean = false;

    if (field.required && typeof field.required === Typeof.Boolean) {
      required = true;
    } else if (
      field.required &&
      typeof field.required === "function" &&
      field.required(currentValues)
    ) {
      required = true;
    }

    if (required && (!content || content.length === 0)) {
      return translateValidationMessage("{{field}} is required.", {
        field: field.title || field.name || "",
      });
    }
    return null;
  }

  public static validateMatchField<T extends GenericObject>(
    content: string | undefined,
    field: Field<T>,
    entity: FormValues<T>,
  ): string | null {
    if (
      content &&
      field.validation?.toMatchField &&
      entity[field.validation?.toMatchField] &&
      (entity[field.validation?.toMatchField] as string).toString().trim() !==
        content.trim()
    ) {
      return translateValidationMessage(
        "{{field}} should match {{matchField}}",
        {
          field: field.title || field.name || "",
          matchField: field.validation?.toMatchField as string,
        },
      );
    }
    return null;
  }

  public static validateData<T extends GenericObject>(
    content: string | undefined,
    field: Field<T>,
  ): string | null {
    if (content && field.fieldType === FormFieldSchemaType.Email) {
      if (!Email.isValid(content!)) {
        return translateValidationMessage("Email is not valid.");
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Port) {
      try {
        new Port(content);
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.URL) {
      try {
        URL.fromString(content);
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Hostname) {
      try {
        new Hostname(content.toString());
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Route) {
      try {
        new Route(content.toString());
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Phone) {
      try {
        new Phone(content.toString());
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Color) {
      try {
        new Color(content.toString());
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    if (content && field.fieldType === FormFieldSchemaType.Domain) {
      try {
        new Domain(content.toString());
      } catch (e: unknown) {
        if (e instanceof Exception) {
          return e.getMessage();
        }
      }
    }

    return null;
  }

  /**
   * A JSON field whose contents are not JSON.
   *
   * Until this existed, a stray trailing comma saved cleanly and only surfaced
   * when something tried to parse it — for a workflow that meant a real run,
   * at whatever hour the trigger fired, ending in
   * "Invalid JSON provided for argument request-body"
   * (RunWorkflow.getComponentArguments).
   *
   * Takes the raw value rather than the stringified `content` the other
   * validators get, because a JSON-typed field can legitimately already hold a
   * parsed object, and `String(anObject)` is "[object Object]" — which is not
   * JSON, and would fail every time.
   *
   * Tolerates {{...}} handlebars: workflow arguments are templates, and
   * `{"retries": {{local.variables.retryCount}}}` is not JSON as written but is
   * JSON by the time it is parsed. checkJSONSyntax masks those before parsing
   * and declines to judge anything containing a {{#each}} loop at all.
   */
  public static validateJSONSyntax<T extends GenericObject>(
    value: JSONValue | undefined,
    field: Field<T>,
  ): string | null {
    if (field.fieldType !== FormFieldSchemaType.JSON) {
      return null;
    }

    const result: JSONSyntaxCheckResult = checkJSONSyntax(value, {
      allowJSON5: field.allowJSON5,
    });

    if (result.isValid) {
      return null;
    }

    return translateValidationMessage(
      "{{field}} is not valid JSON. {{parserMessage}}",
      {
        field: field.title || field.name || "",
        parserMessage: result.errorMessage || "",
      },
    );
  }

  /**
   * Reject a YAML-typed field whose text does not parse.
   *
   * The server validates too (a Sigma rule is compiled on save), but a round
   * trip to hear "bad indentation on line 4" is a poor way to find out. Like
   * validateJSONSyntax this takes the raw value rather than the stringified
   * `content`, and defers to checkYamlSyntax for what it declines to judge.
   */
  public static validateYAMLSyntax<T extends GenericObject>(
    value: JSONValue | undefined,
    field: Field<T>,
  ): string | null {
    if (field.fieldType !== FormFieldSchemaType.YAML) {
      return null;
    }

    const result: YamlSyntaxCheckResult = checkYamlSyntax(value);

    if (result.isValid) {
      return null;
    }

    return translateValidationMessage(
      "{{field}} is not valid YAML. {{parserMessage}}",
      {
        field: field.title || field.name || "",
        parserMessage: describeYamlSyntaxError(result),
      },
    );
  }

  public static validate<T extends GenericObject>(args: {
    formFields: Array<Field<T>>;
    values: FormValues<T>;
    onValidate: ((values: FormValues<T>) => JSONObject) | undefined;
    currentFormStepId?: string | null | undefined;
  }): Dictionary<string> {
    const errors: JSONObject = {};
    const entries: FormValues<T> = { ...args.values };

    for (const field of args.formFields) {
      if (args.currentFormStepId && field.stepId !== args.currentFormStepId) {
        continue;
      }

      if (!field.name) {
        throw new BadDataException("Field name is required.");
      }

      const name: string = field.name;

      // is this field visible? If not visible, skip validation.

      if (field.showIf) {
        const isVisible: boolean = field?.showIf(args.values);

        if (!isVisible) {
          continue;
        }
      }

      if (name in entries) {
        const content: string | undefined = (entries as JSONObject)[
          name
        ]?.toString();

        // Check Required fields.
        const resultRequired: string | null = this.validateRequired(
          args.values,
          content,
          field,
        );

        if (resultRequired) {
          errors[name] = resultRequired;
        }

        // Check for valid email data.
        const resultValidateData: string | null = this.validateData(
          content,
          field,
        );
        if (resultValidateData) {
          errors[name] = resultValidateData;
        }

        /*
         * Fed the raw value, not `content` — see validateJSONSyntax. An
         * already-parsed object stringifies to "[object Object]", which would
         * fail the check every time it was handed the stringified form.
         */
        const resultJSONSyntax: string | null = this.validateJSONSyntax(
          (entries as JSONObject)[name] as JSONValue | undefined,
          field,
        );

        if (resultJSONSyntax) {
          errors[name] = resultJSONSyntax;
        }

        // Fed the raw value for the same reason validateJSONSyntax is.
        const resultYAMLSyntax: string | null = this.validateYAMLSyntax(
          (entries as JSONObject)[name] as JSONValue | undefined,
          field,
        );

        if (resultYAMLSyntax) {
          errors[name] = resultYAMLSyntax;
        }

        const resultMatch: string | null = this.validateMatchField(
          content,
          field,
          entries,
        );

        if (resultMatch) {
          errors[name] = resultMatch;
        }

        // check for length of content
        const result: string | null = this.validateLength(content, field);
        if (result) {
          errors[name] = result;
        }

        // check for date
        const resultDate: string | null = this.validateDate(content, field);
        if (resultDate) {
          errors[name] = resultDate;
        }

        // check for length of content
        const resultMaxMinValue: string | null =
          this.validateMaxValueAndMinValue(content, field);

        if (resultMaxMinValue) {
          errors[name] = resultMaxMinValue;
        }

        if (field.customValidation) {
          // check for length of content
          const resultCustomValidation: string | null = field.customValidation({
            ...args.values,
          });

          if (resultCustomValidation) {
            errors[name] = resultCustomValidation;
          }
        }
      } else if (field.required) {
        errors[name] = translateValidationMessage("{{field}} is required.", {
          field: field.title || field.name || "",
        });
      }
    }

    let customValidateResult: JSONObject = {};

    if (args.onValidate) {
      customValidateResult = args.onValidate(args.values);
    }

    const totalValidationErrors: Dictionary<string> = {
      ...errors,
      ...customValidateResult,
    } as Dictionary<string>;

    return totalValidationErrors;
  }
}
