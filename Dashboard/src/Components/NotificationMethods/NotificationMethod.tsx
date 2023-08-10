import React, { FunctionComponent, ReactElement } from 'react';
import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';

export interface ComponentProps {
    item: JSONObject;
    modelType: { new (): BaseModel };
}

const NotificationMethodView: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const item: BaseModel = JSONFunctions.fromJSONObject(
        props.item,
        props.modelType
    );

    return (
        <div>
            {item.getColumnValue('userEmail') &&
                (item.getColumnValue('userEmail') as JSONObject)['email'] && (
                    <p>
                        Email:{' '}
                        {(item.getColumnValue('userEmail') as JSONObject)[
                            'email'
                        ]?.toString()}
                    </p>
                )}
            {item.getColumnValue('userCall') &&
                (item.getColumnValue('userCall') as JSONObject)['phone'] && (
                    <p>
                        Call:{' '}
                        {(item.getColumnValue('userCall') as JSONObject)[
                            'phone'
                        ]?.toString()}
                    </p>
                )}
            {item.getColumnValue('userSms') &&
                (item.getColumnValue('userSms') as JSONObject)['phone'] && (
                    <p>
                        SMS:{' '}
                        {(item.getColumnValue('userSms') as JSONObject)[
                            'phone'
                        ]?.toString()}
                    </p>
                )}
        </div>
    );
};

export default NotificationMethodView;
