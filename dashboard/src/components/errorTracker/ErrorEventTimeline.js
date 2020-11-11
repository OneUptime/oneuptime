import React, { Component } from 'react';
import Badge from '../common/Badge';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';

class ErrorEventTimeline extends Component {
    render() {
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
                            <tr>
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
                                                                {' '}
                                                                console{' '}
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
                                                                [object
                                                                Object],[object
                                                                Object],[object
                                                                Object],[object
                                                                Object],[object
                                                                Object],[object
                                                                Object]
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
                                                            <Badge color="orange">
                                                                {' '}
                                                                warn{' '}
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
