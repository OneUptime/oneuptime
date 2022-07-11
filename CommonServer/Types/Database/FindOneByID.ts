import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface FindOneByID extends DatabaseCommonInteractionProps {
    id: ObjectID;
}
