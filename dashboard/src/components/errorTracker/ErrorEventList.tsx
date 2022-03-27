import React, { Component } from 'react';
import Badge from '../common/Badge';

class ErrorEventList extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    override render() {
        return (
            <div className="Box-divider--border-top-1 Padding-vertical--20" >
                <div className="Flex-flex Flex-justifyContent--spaceBetween">
                    <p className="SubHeader">Events</p>
                </div>
                <div>
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
                                        ID
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
                                        Date
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
                                        Browser
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
                                        Device
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
                                                            <span>
                                                                {' '}
                                                                LONG-EVENTID-HERE{' '}
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
                                                                20-10-2020
                                                                19:45PM
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
                                                                Chrome{' '}
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
                                                            <span> Nexus </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}

ErrorEventList.displayName = 'ErrorEventList';
export default ErrorEventList;
