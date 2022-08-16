import React, { ReactElement, useEffect, useState } from 'react';
import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Select from '../../Utils/ModelAPI/Select';
import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from 'Common/Types/BrandColors';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';
import PermissionUtil from '../../Utils/Permission';
import { ColumnAccessControl } from 'Common/Types/Database/AccessControl/AccessControl';
import Field from './Field';
import Detail from '../Detail/Detail';

export interface ComponentProps<TBaseModel extends BaseModel> {
    modelType: { new (): TBaseModel };
    id: string;
    fields: Array<Field<TBaseModel>>;
    onLoadingChange?: undefined | ((isLoading: boolean) => void);
    modelId: ObjectID;
    onError?: ((error: string) => void) | undefined;
    onItemLoaded?: (item: TBaseModel) => void | undefined;
    refresher?: undefined | boolean;
}

const ModelDetail: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [fields, setFields] = useState<Array<Field<TBaseModel>>>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [item, setItem] = useState<TBaseModel | null>(null);

    const model: TBaseModel = new props.modelType();

    useEffect(() => {
        fetchItem();
    }, [props.refresher]);

    const getSelectFields: Function = (): Select<TBaseModel> => {
        const select: Select<TBaseModel> = {};
        for (const field of props.fields) {
            const key: string | null = field.field
                ? (Object.keys(field.field)[0] as string)
                : null;

            if (key) {
                (select as Dictionary<boolean>)[key] = true;
            }
        }

        return select;
    };

    useEffect(() => {
        // set fields.

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

        const fieldsToSet: Array<Field<TBaseModel>> = [];

        for (const field of props.fields) {
            const keys: Array<string> = Object.keys(field.field);

            if (keys.length > 0) {
                const key: string = keys[0] as string;

                let fieldPermissions: Array<Permission> = [];

                fieldPermissions = accessControl[key]?.read || [];

                if (
                    fieldPermissions &&
                    PermissionHelper.doesPermissionsIntersect(
                        userPermissions,
                        fieldPermissions
                    )
                ) {
                    field.key = key;
                    fieldsToSet.push(field);
                }
            }
        }

        setFields(fieldsToSet);
    }, []);

    const fetchItem: Function = async (): Promise<void> => {
        // get item.
        setIsLoading(true);
        props.onLoadingChange && props.onLoadingChange(true);
        setError('');
        try {
            const item: TBaseModel | null = await ModelAPI.getItem(
                props.modelType,
                props.modelId,
                getSelectFields()
            );

            if (!item) {
                setError(
                    `Cannot load ${(
                        model.singularName || 'item'
                    ).toLowerCase()}. It could be because you don't have enough permissions to read this ${(
                        model.singularName || 'item'
                    ).toLowerCase()}.`
                );
            }

            if (props.onItemLoaded && item) {
                props.onItemLoaded(item);
            }

            setItem(item);
        } catch (err) {
            let error: string = '';
            try {
                error = ((err as HTTPErrorResponse).data as JSONObject)[
                    'error'
                ] as string;
            } catch (e) {
                error = 'Server Error. Please try again';
            }
            setError(error);
            props.onError && props.onError(error);
        }
        setIsLoading(false);
        props.onLoadingChange && props.onLoadingChange(false);
    };

    useEffect(() => {
        fetchItem();
    }, []);

    if (isLoading) {
        return (
            <div
                className="row text-center"
                style={{
                    marginTop: '50px',
                    marginBottom: '50px',
                }}
            >
                <Loader
                    loaderType={LoaderType.Bar}
                    color={VeryLightGrey}
                    size={200}
                />
            </div>
        );
    }

    if (error) {
        return (
            <p
                className="text-center color-light-grey"
                style={{
                    marginTop: '50px',
                    marginBottom: '50px',
                }}
            >
                {error} <br />{' '}
                <span
                    onClick={() => {
                        fetchItem();
                    }}
                    className="underline primary-on-hover"
                >
                    Refresh?
                </span>
            </p>
        );
    }

    return <Detail id={props.id} item={item} fields={fields} />;
};

export default ModelDetail;
