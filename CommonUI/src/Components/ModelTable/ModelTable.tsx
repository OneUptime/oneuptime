import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement, useEffect, useState } from 'react';
import Columns from './Columns';
import Table from '../Table/Table';
import TableColumn from '../Table/Types/Column';
import { JSONObject } from 'Common/Types/JSON';
import Card, {
    CardButtonSchema,
    ComponentProps as CardComponentProps,
} from '../Card/Card';
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
import Permission, {
    PermissionHelper,
    UserPermission,
    UserProjectAccessPermission,
} from 'Common/Types/Permission';
import PermissionUtil from '../../Utils/Permission';
import { ColumnAccessControl } from 'Common/Types/Database/AccessControl/AccessControl';
import { getColumnAccessControlForAllColumns } from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import Query from '../../Utils/ModelAPI/Query';
import Search from 'Common/Types/Database/Search';
import Typeof from 'Common/Types/Typeof';
import Navigation from '../../Utils/Navigation';
import Route from 'Common/Types/API/Route';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Populate from '../../Utils/ModelAPI/Populate';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    type: { new (): TBaseModel };
    id: string;
    onFetchInit?:
        | undefined
        | ((pageNumber: number, itemsOnPage: number) => void);
    onFetchSuccess?:
        | undefined
        | ((data: Array<TBaseModel>, totalCount: number) => void);
    cardProps: CardComponentProps;
    columns: Columns<TBaseModel>;
    initialItemsOnPage?: number;
    isDeleteable: boolean;
    isEditable: boolean;
    isCreateable: boolean;
    disablePagination?: undefined | boolean;
    formFields?: undefined | Fields<TBaseModel>;
    noItemsMessage?: undefined | string;
    showRefreshButton?: undefined | boolean;
    showFilterButton?: undefined | boolean;
    isViewable?: undefined | boolean;
    currentPageRoute?: undefined | Route;
    query?: Query<TBaseModel>;
    onBeforeCreate?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
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
    const [query, setQuery] = useState<Query<TBaseModel>>({});
    const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
    const [totalItemsCount, setTotalItemsCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
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

    const [itemsOnPage, setItemsOnPage] = useState<number>(
        props.initialItemsOnPage || 10
    );

    const deleteItem: Function = async (id: ObjectID) => {
        setIsLoading(true);
        try {
            await ModelAPI.deleteItem<TBaseModel>(props.type, id);
            if (data.length === 1 && currentPageNumber > 1) {
                setCurrentPageNumber(currentPageNumber - 1);
            }
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

        setIsLoading(false);
    };

    const fetchItems: Function = async () => {
        setError('');
        setIsLoading(true);

        if (props.onFetchInit) {
            props.onFetchInit(currentPageNumber, itemsOnPage);
        }

        try {
            const listResult: ListResult<TBaseModel> =
                await ModelAPI.getList<TBaseModel>(
                    props.type,
                    {
                        ...query,
                        ...props.query
                    },
                    itemsOnPage,
                    (currentPageNumber - 1) * itemsOnPage,
                    getSelect(),
                    sortBy
                        ? {
                              [sortBy as any]: sortOrder,
                          }
                        : {},
                    getPopulate()
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

        setIsLoading(false);
    };

    const getSelect: Function = (): Select<TBaseModel> => {
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
    };

    const getPopulate: Function = (): Populate<TBaseModel> => {
        const populate: Populate<TBaseModel> = {};

        for (const column of props.columns) {
            const key: string | null = column.field
                ? (Object.keys(column.field)[0] as string)
                : null;

            if (key && props.model.isEntityColumn(key)) {
                (populate as JSONObject)[key] = true;
            }
        }

        return populate;
    };

    const setHeaderButtons: Function = (): void => {
        // add header buttons.
        const headerbuttons: Array<CardButtonSchema> = [];
        const userProjectPermissions: UserProjectAccessPermission | null =
            PermissionUtil.getProjectPermissions();
        const hasPermissionToCreate: boolean = Boolean(
            userProjectPermissions &&
                userProjectPermissions.permissions &&
                PermissionHelper.doesPermissionsIntersect(
                    props.model.createRecordPermissions,
                    userProjectPermissions.permissions.map(
                        (item: UserPermission) => {
                            return item.permission;
                        }
                    )
                )
        );

        if (props.isCreateable && hasPermissionToCreate) {
            headerbuttons.push({
                title: `Create ${model.singularName}`,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                    setModalType(ModalType.Create);
                    setShowModal(true);
                },
                icon: IconProp.Add,
            });
        }

        if (props.showRefreshButton) {
            headerbuttons.push({
                title: '',
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                    fetchItems();
                },
                disabled: isLoading,
                icon: IconProp.Refresh,
            });
        }

        if (props.showFilterButton) {
            headerbuttons.push({
                title: '',
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: () => {
                    const newValue: boolean = !showTableFilter;
                    if (!newValue) {
                        setQuery({});
                    }
                    setShowTableFilter(newValue);
                },
                disabled: isLoading,
                icon: IconProp.Filter,
            });
        }

        setCardButtons(headerbuttons);
    };

    useEffect(() => {
        fetchItems();
    }, [currentPageNumber, sortBy, sortOrder, itemsOnPage, query]);

    useEffect(() => {
        setHeaderButtons();
    }, [showTableFilter]);

    const shouldDisableSort: Function = (columnName: string): boolean => {
        return props.model.isEntityColumn(columnName);
    };

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

        let userPermissions: Array<Permission> =
            PermissionUtil.getGlobalPermissions()?.globalPermissions || [];
        if (
            PermissionUtil.getProjectPermissions() &&
            PermissionUtil.getProjectPermissions()?.permissions &&
            PermissionUtil.getProjectPermissions()!.permissions.length > 0
        ) {
            userPermissions = userPermissions.concat(
                PermissionUtil.getProjectPermissions()!.permissions.map(
                    (i: UserPermission) => {
                        return i.permission;
                    }
                )
            );
        }

        userPermissions.push(Permission.Public);

        const accessControl: Dictionary<ColumnAccessControl> =
            getColumnAccessControlForAllColumns(props.model);

        for (const column of props.columns) {
            const key: string | null = column.field
                ? (Object.keys(column.field)[0] as string)
                : null;

            const moreFields: Array<string> = column.moreFields
                ? Object.keys(column.moreFields)
                : [];

            // check permissions.
            let hasPermission: boolean = false;

            if (!key) {
                hasPermission = true;
            }

            if (key) {
                hasPermission = true;
                let fieldPermissions: Array<Permission> = [];
                fieldPermissions = accessControl[key as string]?.read || [];

                if (
                    accessControl[key]?.read &&
                    !PermissionHelper.doesPermissionsIntersect(
                        userPermissions,
                        fieldPermissions
                    )
                ) {
                    hasPermission = false;
                }

                for (const moreField of moreFields) {
                    if (
                        accessControl[moreField]?.read &&
                        !PermissionHelper.doesPermissionsIntersect(
                            userPermissions,
                            fieldPermissions
                        )
                    ) {
                        hasPermission = false;
                        break;
                    }
                }
            }

            if (hasPermission) {
                columns.push({
                    ...column,
                    disableSort: column.disableSort || shouldDisableSort(key),
                    key,
                });

                if (key) {
                    (selectFields as Dictionary<boolean>)[key] = true;
                }

                for (const moreField of moreFields) {
                    (selectFields as Dictionary<boolean>)[moreField] = true;
                }
            }
        }

        const userProjectPermissions: UserProjectAccessPermission | null =
            PermissionUtil.getProjectPermissions();

        const hasPermissionToDelete: boolean = Boolean(
            userProjectPermissions &&
                userProjectPermissions.permissions &&
                PermissionHelper.doesPermissionsIntersect(
                    props.model.deleteRecordPermissions,
                    userProjectPermissions.permissions.map(
                        (item: UserPermission) => {
                            return item.permission;
                        }
                    )
                )
        );

        const hasPermissionToUpdate: boolean = Boolean(
            userProjectPermissions &&
                userProjectPermissions.permissions &&
                PermissionHelper.doesPermissionsIntersect(
                    props.model.updateRecordPermissions,
                    userProjectPermissions.permissions.map(
                        (item: UserPermission) => {
                            return item.permission;
                        }
                    )
                )
        );

        const hasPermissionToView: boolean = Boolean(
            userProjectPermissions &&
                userProjectPermissions.permissions &&
                PermissionHelper.doesPermissionsIntersect(
                    props.model.readRecordPermissions,
                    userProjectPermissions.permissions.map(
                        (item: UserPermission) => {
                            return item.permission;
                        }
                    )
                )
        );

        if (
            (props.isDeleteable && hasPermissionToDelete) ||
            (props.isEditable && hasPermissionToUpdate)
        ) {
            columns.push({
                title: 'Actions',
                type: TableColumnType.Actions,
            });
        }

        const actionsSchema: Array<ActionButtonSchema> = [];

        if (props.isViewable && hasPermissionToView) {
            actionsSchema.push({
                title: 'View',
                buttonStyleType: ButtonStyleType.OUTLINE,
                actionType: ActionType.View,
            });
        }

        if (props.isEditable && hasPermissionToUpdate) {
            actionsSchema.push({
                title: 'Edit',
                buttonStyleType: ButtonStyleType.NORMAL,
                actionType: ActionType.Edit,
            });
        }

        if (props.isDeleteable && hasPermissionToDelete) {
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
                    onFilterChanged={(
                        filterData: Dictionary<string | boolean | Search | Date>
                    ) => {
                        const query: Query<TBaseModel> = {};

                        for (const key in filterData) {
                            if (
                                filterData[key] &&
                                typeof filterData[key] === Typeof.String
                            ) {
                                query[key as keyof TBaseModel] = (
                                    filterData[key] || ''
                                ).toString();
                            }

                            if (typeof filterData[key] === Typeof.Boolean) {
                                query[key as keyof TBaseModel] = Boolean(
                                    filterData[key]
                                );
                            }

                            if (filterData[key] instanceof Date) {
                                query[key as keyof TBaseModel] =
                                    filterData[key];
                            }

                            if (filterData[key] instanceof Search) {
                                query[key as keyof TBaseModel] =
                                    filterData[key];
                            }
                        }

                        setQuery(query);
                    }}
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
                    itemsOnPage={itemsOnPage}
                    disablePagination={props.disablePagination || false}
                    onNavigateToPage={async (
                        pageNumber: number,
                        itemsOnPage: number
                    ) => {
                        setCurrentPageNumber(pageNumber);
                        setItemsOnPage(itemsOnPage);
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

                        if (key === ActionType.View) {
                            if (!props.currentPageRoute) {
                                throw new BadDataException(
                                    'Please populate curentPageRoute in ModelTable'
                                );
                            }
                            Navigation.navigate(
                                new Route(
                                    props.currentPageRoute.toString()
                                ).addRoute('/' + item['_id'])
                            );
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
                    onBeforeCreate={props.onBeforeCreate}
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
