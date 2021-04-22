import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
//import PropTypes from 'prop-types';
import { getMonitorLogs } from '../../actions/monitor';
import ChartComponent from './ChartComponent';

export class WebTransactionsChart extends Component {
    render() {
        const { heading, title, subHeading, type } = this.props;
        return (
            <div
                className="Box-root Card-shadow--medium"
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
                style={{ marginTop: '10px' }}
            >
                <ChartComponent
                    heading={heading}
                    title={title}
                    subHeading={subHeading}
                    type={type}
                />
            </div>
        );
    }
}

WebTransactionsChart.displayName = 'WebTransactionsChart';

WebTransactionsChart.propTypes = {
    heading: PropTypes.any,
    subHeading: PropTypes.any,
    title: PropTypes.any,
    type: PropTypes.any,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getMonitorLogs }, dispatch);

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(WebTransactionsChart);
