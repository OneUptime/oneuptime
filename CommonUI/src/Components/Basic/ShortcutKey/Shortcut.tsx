import React, { FC, ReactElement } from 'react';
import Char from 'Common/Types/Char';

const Shortcut: FC<{ shortcuts: Array<Char> }> = ({
    shortcuts,
}): ReactElement => {
    return (
        <div className="shortcut">
            {shortcuts.map((shortcut, index) => {
                return <code key={index}>{shortcut}</code>;
            })}
        </div>
    );
};

export default Shortcut;
