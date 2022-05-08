import { PayloadTypes } from '../PayloadTypes/modal';
import Action from '../types/action';

export default interface ModalAction extends Action {
    payload: PayloadTypes;
}
