import Email from './Email';
import ObjectID from './ObjectID';
import Permission from './Permission';

export default interface JSONWebTokenData {
    userId: ObjectID;
    email: Email;
    permissions: Array<Permission>;
    projectId?: ObjectID;
    isMasterAdmin: boolean;
}
