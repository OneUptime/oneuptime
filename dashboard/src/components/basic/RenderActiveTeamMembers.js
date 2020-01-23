import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

let RenderActiveTeamMembers = ({ team, subProjectTeam, rotationFrequency }) => {
  let rotationTeam = [];
  if (team && subProjectTeam) {
    rotationTeam = composeProjectTeam(team.teamMember, subProjectTeam.teamMembers);
  }
  console.log('tesm', team, typeof new Date(team.rotationStartTime), typeof team.rotationStartTime)
  return (
    <div style={{ marginLeft: '2%' }}>
      {rotationFrequency && (
        <>
          <div>
            <span style={{ fontSize: 12 }}>Start Time:&nbsp;</span>
            <span style={{ fontSize: 11 }}>{composeDateFormat(rotationFrequency, parseISO(team.rotationStartTime))}</span>
          </div>
          <div>
            <span style={{ fontSize: 12 }}>End Time:&nbsp;</span>
            <span style={{ fontSize: 11 }}>{composeDateFormat(rotationFrequency, parseISO(team.rotationEndTime))}</span>
          </div>
        </>
      )}
      <h4>Members:</h4>
      <div style={{ marginLeft: '2%' }}>
        {rotationTeam.length && rotationTeam.map((member, index) => {
          const { name } = member;
          return (
            <div key={index}
              style={{
                backgroundColor: 'white',
                padding: '3px 10px',
                margin: '5px 0',
                width: '50%',
                borderRadius: 5,
              }}>
              <h5>{name}</h5>
            </div>
          )
        })}
      </div>
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

function composeDateFormat(rotationFrequency, date){
  if(!rotationFrequency)
    return format(date, 'do, h:mm aaa')
  switch(rotationFrequency) {
    case 'months':
      return format(date, 'EEE, do LLL: h:mm aaa');
    case 'weeks':
      return format(date, 'EEEE do, h:mm aaa');
    case 'days':
      return format(date, 'do, h:mm aaa')
  }
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
}

export { RenderActiveTeamMembers };
