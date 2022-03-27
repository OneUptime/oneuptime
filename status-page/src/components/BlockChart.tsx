import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import {
    getStatusPageIndividualNote,
    getIndividualEvent,
    notmonitoredDays,
    showIncidentCard,
} from '../actions/status';

interface BlockChartProps {
    time?: object | boolean;
    statusData?: object;
    getStatusPageIndividualNote?: Function;
    getIndividualEvent?: Function;
    notmonitoredDays?: Function;
    monitorName?: any;
    monitorId?: any;
    showIncidentCard?: Function;
    theme?: string;
}

class BlockChart extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.requestday = this.requestday.bind(this);
    }

    requestday = (need: $TSFixMe, date: $TSFixMe) => {

        this.props.showIncidentCard(false);

        const theme = this.props.theme ? true : false;
        if (need) {

            this.props.getStatusPageIndividualNote(

                this.props.statusData.projectId._id,

                this.props.monitorId,
                date,

                this.props.monitorName,
                need,
                theme
            );
        } else {

            if (this.props.time && this.props.time.emptytime) {

                this.props.notmonitoredDays(

                    this.props.monitorId,

                    this.props.time.emptytime,

                    this.props.monitorName,
                    'No data available for this date'
                );
            } else {

                this.props.notmonitoredDays(

                    this.props.monitorId,
                    date,

                    this.props.monitorName,
                    'No incidents yet'
                );
            }
        }

        this.props.getIndividualEvent(

            this.props.statusData.projectId._id,

            this.props.monitorId,
            date,

            this.props.monitorName,
            theme
        );
    };

    override render() {
        let bar = null;
        let title = null;
        let title1 = null;
        let need = false;
        let backgroundColor;


        const { colors } = this.props.statusData;

        if (this.props.time && this.props.time.status) {

            if (this.props.time.status === 'disabled') {
                let disabledTimeInMinutes, disabledtime;

                if (this.props.time.disabledTime < 60) {

                    disabledTimeInMinutes = this.props.time.disabledTime;
                    disabledtime = `${disabledTimeInMinutes} second${disabledTimeInMinutes === 1 ? '' : 's'
                        }`;
                } else {
                    disabledTimeInMinutes = Math.floor(

                        this.props.time.disabledTime / 60
                    );
                    disabledtime = `${disabledTimeInMinutes} minute${disabledTimeInMinutes === 1 ? '' : 's'
                        }`;
                }

                if (disabledTimeInMinutes > 60) {
                    disabledtime = `${Math.floor(
                        disabledTimeInMinutes / 60
                    )} hrs ${disabledTimeInMinutes % 60} minutes`;
                }

                bar = 'bar down';

                title = moment(this.props.time.date).format('LL');
                title1 = `Disabled for ${disabledtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.disabled.r}, ${colors.disabled.g}, ${colors.disabled.b}, ${colors.disabled.a})`;

            } else if (this.props.time.status === 'offline') {
                let downTimeInMinutes, downtime;

                if (this.props.time.downTime < 60) {

                    downTimeInMinutes = this.props.time.downTime;
                    downtime = `${downTimeInMinutes} second${downTimeInMinutes === 1 ? '' : 's'
                        }`;
                } else {
                    downTimeInMinutes = Math.floor(

                        this.props.time.downTime / 60
                    );
                    downtime = `${downTimeInMinutes} minute${downTimeInMinutes === 1 ? '' : 's'
                        }`;
                }

                if (downTimeInMinutes > 60) {
                    downtime = `${Math.floor(
                        downTimeInMinutes / 60
                    )} hrs ${downTimeInMinutes % 60} minutes`;
                }

                bar = 'bar down';

                title = moment(this.props.time.date).format('LL');
                title1 = `Down for ${downtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`;

            } else if (this.props.time.status === 'degraded') {
                let degradedTimeInMinutes;
                let degradedtime;

                if (this.props.time.degradedTime < 60) {

                    degradedTimeInMinutes = this.props.time.degradedTime;
                    degradedtime = `${degradedTimeInMinutes} second${degradedTimeInMinutes === 1 ? '' : 's'
                        }`;
                } else {
                    degradedTimeInMinutes = Math.floor(

                        this.props.time.degradedTime / 60
                    );
                    degradedtime = `${degradedTimeInMinutes} minute${degradedTimeInMinutes === 1 ? '' : 's'
                        }`;
                }

                if (degradedTimeInMinutes > 60) {
                    degradedtime = `${Math.floor(
                        degradedTimeInMinutes / 60
                    )} hrs ${degradedTimeInMinutes % 60} minutes`;
                }

                bar = 'bar mid';

                title = moment(this.props.time.date).format('LL');
                title1 = `Degraded for ${degradedtime}`;
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`;
            } else {
                bar = 'bar';

                title = moment(this.props.time.date).format('LL');
                title1 = 'No downtime';
                need = true;
                if (colors)
                    backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`;
            }
        } else {
            bar = 'bar empty';

            title = this.props.time

                ? moment(this.props.time.date).format('LL')
                : 'N/A';
            title1 = '100% uptime';
            if (colors)
                backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`;
        }

        const dateId = title.replace(/, | /g, '');
        const extra = ' resize-style';
        let style, classes, content;


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

                        id={`block${this.props.monitorId}${dateId}`}
                        className={classes}
                        style={style}
                        onClick={() =>

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

                    id={`block${this.props.monitorId}${dateId}`}
                    className={classes}
                    style={style}
                    title={`${title}
                    ${title1}`}

                    onClick={() => this.requestday(need, this.props.time.date)}
                ></div>
            );
        }

        return <>{content}</>;
    }
}


BlockChart.displayName = 'BlockChart';

const mapStateToProps = (state: RootState) => ({
    statusData: state.status.statusPage
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        getStatusPageIndividualNote,
        getIndividualEvent,
        notmonitoredDays,
        showIncidentCard,
    },
    dispatch
);


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
