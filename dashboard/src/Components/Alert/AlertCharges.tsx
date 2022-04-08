import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import AlertChargesList from './AlertChargesList';

import { CSVLink } from 'react-csv';
import { downloadAlertCharges } from '../../actions/alert';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';

interface AlertChargeProps {
    projectId?: string;
    downloadAlertCharges: Function;
    downloadedAlertCharges?: object | unknown[];
    error?: string;
    requesting?: boolean;
    alertCharges?: object | unknown[];
}

class AlertCharge extends Component<ComponentProps> {
    csvLink = React.createRef();

    constructor(props: $TSFixMe) {
        super(props);
    }

    fetchData = () => {

        const { projectId, downloadAlertCharges } = this.props;
        downloadAlertCharges(projectId).then(() => {

            this.csvLink.current.link.click();
        });
    };

    override render() {
        const {

            alertCharges,

            error,

            requesting,

            downloadedAlertCharges,
        } = this.props;
        const canDownload = alertCharges.length > 0 ? true : false;
        return (
            <div
                className="db-World-contentPane Box-root"
                style={{ paddingTop: 0 }}
            >
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                <span>Alert Charges</span>
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
                                                    <ShouldRender
                                                        if={!requesting}
                                                    >
                                                        <button
                                                            id="downloadCSVButton"
                                                            onClick={
                                                                this.fetchData
                                                            }
                                                            className={
                                                                'bs-Button bs-ButtonLegacy' +
                                                                (!canDownload
                                                                    ? ''
                                                                    : 'Is--disabled')
                                                            }
                                                            type="button"
                                                            disabled={
                                                                !canDownload
                                                            }
                                                        >
                                                            <ShouldRender
                                                                if={!requesting}
                                                            >
                                                                <span className="bs-Button--icon bs-Button--download">
                                                                    <span>
                                                                        Export
                                                                        as CSV
                                                                    </span>
                                                                </span>
                                                            </ShouldRender>
                                                        </button>
                                                        <CSVLink
                                                            data={
                                                                downloadedAlertCharges
                                                            }
                                                            filename="data.csv"
                                                            className="hidden"
                                                            ref={this.csvLink}
                                                            target="_blank"
                                                        />
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={requesting}
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <div
                                                                style={{
                                                                    marginTop: -20,
                                                                }}
                                                            >
                                                                <ListLoader />
                                                            </div>
                                                        </div>
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <AlertChargesList />
                                <ShouldRender if={error}>
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                                        style={{ backgroundColor: 'white' }}
                                    >
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                            <span>
                                                <span
                                                    id="alertChargeDownloadError"
                                                    className="Text-color--red Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                >
                                                    {error ? error : null}
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: RootState) => {
    const downloadedAlertCharges =
        state.alert.downloadedAlertCharges &&
        state.alert.downloadedAlertCharges.data;
    const alertCharges =
        state.alert.alertCharges !== null && state.alert.alertCharges.data;
    const { requesting, error } = state.alert.downloadedAlertCharges;
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        downloadedAlertCharges,
        requesting,
        error,
        alertCharges,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ downloadAlertCharges }, dispatch);
};


AlertCharge.propTypes = {
    projectId: PropTypes.string,
    downloadAlertCharges: PropTypes.func.isRequired,
    downloadedAlertCharges: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.array,
    ]),
    error: PropTypes.string,
    requesting: PropTypes.bool,
    alertCharges: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
};


AlertCharge.displayName = 'AlertCharge';

export default connect(mapStateToProps, mapDispatchToProps)(AlertCharge);
