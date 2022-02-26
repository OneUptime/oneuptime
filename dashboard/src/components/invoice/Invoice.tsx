import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import InvoiceList from './InvoiceList';
import {
    getInvoice,
    getInvoiceRequest,
    getInvoiceError,
    getInvoiceSuccess,
    getInvoiceReset,
} from '../../actions/invoice';
import PropTypes from 'prop-types';
import { User } from '../../config';

class Invoice extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    componentDidMount() {
        this.resetAndFetchInvoices();
    }

    resetAndFetchInvoices = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getInvoiceReset' does not exist on type ... Remove this comment to see the full error message
        this.props.getInvoiceReset();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getInvoice' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.getInvoice(this.props.userId);
    };

    nextClicked = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'invoices' does not exist on type 'Readon... Remove this comment to see the full error message
            invoices: { data },
        } = this.props;
        const startingAfter = data[data.length - 1].id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getInvoice' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.getInvoice(this.props.userId, startingAfter);
    };

    prevClicked = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'invoices' does not exist on type 'Readon... Remove this comment to see the full error message
            invoices: { data },
        } = this.props;
        const endingBefore = data[0].id;
        const startingAfter = data[data.length - 1].id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getInvoice' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.getInvoice(this.props.userId, startingAfter, endingBefore);
    };

    render() {
        return (
            <div
                className="db-World-contentPane Box-root"
                style={{ paddingTop: 0 }}
            >
                <div>
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <div className="Box-root Margin-bottom--12">
                                <div className="bs-ContentSection Card-root Card-shadow--medium">
                                    <div className="Box-root">
                                        <div>
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Invoices
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Review your most
                                                                recent invoices.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div></div>
                                                    </div>
                                                </div>
                                            </div>
                                            {
                                                <InvoiceList
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ invoices: any; nextClicked: () => void; pr... Remove this comment to see the full error message
                                                    invoices={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'invoices' does not exist on type 'Readon... Remove this comment to see the full error message
                                                        this.props.invoices
                                                    }
                                                    nextClicked={
                                                        this.nextClicked
                                                    }
                                                    prevClicked={
                                                        this.prevClicked
                                                    }
                                                />
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: $TSFixMe) => {
    const userId = User.getUserId();
    const invoices = state.invoice.invoices;
    const isRequesting = state.invoice.requesting;
    const isSuccessful = state.invoice.success;

    return { userId, invoices, isRequesting, isSuccessful };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            getInvoice,
            getInvoiceRequest,
            getInvoiceError,
            getInvoiceSuccess,
            getInvoiceReset,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Invoice.propTypes = {
    getInvoice: PropTypes.func.isRequired,
    userId: PropTypes.string,
    invoices: PropTypes.array,
    getInvoiceReset: PropTypes.func.isRequired,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Invoice.displayName = 'Invoice';

export default connect(mapStateToProps, mapDispatchToProps)(Invoice);
