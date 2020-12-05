import React, { Component } from 'react';
import Badge from '../common/Badge';
import moment from 'moment';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import TooltipMini from '../basic/TooltipMini';

class ErrorEventTimeline extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            isAbsolute: true,
        };
    }
    renderTimelineContent = timeline => {
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
                        style={{ color: 'blue', cursor: 'pointer' }}
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
    getTimelineIcon = timeline => {
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
                <div className="Box-divider--border-top-1 Padding-vertical--20">
                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                        <p className="SubHeader">Timeline</p>
                    </div>
                    <div className="Timeline-Table">
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            maxWidth: '48px',
                                        }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                            style={{
                                                height: '100%',
                                            }}
                                        >
                                            Type
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '50px',
                                        }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                            style={{
                                                height: '100%',
                                            }}
                                        >
                                            Category
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '248px',
                                        }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                            style={{
                                                height: '100%',
                                            }}
                                        >
                                            Description
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '60px',
                                        }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                            style={{
                                                height: '100%',
                                            }}
                                        >
                                            Level
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '60px',
                                        }}
                                    >
                                        <div
                                            className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--spaceBetween Flex-alignItems--center"
                                            style={{
                                                height: '100%',
                                            }}
                                        >
                                            <TooltipMini
                                                title={`Switch to ${
                                                    this.state.isAbsolute
                                                        ? 'absolute'
                                                        : 'relative'
                                                }`}
                                                content={
                                                    <img
                                                        onClick={() =>
                                                            this.setState(
                                                                this.setState(
                                                                    state => ({
                                                                        isAbsolute: !state.isAbsolute,
                                                                    })
                                                                )
                                                            )
                                                        }
                                                        src="/dashboard/assets/img/http.svg"
                                                        alt=""
                                                        style={{
                                                            height: '25px',
                                                            width: '25px',
                                                            padding: '5px',
                                                        }}
                                                    />
                                                }
                                            />
                                            Time
                                        </div>
                                    </td>
                                </tr>
                            </thead>
                            <tbody className="Table-body">
                                {errorEventDetails &&
                                errorEventDetails.timeline &&
                                errorEventDetails.timeline.length > 0 ? (
                                    errorEventDetails.timeline.map(
                                        (timeline, i) => {
                                            return (
                                                <tr key={i}>
                                                    <td>
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-left--20 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                <div>
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                                <img
                                                                                    src={this.getTimelineIcon(
                                                                                        timeline
                                                                                    )}
                                                                                    alt=""
                                                                                    style={{
                                                                                        height:
                                                                                            '35px',
                                                                                        width:
                                                                                            '35px',
                                                                                        padding:
                                                                                            '5px',
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                <div>
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                                <span>
                                                                                    {` ${timeline.category}`}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                <div>
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                                {this.renderTimelineContent(
                                                                                    timeline
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                <div>
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                                <Badge
                                                                                    color={
                                                                                        timeline.type ===
                                                                                        'info'
                                                                                            ? `blue`
                                                                                            : timeline.type ===
                                                                                              'warning'
                                                                                            ? `orange`
                                                                                            : 'red'
                                                                                    }
                                                                                >
                                                                                    {` ${timeline.type}`}
                                                                                </Badge>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                                <div>
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                                <ShouldRender
                                                                                    if={
                                                                                        this
                                                                                            .state
                                                                                            .isAbsolute
                                                                                    }
                                                                                >
                                                                                    <span>
                                                                                        {moment(
                                                                                            timeline.timestamp
                                                                                        ).format(
                                                                                            'h:mm:ss a'
                                                                                        )}
                                                                                    </span>
                                                                                </ShouldRender>
                                                                                <ShouldRender
                                                                                    if={
                                                                                        !this
                                                                                            .state
                                                                                            .isAbsolute
                                                                                    }
                                                                                >
                                                                                    <span>
                                                                                        {' '}
                                                                                        {moment(
                                                                                            timeline.timestamp
                                                                                        ).diff(
                                                                                            moment(
                                                                                                errorEventDetails.createdAt
                                                                                            ),
                                                                                            'seconds'
                                                                                        )}

                                                                                        s
                                                                                    </span>
                                                                                </ShouldRender>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    )
                                ) : (
                                    <tr>
                                        <td></td>
                                        <td></td>
                                        <td>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                                    <div>
                                                        <div className="Box-root Flex-flex">
                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                                    {' '}
                                                                    no timeline
                                                                    activity
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td></td>
                                        <td></td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
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
