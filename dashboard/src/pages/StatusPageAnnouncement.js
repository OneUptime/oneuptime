import React, { Component } from 'react';
import { resetIdCounter, Tab, TabList, TabPanel, Tabs } from 'react-tabs';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import {
    fetchSingleAnnouncement,
    handleAnnouncementFunc,
    resetHandleAnnouncement,
    fetchProjectStatusPage,
    fetchSubProjectStatusPages,
    switchStatusPage,
} from '../actions/statusPage';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import { capitalize } from '../config';
import { Field, reduxForm } from 'redux-form';
import Header from '../components/statusPage/Header';

class StatusPageAnnouncement extends Component {
    async componentDidMount() {
        const {
            projectId,
            resetHandleAnnouncement,
            statusPageSlug,
            fetchProjectStatusPage,
            fetchSubProjectStatusPages,
        } = this.props;
        resetHandleAnnouncement();
        if (projectId) {
            await fetchProjectStatusPage(projectId);
            await fetchSubProjectStatusPages(projectId);
        }
        if (
            this.props.statusPage.subProjectStatusPages &&
            this.props.statusPage.subProjectStatusPages.length > 0
        ) {
            const { subProjectStatusPages } = this.props.statusPage;
            subProjectStatusPages.forEach(subProject => {
                const statusPages = subProject.statusPages;
                const statusPage = statusPages.find(
                    page => page.slug === statusPageSlug
                );
                if (statusPage) {
                    this.props.switchStatusPage(statusPage);
                }
            });
        }
    }

    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
    };

    ready = async () => {
        resetIdCounter();
        const {
            announcementSlug,
            projectId,
            statusPageSlug,
            fetchSingleAnnouncement,
        } = this.props;
        if (announcementSlug) {
            fetchSingleAnnouncement(
                projectId,
                statusPageSlug,
                announcementSlug
            );
        }
    };

    handleHideAnnouncement = (e, val) => {
        const {
            projectId,
            statusPageSlug,
            handleAnnouncementFunc,
            resetHandleAnnouncement,
        } = this.props;
        const data = {
            [e.target.name]: val,
        };
        resetHandleAnnouncement();
        handleAnnouncementFunc(projectId, statusPageSlug, data);
    };

    handleMonitorListing = (announcement, monitorState) => {
        const affectedMonitors = [];
        const announcementMonitors = [];
        // check if there's no monitor
        if (announcement.monitors.length <= 0) {
            return 'No monitor in this annoucement';
        }
        // populate the ids of the announcement monitors in an array
        announcement.monitors.map(monitor => {
            announcementMonitors.push(String(monitor.monitorId));
            return monitor;
        });

        monitorState.map(monitor => {
            if (announcementMonitors.includes(String(monitor._id))) {
                affectedMonitors.push(monitor);
            }
            return monitor;
        });

        // if they are equal then all the resources are affected
        if (affectedMonitors.length === monitorState.length) {
            return 'All Resources are affected';
        } else {
            return affectedMonitors.length <= 3
                ? affectedMonitors
                      .map(monitor => capitalize(monitor.name))
                      .join(', ')
                      .replace(/, ([^,]*)$/, ' and $1')
                : affectedMonitors.length > 3 &&
                      `${capitalize(affectedMonitors[0].name)}, ${capitalize(
                          affectedMonitors[1].name
                      )} and ${affectedMonitors.length - 2} other monitors.`;
        }
    };
    render() {
        const {
            location: { pathname },
            announcement,
            monitorList,
            requesting,
            announcementErr,
            updateAnnouncement: { error },
        } = this.props;
        const announcementName = announcement ? announcement.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'announcement')}
                        name="Status Pages"
                    />

                    <BreadCrumbItem
                        route={pathname}
                        name={announcementName}
                        pageTitle="Scheduled Event Detail"
                        containerType="Status Page Announcement"
                    />
                    <Header />
                    <ShouldRender if={requesting}>
                        <LoadingState />
                    </ShouldRender>
                    <ShouldRender if={!requesting}>
                        <Tabs
                            selectedTabClassName={'custom-tab-selected'}
                            onSelect={tabIndex => this.tabSelected(tabIndex)}
                        >
                            <div className="Flex-flex Flex-direction--columnReverse">
                                <TabList
                                    id="customTabList"
                                    className={'custom-tab-list'}
                                >
                                    <Tab className={'custom-tab custom-tab-2'}>
                                        Announcement
                                    </Tab>
                                    <Tab className={'custom-tab custom-tab-2'}>
                                        Advanced Options
                                    </Tab>
                                    <div
                                        id="tab-slider"
                                        className="custom-tab-2"
                                    ></div>
                                </TabList>
                            </div>
                            <TabPanel>
                                <Fade>
                                    <div className="db-BackboneViewContainer">
                                        <div className="react-settings-view react-view">
                                            <div className="Box-root Margin-bottom--12">
                                                <div className="bs-ContentSection Card-root Card-shadow--medium">
                                                    <div className="Box-root">
                                                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                            <div className="Box-root">
                                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Status
                                                                        Page
                                                                        Announcement
                                                                        Description
                                                                    </span>
                                                                </span>
                                                                <p>
                                                                    <span>
                                                                        Here&#39;s
                                                                        a little
                                                                        more
                                                                        information
                                                                        about
                                                                        the
                                                                        Announcement.
                                                                    </span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <ShouldRender
                                                            if={announcementErr}
                                                        >
                                                            <div
                                                                style={{
                                                                    textAlign:
                                                                        'center',
                                                                    paddingBottom:
                                                                        '20px',
                                                                }}
                                                            >
                                                                {
                                                                    announcementErr
                                                                }
                                                            </div>
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={
                                                                !announcementErr
                                                            }
                                                        >
                                                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                                                <div>
                                                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                                        <fieldset className="bs-Fieldset">
                                                                            <div className="bs-Fieldset-rows">
                                                                                <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                                                                    <label
                                                                                        className="bs-Fieldset-label"
                                                                                        style={{
                                                                                            width:
                                                                                                '11rem',
                                                                                            flex:
                                                                                                'none',
                                                                                            textAlign:
                                                                                                'left',
                                                                                        }}
                                                                                    >
                                                                                        Announcement
                                                                                        Title
                                                                                    </label>
                                                                                    <div className="bs-Fieldset-fields">
                                                                                        <span
                                                                                            className="value"
                                                                                            style={{
                                                                                                marginTop:
                                                                                                    '2px',
                                                                                            }}
                                                                                        >
                                                                                            {announcement &&
                                                                                                announcement.name}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                                                                    <label
                                                                                        className="bs-Fieldset-label"
                                                                                        style={{
                                                                                            width:
                                                                                                '11rem',
                                                                                            flex:
                                                                                                'none',
                                                                                            textAlign:
                                                                                                'left',
                                                                                        }}
                                                                                    >
                                                                                        Announcement
                                                                                        Description
                                                                                    </label>
                                                                                    <div className="bs-Fieldset-fields">
                                                                                        <span
                                                                                            className="value"
                                                                                            style={{
                                                                                                marginTop:
                                                                                                    '2px',
                                                                                            }}
                                                                                        >
                                                                                            {announcement &&
                                                                                                announcement.description}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                                                                    <label
                                                                                        className="bs-Fieldset-label"
                                                                                        style={{
                                                                                            width:
                                                                                                '11rem',
                                                                                            flex:
                                                                                                'none',
                                                                                            textAlign:
                                                                                                'left',
                                                                                        }}
                                                                                    >
                                                                                        Affected
                                                                                        Resources
                                                                                    </label>
                                                                                    <div className="bs-Fieldset-fields">
                                                                                        <span
                                                                                            className="value"
                                                                                            style={{
                                                                                                marginTop:
                                                                                                    '2px',
                                                                                            }}
                                                                                        >
                                                                                            {announcement &&
                                                                                                this.handleMonitorListing(
                                                                                                    announcement,
                                                                                                    monitorList
                                                                                                )}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="bs-Fieldset-row Flex-alignItems--center Flex-justifyContent--center">
                                                                                    <label
                                                                                        className="bs-Fieldset-label"
                                                                                        style={{
                                                                                            width:
                                                                                                '11rem',
                                                                                            flex:
                                                                                                'none',
                                                                                            textAlign:
                                                                                                'left',
                                                                                        }}
                                                                                    ></label>
                                                                                    <div className="bs-Fieldset-fields">
                                                                                        <span
                                                                                            className="value"
                                                                                            style={{
                                                                                                marginTop:
                                                                                                    '2px',
                                                                                            }}
                                                                                        >
                                                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                                                <label
                                                                                                    className="Checkbox"
                                                                                                    htmlFor="hideAnnouncementBox"
                                                                                                >
                                                                                                    <Field
                                                                                                        component="input"
                                                                                                        type="checkbox"
                                                                                                        name="hideAnnouncement"
                                                                                                        className="Checkbox-source"
                                                                                                        id="hideAnnouncementBox"
                                                                                                        onChange={(
                                                                                                            e,
                                                                                                            val
                                                                                                        ) =>
                                                                                                            this.handleHideAnnouncement(
                                                                                                                e,
                                                                                                                val
                                                                                                            )
                                                                                                        }
                                                                                                    />
                                                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                                                        <div className="Checkbox-target Box-root">
                                                                                                            <div className="Checkbox-color Box-root"></div>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                    <div className="Checkbox-label Box-root Margin-left--8">
                                                                                                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                                            <span>
                                                                                                                Hide
                                                                                                                on
                                                                                                                status
                                                                                                                page
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    </div>
                                                                                                </label>
                                                                                            </div>
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </fieldset>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Padding-horizontal--20 Padding-vertical--12">
                                                                <span className="db-SettingsForm-footerMessage"></span>
                                                                <ShouldRender
                                                                    if={error}
                                                                >
                                                                    <div className="bs-Tail-copy">
                                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                                            <div className="Box-root Margin-right--8">
                                                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                                            </div>
                                                                            <div className="Box-root">
                                                                                <span
                                                                                    style={{
                                                                                        color:
                                                                                            'red',
                                                                                    }}
                                                                                >
                                                                                    {
                                                                                        error
                                                                                    }
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </ShouldRender>
                                                            </div>
                                                        </ShouldRender>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Fade>
                            </TabPanel>
                            <TabPanel>
                                <Fade>
                                    <div>na wa for you</div>
                                </Fade>
                            </TabPanel>
                        </Tabs>
                    </ShouldRender>
                </Fade>
            </Dashboard>
        );
    }
}

StatusPageAnnouncement.displayName = 'StatusPageAnnouncement';

const StatusPageAnnouncementForm = reduxForm({
    form: 'StatusPageAnnouncement',
    enableReinitialize: true,
})(StatusPageAnnouncement);

StatusPageAnnouncement.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
        fetchSingleAnnouncement: PropTypes.func,
    }),
    announcementSlug: PropTypes.string,
    projectId: PropTypes.string,
    statusPageSlug: PropTypes.string,
    fetchSingleAnnouncement: PropTypes.func,
    handleAnnouncementFunc: PropTypes.func,
    announcement: PropTypes.object,
    requesting: PropTypes.bool,
    monitorList: PropTypes.array,
    updateAnnouncement: PropTypes.object,
    resetHandleAnnouncement: PropTypes.func,
    statusPage: PropTypes.object,
    fetchProjectStatusPage: PropTypes.func,
    fetchSubProjectStatusPages: PropTypes.func,
    switchStatusPage: PropTypes.func,
    announcementErr: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = (state, ownProps) => {
    const {
        announcementSlug,
        subProjectId,
        statusPageSlug,
    } = ownProps.match.params;

    const monitorList = [];
    state.monitor.monitorsList.monitors.map(data => {
        data.monitors.map(monitor => {
            monitorList.push(monitor);
            return monitor;
        });
        return data;
    });

    return {
        announcementSlug,
        projectId: subProjectId,
        statusPageSlug,
        monitorList,
        statusPage: state.statusPage,
        announcement: state.statusPage.singleAnnouncement.announcement,
        announcementErr: state.statusPage.singleAnnouncement.error,
        requesting: state.statusPage.singleAnnouncement.requesting,
        error: state.statusPage.singleAnnouncement.error,
        updateAnnouncement: state.statusPage.updateAnnouncement,
        initialValues: {
            hideAnnouncement:
                state.statusPage.singleAnnouncement &&
                state.statusPage.singleAnnouncement.announcement &&
                state.statusPage.singleAnnouncement.announcement
                    .hideAnnouncement,
        },
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchSingleAnnouncement,
            handleAnnouncementFunc,
            resetHandleAnnouncement,
            fetchProjectStatusPage,
            fetchSubProjectStatusPages,
            switchStatusPage,
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StatusPageAnnouncementForm);
