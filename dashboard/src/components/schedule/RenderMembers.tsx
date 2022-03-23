import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import { formValueSelector } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderMember } from './RenderMember';

interface RenderMembersProps {
    subProjectId: string;
    meta: object;
    fields: unknown[] | object;
    policyIndex: number;
    teamIndex: number;
    form: unknown[] | object;
}

let RenderMembers = ({
    fields,
    meta: { error, submitFailed },
    subProjectId,
    policyIndex,
    teamIndex,
    form
}: RenderMembersProps) => {
    const policyRotation = form[policyIndex].teams[teamIndex];

    return (
        <ul>
            {fields.map((inputarray: $TSFixMe, i: $TSFixMe) => {
                const memberValue = policyRotation.teamMembers[i];
                return (
                    <RenderMember
                        memberValue={memberValue}
                        subProjectId={subProjectId}
                        policyIndex={policyIndex}
                        teamIndex={teamIndex}
                        inputarray={inputarray}
                        key={i}
                        nameIndex={i}
                        fields={fields}
                    />
                );
            })}

            <li>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center"></div>
                    </div>
                </div>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>
                                <ShouldRender if={fields.length < 10}>
                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() =>
                                            fields.push({
                                                member: '',
                                                timezone: '',
                                                startTime: '',
                                                endTime: '',
                                            })
                                        }
                                    >
                                        Add Team Member
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                Add more team members to this on-call team.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    );
};


RenderMembers.displayName = 'RenderMembers';


RenderMembers.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
    policyIndex: PropTypes.number.isRequired,
    teamIndex: PropTypes.number.isRequired,
    form: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
};

function mapStateToProps(state: $TSFixMe) {
    const selector = formValueSelector('OnCallAlertBox');
    const form = selector(state, 'OnCallAlertBox');

    return {
        form,
    };
}


RenderMembers = connect(mapStateToProps)(RenderMembers);

export { RenderMembers };
