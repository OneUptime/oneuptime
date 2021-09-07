import React, { useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { RenderSearchField } from '../basic/RenderSearchField';
import ShouldRender from '../basic/ShouldRender';
import { TimeIcon } from '../svg';
import PropTypes from 'prop-types';
import { searchLog, fetchLogs } from '../../actions/applicationLog';

const SearchInput = props => {
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

    const items = [
        {
            time: 'last 30 minutes',
            content: 'This will display logs for the last 30 minutes',
            timeDiff: -30, // subtract 30 minutes
        },
        {
            time: 'last 60 minutes',
            content: 'This will display logs for the last 60 minutes',
            timeDiff: -60, // subtract 60 minutes
        },
        {
            time: 'last 3 hours',
            content: 'This will display logs for the last 3 hours',
            timeDiff: -180, // subtract 180 minutes
        },
        {
            time: 'last 6 hours',
            content: 'This will display logs for the last 6 hours',
            timeDiff: -360, // subtract 360 minutes
        },
        {
            time: 'last 12 hours',
            content: 'This will display logs for the last 12 hours',
            timeDiff: -720, // subtract 720 minutes
        },
        {
            time: 'last 24 hours',
            content: 'This will display logs for the last 24 hours',
            timeDiff: -1440, // subtract 1440 minutes
        },
        {
            time: 'last 1 week',
            content: 'This will display logs for the last 1 week',
            timeDiff: -10080, // subtract 10080 minutes
        },
        {
            time: 'last 1 month',
            content: 'This will display logs for the last 1 month',
            timeDiff: -302400, // subtract 302400 minutes
        },
    ];

    const fetchLogs = () => {
        const { projectId, componentId, applicationLogId } = props;
        props.fetchLogs(projectId, componentId, applicationLogId, 0, 10);
        props.setDisplay(null);
    };

    const handleSearch = (val, bool) => {
        const { projectId, componentId, applicationLogId } = props;
        if (!val) {
            fetchLogs();
        }
        if (bool) {
            if (val.length > 0) {
                props.searchLog(projectId, componentId, applicationLogId, {
                    filter: val,
                });
            }
            props.setDisplay(val);
        } else {
            props.searchLog(projectId, componentId, applicationLogId, {
                time: val,
            });
            const { time } = items.find(
                item => String(item.timeDiff) === String(val)
            );
            props.setDisplay(`The ${time}`);
        }
        setOpen(false);
    };

    return (
        <div ref={container}>
            <Field
                className="db-BusinessSettings-input TextInput bs-TextInput search-input"
                component={RenderSearchField}
                type="text"
                name="search"
                id="search"
                placeholder="Search for logs"
                autofilled={'off'}
                parentStyle={{
                    border: '1px solid rgba(147,157,184,1)',
                    borderRadius: '5px',
                    paddingLeft: '5px',
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
                    props.setDisplay(null);
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
                        {items.length > 0 &&
                            items.map((item, index) => (
                                <div
                                    className="bs-search-item"
                                    key={index}
                                    onClick={() => handleSearch(item.timeDiff)}
                                >
                                    <div>
                                        <TimeIcon /> <span>{item.time}</span>
                                    </div>
                                    <div>{item.content}</div>
                                </div>
                            ))}
                    </div>
                </div>
            </ShouldRender>
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
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ searchLog, fetchLogs }, dispatch);

export default connect(null, mapDispatchToProps)(SearchInputForm);
