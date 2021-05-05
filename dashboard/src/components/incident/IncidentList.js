import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import { history } from '../../store';
import { markAsRead } from '../../actions/notification';
import { animateSidebar } from '../../actions/animateSidebar';
import { API_URL } from '../../config';
import ShouldRender from '../basic/ShouldRender';

export class IncidentList extends Component {
    render() {
        if (
            this.props.incidents &&
            this.props.incidents.skip &&
            typeof this.props.incidents.skip === 'string'
        ) {
            this.props.incidents.skip = parseInt(this.props.incidents.skip, 10);
        }
        if (
            this.props.incidents &&
            this.props.incidents.limit &&
            typeof this.props.incidents.limit === 'string'
        ) {
            this.props.incidents.limit = parseInt(
                this.props.incidents.limit,
                10
            );
        }
        if (this.props.incidents && !this.props.incidents.skip)
            this.props.incidents.skip = 0;
        if (this.props.incidents && !this.props.incidents.limit)
            this.props.incidents.limit = 0;

        let canNext =
            this.props.incidents &&
            this.props.incidents.count &&
            this.props.incidents.count >
                this.props.incidents.skip + this.props.incidents.limit
                ? true
                : false;
        let canPrev =
            this.props.incidents && this.props.incidents.skip <= 0
                ? false
                : true;

        if (
            this.props.incidents &&
            (this.props.incidents.requesting || !this.props.incidents.incidents)
        ) {
            canNext = false;
            canPrev = false;
        }
        const numberOfPages = this.props.numberOfPage
            ? this.props.numberOfPage
            : Math.ceil(parseInt(this.props.incidents.count) / 10);
        const incidents =
            this.props.filteredIncidents &&
            this.props.filteredIncidents.length > 0
                ? this.props.filteredIncidents
                : this.props.filteredIncidents &&
                  this.props.filteredIncidents.length === 0 &&
                  this.props.isFiltered
                ? []
                : this.props.incidents &&
                  this.props.incidents.incidents &&
                  this.props.incidents.incidents.length > 0
                ? this.props.incidents.incidents
                : [];

        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '100px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>ID</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '150px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Monitor</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '210px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Created By</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '150px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Title</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '100px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Priority</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '100px' }}
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
                                            <span>Acknowledged By</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Resolved By</span>
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
                        <tbody className="Table-body">
                            {incidents && incidents.length > 0 ? (
                                incidents.map((incident, i) => {
                                    let probeName = 'Fyipe';
                                    let probeImage =
                                        '/dashboard/assets/img/Fyipe.svg';

                                    if (
                                        incident.probes &&
                                        incident.probes[0] &&
                                        incident.probes[0].probeId &&
                                        incident.probes[0].probeId.probeName
                                    ) {
                                        probeName =
                                            incident.probes[0].probeId
                                                .probeName;

                                        if (
                                            incident.probes[0].probeId &&
                                            incident.probes[0].probeId
                                                .probeImage
                                        ) {
                                            probeImage = `${API_URL}/file/${incident.probes[0].probeId.probeImage}`;
                                        }
                                    }

                                    return (
                                        <tr
                                            id={`incident_${
                                                incident.monitorId
                                                    ? incident.monitorId.name
                                                    : this.props.incidents.name
                                                    ? this.props.incidents.name
                                                    : 'Unknown Monitor'
                                            }_${i}`}
                                            key={incident._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                            onClick={() => {
                                                setTimeout(() => {
                                                    history.push(
                                                        '/dashboard/project/' +
                                                            this.props
                                                                .currentProject
                                                                .slug +
                                                            '/component/' +
                                                            incident.monitorId
                                                                .componentId
                                                                .slug +
                                                            '/incidents/' +
                                                            incident.idNumber
                                                    );
                                                    this.props.animateSidebar(
                                                        false
                                                    );
                                                }, 200);
                                                this.props.markAsRead(
                                                    this.props.currentProject
                                                        ._id,
                                                    incident.notificationId
                                                );
                                                this.props.animateSidebar(true);
                                            }}
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord Text-fontWeight--medium Text-fontSize--16 Padding-top--4 Text-font"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    {'#' + incident.idNumber}
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord Text-fontWeight--medium Text-fontSize--16 Padding-top--4 Text-font"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    {`${incident.monitorId.name}/${incident.monitorId.componentId.name} `}
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '250px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        {incident.createdById ===
                                                        null ? (
                                                            incident.createdByZapier ? (
                                                                <div className="Box-root Margin-right--16">
                                                                    <img
                                                                        src="/dashboard/assets/img/Fyipe.svg"
                                                                        style={{
                                                                            display:
                                                                                'inline-block',
                                                                            height:
                                                                                '20px',
                                                                            width:
                                                                                '20px',
                                                                            borderRadius:
                                                                                '50%',
                                                                            margin:
                                                                                '5px 10px -4px 0px',
                                                                            backgroundColor:
                                                                                '#14AAD9',
                                                                        }}
                                                                        alt=""
                                                                    />
                                                                    <span>
                                                                        Zapier
                                                                    </span>
                                                                </div>
                                                            ) : incident.createdByIncomingHttpRequest ? (
                                                                <div className="Box-root Margin-right--16">
                                                                    <img
                                                                        src="/dashboard/assets/img/Fyipe.svg"
                                                                        style={{
                                                                            display:
                                                                                'inline-block',
                                                                            height:
                                                                                '20px',
                                                                            width:
                                                                                '20px',
                                                                            borderRadius:
                                                                                '50%',
                                                                            margin:
                                                                                '5px 10px -4px 0px',
                                                                            backgroundColor:
                                                                                '#14AAD9',
                                                                        }}
                                                                        alt=""
                                                                    />
                                                                    <span>
                                                                        Incoming
                                                                        HTTP
                                                                        Request
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="Box-root Margin-right--16">
                                                                    {
                                                                        <img
                                                                            src={
                                                                                probeImage
                                                                            }
                                                                            style={{
                                                                                display:
                                                                                    'inline-block',
                                                                                height:
                                                                                    '20px',
                                                                                width:
                                                                                    '20px',
                                                                                borderRadius:
                                                                                    '50%',
                                                                                margin:
                                                                                    '-1px 5px -5px -7px',
                                                                                backgroundColor:
                                                                                    '#14AAD9',
                                                                            }}
                                                                            alt=""
                                                                        />
                                                                    }

                                                                    <span>
                                                                        {
                                                                            probeName
                                                                        }
                                                                    </span>
                                                                </div>
                                                            )
                                                        ) : (
                                                            <div
                                                                className="Box-root Margin-right--16"
                                                                style={{
                                                                    cursor:
                                                                        'pointer',
                                                                }}
                                                            >
                                                                <img
                                                                    src="/dashboard/assets/img/profile-user.svg"
                                                                    className="userIcon"
                                                                    alt=""
                                                                    style={{
                                                                        marginBottom:
                                                                            '-5px',
                                                                    }}
                                                                />
                                                                <span>
                                                                    {incident
                                                                        .createdById
                                                                        .name
                                                                        ? incident
                                                                              .createdById
                                                                              .name
                                                                        : 'Unknown User'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </span>
                                                    {incident.createdAt ? (
                                                        <div>
                                                            <div
                                                                className="Box-root Flex Padding-horizontal--4"
                                                                style={{
                                                                    paddingTop:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                    {moment(
                                                                        incident.createdAt
                                                                    ).fromNow()}{' '}
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root Flex Padding-horizontal--4"
                                                                style={{
                                                                    paddingTop:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                    (
                                                                    {moment(
                                                                        incident.createdAt
                                                                    ).format(
                                                                        'MMMM Do YYYY, h:mm:ss a'
                                                                    )}
                                                                    )
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <ReactMarkdown
                                                        source={incident.title}
                                                    />
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                }}
                                            >
                                                {incident.incidentPriority && (
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <div className="Flex-flex Flex-alignItems--center">
                                                            <span
                                                                className="Margin-right--4"
                                                                style={{
                                                                    display:
                                                                        'inline-block',
                                                                    backgroundColor: `rgba(${incident.incidentPriority.color.r},${incident.incidentPriority.color.g},${incident.incidentPriority.color.b},${incident.incidentPriority.color.a})`,
                                                                    height:
                                                                        '15px',
                                                                    width:
                                                                        '15px',
                                                                    borderRadius:
                                                                        '30%',
                                                                }}
                                                            ></span>
                                                            <span
                                                                className="Text-fontWeight--medium"
                                                                style={{
                                                                    color: `rgba(${incident.incidentPriority.color.r},${incident.incidentPriority.color.g},${incident.incidentPriority.color.b},${incident.incidentPriority.color.a})`,
                                                                }}
                                                                id={`name_${incident.incidentPriority.name}`}
                                                            >
                                                                {
                                                                    incident
                                                                        .incidentPriority
                                                                        .name
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                        {incident &&
                                                                        incident.incidentType &&
                                                                        incident.incidentType ===
                                                                            'offline' ? (
                                                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                    <span>
                                                                                        offline
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        ) : incident &&
                                                                          incident.incidentType &&
                                                                          incident.incidentType ===
                                                                              'online' ? (
                                                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                    <span>
                                                                                        online
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        ) : incident &&
                                                                          incident.incidentType &&
                                                                          incident.incidentType ===
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
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                        {!incident.acknowledged ? (
                                                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                    <span>
                                                                                        Not
                                                                                        Acknowledged{' '}
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                    {incident.acknowledgedBy ===
                                                                                    null ? (
                                                                                        incident.acknowledgedByZapier ? (
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/Fyipe.svg"
                                                                                                    style={{
                                                                                                        display:
                                                                                                            'inline-block',
                                                                                                        height:
                                                                                                            '20px',
                                                                                                        width:
                                                                                                            '20px',
                                                                                                        borderRadius:
                                                                                                            '50%',
                                                                                                        margin:
                                                                                                            '-1px 5px -5px -7px',
                                                                                                        backgroundColor:
                                                                                                            '#14AAD9',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    Zapier
                                                                                                </span>
                                                                                            </span>
                                                                                        ) : incident.acknowledgedByIncomingHttpRequest ? (
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/Fyipe.svg"
                                                                                                    style={{
                                                                                                        display:
                                                                                                            'inline-block',
                                                                                                        height:
                                                                                                            '20px',
                                                                                                        width:
                                                                                                            '20px',
                                                                                                        borderRadius:
                                                                                                            '50%',
                                                                                                        margin:
                                                                                                            '-1px 5px -5px -7px',
                                                                                                        backgroundColor:
                                                                                                            '#14AAD9',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    Incoming
                                                                                                    HTTP
                                                                                                    Request
                                                                                                </span>
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/Fyipe.svg"
                                                                                                    style={{
                                                                                                        display:
                                                                                                            'inline-block',
                                                                                                        height:
                                                                                                            '20px',
                                                                                                        width:
                                                                                                            '20px',
                                                                                                        borderRadius:
                                                                                                            '50%',
                                                                                                        margin:
                                                                                                            '-1px 5px -5px -7px',
                                                                                                        backgroundColor:
                                                                                                            '#14AAD9',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    Fyipe
                                                                                                </span>
                                                                                            </span>
                                                                                        )
                                                                                    ) : (
                                                                                        <span
                                                                                            style={{
                                                                                                cursor:
                                                                                                    'pointer',
                                                                                            }}
                                                                                        >
                                                                                            <img
                                                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                                                className="userIcon"
                                                                                                alt=""
                                                                                                style={{
                                                                                                    margin:
                                                                                                        '-1px 5px -5px -7px',
                                                                                                }}
                                                                                            />
                                                                                            <span>
                                                                                                {incident
                                                                                                    .acknowledgedBy
                                                                                                    .name
                                                                                                    ? incident
                                                                                                          .acknowledgedBy
                                                                                                          .name
                                                                                                    : 'Unknown User'}
                                                                                            </span>
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {incident.acknowledged ? (
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex Padding-horizontal--8"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                {
                                                                                    moment(
                                                                                        incident.acknowledgedAt
                                                                                    )
                                                                                        .from(
                                                                                            incident.createdAt
                                                                                        )
                                                                                        .split(
                                                                                            'ago'
                                                                                        )[0]
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div
                                                                            className="Box-root Flex Padding-horizontal--8"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                (
                                                                                {moment(
                                                                                    incident.acknowledgedAt
                                                                                ).format(
                                                                                    'MMMM Do YYYY, h:mm:ss a'
                                                                                )}

                                                                                )
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8">
                                                        {!incident.resolved ? (
                                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                    <span>
                                                                        Not
                                                                        Resolved
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                        {incident.resolvedBy ===
                                                                        null ? (
                                                                            incident.resolvedByZapier ? (
                                                                                <span>
                                                                                    <img
                                                                                        src="/dashboard/assets/img/Fyipe.svg"
                                                                                        style={{
                                                                                            display:
                                                                                                'inline-block',
                                                                                            height:
                                                                                                '20px',
                                                                                            width:
                                                                                                '20px',
                                                                                            borderRadius:
                                                                                                '50%',
                                                                                            margin:
                                                                                                '-1px 5px -5px -7px',
                                                                                            backgroundColor:
                                                                                                '#14AAD9',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        Zapier
                                                                                    </span>
                                                                                </span>
                                                                            ) : incident.resolvedByIncomingHttpRequest ? (
                                                                                <span>
                                                                                    <img
                                                                                        src="/dashboard/assets/img/Fyipe.svg"
                                                                                        style={{
                                                                                            display:
                                                                                                'inline-block',
                                                                                            height:
                                                                                                '20px',
                                                                                            width:
                                                                                                '20px',
                                                                                            borderRadius:
                                                                                                '50%',
                                                                                            margin:
                                                                                                '-1px 5px -5px -7px',
                                                                                            backgroundColor:
                                                                                                '#14AAD9',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        Incoming
                                                                                        HTTP
                                                                                        Request
                                                                                    </span>
                                                                                </span>
                                                                            ) : (
                                                                                <span>
                                                                                    <img
                                                                                        src="/dashboard/assets/img/Fyipe.svg"
                                                                                        style={{
                                                                                            display:
                                                                                                'inline-block',
                                                                                            height:
                                                                                                '20px',
                                                                                            width:
                                                                                                '20px',
                                                                                            borderRadius:
                                                                                                '50%',
                                                                                            margin:
                                                                                                '-1px 5px -5px -7px',
                                                                                            backgroundColor:
                                                                                                '#14AAD9',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        Fyipe
                                                                                    </span>
                                                                                </span>
                                                                            )
                                                                        ) : (
                                                                            <span
                                                                                style={{
                                                                                    cursor:
                                                                                        'pointer',
                                                                                }}
                                                                            >
                                                                                <img
                                                                                    src="/dashboard/assets/img/profile-user.svg"
                                                                                    className="userIcon"
                                                                                    alt=""
                                                                                    style={{
                                                                                        margin:
                                                                                            '-1px 5px -5px -7px',
                                                                                    }}
                                                                                />
                                                                                <span>
                                                                                    {incident
                                                                                        .resolvedBy
                                                                                        .name
                                                                                        ? incident
                                                                                              .resolvedBy
                                                                                              .name
                                                                                        : 'Unknown User'}
                                                                                </span>
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                </div>
                                                                {incident.resolvedAt ? (
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex Padding-horizontal--8"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                {
                                                                                    moment(
                                                                                        incident.resolvedAt
                                                                                    )
                                                                                        .from(
                                                                                            incident.createdAt
                                                                                        )
                                                                                        .split(
                                                                                            'ago'
                                                                                        )[0]
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div
                                                                            className="Box-root Flex Padding-horizontal--8"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                (
                                                                                {moment(
                                                                                    incident.resolvedAt
                                                                                ).format(
                                                                                    'MMMM Do YYYY, h:mm:ss a'
                                                                                )}

                                                                                )
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : this.props.incidents &&
                              (!this.props.incidents.incidents ||
                                  !this.props.incidents.incidents.length) &&
                              !this.props.incidents.requesting &&
                              !this.props.incidents.error ? (
                                <tr></tr>
                            ) : (
                                <tr>
                                    <td
                                        className="Padding-all--20 Text-align--center"
                                        colSpan="6"
                                    >
                                        <span id="noIncidentsInnerText">
                                            No incidents to display
                                        </span>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {(this.props.incidents && this.props.requesting) ||
                (this.props.monitorState &&
                    this.props.monitorState.fetchMonitorsIncidentRequest &&
                    this.props.incidents.incidents &&
                    this.props.incidents.incidents[0] &&
                    this.props.monitorState.fetchMonitorsIncidentRequest ===
                        this.props.incidents.incidents[0].monitorId) ? (
                    <ListLoader />
                ) : null}

                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {this.props.incidents &&
                    (!this.props.incidents.incidents ||
                        !this.props.incidents.incidents.length) &&
                    !this.props.incidents.requesting &&
                    !this.props.incidents.error
                        ? "We don't have any incidents yet"
                        : null}
                    {this.props.incidents && this.props.incidents.error
                        ? this.props.incidents.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`incident_count`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    <ShouldRender if={numberOfPages > 0}>
                                        Page {this.props.page} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={incidents}>
                                            <span id="numberOfIncidents">
                                                {this.props.incidents.count}
                                            </span>{' '}
                                            {this.props.incidents.count > 1
                                                ? 'total incidents'
                                                : 'Incident'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfIncidents">
                                            {this.props.incidents.count}{' '}
                                            {this.props.incidents.count > 1
                                                ? 'total incidents'
                                                : 'Incident'}
                                        </span>
                                    </ShouldRender>
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
                                            this.props.incidents
                                                ? this.props.incidents._id
                                                : null,
                                            this.props.incidents.skip,
                                            this.props.incidents.limit
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
                                            this.props.incidents
                                                ? this.props.incidents._id
                                                : null,
                                            this.props.incidents.skip,
                                            this.props.incidents.limit
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

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ markAsRead, animateSidebar }, dispatch);
};

function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        requesting: state.incident.incidents.requesting,
        searchValues: state.form.search && state.form.search.values,
    };
}

IncidentList.displayName = 'IncidentList';

IncidentList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    incidents: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitorState: PropTypes.object.isRequired,
    currentProject: PropTypes.object,
    filteredIncidents: PropTypes.array,
    requesting: PropTypes.bool,
    isFiltered: PropTypes.bool,
    markAsRead: PropTypes.func,
    animateSidebar: PropTypes.func,
    page: PropTypes.number,
    numberOfPage: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentList);
