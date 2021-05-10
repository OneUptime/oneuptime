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
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class UpgradePlanModal extends Component {
    constructor(props) {
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
        this.props.hideUpgradeForm();
        this.props.resetCreateMonitor();
    };

    upgradePlan(values) {
        const { _id: id, name } = this.props.currentProject;
        const {
            category: oldCategory,
            type: oldType,
            details: oldDetails,
        } = PricingPlan.getPlanById(this.props.initialValues.planId);
        const oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;
        const {
            category: newCategory,
            type: newType,
            details: newDetails,
        } = PricingPlan.getPlanById(values.planId);
        const newPlan = `${newCategory} ${newType}ly (${newDetails})`;
        this.props.changePlan(id, values.planId, name, oldPlan, newPlan);
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > PROJECT > PLAN CHANGED', {
                oldPlan,
                newPlan,
            });
        }
        this.hideForm();
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.hideForm();
            default:
                return false;
        }
    };

    render() {
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

const mapStateToProps = state => {
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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

UpgradePlanModal.displayName = 'UpgradePlanModal';

UpgradePlanModal.propTypes = {
    dispatch: PropTypes.func.isRequired,
    hideUpgradeForm: PropTypes.func.isRequired,
    changePlan: PropTypes.func.isRequired,
    resetCreateMonitor: PropTypes.func.isRequired,
    projects: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    initialValues: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    visible: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(UpgradePlanModal);
