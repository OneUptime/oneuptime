import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import UpgradeForm from '../project/UpgradeForm';
import {
    hideUpgradeForm,
    changePlan,
    upgradePlanEmpty,
} from '../../actions/project';
import { createMonitor, resetCreateMonitor } from '../../actions/monitor';
import PropTypes from 'prop-types';
import { PricingPlan } from '../../config';

export class UpgradePlanModal extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.upgradePlan = this.upgradePlan.bind(this);
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    hideForm = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideUpgradeForm' does not exist on type ... Remove this comment to see the full error message
        this.props.hideUpgradeForm();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetCreateMonitor' does not exist on ty... Remove this comment to see the full error message
        this.props.resetCreateMonitor();
    };

    upgradePlan(values: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { _id: id, name } = this.props.currentProject;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type '{ cate... Remove this comment to see the full error message
            category: oldCategory,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{ category... Remove this comment to see the full error message
            type: oldType,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type '{ categ... Remove this comment to see the full error message
            details: oldDetails,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
        } = PricingPlan.getPlanById(this.props.initialValues.planId);
        const oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type '{ cate... Remove this comment to see the full error message
            category: newCategory,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{ category... Remove this comment to see the full error message
            type: newType,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type '{ categ... Remove this comment to see the full error message
            details: newDetails,
        } = PricingPlan.getPlanById(values.planId);
        const newPlan = `${newCategory} ${newType}ly (${newDetails})`;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePlan' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.changePlan(id, values.planId, name, oldPlan, newPlan);

        this.hideForm();
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.hideForm();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'Readonl... Remove this comment to see the full error message
        return this.props.visible ? (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        {
                            <UpgradeForm
                                submitUpgradePlan={this.upgradePlan}
                                {...this.props}
                                hideForm={this.hideForm}
                            />
                        }
                    </div>
                </div>
            </div>
        ) : null;
    }
}
// }

const mapStateToProps = (state: $TSFixMe) => {
    const planId = state.project.currentProject
        ? state.project.currentProject.stripePlanId
        : '';
    return {
        initialValues: { planId },
        visible: state.project.showUpgradeForm,
        errorStack: state.project.newProject.error,
        projects: state.project,
        currentProject: state.project.currentProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        changePlan,
        dispatch,
        hideUpgradeForm,
        createMonitor,
        resetCreateMonitor,
        upgradePlanEmpty,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UpgradePlanModal.displayName = 'UpgradePlanModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UpgradePlanModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    hideUpgradeForm: PropTypes.func.isRequired,
    changePlan: PropTypes.func.isRequired,
    resetCreateMonitor: PropTypes.func.isRequired,
    projects: PropTypes.object,
    visible: PropTypes.bool,
    currentProject: PropTypes.object,
    initialValues: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(UpgradePlanModal);
