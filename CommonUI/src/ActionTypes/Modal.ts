import { PayloadTypes } from '../PayloadTypes/Modal';
import Action from '../Types/Action';

export default interface ModalAction extends Action {
    payload: PayloadTypes;
}
