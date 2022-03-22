import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { history } from '../../store';
import DataPathHoC from '../DataPathHoC';
import { ListLoader, Spinner } from '../basic/Loader';
import { deleteSiteUrl } from '../../actions/monitor';
import DeleteSiteUrl from '../modals/DeleteSiteUrl';
import moment from 'moment';

import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';

export class MonitorLighthouseLogsList extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            deleteSiteUrlModalId: uuidv4(),
        };
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({

                    id: this.state.deleteSiteUrlModalId,
                });
            default:
                return false;
        }
    };

    render() {

        const { deleteSiteUrlModalId } = this.state;

        const { monitor, monitorState } = this.props;
        const lighthouseLogs = monitor.lighthouseLogs || {};
        let skip =
            lighthouseLogs && lighthouseLogs.skip ? lighthouseLogs.skip : null;
        let limit =
            lighthouseLogs && lighthouseLogs.limit
                ? lighthouseLogs.limit
                : null;
        const count =
            lighthouseLogs && lighthouseLogs.count
                ? lighthouseLogs.count
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
            monitorState.fetchLighthouseLogsRequest ||
            (lighthouseLogs.data && lighthouseLogs.data.length < 1)
        ) {
            canNext = false;
            canPrev = false;
        }

        const lighthouseScanStatus = monitor && monitor.lighthouseScanStatus;
        return (
            <div onKeyDown={this.handleKeyBoard}>
                <div
                    style={{
                        overflow: 'hidden',
                        overflowX: 'auto',
                    }}
                >
                    <table id="lighthouseLogsList" className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        minWidth: '210px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>URL</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Performance</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Accessibility</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Best Practices</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>SEO{'   '}</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>PWA</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {lighthouseLogs.data &&
                                lighthouseLogs.data.length > 0 ? (
                                lighthouseLogs.data.map((log: $TSFixMe, i: $TSFixMe) => {
                                    return (
                                        <tr
                                            id={`lighthouseLogs_${monitor.name
                                                    ? monitor.name
                                                    : 'Unknown Monitor'
                                                }_${i}`}
                                            key={i}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink lighthouseLogsListItem"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '210px',
                                                }}
                                                onClick={() => {
                                                    return log._id
                                                        ? history.push(
                                                            '/dashboard/project/' +
                                                            this.props

                                                                .currentProject
                                                                .slug +
                                                            '/component/' +
                                                            this.props

                                                                .componentSlug +
                                                            '/monitoring/' +
                                                            monitor.slug +
                                                            '/issues/' +
                                                            log._id
                                                        )
                                                        : false;
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div
                                                            className="Box-root Margin-right--16"
                                                            id={`lighthouseUrl_${monitor.name
                                                                    ? monitor.name
                                                                    : 'Unknown Monitor'
                                                                }_${i}`}
                                                        >
                                                            <span>
                                                                {log && log.url
                                                                    ? log.url
                                                                    : '-'}
                                                            </span>
                                                        </div>
                                                    </span>
                                                    <div className="Box-root Flex">
                                                        <div className="Box-root Flex">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                    <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-vertical--2">
                                                                        <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                            <span>
                                                                                {moment(
                                                                                    log.createdAt
                                                                                ).fromNow()}{' '}
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div
                                                                    className="Box-root Flex"
                                                                    style={{
                                                                        paddingTop:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                        (
                                                                        {moment(
                                                                            log.createdAt
                                                                        ).format(
                                                                            'MMMM Do YYYY, h:mm:ss a'
                                                                        )}
                                                                        )
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {!lighthouseScanStatus ||
                                                (lighthouseScanStatus &&
                                                    lighthouseScanStatus ===
                                                    'scan' &&
                                                    monitor &&
                                                    monitor.siteUrls &&
                                                    monitor.siteUrls.length > 0) ? (
                                                <>
                                                    <td

                                                        colSpan="5"
                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    >
                                                        <div
                                                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-vertical--2"
                                                            style={{
                                                                boxShadow:
                                                                    'none',
                                                            }}
                                                        >
                                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                                <div
                                                                    className="db-Trend"
                                                                    style={{
                                                                        height:
                                                                            '100%',
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                >
                                                                    <div className="block-chart-side line-chart">
                                                                        <div className="db-TrendRow">
                                                                            <div
                                                                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                                                style={{
                                                                                    textAlign:
                                                                                        'center',
                                                                                    width:
                                                                                        '100%',
                                                                                    fontSize: 14,
                                                                                }}
                                                                            >
                                                                                <Spinner
                                                                                    style={{
                                                                                        stroke:
                                                                                            '#8898aa',
                                                                                    }}
                                                                                />{' '}
                                                                                <span
                                                                                    style={{
                                                                                        width: 10,
                                                                                    }}
                                                                                    id="website_prescan"
                                                                                />
                                                                                Your
                                                                                website
                                                                                scan
                                                                                will
                                                                                begin
                                                                                in
                                                                                few
                                                                                seconds
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (!lighthouseScanStatus ||
                                                (lighthouseScanStatus &&
                                                    lighthouseScanStatus ===
                                                    'scanning')) &&
                                                monitor &&
                                                monitor.siteUrls &&
                                                monitor.siteUrls.length > 0 &&
                                                (log.scanning ||
                                                    log.scanning == null) ? (
                                                <>
                                                    <td

                                                        colSpan="5"
                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    >
                                                        <div
                                                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-vertical--2"
                                                            style={{
                                                                boxShadow:
                                                                    'none',
                                                            }}
                                                        >
                                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                                <div
                                                                    className="db-Trend"
                                                                    style={{
                                                                        height:
                                                                            '100%',
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                >
                                                                    <div className="block-chart-side line-chart">
                                                                        <div className="db-TrendRow">
                                                                            <div
                                                                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                                                style={{
                                                                                    textAlign:
                                                                                        'center',
                                                                                    width:
                                                                                        '100%',
                                                                                    fontSize: 14,
                                                                                }}
                                                                            >
                                                                                <Spinner
                                                                                    style={{
                                                                                        stroke:
                                                                                            '#8898aa',
                                                                                    }}
                                                                                />{' '}
                                                                                <span
                                                                                    style={{
                                                                                        width: 10,
                                                                                    }}
                                                                                    id="website_scanning"
                                                                                />
                                                                                {lighthouseScanStatus ===
                                                                                    'scan'
                                                                                    ? 'website scan will begin in a few seconds'
                                                                                    : `We
                                                                                are
                                                                                currently
                                                                                scanning
                                                                                your
                                                                                website
                                                                                URL
                                                                                and
                                                                                it
                                                                                will
                                                                                take
                                                                                few
                                                                                minutes.`}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td
                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                        style={{
                                                            height: '1px',
                                                        }}
                                                    >
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span
                                                                                            id={`performance_${monitor.name}_${i}`}
                                                                                        >
                                                                                            {log &&
                                                                                                log.performance
                                                                                                ? `${log.performance}%`
                                                                                                : '-'}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
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
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {log &&
                                                                                                log.accessibility
                                                                                                ? `${log.accessibility}%`
                                                                                                : '-'}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
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
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {log &&
                                                                                                log.bestPractices
                                                                                                ? `${log.bestPractices}%`
                                                                                                : '-'}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
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
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {log &&
                                                                                                log.seo
                                                                                                ? `${log.seo}%`
                                                                                                : '-'}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
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
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <span className="Text-display--inline Text-fontSize--14 Text-lineHeight--16 Text-wrap--noWrap">
                                                                                        <span>
                                                                                            {log &&
                                                                                                log.pwa
                                                                                                ? `${log.pwa}%`
                                                                                                : '-'}
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </>
                                            )}
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div className="Box-root Flex">
                                                            <span>
                                                                <button
                                                                    id={`removeSiteUrl_${monitor.name}_${i}`}
                                                                    onClick={() =>

                                                                        this.props.openModal(
                                                                            {
                                                                                id: deleteSiteUrlModalId,
                                                                                onClose: () =>
                                                                                    '',
                                                                                onConfirm: () =>

                                                                                    this.props.deleteSiteUrl(
                                                                                        monitor._id,
                                                                                        this
                                                                                            .props

                                                                                            .currentProject
                                                                                            ._id,
                                                                                        log.url
                                                                                    ),

                                                                                content: DataPathHoC(
                                                                                    DeleteSiteUrl
                                                                                ),
                                                                            }
                                                                        )
                                                                    }
                                                                    className="bs-Button bs-ButtonLegacy ActionIconParent"
                                                                    type="button"
                                                                >
                                                                    <span className="bs-Button--icon bs-Button--trash">
                                                                        <span>
                                                                            Remove
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {monitorState.fetchLighthouseLogsRequest ? (
                    <ListLoader />
                ) : null}

                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {lighthouseScanStatus &&
                        !(
                            lighthouseScanStatus === 'scan' ||
                            lighthouseScanStatus === 'scanning'
                        ) &&
                        !monitorState.fetchLighthouseLogsRequest &&
                        (!lighthouseLogs.data ||
                            (lighthouseLogs.data && lighthouseLogs.data.length < 1))
                        ? "You don't have any website URL yet"
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {lighthouseLogs && lighthouseLogs.count
                                        ? lighthouseLogs.count +
                                        (lighthouseLogs.count > 1
                                            ? ' URLs'
                                            : ' URL')
                                        : null}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnLighthousePrev"
                                    onClick={() => {

                                        this.props.prevClicked(
                                            monitor._id,
                                            lighthouseLogs.skip,
                                            lighthouseLogs.limit
                                        );
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
                                    id="btnLighthouseNext"
                                    onClick={() => {

                                        this.props.nextClicked(
                                            monitor._id,
                                            lighthouseLogs.skip,
                                            lighthouseLogs.limit
                                        );
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

function mapStateToProps(state: $TSFixMe) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
    };
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { openModal, closeModal, deleteSiteUrl },
        dispatch
    );
};


MonitorLighthouseLogsList.displayName = 'MonitorLighthouseLogsList';


MonitorLighthouseLogsList.propTypes = {
    monitor: PropTypes.object,
    monitorState: PropTypes.object,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    deleteSiteUrl: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    componentSlug: PropTypes.string.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorLighthouseLogsList);
