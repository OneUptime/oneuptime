import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from './DatabaseCommonInteractionProps';

export default interface FindOneByID
    extends DatabaseCommonInteractionProps {
    id: ObjectID
}
