import { PayloadTypes } from '../PayloadTypes/ApiBase';
import Action from '../Types/Action';

export default interface ApiAction extends Action {
    payload: PayloadTypes;
}
