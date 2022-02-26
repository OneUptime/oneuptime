import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field } from 'redux-form';

class CheckboxGroup extends React.Component {
    checkboxGroup() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
        const { monitors } = this.props;

        return monitors.map((monitor: $TSFixMe, index: $TSFixMe) => {
            return (
                <div className="Box-root Margin-bottom--12" key={index}>
                    <div
                        data-test="RetrySettings-failedPaymentsRow"
                        className="Box-root"
                    >
                        <label className="Checkbox">
                            <Field
                                type="checkbox"
                                data-test="RetrySettings-failedPaymentsCheckbox"
                                className="Checkbox-source"
                                name={monitor._id}
                            />
                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                <div className="Checkbox-target Box-root">
                                    <div className="Checkbox-color Box-root"></div>
                                </div>
                            </div>
                            <div className="Checkbox-label Box-root Margin-left--8">
                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>{monitor.name}</span>
                                </span>
                            </div>
                        </label>
                        <div className="Box-root Padding-left--24"></div>
                    </div>
                </div>
            );
        });
    }

    render() {
        return <div>{this.checkboxGroup()}</div>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CheckboxGroup.displayName = 'CheckboxGroup';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CheckboxGroup.propTypes = {
    monitors: PropTypes.array.isRequired,
};

export default CheckboxGroup;
