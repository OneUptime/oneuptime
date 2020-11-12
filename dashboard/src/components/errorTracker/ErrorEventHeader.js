import React, { Component } from 'react';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import moment from 'moment';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';

class ErrorEventHeader extends Component {
    navigate = currentId => {
        if (currentId) {
            this.props.navigationLink(currentId);
        }
        return;
    };
    render() {
        const { errorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        console.log(errorEvent);
        console.log(errorEventDetails);
        return (
            <div>
                <ShouldRender if={errorEvent.requesting}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender
                    if={
                        !errorEvent.requesting &&
                        errorEventDetails &&
                        errorEventDetails.content
                    }
                >
                    <div>
                        <div className="db-Trends-title">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span
                                            id="application-content-header"
                                            className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                        >
                                            <span id={`application-log-title-`}>
                                                {errorEventDetails &&
                                                    errorEventDetails.content &&
                                                    errorEventDetails.content
                                                        .type}
                                            </span>
                                        </span>
                                        <div className="Flex-flex Flex-alignItems--center">
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                    backgroundColor: `${ErrorEventUtil.getExceptionColor(
                                                        errorEventDetails &&
                                                            errorEventDetails.type
                                                    )}`,
                                                    borderRadius: '50%',
                                                }}
                                            ></div>{' '}
                                            <span className="Text-fontSize--12 Margin-left--4">
                                                {errorEventDetails &&
                                                    errorEventDetails.content &&
                                                    errorEventDetails.content
                                                        .message}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="Flex-flex">
                                        <div className="Flex-flex Flex-direction--column Text-align--right Margin-horizontal--4">
                                            <span className="Text-fontSize--11">
                                                Events
                                            </span>
                                            <span
                                                className="Text-fontSize--14"
                                                style={{
                                                    color: 'blue',
                                                }}
                                            >
                                                {errorEvent.totalEvents}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="db-ListViewItem-cellContent Box-root Padding-vertical--8 Flex-flex">
                                    <button
                                        className="bs-Button bs-Button--icon bs-Button--check"
                                        type="button"
                                    >
                                        <span>Resolve</span>
                                        <img
                                            src="/dashboard/assets/img/down.svg"
                                            alt=""
                                            style={{
                                                margin: '0px 10px',
                                                height: '10px',
                                                width: '10px',
                                            }}
                                        />
                                    </button>
                                    <button
                                        className="bs-Button bs-Button--icon bs-Button--block"
                                        type="button"
                                    >
                                        <span>Ignore</span>
                                        <img
                                            src="/dashboard/assets/img/down.svg"
                                            alt=""
                                            style={{
                                                margin: '0px 10px',
                                                height: '10px',
                                                width: '10px',
                                            }}
                                        />
                                    </button>
                                    <button
                                        className="bs-Button"
                                        type="button"
                                        disabled={true}
                                    >
                                        <span>Merge</span>
                                    </button>
                                    <span className="Margin-left--8">
                                        <Dropdown>
                                            <Dropdown.Toggle
                                                id="filterToggle"
                                                className="bs-Button bs-DeprecatedButton"
                                            />
                                            <Dropdown.Menu>
                                                <MenuItem title="clear">
                                                    Clear Filters
                                                </MenuItem>
                                                <MenuItem title="unacknowledged">
                                                    Unacknowledged
                                                </MenuItem>
                                                <MenuItem title="unresolved">
                                                    Unresolved
                                                </MenuItem>
                                            </Dropdown.Menu>
                                        </Dropdown>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                            <div className="Flex-flex Flex-direction--column">
                                <span>
                                    <span className="Text-fontWeight--bold">
                                        Event
                                    </span>
                                    <span>
                                        {' '}
                                        {errorEventDetails &&
                                            errorEventDetails._id}{' '}
                                    </span>
                                </span>
                                <span>
                                    {errorEventDetails &&
                                        moment(
                                            errorEventDetails.createdAt
                                        ).format('MMMM Do YYYY, h:mm:ss a')}
                                </span>
                            </div>
                            <div className="Navigator-Btn-Group Text-fontWeight--bold Text-fontSize--12">
                                <div
                                    className={`${
                                        errorEvent.previous
                                            ? 'Navigator-Oldest'
                                            : 'Navigator-Oldest Navigator-Disable'
                                    }`}
                                    onClick={() =>
                                        this.navigate(
                                            errorEvent.previous
                                                ? errorEvent.previous.oldest
                                                : null
                                        )
                                    }
                                >
                                    <img
                                        src={`/dashboard/assets/img/previous${
                                            errorEvent.previous
                                                ? ''
                                                : '-disable'
                                        }.svg`}
                                        alt=""
                                        style={{
                                            height: '12px',
                                            width: '12px',
                                        }}
                                    />
                                </div>
                                <div
                                    onClick={() =>
                                        this.navigate(
                                            errorEvent.previous
                                                ? errorEvent.previous._id
                                                : null
                                        )
                                    }
                                    className={`${
                                        errorEvent.previous
                                            ? ''
                                            : 'Navigator-Disable'
                                    }`}
                                >
                                    Older
                                </div>
                                <div
                                    onClick={() =>
                                        this.navigate(
                                            errorEvent.next
                                                ? errorEvent.next._id
                                                : null
                                        )
                                    }
                                    className={`${
                                        errorEvent.next
                                            ? ''
                                            : 'Navigator-Disable'
                                    }`}
                                >
                                    Newer
                                </div>
                                <div
                                    onClick={() =>
                                        this.navigate(
                                            errorEvent.next
                                                ? errorEvent.next.latest
                                                : null
                                        )
                                    }
                                    className={`${
                                        errorEvent.next
                                            ? 'Navigator-Newest'
                                            : 'Navigator-Newest Navigator-Disable'
                                    }`}
                                >
                                    <img
                                        src={`/dashboard/assets/img/next${
                                            errorEvent.next ? '' : '-disable'
                                        }.svg`}
                                        alt=""
                                        style={{
                                            height: '12px',
                                            width: '12px',
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </div>
        );
    }
}
const mapStateToProps = (state, ownProps) => {
    const errorEventId = ownProps.errorEvent.errorEvent
        ? ownProps.errorEvent.errorEvent._id
        : '';
    let errorEvent = {};
    const errorEvents = state.errorTracker.errorEvents;
    if (errorEvents) {
        for (const errorEventKey in errorEvents) {
            if (errorEventKey === errorEventId && errorEvents[errorEventKey]) {
                errorEvent = errorEvents[errorEventKey];
            }
        }
    }
    return {
        errorEventsss: errorEvent,
    };
};
ErrorEventHeader.propTypes = {
    errorEvent: PropTypes.object,
    navigationLink: PropTypes.func,
};
ErrorEventHeader.displayName = 'ErrorEventHeader';
export default connect(mapStateToProps)(ErrorEventHeader);
