import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { v4 as uuidv4 } from 'uuid';
import { editMonitor, fetchLighthouseLogs } from '../../actions/monitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader, Spinner } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import AddSiteUrl from '../modals/AddSiteUrl';
import MonitorLighthouseLogsList from './MonitorLighthouseLogsList';
import Select from '../../components/basic/Select';

export class MonitorViewLighthouseLogsBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            addSiteUrlModalId: uuidv4(),
            siteValue: { value: '', label: 'All Site URLs' },
        };
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        const { currentProject, monitor, fetchLighthouseLogs } = this.props;
        if (
            prevProps.monitor &&
            monitor &&
            prevProps.monitor.siteUrls &&
            monitor.siteUrls &&
            prevProps.monitor.siteUrls.length !== monitor.siteUrls.length
        ) {
            fetchLighthouseLogs(currentProject._id, monitor._id, 0, 5);
        }
    }

    prevClicked = (monitorId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {

        const { currentProject, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) - 5 : 5,
            limit
        );
    };

    nextClicked = (monitorId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {

        const { currentProject, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) + 5 : 5,
            limit
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({

                    id: this.state.addSiteUrlModalId,
                });
            default:
                return false;
        }
    };

    handleSiteChange = (data: $TSFixMe) => {
        this.setState({ siteValue: data });

        const { currentProject, monitor, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(currentProject._id, monitor._id, 0, 5, data.value);
    };

    scanWebsites = async () => {

        const { currentProject, monitor, editMonitor } = this.props;
        if (monitor.name) {
            delete monitor.name;
        }
        // The monitor name triggers a service that update the Monitor Slug which caused the infinite reload
        await editMonitor(currentProject._id, {
            ...monitor,
            lighthouseScanStatus: 'scan',
        });

        this.props.fetchLighthouseLogs(currentProject._id, monitor._id, 0, 5);
    };

    render() {

        const { addSiteUrlModalId } = this.state;

        const requesting = this.props.requesting

            ? this.props.requesting
            : false;

        const siteUrls =

            this.props.monitor &&

                this.props.monitor.siteUrls &&

                this.props.monitor.siteUrls.length > 0

                ? this.props.monitor.siteUrls.map((url: $TSFixMe) => {
                    return { value: url, label: url };
                })
                : [];

        siteUrls.unshift({ value: '', label: 'All Site URLs' });

        const lighthouseScanStatus =

            this.props.monitor && this.props.monitor.lighthouseScanStatus;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Website Scan</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {!lighthouseScanStatus ||
                                    (lighthouseScanStatus &&
                                        (lighthouseScanStatus === 'scan' ||
                                            lighthouseScanStatus ===
                                            'scanning')) ? (
                                    <span>
                                        Currently scanning your website URL(s).
                                    </span>
                                ) : (
                                    <span id="website_postscan">
                                        Here&apos;s a summary of{' '}
                                        <a
                                            href="https://developers.google.com/web/tools/lighthouse"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                cursor: 'pointer',
                                                textDecoration: 'underline',
                                            }}
                                        >
                                            Lighthouse
                                        </a>{' '}
                                        scans we&apos;ve done on your website.
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <ShouldRender
                                if={

                                    this.props.monitor &&

                                    this.props.monitor.siteUrls &&

                                    this.props.monitor.siteUrls.length > 0
                                }
                            >
                                <button
                                    className={
                                        !lighthouseScanStatus ||
                                            (lighthouseScanStatus &&
                                                (lighthouseScanStatus === 'scan' ||
                                                    lighthouseScanStatus ===
                                                    'scanning'))
                                            ? 'bs-Button bs-DeprecatedButton'
                                            : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--security-scan'
                                    }
                                    type="button"
                                    disabled={
                                        !lighthouseScanStatus ||
                                        (lighthouseScanStatus &&
                                            (lighthouseScanStatus === 'scan' ||
                                                lighthouseScanStatus ===
                                                'scanning'))
                                    }

                                    id={`scanWebsites_${this.props.monitor.name}`}
                                    onClick={() => this.scanWebsites()}
                                >
                                    <ShouldRender
                                        if={
                                            lighthouseScanStatus &&
                                            !(
                                                lighthouseScanStatus ===
                                                'scan' ||
                                                lighthouseScanStatus ===
                                                'scanning'
                                            )
                                        }
                                    >
                                        <span>Scan</span>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !lighthouseScanStatus ||
                                            (lighthouseScanStatus &&
                                                (lighthouseScanStatus ===
                                                    'scan' ||
                                                    lighthouseScanStatus ===
                                                    'scanning'))
                                        }
                                    >
                                        <Spinner
                                            style={{ stroke: '#8898aa' }}
                                        />
                                        <span>Scanning</span>
                                    </ShouldRender>
                                </button>
                            </ShouldRender>
                            <button
                                className={
                                    requesting
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={requesting}

                                id={`addSiteUrl_${this.props.monitor.name}`}
                                onClick={() =>

                                    this.props.openModal({
                                        id: addSiteUrlModalId,
                                        content: DataPathHoC(AddSiteUrl, {

                                            monitorId: this.props.monitor._id,
                                            projectId:

                                                this.props.monitor.projectId
                                                    ._id ||

                                                this.props.monitor.projectId,
                                        }),
                                    })
                                }
                            >
                                <ShouldRender if={!requesting}>
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Add New Site URL</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={requesting}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                            <ShouldRender
                                if={

                                    this.props.monitor &&

                                    this.props.monitor.siteUrls &&

                                    this.props.monitor.siteUrls.length > 1
                                }
                            >
                                <div
                                    style={{
                                        height: '28px',
                                        width: '250px',
                                        marginLeft: '10px',
                                    }}
                                >
                                    <Select

                                        name="site_selector"

                                        value={this.state.siteValue}
                                        onChange={this.handleSiteChange}
                                        placeholder="All Site URLs"
                                        className="db-select-pr"
                                        id="url_selector"
                                        isDisabled={requesting}
                                        style={{ height: '28px' }}
                                        options={siteUrls}
                                    />
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <MonitorLighthouseLogsList

                        componentId={this.props.componentId}

                        monitor={this.props.monitor}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}

                        componentSlug={this.props.componentSlug}
                    />
                </div>
            </div>
        );
    }
}


MonitorViewLighthouseLogsBox.displayName = 'MonitorViewLighthouseLogsBox';


MonitorViewLighthouseLogsBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    componentSlug: PropTypes.string,
    currentProject: PropTypes.object,
    monitor: PropTypes.object.isRequired,
    editMonitor: PropTypes.func,
    fetchLighthouseLogs: PropTypes.func,
    requesting: PropTypes.bool,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        editMonitor,
        fetchLighthouseLogs,
        openModal,
        closeModal,
    },
    dispatch
);

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
        requesting: state.monitor.editMonitor.requesting,
    };
}


MonitorViewLighthouseLogsBox.contextTypes = {};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewLighthouseLogsBox);
