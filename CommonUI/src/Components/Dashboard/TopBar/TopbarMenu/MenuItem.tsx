import React, {
    ReactElement,
    MouseEventHandler,
    FunctionComponent,
} from 'react';
import Shortcut from '../../../Basic/ShortcutKey/Shortcut';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import Char from 'Common/Types/Char';

import './MenuItem.scss';

export interface ComponentProps {
    text: string;
    icon?: IconProp;
    shortcuts?: Array<Char>;
    action?: MouseEventHandler;
}

const MenuItem: FunctionComponent<ComponentProps> = ({
    text,
    icon,
    shortcuts,
    action,
}: ComponentProps): ReactElement => {
    return (
        <div onClick={action} className="menu-item">
            <div className="name">
                {icon && <FontAwesomeIcon icon={icon} />}
                <p>{text}</p>
            </div>
            {shortcuts && (
                <div className="shortcut">
                    <Shortcut shortcuts={shortcuts} />
                </div>
            )}
        </div>
    );
};

export default MenuItem;
