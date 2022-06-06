import React, { ReactElement, FunctionComponent } from 'react';
import Char from 'Common/Types/Char';

export interface ComponentProps{
     shortcuts: Array<Char> 
}

const Shortcut: FunctionComponent<ComponentProps> = ({
    shortcuts,
}: ComponentProps): ReactElement => {
    return (
        <div className="shortcut">
            {shortcuts.map((shortcut: Char, index: number) => {
                return <code key={index}>{shortcut}</code>;
            })}
        </div>
    );
};

export default Shortcut;
