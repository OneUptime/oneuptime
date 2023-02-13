import React, { ReactElement, useEffect, useState } from 'react';
import Modal from '../Modal/Modal';
import Query from '../../Utils/ModelAPI/Query';
import BaseModel from 'Common/Models/BaseModel';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import Select from '../../Utils/ModelAPI/Select';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export interface ComponentProps<TBaseModel extends BaseModel> {
    query?: Query<TBaseModel>;
    onClose: () => void;
    onSave: (modals: Array<TBaseModel>) => void;
    modelType: { new (): TBaseModel };
    titleField: string;
    descriptionField?: string | undefined;
    selectMultiple?: boolean | undefined;
    select: Select<TBaseModel>;
    modalTitle: string;
    modalDescription: string;
    noItemsMessage: string; 
}

const ModelListModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);
    const [modelList, setModalList] = useState<Array<TBaseModel>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    useEffect(() => {
        fetchItems().catch();
    }, []);

    const fetchItems: Function = async () => {
        setError('');
        setIsLoading(true);

        try {
            const listResult: ListResult<TBaseModel> =
                await ModelAPI.getList<TBaseModel>(
                    props.modelType,
                    {
                        ...props.query,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    props.select,
                    {},
                    {},
                    {}
                );

            setModalList(listResult.data);
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

    return (
        <Modal
            title={props.modalTitle}
            description={props.modalDescription}
            onClose={props.onClose}
            disableSubmitButton={selectedList.length == 0}
            onSubmit={() => {
                if (selectedList && selectedList.length === 0) {
                    props.onClose();
                }

                props.onSave(selectedList);
            }}
        >
            <div className='max-h-96 mt-5 mb-5'>
                {error ? <ErrorMessage error={error} /> : <></>}
                {isLoading ? <ComponentLoader /> : <></>}
                {!isLoading && modelList.length === 0 ? (
                    <ErrorMessage error={props.noItemsMessage || 'No items found.'} />
                ) : (
                    <></>
                )}
                {modelList &&
                    modelList.length > 0 &&
                    modelList.map((model: TBaseModel) => {
                        const isSelected =
                            selectedList.filter((selectedItem: TBaseModel) => {
                                return selectedItem._id?.toString() ===
                                    model._id?.toString();
                            }).length > 0;

                        return (
                            <div
                                onClick={() => {
                                    if (props.selectMultiple) {
                                        // if added to the list, then remove or add to list

                                        if (isSelected) {
                                            // remove the item.
                                            setSelectedList(
                                                selectedList.filter(
                                                    (i: TBaseModel) => {
                                                        return (
                                                            i._id?.toString() !==
                                                            model._id?.toString()
                                                        );
                                                    }
                                                )
                                            );
                                        } else {
                                            setSelectedList([
                                                ...selectedList,
                                                { ...model },
                                            ]);
                                        }
                                    } else {
                                        setSelectedList([{ ...model }]);
                                    }
                                }}
                                className={`cursor-pointer mt-2 mb-2 relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2 hover:border-gray-400 ${
                                    isSelected ? 'ring ring-indigo-500' : ''
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="focus:outline-none">
                                        <span
                                            className="absolute inset-0"
                                            aria-hidden="true"
                                        ></span>
                                        <p className="text-sm font-medium text-gray-900">
                                            {
                                                model.getValue(
                                                    props.titleField
                                                ) as string
                                            }
                                        </p>
                                        {props.descriptionField && (
                                            <p className="truncate text-sm text-gray-500">
                                                {
                                                    model.getValue(
                                                        props.descriptionField
                                                    ) as string
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>
        </Modal>
    );
};

export default ModelListModal;
