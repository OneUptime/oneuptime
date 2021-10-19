import React, { useEffect, useRef, useState } from 'react';
import { PropTypes } from 'prop-types';

const DropDownMenu = ({ options, value, updateState, ready }) => {
    const [open, setOpen] = useState(false);
    const container = useRef(null);

    const handleClickOutside = event => {
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

    const onClick = val => {
        setOpen(false);
        updateState(val);
    };

    return (
        <div
            className="ddm-container"
            ref={container}
            style={{ minWidth: 200 }}
        >
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                onClick={() => setOpen(!open)}
                style={{ minWidth: 200 }}
            >
                <div id="filterToggle">{value}</div>
                <div className="caret-icon--down"></div>
            </button>
            {open && ready && (
                <div className="ddm-dropdown-wrapper" style={{ minWidth: 250 }}>
                    <ul className="ddm-dropdown-menu">
                        {options.map(data => (
                            <li
                                key={data.value}
                                className="ddm-dropdown-menu__item"
                                onClick={() => onClick(data.value)}
                            >
                                {data.label}
                            </li>
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
    ready: PropTypes.bool,
};

export default DropDownMenu;
