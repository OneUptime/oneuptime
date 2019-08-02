import React from 'react';
import { Field } from 'redux-form';
import IsAdmin from '../basic/IsAdmin';

export default function UserInputs({ users, project }){
    return users.map((user, index) => (
        <div className="Box-root Margin-bottom--12" key={`user ${index}`}>
            <div data-test="RetrySettings-failedPaymentsRow" className="Box-root">
                <label className="Checkbox" htmlFor={`user ${index}`}>
                    <Field 
                        component="input"
                        type="checkbox" 
                        name={user.userId}
                        data-test="RetrySettings-failedPaymentsCheckbox" 
                        className="Checkbox-source" 
                        id={`user ${index}`} 
                        disabled={!IsAdmin(project)}
                    />
                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                        <div className="Checkbox-target Box-root">
                            <div className="Checkbox-color Box-root"></div>
                        </div>
                    </div>
                    <div className="Checkbox-label Box-root Margin-left--8">
                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>{user.name}</span>
                        </span>
                    </div>
                </label>
                <div className="Box-root Padding-left--24">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                        <div className="Box-root">
                            <div className="Box-root">

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    ))
}