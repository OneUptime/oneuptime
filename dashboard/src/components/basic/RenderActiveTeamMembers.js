import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

let RenderActiveTeamMembers = ({ team, subProjectTeam, rotationFrequency, rotationSwitchTime, activeTeam }) => {
  let rotationTeam = [];
  if (team && subProjectTeam) {
    rotationTeam = composeProjectTeam(team.teamMember, subProjectTeam.teamMembers);
  }

  return (
    <div>
      {(rotationFrequency && rotationSwitchTime) && (
        <div style={{ marginBottom: 5 }}>
          {!activeTeam ? (
            <div>
              <span className="Text-color--inherit Text-fontSize--12 Text-typeface--base">Start Time:&nbsp;&nbsp;</span>
              <span className="Text-color--inherit Text-fontSize--11 Text-typeface--base">{team.rotationStartTime}</span>
            </div>
          ): (<div style={{ height: 8 }} />)}
          <div>
            <span className="Text-color--inherit Text-fontSize--12 Text-typeface--base">End Time:&nbsp;&nbsp;</span>
            <span className="Text-color--inherit Text-fontSize--11 Text-typeface--base">{team.rotationEndTime}</span>
          </div>
        </div>
      )}
      <span className="Text-color--inherit Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--22 Text-typeface--base Text-wrap--wrap Margin-top--5">
          <span>Members:&nbsp;&nbsp;</span>
      </span>
      <span>
        {rotationTeam.length && rotationTeam.map((member, index) => {
          const { name } = member;
          return (
            <span key={index} className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--light Text-lineHeight--22 Text-typeface--base Text-wrap--wrap Margin-top--5">
              {name}.&nbsp;&nbsp;
            </span>
          )
        })}
      </span>
    </div>
  )
}

RenderActiveTeamMembers.displayName = 'RenderActiveTeamMembers';
RenderActiveTeamMembers.propTypes = {};

const mapStateToProps = (state, props) => {
  const { subProjectId } = props;
  const subProjectTeams = state.team.subProjectTeamMembers;
  const subProjectTeam = subProjectTeams.find(team => team._id === subProjectId);
  return { subProjectTeam }
}

function composeProjectTeam(team, subProjectTeam) {
  const memberMap = new Map();
  const composedTeamMembers = [];
  team.forEach(member => {
    memberMap.set(member.member, member);
  });
  const memberIdArray = Array.from(memberMap.keys());
  subProjectTeam.forEach(TM => {
    if (memberIdArray.includes(TM.userId)) {
      const composedMember = {
        ...memberMap.get(TM.userId),
        name: TM.name,
      }
      composedTeamMembers.push(composedMember)
    }
  });
  return composedTeamMembers;
}

RenderActiveTeamMembers = connect(mapStateToProps)(RenderActiveTeamMembers);

RenderActiveTeamMembers.propTypes = {
  team: PropTypes.object.isRequired,
  subProjectTeam: PropTypes.object.isRequired,
  rotationFrequency: PropTypes.string,
  rotationSwitchTime: PropTypes.string,
  activeTeam: PropTypes.bool,
}

export { RenderActiveTeamMembers };
