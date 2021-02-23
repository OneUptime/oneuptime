import React, { Component } from 'react';
import ErrorTrackerIssue from './ErrorTrackerIssue';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import DataPathHoC from '../DataPathHoC';
import ConfirmErrorTrackerIssueAction from '../modals/ConfirmErrorTrackerIssueAction';
import uuid from 'uuid';
import ErrorEventIssueMember from '../modals/ErrorEventIssueMember';
import ShouldRender from '../basic/ShouldRender';
import AlertPanel from '../basic/AlertPanel';

class ErrorTrackerDetailView extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            selectedErrorEvents: [],
            ignoreModalId: uuid.v4(),
            memberModalId: uuid.v4(),
        };
    }
    selectErrorEvent = errorEventId => {
        this.setState(state => ({
            selectedErrorEvents: this.removeOrAdd(
                state.selectedErrorEvents,
                errorEventId
            ),
        }));
    };
    removeOrAdd(selectedErrorEvents, errorEventId) {
        let response;
        const index = selectedErrorEvents.indexOf(errorEventId);
        if (index === -1) {
            // it doesnt exist add it
            response = [...selectedErrorEvents, errorEventId];
        } else {
            // it exist, remove it
            response = selectedErrorEvents.filter(id => id !== errorEventId);
        }
        return response;
    }
    selectAllErrorEvents = () => {
        let errorEventsId = [];
        // if the number of selected error events is different from the total number of available issues, select all ids and set it as the new selected array
        if (
            this.state.selectedErrorEvents.length !==
            this.props.errorTrackerIssues.errorTrackerIssues.length
        ) {
            errorEventsId = this.props.errorTrackerIssues.errorTrackerIssues.map(
                errorTrackerIssue => errorTrackerIssue._id
            );
        }

        this.setState({
            selectedErrorEvents: errorEventsId,
        });
    };
    ignoreErrorEvent = () => {
        const promise = this.props
            .ignoreErrorEvent(this.state.selectedErrorEvents)
            .then();
        this.setState({
            selectedErrorEvents: [],
        });
        return promise;
    };
    resolveErrorEvent = () => {
        const promise = this.props
            .resolveErrorEvent(this.state.selectedErrorEvents)
            .then();
        this.setState({
            selectedErrorEvents: [],
        });
        return promise;
    };
    resolveSingleIssue = issueId => {
        const promise = this.props.resolveErrorEvent([issueId]).then();
        return promise;
    };
    prevClicked = (skip, limit) => {
        const { handleNavigationButtonClick } = this.props;
        handleNavigationButtonClick(skip ? parseInt(skip, 10) - 10 : 10, limit);
    };

    nextClicked = (skip, limit) => {
        const { handleNavigationButtonClick } = this.props;
        handleNavigationButtonClick(skip ? parseInt(skip, 10) + 10 : 10, limit);
    };
    openEventMemberModal = errorTrackerIssue => {
        const { openModal, updateErrorEventMember, teamMembers } = this.props;
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
        const { selectedErrorEvents, ignoreModalId } = this.state;
        const {
            errorTrackerIssues,
            errorTracker,
            projectId,
            componentId,
            openModal,
            errorTrackerStatus,
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
                        id={`${errorTracker.name}-no-error-warning`}
                        message={
                            <span>
                                This Error Tracker is currently not reporting
                                any error, Click{' '}
                                <a
                                    rel="noopener noreferrer"
                                    href="https://github.com/Fyipe/feature-docs/blob/master/log.md"
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
                                                        .selectedErrorEvents
                                                        .length ===
                                                        errorTrackerIssues
                                                            .errorTrackerIssues
                                                            .length &&
                                                    this.state
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
                                        <button
                                            className="bs-Button bs-Button--icon bs-Button--block"
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
                                                        this.ignoreErrorEvent(),
                                                    content: DataPathHoC(
                                                        ConfirmErrorTrackerIssueAction,
                                                        {
                                                            action: 'ignore',
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
                                    (errorTrackerIssue, i) => {
                                        return (
                                            <ErrorTrackerIssue
                                                errorTrackerIssue={
                                                    errorTrackerIssue
                                                }
                                                errorTracker={errorTracker}
                                                key={i}
                                                projectId={projectId}
                                                componentId={componentId}
                                                selectErrorEvent={
                                                    this.selectErrorEvent
                                                }
                                                selectedErrorEvents={
                                                    this.state
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

function mapStateToProps(state, ownProps) {
    // get current error event tracker
    const errorTracker = ownProps.errorTracker;
    // get its list of error tracker issues
    const errorTrackerIssues =
        state.errorTracker.errorTrackerIssues[errorTracker._id];
    const { teamMembers } = ownProps;

    if (errorTrackerIssues) {
        errorTrackerIssues.errorTrackerIssues.map(errorTrackerIssue => {
            const issueMembers = errorTrackerIssue.members;
            const differentialTeamMember = [];
            teamMembers.forEach(teamMember => {
                const exist = issueMembers.filter(
                    issueMember => issueMember.userId._id === teamMember.userId
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
ErrorTrackerDetailView.propTypes = {
    errorTrackerIssues: PropTypes.object,
    errorTracker: PropTypes.object,
    projectId: PropTypes.string,
    slug: PropTypes.string,
    componentId: PropTypes.string,
    handleNavigationButtonClick: PropTypes.string,
    ignoreErrorEvent: PropTypes.string,
    resolveErrorEvent: PropTypes.string,
    openModal: PropTypes.func,
    updateErrorEventMember: PropTypes.func,
    teamMembers: PropTypes.array,
    errorTrackerStatus: PropTypes.object,
};
ErrorTrackerDetailView.displayName = 'ErrorTrackerDetailView';
export default connect(mapStateToProps, null)(ErrorTrackerDetailView);
