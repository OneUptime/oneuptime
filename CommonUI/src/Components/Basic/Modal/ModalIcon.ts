import { IconProp } from '@fortawesome/fontawesome-svg-core';

enum ModalIcons {
    ERROR,
    QUESTION,
    INFO,
    SUCCESS,
}

export type ConfirmModal = {
    icon: IconProp;
    theme: string;
};

export default ModalIcons;
