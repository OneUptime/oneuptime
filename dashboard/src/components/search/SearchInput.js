import React, { useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { RenderSearchField } from '../basic/RenderSearchField';
import ShouldRender from '../basic/ShouldRender';
import { CircleIcon, DashIcon } from '../svg';
import PropTypes from 'prop-types';
import { searchLog, fetchLogs } from '../../actions/applicationLog';
import { RenderField } from '../basic/RenderField';

const SearchInput = props => {
    const [open, setOpen] = useState(false);
    const container = useRef(null);
    const [error, setError] = useState(null);

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

    const items = [
        {
            time: 'Last 30 minutes',
            timeDiff: -30, // subtract 30 minutes
        },
        {
            time: 'Last 60 minutes',
            timeDiff: -60, // subtract 60 minutes
        },
        {
            time: 'Last 3 hours',
            timeDiff: -180, // subtract 180 minutes
        },
        {
            time: 'Last 6 hours',
            timeDiff: -360, // subtract 360 minutes
        },
        {
            time: 'Last 12 hours',
            timeDiff: -720, // subtract 720 minutes
        },
        {
            time: 'Last 24 hours',
            timeDiff: -1440, // subtract 1440 minutes
        },
        {
            time: 'Last 2 days',
            timeDiff: -2880, // subtract 2880 minutes
        },
        {
            time: 'Last 7 days',
            timeDiff: -10080, // subtract 10080 minutes
        },
        {
            time: 'Last 14 days',
            timeDiff: -20160, // subtract 20160 minutes
        },
        {
            time: 'Last 30 days',
            timeDiff: -302400, // subtract 302400 minutes
        },
        {
            time: 'Everything',
            timeDiff: -302400, // subtract 302400 minutes
        },
        {
            time: 'Custom',
        },
    ];

    const fetchLogs = () => {
        const { projectId, componentId, applicationLogId } = props;
        props.fetchLogs(projectId, componentId, applicationLogId, 0, 10);
        props.setDisplay(null);
        setOpen(false);
    };

    const handleSearch = (val, bool) => {
        const { projectId, componentId, applicationLogId } = props;
        if (!val) {
            fetchLogs();
        }
        if (typeof val === 'object') {
            const testRegex = /^now(-\d{1,2}h)?$/;
            if (!testRegex.test(val.log_from) || !testRegex.test(val.log_to)) {
                setError('The input does not match format');
            } else {
                const log_from = val.log_from.split('-');
                const log_to = val.log_to.split('-');
                const nowDate = new Date();
                const extendFrom = log_from[1]
                    ? log_from[1].split('h').join('')
                    : 0;
                const extendTo = log_to[1] ? log_to[1].split('h').join('') : 0;
                const payload = {};
                payload.log_from = new Date(
                    nowDate.getTime() - extendFrom * 60 * 60000
                );
                payload.log_to = new Date(
                    nowDate.getTime() - extendTo * 60 * 60000
                );
                if (payload.log_from > payload.log_to) {
                    setError(`'From' time should be lesser than 'To' time`);
                    return;
                }
                props.searchLog(projectId, componentId, applicationLogId, {
                    range: payload,
                });
                props.setDisplay(`${val.log_from} to ${val.log_to}`);
                setOpen(false);
            }
        } else {
            if (bool) {
                if (val.length > 0) {
                    props.searchLog(projectId, componentId, applicationLogId, {
                        filter: val,
                    });
                }
                props.setDisplay(val);
            } else {
                props.searchLog(projectId, componentId, applicationLogId, {
                    duration: val,
                });
                const { time } = items.find(
                    item => String(item.timeDiff) === String(val)
                );
                props.setDisplay(`The ${time}`);
            }
            setOpen(false);
        }
    };

    const setAutoFocus = () => {
        document.getElementById('log_from_id').focus();
    };

    return (
        <div className="bs-search-log-frame">
            <div ref={container} className="bs-flex-log">
                <Field
                    className="db-BusinessSettings-input TextInput bs-TextInput search-input bs-flex-log bs-log-bg"
                    component={RenderSearchField}
                    type="text"
                    name="search"
                    id="search"
                    placeholder="Search for logs"
                    autofilled={'off'}
                    parentStyle={{
                        border: '1px solid rgba(147,157,184,1)',
                        borderRadius: '5px',
                        borderTopRightRadius: '2px',
                        borderBottomRightRadius: '2px',
                        height: '40px',
                        background: '#202839 !important',
                    }}
                    iconRight={true}
                    frame={true}
                    onChange={(e, newValue) => handleSearch(newValue, true)}
                    style={{
                        boxShadow: 'none',
                        width: '290px',
                    }}
                    handleFocus={() => setOpen(true)}
                    onFrameClick={() => {
                        setOpen(true);
                        props.reset('searchlog');
                        setError(null);
                    }}
                    display={props.display}
                    handleIconClick={() => {
                        fetchLogs();
                        props.reset('searchlog');
                    }}
                />
                <ShouldRender if={open}>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            position: 'relative',
                        }}
                    >
                        <div className="ddm-dropdown-log">
                            <div className="bs-log-display">
                                <div>
                                    <div className="bs-relative">RELATIVE</div>
                                    <ul>
                                        {items.length > 0 &&
                                            items.map((item, index) => (
                                                <li
                                                    key={index}
                                                    onClick={() =>
                                                        item.time ===
                                                        'Everything'
                                                            ? fetchLogs()
                                                            : item.timeDiff
                                                            ? handleSearch(
                                                                  item.timeDiff
                                                              )
                                                            : setAutoFocus()
                                                    }
                                                >
                                                    {item.time}
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                                <div>
                                    <div className="bs-custom-log">CUSTOM</div>
                                    <form
                                        onSubmit={props.handleSubmit(
                                            handleSearch
                                        )}
                                    >
                                        <div className="log-custom-form">
                                            <div className="bs-log-where">
                                                <label>From</label>
                                                <div>
                                                    <Field
                                                        component={RenderField}
                                                        type="text"
                                                        className="bs-log-field"
                                                        placeholder="e.g: now-3h"
                                                        name="log_from"
                                                        id="log_from_id"
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-icon-log">
                                                <CircleIcon className="bs-icon-log-r" />
                                                <DashIcon />
                                                <span className="bs-icon-log-l">
                                                    ●
                                                </span>
                                            </div>
                                            <div className="bs-log-where">
                                                <label>To</label>
                                                <div>
                                                    <Field
                                                        component={RenderField}
                                                        type="text"
                                                        className="bs-log-field"
                                                        placeholder="e.g: now"
                                                        name="log_to"
                                                        id="log_to_id"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <button className="bs-log-apply">
                                                    Apply
                                                </button>
                                            </div>
                                        </div>
                                        <ShouldRender if={error}>
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{
                                                    marginTop: '15px',
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <div
                                                    className="Box-root Margin-right--8"
                                                    style={{ marginTop: '2px' }}
                                                >
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        id="monitorError"
                                                        style={{
                                                            color: '#f02b1d',
                                                        }}
                                                    >
                                                        {error}
                                                    </span>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </div>
            {/* <div className="bs-time-log">
                <TimeFilledIcon />
            </div> */}
        </div>
    );
};

const SearchInputForm = new reduxForm({
    form: 'searchlog',
    enableReinitialize: true,
})(SearchInput);

SearchInput.propTypes = {
    searchLog: PropTypes.func,
    fetchLogs: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationLogId: PropTypes.string,
    setDisplay: PropTypes.func,
    reset: PropTypes.func,
    display: PropTypes.string,
    handleSubmit: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ searchLog, fetchLogs }, dispatch);

export default connect(null, mapDispatchToProps)(SearchInputForm);
