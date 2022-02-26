import React, { Component } from 'react';
import ErrorTrackerIssue from './ErrorTrackerIssue';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import DataPathHoC from '../DataPathHoC';
import ConfirmErrorTrackerIssueAction from '../modals/ConfirmErrorTrackerIssueAction';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import ErrorEventIssueMember from '../modals/ErrorEventIssueMember';
import ShouldRender from '../basic/ShouldRender';
import AlertPanel from '../basic/AlertPanel';

class ErrorTrackerDetailView extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            selectedErrorEvents: [],
            ignoreModalId: uuidv4(),
            memberModalId: uuidv4(),
        };
    }
    selectErrorEvent = (errorEventId: $TSFixMe) => {
        this.setState(state => ({
            selectedErrorEvents: this.removeOrAdd(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
                state.selectedErrorEvents,
                errorEventId
            ),
        }));
    };
    removeOrAdd(selectedErrorEvents: $TSFixMe, errorEventId: $TSFixMe) {
        let response;
        const index = selectedErrorEvents.indexOf(errorEventId);
        if (index === -1) {
            // it doesnt exist add it
            response = [...selectedErrorEvents, errorEventId];
        } else {
            // it exist, remove it
            response = selectedErrorEvents.filter((id: $TSFixMe) => id !== errorEventId);
        }
        return response;
    }
    selectAllErrorEvents = () => {
        let errorEventsId = [];
        // if the number of selected error events is different from the total number of available issues, select all ids and set it as the new selected array
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
            this.state.selectedErrorEvents.length !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerIssues' does not exist on ty... Remove this comment to see the full error message
            this.props.errorTrackerIssues.errorTrackerIssues.length
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerIssues' does not exist on ty... Remove this comment to see the full error message
            errorEventsId = this.props.errorTrackerIssues.errorTrackerIssues.map(
                (errorTrackerIssue: $TSFixMe) => errorTrackerIssue._id
            );
        }

        this.setState({
            selectedErrorEvents: errorEventsId,
        });
    };
    ignoreErrorEvent = (ignore: $TSFixMe) => {
        const promise = this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ignoreErrorEvent' does not exist on type... Remove this comment to see the full error message
            .ignoreErrorEvent(this.state.selectedErrorEvents, ignore)
            .then();
        this.setState({
            selectedErrorEvents: [],
        });
        return promise;
    };
    resolveErrorEvent = () => {
        const promise = this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveErrorEvent' does not exist on typ... Remove this comment to see the full error message
            .resolveErrorEvent(this.state.selectedErrorEvents)
            .then();
        this.setState({
            selectedErrorEvents: [],
        });
        return promise;
    };
    resolveSingleIssue = (issueId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveErrorEvent' does not exist on typ... Remove this comment to see the full error message
        const promise = this.props.resolveErrorEvent([issueId]).then();
        return promise;
    };
    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleNavigationButtonClick' does not ex... Remove this comment to see the full error message
        const { handleNavigationButtonClick } = this.props;
        handleNavigationButtonClick(skip ? parseInt(skip, 10) - 10 : 10, limit);
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleNavigationButtonClick' does not ex... Remove this comment to see the full error message
        const { handleNavigationButtonClick } = this.props;
        handleNavigationButtonClick(skip ? parseInt(skip, 10) + 10 : 10, limit);
    };
    openEventMemberModal = (errorTrackerIssue: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        const { openModal, updateErrorEventMember, teamMembers } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'memberModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { memberModalId } = this.state;

        openModal({
            id: memberModalId,
            onClose: () => '',
            onConfirm: () => this.resolveErrorEvent(),
            content: DataPathHoC(ErrorEventIssueMember, {
                errorTrackerIssue,
                updateErrorEventMember,
                allTeamMembers: teamMembers,
            }),
        });
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
        const { selectedErrorEvents, ignoreModalId } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerIssues' does not exist on ty... Remove this comment to see the full error message
            errorTrackerIssues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerStatus' does not exist on ty... Remove this comment to see the full error message
            errorTrackerStatus,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            slug,
        } = this.props;
        let skip =
            errorTrackerIssues && errorTrackerIssues.skip
                ? errorTrackerIssues.skip
                : null;
        let limit =
            errorTrackerIssues && errorTrackerIssues.limit
                ? errorTrackerIssues.limit
                : null;
        const count =
            errorTrackerIssues && errorTrackerIssues.count
                ? errorTrackerIssues.count
                : null;
        if (skip && typeof skip === 'string') {
            skip = parseInt(skip, 10);
        }
        if (limit && typeof limit === 'string') {
            limit = parseInt(limit, 10);
        }
        if (!skip) skip = 0;
        if (!limit) limit = 0;

        let canNext = count && count > skip + limit ? true : false;
        let canPrev = skip <= 0 ? false : true;

        if (
            errorTrackerIssues &&
            (errorTrackerIssues.requesting ||
                !errorTrackerIssues.errorTrackerIssues ||
                (errorTrackerIssues.errorTrackerIssues &&
                    errorTrackerIssues.errorTrackerIssues.length < 1))
        ) {
            canNext = false;
            canPrev = false;
        }

        return (
            <div>
                <ShouldRender
                    if={
                        errorTrackerIssues &&
                        errorTrackerIssues.errorTrackerIssues &&
                        errorTrackerIssues.errorTrackerIssues.length < 1
                    }
                >
                    <AlertPanel
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        id={`${errorTracker.name}-no-error-warning`}
                        message={
                            <span>
                                This Error Tracker is currently not reporting
                                any error, Click{' '}
                                <a
                                    rel="noopener noreferrer"
                                    href="https://github.com/OneUptime/feature-docs/blob/master/log.md"
                                    target="_blank"
                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                >
                                    {' '}
                                    here
                                </a>{' '}
                                to setup it up and start tracking errors.
                            </span>
                        }
                    />
                </ShouldRender>
                <div
                    style={{
                        overflow: 'hidden',
                        overflowX: 'auto',
                    }}
                >
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div
                                        className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexEnd Flex-alignItems--center"
                                        style={{
                                            height: '100%',
                                        }}
                                    >
                                        {errorTrackerIssues &&
                                        errorTrackerIssues.errorTrackerIssues ? (
                                            <input
                                                type="checkbox"
                                                checked={
                                                    this.state
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
                                                        .selectedErrorEvents
                                                        .length ===
                                                        errorTrackerIssues
                                                            .errorTrackerIssues
                                                            .length &&
                                                    this.state
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
                                                        .selectedErrorEvents
                                                        .length !== 0
                                                        ? true
                                                        : false
                                                }
                                                onClick={
                                                    this.selectAllErrorEvents
                                                }
                                            />
                                        ) : null}
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '350px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex">
                                        <button
                                            className="bs-Button bs-Button--icon bs-Button--check"
                                            type="button"
                                            disabled={
                                                selectedErrorEvents.length < 1
                                                    ? true
                                                    : false
                                            }
                                            onClick={() => {
                                                openModal({
                                                    id: ignoreModalId,
                                                    onClose: () => '',
                                                    onConfirm: () =>
                                                        this.resolveErrorEvent(),
                                                    content: DataPathHoC(
                                                        ConfirmErrorTrackerIssueAction,
                                                        {
                                                            action: 'resolve',
                                                            actionTitle:
                                                                'Resolution',
                                                            count:
                                                                selectedErrorEvents.length,
                                                            errorTrackerId:
                                                                errorTracker._id,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Resolve</span>
                                        </button>
                                        {errorTrackerIssues &&
                                            errorTrackerIssues.errorTrackerIssues.map(
                                                (e: $TSFixMe) => {
                                                    return e.ignored ===
                                                        false ? (
                                                        <button
                                                            className="bs-Button bs-Button--icon bs-Button--block"
                                                            type="button"
                                                            disabled={
                                                                selectedErrorEvents.length <
                                                                1
                                                                    ? true
                                                                    : false
                                                            }
                                                            onClick={() => {
                                                                openModal({
                                                                    id: ignoreModalId,
                                                                    onClose: () =>
                                                                        '',
                                                                    onConfirm: () =>
                                                                        this.ignoreErrorEvent(
                                                                            'ignore'
                                                                        ),
                                                                    content: DataPathHoC(
                                                                        ConfirmErrorTrackerIssueAction,
                                                                        {
                                                                            action:
                                                                                'ignore',
                                                                            actionTitle:
                                                                                'Ignore',
                                                                            count:
                                                                                selectedErrorEvents.length,
                                                                            errorTrackerId:
                                                                                errorTracker._id,
                                                                        }
                                                                    ),
                                                                });
                                                            }}
                                                        >
                                                            <span>Ignore</span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="bs-Button bs-Button--icon bs-Button--block"
                                                            type="button"
                                                            disabled={
                                                                selectedErrorEvents.length <
                                                                1
                                                                    ? true
                                                                    : false
                                                            }
                                                            onClick={() => {
                                                                openModal({
                                                                    id: ignoreModalId,
                                                                    onClose: () =>
                                                                        '',
                                                                    onConfirm: () =>
                                                                        this.ignoreErrorEvent(
                                                                            'unignore'
                                                                        ),
                                                                    content: DataPathHoC(
                                                                        ConfirmErrorTrackerIssueAction,
                                                                        {
                                                                            action:
                                                                                'unignore',
                                                                            actionTitle:
                                                                                'Unignore',
                                                                            count:
                                                                                selectedErrorEvents.length,
                                                                            errorTrackerId:
                                                                                errorTracker._id,
                                                                        }
                                                                    ),
                                                                });
                                                            }}
                                                        >
                                                            <span>
                                                                Unignore
                                                            </span>
                                                        </button>
                                                    );
                                                }
                                            )}
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--spaceBetween">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Graph</span>
                                        </span>
                                        <div className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-wrap--wrap">
                                            <span className="Padding-right--8">
                                                24h
                                            </span>
                                            <span className="Text-color--slate">
                                                14d
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Events</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Assigned To</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {errorTrackerIssues &&
                            errorTrackerIssues.errorTrackerIssues &&
                            errorTrackerIssues.errorTrackerIssues.length > 0 ? (
                                errorTrackerIssues.errorTrackerIssues.map(
                                    (errorTrackerIssue: $TSFixMe, i: $TSFixMe) => {
                                        return (
                                            <ErrorTrackerIssue
                                                errorTrackerIssue={
                                                    errorTrackerIssue
                                                }
                                                errorTracker={errorTracker}
                                                key={i}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ errorTrackerIssue: any; errorTracker: any;... Remove this comment to see the full error message
                                                projectId={projectId}
                                                componentId={componentId}
                                                selectErrorEvent={
                                                    this.selectErrorEvent
                                                }
                                                selectedErrorEvents={
                                                    this.state
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedErrorEvents' does not exist on t... Remove this comment to see the full error message
                                                        .selectedErrorEvents
                                                }
                                                openEventMemberModal={
                                                    this.openEventMemberModal
                                                }
                                                resolveSingleIssue={
                                                    this.resolveSingleIssue
                                                }
                                                errorTrackerStatus={
                                                    errorTrackerStatus
                                                }
                                                slug={slug}
                                                componentSlug={componentSlug}
                                            />
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                    {errorTrackerIssues && errorTrackerIssues.requesting ? (
                        <ListLoader />
                    ) : null}
                </div>
                <div
                    style={{
                        textAlign: 'center',
                        padding: '10px',
                    }}
                >
                    {!errorTrackerIssues ||
                    (errorTrackerIssues &&
                        (!errorTrackerIssues.errorTrackerIssues ||
                            !errorTrackerIssues.errorTrackerIssues.length) &&
                        !errorTrackerIssues.requesting &&
                        !errorTrackerIssues.error)
                        ? "We don't have any tracked error event yet"
                        : null}
                    {errorTrackerIssues && errorTrackerIssues.error
                        ? errorTrackerIssues.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {count
                                        ? count +
                                          (count > 1 ? ' Issues' : ' Issue')
                                        : '0 Issues'}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() => {
                                        this.prevClicked(skip, limit);
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canPrev ? '' : 'Is--disabled')
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
                            <div className="Box-root">
                                <button
                                    id="btnNext"
                                    onClick={() => {
                                        this.nextClicked(skip, limit);
                                    }}
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canNext ? '' : 'Is--disabled')
                                    }
                                    disabled={!canNext}
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
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    // get current error event tracker
    const errorTracker = ownProps.errorTracker;
    // get its list of error tracker issues
    const errorTrackerIssues =
        state.errorTracker.errorTrackerIssues[errorTracker._id];
    const { teamMembers } = ownProps;

    if (errorTrackerIssues) {
        errorTrackerIssues.errorTrackerIssues.map((errorTrackerIssue: $TSFixMe) => {
            const issueMembers = errorTrackerIssue.members;
            const differentialTeamMember: $TSFixMe = [];
            teamMembers.forEach((teamMember: $TSFixMe) => {
                const exist = issueMembers.filter(
                    (issueMember: $TSFixMe) => issueMember.userId._id === teamMember.userId
                );
                if (exist.length < 1) {
                    differentialTeamMember.push(teamMember);
                }
            });
            errorTrackerIssue.memberNotAssignedToIssue = differentialTeamMember;
            return errorTrackerIssue;
        });
    }
    return {
        errorTrackerIssues,
        errorTrackerStatus:
            state.errorTracker.errorTrackerStatus[errorTracker._id],
    };
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ErrorTrackerDetailView.propTypes = {
    errorTrackerIssues: PropTypes.object,
    errorTracker: PropTypes.object,
    projectId: PropTypes.string,
    slug: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    handleNavigationButtonClick: PropTypes.string,
    ignoreErrorEvent: PropTypes.func,
    resolveErrorEvent: PropTypes.string,
    openModal: PropTypes.func,
    updateErrorEventMember: PropTypes.func,
    teamMembers: PropTypes.array,
    errorTrackerStatus: PropTypes.object,
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorTrackerDetailView.displayName = 'ErrorTrackerDetailView';
export default connect(mapStateToProps, null)(ErrorTrackerDetailView);
