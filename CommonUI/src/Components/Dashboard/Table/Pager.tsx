import React, { FC, ReactElement, MouseEventHandler } from 'react';

export interface ComponentProps {
    title: string;
    action?: MouseEventHandler;
    disabled?: boolean;
}

const Pager: FC<ComponentProps> = ({
    title,
    action,
    disabled,
}): ReactElement => {
    return (
        <button disabled={disabled} onClick={action}>
            {title}
        </button>
    );
};

export default Pager;
