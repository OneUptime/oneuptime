import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import { UserType } from '../../Utils/Express';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID| undefined;
    userPermissions?: Array<Permission>;
    userType?: UserType | undefined;
    projectId?: ObjectID | undefined;
}
