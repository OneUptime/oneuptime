import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import TablePermission from './TablePermission';
import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import ColumnPermissions from './ColumnPermission';

export default class CreatePermission {
    public static checkCreatePermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        data: TBaseModel,
        props: DatabaseCommonInteractionProps
    ): void {
        // If system is making this query then let the query run!
        if (props.isRoot || props.isMasterAdmin) {
            return;
        }

        TablePermission.checkTableLevelPermissions(
            modelType,
            props,
            DatabaseRequestType.Create
        );

        ColumnPermissions.checkDataColumnPermissions(
            modelType,
            data,
            props,
            DatabaseRequestType.Create
        );
    }
}
