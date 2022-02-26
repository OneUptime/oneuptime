import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import TableComponent from './TableComponent';

export class TransactionMetricsTable extends Component {
    handleKeyBoard: $TSFixMe;
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'heading' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { heading, title, subHeading, type } = this.props;
        return (
            <div
                className="Box-root Card-shadow--medium"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
                style={{ marginTop: '10px' }}
            >
                <TableComponent
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: any; title: any; subHeading: any;... Remove this comment to see the full error message
                    heading={heading}
                    title={title}
                    subHeading={subHeading}
                    type={type}
                />
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
TransactionMetricsTable.displayName = 'TransactionMetricsTable';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TransactionMetricsTable.propTypes = {
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
)(TransactionMetricsTable);
