import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import { history } from '../../store';
import { markAsRead } from '../../actions/notification';
import { animateSidebar } from '../../actions/animateSidebar';
import { API_URL } from '../../config';
import ShouldRender from '../basic/ShouldRender';

export class IncidentList extends Component {
    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors.length === 0) {
            return 'No monitor in this incident';
        }
        if (monitors.length === 1) {
            return monitors[0].monitorId.name;
        }
        if (monitors.length === 2) {
            return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
        }

        return `${monitors[0].monitorId.name}, ${
            monitors[1].monitorId.name
        } and ${monitors.length - 2} others`;
    };

    render() {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.skip &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            typeof this.props.incidents.skip === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.skip = parseInt(this.props.incidents.skip, 10);
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.limit &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            typeof this.props.incidents.limit === 'string'
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.limit = parseInt(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.incidents.limit,
                10
            );
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
        if (this.props.incidents && !this.props.incidents.skip)
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.skip = 0;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
        if (this.props.incidents && !this.props.incidents.limit)
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.limit = 0;

        let canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.count >
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.incidents.skip + this.props.incidents.limit
                ? true
                : false;
        let canPrev =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents && this.props.incidents.skip <= 0
                ? false
                : true;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            (this.props.incidents.requesting || !this.props.incidents.incidents)
        ) {
            canNext = false;
            canPrev = false;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'numberOfPage' does not exist on type 'Re... Remove this comment to see the full error message
        const numberOfPages = this.props.numberOfPage
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'numberOfPage' does not exist on type 'Re... Remove this comment to see the full error message
            ? this.props.numberOfPage
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            : Math.ceil(parseInt(this.props.incidents.count) / 10);
        let incidents =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
            this.props.filteredIncidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
            this.props.filteredIncidents.length > 0
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
                ? this.props.filteredIncidents
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
                : this.props.filteredIncidents &&
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'filteredIncidents' does not exist on typ... Remove this comment to see the full error message
                  this.props.filteredIncidents.length === 0 &&
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'isFiltered' does not exist on type 'Read... Remove this comment to see the full error message
                  this.props.isFiltered
                ? []
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                : this.props.incidents &&
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                  this.props.incidents.incidents &&
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                  this.props.incidents.incidents.length > 0
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                ? this.props.incidents.incidents
                : [];

        const updatedIncidents: $TSFixMe = [],
            incidentIds: $TSFixMe = [];
        incidents.forEach((incident: $TSFixMe) => {
            if (!incidentIds.includes(incident._id)) {
                updatedIncidents.push(incident);
                incidentIds.push(incident._id);
            }
        });
        incidents = updatedIncidents;

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
                                            <span>Monitor(s)</span>
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; id: string; type: strin... Remove this comment to see the full error message
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
                                incidents.map((incident: $TSFixMe, i: $TSFixMe) => {
                                    let probeName = 'OneUptime';
                                    let probeImage =
                                        '/dashboard/assets/img/ou-wb.svg';
                                    let customProbeImage = false;

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
                                            customProbeImage = true;
                                        }
                                    }

                                    return (
                                        <tr
                                            id={`incident_${i}`}
                                            key={incident._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink createdIncidentListItem"
                                            onClick={() => {
                                                setTimeout(() => {
                                                    if (
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                                        this.props.componentSlug
                                                    ) {
                                                        history.push(
                                                            '/dashboard/project/' +
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                    .currentProject
                                                                    .slug +
                                                                '/component/' +
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                                                    .componentSlug +
                                                                '/incidents/' +
                                                                incident.slug
                                                        );
                                                    } else {
                                                        history.push(
                                                            '/dashboard/project/' +
                                                                incident
                                                                    .projectId
                                                                    .slug +
                                                                '/incidents/' +
                                                                incident.slug
                                                        );
                                                    }
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                                    this.props.animateSidebar(
                                                        false
                                                    );
                                                }, 200);
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'markAsRead' does not exist on type 'Read... Remove this comment to see the full error message
                                                this.props.markAsRead(
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                    this.props.currentProject
                                                        ._id,
                                                    incident.notifications
                                                );
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
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
                                                <div
                                                    className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                    id={`incident_${this.handleMonitorList(
                                                        incident.monitors
                                                    )}_${i}`}
                                                >
                                                    {incident.monitors &&
                                                        this.handleMonitorList(
                                                            incident.monitors
                                                        )}
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
                                                            null ||
                                                        !incident.createdById ? (
                                                            incident.createdByZapier ? (
                                                                <div className="Box-root Margin-right--16">
                                                                    <img
                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                '#121212',
                                                                        }}
                                                                        alt=""
                                                                    />
                                                                    <span>
                                                                        Zapier
                                                                    </span>
                                                                </div>
                                                            ) : incident.createdByApi ? (
                                                                <div className="Box-root Margin-right--16">
                                                                    <img
                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                '#121212',
                                                                        }}
                                                                        alt=""
                                                                    />
                                                                    <span>
                                                                        API
                                                                    </span>
                                                                </div>
                                                            ) : incident.createdByIncomingHttpRequest ? (
                                                                <div className="Box-root Margin-right--16">
                                                                    <img
                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                '#121212',
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
                                                                                backgroundColor: customProbeImage
                                                                                    ? '#14AAD9'
                                                                                    : '#121212',
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
                                                id={`incident_${this.handleMonitorList(
                                                    incident.monitors
                                                )}_title`}
                                            >
                                                <div
                                                    className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                    id={`incident_title_${i}`}
                                                >
                                                    <ReactMarkdown>
                                                        {incident.title}
                                                    </ReactMarkdown>
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
                                                                                                    src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                            '#121212',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    Zapier
                                                                                                </span>
                                                                                            </span>
                                                                                        ) : incident.acknowledgedByApi ? (
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                            '#121212',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    API
                                                                                                </span>
                                                                                            </span>
                                                                                        ) : incident.acknowledgedByIncomingHttpRequest ? (
                                                                                            <span>
                                                                                                <img
                                                                                                    src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                            '#121212',
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
                                                                                                    src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                            '#121212',
                                                                                                    }}
                                                                                                    alt=""
                                                                                                />
                                                                                                <span>
                                                                                                    OneUptime
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
                                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                '#121212',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        Zapier
                                                                                    </span>
                                                                                </span>
                                                                            ) : incident.resolvedByApi ? (
                                                                                <span>
                                                                                    <img
                                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                '#121212',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        API
                                                                                    </span>
                                                                                </span>
                                                                            ) : incident.resolvedByIncomingHttpRequest ? (
                                                                                <span>
                                                                                    <img
                                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                '#121212',
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
                                                                                        src="/dashboard/assets/img/ou-wb.svg"
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
                                                                                                '#121212',
                                                                                        }}
                                                                                        alt=""
                                                                                    />
                                                                                    <span>
                                                                                        OneUptime
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                            ) : this.props.incidents &&
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                              (!this.props.incidents.incidents ||
                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                  !this.props.incidents.incidents.length) &&
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                              !this.props.incidents.requesting &&
                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                              !this.props.incidents.error ? (
                                <tr></tr>
                            ) : (
                                <tr>
                                    <td
                                        className="Padding-all--20 Text-align--center"
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                {(this.props.incidents && this.props.requesting) ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                (this.props.monitorState &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                    this.props.monitorState.fetchMonitorsIncidentRequest &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.incidents.incidents &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.incidents.incidents[0] &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                    this.props.monitorState.fetchMonitorsIncidentRequest ===
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    {this.props.incidents &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    (!this.props.incidents.incidents ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                        !this.props.incidents.incidents.length) &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    !this.props.incidents.requesting &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    !this.props.incidents.error
                        ? "We don't have any incidents yet"
                        : null}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                    {this.props.incidents && this.props.incidents.error
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        Page {this.props.page} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={incidents}>
                                            <span id="numberOfIncidents">
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                                {this.props.incidents.count}
                                            </span>{' '}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            {this.props.incidents.count > 1
                                                ? 'total incidents'
                                                : 'Incident'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfIncidents">
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            {this.props.incidents.count}{' '}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'prevClicked' does not exist on type 'Rea... Remove this comment to see the full error message
                                        this.props.prevClicked(
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.incidents
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                                ? this.props.incidents._id
                                                : null,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.incidents.skip,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextClicked' does not exist on type 'Rea... Remove this comment to see the full error message
                                        this.props.nextClicked(
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.incidents
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                                ? this.props.incidents._id
                                                : null,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.incidents.skip,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ markAsRead, animateSidebar }, dispatch);
};

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const { componentSlug } = ownProps.match.params;
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        requesting: state.incident.incidents.requesting,
        componentSlug,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentList.displayName = 'IncidentList';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncidentList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    incidents: PropTypes.object,
    monitorState: PropTypes.object.isRequired,
    currentProject: PropTypes.object,
    filteredIncidents: PropTypes.array,
    requesting: PropTypes.bool,
    isFiltered: PropTypes.bool,
    markAsRead: PropTypes.func,
    animateSidebar: PropTypes.func,
    page: PropTypes.number,
    numberOfPage: PropTypes.number,
    componentSlug: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(IncidentList)
);
