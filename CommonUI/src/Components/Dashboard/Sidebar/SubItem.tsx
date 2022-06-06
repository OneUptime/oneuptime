import React, {
    ReactElement,
    MouseEventHandler,
    FunctionComponent,
} from 'react';

export interface ComponentProps {
    title: string;
    action?: MouseEventHandler;
}

const SubItem: FunctionComponent<ComponentProps> = ({
    title,
    action,
}: ComponentProps): ReactElement => {
    return (
        <div className="subsidebar" onClick={action}>
            {title}
        </div>
    );
};

export default SubItem;
