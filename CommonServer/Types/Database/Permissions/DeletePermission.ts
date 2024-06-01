import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import AccessControlUtil from './AccessControlPermission';
import PermissionUtil from './PermissionsUtil';
import TablePermission from './TablePermission';
import TenantPermission from './TenantPermission';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default class DeletePermission {
    public static async checkDeletePermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        if (props.isRoot || props.isMasterAdmin) {
            query = await PermissionUtil.addTenantScopeToQueryAsRoot(
                modelType,
                query,
                props
            );
        }

        if (!props.isRoot && !props.isMasterAdmin) {
            TablePermission.checkTableLevelPermissions(
                modelType,
                props,
                DatabaseRequestType.Delete
            );

            query = await TenantPermission.addTenantScopeToQuery(
                modelType,
                query,
                null,
                props,
                DatabaseRequestType.Delete
            );

            query = await AccessControlUtil.addAccessControlIdsToQuery(
                modelType,
                query,
                null,
                props,
                DatabaseRequestType.Delete
            );
        }

        return query;
    }
}
