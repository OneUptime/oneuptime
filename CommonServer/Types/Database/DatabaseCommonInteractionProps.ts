import ObjectID from 'Common/Types/ObjectID';
import Role from 'Common/Types/Role';
import { AuthorizationType } from '../../Utils/Express';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID;
    userRoleInProject?: Role;
    authorizationType?: AuthorizationType;
}
