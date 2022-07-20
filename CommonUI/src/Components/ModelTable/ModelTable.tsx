import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement, useEffect, useState } from 'react';
import Columns from './Columns';
import Table from '../Table/Table';
import TableColumn from '../Table/Types/Column';
import { JSONObject } from 'Common/Types/JSON';
import Card, { ComponentProps as CardComponentProps } from '../Card/Card';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import Select from '../../Utils/ModelAPI/Select';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Button, { ButtonStyleType } from '../Button/Button';
import ModelFromModal from '../ModelFormModal/ModelFormModal';
import { IconProp } from '../Icon/Icon';
import { FormType } from '../Forms/ModelForm';
import Fields from '../Forms/Types/Fields';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    type: { new(): TBaseModel };
    id: string;
    onFetchInit?: (pageNumber: number, itemsOnPage: number) => void;
    onFetchSuccess?: (data: Array<TBaseModel>, totalCount: number) => void;
    cardProps: CardComponentProps;
    columns: Columns<TBaseModel>;
    itemsOnPage: number;
    isDeleteable: boolean;
    isEditable: boolean;
    isCreateable: boolean;
    disablePagination?: boolean;
    select: Select<TBaseModel>;
    formFields?: Fields<TBaseModel>;
    noItemsMessage?: string;
}

enum ModalType {
    Create, Edit
}

const ModelTable: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

    const [tableColumns, setColumns] = useState<Array<TableColumn>>([]);
    const [cardButtons, setCardButtons] = useState<Array<ReactElement>>([]);
    const model: TBaseModel = new props.type();

    const [data, setData] = useState<Array<TBaseModel>>([]);
    const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
    const [totalItemsCount, setTotalItemsCount] = useState<number>(0);
    const [isLoading, setIsLaoding] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [showModel, setShowModal] = useState<boolean>(false);
    const [modalType, setModalType] = useState<ModalType>(ModalType.Create);

    const fetchItems = async () => {

        setIsLaoding(true);

        if (props.onFetchInit) {
            props.onFetchInit(currentPageNumber, props.itemsOnPage);
        }

        try {
            const listResult: ListResult<TBaseModel> = await ModelAPI.getList<TBaseModel>(props.type, {}, props.itemsOnPage, currentPageNumber * props.itemsOnPage, props.select, {});

            setTotalItemsCount(listResult.count);
            setData(listResult.data);

        } catch (err) {
            setError(
                ((err as HTTPErrorResponse).data as JSONObject)[
                'error'
                ] as string
            );
        }

        setIsLaoding(false);
    };

    useEffect(() => {
        fetchItems();
    }, [currentPageNumber])


    useEffect(() => {
        // Convert ModelColumns to TableColumns.

        const columns = [];
        for (const column of props.columns) {
            columns.push({
                title: column.title,
                disableSort: column.disableSort || false,
                type: column.type,
                key: column.field
                    ? (Object.keys(column.field)[0] as string)
                    : null,
            });
        }



        // add header buttons. 

        if (props.isCreateable) {
            setCardButtons([
                <Button
                    key={1}
                    title={`Create ${model.singularName}`}
                    buttonStyle={ButtonStyleType.OUTLINE}
                    onClick={() => {
                        setModalType(ModalType.Create);
                        setShowModal(true);
                    }}
                    icon={IconProp.Add}
                />,
            ])
        }

        setColumns(columns);
        fetchItems();


    }, []);

    return (
        <>
            <Card {...props.cardProps} cardBodyStyle={{ "padding": "0px" }} buttons={cardButtons}>
                <Table
                    singularLabel={model.singularName || 'Item'}
                    pluralLabel={model.pluralName || 'Items'}
                    error={error}
                    currentPageNumber={currentPageNumber}
                    isLoading={isLoading}
                    totalItemsCount={totalItemsCount}
                    data={BaseModel.toJSONArray(data)}
                    id={props.id}
                    columns={tableColumns}
                    itemsOnPage={props.itemsOnPage}
                    disablePagination={props.disablePagination || false}
                    onNavigateToPage={(pageNumber: number) => {
                        setCurrentPageNumber(pageNumber);
                    }}
                    noItemsMessage={props.noItemsMessage || ''}
                    onRefreshClick={() => {
                        fetchItems();
                    }}
                />
            </Card>

            {showModel ? (
                <ModelFromModal<TBaseModel>
                    title={modalType === ModalType.Create ? `Create New ${model.singularName}` : `Edit ${model.singularName}`}
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText={`Create ${model.singularName}`}
                    onSuccess={(_item: TBaseModel) => {
                        setCurrentPageNumber(1);
                    }}
                    formProps={{
                        model: model,
                        id: `create-${props.type.name}-from`,
                        fields: props.formFields || [],
                        formType: ModalType.Create ? FormType.Create : FormType.Update,
                    }}

                />
            ) : (
                <></>
            )}
        </>
    );
};

export default ModelTable;
