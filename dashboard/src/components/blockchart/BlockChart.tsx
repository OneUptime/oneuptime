import React, { Component } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

class BlockChart extends Component {
    render() {
        let bar = null;
        let title = null;
        let title1 = null;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.time &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            (this.props.time.downTime ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.time.upTime ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.time.degradedTime)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.time.downTime) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                let downtime = `${this.props.time.downTime} minutes`;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                if (this.props.time.downTime > 60) {
                    downtime = `${Math.floor(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.time.downTime / 60
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    )} hrs ${this.props.time.downTime % 60} minutes`;
                }
                bar = 'bar down';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = `<br>down for ${downtime} minutes`;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            } else if (this.props.time.degradedTime) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                let degradedtime = `${this.props.time.degradedTime} minutes`;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                if (this.props.time.degradedTime > 60) {
                    degradedtime = `${Math.floor(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        this.props.time.degradedTime / 60
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    )} hrs ${this.props.time.degradedTime % 60} minutes`;
                }
                bar = 'bar mid';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = `<br>degraded for ${degradedtime}`;
            } else {
                bar = 'bar';
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                title = moment(this.props.time.date).format('LL');
                title1 = '<br>No downtime';
            }
        } else {
            bar = 'bar empty';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'time' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            title = moment(this.props.time.date).format('LL');
            title1 = '<br>No data Available';
        }
        return <div className={bar} title={title + title1}></div>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
BlockChart.displayName = 'BlockChart';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
BlockChart.propTypes = {
    time: PropTypes.oneOfType([PropTypes.object, PropTypes.bool]).isRequired,
};

export default BlockChart;
