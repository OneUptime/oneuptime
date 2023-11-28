import React, { ReactElement, useEffect, useState } from 'react';
import Query from '../../Utils/ModelAPI/Query';
import BaseModel from 'Common/Models/BaseModel';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ModelAPI, {
    ListResult,
    RequestOptions,
} from '../../Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import Select from '../../Utils/ModelAPI/Select';
import Input from '../Input/Input';
import StaticModelList from '../ModelList/StaticModelList';
import API from '../../Utils/API/API';
import URL from 'Common/Types/API/URL';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps<TBaseModel extends BaseModel> {
    id: string;
    query?: Query<TBaseModel>;
    modelType: { new (): TBaseModel };
    titleField: string;
    isSearchEnabled?: boolean | undefined;
    descriptionField?: string | undefined;
    selectMultiple?: boolean | undefined;
    overrideFetchApiUrl?: URL | undefined;
    select: Select<TBaseModel>;
    fetchRequestOptions?: RequestOptions | undefined;
    customElement?: ((item: TBaseModel) => ReactElement) | undefined;
    noItemsMessage: string;
    headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
    onSelectChange?: ((list: Array<TBaseModel>) => void) | undefined;
    refreshToggle?: boolean | undefined;
    footer?: ReactElement | undefined;
    isDeleteable?: boolean | undefined;
    enableDragAndDrop?: boolean | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
}

const ModelList: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);
    const [modelList, setModalList] = useState<Array<TBaseModel>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [searchedList, setSearchedList] = useState<Array<TBaseModel>>([]);
    const [searchText, setSearchText] = useState<string>('');

    useEffect(() => {
        props.onSelectChange && props.onSelectChange(selectedList);
    }, [selectedList]);

    useEffect(() => {
        fetchItems().catch();
    }, [props.refreshToggle]);

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


            const select: Select<TBaseModel> = {
                ...props.select,
            };

            if (
                props.dragDropIdField &&
                !Object.keys(select).includes(props.dragDropIdField)
            ) {
                (select as JSONObject)[props.dragDropIdField] = true;
            }

            if (
                props.dragDropIndexField &&
                !Object.keys(select).includes(props.dragDropIndexField)
            ) {
                (select as JSONObject)[props.dragDropIndexField] = true;
            }

            let listResult: ListResult<TBaseModel> = {
                data: [],
                count: 0,
                skip: 0,
                limit: 0,
            };

            if (props.overrideFetchApiUrl) {
                const result: HTTPResponse<JSONArray> = (await API.post(
                    props.overrideFetchApiUrl,
                    {},
                    {}
                )) as HTTPResponse<JSONArray>;

                listResult = {
                    data: BaseModel.fromJSONArray(
                        result.data as JSONArray,
                        props.modelType
                    ),
                    count: (result.data as JSONArray).length as number,
                    skip: 0,
                    limit: LIMIT_PER_PROJECT,
                };
            } else {
                listResult = await ModelAPI.getList<TBaseModel>(
                    props.modelType,
                    {
                        ...props.query,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    props.select,
                    {},

                    props.fetchRequestOptions
                );
            }

            setModalList(listResult.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
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

    const deleteItem: Function = async (item: TBaseModel) => {
        if (!item.id) {
            throw new BadDataException('item.id cannot be null');
        }

        setIsLoading(true);

        try {
            await ModelAPI.deleteItem<TBaseModel>(
                props.modelType,
                item.id,
            );

    
            await fetchItems();
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    return (
        <div>
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

                {!isLoading && !error && searchedList.length === 0 ? (
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

                {!error && !isLoading && (
                    <StaticModelList<TBaseModel>
                        enableDragAndDrop={props.enableDragAndDrop}
                        dragDropIdField={props.dragDropIdField}
                        dragDropIndexField={props.dragDropIndexField}
                        list={searchedList}
                        headerField={props.headerField}
                        descriptionField={props.descriptionField}
                        dragAndDropScope={`${props.id}-dnd`}
                        customElement={props.customElement}
                        onDragDrop={async (id: string, newOrder: number) => {
                            if (!props.dragDropIndexField) {
                                return;
                            }
        
                            setIsLoading(true);
        
                            await ModelAPI.updateById(
                                props.modelType,
                                new ObjectID(id),
                                {
                                    [props.dragDropIndexField]: newOrder,
                                }
                            );
        
                            fetchItems();
                        }}
                        titleField={props.titleField}
                        onDelete={props.isDeleteable ? async (item: TBaseModel) => { 
                            deleteItem(item);
                        } : undefined}
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
                                        selectedList.filter((i: TBaseModel) => {
                                            return (
                                                i._id?.toString() !==
                                                model._id?.toString()
                                            );
                                        })
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
                )}
                {props.footer}
            </div>
        </div>
    );
};

export default ModelList;
