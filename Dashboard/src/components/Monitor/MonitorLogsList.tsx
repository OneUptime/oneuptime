import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import ViewJsonLogs from '../modals/ViewJsonLogs';
import { formatMonitorResponseTime } from '../../utils/formatMonitorResponseTime';
import { formatDecimal, formatBytes } from '../../config';
import ShouldRender from '../../components/basic/ShouldRender';

import toPascalCase from 'to-pascal-case';
import ViewScriptLogs from '../modals/ViewScriptLogs';
import { updatemonitorlogbysocket } from '../../actions/socket';

interface MonitorLogsListProps {
    monitorId?: string;
    monitorLogs?: object;
    monitorName?: string;
    monitorType?: string;
    agentless?: boolean;
    nextClicked: Function;
    openModal?: Function;
    prevClicked: Function;
    page?: number;
}

export class MonitorLogsList extends Component<MonitorLogsListProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            viewJsonModalId: uuidv4(),
            viewScriptLogModalId: uuidv4(),
        };
    }
    override componentDidMount() {
        // const { updatemonitorlogbysocket } = this.props;
        // socket.on(`updateMonitorLog-${this.props.projectId}`, function(data) {
        //     updatemonitorlogbysocket(data);
        // });
    }
    override componentWillUnmount() {
        // socket.removeListener(`updateMonitorLog-${this.props.projectId}`);
    }
    override render() {

        const { monitorLogs } = this.props;
        let skip = monitorLogs && monitorLogs.skip ? monitorLogs.skip : null;
        let limit = monitorLogs && monitorLogs.limit ? monitorLogs.limit : null;
        const count =
            monitorLogs && monitorLogs.count ? monitorLogs.count : null;
        const numberOfPages = Math.ceil(parseInt(count) / 10);
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
            monitorLogs &&
            (monitorLogs.requesting ||
                !monitorLogs.logs ||
                (monitorLogs.logs && monitorLogs.logs.length < 1))
        ) {
            canNext = false;
            canPrev = false;
        }

        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">

                                {this.props.monitorType &&

                                    this.props.monitorType === 'server-monitor' ? (
                                    <>

                                        <ShouldRender if={this.props.agentless}>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '210px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>Probe</span>
                                                    </span>
                                                </div>
                                            </td>
                                        </ShouldRender>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>status</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>CPU Load</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Memory Used</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Storage Usage</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Temperature</span>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Actions</span>
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
                                    </>
                                ) : (
                                    <>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                                minWidth: '210px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .monitorType &&
                                                            this.props

                                                                .monitorType !==
                                                            'incomingHttpRequest'
                                                        }
                                                    >
                                                        <span>Probe</span>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .monitorType &&
                                                            this.props

                                                                .monitorType ===
                                                            'incomingHttpRequest'
                                                        }
                                                    >
                                                        <span>
                                                            Incoming Http
                                                            Request
                                                        </span>
                                                    </ShouldRender>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>status</span>
                                                </span>
                                            </div>
                                        </td>
                                        <ShouldRender
                                            if={

                                                this.props.monitorType &&

                                                this.props.monitorType !==
                                                'incomingHttpRequest' &&

                                                this.props.monitorType !==
                                                'kubernetes' &&

                                                this.props.monitorType !==
                                                'script'
                                            }
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>Status Code</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>
                                                            Response Time
                                                        </span>
                                                    </span>
                                                </div>
                                            </td>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={

                                                this.props.monitorType &&

                                                this.props.monitorType ===
                                                'script'
                                            }
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>Status Text</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>
                                                            Execution Time
                                                        </span>
                                                    </span>
                                                </div>
                                            </td>
                                        </ShouldRender>
                                        <td
                                            className="Table-cell Table-cell--align--center Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                    <span>Actions</span>
                                                </span>
                                            </div>
                                        </td>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {monitorLogs &&
                                monitorLogs.logs &&
                                monitorLogs.logs.length > 0 ? (
                                monitorLogs.logs.map((log: $TSFixMe, i: $TSFixMe) => {
                                    return (
                                        <tr
                                            id={`monitor_log_${log.monitorId &&
                                                log.monitorId.name
                                                ? log.monitorId.name

                                                : this.props.monitorName

                                                    ? this.props.monitorName
                                                    : 'Unknown Monitor'
                                                }_${i}`}
                                            key={log._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                        >

                                            {this.props.monitorType &&

                                                this.props.monitorType ===
                                                'server-monitor' ? (
                                                <>
                                                    <ShouldRender
                                                        if={

                                                            this.props.agentless
                                                        }
                                                    >
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '210px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Margin-right--16">
                                                                        <span>
                                                                            {log.probeId &&
                                                                                log
                                                                                    .probeId
                                                                                    .probeName
                                                                                ? log
                                                                                    .probeId
                                                                                    .probeName
                                                                                : 'OneUptime'}
                                                                        </span>
                                                                    </div>
                                                                </span>
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
                                                        </td>
                                                    </ShouldRender>
                                                    <td
                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                        style={{
                                                            height: '1px',
                                                        }}
                                                    >
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                {log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'offline' ? (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                offline
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'online' ? (
                                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                online
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'degraded' ? (
                                                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                degraded
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                Unknown
                                                                                                Status
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
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                            {log.cpuLoad

                                                                                                ? formatDecimal(
                                                                                                    log.cpuLoad,
                                                                                                    2
                                                                                                )
                                                                                                : 0}{' '}
                                                                                            %
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
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                            {log.memoryUsed

                                                                                                ? formatBytes(
                                                                                                    log.memoryUsed
                                                                                                )
                                                                                                : '0 Bytes'}
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
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                            {log.storageUsage

                                                                                                ? formatDecimal(
                                                                                                    log.storageUsage,
                                                                                                    2
                                                                                                )
                                                                                                : 0}{' '}
                                                                                            %
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
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                            {log.mainTemp
                                                                                                ? log.mainTemp
                                                                                                : 0}{' '}
                                                                                            &deg;C
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
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                    <button
                                                                                        title="viewJson"
                                                                                        id={`monitor_log_json_${log._id}`}
                                                                                        disabled={
                                                                                            !(
                                                                                                monitorLogs &&
                                                                                                !monitorLogs.requesting
                                                                                            )
                                                                                        }
                                                                                        className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                        type="button"
                                                                                        onClick={() =>

                                                                                            this.props.openModal(
                                                                                                {
                                                                                                    id: this
                                                                                                        .state

                                                                                                        .viewJsonModalId,
                                                                                                    content: DataPathHoC(
                                                                                                        ViewJsonLogs,
                                                                                                        {
                                                                                                            viewJsonModalId: this
                                                                                                                .state

                                                                                                                .viewJsonModalId,
                                                                                                            jsonLog: log,
                                                                                                            title: `Monitor Log for ${this
                                                                                                                .props

                                                                                                                .monitorName
                                                                                                                ? this
                                                                                                                    .props

                                                                                                                    .monitorName
                                                                                                                : log.monitorId &&
                                                                                                                    log
                                                                                                                        .monitorId
                                                                                                                        .name
                                                                                                                    ? log
                                                                                                                        .monitorId
                                                                                                                        .name
                                                                                                                    : 'Unknown'
                                                                                                                } monitor`,
                                                                                                            rootName:
                                                                                                                'monitorLog',
                                                                                                        }
                                                                                                    ),
                                                                                                }
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        <span>
                                                                                            View
                                                                                            JSON
                                                                                        </span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                                </>
                                            ) : (
                                                <>
                                                    <td
                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                        style={{
                                                            height: '1px',
                                                            minWidth: '210px',
                                                        }}
                                                    >
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <div className="Box-root Margin-right--16">
                                                                    <span>
                                                                        {log.probeId &&
                                                                            log
                                                                                .probeId
                                                                                .probeName
                                                                            ? log
                                                                                .probeId
                                                                                .probeName
                                                                            : this
                                                                                .props

                                                                                .monitorType &&
                                                                                [
                                                                                    'incomingHttpRequest',
                                                                                    'script',
                                                                                ].includes(
                                                                                    this
                                                                                        .props

                                                                                        .monitorType
                                                                                )
                                                                                ? 'OneUptime'
                                                                                : 'Unknown Probe'}
                                                                    </span>
                                                                </div>
                                                            </span>
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
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                {log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'offline' ? (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                offline
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'online' ? (
                                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                online
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : log &&
                                                                                    log.status &&
                                                                                    log.status ===
                                                                                    'degraded' ? (
                                                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                degraded
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                            <span>
                                                                                                Unknown
                                                                                                Status
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
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .monitorType &&
                                                            this.props

                                                                .monitorType !==
                                                            'incomingHttpRequest' &&
                                                            this.props

                                                                .monitorType !==
                                                            'kubernetes' &&
                                                            this.props

                                                                .monitorType !==
                                                            'script'
                                                        }
                                                    >
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="Box-root Flex-flex">
                                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                    {log &&
                                                                                        log.responseStatus &&
                                                                                        parseInt(
                                                                                            log.responseStatus
                                                                                        ) >=
                                                                                        400 ? (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {
                                                                                                        log.responseStatus
                                                                                                    }
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : log &&
                                                                                        log.responseStatus &&
                                                                                        parseInt(
                                                                                            log.responseStatus
                                                                                        ) <
                                                                                        400 ? (
                                                                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {
                                                                                                        log.responseStatus
                                                                                                    }
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    Unknown
                                                                                                    Status
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
                                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                                {formatMonitorResponseTime(
                                                                                                    log.responseTime
                                                                                                )}
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
                                                    </ShouldRender>
                                                    {/* Script monitor specific columns */}
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .monitorType &&
                                                            this.props

                                                                .monitorType ===
                                                            'script'
                                                        }
                                                    >
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-link">
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div className="Box-root Flex-flex">
                                                                            <div className="Box-root Flex-flex">
                                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                    {log
                                                                                        ?.scriptMetadata
                                                                                        ?.statusText &&
                                                                                        log
                                                                                            .scriptMetadata
                                                                                            .statusText !==
                                                                                        'success' ? (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {toPascalCase(
                                                                                                        log
                                                                                                            .scriptMetadata
                                                                                                            .statusText
                                                                                                    )}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : log
                                                                                        ?.scriptMetadata
                                                                                        ?.statusText &&
                                                                                        log
                                                                                            .scriptMetadata
                                                                                            .statusText ===
                                                                                        'success' ? (
                                                                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    {toPascalCase(
                                                                                                        log
                                                                                                            .scriptMetadata
                                                                                                            .statusText
                                                                                                    )}
                                                                                                </span>
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                <span>
                                                                                                    Unknown
                                                                                                    Status
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
                                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
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
                                                                                                {log.scriptMetadata &&
                                                                                                    formatMonitorResponseTime(
                                                                                                        log
                                                                                                            .scriptMetadata
                                                                                                            .executionTime
                                                                                                    )}
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
                                                    </ShouldRender>

                                                    <td
                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                        style={{
                                                            height: '1px',
                                                        }}
                                                    >
                                                        <div className="db-ListViewItem-link">
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <div className="Box-root Flex">
                                                                        <div className="Box-root Flex-flex Flex-justifyContent--center">
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            this
                                                                                                .props

                                                                                                .monitorType ===
                                                                                            'script'
                                                                                        }
                                                                                    >
                                                                                        <button
                                                                                            title="View script console logs"
                                                                                            id={`monitor_log_script_${log._id}`}
                                                                                            disabled={
                                                                                                !(
                                                                                                    monitorLogs &&
                                                                                                    !monitorLogs.requesting
                                                                                                )
                                                                                            }
                                                                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                            type="button"
                                                                                            onClick={() =>

                                                                                                this.props.openModal(
                                                                                                    {
                                                                                                        id: this
                                                                                                            .state

                                                                                                            .viewScriptLogModalId,
                                                                                                        content: DataPathHoC(
                                                                                                            ViewScriptLogs,
                                                                                                            {
                                                                                                                viewScriptLogModalId: this
                                                                                                                    .state

                                                                                                                    .viewScriptLogModalId,
                                                                                                                consoleLogs:
                                                                                                                    log
                                                                                                                        .scriptMetadata
                                                                                                                        .consoleLogs,
                                                                                                                title: `Console logs for "${this
                                                                                                                    .props

                                                                                                                    .monitorName
                                                                                                                    ? this
                                                                                                                        .props

                                                                                                                        .monitorName
                                                                                                                    : log.monitorId &&
                                                                                                                        log
                                                                                                                            .monitorId
                                                                                                                            .name
                                                                                                                        ? log
                                                                                                                            .monitorId
                                                                                                                            .name
                                                                                                                        : 'Unknown'
                                                                                                                    }" monitor`,
                                                                                                                rootName:
                                                                                                                    'monitorLog',
                                                                                                            }
                                                                                                        ),
                                                                                                    }
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                View
                                                                                                Log
                                                                                            </span>
                                                                                        </button>
                                                                                    </ShouldRender>
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            this
                                                                                                .props

                                                                                                .monitorType !==
                                                                                            'script'
                                                                                        }
                                                                                    >
                                                                                        <button
                                                                                            title="viewJson"
                                                                                            id={`monitor_log_json_${log._id}`}
                                                                                            disabled={
                                                                                                !(
                                                                                                    monitorLogs &&
                                                                                                    !monitorLogs.requesting
                                                                                                )
                                                                                            }
                                                                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                            type="button"
                                                                                            onClick={() =>

                                                                                                this.props.openModal(
                                                                                                    {
                                                                                                        id: this
                                                                                                            .state

                                                                                                            .viewJsonModalId,
                                                                                                        content: DataPathHoC(
                                                                                                            ViewJsonLogs,
                                                                                                            {
                                                                                                                viewJsonModalId: this
                                                                                                                    .state

                                                                                                                    .viewJsonModalId,
                                                                                                                jsonLog: log,
                                                                                                                title: `Monitor Log for ${this
                                                                                                                    .props

                                                                                                                    .monitorName
                                                                                                                    ? this
                                                                                                                        .props

                                                                                                                        .monitorName
                                                                                                                    : log.monitorId &&
                                                                                                                        log
                                                                                                                            .monitorId
                                                                                                                            .name
                                                                                                                        ? log
                                                                                                                            .monitorId
                                                                                                                            .name
                                                                                                                        : 'Unknown'
                                                                                                                    } monitor`,
                                                                                                                rootName:
                                                                                                                    'monitorLog',
                                                                                                            }
                                                                                                        ),
                                                                                                    }
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            <span>
                                                                                                View
                                                                                                JSON
                                                                                            </span>
                                                                                        </button>
                                                                                    </ShouldRender>
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
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {monitorLogs && monitorLogs.requesting ? <ListLoader /> : null}

                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {!monitorLogs ||
                        (monitorLogs &&
                            (!monitorLogs.logs || !monitorLogs.logs.length) &&
                            !monitorLogs.requesting &&
                            !monitorLogs.error)
                        ? "We don't have any monitor logs so far."
                        : null}
                    {monitorLogs && monitorLogs.error
                        ? monitorLogs.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {numberOfPages > 0
                                        ? `Page ${this.props.page
                                        } of ${numberOfPages} (${count
                                            ? count +
                                            (count > 1
                                                ? ' Logs'
                                                : ' Log')
                                            : '0 Logs'
                                        })`
                                        : count
                                            ? count + (count > 1 ? ' Logs' : ' Log')
                                            : '0 Logs'}
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

                                        this.props.prevClicked(

                                            this.props.monitorId

                                                ? this.props.monitorId
                                                : null,
                                            skip,
                                            limit
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
                                    id="btnNext"
                                    onClick={() => {

                                        this.props.nextClicked(

                                            this.props.monitorId

                                                ? this.props.monitorId
                                                : null,
                                            skip,
                                            limit
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

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { openModal, closeModal, updatemonitorlogbysocket },
        dispatch
    );
};

function mapStateToProps(state: RootState, props: $TSFixMe) {
    const monitorId = props.monitorId ? props.monitorId : null;
    const monitorLogs = monitorId ? state.monitor.monitorLogs[monitorId] : {};

    if (monitorLogs && monitorLogs.logs) {
        monitorLogs.logs = monitorLogs.logs.map((log: $TSFixMe) => {
            if (
                log.kubernetesLog &&
                Object.keys(log.kubernetesLog).length > 0
            ) {
                const initialData: $TSFixMe = { ...log.kubernetesLog };
                const newData: $TSFixMe = {};

                newData.podData = {
                    podStat: initialData.podData.podStat,
                    healthyPodData: initialData.podData.healthyPodData,
                    unhealthyPodData: initialData.podData.unhealthyPodData,
                    allPodData: initialData.podData.allPodData,
                };

                newData.jobData = {
                    jobStat: initialData.jobData.jobStat,
                    healthyJobData: initialData.jobData.healthyJobData,
                    unhealthyJobData: initialData.jobData.unhealthyJobData,
                };

                newData.serviceData = initialData.serviceData;

                newData.deploymentData = {
                    desiredDeployment:
                        initialData.deploymentData.desiredDeployment,
                    readyDeployment: initialData.deploymentData.readyDeployment,
                    healthy: initialData.deploymentData.healthy,
                    unhealthy: initialData.deploymentData.unhealthy,
                    healthyDeploymentData:
                        initialData.deploymentData.healthyDeploymentData,
                    unhealthyDeploymentData:
                        initialData.deploymentData.unhealthyDeploymentData,
                    allDeploymentData:
                        initialData.deploymentData.allDeploymentData,
                };

                newData.statefulsetData = {
                    readyStatefulsets:
                        initialData.statefulsetData.readyStatefulsets,
                    desiredStatefulsets:
                        initialData.statefulsetData.desiredStatefulsets,
                    healthy: initialData.statefulsetData.healthy,
                    unhealthy: initialData.statefulsetData.unhealthy,
                    healthyStatefulsetData:
                        initialData.statefulsetData.healthyStatefulsetData,
                    unhealthyStatefulsetData:
                        initialData.statefulsetData.unhealthyStatefulsetData,
                    allStatefulsetData:
                        initialData.statefulsetData.allStatefulsetData,
                };

                log.kubernetesLog = newData;
            }
            return log;
        });
    }

    return {
        monitorLogs,
    };
}


MonitorLogsList.displayName = 'MonitorLogsList';


MonitorLogsList.propTypes = {
    monitorId: PropTypes.string,
    monitorLogs: PropTypes.object,
    monitorName: PropTypes.string,
    monitorType: PropTypes.string,
    agentless: PropTypes.bool,
    nextClicked: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    prevClicked: PropTypes.func.isRequired,
    page: PropTypes.number,
    // projectId: PropTypes.string,
    // updatemonitorlogbysocket: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorLogsList);
