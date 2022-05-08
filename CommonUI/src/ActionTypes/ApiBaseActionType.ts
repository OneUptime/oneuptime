import { PayloadTypes } from '../PayloadTypes/ApiBasePayloadType';
import Action from '../Types/Action';

export default interface ApiAction extends Action {
    payload: PayloadTypes;
}
