import React, { Component } from 'react';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { showDeleteModal } from '../actions/component';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { openModal } from '../actions/modal';
import DeleteComponent from '../components/modals/DeleteComponent';
import { deleteComponent } from '../actions/component';
import { history } from '../store';
import DataPathHoC from '../components/DataPathHoC';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

class ComponentSettingsAdvanced extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            deleteComponentModalId: uuidv4(),
        };
    }

    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showDeleteModal' does not exist on type ... Remove this comment to see the full error message
        this.props.showDeleteModal();
    };

    deleteComponent = (componentId: $TSFixMe) => {
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.projectId._id ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.component.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteComponent' does not exist on type ... Remove this comment to see the full error message
        const promise = this.props.deleteComponent(componentId, projectId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        history.push(`/dashboard/project/${this.props.slug}/components`);

        return promise;
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteComponentModalId' does not exist o... Remove this comment to see the full error message
        const { deleteComponentModalId } = this.state;
        const componentName = component && component.name;

        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'advanced')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name="Advanced"
                    pageTitle="Advanced"
                />
                <div>
                    <div id="advancedPage">
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span>
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                                <div className="Box-root">
                                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root">
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Delete
                                                                    Component
                                                                </span>
                                                            </span>
                                                            <p>
                                                                <span>
                                                                    This
                                                                    component
                                                                    will be
                                                                    deleted
                                                                    PERMANENTLY
                                                                    and will no
                                                                    longer be
                                                                    recoverable.
                                                                </span>
                                                            </p>
                                                        </div>
                                                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                                            <span className="db-SettingsForm-footerMessage"></span>
                                                            <div>
                                                                <button
                                                                    className="bs-Button bs-Button--red"
                                                                    id={`delete-component-${componentName}`}
                                                                    onClick={() =>
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                        this.props.openModal(
                                                                            {
                                                                                id: deleteComponentModalId,
                                                                                onClose: () =>
                                                                                    '',
                                                                                onConfirm: () =>
                                                                                    this.deleteComponent(
                                                                                        component._id
                                                                                    ),
                                                                                content: DataPathHoC(
                                                                                    DeleteComponent,
                                                                                    {
                                                                                        component: this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                            .component,
                                                                                    }
                                                                                ),
                                                                            }
                                                                        )
                                                                    }
                                                                >
                                                                    <span>
                                                                        Delete
                                                                        Component
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ComponentSettingsAdvanced.displayName = 'ComponentSettingsAdvanced';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ComponentSettingsAdvanced.propTypes = {
    showDeleteModal: PropTypes.func,
    openModal: PropTypes.func,
    slug: PropTypes.string,
    component: PropTypes.object.isRequired,
    deleteComponent: PropTypes.func,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        component:
            state.component && state.component.currentComponent.component,
        slug: state.project.currentProject && state.project.currentProject.slug,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        showDeleteModal,
        openModal,
        deleteComponent,
    },
    dispatch
);

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ComponentSettingsAdvanced)
);
