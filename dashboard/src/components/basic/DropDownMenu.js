import React, { useEffect, useRef, useState } from 'react';
import { PropTypes } from 'prop-types';

const DropDownMenu = ({ options, value, updateState }) => {
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
        <div className="ddm-container" ref={container}>
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                onClick={() => setOpen(!open)}
            >
                <div>{value}</div>
                <div className="caret-icon--down"></div>
            </button>
            {open && (
                <div className="ddm-dropdown-wrapper">
                    <ul className="ddm-dropdown-menu">
                        {options.map((val, index) => (
                            <li
                                key={index}
                                className="ddm-dropdown-menu__item"
                                onClick={() => onClick(val)}
                            >
                                {val}
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
};

export default DropDownMenu;
