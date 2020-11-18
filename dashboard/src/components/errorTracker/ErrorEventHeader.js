import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import TooltipMini from '../basic/TooltipMini';

class ErrorEventHeader extends Component {
    navigate = currentId => {
        if (currentId) {
            this.props.navigationLink(currentId);
        }
        return;
    };
    render() {
        const { errorEvent, ignoreErrorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
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
                    <div className="Padding-vertical--20">
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
                                                    errorEventDetails.issueId &&
                                                    errorEventDetails.issueId
                                                        .name}
                                            </span>
                                        </span>
                                        <div className="Flex-flex Flex-alignItems--center">
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                    backgroundColor: `${ErrorEventUtil.getExceptionColor(
                                                        errorEventDetails &&
                                                            errorEventDetails
                                                                .issueId.type
                                                    )}`,
                                                    borderRadius: '50%',
                                                }}
                                            ></div>{' '}
                                            <span className="Text-fontSize--12 Margin-left--4">
                                                {errorEventDetails &&
                                                errorEventDetails.issueId &&
                                                errorEventDetails.issueId
                                                    .description
                                                    ? errorEventDetails.issueId
                                                          .description.length >
                                                      100
                                                        ? `${errorEventDetails.issueId.description.substring(
                                                              0,
                                                              100
                                                          )} ...`
                                                        : errorEventDetails
                                                              .issueId
                                                              .description
                                                    : ''}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="Flex-flex">
                                        <div className="Flex-flex Flex-direction--column Text-align--right Margin-horizontal--4">
                                            <span className="Text-fontSize--14">
                                                Events
                                            </span>
                                            <span className="Text-fontSize--20 Text-fontWeight--bold">
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
                                    </button>
                                    <TooltipMini
                                        title={
                                            errorEventDetails &&
                                            errorEventDetails.issueId.ignored
                                                ? 'Change Status to Unresolved'
                                                : ''
                                        }
                                        content={
                                            <button
                                                className="bs-Button bs-Button--icon bs-Button--block"
                                                type="button"
                                                onClick={() =>
                                                    ignoreErrorEvent(
                                                        errorEventDetails
                                                            .issueId._id
                                                    )
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        errorEventDetails &&
                                                        !errorEventDetails
                                                            .issueId.ignored
                                                    }
                                                >
                                                    <span>Ignore</span>
                                                </ShouldRender>
                                            </button>
                                        }
                                    />

                                    <button
                                        className="bs-Button"
                                        type="button"
                                        disabled={true}
                                    >
                                        <span>Merge</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="Flex-flex Flex-justifyContent--spaceBetween Navigator-Wrapper">
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
ErrorEventHeader.propTypes = {
    errorEvent: PropTypes.object,
    navigationLink: PropTypes.func,
};
ErrorEventHeader.displayName = 'ErrorEventHeader';
export default ErrorEventHeader;
