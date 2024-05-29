import Field from './Types/Field';
import FormFieldSchemaType from './Types/FormFieldSchemaType';
import FormValues from './Types/FormValues';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import Domain from 'Common/Types/Domain';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Exception from 'Common/Types/Exception/Exception';
import GenericObject from 'Common/Types/GenericObject';
import { JSONObject } from 'Common/Types/JSON';
import Phone from 'Common/Types/Phone';
import Port from 'Common/Types/Port';
import Typeof from 'Common/Types/Typeof';

export default class Validation {
    public static validateLength<T extends GenericObject>(
        content: string | undefined,
        field: Field<T>
    ): string | null {
        if (content && field.validation) {
            if (field.validation.minLength) {
                if (content.trim().length < field.validation?.minLength) {
                    return `${field.title || name} cannot be less than ${
                        field.validation.minLength
                    } characters.`;
                }
            }

            if (field.validation.maxLength) {
                if (content.trim().length > field.validation?.maxLength) {
                    return `${field.title || name} cannot be more than ${
                        field.validation.maxLength
                    } characters.`;
                }
            }

            if (field.validation.noSpaces) {
                if (content.trim().includes(' ')) {
                    return `${field.title || name} should not have spaces.`;
                }
            }

            if (field.validation.noSpecialCharacters) {
                if (!content.match(/^[A-Za-z0-9]*$/)) {
                    return `${
                        field.title || name
                    } should not have special characters.`;
                }
            }

            if (field.validation.noNumbers) {
                if (!content.match(/^[A-Za-z]*$/)) {
                    return `${field.title || name} should not have numbers.`;
                }
            }
        }
        return null;
    }

    public static validateDate<T extends GenericObject>(
        content: string | undefined,
        field: Field<T>
    ): string | null {
        if (content && field.validation) {
            if (field.validation.dateShouldBeInTheFuture) {
                if (OneUptimeDate.isInThePast(content.trim())) {
                    return `${field.title || name} should be a future date.`;
                }
            }
        }
        return null;
    }

    public static validateMaxValueAndMinValue<T extends GenericObject>(
        content: string | number | undefined,
        field: Field<T>
    ): string | null {
        if (content && field.validation) {
            if (typeof content === 'string') {
                try {
                    content = parseInt(content);
                } catch (e) {
                    return `${field.title || name} should be a number.`;
                }
            }

            if (field.validation.maxValue) {
                if (content > field.validation?.maxValue) {
                    return `${field.title || name} should not be more than ${
                        field.validation?.maxValue
                    }.`;
                }
            }

            if (field.validation.minValue) {
                if (content < field.validation?.minValue) {
                    return `${field.title || name} should not be less than ${
                        field.validation?.minValue
                    }.`;
                }
            }
        }
        return null;
    }

    public static validateRequired<T extends GenericObject>(
        currentValues: FormValues<T>,
        content: string | undefined,
        field: Field<T>
    ): string | null {
        let required: boolean = false;

        if (field.required && typeof field.required === Typeof.Boolean) {
            required = true;
        } else if (
            field.required &&
            typeof field.required === 'function' &&
            field.required(currentValues)
        ) {
            required = true;
        }

        if (required && (!content || content.length === 0)) {
            return `${field.title} is required.`;
        }
        return null;
    }

    public static validateMatchField<T extends GenericObject>(
        content: string | undefined,
        field: Field<T>,
        entity: JSONObject
    ): string | null {
        if (
            content &&
            field.validation?.toMatchField &&
            entity[field.validation?.toMatchField] &&
            (entity[field.validation?.toMatchField] as string)
                .toString()
                .trim() !== content.trim()
        ) {
            return `${field.title} should match ${field.validation?.toMatchField}`;
        }
        return null;
    }

    public static validateData<T extends GenericObject>(
        content: string | undefined,
        field: Field<T>
    ): string | null {
        if (content && field.fieldType === FormFieldSchemaType.Email) {
            if (!Email.isValid(content!)) {
                return 'Email is not valid.';
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

    public static validate<T extends GenericObject>(args: {
        formFields: Array<Field<T>>;
        values: FormValues<T>;
        onValidate: ((values: FormValues<T>) => JSONObject) | undefined;
        currentFormStepId?: string | null | undefined;
    }): Dictionary<string> {
        const errors: JSONObject = {};
        const entries: JSONObject = { ...args.values } as JSONObject;

        for (const field of args.formFields) {
            if (
                args.currentFormStepId &&
                field.stepId !== args.currentFormStepId
            ) {
                continue;
            }

            if (!field.name) {
                throw new BadDataException('Field name is required.');
            }

            const name: string = field.name;

            if (name in entries) {
                const content: string | undefined = entries[name]?.toString();

                // Check Required fields.
                const resultRequired: string | null = this.validateRequired(
                    args.values,
                    content,
                    field
                );

                if (resultRequired) {
                    errors[name] = resultRequired;
                }

                // Check for valid email data.
                const resultValidateData: string | null = this.validateData(
                    content,
                    field
                );
                if (resultValidateData) {
                    errors[name] = resultValidateData;
                }

                const resultMatch: string | null = this.validateMatchField(
                    content,
                    field,
                    entries
                );

                if (resultMatch) {
                    errors[name] = resultMatch;
                }

                // check for length of content
                const result: string | null = this.validateLength(
                    content,
                    field
                );
                if (result) {
                    errors[name] = result;
                }

                // check for date
                const resultDate: string | null = this.validateDate(
                    content,
                    field
                );
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
                    const resultCustomValidation: string | null =
                        field.customValidation({ ...args.values });

                    if (resultCustomValidation) {
                        errors[name] = resultCustomValidation;
                    }
                }
            } else if (field.required) {
                errors[name] = `${field.title || name} is required.`;
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
