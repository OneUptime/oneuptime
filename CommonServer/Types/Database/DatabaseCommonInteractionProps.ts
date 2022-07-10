import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import { userType } from '../../Utils/Express';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID;
    userPermissions?: Array<Permission>;
    userType?: userType;
}
