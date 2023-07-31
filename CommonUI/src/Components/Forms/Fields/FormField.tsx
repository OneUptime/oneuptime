import React, { ReactElement, useEffect } from 'react';

import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from '../Types/FormFieldSchemaType';
import ColorPicker from '../Fields/ColorPicker';
import Color from 'Common/Types/Color';
import TextArea from '../../TextArea/TextArea';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from '../../Dropdown/Dropdown';
import Toggle from '../../Toggle/Toggle';
import Input, { InputType } from '../../Input/Input';
import CodeEditor from '../../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import FilePicker from '../../FilePicker/FilePicker';
import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Common/Models/FileModel';
import RadioButtons from '../../RadioButtons/RadioButtons';
import Field, { FormFieldStyleType } from '../Types/Field';
import FieldLabelElement from '../Fields/FieldLabel';
import FormValues from '../Types/FormValues';
import { JSONValue } from 'Common/Types/JSON';
import ComponentLoader from '../../ComponentLoader/ComponentLoader';

export interface ComponentProps<T extends Object> {
    field: Field<T>;
    fieldName: string;
    index: number;
    isDisabled: boolean;
    error: string;
    touched: boolean;
    currentValues: FormValues<T>;
    setFieldTouched: (fieldName: string, value: boolean) => void;
    setFieldValue: (fieldName: string, value: JSONValue) => void;
    disableAutofocus?: boolean;
    submitForm: () => void | undefined;
}

const FormField: Function = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const [dropdownOptions, setDropdownOptions] = React.useState<
        Array<DropdownOption>
    >(props.field.dropdownOptions || []);
    const [isFieldLoading, setIsFieldLoading] = React.useState<boolean>(false);

    const fetchDropdownOptions: Function = async (): Promise<void> => {
        if (!props.field.fetchDropdownOptions) {
            return;
        }

        setIsFieldLoading(true);

        const options: Array<DropdownOption> =
            await props.field.fetchDropdownOptions();

        setDropdownOptions(options);
        setIsFieldLoading(false);
    };

    useEffect(() => {
        fetchDropdownOptions().catch();
    }, [props.field]);

    const getFieldType: Function = (fieldType: FormFieldSchemaType): string => {
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
    };

    const getFormField: Function = (): ReactElement => {
        const index: number = props.index + 1;

        const fieldType: string = props.field.fieldType
            ? getFieldType(props.field.fieldType)
            : 'text';

        if (Object.keys(props.field.field).length === 0) {
            throw new BadDataException('Object cannot be without Field');
        }

        if (props.field.showIf && !props.field.showIf(props.currentValues)) {
            return <></>;
        }

        let codeType: CodeType = CodeType.HTML;

        if (props.field.fieldType === FormFieldSchemaType.CSS) {
            codeType = CodeType.CSS;
        }

        if (props.field.fieldType === FormFieldSchemaType.JavaScript) {
            codeType = CodeType.JavaScript;
        }

        return (
            <div className="sm:col-span-4 mt-0 mb-2" key={props.fieldName}>
                <FieldLabelElement
                    title={props.field.title || ''}
                    description={props.field.description}
                    sideLink={props.field.sideLink}
                    required={props.field.required}
                    isHeading={
                        props.field.styleType === FormFieldStyleType.Heading
                    }
                />

                <div className="mt-2">
                    {props.field.fieldType === FormFieldSchemaType.Color && (
                        <ColorPicker
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            onChange={async (value: Color | null) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            tabIndex={index}
                            placeholder={props.field.placeholder || ''}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                        />
                    )}

                    {(props.field.fieldType === FormFieldSchemaType.Dropdown ||
                        props.field.fieldType ===
                            FormFieldSchemaType.MultiSelectDropdown) && (
                        <Dropdown
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            tabIndex={index}
                            onChange={async (
                                value:
                                    | DropdownValue
                                    | Array<DropdownValue>
                                    | null
                            ) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            isMultiSelect={
                                props.field.fieldType ===
                                FormFieldSchemaType.MultiSelectDropdown
                            }
                            options={dropdownOptions}
                            placeholder={props.field.placeholder || ''}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                        />
                    )}

                    {props.field.fieldType ===
                        FormFieldSchemaType.RadioButton && (
                        <RadioButtons
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            onChange={async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            options={props.field.radioButtonOptions || []}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                        />
                    )}

                    {props.field.fieldType === FormFieldSchemaType.LongText && (
                        <TextArea
                            autoFocus={!props.disableAutofocus && index === 1}
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            tabIndex={index}
                            onChange={async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}

                    {props.field.fieldType === FormFieldSchemaType.JSON && (
                        <CodeEditor
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            type={CodeType.JSON}
                            tabIndex={index}
                            onChange={async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                            value={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}

                    {props.field.fieldType === FormFieldSchemaType.Markdown && (
                        <CodeEditor
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            tabIndex={index}
                            type={CodeType.Markdown}
                            onChange={async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}

                    {props.field.fieldType ===
                        FormFieldSchemaType.CustomComponent &&
                        props.field.getCustomElement &&
                        props.field.getCustomElement(props.currentValues, {
                            error:
                                props.touched && props.error
                                    ? props.error
                                    : undefined,
                            tabIndex: index,
                            onChange: async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            },
                            onBlur: async () => {
                                props.setFieldTouched(props.fieldName, true);
                            },

                            initialValue:
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : '',

                            placeholder: props.field.placeholder || '',
                        })}

                    {(props.field.fieldType === FormFieldSchemaType.HTML ||
                        props.field.fieldType === FormFieldSchemaType.CSS ||
                        props.field.fieldType ===
                            FormFieldSchemaType.JavaScript) && (
                        <CodeEditor
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            tabIndex={index}
                            onChange={async (value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            type={codeType}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : ''
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}

                    {(props.field.fieldType === FormFieldSchemaType.File ||
                        props.field.fieldType ===
                            FormFieldSchemaType.ImageFile) && (
                        <FilePicker
                            error={
                                props.touched && props.error
                                    ? props.error
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
                                    (props.field.fieldType ===
                                        FormFieldSchemaType.File ||
                                        props.field.fieldType ===
                                            FormFieldSchemaType.ImageFile) &&
                                    Array.isArray(fileResult)
                                ) {
                                    if (fileResult.length > 0) {
                                        fileResult = fileResult[0] as FileModel;
                                    } else {
                                        fileResult = null;
                                    }
                                }

                                props.field.onChange &&
                                    props.field.onChange(fileResult);
                                props.setFieldValue(
                                    props.fieldName,
                                    fileResult
                                );
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            mimeTypes={
                                props.field.fieldType ===
                                FormFieldSchemaType.ImageFile
                                    ? [
                                          MimeType.png,
                                          MimeType.jpeg,
                                          MimeType.jpg,
                                      ]
                                    : []
                            }
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : []
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}

                    {props.field.fieldType === FormFieldSchemaType.Toggle && (
                        <Toggle
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            onChange={async (value: boolean) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onBlur={async () => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName] &&
                                ((props.currentValues as any)[
                                    props.fieldName
                                ] === true ||
                                    (props.currentValues as any)[
                                        props.fieldName
                                    ] === false)
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : false
                            }
                        />
                    )}

                    {/* Default Field */}
                    {(props.field.fieldType === FormFieldSchemaType.Name ||
                        props.field.fieldType === FormFieldSchemaType.Email ||
                        props.field.fieldType ===
                            FormFieldSchemaType.Hostname ||
                        props.field.fieldType === FormFieldSchemaType.URL ||
                        props.field.fieldType === FormFieldSchemaType.Route ||
                        props.field.fieldType === FormFieldSchemaType.Text ||
                        props.field.fieldType === FormFieldSchemaType.Number ||
                        props.field.fieldType ===
                            FormFieldSchemaType.Password ||
                        props.field.fieldType ===
                            FormFieldSchemaType.EncryptedText ||
                        props.field.fieldType === FormFieldSchemaType.Date ||
                        props.field.fieldType ===
                            FormFieldSchemaType.DateTime ||
                        props.field.fieldType === FormFieldSchemaType.Port ||
                        props.field.fieldType === FormFieldSchemaType.Phone ||
                        props.field.fieldType === FormFieldSchemaType.Domain ||
                        props.field.fieldType ===
                            FormFieldSchemaType.PositiveNumber) && (
                        <Input
                            autoFocus={!props.disableAutofocus && index === 1}
                            tabIndex={index}
                            disabled={props.isDisabled || props.field.disabled}
                            error={
                                props.touched && props.error
                                    ? props.error
                                    : undefined
                            }
                            dataTestId={fieldType}
                            type={fieldType as InputType}
                            onChange={(value: string) => {
                                props.field.onChange &&
                                    props.field.onChange(value);
                                props.setFieldValue(props.fieldName, value);
                            }}
                            onEnterPress={() => {
                                props.submitForm();
                            }}
                            onBlur={() => {
                                props.setFieldTouched(props.fieldName, true);
                            }}
                            initialValue={
                                props.currentValues &&
                                (props.currentValues as any)[props.fieldName]
                                    ? (props.currentValues as any)[
                                          props.fieldName
                                      ]
                                    : props.field.defaultValue || ''
                            }
                            placeholder={props.field.placeholder || ''}
                        />
                    )}
                </div>
            </div>
        );
    };

    if (isFieldLoading) {
        return <ComponentLoader />;
    }

    return <>{getFormField()}</>;
};

export default FormField;
