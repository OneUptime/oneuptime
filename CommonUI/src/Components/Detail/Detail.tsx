import React, { ReactElement } from 'react';
import Field from './Field';
import Link from '../Link/Link';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import FieldType from '../Types/FieldType';
import HiddenText from '../HiddenText/HiddenText';
import { JSONObject } from 'Common/Types/JSON';
import _ from 'lodash';
import MarkdownViewer from '../Markdown.tsx/MarkdownViewer';
import CodeEditor from '../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import FileModel from 'Common/Models/FileModel';
import ColorViewer from '../ColorViewer/ColorViewer';
import Color from 'Common/Types/Color';
import AlignItem from '../../Types/AlignItem';

export interface ComponentProps {
    item: JSONObject;
    fields: Array<Field>;
    id?: string | undefined;
    showDetailsInNumberOfColumns?: number | undefined;
}

const Detail: Function = (props: ComponentProps): ReactElement => {
    const getMarkdownViewer: Function = (text: string): ReactElement => {
        return <MarkdownViewer text={text} />;
    };

    const getColorField: Function = (color: Color): ReactElement => {
        return <ColorViewer value={color} />;
    };

    const getField: Function = (field: Field, index: number): ReactElement => {
        const fieldKey: string = field.key;

        if (!props.item) {
            throw new BadDataException('Item not found');
        }

        let data: string | ReactElement = '';

        if (_.get(props.item, fieldKey)) {
            data = _.get(props.item, fieldKey, '')?.toString() || '';
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

        if (data && field.fieldType === FieldType.HiddenText) {
            data = (
                <HiddenText
                    isCopyable={field.opts?.isCopyable || false}
                    text={data as string}
                />
            );
        }

        if (
            data &&
            (field.fieldType === FieldType.HTML ||
                field.fieldType === FieldType.CSS ||
                field.fieldType === FieldType.JavaScript)
        ) {
            let codeType: CodeType = CodeType.HTML;

            if (field.fieldType === FieldType.CSS) {
                codeType = CodeType.CSS;
            }

            if (field.fieldType === FieldType.JavaScript) {
                codeType = CodeType.JavaScript;
            }

            data = (
                <CodeEditor
                    type={codeType}
                    readOnly={true}
                    value={data as string}
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
                {field.title && (
                    <label className="text-sm font-medium text-gray-500">
                        <span className={alignClassName}>{field.title}</span>
                        {field.sideLink &&
                            field.sideLink?.text &&
                            field.sideLink?.url && (
                                <span>
                                    <Link
                                        to={field.sideLink?.url}
                                        className="underline-on-hover"
                                    >
                                        {field.sideLink?.text}
                                    </Link>
                                </span>
                            )}
                    </label>
                )}
                {field.description && (
                    <p className={`${alignClassName} text-xs text-gray-400`}>{field.description}</p>
                )}

                <div className={`mt-1 text-sm text-gray-900 ${alignClassName}`}>
                    {data && (
                        <span className={`${field.contentClassName} w-full`}>
                            {data}
                        </span>
                    )}
                    {!data && (
                        <span className="text-gray-500">
                            {field.placeholder}
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={`grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2`}>
            {props.fields &&
                props.fields.length > 0 &&
                props.fields.map((field: Field, i: number) => {
                    return getField(field, i);
                })}
        </div>
    );
};

export default Detail;
