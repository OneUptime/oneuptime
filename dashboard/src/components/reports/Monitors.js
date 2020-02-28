import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import humanize from 'humanize-duration';
import { ListLoader } from '../basic/Loader';
import {
    getActiveMonitors,
    getActiveMonitorsRequest,
    getActiveMonitorsSuccess,
    getActiveMonitorsError,
} from '../../actions/reports';

class Monitors extends Component {
    constructor(props) {
        super(props);
        this.state = {
            monitors: [],
            skip: 0,
            limit: 10,
        };
        this.handleNext = this.handleNext.bind(this);
        this.handlePrevious = this.handlePrevious.bind(this);
    }
    componentDidMount() {
        const {
            getActiveMonitors,
            currentProject,
            startDate,
            endDate,
        } = this.props;
        getActiveMonitors(currentProject, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps, prevState) {
        const {
            getActiveMonitors,
            currentProject,
            startDate,
            endDate,
            activeMonitors,
        } = nextProps;

        if (
            startDate !== this.props.startDate ||
            endDate !== this.props.endDate
        ) {
            getActiveMonitors(
                currentProject,
                startDate,
                endDate,
                this.state.skip,
                10
            );
        }

        if (prevState.monitors !== activeMonitors.monitors) {
            this.setState({
                monitors: activeMonitors.monitors,
            });
        }
    }

    handleNext(event) {
        event.preventDefault();
        const {
            currentProject,
            startDate,
            endDate,
            getActiveMonitors,
        } = this.props;
        const skip = this.state.skip + this.state.limit;
        getActiveMonitors(currentProject, startDate, endDate, skip, 10);
        this.setState({
            skip,
        });
    }

    handlePrevious(event) {
        event.preventDefault();
        const {
            currentProject,
            startDate,
            endDate,
            getActiveMonitors,
        } = this.props;
        const skip = this.state.skip - this.state.limit;
        getActiveMonitors(currentProject, startDate, endDate, skip, 10);
        this.setState({
            skip,
        });
    }

    render() {
        let canNext =
            this.props.activeMonitors &&
            this.props.activeMonitors.count &&
            this.props.activeMonitors.count > this.state.skip + this.state.limit
                ? true
                : false;
        let canPrev =
            this.props.activeMonitors && this.state.skip <= 0 ? false : true;

        if (
            this.props.activeMonitors &&
            (this.props.activeMonitors.requesting ||
                !this.props.activeMonitors.members)
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
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Monitor</span>
                                        </span>
                                    </div>
                                </td>
                                {/* <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                    </td> */}
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        textAlign: 'center',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Incidents Created</span>
                                        </span>
                                    </div>
                                </td>
                                {/* <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Texan style={{ color: 'darkorange'}}>{averageAcknowledgeTimet-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                    </td> */}
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>
                                                Average Acknowledge Time
                                            </span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Average Resolve Time</span>
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
                            {this.state.monitors.map(monitor => {
                                const {
                                    monitorName,
                                    incidents,
                                    monitorId,
                                    averageAcknowledgeTime,
                                    averageResolved,
                                } = monitor;
                                return (
                                    <tr
                                        key={monitorId}
                                        className="Table-row db-ListViewItem bs-ActionsParent"
                                    >
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                            style={{
                                                height: '1px',
                                                width: '187px',
                                                minWidth: '120px',
                                            }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16">
                                                        <span>
                                                            {monitorName}
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
                                            }}
                                        >
                                            {/* <a className="db-ListViewItem-link"> */}
                                            <div
                                                className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                style={{ textAlign: 'center' }}
                                            >
                                                ⁣
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                                                        <div>{incidents}</div>
                                                    </div>
                                                </span>
                                            </div>
                                            {/* </a> */}
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root">
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'darkorange',
                                                                }}
                                                            >
                                                                {humanize(
                                                                    averageAcknowledgeTime,
                                                                    {
                                                                        round: true,
                                                                        largest: 2,
                                                                    }
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </span>
                                            </div>
                                        </td>
                                        <td
                                            aria-hidden="true"
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{
                                                height: '1px',
                                            }}
                                        >
                                            {/* <a className="db-ListViewItem-link"> */}
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                ⁣
                                                <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                                                        <div
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'green',
                                                                }}
                                                            >
                                                                {humanize(
                                                                    averageResolved,
                                                                    {
                                                                        round: true,
                                                                        largest: 2,
                                                                    }
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </span>
                                            </div>
                                            {/* </a> */}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {this.props.activeMonitors &&
                this.props.activeMonitors.requesting ? (
                    <ListLoader />
                ) : null}
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {this.props.activeMonitors &&
                    (!this.props.activeMonitors.monitors ||
                        !this.props.activeMonitors.monitors.length) &&
                    !this.props.activeMonitors.requesting &&
                    !this.props.activeMonitors.error
                        ? "We don't have any report for this period"
                        : null}
                    {this.props.activeMonitors &&
                    this.props.activeMonitors.error
                        ? this.props.activeMonitors.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.activeMonitors &&
                                    this.props.activeMonitors.count
                                        ? this.props.activeMonitors.count +
                                          (this.props.activeMonitors &&
                                          this.props.activeMonitors.count > 1
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
                                    onClick={this.handlePrevious}
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
                                    onClick={this.handleNext}
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

const actionCreators = {
    getActiveMonitors,
    getActiveMonitorsRequest,
    getActiveMonitorsSuccess,
    getActiveMonitorsError,
};

const mapStateToProps = state => ({
    activeMonitors: state.report.activeMonitors,
});

const mapDispatchToProps = dispatch => ({
    ...bindActionCreators(actionCreators, dispatch),
});
Monitors.displayName = 'Monitors';

Monitors.propTypes = {
    getActiveMonitors: PropTypes.func,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    activeMonitors: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
};

export default connect(mapStateToProps, mapDispatchToProps)(Monitors);
