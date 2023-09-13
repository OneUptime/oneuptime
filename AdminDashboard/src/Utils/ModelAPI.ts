import Dictionary from 'Common/Types/Dictionary';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';

export default class AdminModelAPI extends ModelAPI {
    public static override getCommonHeaders(): Dictionary<string> {
        return {};
    }
}
