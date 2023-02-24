import BaseModel from 'Common/Models/BaseModel';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import React, { ReactElement, useEffect, useState } from 'react';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import Query from '../../Utils/ModelAPI/Query';
import Card from '../Card/Card';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ProgressBar from '../ProgressBar/ProgressBar';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    description: string;
    totalCount: number;
    countQuery: Query<TBaseModel>;
    modelType: { new(): TBaseModel };
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
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                    'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLoading(false);
    };

    useEffect(() => {
        setIsLoading(true);
        fetchCount();
        setIsLoading(false);
    }, []);


    return (
        <Card
            title={props.title}
            description={
                <div>
                    {!error && !isLoading &&  <div>{props.description}</div>}
                    {!error && <div><ErrorMessage error={error} /></div>}
                    {isLoading && <ComponentLoader /> }
                    <ProgressBar totalCount={count} count={count} />
                </div>
            }
        />
    );
};

export default ModelProgress;
