import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
}


const TeamSelector = ({ input, meta: { touched, error }, members }) => (
    <span>
        <select {...input} className="bs-Button SearchableSelect-button bs-Button--icon--right bs-Button--icon bs-Button--overflow" style={{width:'320px'}}>
            <option value="">{input.defaultValue || 'Select Team Member...'}</option>
            {
                members.map(member => {
                    return member.role !== 'Viewer' ? (
                      <option value={member.userId} key={member.name}>
                        {member.name}
                      </option>
                    ) : false;
                })
            }
        </select>
        {
            touched && error && <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{marginTop:'5px'}}>
            <div className="Box-root Margin-right--8" style={{marginTop:'2px'}}>
                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                </div>
            </div>
            <div className="Box-root">
                <span style={ errorStyle }>
                    {error}
                </span>
            </div>
        </div>
        }
    </span>
)

TeamSelector.displayName = 'TeamSelector'

TeamSelector.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    input: PropTypes.object.isRequired,
    meta: PropTypes.object.isRequired,
    members: PropTypes.array
  }
  
  function mapStateToProps(state, props) {
    const subProjectTeams = state.team.subProjectTeamMembers;
    const members = subProjectTeams.find(subProjectTeam => subProjectTeam._id === props.subProjectId) || {}
    return {
        members: members.teamMembers || []
    };
}

  export default connect(mapStateToProps)(TeamSelector);