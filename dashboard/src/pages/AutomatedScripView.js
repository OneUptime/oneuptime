import React, { useEffect, useState } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import PropTypes from 'prop-types';
import getParentRoute from '../utils/getParentRoute';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import DeleteScriptBox from '../components/automationScript/DeleteScriptBox';
import DataPathHoC from '../components/DataPathHoC';
import ViewJsonLogs from '../components/modals/ViewJsonLogs';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { openModal } from '../actions/modal';
import { v4 as uuidv4 } from 'uuid';
import { fetchSingleAutomatedScript } from '../actions/automatedScript';
import Badge from '../components/common/Badge';
import moment from 'moment';

const AutomatedScripView = props => {
    const { history } = props;
    const pathName = history.location.pathname;
    const parentRoute = getParentRoute(history.location.pathname);
    const scriptName =
        pathName.split('automation-scripts/')[1].split('-')[0] || null;

    const [tabIndex, setTabIndex] = useState(0);
    const [viewJsonModalId] = useState(uuidv4());

    useEffect(() => {
        const projectId = props.currentProject?._id;
        const automatedSlug = props.match.params.automatedScriptslug;
        if (projectId) {
            props.fetchSingleAutomatedScript(projectId, automatedSlug);
        }
    }, [props.currentProject]);

    const tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');

        setTimeout(() => {
            tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        });
        setTabIndex(index);
    };

    const script = props.script;
    return (
        <Dashboard>
            <Fade>
                <BreadCrumbItem route={parentRoute} name="Automation Scripts" />
                <BreadCrumbItem
                    route={history.location.pathname}
                    name={scriptName}
                    pageTitle="Automation Scripts"
                />
                <Tabs
                    selectedTabClassName={'custom-tab-selected'}
                    onSelect={tab => tabSelected(tab)}
                    selectedIndex={tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 basic-tab bs-automate-tab'
                                }
                            >
                                Basic
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-6 advanced-options-tab bs-automate-tab'
                                }
                            >
                                Advanced Options
                            </Tab>
                            <div
                                id="tab-slider"
                                className="custom-tab-6 status-tab bs-automate-slider"
                            ></div>
                        </TabList>
                    </div>

                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span data-reactroot="">
                                            <div>
                                                <div>
                                                    <ShouldRender if={true}>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                                    <span>
                                                                                        Automated
                                                                                        Script
                                                                                        Logs
                                                                                    </span>
                                                                                </span>
                                                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                    <span>
                                                                                        Here&#39;s
                                                                                        a
                                                                                        log
                                                                                        of
                                                                                        the
                                                                                        automated
                                                                                        scripts
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="bs-ContentSection-content Box-root">
                                                                        <div className="bs-ObjectList db-UserList">
                                                                            <div
                                                                                style={{
                                                                                    overflow:
                                                                                        'hidden',
                                                                                    overflowX:
                                                                                        'auto',
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    id="automatedList"
                                                                                    className="bs-ObjectList-rows"
                                                                                >
                                                                                    <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                                                        <div className="bs-ObjectList-cell">
                                                                                            Triggered
                                                                                            by
                                                                                        </div>
                                                                                        <div className="bs-ObjectList-cell">
                                                                                            Time
                                                                                            the
                                                                                            script
                                                                                            ran
                                                                                        </div>
                                                                                        <div
                                                                                            className="bs-ObjectList-cell"
                                                                                            style={{
                                                                                                marginRight:
                                                                                                    '10px',
                                                                                            }}
                                                                                        >
                                                                                            Status
                                                                                        </div>
                                                                                        <div
                                                                                            className="bs-ObjectList-cell"
                                                                                            style={{
                                                                                                float:
                                                                                                    'right',
                                                                                            }}
                                                                                        >
                                                                                            Action
                                                                                        </div>
                                                                                    </header>
                                                                                    <div
                                                                                        key={`automated`}
                                                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                                                        style={{
                                                                                            backgroundColor:
                                                                                                'white',
                                                                                            cursor:
                                                                                                'pointer',
                                                                                        }}
                                                                                    >
                                                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                                                            <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                                                                {
                                                                                                    script
                                                                                                        ?.createdById
                                                                                                        ?.name
                                                                                                }
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                            <div
                                                                                                className="bs-ObjectList-cell-row"
                                                                                                id={`monitor`}
                                                                                            >
                                                                                                {moment(
                                                                                                    script.createdAt
                                                                                                ).format(
                                                                                                    'MMMM Do YYYY, h:mm a'
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                            <div className="Box-root">
                                                                                                {script.status ===
                                                                                                'success' ? (
                                                                                                    <Badge color="green">
                                                                                                        {
                                                                                                            script.status
                                                                                                        }
                                                                                                    </Badge>
                                                                                                ) : script.status ===
                                                                                                  'running' ? (
                                                                                                    <Badge color="yellow">
                                                                                                        {
                                                                                                            script.status
                                                                                                        }
                                                                                                    </Badge>
                                                                                                ) : script.status ===
                                                                                                  'failure' ? (
                                                                                                    <Badge color="red">
                                                                                                        {
                                                                                                            script.status
                                                                                                        }
                                                                                                    </Badge>
                                                                                                ) : null}
                                                                                            </div>
                                                                                        </div>
                                                                                        <div
                                                                                            className="bs-ObjectList-cell bs-u-v-middle"
                                                                                            style={{
                                                                                                display:
                                                                                                    'flex',
                                                                                                justifyContent:
                                                                                                    'flex-end',
                                                                                                alignItems:
                                                                                                    'center',
                                                                                                paddingTop:
                                                                                                    '20px',
                                                                                            }}
                                                                                        >
                                                                                            <div className="Box-root">
                                                                                                <button
                                                                                                    title="view log"
                                                                                                    id={`automated_log_json_`}
                                                                                                    disabled={
                                                                                                        false
                                                                                                    }
                                                                                                    className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                                                    type="button"
                                                                                                    onClick={() =>
                                                                                                        props.openModal(
                                                                                                            {
                                                                                                                id: viewJsonModalId,
                                                                                                                content: DataPathHoC(
                                                                                                                    ViewJsonLogs,
                                                                                                                    {
                                                                                                                        viewJsonModalId,
                                                                                                                        jsonLog: {
                                                                                                                            script:
                                                                                                                                script.script,
                                                                                                                        },
                                                                                                                        title: `Automated Script Log`,
                                                                                                                        rootName:
                                                                                                                            'automatedScript',
                                                                                                                    }
                                                                                                                ),
                                                                                                            }
                                                                                                        )
                                                                                                    }
                                                                                                >
                                                                                                    <span>
                                                                                                        View
                                                                                                        Log
                                                                                                    </span>
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <DeleteScriptBox
                                                                    {...props}
                                                                    name={
                                                                        scriptName
                                                                    }
                                                                    parentRoute={
                                                                        parentRoute
                                                                    }
                                                                />
                                                            </Fade>
                                                        </TabPanel>
                                                    </ShouldRender>
                                                    <ShouldRender if={false}>
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Tabs>
            </Fade>
        </Dashboard>
    );
};

AutomatedScripView.propTypes = {
    history: PropTypes.object.isRequired,
    openModal: PropTypes.func,
    fetchSingleAutomatedScript: PropTypes.func,
    currentProject: PropTypes.object,
    match: PropTypes.object,
    script: PropTypes.object,
};

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
    script: state.automatedScripts.individualScript.data,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ openModal, fetchSingleAutomatedScript }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(AutomatedScripView);
