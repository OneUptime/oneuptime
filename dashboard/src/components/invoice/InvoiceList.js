import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { ListLoader } from '../basic/Loader';
import moment from 'moment';


export class InvoiceList extends Component {

    constructor(props) {
    super(props);
    this.props = props;
    
  }
    
    render() {
        let canNext = false

        if (this.props.invoices.length > 0) {
            canNext = this.props.invoices[this.props.invoices.length - 1].has_more && !this.props.isRequesting ? true : false;
        }

        return (
          <div>
              <table className="Table">
                <thead className="Table-body">
                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', minWidth: '270px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Invoice ID</span></span></div>
                        </td>
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Date</span></span></div>
                        </td>
                        <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                        </td>
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Amount($)</span></span></div>
                        </td>
                        <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                        </td>
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Status</span></span></div>
                        </td>
                        <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"><span>Download</span></span></div>
                        </td>
                        <td id="overflow" type="action" className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span></div>
                        </td>
                    </tr>
                </thead>
                <tbody className="Table-body">
                    {
                        this.props.invoices && this.props.invoices.length > 0  ?
                        this.props.invoices.map((invoiceList) => (
                            invoiceList.data.map((invoice) => (
                            <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem" key={invoice.id} >
                                
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', minWidth: '270px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                        <span>{invoice.id}</span>
                                        </span>
                                    </div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>{moment(invoice.date * 1000).format('ll')}</span>
                                        </span>
                                    </div>
                                </td>
                                <td id="placeholder-left" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>{((invoice.total)/100).toFixed(2)}</span>
                                        </span>
                                    </div>
                                </td>
                                <td id="placeholder-right" className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px', maxWidth: '48px', minWidth: '48px', width: '48px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        {
                                            !invoice.paid ? (
                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span>Unpaid</span>
                                                </span>
                                            </div>
                                            ) : (
                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span>Paid</span>
                                                </span>
                                            </div>
                                            )
                                        }
                                    </div>
                                </td>
                                <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <a href={invoice.invoice_pdf}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <button
                                                className="bs-Button bs-DeprecatedButton"
                                                type="button"
                                            >
                                                <span>Download</span>
                                            </button>
                                        </div>
                                    </a>
                                </td>
                                <td id="overflow" type="action" className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                            </tr>
                            ))
                        ))
                        :
                        <tr></tr>
                   }
                      
                </tbody>

            </table>

            {(this.props.invoices && this.props.isRequesting) ? <ListLoader /> : null}

            <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {!this.props.invoices && !this.props.invoices.length > 0 && !this.props.isRequesting && !this.props.error ? 'You don\'t have any invoices' : null}
                    {this.props.invoices && this.props.invoices.error ? this.props.invoices.error : null}
                    { this.props.error && this.props.error === 'You cannot edit the project because you\'re not an owner.' ? 'Invoices are available to only owners.' : this.props.error }
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">{this.props.invoices && this.props.invoices.count ? this.props.invoices.count + (this.props.invoices && this.props.invoices.count > 1 ? ' invoices' : ' Invoices') : null}</span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root">
                                <button onClick={this.props.nextClicked} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>More</span></span></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
          </div>
        )
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({}, dispatch)
}

const mapStateToProps = state => {
    var invoices = state.invoice.invoices;
    var isRequesting = state.invoice.requesting;
    var error = state.invoice.error;
    

    return { invoices, isRequesting, error }
}

InvoiceList.propTypes = {
    nextClicked:PropTypes.func.isRequired,
    invoices: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null,undefined])
    ]),
    isRequesting: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null,undefined])
    ])
}

InvoiceList.displayName = 'InvoiceList'

export default connect(mapStateToProps, mapDispatchToProps)(InvoiceList);
