import Image from "Common/UI/Components/Image/Image";
import File from "Common/Models/DatabaseModels/File";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick: () => void;
  file: File;
  alt?: string | undefined;
  style?: React.CSSProperties | undefined;
}

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="flex items-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      role="button"
      tabIndex={0}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        // The logo navigates home; make it operable with the keyboard (WCAG 2.1.1).
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onClick();
        }
      }}
    >
      <Image
        file={props.file}
        onClick={props.onClick}
        height={50}
        alt={props.alt}
        style={props.style}
      />
    </div>
  );
};

export default Logo;
