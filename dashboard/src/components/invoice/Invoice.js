import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import InvoiceList from './InvoiceList';
import { getInvoice, getInvoiceRequest, getInvoiceError, getInvoiceSuccess, getInvoiceReset } from '../../actions/invoice';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

class Invoice extends Component {

  constructor(props) {
    super(props);
    this.props = props;
  }
  
  componentDidMount() {
      if(!IS_DEV){
      logEvent('Invoice page Loaded');
    }
    this.resetAndFetchInvoices();
  }

  resetAndFetchInvoices = () => {
      this.props.getInvoiceReset();
      this.props.getInvoice(this.props.projectId);
  }

  nextClicked = () => {
      const { invoices: { data } } = this.props;
      const startingAfter = data[data.length - 1].id;
      this.props.getInvoice(this.props.projectId, startingAfter)
  }

  prevClicked = () => {
      const { invoices: { data } } = this.props;
      const endingBefore = data[0].id;
      const startingAfter = data[data.length - 1].id;
      this.props.getInvoice(this.props.projectId, startingAfter, endingBefore)
  }

    render() {

      return (
          <div className="db-World-contentPane Box-root" style={{ paddingTop: 0 }}>
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
                              <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>
                                  Invoice
                              </span>
                              </span>
                              <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                  Review your invoices.
                                </span>
                              </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                              <div>


                              </div>
                            </div>
                          </div>
                        </div>{
                        <InvoiceList 
                          invoices={this.props.invoices}
                          nextClicked={this.nextClicked}
                          prevClicked={this.prevClicked}
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


const mapStateToProps = (state, props) => {
    var {projectId} = props.match.params;
    var invoices = state.invoice.invoices;
    var isRequesting = state.invoice.requesting;
    var isSuccessful = state.invoice.success;

    return { projectId, invoices, isRequesting, isSuccessful }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ getInvoice, getInvoiceRequest, getInvoiceError, getInvoiceSuccess, getInvoiceReset }, dispatch)
}

Invoice.propTypes = {
    getInvoice: PropTypes.func.isRequired,
    projectId: PropTypes.string,
    invoices: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null,undefined])
    ]),
    getInvoiceReset: PropTypes.func.isRequired
}

Invoice.displayName = 'Invoice'

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(Invoice));
