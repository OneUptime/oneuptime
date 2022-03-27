import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import TableComponent from './TableComponent';

interface TransactionMetricsTableProps {
    heading?: any;
    subHeading?: any;
    title?: any;
    type?: any;
}

export class TransactionMetricsTable extends Component<TransactionMetricsTableProps>{
    public static displayName = '';
    public static propTypes = {};
    handleKeyBoard: $TSFixMe;
    override render() {

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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({}, dispatch);

function mapStateToProps(state: RootState) {
    return {
        currentProject: state.project.currentProject,
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(TransactionMetricsTable);
