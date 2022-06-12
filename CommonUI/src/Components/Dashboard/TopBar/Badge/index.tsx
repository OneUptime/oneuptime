import React, { FunctionComponent, ReactElement } from 'react';
import './Badge.scss';
import VariantIcon, { IconProps } from './VariantIcon';

interface BadgeProps extends IconProps {
    text: string;
    Icon?: ReactElement;
}
const Badge: FunctionComponent<BadgeProps> = ({
    variant,
    text,
    Icon,
}: BadgeProps): ReactElement => {
    return (
        <div className={`badge badge-${variant}`}>
            <em>{text}</em>
            {Icon || <VariantIcon variant={variant} />}
        </div>
    );
};

export default Badge;
