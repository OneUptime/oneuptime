import React, { ReactElement } from 'react';
import Field from './Field';
import Link from '../Link/Link';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import FieldType from '../Types/FieldType';
import HiddenText from '../HiddenText/HiddenText';
import { JSONObject } from 'Common/Types/JSON';
import _ from 'lodash';

export interface ComponentProps {
    item: JSONObject;
    fields: Array<Field>;
    id?: string | undefined;
    showDetailsInNumberOfColumns?: number | undefined;
}

const Detail: Function = (props: ComponentProps): ReactElement => {
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

        if (field.fieldType === FieldType.DateTime) {
            data = OneUptimeDate.getDateAsLocalFormattedString(
                data as string,
                false
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

        if (field.getElement) {
            data = field.getElement(props.item);
        }

        return (
            <div
                className="mb-3"
                key={index}
                id={props.id}
                style={
                    props.showDetailsInNumberOfColumns
                        ? {
                              width:
                                  100 / props.showDetailsInNumberOfColumns +
                                  '%',
                          }
                        : {}
                }
            >
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
        <div
            className={`${
                props.showDetailsInNumberOfColumns
                    ? `justify-space-between`
                    : ``
            }`}
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
