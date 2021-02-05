import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import ErrorEventUtil from '../../utils/ErrorEventUtil';
import moment from 'moment';
import { ListLoader, FormLoader2 } from '../basic/Loader';
import TooltipMini from '../basic/TooltipMini';

class ErrorEventHeader extends Component {
    navigate = currentId => {
        if (currentId) {
            this.props.navigationLink(currentId);
        }
        return;
    };
    handleIgnoreButton = errorTrackerIssue => {
        const { ignoreErrorEvent } = this.props;
        if (!errorTrackerIssue.ignored) {
            ignoreErrorEvent(errorTrackerIssue._id);
        } else {
            ignoreErrorEvent(errorTrackerIssue._id, true); // set this to true to unresolve an ignored Issue
        }
    };
    handleResolveButton = errorTrackerIssue => {
        const { resolveErrorEvent, unresolveErrorEvent } = this.props;
        if (!errorTrackerIssue.resolved) {
            resolveErrorEvent(errorTrackerIssue._id);
        } else {
            unresolveErrorEvent(errorTrackerIssue._id);
        }
    };
    render() {
        const {
            errorEvent,
            errorTrackerIssue,
            errorTrackerStatus,
        } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        const canPrev = errorEvent.previous;
        const canNext = errorEvent.next;
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
                                            <span id={`error-event-title-`}>
                                                {errorTrackerIssue &&
                                                errorTrackerIssue.description
                                                    ? errorTrackerIssue
                                                          .description.length >
                                                      100
                                                        ? `${errorTrackerIssue.description.substring(
                                                              0,
                                                              100
                                                          )} ...`
                                                        : errorTrackerIssue.description
                                                    : ''}
                                            </span>
                                        </span>
                                        <div className="Flex-flex Flex-alignItems--center">
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                    backgroundColor: `${ErrorEventUtil.getExceptionColor(
                                                        errorTrackerIssue &&
                                                            errorTrackerIssue.type
                                                    )}`,
                                                    borderRadius: '50%',
                                                }}
                                            ></div>{' '}
                                            <span className="Text-fontSize--12 Margin-left--4">
                                                {errorTrackerIssue &&
                                                    errorTrackerIssue.name}
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
                                    <TooltipMini
                                        title={
                                            errorTrackerIssue &&
                                            errorTrackerIssue.resolved
                                                ? ''
                                                : 'Unresolved'
                                        }
                                        content={
                                            <button
                                                className={`bs-Button ${
                                                    errorTrackerStatus &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ] &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ].requestingResolve
                                                        ? ''
                                                        : 'bs-Button--icon bs-Button--check'
                                                }  `}
                                                type="button"
                                                onClick={() =>
                                                    this.handleResolveButton(
                                                        errorTrackerIssue
                                                    )
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        errorTrackerIssue &&
                                                        !errorTrackerIssue.resolved
                                                    }
                                                >
                                                    {errorTrackerStatus &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ] &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ].requestingResolve ? (
                                                        <FormLoader2 />
                                                    ) : (
                                                        <span>Resolve</span>
                                                    )}
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        errorTrackerIssue &&
                                                        errorTrackerIssue.resolved
                                                    }
                                                >
                                                    {errorTrackerStatus &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ] &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ].requestingResolve ? (
                                                        <FormLoader2 />
                                                    ) : (
                                                        <span>Unresolve</span>
                                                    )}
                                                </ShouldRender>
                                            </button>
                                        }
                                    />
                                    <TooltipMini
                                        title={
                                            errorTrackerIssue &&
                                            errorTrackerIssue.ignored
                                                ? 'Change Status to Unresolved'
                                                : ''
                                        }
                                        content={
                                            <button
                                                className={`bs-Button ${
                                                    errorTrackerStatus &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ] &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ].requestingIgnore
                                                        ? ''
                                                        : 'bs-Button--icon bs-Button--block'
                                                }  `}
                                                type="button"
                                                onClick={() =>
                                                    this.handleIgnoreButton(
                                                        errorTrackerIssue
                                                    )
                                                }
                                            >
                                                <ShouldRender
                                                    if={errorTrackerIssue}
                                                >
                                                    {errorTrackerStatus &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ] &&
                                                    errorTrackerStatus[
                                                        errorTrackerIssue._id
                                                    ].requestingIgnore ? (
                                                        <FormLoader2 />
                                                    ) : (
                                                        <ShouldRender
                                                            if={
                                                                errorTrackerIssue &&
                                                                !errorTrackerIssue.ignored
                                                            }
                                                        >
                                                            <span>Ignore</span>
                                                        </ShouldRender>
                                                    )}
                                                </ShouldRender>
                                            </button>
                                        }
                                    />
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
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevOldest"
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev ? '' : 'Is--disabled')
                                            }
                                            disabled={!canPrev}
                                            onClick={() =>
                                                this.navigate(
                                                    errorEvent.previous
                                                        ? errorEvent.previous
                                                              .oldest
                                                        : null
                                                )
                                            }
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
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
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrev"
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev ? '' : 'Is--disabled')
                                            }
                                            onClick={() =>
                                                this.navigate(
                                                    errorEvent.previous
                                                        ? errorEvent.previous
                                                              ._id
                                                        : null
                                                )
                                            }
                                            disabled={!canPrev}
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Previous</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnNext"
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext ? '' : 'Is--disabled')
                                            }
                                            disabled={!canNext}
                                            onClick={() =>
                                                this.navigate(
                                                    errorEvent.next
                                                        ? errorEvent.next._id
                                                        : null
                                                )
                                            }
                                            data-db-analytics-name="list_view.pagination.next"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Next</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button
                                            id="btnNextLatest"
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext ? '' : 'Is--disabled')
                                            }
                                            onClick={() =>
                                                this.navigate(
                                                    errorEvent.next
                                                        ? errorEvent.next.latest
                                                        : null
                                                )
                                            }
                                            disabled={!canNext}
                                            data-db-analytics-name="list_view.pagination.next"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <img
                                                        src={`/dashboard/assets/img/next${
                                                            errorEvent.next
                                                                ? ''
                                                                : '-disable'
                                                        }.svg`}
                                                        alt=""
                                                        style={{
                                                            height: '12px',
                                                            width: '12px',
                                                        }}
                                                    />
                                                </span>
                                            </div>
                                        </button>
                                    </div>
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
    errorTrackerIssue: PropTypes.object,
    ignoreErrorEvent: PropTypes.func,
    unresolveErrorEvent: PropTypes.func,
    resolveErrorEvent: PropTypes.func,
    errorTrackerStatus: PropTypes.object,
};
ErrorEventHeader.displayName = 'ErrorEventHeader';
export default ErrorEventHeader;
