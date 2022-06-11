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
}: ComponentProps): ReactElement => {
    return (
        <div className="dropdownButtonListItem" onClick={action}>
            {title}
        </div>
    );
};

export default DropdownItem;
