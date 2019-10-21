import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import AlertChargesList from './AlertChargesList';
import { CSVLink } from 'react-csv';
import { downloadAlertCharges } from '../../actions/alert';

class AlertCharge extends Component {

    csvLink = React.createRef();

    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('AlertCharge page Loaded');
        }
    }
    fetchData = () => {
        var { projectId, downloadAlertCharges } = this.props;
        downloadAlertCharges(projectId)
            .then(() => {
                this.csvLink.current.link.click();
            })
    }

    render() {
        const { downloadedAlertCharges } = this.props;
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
                                                                Alert Charges
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Review charges for alerts.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div>
                                                            <div className="Box-root">
                                                                <button id="downloadCSVButton" onClick={this.fetchData} className="Button bs-ButtonLegacy ActionIconParent" type="button">
                                                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <div className="Box-root Margin-right--8">
                                                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex">
                                                                            </div>
                                                                        </div>
                                                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                            <span>Export as CSV</span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                                <CSVLink
                                                                    data={downloadedAlertCharges}
                                                                    filename="data.csv"
                                                                    className="hidden"
                                                                    ref={this.csvLink}
                                                                    target="_blank"
                                                                />
                                                            </div>

                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <AlertChargesList />
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
    var { projectId } = props.match.params;
    var downloadedAlertCharges = state.alert.downloadedAlertCharges && state.alert.downloadedAlertCharges.data;

    return { projectId, downloadedAlertCharges }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ downloadAlertCharges }, dispatch)
}

AlertCharge.propTypes = {
    projectId: PropTypes.string,
    downloadAlertCharges: PropTypes.func.isRequired,
    downloadedAlertCharges: PropTypes.oneOfType([PropTypes.object, PropTypes.array])
}

AlertCharge.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

AlertCharge.displayName = 'AlertCharge';

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(AlertCharge));