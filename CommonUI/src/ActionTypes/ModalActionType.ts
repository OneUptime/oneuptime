import { PayloadTypes } from '../PayloadTypes/ModalPayloadType';
import Action from '../Types/Action';

export default interface ModalAction extends Action {
    payload: PayloadTypes;
}
