import React, { ReactElement } from 'react';
import Field from './Field';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import FieldType from '../Types/FieldType';
import HiddenText from '../HiddenText/HiddenText';
import { JSONObject } from 'Common/Types/JSON';
import _, { Dictionary } from 'lodash';
import MarkdownViewer from '../Markdown.tsx/MarkdownViewer';
import CodeEditor from '../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import FileModel from 'Common/Models/FileModel';
import ColorViewer from '../ColorViewer/ColorViewer';
import Color from 'Common/Types/Color';
import AlignItem from '../../Types/AlignItem';
import PlaceholderText from './PlaceholderText';
import DictionaryOfStringsViewer from '../Dictionary/DictionaryOfStingsViewer';
import { DropdownOption } from '../Dropdown/Dropdown';
import FieldLabelElement from './FieldLabel';
import DatabaseProperty from 'Common/Types/Database/DatabaseProperty';

export interface ComponentProps {
    item: JSONObject;
    fields: Array<Field>;
    id?: string | undefined;
    showDetailsInNumberOfColumns?: number | undefined;
}

const Detail: (props: ComponentProps) => ReactElement = (
    props: ComponentProps
): ReactElement => {


    const getMarkdownViewer: Function = (text: string): ReactElement | null => {
        if (!text) {
            return null;
        }

        return <MarkdownViewer text={text} />;
    };

    const getDropdownViewer: Function = (
        data: string,
        options: Array<DropdownOption>,
        placeholder: string
    ): ReactElement => {
        if (!options) {
            return <div>No options found</div>;
        }

        if (
            !options.find((i: DropdownOption) => {
                return i.value === data;
            })
        ) {
            return <div>{placeholder}</div>;
        }

        return (
            <div>
                {
                    options.find((i: DropdownOption) => {
                        return i.value === data;
                    })?.label as string
                }
            </div>
        );
    };

    const getDictionaryOfStringsViewer: Function = (
        data: Dictionary<string>
    ): ReactElement => {
        return <DictionaryOfStringsViewer value={data} />;
    };

    const getColorField: Function = (color: Color): ReactElement => {
        return <ColorViewer value={color} />;
    };

    const getUSDCentsField: Function = (usdCents: number): ReactElement => {
        return <div className="text-gray-900">{usdCents / 100} USD</div>;
    };

    const getMinutesField: Function = (minutes: number): ReactElement => {
        return (
            <div className="text-gray-900">
                {minutes} {minutes > 1 ? 'minutes' : 'minute'}
            </div>
        );
    };

    const getField: Function = (field: Field, index: number): ReactElement => {

        const fieldKey: string = field.key;

        if (!props.item) {
            throw new BadDataException('Item not found');
        }

        let data: string | ReactElement = '';

        if (_.get(props.item, fieldKey)) {
            data = (_.get(props.item, fieldKey, '') as any) || '';
        }

        if (field.fieldType === FieldType.Date) {
            data = OneUptimeDate.getDateAsLocalFormattedString(
                data as string,
                true
            );
        }

        if (field.fieldType === FieldType.Boolean) {
            if (data) {
                data = 'Yes';
            } else {
                data = 'No';
            }
        }

        if (field.fieldType === FieldType.DateTime) {
            data = OneUptimeDate.getDateAsLocalFormattedString(
                data as string,
                false
            );
        }

        if (data && field.fieldType === FieldType.Color) {
            data = getColorField(data);
        }

        if (data && field.fieldType === FieldType.USDCents) {
            data = getUSDCentsField(data);
        }

        if (data && field.fieldType === FieldType.Minutes) {
            data = getMinutesField(data);
        }

        if (data && field.fieldType === FieldType.DictionaryOfStrings) {
            data = getDictionaryOfStringsViewer(props.item[field.key]);
        }

        if (!data && field.fieldType === FieldType.Color && field.placeholder) {
            data = getColorField(new Color(field.placeholder));
        }

        if (field.fieldType === FieldType.ImageFile) {
            if (
                props.item[fieldKey] &&
                (props.item[fieldKey] as FileModel).file &&
                (props.item[fieldKey] as FileModel).type
            ) {
                const blob: Blob = new Blob(
                    [(props.item[fieldKey] as FileModel).file as Uint8Array],
                    {
                        type: (props.item[fieldKey] as FileModel)
                            .type as string,
                    }
                );

                const url: string = URL.createObjectURL(blob);

                data = (
                    <img
                        src={url}
                        className={'rounded'}
                        style={{
                            height: '100px',
                        }}
                    />
                );
            } else {
                data = '';
            }
        }

        if (field.fieldType === FieldType.Markdown) {
            data = getMarkdownViewer(data as string);
        }

        if (field.fieldType === FieldType.Dropdown) {
            data = getDropdownViewer(
                data as string,
                field.dropdownOptions,
                field.placeholder as string
            );
        }

        if (data && field.fieldType === FieldType.HiddenText) {
            data = (
                <HiddenText
                    isCopyable={field.opts?.isCopyable || false}
                    text={data.toString()}
                />
            );
        }

        if (
            data &&
            (field.fieldType === FieldType.HTML ||
                field.fieldType === FieldType.CSS ||
                field.fieldType === FieldType.JSON ||
                field.fieldType === FieldType.JavaScript)
        ) {
            let codeType: CodeType = CodeType.HTML;

            if (field.fieldType === FieldType.CSS) {
                codeType = CodeType.CSS;
            }

            if (field.fieldType === FieldType.JSON) {
                codeType = CodeType.JSON;
            }

            if (field.fieldType === FieldType.JavaScript) {
                codeType = CodeType.JavaScript;
            }

            data = (
                <CodeEditor
                    type={codeType}
                    readOnly={true}
                    initialValue={data as string}
                />
            );
        }

        if (field.getElement) {
            data = field.getElement(props.item);
        }

        let className: string = 'sm:col-span-1';

        if (field.colSpan) {
            className = 'sm:col-span-' + field.colSpan;
        }

        let alignClassName: string = 'flex justify-left';

        if (field.alignItem === AlignItem.Right) {
            alignClassName = 'flex justify-end';
        } else if (field.alignItem === AlignItem.Center) {
            alignClassName = 'flex justify-center';
        } else if (field.alignItem === AlignItem.Left) {
            alignClassName = 'flex justify-start';
        }

        if (data instanceof DatabaseProperty) {
            data = data.toString();
        }

        return (
            <div
                className={className}
                key={index}
                id={props.id}
                style={
                    props.showDetailsInNumberOfColumns
                        ? {
                            width:
                                100 / props.showDetailsInNumberOfColumns +
                                '%',
                        }
                        : { width: '100%' }
                }
            >
                <FieldLabelElement
                    size={field.fieldTitleSize}
                    title={field.title}
                    description={field.description}
                    sideLink={field.sideLink}
                    alignClassName={alignClassName}
                />

                <div className={`mt-1 text-sm text-gray-900 ${alignClassName}`}>
                    {data && (
                        <span className={`${field.contentClassName} w-full`}>
                            {data}
                        </span>
                    )}
                    {!data && field.placeholder && (
                        <PlaceholderText text={field.placeholder} />
                    )}
                </div>
            </div>
        );

    };


    return (
        <div
            className={`grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-${props.showDetailsInNumberOfColumns || 1
                } w-full`}
        >
            {props.fields &&
                props.fields.length > 0 &&
                props.fields.map((field: Field, i: number) => {
                    return getField(field, i);
                })}
        </div>
    );

};

export default Detail;
