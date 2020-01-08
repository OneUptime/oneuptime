import React from 'react';
import PropTypes from 'prop-types'
import { FieldArray } from 'redux-form';
import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderNames } from './RenderNames';
import { RenderSelect } from './RenderSelect';

let RenderTeams = ({ fields, subProjectId, policyIndex }) => {
  return (
    <ul>
      {
        fields.map((team, i) => {
          return (
            <li key={i}>
              <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">Team {i + 1}</label>
                  <div className="bs-Fieldset-row">
                    <FieldArray
                        className="db-BusinessSettings-input TextInput bs-TextInput"
                        name={`${team}.teamMember`}
                        component={RenderNames}
                        subProjectId={subProjectId}
                        policyIndex={policyIndex}
                        teamIndex={i}
                    />
                  </div>
              
              <ShouldRender if={fields.length > 1}>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <button
                                className="bs-Button bs-DeprecatedButton"
                                type="button"                                     
                                onClick={() => fields.remove(i)}
                            >
                                Remove Team
                            </button>
                        </div>
                    </div>
                </div>
              </ShouldRender>
            </div>
            </li>
          )
        })
      }

      <div className="bs-Fieldset-row">
        <label className="bs-Fieldset-label"></label>
        <div className="bs-Fieldset-fields">
            <div className="Box-root Flex-flex Flex-alignItems--center">
                <div>
                    <ShouldRender if={fields.length < 10}>
                        <button
                            type="button"
                            className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                            onClick={() => fields.push({
                              teamMember: [
                                {
                                    member: '',
                                    timezone: '',
                                    startTime: '',
                                    endTime: ''
                                }
                              ],
                            })}
                        >
                            Add Team
                        </button>
                    </ShouldRender>
                </div>
            </div>
            <p className="bs-Fieldset-explanation">
                <span>
                    Add Names and respective alert medium and time to contact.
                </span>
            </p>
        </div>
      </div>
    </ul>
  )
}

RenderTeams.displayName = 'RenderTeams';

RenderTeams.propTypes = {
  subProjectId: PropTypes.string.isRequired,
  fields: PropTypes.oneOfType([
      PropTypes.array,
      PropTypes.object
  ]).isRequired,
  policyIndex: PropTypes.number.isRequired,
}

export { RenderTeams };