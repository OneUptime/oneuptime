import React, { useEffect } from 'react';

import { Field } from 'redux-form';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import PropTypes from 'prop-types';

interface ScheduleInputProps {
    schedules: {
        _id: string,
        name: string
    }[];
    currentProject?: {
        _id: string,
        name: string
    };
    fields?: any[];
}

const ScheduleInput = ({
    schedules = [],
    fields,
    currentProject = {}
}: ScheduleInputProps) => {
    useEffect(() => {
        // add default schedule fields if none is available
        if (fields && !fields.length) {

            schedules.forEach(schedule => {
                fields.push({
                    [schedule._id.toString()]: false,
                });
            });
        }
    });

    return (
        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart ">
            {fields.map((fieldName: $TSFixMe, index: $TSFixMe) => {
                return (
                    <div
                        key={`${fieldName}.${schedules[index]
                                ? schedules[index]._id.toString()
                                : index
                            }`}
                        className="Box-root Margin-vertical--8"
                    >
                        <div
                            data-test="RetrySettings-failedPaymentsRow"
                            className="Box-root"
                        >
                            <label className="Checkbox">
                                <Field
                                    component="input"
                                    type="checkbox"
                                    name={`${fieldName}.${schedules[index]
                                            ? schedules[index]._id.toString()
                                            : index
                                        }`}
                                    defaultChecked={true}
                                    data-testId={`${fieldName}.${schedules[index]
                                            ? schedules[index]._id.toString()
                                            : index
                                        }`}
                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                    className="Checkbox-source"
                                    id={`${fieldName}.${schedules[index]
                                            ? schedules[index]._id.toString()
                                            : index
                                        }`}
                                    disabled={
                                        !IsAdminSubProject(currentProject) &&
                                        !IsOwnerSubProject(currentProject)
                                    }
                                />

                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                    <div className="Checkbox-target Box-root">
                                        <div className="Checkbox-color Box-root"></div>
                                    </div>
                                </div>
                                <div className="Checkbox-label Box-root Margin-left--8">
                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span
                                            title={
                                                schedules[index]
                                                    ? schedules[index].name
                                                    : ''
                                            }
                                        >
                                            {schedules[index]
                                                ? schedules[index].name
                                                : ''}
                                        </span>
                                    </span>
                                </div>
                            </label>
                        </div>
                    </div>
                );
            })}

            <div className="Box-root Padding-left--24">
                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                    <div className="Box-root">
                        <div className="Box-root"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

ScheduleInput.displayName = 'ScheduleInput';

ScheduleInput.propTypes = {
    schedules: PropTypes.arrayOf(
        PropTypes.shape({
            _id: PropTypes.string.isRequired,
            name: PropTypes.string.isRequired,
        })
    ).isRequired,
    currentProject: PropTypes.shape({
        _id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
    }),
    fields: PropTypes.arrayOf(PropTypes.any),
};

export default ScheduleInput;
