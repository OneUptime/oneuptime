import React, {
    FunctionComponent,
    MouseEventHandler,
    ReactElement,
} from 'react';

export interface ComponentProps {
    title: string;
    action?: MouseEventHandler;
}

const DropdownItem: FunctionComponent<ComponentProps> = ({
    action,
    title,
}): ReactElement => {
    return (
        <div className="dropdown-button-lists__list" onClick={action}>
            {title}
        </div>
    );
};

export default DropdownItem;
