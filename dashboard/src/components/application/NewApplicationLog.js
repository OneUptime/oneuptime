import React, { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { Field, reduxForm } from 'redux-form';
import { RenderSelect } from '../basic/RenderSelect';

class NewApplicationLog extends Component {
    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>New Application</span>
                                </span>
                                <p>
                                    <span>
                                        Create an application so you and your
                                        team can monitor the logs related to it.
                                    </span>
                                </p>
                            </div>
                        </div>
                        <form id="form-new-application-log">
                                    <div
                                        className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                        style={{ boxShadow: 'none' }}
                                    >
                                        <div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <fieldset className="bs-Fieldset">
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Name
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name={`name_${this.props.index}`}
                                                                    id="name"
                                                                    placeholder="Application Name"
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Application Type
                                                </label>

                                                <div className="bs-Fieldset-fields">
                                                    <span className="flex">
                                                        <Field
                                                            className="db-select-nw"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name={`type_${this.props.index}`}
                                                            id="type"
                                                            placeholder="Application Type"
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Select application type',
                                                                },
                                                                {
                                                                    value: 'a',
                                                                    label:
                                                                        'Option A',
                                                                },
                                                                {
                                                                    value: 'b',
                                                                    label:
                                                                        'Option B',
                                                                },
                                                            ]}
                                                        />
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                    </div>
                </div>
            </div>
        );
    }
}
NewApplicationLog = new reduxForm({
    form: 'NewApplicationLog',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewApplicationLog);

export default NewApplicationLog;
