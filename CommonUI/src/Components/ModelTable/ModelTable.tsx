import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement, useEffect, useState } from 'react';
import Columns from './Columns';
import Table from '../Table/Table';
import TableColumn from '../Table/Types/Column';
import { JSONObject } from 'Common/Types/JSON';
import Card, { CardButtonSchema, ComponentProps as CardComponentProps } from '../Card/Card';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import Select from '../../Utils/ModelAPI/Select';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { ButtonStyleType } from '../Button/Button';
import ModelFromModal from '../ModelFormModal/ModelFormModal';
import { IconProp } from '../Icon/Icon';
import { FormType } from '../Forms/ModelForm';
import Fields from '../Forms/Types/Fields';
import SortOrder from 'Common/Types/Database/SortOrder';
import TableColumnType from '../Table/Types/TableColumnType';
import Dictionary from 'Common/Types/Dictionary';
import ActionButtonSchema, {
    ActionType,
} from '../Table/Types/ActionButtonSchema';
import ObjectID from 'Common/Types/ObjectID';
import ConfirmModal from '../Modal/ConfirmModal';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    type: { new(): TBaseModel };
    id: string;
    onFetchInit?:
    | undefined
    | ((pageNumber: number, itemsOnPage: number) => void);
    onFetchSuccess?:
    | undefined
    | ((data: Array<TBaseModel>, totalCount: number) => void);
    cardProps: CardComponentProps;
    columns: Columns<TBaseModel>;
    itemsOnPage: number;
    isDeleteable: boolean;
    isEditable: boolean;
    isCreateable: boolean;
    disablePagination?: undefined | boolean;
    formFields?: undefined | Fields<TBaseModel>;
    noItemsMessage?: undefined | string;
    showRefreshButton?: undefined | boolean;
    showFilterButton?: undefined | boolean;
}

enum ModalType {
    Create,
    Edit,
}

const ModelTable: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [tableColumns, setColumns] = useState<Array<TableColumn>>([]);
    const [cardButtons, setCardButtons] = useState<Array<CardButtonSchema>>([]);
    const model: TBaseModel = new props.type();
    const [actionButtonSchema, setActionButtonSchema] = useState<
        Array<ActionButtonSchema>
    >([]);

    const [data, setData] = useState<Array<TBaseModel>>([]);
    const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
    const [totalItemsCount, setTotalItemsCount] = useState<number>(0);
    const [isLoading, setIsLaoding] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [showModel, setShowModal] = useState<boolean>(false);
    const [showTableFilter, setShowTableFilter] = useState<boolean>(false);
    const [modalType, setModalType] = useState<ModalType>(ModalType.Create);
    const [sortBy, setSortBy] = useState<string>('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] =
        useState<boolean>(false);
    const [currentEditableItem, setCurrentEditableItem] =
        useState<JSONObject | null>(null);
    const [currentDeleteableItem, setCurrentDeleteableItem] =
        useState<JSONObject | null>(null);

    const deleteItem: Function = async (id: ObjectID) => {
        setIsLaoding(true);
        try {
            await ModelAPI.deleteItem<TBaseModel>(props.type, id);
            await fetchItems();
        } catch (err) {
            try {
                setError(
                    ((err as HTTPErrorResponse).data as JSONObject)[
                    'error'
                    ] as string
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLaoding(false);
    };

    const fetchItems: Function = async () => {
        setError('');
        setIsLaoding(true);

        if (props.onFetchInit) {
            props.onFetchInit(currentPageNumber, props.itemsOnPage);
        }

        try {
            const listResult: ListResult<TBaseModel> =
                await ModelAPI.getList<TBaseModel>(
                    props.type,
                    {},
                    props.itemsOnPage,
                    (currentPageNumber - 1) * props.itemsOnPage,
                    getSelect(),
                    sortBy
                        ? {
                            [sortBy as any]: sortOrder,
                        }
                        : {}
                );

            setTotalItemsCount(listResult.count);
            setData(listResult.data);
        } catch (err) {
            try {
                setError(
                    ((err as HTTPErrorResponse).data as JSONObject)[
                    'error'
                    ] as string
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLaoding(false);
    };

    const getSelect = (): Select<TBaseModel> => {
        const selectFields: Select<TBaseModel> = {
            _id: true,
        };

        for (const column of props.columns) {
            const key: string | null = column.field
                ? (Object.keys(column.field)[0] as string)
                : null;

            const moreFields: Array<string> = column.moreFields
                ? Object.keys(column.moreFields)
                : [];

            if (key) {
                (selectFields as Dictionary<boolean>)[key] = true;
            }

            for (const moreField of moreFields) {
                (selectFields as Dictionary<boolean>)[moreField] = true;
            }
        }

        return selectFields;
    }

    const setHeaderButtons = () => {
        // add header buttons.
        const headerbuttons: Array<CardButtonSchema> = [];
        if (props.isCreateable) {
            headerbuttons.push(
                {
                    title: `Create ${model.singularName}`,
                    buttonStyle: ButtonStyleType.OUTLINE,
                    onClick: () => {
                        setModalType(ModalType.Create);
                        setShowModal(true);
                    },
                    icon: IconProp.Add
                }
            );
        }

        if (props.showRefreshButton) {
            headerbuttons.push(
                {

                    title: '',
                    buttonStyle: ButtonStyleType.OUTLINE,
                    onClick: () => {
                        fetchItems();
                    },
                    disabled: isLoading,
                    icon: IconProp.Refresh
                }
            );
        }

        if (props.showFilterButton) {
            headerbuttons.push(
                {
                    title: '',
                    buttonStyle: ButtonStyleType.OUTLINE,
                    onClick: () => {
                        setShowTableFilter(!showTableFilter)
                    },
                    disabled: isLoading,
                    icon: IconProp.Filter,
                }
            );
        }

        setCardButtons(headerbuttons);
    }

    useEffect(() => {
        fetchItems();
    }, [currentPageNumber, sortBy, sortOrder]);


    useEffect(() => {
        setHeaderButtons();
    }, [showTableFilter])

    useEffect(() => {
        // Convert ModelColumns to TableColumns.

        const columns: Array<TableColumn> = [];

        const selectFields: Select<TBaseModel> = {
            _id: true,
        };

        const slugifyColumn: string | null = props.model.getSlugifyColumn();

        if (slugifyColumn) {
            (selectFields as Dictionary<boolean>)[slugifyColumn] = true;
        }

        for (const column of props.columns) {
            const key: string | null = column.field
                ? (Object.keys(column.field)[0] as string)
                : null;

            const moreFields: Array<string> = column.moreFields
                ? Object.keys(column.moreFields)
                : [];

            columns.push({
                title: column.title,
                disableSort: column.disableSort || false,
                type: column.type,
                key: key,
                isFilterable: column.isFilterable,
                getColumnElement: column.getColumnElement
                    ? column.getColumnElement
                    : undefined,
            });

            if (key) {
                (selectFields as Dictionary<boolean>)[key] = true;
            }

            for (const moreField of moreFields) {
                (selectFields as Dictionary<boolean>)[moreField] = true;
            }
        }


        if (props.isDeleteable || props.isEditable) {
            columns.push({
                title: 'Actions',
                type: TableColumnType.Actions,
            });
        }



        const actionsSchema: Array<ActionButtonSchema> = [];

        if (props.isEditable) {
            actionsSchema.push({
                title: 'Edit',
                icon: IconProp.Edit,
                buttonStyleType: ButtonStyleType.NORMAL,
                actionType: ActionType.Edit,
            });
        }

        if (props.isDeleteable) {
            actionsSchema.push({
                title: 'Delete',
                icon: IconProp.Trash,
                buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
                actionType: ActionType.Delete,
            });
        }

        setActionButtonSchema(actionsSchema);

        setHeaderButtons();
        setColumns(columns);
    }, []);

    return (
        <>
            <Card
                {...props.cardProps}
                cardBodyStyle={{ padding: '0px' }}
                buttons={cardButtons}
            >
                <Table
                    onSortChanged={(sortBy: string, sortOrder: SortOrder) => {
                        setSortBy(sortBy);
                        setSortOrder(sortOrder);
                    }}
                    singularLabel={model.singularName || 'Item'}
                    pluralLabel={model.pluralName || 'Items'}
                    error={error}
                    currentPageNumber={currentPageNumber}
                    isLoading={isLoading}
                    totalItemsCount={totalItemsCount}
                    data={BaseModel.toJSONObjectArray(data)}
                    id={props.id}
                    columns={tableColumns}
                    itemsOnPage={props.itemsOnPage}
                    disablePagination={props.disablePagination || false}
                    onNavigateToPage={(pageNumber: number) => {
                        setCurrentPageNumber(pageNumber);
                    }}
                    showFilter={showTableFilter}
                    noItemsMessage={props.noItemsMessage || ''}
                    onRefreshClick={() => {
                        fetchItems();
                    }}
                    actionButtons={actionButtonSchema}
                    onActionEvent={(key: ActionType, item: JSONObject) => {
                        if (key === ActionType.Edit) {
                            setModalType(ModalType.Edit);
                            setShowModal(true);
                            setCurrentEditableItem(item);
                        }

                        if (key === ActionType.Delete) {
                            setShowDeleteConfirmModal(true);
                            setCurrentDeleteableItem(item);
                        }
                    }}
                />
            </Card>

            {showModel ? (
                <ModelFromModal<TBaseModel>
                    title={
                        modalType === ModalType.Create
                            ? `Create New ${model.singularName}`
                            : `Edit ${model.singularName}`
                    }
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText={
                        modalType === ModalType.Create
                            ? `Create ${model.singularName}`
                            : `Save Changes`
                    }
                    onSuccess={(_item: TBaseModel) => {
                        setShowModal(false);
                        setCurrentPageNumber(1);
                        fetchItems();
                    }}
                    type={props.type}
                    formProps={{
                        model: model,
                        id: `create-${props.type.name}-from`,
                        fields: props.formFields || [],
                        formType:
                            modalType === ModalType.Create
                                ? FormType.Create
                                : FormType.Update,
                        type: props.type,
                    }}
                    modelIdToEdit={
                        currentEditableItem
                            ? new ObjectID(currentEditableItem['_id'] as string)
                            : undefined
                    }
                />
            ) : (
                <></>
            )}

            {showDeleteConfirmModal && (
                <ConfirmModal
                    title={`Delete ${model.singularName}`}
                    description={`Are you sure you want to delete this ${(
                        model.singularName || 'item'
                    )?.toLowerCase()}?`}
                    onClose={() => {
                        setShowDeleteConfirmModal(false);
                    }}
                    submitButtonText={'Delete'}
                    onSubmit={() => {
                        if (
                            currentDeleteableItem &&
                            currentDeleteableItem['_id']
                        ) {
                            deleteItem(
                                new ObjectID(
                                    currentDeleteableItem['_id'].toString()
                                )
                            );
                            setShowDeleteConfirmModal(false);
                        }
                    }}
                    submitButtonType={ButtonStyleType.DANGER}
                />
            )}
        </>
    );
};

export default ModelTable;
