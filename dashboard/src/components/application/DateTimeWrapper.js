import React, { Component } from 'react';
import DateTimeSelector from '../basic/DateTimeSelector';
import { Field, reduxForm } from 'redux-form';
import PropTypes from 'prop-types';
import * as moment from 'moment';

class DateTimeWrapper extends Component {
    render() {
        const { name, label, currentDate, id } = this.props;
        return (
            <div>
                <form>
                    <fieldset className="Margin-bottom--16">
                        <div className="bs-Fieldset-rows">
                            <div
                                className="bs-Fieldset-row Flex-flex Flex-direction--column"
                                style={{ padding: 0 }}
                            >
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
                                        label={label}
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

DateTimeWrapper.displayName = 'DateTimeWrapper';

DateTimeWrapper.propTypes = {
    name: PropTypes.string,
    label: PropTypes.string,
    id: PropTypes.string,
    currentDate: PropTypes.instanceOf(moment),
};

export default reduxForm({
    form: 'dateTimeWrapper',
})(DateTimeWrapper);
