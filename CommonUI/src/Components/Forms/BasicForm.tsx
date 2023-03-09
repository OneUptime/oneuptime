import React, {
    forwardRef,
    ForwardRefExoticComponent,
    ReactElement,
    Ref,
    useEffect,
    useImperativeHandle,
    useState,
} from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import ButtonTypes from '../Button/ButtonTypes';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import FormFieldSchemaType from './Types/FormFieldSchemaType';
import Email from 'Common/Types/Email';
import Link from '../Link/Link';
import Alert, { AlertType } from '../Alerts/Alert';
import ColorPicker from './Fields/ColorPicker';
import Color from 'Common/Types/Color';
import TextArea from '../TextArea/TextArea';
import Dropdown, { DropdownOption, DropdownValue } from '../Dropdown/Dropdown';
import OneUptimeDate from 'Common/Types/Date';
import Toggle from '../Toggle/Toggle';
import Port from 'Common/Types/Port';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';
import Exception from 'Common/Types/Exception/Exception';
import HashedString from 'Common/Types/HashedString';
import Input, { InputType } from '../Input/Input';
import CodeEditor from '../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import FilePicker from '../FilePicker/FilePicker';
import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Common/Models/FileModel';
import Phone from 'Common/Types/Phone';
import Domain from 'Common/Types/Domain';
import Typeof from 'Common/Types/Typeof';
import URL from 'Common/Types/API/URL';
import RadioButtons from '../RadioButtons/RadioButtons';
import UiAnalytics from '../../Utils/Analytics';
import Dictionary from 'Common/Types/Dictionary';
import Field from './Types/Field';

export const DefaultValidateFunction: Function = (
    _values: FormValues<JSONObject>
): JSONObject => {
    return {};
};

export interface ComponentProps<T extends Object> {
    id: string;
    name: string;
    submitButtonStyleType?: ButtonStyleType | undefined;
    initialValues: FormValues<T>;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: undefined | ((values: FormValues<T>) => JSONObject);
    onChange?: undefined | ((values: FormValues<T>) => void);
    fields: Fields<T>;
    submitButtonText?: undefined | string;
    title?: undefined | string;
    description?: undefined | string;
    showAsColumns?: undefined | number;
    footer: ReactElement;
    isLoading?: undefined | boolean;
    onCancel?: undefined | (() => void) | null;
    cancelButtonText?: undefined | string | null;
    maxPrimaryButtonWidth?: undefined | boolean;
    error: string | null;
    hideSubmitButton?: undefined | boolean;
    onFormValidationErrorChanged?: ((hasError: boolean) => void) | undefined;
}

function getFieldType(fieldType: FormFieldSchemaType): string {
    switch (fieldType) {
        case FormFieldSchemaType.Email:
            return 'email';
        case FormFieldSchemaType.Password:
            return 'password';
        case FormFieldSchemaType.EncryptedText:
            return 'password';
        case FormFieldSchemaType.Number:
            return 'number';
        case FormFieldSchemaType.Date:
            return 'date';
        case FormFieldSchemaType.DateTime:
            return 'datetime-local';
        case FormFieldSchemaType.LongText:
            return 'textarea';
        case FormFieldSchemaType.Color:
            return 'color';
        case FormFieldSchemaType.URL:
            return 'url';
        default:
            return 'text';
    }
}

const BasicForm: ForwardRefExoticComponent<any> = forwardRef(
    <T extends Object>(
        props: ComponentProps<T>,
        ref: Ref<any>
    ): ReactElement => {
        const [currentValue, setCurrentValue] = useState<FormValues<T>>(
            props.initialValues
        );
        const [errors, setErrors] = useState<Dictionary<string>>({});
        const [touched, setTouched] = useState<Dictionary<boolean>>({});

        const [formFields, setFormFields] = useState<Fields<T>>([]);

        const setFieldTouched: Function = (
            fieldName: string,
            value: boolean
        ): void => {
            setTouched({ ...touched, [fieldName]: value });
        };

        const [isInitialValuesInitialized, setIsInitialValuesInitialized] =
            useState<boolean>(false);

        useEffect(() => {
            validate(currentValue);
        }, [currentValue]);

        useImperativeHandle(
            ref,
            () => {
                return {
                    setFieldTouched,
                    setFieldValue,
                    submitForm,
                };
            },
            [currentValue, errors, touched, formFields]
        );

        useEffect(() => {
            setFormFields([...props.fields]);
        }, [props.fields]);

        const getFieldName: Function = (field: Field<T>): string => {
            const fieldName: string = field.overideFieldKey
                ? field.overideFieldKey
                : (Object.keys(field.field)[0] as string);

            return fieldName;
        };

        const setAllTouched: Function = (): void => {
            const touchedObj: Dictionary<boolean> = {};

            for (const field of formFields) {
                touchedObj[getFieldName(field)] = true;
            }

            setTouched(touchedObj);
        };

        const setFieldValue: Function = (
            fieldName: string,
            value: JSONValue
        ): void => {
            setCurrentValue({ ...currentValue, [fieldName]: value as any });
            if (props.onChange) {
                props.onChange(currentValue);
            }
        };

        const submitForm: Function = (): void => {
            // check for any boolean values and if they dont exist in values - mark them as false.
            setAllTouched();
            const validationErrors: Dictionary<string> = validate(currentValue);

            if (Object.keys(validationErrors).length > 0) {
                // errors on form, do not submit.
                return;
            }

            const values: FormValues<T> = currentValue;

            for (const field of formFields) {
                if (field.fieldType === FormFieldSchemaType.Toggle) {
                    const fieldName: string = getFieldName(field);
                    if (!(values as any)[fieldName]) {
                        (values as any)[fieldName] = false;
                    }
                }

                if (field.fieldType === FormFieldSchemaType.Password) {
                    const fieldName: string = getFieldName(field);
                    if (
                        (values as any)[fieldName] &&
                        typeof (values as any)[fieldName] === Typeof.String
                    ) {
                        (values as any)[fieldName] = new HashedString(
                            (values as any)[fieldName],
                            false
                        );
                    }
                }
            }

            UiAnalytics.capture('FORM SUBMIT: ' + props.name);

            props.onSubmit(values);
        };

        const getFormField: Function = (
            field: Field<T>,
            index: number,
            isDisabled: boolean,
            errors: Dictionary<string>,
            touched: Dictionary<boolean>
        ): ReactElement => {
            index = index + 1;

            const fieldType: string = field.fieldType
                ? getFieldType(field.fieldType)
                : 'text';

            if (Object.keys(field.field).length === 0) {
                throw new BadDataException('Object cannot be without Field');
            }

            if (props.showAsColumns && props.showAsColumns > 2) {
                throw new BadDataException(
                    'showAsCOlumns should be <= 2. It is currently ' +
                        props.showAsColumns
                );
            }

            const fieldName: string = getFieldName(field);

            if (field.showIf && !field.showIf(currentValue)) {
                return <></>;
            }

            let codeType: CodeType = CodeType.HTML;

            if (field.fieldType === FormFieldSchemaType.CSS) {
                codeType = CodeType.CSS;
            }

            if (field.fieldType === FormFieldSchemaType.JavaScript) {
                codeType = CodeType.JavaScript;
            }

            return (
                <div className="sm:col-span-4 mt-0 mb-2" key={index}>
                    <label className="block text-sm font-medium text-gray-700 flex justify-between">
                        <span>
                            {field.title}{' '}
                            <span className="text-gray-400 text-xs">
                                {field.required ? '' : '(Optional)'}
                            </span>
                        </span>
                        {field.sideLink &&
                            field.sideLink?.text &&
                            field.sideLink?.url && (
                                <span data-testid="login-forgot-password">
                                    <Link
                                        to={field.sideLink?.url}
                                        className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                                    >
                                        {field.sideLink?.text}
                                    </Link>
                                </span>
                            )}
                    </label>

                    {field.description && (
                        <p className="mt-1 text-sm text-gray-500">
                            {field.description}
                        </p>
                    )}

                    <div className="mt-1">
                        {field.fieldType === FormFieldSchemaType.Color && (
                            <ColorPicker
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                onChange={async (value: Color | null) => {
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                    setFieldTouched(fieldName, true);
                                }}
                                tabIndex={index}
                                placeholder={field.placeholder || ''}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                            />
                        )}

                        {(field.fieldType === FormFieldSchemaType.Dropdown ||
                            field.fieldType ===
                                FormFieldSchemaType.MultiSelectDropdown) && (
                            <Dropdown
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                tabIndex={index}
                                onChange={async (
                                    value:
                                        | DropdownValue
                                        | Array<DropdownValue>
                                        | null
                                ) => {
                                    setCurrentValue({
                                        ...currentValue,
                                        [fieldName]: value,
                                    });

                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                isMultiSelect={
                                    field.fieldType ===
                                    FormFieldSchemaType.MultiSelectDropdown
                                }
                                options={field.dropdownOptions || []}
                                placeholder={field.placeholder || ''}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                            />
                        )}

                        {field.fieldType ===
                            FormFieldSchemaType.RadioButton && (
                            <RadioButtons
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                onChange={async (value: string) => {
                                    setCurrentValue({
                                        ...currentValue,
                                        [fieldName]: value,
                                    });
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                options={field.radioButtonOptions || []}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                            />
                        )}

                        {field.fieldType === FormFieldSchemaType.LongText && (
                            <TextArea
                                autoFocus={index === 1}
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                tabIndex={index}
                                onChange={async (value: string) => {
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}

                        {field.fieldType === FormFieldSchemaType.JSON && (
                            <CodeEditor
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                type={CodeType.JSON}
                                tabIndex={index}
                                onChange={async (value: string) => {
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}

                        {field.fieldType === FormFieldSchemaType.Markdown && (
                            <CodeEditor
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                tabIndex={index}
                                type={CodeType.Markdown}
                                onChange={async (value: string) => {
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}

                        {(field.fieldType === FormFieldSchemaType.HTML ||
                            field.fieldType === FormFieldSchemaType.CSS ||
                            field.fieldType ===
                                FormFieldSchemaType.JavaScript) && (
                            <CodeEditor
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                tabIndex={index}
                                onChange={async (value: string) => {
                                    setCurrentValue({
                                        ...currentValue,
                                        [fieldName]: value,
                                    });
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                type={codeType}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : ''
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}

                        {(field.fieldType === FormFieldSchemaType.File ||
                            field.fieldType ===
                                FormFieldSchemaType.ImageFile) && (
                            <FilePicker
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                tabIndex={index}
                                onChange={async (files: Array<FileModel>) => {
                                    let fileResult:
                                        | FileModel
                                        | Array<FileModel>
                                        | null = files.map((i: FileModel) => {
                                        const strippedModel: FileModel =
                                            new FileModel();
                                        strippedModel._id = i._id!;
                                        return strippedModel;
                                    });

                                    if (
                                        (field.fieldType ===
                                            FormFieldSchemaType.File ||
                                            field.fieldType ===
                                                FormFieldSchemaType.ImageFile) &&
                                        Array.isArray(fileResult)
                                    ) {
                                        if (fileResult.length > 0) {
                                            fileResult =
                                                fileResult[0] as FileModel;
                                        } else {
                                            fileResult = null;
                                        }
                                    }
                                    setCurrentValue({
                                        ...currentValue,
                                        fieldName: fileResult,
                                    });
                                    field.onChange &&
                                        field.onChange(fileResult);
                                    setFieldValue(fieldName, fileResult);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                mimeTypes={
                                    field.fieldType ===
                                    FormFieldSchemaType.ImageFile
                                        ? [
                                              MimeType.png,
                                              MimeType.jpeg,
                                              MimeType.jpg,
                                          ]
                                        : []
                                }
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : []
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}

                        {field.fieldType === FormFieldSchemaType.Toggle && (
                            <Toggle
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                onChange={async (value: boolean) => {
                                    field.onChange && field.onChange(value);
                                    setFieldValue(fieldName, value);
                                }}
                                onBlur={async () => {
                                    setFieldTouched(fieldName, true);
                                }}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName] &&
                                    ((currentValue as any)[fieldName] ===
                                        true ||
                                        (currentValue as any)[fieldName] ===
                                            false)
                                        ? (currentValue as any)[fieldName]
                                        : field.defaultValue || false
                                }
                            />
                        )}

                        {/* Default Field */}
                        {(field.fieldType === FormFieldSchemaType.Name ||
                            field.fieldType === FormFieldSchemaType.Email ||
                            field.fieldType === FormFieldSchemaType.Hostname ||
                            field.fieldType === FormFieldSchemaType.URL ||
                            field.fieldType === FormFieldSchemaType.Route ||
                            field.fieldType === FormFieldSchemaType.Text ||
                            field.fieldType === FormFieldSchemaType.Number ||
                            field.fieldType === FormFieldSchemaType.Password ||
                            field.fieldType ===
                                FormFieldSchemaType.EncryptedText ||
                            field.fieldType === FormFieldSchemaType.Date ||
                            field.fieldType === FormFieldSchemaType.DateTime ||
                            field.fieldType === FormFieldSchemaType.Port ||
                            field.fieldType === FormFieldSchemaType.Phone ||
                            field.fieldType === FormFieldSchemaType.Domain ||
                            field.fieldType ===
                                FormFieldSchemaType.PositveNumber) && (
                            <Input
                                autoFocus={index === 1}
                                tabIndex={index}
                                disabled={isDisabled || field.disabled}
                                error={
                                    touched[fieldName] && errors[fieldName]
                                        ? errors[fieldName]
                                        : undefined
                                }
                                dataTestId={fieldType}
                                type={fieldType as InputType}
                                onChange={(value: string) => {
                                    setCurrentValue({
                                        ...currentValue,
                                        [fieldName]: value,
                                    });
                                    setFieldValue(fieldName, value);
                                }}
                                onEnterPress={() => {
                                    submitForm();
                                }}
                                onBlur={() => {
                                    setFieldTouched(fieldName, true);
                                }}
                                initialValue={
                                    currentValue &&
                                    (currentValue as any)[fieldName]
                                        ? (currentValue as any)[fieldName]
                                        : field.defaultValue || ''
                                }
                                placeholder={field.placeholder || ''}
                            />
                        )}
                    </div>
                </div>
            );
        };

        const validateLength: Function = (
            content: string,
            field: Field<T>
        ): string | null => {
            if (field.validation) {
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
                        return `${
                            field.title || name
                        } should not have numbers.`;
                    }
                }
            }
            return null;
        };

        const validateDate: Function = (
            content: string,
            field: Field<T>
        ): string | null => {
            if (field.validation) {
                if (field.validation.dateShouldBeInTheFuture) {
                    if (OneUptimeDate.isInThePast(content.trim())) {
                        return `${
                            field.title || name
                        } should be a future date.`;
                    }
                }
            }
            return null;
        };

        const validateMaxValueAndMinValue: Function = (
            content: string | number,
            field: Field<T>
        ): string | null => {
            if (field.validation) {
                if (typeof content === 'string') {
                    try {
                        content = parseInt(content);
                    } catch (e) {
                        return `${field.title || name} should be a number.`;
                    }
                }

                if (field.validation.maxValue) {
                    if (content > field.validation?.maxValue) {
                        return `${
                            field.title || name
                        } should not be more than ${
                            field.validation?.maxValue
                        }.`;
                    }
                }

                if (field.validation.minValue) {
                    if (content < field.validation?.minValue) {
                        return `${
                            field.title || name
                        } should not be less than ${
                            field.validation?.minValue
                        }.`;
                    }
                }
            }
            return null;
        };

        const validateRequired: Function = (
            content: string,
            field: Field<T>
        ): string | null => {
            if (field.required && (!content || content.length === 0)) {
                return `${field.title} is required.`;
            }
            return null;
        };

        const validateMatchField: Function = (
            content: string,
            field: Field<T>,
            entity: JSONObject
        ): string | null => {
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
        };

        const validateData: Function = (
            content: string,
            field: Field<T>
        ): string | null => {
            if (field.fieldType === FormFieldSchemaType.Email) {
                if (!Email.isValid(content!)) {
                    return 'Email is not valid.';
                }
            }

            if (field.fieldType === FormFieldSchemaType.Port) {
                try {
                    new Port(content);
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.URL) {
                try {
                    URL.fromString(content);
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.Hostname) {
                try {
                    new Hostname(content.toString());
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.Route) {
                try {
                    new Route(content.toString());
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.Phone) {
                try {
                    new Phone(content.toString());
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.Color) {
                try {
                    new Color(content.toString());
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            if (field.fieldType === FormFieldSchemaType.Domain) {
                try {
                    new Domain(content.toString());
                } catch (e: unknown) {
                    if (e instanceof Exception) {
                        return e.getMessage();
                    }
                }
            }

            return null;
        };

        const validate: Function = (
            values: FormValues<T>
        ): Dictionary<string> => {
            const errors: JSONObject = {};
            const entries: JSONObject = { ...values } as JSONObject;

            for (const field of formFields) {
                const name: string = getFieldName(field);

                if (name in entries) {
                    const content: string | undefined =
                        entries[name]?.toString();

                    // Check Required fields.
                    const resultRequired: string | null = validateRequired(
                        content,
                        field
                    );
                    if (resultRequired) {
                        errors[name] = resultRequired;
                    }

                    // Check for valid email data.
                    const resultValidateData: string | null = validateData(
                        content,
                        field
                    );
                    if (resultValidateData) {
                        errors[name] = resultValidateData;
                    }

                    const resultMatch: string | null = validateMatchField(
                        content,
                        field,
                        entries
                    );

                    if (resultMatch) {
                        errors[name] = resultMatch;
                    }

                    // check for length of content
                    const result: string | null = validateLength(
                        content,
                        field
                    );
                    if (result) {
                        errors[name] = result;
                    }

                    // check for date
                    const resultDate: string | null = validateDate(
                        content,
                        field
                    );
                    if (resultDate) {
                        errors[name] = resultDate;
                    }

                    // check for length of content
                    const resultMaxMinValue: string | null =
                        validateMaxValueAndMinValue(content, field);

                    if (resultMaxMinValue) {
                        errors[name] = resultMaxMinValue;
                    }
                } else if (field.required) {
                    errors[name] = `${field.title || name} is required.`;
                }
            }

            let customValidateResult: JSONObject = {};

            if (props.onValidate) {
                customValidateResult = props.onValidate(values);
            }

            const totalValidationErrors: Dictionary<string> = {
                ...errors,
                ...customValidateResult,
            } as Dictionary<string>;

            if (props.onFormValidationErrorChanged) {
                props.onFormValidationErrorChanged(
                    Object.keys(totalValidationErrors).length !== 0
                );
            }

            setErrors(totalValidationErrors);

            return totalValidationErrors;
        };

        useEffect(() => {
            if (!props.initialValues || isInitialValuesInitialized) {
                return;
            }

            const values: FormValues<T> = { ...props.initialValues };
            for (const field of formFields) {
                const fieldName: string = getFieldName(field);

                if (
                    field.fieldType === FormFieldSchemaType.Date &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] =
                        OneUptimeDate.asDateForDatabaseQuery(
                            (values as any)[fieldName]
                        );
                }

                if (
                    field.fieldType === FormFieldSchemaType.Dropdown &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] = field.dropdownOptions?.filter(
                        (option: DropdownOption) => {
                            return option.value === (values as any)[fieldName];
                        }
                    )[0];
                }

                if (
                    field.fieldType ===
                        FormFieldSchemaType.MultiSelectDropdown &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] = field.dropdownOptions?.filter(
                        (option: DropdownOption) => {
                            return (values as any)[fieldName].includes(
                                option.value
                            );
                        }
                    );
                }
            }
            setCurrentValue(values);
            setIsInitialValuesInitialized(true);
        }, [props.initialValues]);

        const primaryButtonStyle: React.CSSProperties = {};

        if (props.maxPrimaryButtonWidth) {
            primaryButtonStyle.marginLeft = '0px';
            primaryButtonStyle.width = '100%';
        }

        return (
            <div className="row">
                <div className="col-lg-1">
                    <div>
                        {props.title && (
                            <h1 className="text-lg text-gray-700 mt-5">
                                {props.title}
                            </h1>
                        )}

                        {Boolean(props.description) && (
                            <p className="text-sm text-gray-500 mb-5">
                                {props.description}
                            </p>
                        )}

                        {props.error && (
                            <div className="mb-3">
                                <Alert
                                    title={props.error}
                                    type={AlertType.DANGER}
                                />
                            </div>
                        )}

                        <div>
                            <div
                                className={`grid md:grid-cols-${
                                    props.showAsColumns || 1
                                } grid-cols-1 gap-4`}
                            >
                                {formFields &&
                                    formFields.map(
                                        (field: Field<T>, i: number) => {
                                            return (
                                                <div key={i}>
                                                    {getFormField(
                                                        field,
                                                        i,
                                                        props.isLoading,
                                                        errors,
                                                        touched
                                                    )}
                                                    {field.footerElement}
                                                </div>
                                            );
                                        }
                                    )}
                            </div>
                        </div>

                        <div className="flex w-full justify-end">
                            {!props.hideSubmitButton && (
                                <div
                                    className="mt-3"
                                    style={{
                                        width: props.maxPrimaryButtonWidth
                                            ? '100%'
                                            : ' auto',
                                    }}
                                >
                                    <Button
                                        title={
                                            props.submitButtonText || 'Submit'
                                        }
                                        dataTestId={props.submitButtonText!}
                                        onClick={() => {
                                            submitForm();
                                        }}
                                        id={`${props.id}-submit-button`}
                                        isLoading={props.isLoading || false}
                                        buttonStyle={
                                            props.submitButtonStyleType ||
                                            ButtonStyleType.PRIMARY
                                        }
                                        style={primaryButtonStyle}
                                    />
                                </div>
                            )}
                            {props.onCancel && (
                                <div>
                                    <Button
                                        title={
                                            props.cancelButtonText || 'Cancel'
                                        }
                                        type={ButtonTypes.Button}
                                        id={`${props.id}-cancel-button`}
                                        disabled={props.isLoading || false}
                                        buttonStyle={ButtonStyleType.NORMAL}
                                        onClick={() => {
                                            props.onCancel && props.onCancel();
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                        {props.footer}
                    </div>
                </div>
            </div>
        );
    }
);

BasicForm.displayName = 'BasicForm';

export default BasicForm;
