import Query from '../Query';
import Select from '../Select';
import CreatePermission from './CreatePermission';
import DeletePermission from './DeletePermission';
import ReadPermission, { CheckReadPermissionType } from './ReadPermission';
import UpdatePermission from './UpdatePermission';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export default class ModelPermission {
    public static async checkDeletePermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        return DeletePermission.checkDeletePermission(modelType, query, props);
    }

    public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        data: QueryDeepPartialEntity<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        return UpdatePermission.checkUpdatePermissions(
            modelType,
            query,
            data,
            props
        );
    }

    public static checkCreatePermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        data: TBaseModel,
        props: DatabaseCommonInteractionProps
    ): void {
        return CreatePermission.checkCreatePermissions(modelType, data, props);
    }

    public static async checkReadPermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<CheckReadPermissionType<TBaseModel>> {
        return ReadPermission.checkReadPermission(
            modelType,
            query,
            select,
            props
        );
    }
}
