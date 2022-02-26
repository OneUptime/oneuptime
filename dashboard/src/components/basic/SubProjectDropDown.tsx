import React, { useEffect, useRef, useState } from 'react';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';

const DropDownMenu = ({
    options,
    value,
    updateState,
    ready,
    showMainProject
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

    const sectionStyle = {
        display: 'inline-block',
        padding: '10px 15px 0px',
        fontWeight: 500,
        color: '#6b7c93',
    };

    const menuStyle = {
        padding: '10px 25px',
    };

    return (
        <div
            className="ddm-container"
            ref={container}
            style={{ minWidth: 250, fontSize: 15 }}
        >
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                onClick={() => setOpen(!open)}
                style={{ minWidth: 250 }}
            >
                <div id="projectFilterToggle">{value}</div>
                <div className="caret-icon--down"></div>
            </button>
            {open && ready && (
                <div className="ddm-dropdown-wrapper" style={{ minWidth: 300 }}>
                    <div
                        className="ddm-dropdown-menu"
                        style={{ maxHeight: '26em', overflowY: 'auto' }}
                    >
                        {showMainProject && (
                            <section>
                                <span style={sectionStyle}>Main Project</span>
                                <span
                                    key={options[0]?.value}
                                    className="ddm-dropdown-menu__item"
                                    onClick={() => onClick(options[0]?.value)}
                                    style={menuStyle}
                                    id={`project-${options[0]?.label}`}
                                >
                                    {options[0]?.label}
                                </span>
                            </section>
                        )}
                        {options && options.length > 1 && (
                            <section>
                                <span style={sectionStyle}>Sub Projects</span>
                                {options.map((data: $TSFixMe, index: $TSFixMe) =>
                                    index === 0 ? null : (
                                        <span
                                            key={data.value}
                                            className="ddm-dropdown-menu__item"
                                            onClick={() => onClick(data.value)}
                                            style={menuStyle}
                                            id={`project-${data.label}`}
                                        >
                                            {data.label}
                                        </span>
                                    )
                                )}
                            </section>
                        )}
                    </div>
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
    showMainProject: PropTypes.bool,
};

export default DropDownMenu;
