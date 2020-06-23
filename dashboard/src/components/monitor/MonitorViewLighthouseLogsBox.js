import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { fetchLighthouseLogs } from '../../actions/monitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import { openModal, closeModal } from '../../actions/modal';
import AddSiteUrl from '../modals/AddSiteUrl';
import MonitorLighthouseLogsList from './MonitorLighthouseLogsList';
import Select from '../../components/basic/react-select-fyipe';

export class MonitorViewLighthouseLogsBox extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            addSiteUrlModalId: uuid.v4(),
            siteValue: { value: null, label: 'All Site URLs' },
        };
    }

    prevClicked = (monitorId, skip, limit) => {
        const { currentProject, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) - 10 : 10,
            limit
        );
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Previous Incident Requested', {
                projectId: currentProject._id,
            });
        }
    };

    nextClicked = (monitorId, skip, limit) => {
        const { currentProject, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) + 10 : 10,
            limit
        );
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Next Incident Requested', {
                projectId: currentProject._id,
            });
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.state.addSiteUrlModalId,
                });
            default:
                return false;
        }
    };

    handleSiteChange = data => {
        this.setState({ siteValue: data });
        const { currentProject, monitor, fetchLighthouseLogs } = this.props;
        fetchLighthouseLogs(currentProject._id, monitor._id, 0, 10, data.value);
    };

    render() {
        const { addSiteUrlModalId } = this.state;
        const creating = this.props.create ? this.props.create : false;

        const siteUrls =
            this.props.monitor &&
            this.props.monitor.siteUrls &&
            this.props.monitor.siteUrls.length > 0
                ? this.props.monitor.siteUrls.map(url => {
                      return { value: url, label: url };
                  })
                : [];

        siteUrls.unshift({ value: null, label: 'All Site URLs' });

        const monitorUrl =
            this.props.monitor &&
            this.props.monitor.data &&
            this.props.monitor.data.url
                ? this.props.monitor.data.url
                : '';
        siteUrls.push({ value: monitorUrl, label: monitorUrl });

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
                                <span>
                                    Here&#39;s all of the logs of your website
                                    issues for this monitor.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <button
                                className={
                                    creating
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={creating}
                                id={`addSiteUrl_${this.props.monitor.name}`}
                                onClick={() =>
                                    this.props.openModal({
                                        id: addSiteUrlModalId,
                                        content: DataPathHoC(AddSiteUrl, {
                                            monitorId: this.props.monitor._id,
                                            projectId: this.props.monitor
                                                .projectId._id,
                                        }),
                                    })
                                }
                            >
                                <ShouldRender if={!creating}>
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Add New Site URL</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={creating}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                            <ShouldRender
                                if={
                                    this.props.monitor &&
                                    this.props.monitor.siteUrls &&
                                    this.props.monitor.siteUrls.length > 0
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
                                        isDisabled={creating}
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
                    />
                </div>
            </div>
        );
    }
}

MonitorViewLighthouseLogsBox.displayName = 'MonitorViewLighthouseLogsBox';

MonitorViewLighthouseLogsBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    currentProject: PropTypes.object,
    monitor: PropTypes.object.isRequired,
    fetchLighthouseLogs: PropTypes.func,
    create: PropTypes.bool,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { fetchLighthouseLogs, openModal, closeModal },
        dispatch
    );

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
        create: state.monitor.editMonitor.requesting,
    };
}

MonitorViewLighthouseLogsBox.contextTypes = {
    mixpanel: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorViewLighthouseLogsBox);
