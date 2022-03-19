import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import UpgradePlanFields from './UpgradePlanFields';
import { Spinner } from '../basic/Loader';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.planId)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Please select a plan.';
    }

    return errors;
}

export const UpgradeForm = (this: $TSFixMe, props: $TSFixMe) => {
    const {
        handleSubmit,
        hideForm,
        errorStack,
        projects,
        submitFailed,
        submitting,
        submitUpgradePlan,
    } = props;

    return (
        <form onSubmit={handleSubmit(submitUpgradePlan.bind(this))}>
            <div className="bs-Modal bs-Modal--medium">
                <ClickOutside onClickOutside={hideForm}>
                    <div className="bs-Modal-header">
                        <div className="bs-Modal-header-copy">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Upgrade Plan</span>
                            </span>
                        </div>
                        <div className=" Margin-top--4">
                            <span className="Margin-bottom--12">
                                Upgrade your plan to add more monitors.
                            </span>
                        </div>

                        <div className="bs-Modal-messages">
                            <ShouldRender if={submitFailed}>
                                <p className="bs-Modal-message">{errorStack}</p>
                            </ShouldRender>
                        </div>
                    </div>
                    <div className="bs-Modal-content">
                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                            <fieldset className="bs-Fieldset">
                                <div className="bs-Fieldset-rows">
                                    <div
                                        className="bs-Fieldset-row .Flex-justifyContent--center"
                                        style={{ padding: 0 }}
                                    >
                                        // @ts-expect-error ts-migrate(2786) FIXME: 'UpgradePlanFields' cannot be used as a JSX compon... Remove this comment to see the full error message
                                        <UpgradePlanFields {...props} />
                                    </div>
                                </div>
                            </fieldset>
                        </div>
                    </div>
                    <div className="bs-Modal-footer">
                        <div className="bs-Modal-footer-actions">
                            <button
                                className={`bs-Button bs-DeprecatedButton ${submitting &&
                                    'bs-is-disabled'}`}
                                type="button"
                                onClick={hideForm}
                                disabled={submitting}
                            >
                                <ShouldRender if={projects.canUpgrade}>
                                    <span>Cancel</span>
                                </ShouldRender>
                                <ShouldRender if={!projects.canUpgrade}>
                                    <span>Close</span>
                                </ShouldRender>
                            </button>
                            <ShouldRender if={projects.canUpgrade}>
                                <button
                                    className={`bs-Button bs-DeprecatedButton bs-Button--blue ${submitting &&
                                        'bs-is-disabled'}`}
                                    type="submit"
                                    disabled={submitting}
                                    autoFocus={true}
                                >
                                    <ShouldRender if={submitting}>
                                        <Spinner />
                                    </ShouldRender>
                                    <span>Upgrade Plan</span>
                                </button>
                            </ShouldRender>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        </form>
    );
}

UpgradeForm.displayName = 'UpgradeForm';

UpgradeForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    hideUpgradeForm: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    submitUpgradePlan: PropTypes.func.isRequired,
    errorStack: PropTypes.array,
    submitFailed: PropTypes.bool,
    submitting: PropTypes.bool,
    canUpgrade: PropTypes.bool,
    projects: PropTypes.object,
};

export default reduxForm({
    form: 'UpgradeForm',
    validate,
})(UpgradeForm);
