import React, { FunctionComponent, ReactElement } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faCheck,
    faCircleInfo,
    faExclamation,
    faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';

export interface IconProps {
    variant: 'danger' | 'info' | 'warning' | 'success' | null;
}
const VariantIcon: FunctionComponent<IconProps> = ({
    variant,
}: IconProps): ReactElement => {
    switch (variant) {
        case 'danger':
            return <FontAwesomeIcon icon={faTriangleExclamation} />;
        case 'warning':
            return <FontAwesomeIcon icon={faExclamation} />;
        case 'info':
            return <FontAwesomeIcon icon={faCircleInfo} />;
        case 'success':
            return <FontAwesomeIcon icon={faCheck} />;
        default:
            return <> </>;
    }
};
export default VariantIcon;
