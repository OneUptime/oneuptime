import Link from 'Common/Types/Link';
import React, { ReactElement, useEffect, useState } from 'react';
import ModelAPI, { RequestOptions } from '../../Utils/ModelAPI/ModelAPI';
import BaseModel from 'Common/Models/BaseModel';
import Query from '../../Utils/ModelAPI/Query';
import { BadgeType } from '../Badge/Badge';
import SideMenuItem from './SideMenuItem';
import API from '../../Utils/API/API';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps<TBaseModel extends BaseModel> {
    link: Link;
    modelType?: { new (): TBaseModel } | undefined;
    badgeType?: BadgeType | undefined;
    countQuery?: Query<TBaseModel> | undefined;
    requestOptions?: RequestOptions | undefined;
    icon?: undefined | IconProp;
    className?: undefined | string;
    onCountFetchInit?: (() => void) | undefined;
}

const CountModelSideMenuItem: <TBaseModel extends BaseModel>(props: ComponentProps<TBaseModel>) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement =>{
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [count, setCount] = useState<number>(0);

    const fetchCount: Function = async () => {
        if (!props.modelType) {
            return;
        }

        if (!props.countQuery) {
            return;
        }

        setError('');
        setIsLoading(true);

        if (props.onCountFetchInit) {
            props.onCountFetchInit();
        }

        try {
            const count: number = await ModelAPI.count<BaseModel>(
                props.modelType,
                props.countQuery,
                props.requestOptions
            );

            setCount(count);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        setIsLoading(true);
        fetchCount();
        setIsLoading(false);
    }, []);

    return (
        <SideMenuItem
            link={props.link}
            badge={!isLoading && !error ? count : undefined}
            badgeType={props.badgeType}
            icon={props.icon}
            className={props.className}
        />
    );
};

export default CountModelSideMenuItem;
