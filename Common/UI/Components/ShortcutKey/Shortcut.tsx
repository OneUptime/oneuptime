import Char from "Common/Types/Char";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  shortcuts: Array<Char>;
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
