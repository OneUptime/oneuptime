import React, { Component } from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';

interface ErrorEventTimelineProps {
    errorEvent?: object;
}

class ErrorEventTimeline extends Component<ErrorEventTimelineProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }
    renderTimelineContent = (timeline: $TSFixMe) => {
        let rendered = '';
        if (timeline.category === 'ui.click') {

            rendered = <span> {timeline.data.content.path}</span>;
        } else if (timeline.category === 'console') {

            rendered = <span> {timeline.data.content} </span>;
        } else if (
            timeline.category === 'fetch' ||
            timeline.category === 'xhr'
        ) {

            rendered = (
                <span>
                    <span>{timeline.data.content.method}</span>{' '}
                    <a
                        href={timeline.data.content.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ cursor: 'pointer' }}
                    >
                        {timeline.data.content.url}
                    </a>{' '}
                    <span>[{timeline.data.content.status_code}]</span>
                </span>
            );
        } else {
            rendered =
                typeof timeline.data === 'object'
                    ? JSON.stringify(timeline.data)
                    : timeline.data;
        }

        return rendered;
    };
    getTimelineIcon = (timeline: $TSFixMe) => {
        let image = 'event';
        if (timeline.category === 'ui.click') {
            image = 'user';
        } else if (timeline.category === 'console') {
            image = 'debugging';
        } else if (
            timeline.category === 'fetch' ||
            timeline.category === 'xhr'
        ) {
            image = 'http';
        }

        return `/dashboard/assets/img/${image}.svg`;
    };
    generateText = (status: $TSFixMe) => {
        const capitalizedText =
            status.charAt(0).toUpperCase() + status.slice(1);
        return `${capitalizedText}d by`;
    };
    render() {

        const { errorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        return (
            <ShouldRender
                if={
                    !errorEvent.requesting &&
                    errorEventDetails &&
                    errorEventDetails.timeline
                }
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center Padding-horizontal--12">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>Error Event Timeline</span>
                                </span>
                            </div>
                        </div>
                        <div
                            style={{
                                overflow: 'hidden',
                                overflowX: 'auto',
                                marginBottom: '20px',
                            }}
                        >
                            <table className="Table">
                                <thead className="Table-body">
                                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '100px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Type</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '150px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Category</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '210px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Description </span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '150px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Level</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '100px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Time</span>
                                                </span>
                                            </div>
                                        </td>

                                        <td
                                            id="overflow"

                                            type="action"
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                            </div>
                                        </td>
                                    </tr>
                                </thead>
                                <tbody>
                                    {errorEventDetails &&
                                        errorEventDetails.timeline &&
                                        errorEventDetails.timeline.length > 0
                                        ? errorEventDetails.timeline.map(
                                            (timeline: $TSFixMe, i: $TSFixMe) => {
                                                return (
                                                    <tr
                                                        key={i}
                                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                                    >
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '100px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div className="Box-root Flex-flex Flex-direction--column">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <img
                                                                                    src={this.getTimelineIcon(
                                                                                        timeline
                                                                                    )}
                                                                                    alt=""
                                                                                    style={{
                                                                                        height:
                                                                                            '25px',
                                                                                        width:
                                                                                            '25px',
                                                                                        padding:
                                                                                            '5px',
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '100px',
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    maxWidth:
                                                                        '450px',
                                                                }}
                                                                className="db-ListViewItem-link"
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div className="Box-root Flex">
                                                                            <div className="Box-root Flex-flex">
                                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                    {timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'error' ? (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.category}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'info' ? (
                                                                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.category}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'warning' ? (
                                                                                        <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.category}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {timeline.category ||
                                                                                                        'Unknown Category'}
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
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                    <div>
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {this.renderTimelineContent(
                                                                                                timeline
                                                                                            )}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '100px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                    <div>
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    {timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'error' ? (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.type}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'info' ? (
                                                                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.type}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : timeline &&
                                                                                        timeline.type &&
                                                                                        timeline.type ===
                                                                                        'warning' ? (
                                                                                        <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {`${timeline.type}`}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {timeline.type ||
                                                                                                        'Unknown Type'}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--right  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '100px',
                                                            }}
                                                        >
                                                            <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                <span>
                                                                    {currentTimeZone
                                                                        ? momentTz(
                                                                            timeline.timestamp
                                                                        )
                                                                            .tz(
                                                                                currentTimeZone
                                                                            )
                                                                            .format(
                                                                                'lll'
                                                                            )
                                                                        : moment(
                                                                            timeline.timestamp
                                                                        ).format(
                                                                            'lll'
                                                                        )}
                                                                </span>
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                        )
                                        : null}
                                </tbody>
                            </table>
                            {errorEventDetails &&
                                errorEventDetails.timeline &&
                                errorEventDetails.timeline.length < 1 && (
                                    <div
                                        style={{
                                            textAlign: 'center',
                                            marginTop: '10px',
                                            padding: '0 10px',
                                        }}
                                    >
                                        No timeline event available
                                    </div>
                                )}
                        </div>
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

ErrorEventTimeline.propTypes = {
    errorEvent: PropTypes.object,
};

ErrorEventTimeline.displayName = 'ErrorEventTimeline';

export default ErrorEventTimeline;
