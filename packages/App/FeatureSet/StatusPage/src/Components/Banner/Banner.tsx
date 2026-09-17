import Image from "Common/UI/Components/Image/Image";
import File from "Common/Models/DatabaseModels/File";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick?: () => void | undefined;
  file?: File | undefined;
  alt?: string | undefined;
}

const Banner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.file) {
    return <></>;
  }

  /*
   * The image used to size itself, so it occupied nothing until the blob
   * decoded and then pushed the header, nav and all the content down by up to
   * 320px — the biggest layout shift on the page, on every load. Give it a
   * container with a fixed height and let object-cover fill it. Cover images
   * shorter than the clamp are now cropped to the banner rather than rendering
   * at their own height.
   */
  return (
    <div className="mb-5 mt-5 h-48 w-full overflow-hidden rounded-lg bg-gray-100 md:h-64 lg:h-80">
      <Image
        onClick={() => {
          if (props.onClick) {
            props.onClick();
          }
        }}
        className="h-full w-full object-cover"
        file={props.file}
        alt={props.alt || ""}
      />
    </div>
  );
};

export default Banner;
