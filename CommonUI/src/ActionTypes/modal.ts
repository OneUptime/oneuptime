import { PayloadTypes } from '../payload-types/modal';
import Action from '../types/action';

export default interface ModalAction extends Action {
    payload: PayloadTypes;
}
