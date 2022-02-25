import React, { useEffect, useState } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import originalMoment from 'moment';
import { extendMoment } from 'moment-range';
import ShouldRender from './ShouldRender';
import { Field, reduxForm } from 'redux-form';
import DateTimeWrapper from './DateTimeWrapper';
const moment = extendMoment(originalMoment);

function DateTimeRangePicker({
    currentDateRange,
    handleStartDateTimeChange,
    handleEndDateTimeChange,
    formId,
    style,
}) {
    const currentDate = moment();
    const [key, setkey] = useState(0);
    useEffect(() => {
        setkey(key + 1);
    }, [
        currentDateRange && currentDateRange.startDate,
        currentDateRange && currentDateRange.endDate,
    ]);
    return (
        <div>
            <form id={formId} key={key}>
                <ShouldRender if={currentDateRange}>
                    <div className="db-DateRangeInputWithComparison">
                        <div
                            className="db-DateRangeInput bs-Control"
                            style={{
                                cursor: 'pointer',
                                height: '35px',
                                ...style,
                            }}
                        >
                            <div
                                className="db-DateRangeInput-input"
                                role="button"
                                tabIndex="0"
                                style={{
                                    cursor: 'pointer',
                                }}
                            >
                                <span className="db-DateRangeInput-start">
                                    <Field
                                        type="text"
                                        name="startDate"
                                        component={DateTimeWrapper}
                                        id="startDate"
                                        maxDate={currentDate}
                                        onChange={handleStartDateTimeChange}
                                    />
                                </span>
                                <img
                                    alt="next"
                                    src="/dashboard/assets/icons/next.svg"
                                    style={{
                                        height: '14px',
                                        width: '14px',
                                    }}
                                />
                                <span className="db-DateRangeInput-end">
                                    <Field
                                        type="text"
                                        name="endDate"
                                        component={DateTimeWrapper}
                                        id="endDate"
                                        maxDate={currentDate}
                                        onChange={handleEndDateTimeChange}
                                    />
                                </span>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </form>
        </div>
    );
}

DateTimeRangePicker.displayName = 'DateTimeRangePicker';

DateTimeRangePicker.propTypes = {
    currentDateRange: PropTypes.object,
    formId: PropTypes.string,
    handleEndDateTimeChange: PropTypes.func,
    handleStartDateTimeChange: PropTypes.func,
    style: PropTypes.object,
};

function mapStateToProps(state, ownProps) {
    const { currentDateRange } = ownProps;
    return {
        initialValues: currentDateRange,
        form: ownProps.formId ? ownProps.formId : 'dateTimeRangePickerForm',
    };
}
const DateTimeRangePickerForm = reduxForm({
    enableReinitialize: true,
    destroyOnUnmount: true,
})(DateTimeRangePicker);
export default connect(mapStateToProps)(DateTimeRangePickerForm);
