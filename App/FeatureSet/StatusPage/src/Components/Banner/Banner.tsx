import Image from "Common/UI/Components/Image/Image";
import File from "Common/Models/DatabaseModels/File";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick?: () => void | undefined;
  file?: File | undefined;
}

const Banner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.file) {
    return <></>;
  }

  return (
    <div className="w-full">
      <Image
        onClick={() => {
          if (props.onClick) {
            props.onClick();
          }
        }}
        className="rounded-xl w-full mt-3 mb-3 md:mt-5 md:mb-5 object-cover max-h-48 md:max-h-64 lg:max-h-80"
        file={props.file}
      />
    </div>
  );
};

export default Banner;
