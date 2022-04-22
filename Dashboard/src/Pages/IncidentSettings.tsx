import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import { IncidentPrioritiesList } from '../components/incident/IncidentPrioritiesList';
import { openModal, closeModal } from '../actions/modal';
import CreateIncidentPriorityForm from '../components/modals/CreateIncidentPriority';
import EditIncidentPriorityForm from '../components/modals/EditIncidentPriority';
import RemoveIncidentPriorityForm from '../components/modals/RemoveIncidentPriority';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import {
    fetchIncidentTemplates,
    fetchBasicIncidentSettingsVariables,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import DataPathHoC from '../components/DataPathHoC';
import IncidentCommunicationSla from '../components/incidentCommunicationSla/IncidentCommunicationSla';
import IncidentCustomFields from '../components/incident/IncidentCustomFields';
import { fetchCustomFields } from '../actions/customField';
import IncidentTemplates from '../components/incident/IncidentTemplates';
import IncidentNoteTemplates from '../components/incident/IncidentNoteTemplates';

interface IncidentSettingsProps {
    openModal: Function;
    fetchIncidentPriorities: Function;
    currentProject: object;
    incidentPrioritiesList: object;
    location: object;
    incidentPriorities: unknown[];
    fetchIncidentTemplates: Function;
    fetchBasicIncidentSettingsVariables: Function;
    modalId?: object;
    fetchCustomFields?: Function;
    fetchDefaultTemplate?: Function;
    switchToProjectViewerNav?: boolean;
}

class IncidentSettings extends React.Component<IncidentSettingsProps> {
    state = {
        tabIndex: 0,
        page: 1,
    };

    override componentDidMount() {
        resetIdCounter();
        window.addEventListener('keydown', this.handleKeyboard);
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {

        const { modalId }: $TSFixMe = this.props;

        if (e.target.localName === 'body' && e.key) {
            switch (e.key) {
                case 'N':
                case 'n':
                    if (!modalId) {
                        e.preventDefault();
                        return this.handleCreateNewIncidentPriority();
                    }
                    return false;
                default:
                    return false;
            }
        }
    };

    handleCreateNewIncidentPriority() {

        const { openModal }: $TSFixMe = this.props;
        openModal({
            content: CreateIncidentPriorityForm,
        });
    }

    handleEditIncidentPriority(id: $TSFixMe) {

        const { openModal }: $TSFixMe = this.props;
        openModal({
            content: DataPathHoC(EditIncidentPriorityForm, {
                selectedIncidentPriority: id,
            }),
        });
    }

    handleDeleteIncidentPriority(id: $TSFixMe) {

        const { openModal }: $TSFixMe = this.props;
        openModal({
            content: DataPathHoC(RemoveIncidentPriorityForm, {
                selectedIncidentPriority: id,
            }),
        });
    }
    async ready() {

        if (this.props.currentProject) {

            await this.props.fetchIncidentPriorities(

                this.props.currentProject._id
            );

            await this.props.fetchIncidentTemplates({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });

            this.props.fetchDefaultTemplate({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
            });

            await this.props.fetchBasicIncidentSettingsVariables();

            this.props.fetchCustomFields(this.props.currentProject._id, 0, 10);
        }
    }

    prevClicked() {

        const { skip, limit }: $TSFixMe = this.props.incidentPrioritiesList;

        this.props.fetchIncidentPriorities(

            this.props.currentProject._id,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    }
    nextClicked() {

        const { skip, limit }: $TSFixMe = this.props.incidentPrioritiesList;

        this.props.fetchIncidentPriorities(

            this.props.currentProject._id,
            skip + limit,
            10
        );

        const { count }: $TSFixMe = this.props.incidentPrioritiesList;
        this.setState({
            page: this.state.page < count ? this.state.page + 1 : count,
        });
    }
    tabSelected = (index: $TSFixMe) => {
        const tabSlider: $TSFixMe = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    override render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;

        const { skip, limit, count }: $TSFixMe = this.props.incidentPrioritiesList;
        const canPaginateForward: $TSFixMe =

            !this.props.incidentPrioritiesList.requesting &&
                count &&
                count > skip + limit
                ? true
                : false;
        const canPaginateBackward: $TSFixMe =

            !this.props.incidentPrioritiesList.requesting && skip && skip > 0
                ? true
                : false;
        const numberOfPages: $TSFixMe = Math.ceil(parseInt(count) / 10);
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Incidents" />
                <div id="incidentSettingsPage">
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}
                        selectedIndex={this.state.tabIndex}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 incident-templates-tab'
                                    }
                                >
                                    Incident Templates
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 incident-priority-tab'
                                    }
                                >
                                    Incident Priority
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 communication-sla-tab'
                                    }
                                >
                                    Communication SLA
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-3 advanced-tab'
                                    }
                                >
                                    Advanced
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-4"
                                ></div>
                            </TabList>
                        </div>
                        <TabPanel>
                            <Fade>
                                <IncidentTemplates />
                                <IncidentNoteTemplates />
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <div className="Box-root Margin-vertical--12">
                                    <div className="Box-root Margin-bottom--12">
                                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                                            <div className="Box-root">
                                                <div>
                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Incident
                                                                        Priority
                                                                    </span>
                                                                </span>
                                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Incidents
                                                                        can have
                                                                        different
                                                                        severity
                                                                        or
                                                                        priority.
                                                                        You can
                                                                        define
                                                                        your
                                                                        organization
                                                                        incident
                                                                        severity
                                                                        policy
                                                                        here.
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div className="Box-root">
                                                                    <button
                                                                        id="addNewPriority"
                                                                        className="Button bs-ButtonLegacy ActionIconParent"
                                                                        type="button"
                                                                        onClick={() =>
                                                                            this.handleCreateNewIncidentPriority()
                                                                        }
                                                                    >
                                                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                            <div className="Box-root Margin-right--8">
                                                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                                            </div>
                                                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                                                <span>
                                                                                    Add
                                                                                    Priority
                                                                                </span>
                                                                                <span className="new-btn__keycode">
                                                                                    N
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <IncidentPrioritiesList

                                                        incidentPrioritiesList={
                                                            this.props

                                                                .incidentPriorities
                                                        }
                                                        handleEditIncidentPriority={(id: $TSFixMe) => this.handleEditIncidentPriority(
                                                            id
                                                        )
                                                        }
                                                        handleDeleteIncidentPriority={(id: $TSFixMe) => this.handleDeleteIncidentPriority(
                                                            id
                                                        )
                                                        }
                                                    />
                                                </div>
                                                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                <span
                                                                    id="incidentPrioritiesCount"
                                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                                >
                                                                    {numberOfPages >
                                                                        0
                                                                        ? `Page ${this
                                                                            .state
                                                                            .page
                                                                        } of ${numberOfPages} (${count} Priorit${count ===
                                                                            1
                                                                            ? 'y'
                                                                            : 'ies'
                                                                        })`
                                                                        : `${count} Priorit${count ===
                                                                            1
                                                                            ? 'y'
                                                                            : 'ies'
                                                                        }`}
                                                                </span>
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                            <div className="Box-root Margin-right--8">
                                                                <button
                                                                    id="btnPrev"
                                                                    className={`Button bs-ButtonLegacy ${!canPaginateBackward
                                                                        ? 'Is--disabled'
                                                                        : ''
                                                                        }`}
                                                                    data-db-analytics-name="list_view.pagination.previous"
                                                                    disabled={
                                                                        !canPaginateBackward
                                                                    }
                                                                    type="button"
                                                                    onClick={() =>
                                                                        this.prevClicked()
                                                                    }
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Previous
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                            <div className="Box-root">
                                                                <button
                                                                    id="btnNext"
                                                                    className={`Button bs-ButtonLegacy ${!canPaginateForward
                                                                        ? 'Is--disabled'
                                                                        : ''
                                                                        }`}
                                                                    data-db-analytics-name="list_view.pagination.next"
                                                                    disabled={
                                                                        !canPaginateForward
                                                                    }
                                                                    type="button"
                                                                    onClick={() =>
                                                                        this.nextClicked()
                                                                    }
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Next
                                                                            </span>
                                                                        </span>
                                                                    </div>
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
                                <IncidentCommunicationSla
                                    projectId={

                                        this.props.currentProject &&

                                        this.props.currentProject._id
                                    }
                                />
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <IncidentCustomFields

                                    projectId={

                                        this.props.currentProject &&

                                        this.props.currentProject._id
                                    }
                                />
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </div>
            </Fade>
        );
    }
}


IncidentSettings.displayName = 'IncidentSettings';

IncidentSettings.propTypes = {
    openModal: PropTypes.func.isRequired,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    incidentPrioritiesList: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    incidentPriorities: PropTypes.array.isRequired,
    fetchIncidentTemplates: PropTypes.func.isRequired,
    fetchBasicIncidentSettingsVariables: PropTypes.func.isRequired,
    modalId: PropTypes.object,
    fetchCustomFields: PropTypes.func,
    fetchDefaultTemplate: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
};
const mapStateToProps: Function = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        incidentPrioritiesList: state.incidentPriorities.incidentPrioritiesList,
        modalId: state.modal.modals[0],
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
        fetchIncidentPriorities,
        fetchIncidentTemplates,
        fetchBasicIncidentSettingsVariables,
        fetchCustomFields,
        fetchDefaultTemplate,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(IncidentSettings);
