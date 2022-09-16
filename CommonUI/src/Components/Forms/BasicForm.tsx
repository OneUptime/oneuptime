import React, {
    MutableRefObject,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    ErrorMessage,
    Field,
    FieldProps,
    Form,
    Formik,
    FormikErrors,
    FormikProps,
    FormikValues,
} from 'formik';
import Button, { ButtonStyleType } from '../Button/Button';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import DataField from './Types/Field';
import ButtonTypes from '../Button/ButtonTypes';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
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
import Input from '../Input/Input';
import Markdown from '../Markdown.tsx/MarkdownEditor';
import CodeEditor from '../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import FilePicker from '../FilePicker/FilePicker';
import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Common/Models/FileModel';
import Phone from 'Common/Types/Phone';
import Domain from 'Common/Types/Domain';

export const DefaultValidateFunction: Function = (
    _values: FormValues<JSONObject>
): JSONObject => {
    return {};
};

export interface ComponentProps<T extends Object> {
    id: string;
    initialValues: FormValues<T>;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: undefined | ((values: FormValues<T>) => JSONObject);
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
    formRef?: undefined | MutableRefObject<FormikProps<FormikValues>>;
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
        default:
            return 'text';
    }
}

const BasicForm: Function = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const getFormField: Function = (
        field: DataField<T>,
        index: number,
        isDisabled: boolean
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

        const fieldName: string = field.overideFieldKey
            ? field.overideFieldKey
            : (Object.keys(field.field)[0] as string);

        return (
            <div className="mb-3" key={index}>
                <label className="form-Label form-label justify-space-between width-max">
                    <span>{field.title}</span>
                    {field.sideLink &&
                        field.sideLink?.text &&
                        field.sideLink?.url && (
                            <span data-testid="login-forgot-password">
                                <Link
                                    to={field.sideLink?.url}
                                    className="underline-on-hover"
                                >
                                    {field.sideLink?.text}
                                </Link>
                            </span>
                        )}
                </label>
                {field.description && <p>{field.description}</p>}

                {field.fieldType === FormFieldSchemaType.Color && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <ColorPicker
                                    onChange={async (color: Color) => {
                                        await form.setFieldValue(
                                            fieldName,
                                            color,
                                            true
                                        );
                                    }}
                                    tabIndex={index}
                                    onFocus={async () => {
                                        await form.setFieldTouched(
                                            fieldName,
                                            true
                                        );
                                    }}
                                    placeholder={field.placeholder || ''}
                                    initialValue={
                                        initialValues &&
                                        (initialValues as any)[fieldName]
                                            ? (initialValues as any)[fieldName]
                                            : ''
                                    }
                                />
                            );
                        }}
                    </Field>
                )}

                {(field.fieldType === FormFieldSchemaType.Dropdown ||
                    field.fieldType ===
                        FormFieldSchemaType.MultiSelectDropdown) && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <Dropdown
                                    tabIndex={index}
                                    onChange={async (
                                        value:
                                            | DropdownValue
                                            | Array<DropdownValue>
                                            | null
                                    ) => {
                                        await form.setFieldValue(
                                            fieldName,
                                            value,
                                            true
                                        );
                                    }}
                                    onBlur={async () => {
                                        await form.setFieldTouched(
                                            fieldName,
                                            true
                                        );
                                    }}
                                    isMultiSelect={
                                        field.fieldType ===
                                        FormFieldSchemaType.MultiSelectDropdown
                                    }
                                    options={field.dropdownOptions || []}
                                    placeholder={field.placeholder || ''}
                                    initialValue={
                                        initialValues &&
                                        (initialValues as any)[fieldName]
                                            ? (initialValues as any)[fieldName]
                                            : ''
                                    }
                                />
                            );
                        }}
                    </Field>
                )}

                {field.fieldType === FormFieldSchemaType.LongText && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <>
                                    <TextArea
                                        tabIndex={index}
                                        onChange={async (text: string) => {
                                            await form.setFieldValue(
                                                fieldName,
                                                text,
                                                true
                                            );
                                        }}
                                        onBlur={async () => {
                                            await form.setFieldTouched(
                                                fieldName,
                                                true
                                            );
                                        }}
                                        initialValue={
                                            initialValues &&
                                            (initialValues as any)[fieldName]
                                                ? (initialValues as any)[
                                                      fieldName
                                                  ]
                                                : ''
                                        }
                                        placeholder={field.placeholder || ''}
                                    />
                                </>
                            );
                        }}
                    </Field>
                )}

                {field.fieldType === FormFieldSchemaType.Markdown && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <>
                                    <Markdown
                                        tabIndex={index}
                                        onChange={async (text: string) => {
                                            await form.setFieldValue(
                                                fieldName,
                                                text,
                                                true
                                            );
                                        }}
                                        onBlur={async () => {
                                            await form.setFieldTouched(
                                                fieldName,
                                                true
                                            );
                                        }}
                                        initialValue={
                                            initialValues &&
                                            (initialValues as any)[fieldName]
                                                ? (initialValues as any)[
                                                      fieldName
                                                  ]
                                                : ''
                                        }
                                        placeholder={field.placeholder || ''}
                                    />
                                </>
                            );
                        }}
                    </Field>
                )}

                {(field.fieldType === FormFieldSchemaType.HTML ||
                    field.fieldType === FormFieldSchemaType.CSS ||
                    field.fieldType === FormFieldSchemaType.JavaScript) && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            let codeType: CodeType = CodeType.HTML;

                            if (field.fieldType === FormFieldSchemaType.CSS) {
                                codeType = CodeType.CSS;
                            }

                            if (
                                field.fieldType ===
                                FormFieldSchemaType.JavaScript
                            ) {
                                codeType = CodeType.JavaScript;
                            }

                            return (
                                <>
                                    <CodeEditor
                                        tabIndex={index}
                                        onChange={async (text: string) => {
                                            await form.setFieldValue(
                                                fieldName,
                                                text,
                                                true
                                            );
                                        }}
                                        className="form-control"
                                        onBlur={async () => {
                                            await form.setFieldTouched(
                                                fieldName,
                                                true
                                            );
                                        }}
                                        type={codeType}
                                        initialValue={
                                            initialValues &&
                                            (initialValues as any)[fieldName]
                                                ? (initialValues as any)[
                                                      fieldName
                                                  ]
                                                : ''
                                        }
                                        placeholder={field.placeholder || ''}
                                    />
                                </>
                            );
                        }}
                    </Field>
                )}

                {(field.fieldType === FormFieldSchemaType.File ||
                    field.fieldType === FormFieldSchemaType.ImageFile) && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <>
                                    <FilePicker
                                        tabIndex={index}
                                        onChange={async (
                                            files: Array<FileModel>
                                        ) => {
                                            let fileResult:
                                                | FileModel
                                                | Array<FileModel>
                                                | null = files.map(
                                                (i: FileModel) => {
                                                    const strippedModel: FileModel =
                                                        new FileModel();
                                                    strippedModel._id = i._id!;
                                                    return strippedModel;
                                                }
                                            );

                                            if (
                                                field.fieldType ===
                                                    FormFieldSchemaType.File &&
                                                Array.isArray(fileResult)
                                            ) {
                                                if (fileResult.length > 0) {
                                                    fileResult =
                                                        fileResult[0] as FileModel;
                                                } else {
                                                    fileResult = null;
                                                }
                                            }

                                            await form.setFieldValue(
                                                fieldName,
                                                fileResult,
                                                true
                                            );
                                        }}
                                        onBlur={async () => {
                                            await form.setFieldTouched(
                                                fieldName,
                                                true
                                            );
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
                                            initialValues &&
                                            (initialValues as any)[fieldName]
                                                ? (initialValues as any)[
                                                      fieldName
                                                  ]
                                                : []
                                        }
                                        placeholder={field.placeholder || ''}
                                    />
                                </>
                            );
                        }}
                    </Field>
                )}

                {field.fieldType === FormFieldSchemaType.Checkbox && (
                    <Field name={fieldName}>
                        {({ form }: any) => {
                            return (
                                <>
                                    <Toggle
                                        onChange={async (text: boolean) => {
                                            await form.setFieldValue(
                                                fieldName,
                                                text,
                                                true
                                            );
                                        }}
                                        onBlur={async () => {
                                            await form.setFieldTouched(
                                                fieldName,
                                                true
                                            );
                                        }}
                                        initialValue={
                                            initialValues &&
                                            (initialValues as any)[fieldName]
                                                ? (initialValues as any)[
                                                      fieldName
                                                  ]
                                                : false
                                        }
                                    />
                                </>
                            );
                        }}
                    </Field>
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
                    field.fieldType === FormFieldSchemaType.EncryptedText ||
                    field.fieldType === FormFieldSchemaType.Date ||
                    field.fieldType === FormFieldSchemaType.DateTime ||
                    field.fieldType === FormFieldSchemaType.Port ||
                    field.fieldType === FormFieldSchemaType.Phone ||
                    field.fieldType === FormFieldSchemaType.Domain ||
                    field.fieldType === FormFieldSchemaType.PositveNumber) && (
                    <Field
                        tabIndex={index + 1}
                        name={fieldName}
                        disabled={isDisabled || field.disabled}
                    >
                        {({ form }: FieldProps) => {
                            return (
                                <Input
                                    tabIndex={index}
                                    dataTestId={fieldType}
                                    className="form-control"
                                    type={fieldType as 'text'}
                                    onChange={(text: string) => {
                                        form.setFieldValue(
                                            fieldName,
                                            text,
                                            true
                                        );
                                    }}
                                    onBlur={() => {
                                        form.setFieldTouched(fieldName, true);
                                    }}
                                    initialValue={
                                        initialValues &&
                                        (initialValues as any)[fieldName]
                                            ? (initialValues as any)[fieldName]
                                            : ''
                                    }
                                    placeholder={field.placeholder || ''}
                                />
                            );
                        }}
                    </Field>
                )}

                <ErrorMessage
                    className="mt-1 text-danger"
                    name={
                        field.overideFieldKey
                            ? field.overideFieldKey
                            : (Object.keys(field.field)[0] as string)
                    }
                    component="div"
                    data-testid="errorMessage"
                />
            </div>
        );
    };

    const validateLength: Function = (
        content: string,
        field: DataField<T>
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
                    return `${field.title || name} should have no spaces.`;
                }
            }
        }
        return null;
    };

    const validateDate: Function = (
        content: string,
        field: DataField<T>
    ): string | null => {
        if (field.validation) {
            if (field.validation.dateShouldBeInTheFuture) {
                if (OneUptimeDate.isInThePast(content.trim())) {
                    return `${field.title || name} should be a future date.`;
                }
            }
        }
        return null;
    };

    const validateMaxValueAndMinValue: Function = (
        content: string | number,
        field: DataField<T>
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
    };

    const validateRequired: Function = (
        content: string,
        field: DataField<T>
    ): string | null => {
        if (field.required && (!content || content.length === 0)) {
            return `${field.title} is required.`;
        }
        return null;
    };

    const validateMatchField: Function = (
        content: string,
        field: DataField<T>,
        entity: JSONObject
    ): string | null => {
        if (
            content &&
            field.validation?.toMatchField &&
            entity[field.validation?.toMatchField] &&
            (entity[field.validation?.toMatchField] as string).trim() !==
                content.trim()
        ) {
            return `${field.title} should match ${field.validation?.toMatchField}`;
        }
        return null;
    };

    const validateData: Function = (
        content: string,
        field: DataField<T>
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

    const validate: ((
        values: FormValues<T>
    ) => void | object | Promise<FormikErrors<FormValues<T>>>) &
        Function = (values: FormValues<T>): FormikErrors<FormValues<T>> => {
        const errors: JSONObject = {};
        const entries: JSONObject = { ...values } as JSONObject;

        for (const field of props.fields) {
            const name: string = field.overideFieldKey
                ? field.overideFieldKey
                : (Object.keys(field.field)[0] as string);

            if (name in entries) {
                const content: string | undefined = entries[name]?.toString();

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
                const result: string | null = validateLength(content, field);
                if (result) {
                    errors[name] = result;
                }

                // check for date
                const resultDate: string | null = validateDate(content, field);
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

        return { ...errors, ...customValidateResult } as FormikErrors<
            FormValues<T>
        >;
    };

    const formRef: any = useRef<any>(null);

    const [initialValues, setInitalValues] = useState<FormValues<T>>({});

    useEffect(() => {
        const values: FormValues<T> = { ...props.initialValues };
        for (const field of props.fields) {
            const fieldName: string = field.overideFieldKey
                ? field.overideFieldKey
                : (Object.keys(field.field)[0] as string);

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
                field.fieldType === FormFieldSchemaType.MultiSelectDropdown &&
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
        setInitalValues(values);
    }, [props.initialValues]);

    return (
        <div className="row">
            <div className="col-lg-12">
                <Formik
                    innerRef={props.formRef ? props.formRef : formRef}
                    initialValues={initialValues}
                    validate={validate}
                    validateOnChange={true}
                    enableReinitialize={true}
                    validateOnBlur={true}
                    onSubmit={(
                        values: FormValues<T>,
                        { setSubmitting }: { setSubmitting: Function }
                    ) => {
                        // check for any boolean values and if they dont exist in values - mark them as false.

                        for (const field of props.fields) {
                            if (
                                field.fieldType === FormFieldSchemaType.Checkbox
                            ) {
                                const fieldName: string = field.overideFieldKey
                                    ? field.overideFieldKey
                                    : (Object.keys(field.field)[0] as string);
                                if (!(values as any)[fieldName]) {
                                    (values as any)[fieldName] = false;
                                }
                            }

                            if (
                                field.fieldType === FormFieldSchemaType.Password
                            ) {
                                const fieldName: string = field.overideFieldKey
                                    ? field.overideFieldKey
                                    : (Object.keys(field.field)[0] as string);
                                if ((values as any)[fieldName]) {
                                    (values as any)[fieldName] =
                                        new HashedString(
                                            (values as any)[fieldName],
                                            false
                                        );
                                }
                            }
                        }

                        props.onSubmit(values);
                        setSubmitting(false);
                    }}
                >
                    <Form autoComplete="off">
                        <h1>{props.title}</h1>

                        {Boolean(props.description) && (
                            <p className="description">{props.description}</p>
                        )}

                        {props.error && (
                            <Alert
                                title={props.error}
                                type={AlertType.DANGER}
                            />
                        )}

                        <div className={`col-lg-12 flex`}>
                            <div
                                className={`col-lg-${
                                    12 / (props.showAsColumns || 1)
                                } ${
                                    (props.showAsColumns || 1) > 1
                                        ? 'pr-10'
                                        : ''
                                }`}
                            >
                                {props.fields &&
                                    props.fields.map(
                                        (field: DataField<T>, i: number) => {
                                            if (
                                                i %
                                                    (props.showAsColumns ||
                                                        1) ===
                                                0
                                            ) {
                                                return getFormField(
                                                    field,
                                                    i,
                                                    props.isLoading
                                                );
                                            }
                                            return <div key={i}></div>;
                                        }
                                    )}
                            </div>
                            {(props.showAsColumns || 1) > 1 && (
                                <div
                                    className={`col-lg-${
                                        12 / (props.showAsColumns || 1)
                                    } ${
                                        (props.showAsColumns || 1) > 1
                                            ? 'pl-10'
                                            : ''
                                    }`}
                                >
                                    {props.fields &&
                                        props.fields.map(
                                            (
                                                field: DataField<T>,
                                                i: number
                                            ) => {
                                                if (
                                                    i %
                                                        (props.showAsColumns ||
                                                            1) !==
                                                    0
                                                ) {
                                                    return getFormField(
                                                        field,
                                                        i,
                                                        props.isLoading
                                                    );
                                                }
                                                return <div key={i}></div>;
                                            }
                                        )}
                                </div>
                            )}
                        </div>

                        <div
                            className="row"
                            style={{
                                display: 'flex',
                            }}
                        >
                            {!props.hideSubmitButton && (
                                <div
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
                                        type={ButtonTypes.Submit}
                                        id={`${props.id}-submit-button`}
                                        isLoading={props.isLoading || false}
                                        buttonStyle={ButtonStyleType.PRIMARY}
                                        style={{
                                            width: props.maxPrimaryButtonWidth
                                                ? '100%'
                                                : ' auto',
                                        }}
                                    />
                                </div>
                            )}
                            {props.onCancel && (
                                <div style={{ width: 'auto' }}>
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
                    </Form>
                </Formik>
            </div>
        </div>
    );
};

export default BasicForm;
