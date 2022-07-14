import Email from './Email';
import Name from './Name';
import ObjectID from './ObjectID';

export default interface JSONWebTokenData {
    userId: ObjectID;
    email: Email;
    name: Name;
    isMasterAdmin: boolean;
}
