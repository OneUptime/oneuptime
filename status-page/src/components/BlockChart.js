import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { getStatusPageIndividualNote, notmonitoredDays } from '../actions/status';

class BlockChart extends Component {
    constructor(props) {
        super(props);

        this.requestnotes = this.requestnotes.bind(this);
    }

    requestnotes = (need, date) => {
        if (need) {
            this.props.getStatusPageIndividualNote(this.props.statusData.projectId._id, this.props.monitorId, date, this.props.monitorName, need);
        } else {
            if (this.props.time && this.props.time.emptytime) {
                this.props.notmonitoredDays(this.props.monitorId, this.props.time.emptytime, this.props.monitorName, 'No data available for this date');
            } else {
                this.props.notmonitoredDays(this.props.monitorId, date, this.props.monitorName, 'No incidents yet');
            }
        }
    }

    render() {
        let bar = null;
        let title = null;
        let title1 = null;
        let need = false;

        if (this.props.time && (this.props.time.downTime || this.props.time.degradedTime || this.props.time.upTime)) {
            if (this.props.time.downTime > 1) {
                let downtime = `${this.props.time.downTime} minutes`;

                if (this.props.time.downTime > 60) {
                    downtime = `${Math.floor(this.props.time.downTime / 60)} hrs ${this.props.time.downTime % 60} minutes`;
                }

                bar = 'bar down';
                title = moment((this.props.time.date)).format('LL');
                title1 = `<br>Down for ${downtime}`;
                need = true;
            } else if (this.props.time.degradedTime > 1) {
                let degradedtime = `${this.props.time.degradedTime} minutes`;

                if (this.props.time.degradedTime > 60) {
                    degradedtime = `${Math.floor(this.props.time.degradedTime / 60)} hrs ${this.props.time.degradedTime % 60} minutes`;
                }

                bar = 'bar mid';
                title = moment((this.props.time.date)).format('LL');
                title1 = `<br>Degraded for ${degradedtime}`;
                need = true;
            } else {
                bar = 'bar';
                title = moment((this.props.time.date)).format('LL');
                title1 = '<br>No downtime';
            }
        } else {
            bar = 'bar empty';
            title = moment(this.props.time.date).format('LL');
            title1 = '<br>No data available';
        }

        return (
            <div className={bar} style={{ outline: 'none' }} title={title + title1} onClick={() => this.requestnotes(need, this.props.time.date)}></div>
        );
    }
}

BlockChart.displayName = 'BlockChart';

const mapStateToProps = (state) => ({ statusData: state.status.statusPage });

const mapDispatchToProps = (dispatch) => bindActionCreators({
    getStatusPageIndividualNote,
    notmonitoredDays
}, dispatch);

BlockChart.propTypes = {
    time: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.bool,
    ]),
    statusData: PropTypes.object,
    getStatusPageIndividualNote: PropTypes.func,
    notmonitoredDays: PropTypes.func,
    monitorName: PropTypes.any,
    monitorId: PropTypes.any
};

export default connect(mapStateToProps, mapDispatchToProps)(BlockChart);