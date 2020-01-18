import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
import { formValueSelector } from 'redux-form';
import PropTypes from 'prop-types';
import Select from 'react-select-fyipe';

let errorStyle = {
    color: 'red',
    topMargin: '5px'
};

const TeamSelector = ({ input, placeholder, meta: { touched, error }, subProjectTeam, form, policyIndex, teamIndex }) => {
    const allowedTeamMembers = makeAllowedTeamMembers(form[policyIndex].team[teamIndex].teamMember, subProjectTeam);

    const allowedOptionsForDropdown = [{ value: '', label: 'Select Team Member...' }].concat(allowedTeamMembers.map(member => {
        return {
            value: member.userId,
            label: member.name,
            show: member.role !== 'Viewer'
        }
    }));
  
    const options = [{ value: '', label: 'Select Team Member...' }].concat(subProjectTeam.map(member => {
        return {
            value: member.userId,
            label: member.name,
            show: member.role !== 'Viewer'
        }
    }));

    const filteredOpt = useRef();
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value, label: filteredOpt.current.length > 0 ?
            filteredOpt.current[0].label : placeholder
    });

    useEffect(() => {
        setValue({
            value: input.value, label: filteredOpt.current.length > 0 ?
                filteredOpt.current[0].label : placeholder
        });
    }, [input, placeholder]);

    const handleChange = (option) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ height: '28px' }}>
                <Select
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    options={allowedOptionsForDropdown.filter(opt => opt.show !== undefined ? opt.show : true)}
                />
            </div>
            {
                touched && error && <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '5px' }}>
                    <div className="Box-root Margin-right--8" style={{ marginTop: '2px' }}>
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                        </div>
                    </div>
                    <div className="Box-root">
                        <span style={errorStyle}>
                            {error}
                        </span>
                    </div>
                </div>
            }
        </span>
    );
};

TeamSelector.displayName = 'TeamSelector';

TeamSelector.propTypes = {
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    meta: PropTypes.object.isRequired,
    members: PropTypes.array,
    policyIndex: PropTypes.number.isRequired,
    form: PropTypes.object.isRequired,
    teamIndex: PropTypes.number.isRequired,
};

function makeAllowedTeamMembers(teamMembers, subProjectTeam = []) {
    const validTeamMembers = teamMembers.filter(member => member.member);
    if (!validTeamMembers.length)
      return subProjectTeam;

    const memberMap = new Map();
    const allowedTeamMembers = [];
    validTeamMembers.forEach(member => {
      memberMap.set(member.member, member);
    });
    const memberArray = Array.from(memberMap.keys());
    subProjectTeam.forEach(TM => {
      if (!memberArray.includes(TM.userId)) 
        allowedTeamMembers.push(TM)
    });

    return allowedTeamMembers;
}

function mapStateToProps(state, props) {
    const selector = formValueSelector('OnCallAlertBox');
    const form = selector(state, 'OnCallAlertBox');
    const subProjectTeams = state.team.subProjectTeamMembers;
    const subProjectTeam = subProjectTeams.find(team => team._id === props.subProjectId) || {};

    return {
        subProjectTeam: subProjectTeam.teamMembers || [],
        form,
    };
}

export default connect(mapStateToProps)(TeamSelector);