import React, { useEffect, useRef, useState } from 'react';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

const DropDownMenu = ({
    options,
    value,
    updateState,
    id
}: $TSFixMe) => {
    const [open, setOpen] = useState(false);
    const container = useRef(null);

    const handleClickOutside = (event: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
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

    const onClick = (val: $TSFixMe) => {
        setOpen(false);
        updateState(val);
    };

    return (
        <div className="ddm-container" ref={container}>
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                id={id}
                onClick={() => setOpen(!open)}
            >
                <div id="filterToggle">{value}</div>
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
                                    id={
                                        data.value === 'Clear Filters'
                                            ? 'clear'
                                            : data.value
                                    }
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
};

export default DropDownMenu;
