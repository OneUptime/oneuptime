import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ChartComponent from './ChartComponent';

export class WebTransactionsChart extends Component {
    handleKeyBoard: $TSFixMe;
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({}, dispatch);

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(WebTransactionsChart);
