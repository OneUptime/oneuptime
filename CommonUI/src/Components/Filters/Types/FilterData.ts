import GenericObject from 'Common/Types/GenericObject';
import Query from '../../../Utils/BaseDatabase/Query';

type FillterData<T extends GenericObject> = Query<T>; // this is bascially a Query object

export default FillterData;
