import React from 'react';
import PropTypes from 'prop-types'
import { FieldArray } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderMembers } from './RenderMembers';

let RenderTeams = ({
  fields, subProjectId, policyIndex,
  rotationFrequency
}) => {
  const canAddTeams = !!rotationFrequency
  return (
    <ul>
      {
        fields.map((team, i) => {
          return (
            <li key={i} className="team">
              {fields.length > 1 && <>
                <hr className="team-line-demarcator" />
                <div className="team-header-label">
                  <h3>{`Team ${i + 1}`}</h3>
                </div>
              </>}
              <div >
                <FieldArray
                  className="db-BusinessSettings-input TextInput bs-TextInput"
                  name={`${team}.teamMembers`}
                  component={RenderMembers}
                  subProjectId={subProjectId}
                  policyIndex={policyIndex}
                  teamIndex={i}
                />

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
      {canAddTeams && (<><hr className="team-line-demarcator" />
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
                      teamMembers: [
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
                Add teams for rotation duty.
                  </span>
            </p>
          </div>

        </div>
      </>
      )}
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
  rotationFrequency: PropTypes.string.isRequired
}

export { RenderTeams };