import React, { MutableRefObject, ReactElement, useState } from 'react';
import { FormikErrors, FormikProps, FormikValues } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicModelForm from './BasicModelForm';
import { JSONArray, JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import ModelAPI, {
    ListResult,
    RequestOptions,
} from '../../Utils/ModelAPI/ModelAPI';
import Select from '../../Utils/ModelAPI/Select';
import Dictionary from 'Common/Types/Dictionary';
import useAsyncEffect from 'use-async-effect';
import ObjectID from 'Common/Types/ObjectID';
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from 'Common/Types/BrandColors';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';
import PermissionUtil from '../../Utils/Permission';
import { ColumnAccessControl } from 'Common/Types/Database/AccessControl/AccessControl';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import FileModel from 'Common/Models/FileModel';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import Typeof from 'Common/Types/Typeof';
import { TableColumnMetadata } from 'Common/Types/Database/TableColumn';
import { ButtonStyleType } from '../Button/Button';
import JSONFunctions from 'Common/Types/JSONFunctions';
import API from '../../Utils/API/API';
import { FormStep } from './Types/FormStep';
import Field from './Types/Field';
import { getMaxLengthFromTableColumnType } from 'Common/Types/Database/ColumnLength';

export enum FormType {
    Create,
    Update,
}

export interface ComponentProps<TBaseModel extends BaseModel> {
    modelType: { new (): TBaseModel };
    id: string;
    onValidate?:
        | undefined
        | ((
              values: FormValues<TBaseModel>
          ) => FormikErrors<FormValues<TBaseModel>>);
    fields: Fields<TBaseModel>;
    onFormStepChange?: undefined | ((stepId: string) => void);
    steps?: undefined | Array<FormStep<TBaseModel>>;
    submitButtonText?: undefined | string;
    requestHeaders?: undefined | Dictionary<string>;
    title?: undefined | string;
    description?: undefined | string;
    showAsColumns?: undefined | number;
    disableAutofocus?: undefined | boolean;
    footer?: ReactElement | undefined;
    onCancel?: undefined | (() => void);
    name: string;
    onChange?: undefined | ((values: FormValues<TBaseModel>) => void);
    onSuccess?:
        | undefined
        | ((data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>) => void);
    cancelButtonText?: undefined | string;
    maxPrimaryButtonWidth?: undefined | boolean;
    apiUrl?: undefined | URL;
    formType: FormType;
    hideSubmitButton?: undefined | boolean;
    submitButtonStyleType?: ButtonStyleType | undefined;
    formRef?: undefined | MutableRefObject<FormikProps<FormikValues>>;
    onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
    onLoadingChange?: undefined | ((isLoading: boolean) => void);
    initialValues?: FormValues<TBaseModel> | undefined;
    modelIdToEdit?: ObjectID | undefined;
    onError?: ((error: string) => void) | undefined;
    onBeforeCreate?:
        | ((
              item: TBaseModel,
              miscDataProps: JSONObject
          ) => Promise<TBaseModel>)
        | undefined;
    saveRequestOptions?: RequestOptions | undefined;
    doNotFetchExistingModel?: boolean | undefined;
}

const ModelForm: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [fields, setFields] = useState<Fields<TBaseModel>>([]);
    const [isLoading, setLoading] = useState<boolean>(false);
    const [isFetching, setIsFetching] = useState<boolean>(false);
    const [isFetchingDropdownOptions, setIsFetchingDropdownOptions] =
        useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [itemToEdit, setItemToEdit] = useState<TBaseModel | null>(null);
    const model: TBaseModel = new props.modelType();

    const getSelectFields: Function = (): Select<TBaseModel> => {
        const select: Select<TBaseModel> = {};
        for (const field of props.fields) {
            const key: string | null = field.field
                ? (Object.keys(field.field)[0] as string)
                : null;

            if (key && hasPermissionOnField(key)) {
                (select as Dictionary<boolean>)[key] = true;
            }
        }

        return select;
    };

    const getRelationSelect: () => Select<TBaseModel> =
        (): Select<TBaseModel> => {
            const relationSelect: Select<TBaseModel> = {};

            for (const field of props.fields) {
                const key: string | null = field.field
                    ? (Object.keys(field.field)[0] as string)
                    : null;

                if (key && model.isFileColumn(key)) {
                    (relationSelect as JSONObject)[key] = {
                        file: true,
                        _id: true,
                        type: true,
                        name: true,
                    };
                } else if (key && model.isEntityColumn(key)) {
                    (relationSelect as JSONObject)[key] = (field.field as any)[
                        key
                    ];
                }
            }

            return relationSelect;
        };

    const hasPermissionOnField: (fieldName: string) => boolean = (
        fieldName: string
    ): boolean => {
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
            model.getColumnAccessControlForAllColumns();

        let fieldPermissions: Array<Permission> = [];

        if (FormType.Create === props.formType) {
            fieldPermissions = accessControl[fieldName]?.create || [];
        } else {
            fieldPermissions = accessControl[fieldName]?.update || [];
        }

        if (
            fieldPermissions &&
            PermissionHelper.doesPermissionsIntersect(
                userPermissions,
                fieldPermissions
            )
        ) {
            return true;
        }

        return false;
    };

    const setFormFields: () => Promise<void> = async (): Promise<void> => {
        let fieldsToSet: Fields<TBaseModel> = [];

        for (const field of props.fields) {

            const fieldObj = field.field || field.overrideField;

            if(!fieldObj){
                continue;
            }

            const keys: Array<string> = Object.keys(fieldObj);

            if (keys.length > 0) {
                const key: string = keys[0] as string;

                const hasPermission: boolean = hasPermissionOnField(key);

                if (
                    (field.forceShow || hasPermission) &&
                    fieldsToSet.filter((i: Field<TBaseModel>) => {
                        // check if field already exists. If it does, don't add it.
                        const iKeys: Array<string> = Object.keys(fieldObj);
                        const iFieldKey: string = iKeys[0] as string;
                        return iFieldKey === key;
                    }).length === 0
                ) {
                    // check if has maxLength
                    if (
                        !field.validation?.maxLength &&
                        model.getTableColumnMetadata(key)?.type
                    ) {
                        field.validation = {
                            ...field.validation,
                            maxLength: getMaxLengthFromTableColumnType(
                                model.getTableColumnMetadata(key).type
                            ),
                        };
                    }

                    fieldsToSet.push(field);
                }
            }
        }

        fieldsToSet = await fetchDropdownOptions(fieldsToSet);

        setFields(fieldsToSet);
    };

    useAsyncEffect(async () => {
        // set fields.
        await setFormFields();
    }, []);

    useAsyncEffect(async () => {
        // set fields.
        await setFormFields();
    }, [props.fields]);

    const fetchItem: Function = async (): Promise<void> => {
        if (!props.modelIdToEdit || props.formType !== FormType.Update) {
            throw new BadDataException('Model ID to update not found.');
        }

        let item: BaseModel | null = await ModelAPI.getItem(
            props.modelType,
            props.modelIdToEdit,
            { ...getSelectFields(), ...getRelationSelect() }
        );

        if (!(item instanceof BaseModel) && item) {
            item = JSONFunctions.fromJSON(
                item as JSONObject,
                props.modelType
            ) as BaseModel;
        }

        if (!item) {
            setError(
                `Cannot edit ${(
                    model.singularName || 'item'
                ).toLowerCase()}. It could be because you don't have enough permissions to read or edit this ${(
                    model.singularName || 'item'
                ).toLowerCase()}.`
            );
        }

        const relationSelect: Select<TBaseModel> = getRelationSelect();

        for (const key in relationSelect) {
            if (item) {
                if (Array.isArray((item as any)[key])) {
                    const idArray: Array<string> = [];
                    let isModelArray: boolean = false;
                    for (const itemInArray of (item as any)[key] as any) {
                        if (typeof (itemInArray as any) === 'object') {
                            if ((itemInArray as any as JSONObject)['_id']) {
                                isModelArray = true;
                                idArray.push(
                                    (itemInArray as any as JSONObject)[
                                        '_id'
                                    ] as string
                                );
                            }
                        }
                    }

                    if (isModelArray) {
                        (item as any)[key] = idArray;
                    }
                }
                if (
                    (item as any)[key] &&
                    typeof (item as any)[key] === 'object' &&
                    !((item as any)[key] instanceof FileModel)
                ) {
                    if (((item as any)[key] as JSONObject)['_id']) {
                        (item as any)[key] = ((item as any)[key] as JSONObject)[
                            '_id'
                        ] as string;
                    }
                }
            }
        }

        setItemToEdit(item as TBaseModel);
    };

    const fetchDropdownOptions: Function = async (
        fields: Fields<TBaseModel>
    ): Promise<Fields<TBaseModel>> => {
        setIsFetchingDropdownOptions(true);

        try {
            for (const field of fields) {
                if (field.dropdownModal && field.dropdownModal.type) {
                    const listResult: ListResult<BaseModel> =
                        await ModelAPI.getList<BaseModel>(
                            field.dropdownModal.type,
                            {},
                            LIMIT_PER_PROJECT,
                            0,
                            {
                                [field.dropdownModal.labelField]: true,
                                [field.dropdownModal.valueField]: true,
                            },
                            {}
                        );

                    if (listResult.data && listResult.data.length > 0) {
                        field.dropdownOptions = listResult.data.map(
                            (item: BaseModel) => {
                                if (!field.dropdownModal) {
                                    throw new BadDataException(
                                        'Dropdown Modal value mot found'
                                    );
                                }

                                return {
                                    label: (item as any)[
                                        field.dropdownModal?.labelField
                                    ].toString(),
                                    value: (item as any)[
                                        field.dropdownModal?.valueField
                                    ].toString(),
                                };
                            }
                        );
                    } else {
                        field.dropdownOptions = [];
                    }
                }
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsFetchingDropdownOptions(false);

        return fields;
    };

    useAsyncEffect(async () => {
        if (
            props.modelIdToEdit &&
            props.formType === FormType.Update &&
            !props.doNotFetchExistingModel
        ) {
            // get item.
            setLoading(true);
            setIsFetching(true);
            setError('');
            try {
                await fetchItem();
            } catch (err) {
                setError(API.getFriendlyMessage(err));
                props.onError && props.onError(API.getFriendlyMessage(err));
            }

            setLoading(false);
            setIsFetching(false);
        }
    }, []);

    const getmiscDataProps: Function = (values: JSONObject): JSONObject => {
        const result: JSONObject = {};

        for (const field of fields) {
            if (field.overrideFieldKey && values[field.overrideFieldKey]) {
                result[field.overrideFieldKey] =
                    values[field.overrideFieldKey] || null;
            }
        }

        return result;
    };

    const onSubmit: (values: JSONObject) => Promise<void> = async (values: JSONObject): Promise<void> => {
        // Ping an API here.
        setError('');
        setLoading(true);
        if (props.onLoadingChange) {
            props.onLoadingChange(true);
        }

        let result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >;

        try {
            // strip data.
            const valuesToSend: JSONObject = {};

            for (const key in getSelectFields()) {
                (valuesToSend as any)[key] = values[key];
            }

            if (props.formType === FormType.Update && props.modelIdToEdit) {
                (valuesToSend as any)['_id'] = props.modelIdToEdit.toString();
            }

            const miscDataProps: JSONObject = getmiscDataProps(values);

            // remove those props from valuesToSend
            for (const key in miscDataProps) {
                delete valuesToSend[key];
            }

            for (const key of model.getTableColumns().columns) {
                const tableColumnMetadata: TableColumnMetadata =
                    model.getTableColumnMetadata(key);

                if (
                    tableColumnMetadata &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.Entity &&
                    valuesToSend[key] &&
                    typeof valuesToSend[key] === Typeof.String
                ) {
                    const baseModel: BaseModel =
                        new tableColumnMetadata.modelType();
                    baseModel._id = valuesToSend[key] as string;
                    valuesToSend[key] = baseModel;
                }

                if (
                    tableColumnMetadata &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.EntityArray &&
                    Array.isArray(valuesToSend[key]) &&
                    (valuesToSend[key] as Array<any>).length > 0 &&
                    typeof (valuesToSend[key] as Array<any>)[0] ===
                        Typeof.Object &&
                    typeof (valuesToSend[key] as Array<any>)[0].value ===
                        Typeof.String
                ) {
                    const arr: Array<string> = [];
                    for (const id of valuesToSend[key] as Array<Object>) {
                        arr.push((id as any).value as string);
                    }
                    valuesToSend[key] = arr;
                }

                if (
                    tableColumnMetadata &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.EntityArray &&
                    Array.isArray(valuesToSend[key]) &&
                    (valuesToSend[key] as Array<any>).length > 0 &&
                    typeof (valuesToSend[key] as Array<any>)[0] ===
                        Typeof.String
                ) {
                    const arr: Array<BaseModel> = [];
                    for (const id of valuesToSend[key] as Array<string>) {
                        const baseModel: BaseModel =
                            new tableColumnMetadata.modelType();
                        baseModel._id = id as string;
                        arr.push(baseModel);
                    }
                    valuesToSend[key] = arr;
                }
            }

            let tBaseModel: TBaseModel = JSONFunctions.fromJSON(
                valuesToSend,
                props.modelType
            ) as TBaseModel;

            if (props.onBeforeCreate && props.formType === FormType.Create) {
                tBaseModel = await props.onBeforeCreate(
                    tBaseModel,
                    miscDataProps
                );
            }

            result = await ModelAPI.createOrUpdate<TBaseModel>(
                tBaseModel as TBaseModel,
                props.modelType,
                props.formType,
                miscDataProps,
                {
                    ...props.saveRequestOptions,
                    requestHeaders: props.requestHeaders,
                    overrideRequestUrl: props.apiUrl,
                }
            );

            if (props.onSuccess) {
                props.onSuccess(result.data);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setLoading(false);

        if (props.onLoadingChange) {
            props.onLoadingChange(false);
        }
    };

    if (isFetching || isFetchingDropdownOptions) {
        return (
            <div className="row flex justify-center mt-20 mb-20">
                <Loader
                    loaderType={LoaderType.Bar}
                    color={VeryLightGrey}
                    size={200}
                />
            </div>
        );
    }

    return (
        <div>
            <BasicModelForm<TBaseModel>
                title={props.title}
                description={props.description}
                disableAutofocus={props.disableAutofocus}
                model={model}
                id={props.id}
                name={props.name}
                onFormStepChange={props.onFormStepChange}
                onIsLastFormStep={props.onIsLastFormStep}
                fields={fields}
                steps={props.steps}
                onChange={(values: FormValues<TBaseModel>) => {
                    if (!isLoading) {
                        props.onChange && props.onChange(values);
                    }
                }}
                showAsColumns={props.showAsColumns}
                footer={props.footer}
                isLoading={isLoading}
                submitButtonText={props.submitButtonText}
                cancelButtonText={props.cancelButtonText}
                onSubmit={onSubmit}
                submitButtonStyleType={props.submitButtonStyleType}
                onValidate={props.onValidate}
                onCancel={props.onCancel}
                maxPrimaryButtonWidth={props.maxPrimaryButtonWidth}
                error={error}
                hideSubmitButton={props.hideSubmitButton}
                formRef={props.formRef}
                initialValues={itemToEdit || props.initialValues}
            ></BasicModelForm>
        </div>
    );
};

export default ModelForm;
