import React, { Component } from 'react';
import Badge from '../common/Badge';
import ErrorEventHeader from './ErrorEventHeader';
import ErrorEventDevice from './ErrorEventDevice';
import ErrorEventMiniTag from './ErrorEventMiniTag';
import ErrorEventStackTrace from './ErrorEventStackTrace';
import ErrorEventTimeline from './ErrorEventTimeline';
// import PropTypes from 'prop-types';

class ErrorEventDetail extends Component {
    render() {
        return (
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div>
                                <div className="Padding-all--20">
                                    <ErrorEventHeader />
                                    <ErrorEventDevice />
                                    <ErrorEventMiniTag />
                                    <ErrorEventStackTrace />
                                    <ErrorEventTimeline />
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">Browser</p>
                                        </div>
                                        <div className="Margin-vertical--8">
                                            <div className="Flex-flex Margin-vertical--4 ">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Brand
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Chrome Mobile
                                                </span>
                                            </div>
                                            <div className="Flex-flex Margin-vertical--4">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Version
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    85.9.100
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">
                                                Operating System
                                            </p>
                                        </div>
                                        <div className="Margin-vertical--8">
                                            <div className="Flex-flex Margin-vertical--4 ">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Brand
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Nexus 5
                                                </span>
                                            </div>
                                            <div className="Flex-flex Margin-vertical--4">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Family
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Nexus 5
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">SDK</p>
                                        </div>
                                        <div className="Margin-vertical--8">
                                            <div className="Flex-flex Margin-vertical--4 ">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Name
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    Fyipe.Tracker.JavaScript
                                                </span>
                                            </div>
                                            <div className="Flex-flex Margin-vertical--4">
                                                <span
                                                    className="Flex-flex Flex-alignItems--center"
                                                    style={{ width: '25%' }}
                                                >
                                                    Version
                                                </span>
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            '#F7F8F9',
                                                        padding: '15px',
                                                        width: '75%',
                                                    }}
                                                >
                                                    {' '}
                                                    3.0.165
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <p className="SubHeader">
                                                Tags Detailed
                                            </p>
                                        </div>
                                        <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                            <div className="Tag-Container">
                                                <div className="Flex-flex Flex-justifyContent--spaceBetween Padding-all--16">
                                                    <span> User Type</span>
                                                    <button
                                                        className="bs-Button"
                                                        type="button"
                                                    >
                                                        <span>
                                                            More Details
                                                        </span>
                                                    </button>
                                                </div>
                                                <div className="Tag-Detail">
                                                    <div>
                                                        <span>Customer</span>
                                                        <span>2</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="Tag-Container">
                                                <div className="Flex-flex Flex-justifyContent--spaceBetween Padding-all--16">
                                                    <span> Device.Family</span>
                                                    <button
                                                        className="bs-Button"
                                                        type="button"
                                                    >
                                                        <span>
                                                            More Details
                                                        </span>
                                                    </button>
                                                </div>
                                                <div className="Tag-Detail">
                                                    <div>
                                                        <span>Nexus</span>
                                                        <span>5</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="Box-divider--border-top-1 Padding-vertical--20">
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
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
                                                                }}
                                                            >
                                                                ID
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
                                                                }}
                                                            >
                                                                Type
                                                            </div>
                                                        </td>

                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
                                                                }}
                                                            >
                                                                Date
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
                                                                }}
                                                            >
                                                                Level
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
                                                                }}
                                                            >
                                                                Browser
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                            }}
                                                        >
                                                            <div
                                                                className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexStart Flex-alignItems--center"
                                                                style={{
                                                                    height:
                                                                        '100%',
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
                                                                                    <span>
                                                                                        {' '}
                                                                                        Nexus{' '}
                                                                                    </span>
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
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
ErrorEventDetail.propTypes = {};
ErrorEventDetail.displayName = 'ErrorEventDetail';
export default ErrorEventDetail;
