import React, { FC, ReactElement } from 'react';

const Shortcut: FC<{ shortcuts: Array<string> }> = ({
    shortcuts,
}): ReactElement => {
    return (
        <div className="shortcut">
            {shortcuts.map((shortcut, index) => (
                <code key={index}>{shortcut}</code>
            ))}
        </div>
    );
};

export default Shortcut;
