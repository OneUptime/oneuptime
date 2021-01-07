import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { showDeleteModal } from '../actions/component';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { withRouter } from 'react-router-dom';
import { openModal } from '../actions/modal';
import DeleteComponent from '../components/modals/DeleteComponent';
import { deleteComponent } from '../actions/component';
import { logEvent } from '../analytics';
import { IS_SAAS_SERVICE, User } from '../config';
import { history } from '../store';
import DataPathHoC from '../components/DataPathHoC';
import uuid from 'uuid';

class ComponentSettingsAdvanced extends Component {
    constructor(props) {
        super(props);
        this.state = {
            deleteComponentModalId: uuid.v4(),
        };
    }

    handleClick = () => {
        this.props.showDeleteModal();
    };

    deleteComponent = componentId => {
        const projectId =
            this.props.component.projectId._id ||
            this.props.component.projectId;
        const promise = this.props.deleteComponent(componentId, projectId);
        history.push(
            `/dashboard/project/${User.getCurrentProjectSlug()}/components`
        );
        if (IS_SAAS_SERVICE) {
            logEvent('EVENT: DASHBOARD > COMPONENT > COMPONENT DELETED', {
                ProjectId: this.props.component.projectId._id,
                componentId,
            });
        }
        return promise;
    };

    render() {
        const {
            location: { pathname },
            component,
        } = this.props;

        const { deleteComponentModalId } = this.state;
        const componentName = component && component.name;
        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Advanced" />
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
                                                                        and will
                                                                        no
                                                                        longer
                                                                        be
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
            </Dashboard>
        );
    }
}

ComponentSettingsAdvanced.displayName = 'ComponentSettingsAdvanced';

ComponentSettingsAdvanced.propTypes = {
    showDeleteModal: PropTypes.func,
    openModal: PropTypes.func,
    component: PropTypes.object.isRequired,
    deleteComponent: PropTypes.func,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

const mapStateToProps = (state, ownProps) => {
    const { componentId } = ownProps.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

    return {
        component: component,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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
