import React, {
    FunctionComponent,
    ReactElement,
    useState,
    useEffect,
} from 'react';
import BasicModal from './BasicModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faWarning,
    faQuestionCircle,
    faCheckCircle,
    faInfoCircle,
} from '@fortawesome/free-solid-svg-icons';
import ModalIcons, { ConfirmModal } from './ModalIcon';
import './Modal.scss';

export interface ComponentProps {
    title: string;
    text: string;
    icon?: ModalIcons;
    showSecondaryButton?: boolean;
}

const getIconProperty = (icon: ModalIcons): ConfirmModal => {
    switch (icon) {
        case ModalIcons.ERROR:
            return {
                icon: faWarning,
                theme: 'danger',
            };
        case ModalIcons.QUESTION:
            return {
                icon: faQuestionCircle,
                theme: 'info',
            };
        case ModalIcons.SUCCESS:
            return {
                icon: faCheckCircle,
                theme: 'success',
            };
        default:
            return {
                icon: faInfoCircle,
                theme: 'info',
            };
    }
};

const ConfirmTextModal: FunctionComponent<ComponentProps> = ({
    title,
    text,
    icon,
    showSecondaryButton,
}): ReactElement => {
    const [theme, setTheme] = useState<ConfirmModal>({
        theme: 'info',
        icon: faInfoCircle,
    });

    useEffect(() => {
        setTheme(getIconProperty(icon || ModalIcons.INFO));
    }, []);

    return (
        <BasicModal
            title={title}
            showPrimaryButton={true}
            primaryButtonText="Okay"
            showCancelButton={showSecondaryButton!}
        >
            <div className="confirmDialog">
                <div className={`${theme.theme} icon`}>
                    <FontAwesomeIcon icon={theme?.icon} />
                </div>
                <div className="confirmDialog__text">{text}</div>
            </div>
        </BasicModal>
    );
};

export default ConfirmTextModal;
