import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface IconProps {
    variant?: 'danger' | 'info' | 'warning' | 'success' | null | undefined;
}
const VariantIcon: FunctionComponent<IconProps> = ({
    variant,
}: IconProps): ReactElement => {
    switch (variant) {
        case 'danger':
            return <Icon icon={IconProp['TriangleExclamation']} />;
        case 'warning':
            return <Icon icon={IconProp['Exclamation']} />;
        case 'info':
            return <Icon icon={IconProp['Info']} />;
        case 'success':
            return <Icon icon={IconProp['CheckMark']} />;
        default:
            return <> </>;
    }
};
export default VariantIcon;
