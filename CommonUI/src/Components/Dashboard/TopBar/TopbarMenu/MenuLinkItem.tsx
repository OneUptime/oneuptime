import React, { ReactElement, FunctionComponent } from 'react';
import { faUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import './MenuLink.scss';

export interface ComponentProps {
    text: string;
    openInNewTab?: boolean;
}

const MenuLinkItem: FunctionComponent<ComponentProps> = ({
    text,
    openInNewTab,
}): ReactElement => {
    return (
        <div className="menu-link">
            <div className="name">
                <p>{text}</p>
                {openInNewTab && <FontAwesomeIcon icon={faUpRightFromSquare} />}
            </div>
        </div>
    );
};

export default MenuLinkItem;
