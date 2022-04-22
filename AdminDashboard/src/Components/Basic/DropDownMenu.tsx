import React, { useEffect, useRef, useState } from 'react';

import { PropTypes } from 'prop-types';
import ShouldRender from './ShouldRender';

const DropDownMenu: Function = ({
    options,
    value,
    updateState,
    id,
    title
}: $TSFixMe) => {
    const [open, setOpen]: $TSFixMe = useState(false);
    const container: $TSFixMe = useRef(null);

    const handleClickOutside: Function = (event: $TSFixMe) => {

        if (container.current && !container.current.contains(event.target)) {
            setOpen(false);
        }
    };

    useEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            // clean up
            document.removeEventListener('mousedown', handleClickOutside);
        };
    });

    const onClick: Function = (val: $TSFixMe) => {
        setOpen(false);
        updateState(val);
    };

    return (
        <div className="ddm-container" ref={container}>
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                id={id}
                title={title}
                onClick={() => setOpen(!open)}
            >
                <div>{value}</div>
                <div className="caret-icon--down"></div>
            </button>
            {open && (
                <div className="ddm-dropdown-wrapper">
                    <ul className="ddm-dropdown-menu">
                        {options.map((data: $TSFixMe, index: $TSFixMe) => (
                            <ShouldRender key={index} if={data.show}>
                                <li
                                    className="ddm-dropdown-menu__item"
                                    onClick={() => onClick(data.value)}
                                >
                                    {data.value}
                                </li>
                            </ShouldRender>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

DropDownMenu.displayName = 'DropDownMenu';

DropDownMenu.propTypes = {
    options: PropTypes.array,
    value: PropTypes.string,
    updateState: PropTypes.func,
    id: PropTypes.string,
    title: PropTypes.string,
};

export default DropDownMenu;
