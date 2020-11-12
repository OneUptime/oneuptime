import React, { Component } from 'react';
import Badge from '../common/Badge';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import moment from 'moment';

class ErrorEventTimeline extends Component {
    renderTimelineContent = timeline => {
        let rendered = '';
        if (timeline.category === 'ui.click') {
            rendered = <span> {timeline.data.content.path}</span>;
        } else if (timeline.category === 'console') {
            rendered = <span> {timeline.data.content} </span>;
        } else if (timeline.category === 'fetch') {
            rendered = (
                <span>
                    <span>{timeline.data.content.method.toUpperCase()}</span>{' '}
                    <a
                        href={timeline.data.content.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'blue' }}
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
    render() {
        const { errorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        return (
            <div className="Box-divider--border-top-1 Padding-vertical--20">
                <div className="Flex-flex Flex-justifyContent--spaceBetween">
                    <p className="SubHeader">Timeline</p>
                    <span className="Margin-all--8">
                        <Dropdown>
                            <Dropdown.Toggle
                                id="filterToggle"
                                className="bs-Button bs-DeprecatedButton"
                                title={'Sort By: Last Seen'}
                            />
                            <Dropdown.Menu>
                                <MenuItem title="clear">Clear Filters</MenuItem>
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
                                        maxWidth: '48px',
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
                                        maxWidth: '48px',
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
                                        maxWidth: '48px',
                                    }}
                                >
                                    <div
                                        className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                        style={{
                                            height: '100%',
                                        }}
                                    >
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
                                                                                src="/dashboard/assets/img/debugging.svg"
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
                                                                            <Badge color="orange">
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
                                                                            <span>
                                                                                {moment(
                                                                                    timeline.timestamp
                                                                                ).format(
                                                                                    'h:mm:ss a'
                                                                                )}
                                                                            </span>
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
                                <div> no timeline activity</div>
                            )}

                            <tr>
                                <td>
                                    <div className="db-ListViewItem-link">
                                        <div className="db-ListViewItem-cellContent Box-root Padding-left--20 Padding-vertical--8 Flex-flex Flex-alignItems--center">
                                            <div>
                                                <div className="Box-root Flex-flex">
                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                        <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-right--8 Padding-vertical--2">
                                                            <img
                                                                src="/dashboard/assets/img/user.svg"
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
                                                                {' '}
                                                                ui.click{' '}
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
                                                            <span>
                                                                {` body > div#root >
                            div.App >
                            header#random.App-header.tested
                            > button`}
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
                                                            <Badge>
                                                                {' '}
                                                                info{' '}
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
                                                            <span>
                                                                {' '}
                                                                08:22:30{' '}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>{' '}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}

ErrorEventTimeline.displayName = 'ErrorEventTimeline';
export default ErrorEventTimeline;
