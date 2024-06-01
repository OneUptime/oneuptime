import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import RelationSelect from '../RelationSelect';
import Select from '../Select';
import SelectUtil from '../SelectUtil';
import BasePermission, { CheckPermissionBaseInterface } from './BasePermission';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export interface CheckReadPermissionType<TBaseModel extends BaseModel>
    extends CheckPermissionBaseInterface<TBaseModel> {
    select: Select<TBaseModel> | null;
    relationSelect: RelationSelect<TBaseModel> | null;
}

export default class ReadPermission {
    public static async checkReadPermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps
    ): Promise<CheckReadPermissionType<TBaseModel>> {
        const baseFunctionReturn: CheckPermissionBaseInterface<TBaseModel> =
            await BasePermission.checkPermissions(
                modelType,
                query,
                select,
                props,
                DatabaseRequestType.Read
            );

        // upate query
        query = baseFunctionReturn.query;

        let relationSelect: RelationSelect<TBaseModel> = {};

        if (select) {
            const result: {
                select: Select<TBaseModel>;
                relationSelect: RelationSelect<TBaseModel>;
            } = SelectUtil.sanitizeSelect(modelType, select);
            select = result.select;
            relationSelect = result.relationSelect;
        }

        return { query, select, relationSelect };
    }
}
