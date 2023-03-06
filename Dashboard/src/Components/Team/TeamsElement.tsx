import Team from 'Model/Models/Team';
import React, { FunctionComponent, ReactElement } from 'react';
import TeamElement from './Team';

export interface ComponentProps {
    teams: Array<Team>;
    onNavigateComplete?: (() => void) | undefined;
}

const TeamsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.teams || props.teams.length === 0) {
        return <p>No teams.</p>;
    }

    return (
        <div>
            {props.teams.map((team: Team, i: number) => {
                return (
                    <span key={i}>
                        <TeamElement
                            team={team}
                            onNavigateComplete={props.onNavigateComplete}
                        />
                        {i !== props.teams.length - 1 && (
                            <span>,&nbsp;</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
};

export default TeamsElement;
