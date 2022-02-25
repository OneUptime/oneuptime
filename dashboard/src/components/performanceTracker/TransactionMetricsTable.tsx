import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import TableComponent from './TableComponent';

export class TransactionMetricsTable extends Component {
    render() {
        const { heading, title, subHeading, type } = this.props;
        return (
            <div
                className="Box-root Card-shadow--medium"
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
                style={{ marginTop: '10px' }}
            >
                <TableComponent
                    heading={heading}
                    title={title}
                    subHeading={subHeading}
                    type={type}
                />
            </div>
        );
    }
}

TransactionMetricsTable.displayName = 'TransactionMetricsTable';

TransactionMetricsTable.propTypes = {
    heading: PropTypes.any,
    subHeading: PropTypes.any,
    title: PropTypes.any,
    type: PropTypes.any,
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TransactionMetricsTable);
