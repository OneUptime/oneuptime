import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import {
    getStatusPageIndividualNote,
    getIndividualEvent,
    notmonitoredDays,
    showIncidentCard,
} from '../actions/status';

class BlockChart extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.requestday = this.requestday.bind(this);
    }

    requestday = (need: $TSFixMe, date: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showIncidentCard' does not exist on type... Remove this comment to see the full error message
        this.props.showIncidentCard(false);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const theme = this.props.theme ? true : false;
        if (need) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getStatusPageIndividualNote' does not ex... Remove this comment to see the full error message
            this.props.getStatusPageIndividualNote(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusData.projectId._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                this.props.monitorId,
                date,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.monitorName,
                need,
                theme
            );
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.time && this.props.time.emptytime) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'notmonitoredDays' does not exist on type... Remove this comment to see the full error message
                this.props.notmonitoredDays(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.monitorId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    this.props.time.emptytime,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.monitorName,
                    'No data available for this date'
                );
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'notmonitoredDays' does not exist on type... Remove this comment to see the full error message
                this.props.notmonitoredDays(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.monitorId,
                    date,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.monitorName,
                    'No incidents yet'
                );
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIndividualEvent' does not exist on ty... Remove this comment to see the full error message
        this.props.getIndividualEvent(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.statusData.projectId._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.monitorId,
            date,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorName,
            theme
        );
    };

    render() {
        let bar = null;
        let title = null;
        let title1 = null;
        let need = false;
        let backgroundColor;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
        const { colors } = this.props.statusData;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        if (this.props.time && this.props.time.status) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.time.status === 'disabled') {
                let disabledTimeInMinutes, disabledtime;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                if (this.props.time.disabledTime < 60) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    disabledTimeInMinutes = this.props.time.disabledTime;
                    disabledtime = `${disabledTimeInMinutes} second${
                        disabledTimeInMinutes === 1 ? '' : 's'
                    }`;
                } else {
                    disabledTimeInMinutes = Math.floor(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.time.disabledTime / 60
                    );
                    disabledtime = `${disabledTimeInMinutes} minute${
                        disabledTimeInMinutes === 1 ? '' : 's'
                    }`;
                }

                if (disabledTimeInMinutes > 60) {
                    disabledtime = `${Math.floor(
                        disabledTimeInMinutes / 60
                    )} hrs ${disabledTimeInMinutes % 60} minutes`;
                }

                bar = 'bar down';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = `Disabled for ${disabledtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.disabled.r}, ${colors.disabled.g}, ${colors.disabled.b}, ${colors.disabled.a})`;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            } else if (this.props.time.status === 'offline') {
                let downTimeInMinutes, downtime;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                if (this.props.time.downTime < 60) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    downTimeInMinutes = this.props.time.downTime;
                    downtime = `${downTimeInMinutes} second${
                        downTimeInMinutes === 1 ? '' : 's'
                    }`;
                } else {
                    downTimeInMinutes = Math.floor(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.time.downTime / 60
                    );
                    downtime = `${downTimeInMinutes} minute${
                        downTimeInMinutes === 1 ? '' : 's'
                    }`;
                }

                if (downTimeInMinutes > 60) {
                    downtime = `${Math.floor(
                        downTimeInMinutes / 60
                    )} hrs ${downTimeInMinutes % 60} minutes`;
                }

                bar = 'bar down';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = `Down for ${downtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            } else if (this.props.time.status === 'degraded') {
                let degradedTimeInMinutes;
                let degradedtime;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                if (this.props.time.degradedTime < 60) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    degradedTimeInMinutes = this.props.time.degradedTime;
                    degradedtime = `${degradedTimeInMinutes} second${
                        degradedTimeInMinutes === 1 ? '' : 's'
                    }`;
                } else {
                    degradedTimeInMinutes = Math.floor(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.time.degradedTime / 60
                    );
                    degradedtime = `${degradedTimeInMinutes} minute${
                        degradedTimeInMinutes === 1 ? '' : 's'
                    }`;
                }

                if (degradedTimeInMinutes > 60) {
                    degradedtime = `${Math.floor(
                        degradedTimeInMinutes / 60
                    )} hrs ${degradedTimeInMinutes % 60} minutes`;
                }

                bar = 'bar mid';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = `Degraded for ${degradedtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`;
            } else {
                bar = 'bar';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = 'No downtime';
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`;
            }
        } else {
            bar = 'bar empty';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            title = this.props.time
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                ? moment(this.props.time.date).format('LL')
                : 'N/A';
            title1 = '100% uptime';
            if (colors)
                backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`;
        }

        const dateId = title.replace(/, | /g, '');
        const extra = ' resize-style';
        let style, classes, content;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (this.props.theme) {
            style = {
                outline: 'none',
                backgroundColor:
                    backgroundColor === 'rgba(108, 219, 86, 1)'
                        ? '#49c3b1'
                        : backgroundColor === 'rgba(250, 109, 70, 1)'
                        ? '#FA6D46'
                        : backgroundColor === 'rgba(255, 222, 36, 1)'
                        ? '#e39f48'
                        : backgroundColor,
                opacity: 1,
                width: '7px',
            };
            classes = bar + extra;
            content = (
                <div className="tooltip">
                    <div
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                        id={`block${this.props.monitorId}${dateId}`}
                        className={classes}
                        style={style}
                        onClick={() =>
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            this.requestday(need, this.props.time.date)
                        }
                    ></div>
                    <div className="tooltip_div">
                        <div className="tooltiptext-chart">
                            <div>{title}</div>
                            <div>{title1}</div>
                        </div>
                    </div>
                </div>
            );
        } else {
            style = {
                outline: 'none',
                backgroundColor,
            };
            classes = bar;
            content = (
                <div
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                    id={`block${this.props.monitorId}${dateId}`}
                    className={classes}
                    style={style}
                    title={`${title}
                    ${title1}`}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    onClick={() => this.requestday(need, this.props.time.date)}
                ></div>
            );
        }

        return <>{content}</>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
BlockChart.displayName = 'BlockChart';

const mapStateToProps = (state: $TSFixMe) => ({
    statusData: state.status.statusPage
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getStatusPageIndividualNote,
        getIndividualEvent,
        notmonitoredDays,
        showIncidentCard,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
BlockChart.propTypes = {
    time: PropTypes.oneOfType([PropTypes.object, PropTypes.bool]),
    statusData: PropTypes.object,
    getStatusPageIndividualNote: PropTypes.func,
    getIndividualEvent: PropTypes.func,
    notmonitoredDays: PropTypes.func,
    monitorName: PropTypes.any,
    monitorId: PropTypes.any,
    showIncidentCard: PropTypes.func,
    theme: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(BlockChart);
