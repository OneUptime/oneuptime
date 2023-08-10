import Link from 'Common/Types/Link';
import React, { ReactElement, useEffect, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import Page from './Page';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import API from '../../Utils/API/API';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title?: string | undefined;
    breadcrumbLinks?: Array<Link> | undefined;
    children: Array<ReactElement> | ReactElement;
    sideMenu?: undefined | ReactElement;
    className?: string | undefined;
    modelType: { new (): TBaseModel };
    modelId: ObjectID;
    modelNameField: string;
}

const ModelPage: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const [error, setError] = useState<string>('');

    const fetchItem: () => Promise<void> = async (): Promise<void> => {
        // get item.
        setIsLoading(true);

        setError('');
        try {
            const item: TBaseModel | null = await ModelAPI.getItem(
                props.modelType,
                props.modelId,
                {
                    [props.modelNameField]: true,
                } as any,
                {}
            );

            if (!item) {
                setError(
                    `Cannot load ${(
                        new props.modelType()?.singularName || 'item'
                    ).toLowerCase()}. It could be because you don't have enough permissions to read this ${(
                        new props.modelType()?.singularName || 'item'
                    ).toLowerCase()}.`
                );

                return;
            }

            setTitle(
                `${props.title || ''} - ${
                    (item as any)[props.modelNameField] as string
                }`
            );
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
        setIsLoading(false);
    };

    const [title, setTitle] = useState<string | undefined>(props.title);

    useEffect(() => {
        // fetch the model
        fetchItem();
    }, []);

    return (
        <Page {...props} isLoading={isLoading} error={error} title={title} />
    );
};

export default ModelPage;
