import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement, useEffect, useState } from 'react';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import Query from '../../Utils/ModelAPI/Query';
import Card from '../Card/Card';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ProgressBar from '../ProgressBar/ProgressBar';
import API from '../../Utils/API/API';
export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    description: string;
    totalCount: number;
    countQuery: Query<TBaseModel>;
    modelType: { new (): TBaseModel };
}

const ModelProgress: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [count, setCount] = useState<number>(0);

    const fetchCount: Function = async () => {
        setError('');
        setIsLoading(true);

        try {
            const count: number = await ModelAPI.count<TBaseModel>(
                props.modelType,
                props.countQuery
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
        <Card title={props.title} description={props.description}>
            <div className="w-full -mt-20">
                {!error && (
                    <div>
                        <ErrorMessage error={error} />
                    </div>
                )}
                {isLoading && <ComponentLoader />}
                {!error && !isLoading && (
                    <ProgressBar
                        totalCount={props.totalCount}
                        count={count}
                        suffix={props.title}
                    />
                )}
            </div>
        </Card>
    );
};

export default ModelProgress;
