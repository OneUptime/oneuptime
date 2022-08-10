import React, { ReactElement } from 'react';
import BaseModel from 'Common/Models/BaseModel';
import Field from './Field';
import Link from '../Link/Link';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import FieldType from './FieldType';
import HiddenText from '../HiddenText/HiddenText';

export interface ComponentProps<TBaseModel extends BaseModel> {
    item: TBaseModel;
    fields: Array<Field<TBaseModel>>;
}

const Detail: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

    const getField: Function = (
        field: Field<TBaseModel>,
        index: number
    ): ReactElement => {
        const fieldKeys: Array<string> = Object.keys(field.field);
        let fieldKey: string | null = null;

        if (fieldKeys.length > 0 && fieldKeys[0]) {
            fieldKey = fieldKeys[0];
        } else {
            throw new BadDataException('Field Key not found');
        }

        if (!props.item) {
            throw new BadDataException('Item not found');
        }

        let data: string | ReactElement = '';

        if ((props.item as any)[fieldKey]) {
            data = (props.item as any)[fieldKey]?.toString() || '';
        }

        if (field.fieldType === FieldType.Date) {
            data = OneUptimeDate.getDateAsLocalFormattedString(
                data as string,
                true
            );
        }

        if (field.fieldType === FieldType.HiddenText) {
            data = (
                <HiddenText
                    isCopyable={field.opts?.isCopyable || false}
                    text={data as string}
                />
            );
        }

        return (
            <div className="mb-3" key={index}>
                <label className="form-Label form-label justify-space-between width-max">
                    <span>{field.title}</span>
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
                {field.description && <p>{field.description}</p>}

                <div
                    className="form-control"
                    style={{
                        border: 'none',
                        paddingLeft: '0px',
                        paddingTop: '0px',
                    }}
                >
                    {data}
                </div>
            </div>
        );
    };

    
    return (
        <div>
            {props.fields &&
                props.fields.length > 0 &&
                props.fields.map((field: Field<TBaseModel>, i: number) => {
                    return getField(field, i);
                })}
        </div>
    );
};

export default Detail;
