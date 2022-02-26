import React, { Component } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import CustomerBalance from '../components/paymentCard/CustomerBalance';
import AlertCharges from '../components/alert/AlertCharges';
import ChangePlan from '../components/settings/ChangePlan';
import AlertAdvanceOption from '../components/settings/AlertAdvanceOption';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import { getSmtpConfig } from '../actions/smsTemplates';
import { bindActionCreators } from 'redux';
import DeleteProject from '../components/settings/DeleteProject';
import RenderIfOwner from '../components/basic/RenderIfOwner';

class Billing extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSmtpConfig' does not exist on type 'R... Remove this comment to see the full error message
        this.props.getSmtpConfig(this.props.currentProjectId);
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertEnable' does not exist on type 'Rea... Remove this comment to see the full error message
            alertEnable,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
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
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Billing" />
                <div id="billingSetting" className="Margin-vertical--12">
                    <ShouldRender if={!alertEnable}>
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ page: string; }' is not assignable to type... Remove this comment to see the full error message
                        <AlertDisabledWarning page="Billing" />
                    </ShouldRender>
                    <ShouldRender if={currentProject}>
                        <AlertAdvanceOption />
                    </ShouldRender>
                    <CustomerBalance />
                    <AlertCharges />
                    <ShouldRender if={currentProject}>
                        <ChangePlan />
                    </ShouldRender>
                    <RenderIfOwner>
                        <DeleteProject />
                    </RenderIfOwner>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Billing.displayName = 'Billing';

const mapStateToProps = (state: $TSFixMe) => {
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    return {
        currentProjectId: projectId,
        alertEnable:
            state.form.AlertAdvanceOption &&
            state.form.AlertAdvanceOption.values.alertEnable,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            getSmtpConfig,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Billing.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    alertEnable: PropTypes.bool,
    currentProject: PropTypes.object,
    currentProjectId: PropTypes.string.isRequired,
    getSmtpConfig: PropTypes.func.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(Billing);
