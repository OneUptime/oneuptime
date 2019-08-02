import React, { Component } from 'react';
import PropTypes from 'prop-types'
import moment from 'moment';

class BlockChart extends Component {
  render() {
      let bar =null;
      let title =null;
      let title1 = null;
      if(this.props.time){
        if(this.props.time.downTime >1 && this.props.time.downTime< 10){
            bar = 'bar mid';
            title = moment((this.props.time.date).split('T')[0]).format('LL');
            title1 = `<br>degraded for ${this.props.time.downTime} minutes`;
          } 
          else if(this.props.time.downTime >= 10) {
            var downtime = `${this.props.time.downTime} minutes`;
            if(this.props.time.downTime > 60){
                downtime = `${Math.floor(this.props.time.downTime / 60)} hrs ${this.props.time.downTime % 60} minutes`;
                }
              bar = 'bar down';
              title = moment((this.props.time.date).split('T')[0]).format('LL');
              title1 = `<br>down for ${downtime}`;
          }
          else {
              bar = 'bar';
              title = moment((this.props.time.date).split('T')[0]).format('LL');
              title1 = '<br>No downtime';
          }
    }
    else {
          bar = 'bar empty';
          title = moment(new Date(this.props.emptytime)).format('LL');
          title1 = '<br>No data Available';
    }
    return (
        <div className={bar} title={title + title1}></div>
    );
}
}

BlockChart.displayName = 'BlockChart'

BlockChart.propTypes = {
    time:PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.bool
    ]).isRequired,
    emptytime: PropTypes.number
}

export default BlockChart;