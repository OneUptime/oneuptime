import StatusPage from 'Model/Models/StatusPage';
import React, { FunctionComponent, ReactElement } from 'react';
import StatusPageElement from './StatusPageLabel';

export interface ComponentProps {
    statusPages: Array<StatusPage>;
    onNavigateComplete?: (() => void) | undefined;
}

const StatusPagesElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.statusPages || props.statusPages.length === 0) {
        return <p>No Status Pages.</p>;
    }

    return (
        <div>
            {props.statusPages.map((statusPage: StatusPage, i: number) => {
                return (
                    <span key={i}>
                        <StatusPageElement
                            statusPage={statusPage}
                            onNavigateComplete={props.onNavigateComplete}
                        />
                        {i !== props.statusPages.length - 1 && (
                            <span>,&nbsp;</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
};

export default StatusPagesElement;
