import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import { history } from '../../store';

const IncidentTimelineList = props => {
    const {
        incident: { timeline },
        prevClicked,
        nextClicked,
        requesting,
        error,
    } = props;
    let { count, skip, limit } = props;

    if (count && typeof count === 'string') {
        count = parseInt(count, 10);
    }
    if (skip && typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (limit && typeof limit === 'string') {
        limit = parseInt(limit, 10);
    }
    if (!count) count = timeline && timeline.length ? timeline.length : 0;
    if (!skip) skip = 0;
    if (!limit) limit = 10;

    let canNext = count > skip + limit ? true : false;
    let canPrev = skip <= 0 ? false : true;

    if (requesting || count < 1) {
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
                                        <span>Reported By</span>
                                    </span>
                                </div>
                            </td>
                            <td
                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px' }}
                            >
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                        <span>Reported At</span>
                                    </span>
                                </div>
                            </td>
                            <td
                                className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px' }}
                            >
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                    <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                        <span>Status</span>
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
                        {timeline && timeline.length > 0 ? (
                            timeline.map((log, i) => {
                                return (
                                    <tr
                                        id={`incident_timeline_${i}`}
                                        key={i}
                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
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
                                                    {log.probeId ? (
                                                        <div className="Box-root Margin-right--16">
                                                            <img
                                                                src="/dashboard/assets/img/robotics.svg"
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
                                                                {log.probeId
                                                                    .probeName
                                                                    ? log
                                                                          .probeId
                                                                          .probeName
                                                                    : 'Unknown Probe'}
                                                            </span>
                                                        </div>
                                                    ) : log.createdByZapier ? (
                                                        <div className="Box-root Margin-right--16">
                                                            <img
                                                                src="/dashboard/assets/img/robotics.svg"
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
                                                            <span>Zapier</span>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="Box-root Margin-right--16"
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            onClick={() => {
                                                                history.push(
                                                                    '/profile/' +
                                                                        log
                                                                            .createdById
                                                                            ._id
                                                                );
                                                            }}
                                                        >
                                                            <img
                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                className="userIcon"
                                                                alt=""
                                                            />
                                                            <span>
                                                                {log.createdById
                                                                    .name
                                                                    ? log
                                                                          .createdById
                                                                          .name
                                                                    : 'Unknown User'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </span>
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
                                                                                {currentTimeZone
                                                                                    ? momentTz(
                                                                                          log.createdAt
                                                                                      )
                                                                                          .tz(
                                                                                              currentTimeZone
                                                                                          )
                                                                                          .format(
                                                                                              'lll'
                                                                                          )
                                                                                    : moment(
                                                                                          log.createdAt
                                                                                      ).format(
                                                                                          'lll'
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
                                                                    {log &&
                                                                    log.status &&
                                                                    (log.status ===
                                                                        'closed' ||
                                                                        log.status ===
                                                                            'offline') ? (
                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {
                                                                                        log.status
                                                                                    }
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    ) : log &&
                                                                      log.status &&
                                                                      (log.status ===
                                                                          'resolved' ||
                                                                          log.status ===
                                                                              'online') ? (
                                                                        <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {
                                                                                        log.status
                                                                                    }
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    ) : log &&
                                                                      log.status &&
                                                                      (log.status ===
                                                                          'acknowledged' ||
                                                                          log.status ===
                                                                              'degraded') ? (
                                                                        <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {
                                                                                        log.status
                                                                                    }
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    ) : log &&
                                                                      log.status &&
                                                                      (log.status ===
                                                                          'created' ||
                                                                          log.status ===
                                                                              'internal notes added' ||
                                                                          log.status ===
                                                                              'investigation notes added') ? (
                                                                        <div className="Badge Badge--color--blue Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--blue Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {
                                                                                        log.status
                                                                                    }
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    ) : log &&
                                                                      log.status &&
                                                                      (log.status ===
                                                                          'internal notes updated' ||
                                                                          log.status ===
                                                                              'investigation notes updated') ? (
                                                                        <div className="Badge Badge--color--purple Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--purple Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {
                                                                                        log.status
                                                                                    }
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                <span>
                                                                                    {log.status ||
                                                                                        'Unknown Status'}
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
                                        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {requesting ? <ListLoader /> : null}

            <div
                style={{
                    textAlign: 'center',
                    marginTop: '10px',
                    padding: '0 10px',
                }}
            >
                {!timeline || !timeline.length
                    ? "We don't have any activity yet"
                    : null}
                {error}
            </div>
            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {count
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
                                id="btnTimelinePrev"
                                onClick={() => {
                                    prevClicked();
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
                                id="btnTimelineNext"
                                onClick={() => {
                                    nextClicked();
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
};

IncidentTimelineList.displayName = 'IncidentTimelineList';

IncidentTimelineList.propTypes = {
    incident: PropTypes.object,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    requesting: PropTypes.bool,
    error: PropTypes.any,
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

function mapStateToProps(state) {
    return {
        count: state.incident.incident.count,
        skip: state.incident.incident.skip,
        limit: state.incident.incident.limit,
        requesting: state.incident.fetchIncidentTimelineRequest,
        error: state.incident.incident.error,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentTimelineList);
