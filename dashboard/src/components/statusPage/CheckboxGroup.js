import React from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';

class CheckboxGroup extends React.Component {

    checkboxGroup() {
        let { monitors } = this.props;
         
        return monitors.map((monitor, index) => {
            return (
                <div className="Box-root Margin-bottom--12" key={index}>
                    <div data-test="RetrySettings-failedPaymentsRow" className="Box-root">
                        <label className="Checkbox" >
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
                            <div
                                className="Checkbox-label Box-root Margin-left--8">
                                <span
                                    className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        {monitor.name}
                                    </span>
                                </span>
                            </div>
                        </label>
                        <div className="Box-root Padding-left--24">
                        </div>
                    </div>
                </div>
            )
        });
    }

    render() {
        return (
            <div>
                {this.checkboxGroup()}
            </div>
        )
    }
}

CheckboxGroup.displayName = 'CheckboxGroup'

CheckboxGroup.propTypes = {
    monitors: PropTypes.array.isRequired
}

export default CheckboxGroup;