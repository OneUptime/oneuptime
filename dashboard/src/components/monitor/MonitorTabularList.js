import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader } from '../basic/Loader';
import { history } from '../../store';
import {
    getMonitorStatus,
    getMonitorStatusColor,
    replaceDashWithSpace,
    getMonitorTypeBadgeColor,
} from '../../config';
import Badge from '../common/Badge';

export class MonitorTabularList extends Component {
    render() {
        if (
            this.props.monitors &&
            this.props.monitors.skip &&
            typeof this.props.monitors.skip === 'string'
        ) {
            this.props.monitors.skip = parseInt(this.props.monitors.skip, 10);
        }
        if (
            this.props.monitors &&
            this.props.monitors.limit &&
            typeof this.props.monitors.limit === 'string'
        ) {
            this.props.monitors.limit = parseInt(this.props.monitors.limit, 10);
        }
        if (!this.props.monitors.skip) this.props.monitors.skip = 0;
        if (!this.props.monitors.limit) this.props.monitors.limit = 0;

        let canNext =
            this.props.monitors &&
            this.props.monitors.count &&
            this.props.monitors.count >
                this.props.monitors.skip + this.props.monitors.limit
                ? true
                : false;
        let canPrev =
            this.props.monitors && this.props.monitors.skip <= 0 ? false : true;

        if (
            this.props.monitors &&
            (this.props.monitors.requesting || !this.props.monitors)
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
                                            <span>Monitor Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Type</span>
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
                                            <span>Status</span>
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
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {this.props.monitors &&
                            this.props.monitors &&
                            this.props.monitors.length > 0 ? (
                                this.props.monitors.map((monitor, i) => {
                                    const status = getMonitorStatus(
                                        monitor.incidents
                                    );
                                    const statusColor = getMonitorStatusColor(
                                        status
                                    );
                                    return (
                                        <tr
                                            id={`monitor_${i}`}
                                            key={monitor._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                            onClick={() => {
                                                history.push(
                                                    '/dashboard/project/' +
                                                        this.props
                                                            .currentProject
                                                            ._id +
                                                        '/' +
                                                        this.props.componentId +
                                                        '/monitoring/' +
                                                        monitor._id
                                                );
                                            }}
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                {monitor.name}
                                                            </span>
                                                        </div>
                                                    </span>
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
                                                        <Badge
                                                            color={getMonitorTypeBadgeColor(
                                                                monitor.type
                                                            )}
                                                        >
                                                            {replaceDashWithSpace(
                                                                monitor.type
                                                            )}
                                                        </Badge>
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
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"></div>
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
                                                        <div
                                                            className={`Badge Badge--color--${statusColor} Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                        >
                                                            <span
                                                                className={`Badge-text Text-typeface--upper Text-color--${statusColor} Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper`}
                                                            >
                                                                ⁣{status}
                                                            </span>
                                                        </div>
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
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8"></div>
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
                                                                                        monitor.createdAt
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
                                                                                monitor.createdAt
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
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {(this.props.monitors && this.props.monitors.requesting) ||
                (this.props.monitorState &&
                    this.props.monitorState.fetchMonitorsIncidentRequest &&
                    this.props.monitors &&
                    this.props.monitors[0] &&
                    this.props.monitorState.fetchMonitorsIncidentRequest ===
                        this.props.monitors[0].monitorId) ? (
                    <ListLoader />
                ) : null}

                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {this.props.monitors &&
                    (!this.props.monitors || !this.props.monitors.length) &&
                    !this.props.monitors.requesting &&
                    !this.props.monitors.error
                        ? "We don't have any monitors added yet"
                        : null}
                    {this.props.monitors && this.props.monitors.error
                        ? this.props.monitors.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.monitors &&
                                    this.props.monitors.count
                                        ? this.props.monitors.count +
                                          (this.props.monitors &&
                                          this.props.monitors.count > 1
                                              ? ' Monitors'
                                              : ' Monitor')
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
                                            this.props.monitors
                                                ? this.props.monitors._id
                                                : null,
                                            this.props.monitors.skip,
                                            this.props.monitors.limit
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
                                            this.props.monitors
                                                ? this.props.monitors._id
                                                : null,
                                            this.props.monitors.skip,
                                            this.props.monitors.limit
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

function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
    };
}

MonitorTabularList.displayName = 'MonitorTabularList';

MonitorTabularList.propTypes = {
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    componentId: PropTypes.string.isRequired,
    monitors: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitorState: PropTypes.object.isRequired,
    currentProject: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorTabularList);
