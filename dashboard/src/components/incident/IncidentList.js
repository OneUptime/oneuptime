import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import { history } from '../../store';
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
        if (!this.props.incidents.skip) this.props.incidents.skip = 0;
        if (!this.props.incidents.limit) this.props.incidents.limit = 0;

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

        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
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
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>status</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Created</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-left"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
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
                                    id="placeholder-right"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
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
                            {this.props.incidents &&
                            this.props.incidents.incidents &&
                            this.props.incidents.incidents.length > 0 ? (
                                this.props.incidents.incidents.map(
                                    (incident, i) => {
                                        return (
                                            <tr
                                                id={`incident_${
                                                    incident.monitorId
                                                        ? incident.monitorId
                                                              .name
                                                        : this.props.incidents
                                                              .name
                                                        ? this.props.incidents
                                                              .name
                                                        : 'Unknown Monitor'
                                                }_${i}`}
                                                key={incident._id}
                                                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                                onClick={() => {
                                                    history.push(
                                                        '/project/' +
                                                            this.props
                                                                .currentProject
                                                                ._id +
                                                            '/' +
                                                            this.props
                                                                .componentId +
                                                            '/incidents/' +
                                                            incident._id
                                                    );
                                                }}
                                            >
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
                                                                    {incident.createdById ===
                                                                    null
                                                                        ? incident.createdByZapier
                                                                            ? 'Zapier'
                                                                            : 'Fyipe'
                                                                        : incident
                                                                              .createdById
                                                                              .name}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
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
                                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
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
                                                                                        {moment(
                                                                                            incident.createdAt
                                                                                        ).fromNow()}{' '}
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div>
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
                                                                                    incident.createdAt
                                                                                ).format(
                                                                                    'MMMM Do YYYY, h:mm:ss a'
                                                                                )}

                                                                                )
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td
                                                    aria-hidden="true"
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        maxWidth: '48px',
                                                        minWidth: '48px',
                                                        width: '48px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-link">
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            ⁣
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
                                                                                        <span>
                                                                                            {incident.acknowledgedBy ===
                                                                                            null
                                                                                                ? incident.acknowledgedByZapier
                                                                                                    ? 'Zapier'
                                                                                                    : 'fyipe'
                                                                                                : incident
                                                                                                      .acknowledgedBy
                                                                                                      .name}
                                                                                        </span>
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
                                                    aria-hidden="true"
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        maxWidth: '48px',
                                                        minWidth: '48px',
                                                        width: '48px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-link">
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            ⁣
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
                                                                            <span>
                                                                                {incident.resolvedBy ===
                                                                                null
                                                                                    ? incident.resolvedByZapier
                                                                                        ? 'Zapier'
                                                                                        : 'fyipe'
                                                                                    : incident
                                                                                          .resolvedBy
                                                                                          .name}
                                                                            </span>
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
                                                <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                            </tr>
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {(this.props.incidents && this.props.incidents.requesting) ||
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
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.incidents &&
                                    this.props.incidents.count
                                        ? this.props.incidents.count +
                                          (this.props.incidents &&
                                          this.props.incidents.count > 1
                                              ? ' Incidents'
                                              : ' Incident')
                                        : null}
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
    return bindActionCreators({}, dispatch);
};

function mapStateToProps(state, props) { console.info('Incidents', props);
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
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
    componentId: PropTypes.string.isRequired,
    monitorState: PropTypes.object.isRequired,
    currentProject: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentList);
