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
import Input from '../Input/Input';
import ModelList from '../ModelList/ModelList';
import WorkflowVariable from 'Model/Models/WorkflowVariable';

export interface ComponentProps<TBaseModel extends BaseModel> {
    query?: Query<TBaseModel>;
    onClose: () => void;
    onSave: (modals: Array<TBaseModel>) => void;
    modelType: { new(): TBaseModel };
    titleField: string;
    isSearchEnabled?: boolean | undefined;
    descriptionField?: string | undefined;
    selectMultiple?: boolean | undefined;
    select: Select<TBaseModel>;
    modalTitle: string;
    modalDescription: string;
    noItemsMessage: string;
    headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
}

const ModelListModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);
    const [modelList, setModalList] = useState<Array<TBaseModel>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [searchedList, setSearchedList] = useState<Array<TBaseModel>>([]);
    const [searchText, setSearchText] = useState<string>('');

    useEffect(() => {
        fetchItems().catch();
    }, []);

    useEffect(() => {
        if (!props.isSearchEnabled) {
            setSearchedList([...modelList]);
        }
    }, [props.isSearchEnabled, modelList]);

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

    useEffect(() => {
        if (!searchText) {
            setSearchedList([...modelList]);
        } else {
            // search

            setSearchedList(
                [...modelList].filter((model: TBaseModel): boolean => {
                    const includedInSearch: boolean = (
                        model.getValue(props.titleField) as string
                    )
                        .toLowerCase()
                        .includes(searchText);

                    if (!includedInSearch && props.descriptionField) {
                        return (
                            model.getValue(props.descriptionField) as string
                        )
                            .toLowerCase()
                            .includes(searchText);
                    }

                    return includedInSearch;
                })
            );
        }
    }, [modelList, searchText]);

    return (
        <Modal
            title={props.modalTitle}
            description={props.modalDescription}
            onClose={props.onClose}
            disableSubmitButton={selectedList.length === 0}
            onSubmit={() => {
                if (selectedList && selectedList.length === 0) {
                    props.onClose();
                }

                props.onSave(selectedList);
            }}
        >
            <div>
                {!isLoading && !error && props.isSearchEnabled && (
                    <div className="p-2">
                        <Input
                            placeholder="Search..."
                            onChange={(value: string) => {
                                setSearchText(value);
                            }}
                        />
                    </div>
                )}
            </div>
            <div className="max-h-96 mb-5 overflow-y-auto p-2">
                {error ? <ErrorMessage error={error} /> : <></>}
                {isLoading ? <ComponentLoader /> : <></>}

                {!isLoading && searchedList.length === 0 ? (
                    <ErrorMessage
                        error={
                            searchText
                                ? 'No items match your search'
                                : props.noItemsMessage || 'No items found.'
                        }
                    />
                ) : (
                    <></>
                )}

                <ModelList<WorkflowVariable>
                    list={searchedList}
                    headerField={props.headerField}
                    descriptionField={props.descriptionField}
                    titleField={props.titleField}
                    selectedItems={selectedList}
                    onClick={(model: TBaseModel) => {
                        if (props.selectMultiple) {
                            // if added to the list, then remove or add to list
                            const isSelected: boolean =
                                selectedList.filter(
                                    (selectedItem: TBaseModel) => {
                                        return (
                                            selectedItem._id?.toString() ===
                                            model._id?.toString()
                                        );
                                    }
                                ).length > 0;
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

                />
            </div>
        </Modal>
    );
};

export default ModelListModal;
