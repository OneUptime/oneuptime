import React, { useEffect, useRef, useState } from 'react';

import { PropTypes } from 'prop-types';
import Badge from '../common/Badge';

// Options should have the following structure for this dropdown for work fine

// [
//     {
//         projectName: 'name',
//         projectId: 'xyz',
//         components: [
//             {
//                 componentName: 'comp',
//                 componentId: 'xyz',
//                 monitors: [
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     },
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     },
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     }
//                 ]
//             },
//             {
//                 componentName: 'comp',
//                 componentId: 'xyz
//                 monitors: [
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     },
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     },
//                     {
//                         monitorName: 'mon',
//                         monitorId: 'zyx',
//                     }
//                 ]
//             }
//         ]
//     }
// ]

const MultiSelectDropDown = ({
    options,
    value,
    updateState,
    ready,
    selectedMonitors,
    selectedProjects,
    selectedComponents
}: $TSFixMe) => {
    const [open, setOpen] = useState(false);
    const container = useRef(null);

    const handleClickOutside = (event: $TSFixMe) => {

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

    const onClick = (val: $TSFixMe, key: $TSFixMe) => {
        // setOpen(false);
        updateState(val, key);
    };

    const menuStyle = {
        padding: '10px 15px',
    };

    return (
        <div
            className="ddm-container"
            ref={container}
            style={{ minWidth: 250, fontSize: 15, width: '100%' }}
        >
            <button
                type="button"
                className="bs-Button bs-DeprecatedButton ddm-button"
                onClick={() => setOpen(!open)}
                style={{ minWidth: 250, width: '100%' }}
                id="monitorDropdown"
            >
                <div style={{ fontWeight: 400 }}>{value}</div>
                <div className="caret-icon--down"></div>
            </button>
            {open && ready && (
                <div
                    className="ddm-dropdown-wrapper"
                    style={{ minWidth: 300, width: '100%' }}
                >
                    <div
                        className="ddm-dropdown-menu"
                        style={{ maxHeight: '26em', overflowY: 'auto' }}
                    >
                        {options && options.length > 0 && (
                            <section>
                                {options.map((data: $TSFixMe) => {
                                    const isProjectSelected = selectedProjects.includes(
                                        data.projectId
                                    );

                                    return (
                                        <div key={data.projectId}>
                                            <input
                                                type="checkbox"
                                                className="Checkbox-source"
                                                onChange={() => null}
                                                checked={isProjectSelected}

                                                tabIndex="-1"
                                            />
                                            <div
                                                className="Checkbox-box Box-root Margin-top--2 Margin-right--2 ddm-dropdown-menu__item"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    ...menuStyle,
                                                }}
                                                onClick={() =>
                                                    onClick(
                                                        data.projectId,
                                                        'selectedProjects'
                                                    )
                                                }
                                            >
                                                <div
                                                    className="Checkbox-target Box-root"
                                                    style={{
                                                        border:
                                                            '1px solid #fff',
                                                        marginRight: 15,
                                                    }}
                                                >
                                                    <div className="Checkbox-color Box-root"></div>
                                                </div>
                                                <Badge
                                                    color={'blue'}
                                                    fontSize={'10px'}
                                                >
                                                    Project
                                                </Badge>
                                                <span
                                                    className="db-MultiSelect-renderer-label"
                                                    style={{
                                                        marginLeft: 10,
                                                        cursor: 'pointer',
                                                        textTransform:
                                                            'capitalize',
                                                    }}
                                                >
                                                    {data.projectName}
                                                </span>
                                            </div>

                                            {data.components &&
                                                data.components.map(
                                                    (component: $TSFixMe) => {
                                                        const isComponentSelected = selectedComponents.includes(
                                                            component.componentId
                                                        );

                                                        return (
                                                            <div
                                                                key={
                                                                    component.componentId
                                                                }
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    className="Checkbox-source"
                                                                    onChange={() =>
                                                                        null
                                                                    }
                                                                    checked={
                                                                        isComponentSelected
                                                                    }

                                                                    tabIndex="-1"
                                                                />
                                                                <div
                                                                    className="Checkbox-box Box-root Margin-top--2 Margin-right--2 ddm-dropdown-menu__item"
                                                                    style={{
                                                                        display:
                                                                            'flex',
                                                                        alignItems:
                                                                            'center',
                                                                        ...menuStyle,
                                                                        paddingLeft: 30,
                                                                    }}
                                                                    onClick={() =>
                                                                        onClick(
                                                                            component.componentId,
                                                                            'selectedComponents'
                                                                        )
                                                                    }
                                                                >
                                                                    <div
                                                                        className="Checkbox-target Box-root"
                                                                        style={{
                                                                            border:
                                                                                '1px solid #fff',
                                                                            marginRight: 15,
                                                                        }}
                                                                    >
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                    <Badge
                                                                        color={
                                                                            'blue'
                                                                        }
                                                                        fontSize={
                                                                            '10px'
                                                                        }
                                                                    >
                                                                        Component
                                                                    </Badge>
                                                                    <span
                                                                        className="db-MultiSelect-renderer-label"
                                                                        style={{
                                                                            marginLeft: 10,
                                                                            cursor:
                                                                                'pointer',
                                                                            textTransform:
                                                                                'capitalize',
                                                                        }}
                                                                    >
                                                                        {
                                                                            component.componentName
                                                                        }
                                                                    </span>
                                                                </div>

                                                                {component.monitors &&
                                                                    component.monitors.map(
                                                                        (monitor: $TSFixMe) => {
                                                                            const isMonitorSelected = selectedMonitors.includes(
                                                                                monitor.monitorId
                                                                            );

                                                                            return (
                                                                                <div
                                                                                    key={
                                                                                        monitor.monitorId
                                                                                    }
                                                                                >
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        className="Checkbox-source"
                                                                                        onChange={() =>
                                                                                            null
                                                                                        }
                                                                                        checked={
                                                                                            isMonitorSelected
                                                                                        }

                                                                                        tabIndex="-1"
                                                                                    />
                                                                                    <div
                                                                                        className="Checkbox-box Box-root Margin-top--2 Margin-right--2 ddm-dropdown-menu__item"
                                                                                        style={{
                                                                                            display:
                                                                                                'flex',
                                                                                            alignItems:
                                                                                                'center',
                                                                                            ...menuStyle,
                                                                                            paddingLeft: 45,
                                                                                        }}
                                                                                        onClick={() =>
                                                                                            onClick(
                                                                                                monitor.monitorId,
                                                                                                'selectedMonitors'
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        <div
                                                                                            className="Checkbox-target Box-root"
                                                                                            style={{
                                                                                                border:
                                                                                                    '1px solid #fff',
                                                                                                marginRight: 15,
                                                                                            }}
                                                                                        >
                                                                                            <div className="Checkbox-color Box-root"></div>
                                                                                        </div>
                                                                                        <Badge
                                                                                            color={
                                                                                                'blue'
                                                                                            }
                                                                                            fontSize={
                                                                                                '10px'
                                                                                            }
                                                                                        >
                                                                                            Monitor
                                                                                        </Badge>
                                                                                        <span
                                                                                            className="db-MultiSelect-renderer-label"
                                                                                            style={{
                                                                                                marginLeft: 10,
                                                                                                cursor:
                                                                                                    'pointer',
                                                                                                textTransform:
                                                                                                    'capitalize',
                                                                                            }}
                                                                                            id={
                                                                                                monitor.monitorName
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                monitor.monitorName
                                                                                            }
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        }
                                                                    )}
                                                            </div>
                                                        );
                                                    }
                                                )}
                                        </div>
                                    );
                                })}
                            </section>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

MultiSelectDropDown.displayName = 'MultiSelectDropDown';

MultiSelectDropDown.propTypes = {
    options: PropTypes.array,
    value: PropTypes.string,
    updateState: PropTypes.func,
    ready: PropTypes.bool,
    selectedComponents: PropTypes.array,
    selectedProjects: PropTypes.array,
    selectedMonitors: PropTypes.array,
};

export default MultiSelectDropDown;
