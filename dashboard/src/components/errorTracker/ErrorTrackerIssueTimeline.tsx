import React, { Component } from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import { history } from '../../store';

interface ErrorTrackerIssueTimelineProps {
    errorEvent?: object;
    errorTrackerIssue?: object;
}

class ErrorTrackerIssueTimeline extends Component<ErrorTrackerIssueTimelineProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }
    generateText = (status: $TSFixMe) => {
        const capitalizedText =
            status.charAt(0).toUpperCase() + status.slice(1);
        return `${capitalizedText}d by`;
    };
    render() {

        const { errorEvent, errorTrackerIssue } = this.props;
        return (
            <ShouldRender
                if={
                    !errorEvent.requesting &&
                    errorTrackerIssue &&
                    errorTrackerIssue.timeline
                }
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center Padding-horizontal--12">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>Issue Timeline</span>
                                </span>
                            </div>
                        </div>
                        {errorTrackerIssue &&
                            errorTrackerIssue.timeline &&
                            errorTrackerIssue.timeline.length > 0 ? (
                            errorTrackerIssue.timeline
                                .reverse()
                                .map((timeline: $TSFixMe, i: $TSFixMe) => {
                                    return (
                                        <>
                                            <ShouldRender if={i !== 0}>
                                                <div className="bs-thread-line-up bs-ex-up"></div>
                                            </ShouldRender>
                                            <div
                                                key={i}
                                                className="bs-note-display-flex"
                                            >
                                                <div
                                                    className={`bs-incident-notes 
                                                                    ${timeline.status ===
                                                            'resolve'
                                                            ? 'bs-note-resolved'
                                                            : timeline.status ===
                                                                'unresolve'
                                                                ? 'bs-note-offline'
                                                                : timeline.status ===
                                                                    'ignore'
                                                                    ? 'bs-note-acknowleged'
                                                                    : 'bs-note-offline-o'
                                                        }`}
                                                ></div>
                                                <div className="bs-incident-notes-content">
                                                    <div className="bs-note-display-flex bs-mob-block">
                                                        <div>
                                                            {this.generateText(
                                                                timeline.status
                                                            )}
                                                        </div>
                                                        <div
                                                            className="Box-root Margin-right--16 bs-note-7"
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                                marginLeft:
                                                                    '6px',
                                                            }}
                                                            onClick={() => {
                                                                if (
                                                                    timeline.createdById
                                                                ) {
                                                                    history.push(
                                                                        '/dashboard/profile/' +
                                                                        timeline
                                                                            .createdById
                                                                            ._id
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <img
                                                                src={
                                                                    timeline.createdById &&
                                                                        timeline
                                                                            .createdById
                                                                            .name
                                                                        ? '/dashboard/assets/img/profile-user.svg'
                                                                        : '/dashboard/assets/img/ou-wb.svg'
                                                                }
                                                                className="userIcon"
                                                                alt=""
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                    backgroundColor:
                                                                        timeline.createdById &&
                                                                            timeline
                                                                                .createdById
                                                                                .name
                                                                            ? '#fff'
                                                                            : '#121212',
                                                                }}
                                                            />
                                                            <span>
                                                                {timeline.createdById &&
                                                                    timeline
                                                                        .createdById
                                                                        .name
                                                                    ? timeline
                                                                        .createdById
                                                                        .name
                                                                    : 'OneUptime'}
                                                            </span>
                                                        </div>

                                                        <div
                                                            className="db-ListViewItem-link"
                                                            style={{
                                                                width: '0%',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                {timeline &&
                                                                                    timeline.status &&
                                                                                    timeline.status ===
                                                                                    'unresolve' ? (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {`${timeline.status}d`}
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : timeline &&
                                                                                    timeline.status &&
                                                                                    timeline.status ===
                                                                                    'resolve' ? (
                                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {`${timeline.status}d`}
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : timeline &&
                                                                                    timeline.status &&
                                                                                    timeline.status ===
                                                                                    'ignore' ? (
                                                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {`${timeline.status}d`}
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                {timeline.status ||
                                                                                                    'Unknown Status'}
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span>
                                                            {currentTimeZone
                                                                ? momentTz(
                                                                    timeline.createdAt
                                                                )
                                                                    .tz(
                                                                        currentTimeZone
                                                                    )
                                                                    .format(
                                                                        'lll'
                                                                    )
                                                                : moment(
                                                                    timeline.createdAt
                                                                ).format(
                                                                    'lll'
                                                                )}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <ShouldRender
                                                if={
                                                    errorTrackerIssue.timeline
                                                        .length -
                                                    1 !==
                                                    i
                                                }
                                            >
                                                <div className="bs-thread-line-down bs-ex-down"></div>
                                            </ShouldRender>
                                        </>
                                    );
                                })
                        ) : (
                            <div
                                style={{
                                    textAlign: 'center',
                                    marginTop: '10px',
                                    padding: '0 10px',
                                }}
                            >
                                No timeline event for this issue yet
                            </div>
                        )}
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

ErrorTrackerIssueTimeline.propTypes = {
    errorEvent: PropTypes.object,
    errorTrackerIssue: PropTypes.object,
};

ErrorTrackerIssueTimeline.displayName = 'ErrorTrackerIssueTimeline';

export default ErrorTrackerIssueTimeline;
