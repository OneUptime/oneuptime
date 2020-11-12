import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import Fade from 'react-reveal/Fade';
import ShouldRender from '../components/basic/ShouldRender';
import { FormLoader } from '../components/basic/Loader';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { showDeleteModal } from '../actions/component';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { withRouter } from 'react-router-dom';

class ComponentSettingsAdvanced extends Component {
    handleClick = () => {
        this.props.showDeleteModal();
    }
    ready = () => {
        
    }
    render() {
        const {
            location: { pathname },
        } = this.props;
        return (
            <Dashboard ready={this.ready}>
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
                                                                        {/* {IS_SAAS_SERVICE &&
                                                                        'Cancel Subscription and'}{' '} */}
                                                                        Delete Component
                                                                    </span>
                                                                </span>
                                                                <p>
                                                                    <span>
                                                                        This component will be deleted PERMANENTLY
                                                                        and will no longer be recoverable.
                                                                    </span>
                                                                </p>
                                                            </div>
                                                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                                                <span className="db-SettingsForm-footerMessage"></span>
                                                                <div>
                                                                    <button
                                                                        className="bs-Button bs-Button--red"
                                                                        onClick={this.handleClick}
                                                                    // disabled={
                                                                    //     currentProject.deleted &&
                                                                    //     currentProject.deleted
                                                                    // }
                                                                    // id={`delete-${currentProject.name}`}
                                                                    >
                                                                        <ShouldRender if={!false}>
                                                                            <span>Delete Component</span>
                                                                        </ShouldRender>
                                                                        <ShouldRender if={false}>
                                                                            <FormLoader />
                                                                        </ShouldRender>
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
        )
    }
}

ComponentSettingsAdvanced.displayName = 'ComponentSettingsAdvanced';

ComponentSettingsAdvanced.propTypes = {
    showDeleteModal: PropTypes.func
}

const mapDispatchToProps = dispatch => 
    bindActionCreators(
        {
            showDeleteModal
        },
        dispatch
    );

export default withRouter(
    connect(null, mapDispatchToProps)(ComponentSettingsAdvanced));