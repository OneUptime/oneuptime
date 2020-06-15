import React, { Component } from 'react';
import DateTimeSelector from '../basic/DateTimeSelector';
import { Field, reduxForm } from 'redux-form';

class DateTimeWrapper extends Component {
    render() {
        const { name, label, currentDate, id} = this.props;
        return (
            <div>
                <form>
                    <fieldset className="Margin-bottom--16">
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row Flex-flex Flex-direction--column"
                                style={{ padding: 0 }}
                            >
                                <label
                                    className="bs-Fieldset-label Text-align--left"
                                    htmlFor="monitorIds"
                                >
                                    <span> {label}</span>
                                </label>
                                <div className="bs-Fieldset-field">
                                    <Field
                                        className="bs-TextInput"
                                        type="text"
                                        name={name}
                                        component={DateTimeSelector}
                                        placeholder="10pm"
                                        style={{
                                            width: '250px',
                                            fontWeight: 'bold',
                                        }}
                                        value={currentDate}
                                        id={id}
                                    />
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </form>
            </div>
        );
    }
}

export default reduxForm({
    form: 'dateTimeWrapper',
})(DateTimeWrapper);
