import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'huma... Remove this comment to see the full error message
import humanize from 'humanize-duration';
import { ListLoader } from '../basic/Loader';
import {
    getActiveMonitors,
    getActiveMonitorsRequest,
    getActiveMonitorsSuccess,
    getActiveMonitorsError,
} from '../../actions/reports';

class Monitors extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            monitors: [],
            skip: 0,
            limit: 10,
            page: 1,
        };
        this.handleNext = this.handleNext.bind(this);
        this.handlePrevious = this.handlePrevious.bind(this);
    }
    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getActiveMonitors' does not exist on typ... Remove this comment to see the full error message
            getActiveMonitors,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
        } = this.props;
        getActiveMonitors(currentProject, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps: $TSFixMe, prevState: $TSFixMe) {
        const {
            getActiveMonitors,
            currentProject,
            startDate,
            endDate,
            activeMonitors,
        } = nextProps;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate !== this.props.startDate ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate !== this.props.endDate ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject !== this.props.currentProject
        ) {
            getActiveMonitors(
                currentProject,
                startDate,
                endDate,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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

    handleNext(event: $TSFixMe) {
        event.preventDefault();
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getActiveMonitors' does not exist on typ... Remove this comment to see the full error message
            getActiveMonitors,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const skip = this.state.skip + this.state.limit;
        getActiveMonitors(currentProject, startDate, endDate, skip, 10);
        this.setState({
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            page: this.state.page + 1,
        });
    }

    handlePrevious(event: $TSFixMe) {
        event.preventDefault();
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getActiveMonitors' does not exist on typ... Remove this comment to see the full error message
            getActiveMonitors,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const skip = this.state.skip - this.state.limit;
        getActiveMonitors(currentProject, startDate, endDate, skip, 10);
        this.setState({
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            page: this.state.page === 1 ? 1 : this.state.page - 1,
        });
    }

    render() {
        let canNext =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            this.props.activeMonitors &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            this.props.activeMonitors.count &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            this.props.activeMonitors.count > this.state.skip + this.state.limit
                ? true
                : false;
        let canPrev =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            this.props.activeMonitors && this.state.skip <= 0 ? false : true;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            this.props.activeMonitors &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
            (this.props.activeMonitors.requesting ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                !this.props.activeMonitors.members)
        ) {
            canNext = false;
            canPrev = false;
        }
        const numberOfPages = Math.ceil(
            parseInt(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                this.props.activeMonitors && this.props.activeMonitors.count
            ) / 10
        );

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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                            {this.state.monitors.map((monitor: $TSFixMe) => {
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                {this.props.activeMonitors &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    {this.props.activeMonitors &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    (!this.props.activeMonitors.monitors ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                        !this.props.activeMonitors.monitors.length) &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    !this.props.activeMonitors.requesting &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    !this.props.activeMonitors.error
                        ? "We don't have any report for this period"
                        : null}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    {this.props.activeMonitors &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                    this.props.activeMonitors.error
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                        ? this.props.activeMonitors.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {numberOfPages > 0
                                        ? `Page ${
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                              this.state.page
                                          } of ${numberOfPages} (${this.props
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                                              .activeMonitors &&
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                                              this.props.activeMonitors
                                                  .count} Monitor${
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                                              this.props.activeMonitors &&
                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeMonitors' does not exist on type '... Remove this comment to see the full error message
                                              this.props.activeMonitors
                                                  .count === 1
                                                  ? ''
                                                  : 's'
                                          })`
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

const mapStateToProps = (state: $TSFixMe) => ({
    activeMonitors: state.report.activeMonitors
});

const mapDispatchToProps = (dispatch: $TSFixMe) => ({
    ...bindActionCreators(actionCreators, dispatch)
});
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Monitors.displayName = 'Monitors';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Monitors.propTypes = {
    getActiveMonitors: PropTypes.func,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    activeMonitors: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
};

export default connect(mapStateToProps, mapDispatchToProps)(Monitors);
