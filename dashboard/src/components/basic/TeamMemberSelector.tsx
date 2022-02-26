import React, { useState, useRef, useEffect } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { formValueSelector } from 'redux-form';
import PropTypes from 'prop-types';
import Select from './Select';

const errorStyle = {
    color: 'red',
    topMargin: '5px',
};

const TeamMemberSelector = ({
    id,
    input,
    placeholder,
    meta: { touched, error },
    subProjectTeam,
    form,
    policyIndex,
    teamIndex,
    projectGroups,
    renderType
}: $TSFixMe) => {
    const allowedTeamMembers = makeAllowedTeamMembers(
        form[policyIndex].teams[teamIndex].teamMembers,
        subProjectTeam
    );
    const groups =
        (projectGroups.groups &&
            projectGroups.groups.map((group: $TSFixMe) => {
                return {
                    value: group._id,
                    label: group.name,
                };
            })) ||
        [];
    const allowedGroups = makeAllowedGroups(
        projectGroups.groups && projectGroups.groups,
        form[policyIndex].teams[teamIndex].teamMembers
    );

    const allowedOptionsForDropdown =
        renderType === 'team'
            ? [
                  {
                      value: '',
                      label:
                          allowedTeamMembers.length === 0
                              ? 'No team member available'
                              : 'Select Team Member...',
                  },
              ].concat(
                  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'member' implicitly has an 'any' type.
                  allowedTeamMembers.map(member => {
                      return {
                          value: member.userId,
                          label: member.name ? member.name : member.email,
                          show: member.role !== 'Viewer',
                      };
                  })
              )
            : [
                  {
                      value: '',
                      label:
                          allowedGroups.length === 0
                              ? 'No group available'
                              : 'Select Group...',
                  },
              ].concat(
                  allowedGroups.map(group => {
                      return {
                          // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                          value: group._id,
                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'never'.
                          label: group.name,
                      };
                  })
              );

    const options =
        renderType === 'team'
            ? [{ value: '', label: 'Select Team Member...' }].concat(
                  subProjectTeam.map((member: $TSFixMe) => {
                      return {
                          value: member.userId,
                          label: member.name ? member.name : member.email,
                          show: member.role !== 'Viewer',
                      };
                  })
              )
            : [{ value: '', label: 'Select Group...' }].concat(groups);

    const filteredOpt = useRef();
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ value: string; label: string; }[]' is not ... Remove this comment to see the full error message
    filteredOpt.current = options.filter(opt => opt.value === input.value);

    const [value, setValue] = useState({
        value: input.value,
        label:
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            filteredOpt.current.length > 0
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                ? filteredOpt.current[0].label
                : placeholder,
    });

    useEffect(() => {
        setValue({
            value: input.value,
            label:
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                filteredOpt.current.length > 0
                    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                    ? filteredOpt.current[0].label
                    : placeholder,
        });
    }, [input, placeholder]);

    const handleChange = (option: $TSFixMe) => {
        setValue(option);
        if (input.onChange) {
            input.onChange(option.value);
        }
    };

    return (
        <span>
            <div style={{ height: '28px' }}>
                <Select
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ id: any; name: any; value: { value: any; l... Remove this comment to see the full error message
                    id={id}
                    name={input.name}
                    value={value}
                    onChange={handleChange}
                    className="db-select-nw"
                    options={allowedOptionsForDropdown.filter(opt =>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'show' does not exist on type '{ value: s... Remove this comment to see the full error message
                        opt.show !== undefined ? opt.show : true
                    )}
                />
            </div>
            {touched && error && (
                <div
                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                    style={{ marginTop: '5px' }}
                >
                    <div
                        className="Box-root Margin-right--8"
                        style={{ marginTop: '2px' }}
                    >
                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                    </div>
                    <div className="Box-root">
                        <span style={errorStyle}>{error}</span>
                    </div>
                </div>
            )}
        </span>
    );
};

TeamMemberSelector.displayName = 'TeamMemberSelector';

TeamMemberSelector.propTypes = {
    id: PropTypes.string,
    input: PropTypes.object.isRequired,
    placeholder: PropTypes.string,
    meta: PropTypes.object.isRequired,
    subProjectTeam: PropTypes.array,
    policyIndex: PropTypes.number.isRequired,
    form: PropTypes.object.isRequired,
    teamIndex: PropTypes.number.isRequired,
    projectGroups: PropTypes.object,
    renderType: PropTypes.string,
};

function makeAllowedTeamMembers(teamMembers = [], subProjectTeam = []) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'never'.
    const validTeamMembers = teamMembers.filter(member => member.userId);
    if (validTeamMembers.length === 0) return subProjectTeam;

    const memberMap = new Map();
    const allowedTeamMembers: $TSFixMe = [];
    validTeamMembers.forEach(member => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'never'.
        memberMap.set(member.userId, member);
    });
    const memberArray = Array.from(memberMap.keys());
    subProjectTeam.forEach(TM => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'never'.
        if (!memberArray.includes(TM.userId)) allowedTeamMembers.push(TM);
    });

    return allowedTeamMembers;
}

function makeAllowedGroups(groups = [], projectGroups = []) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupId' does not exist on type 'never'.
    const validGroup = projectGroups.filter(group => group.groupId);
    if (validGroup.length === 0) return groups;
    const filteredGroups = groups.filter(
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'groupId' does not exist on type 'never'.
        group => !validGroup.some(grp => grp.groupId === group._id)
    );
    return filteredGroups;
}

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const selector = formValueSelector('OnCallAlertBox');
    const form = selector(state, 'OnCallAlertBox');
    const subProjectTeams = state.team.subProjectTeamMembers;
    const subProjectTeam =
        subProjectTeams.find((team: $TSFixMe) => team._id === props.subProjectId) || {};

    return {
        subProjectTeam: subProjectTeam.teamMembers || [],
        form,
        projectGroups: state.groups.oncallDuty,
    };
}

export default connect(mapStateToProps)(TeamMemberSelector);
