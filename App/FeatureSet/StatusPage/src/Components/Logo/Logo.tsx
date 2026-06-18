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
    <div className="flex items-center">
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
