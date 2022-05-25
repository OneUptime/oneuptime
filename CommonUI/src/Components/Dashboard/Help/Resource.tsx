import React, { ReactElement, FC } from 'react';
import { faUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const Resource: FC<{ name: string; openInNewTab?: boolean }> = ({
    name,
    openInNewTab,
}): ReactElement => {
    return (
        <div>
            <div className="name">
                <p>{name}</p>
                {openInNewTab && <FontAwesomeIcon icon={faUpRightFromSquare} />}
            </div>
        </div>
    );
};

export default Resource;
