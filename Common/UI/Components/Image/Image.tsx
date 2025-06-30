// Taiwind
import Route from "../../../Types/API/Route";
import URLFromProject from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import File from "../../../Models/DatabaseModels/File";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick?: () => void | undefined;
  imageUrl?: URLFromProject | Route | ReactElement | undefined;
  height?: number | undefined;
  file?: File | undefined;
  className?: string | undefined;
  alt?: string | undefined;
  style?: React.CSSProperties | undefined;
  "data-testid"?: string;
}

export class ImageFunctions {
  public static getImageURL(file: File): string {
    const blob: Blob = new Blob([file.file as Uint8Array], {
      type: (file as File).fileType as string,
    });

    const url: string = URL.createObjectURL(blob);
    return url;
  }
}

const Image: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetImageElementFunction = (url: string) => ReactElement;

  const getImageElement: GetImageElementFunction = (
    url: string,
  ): ReactElement => {
    return (
      <img
        onClick={() => {
          props.onClick?.();
        }}
        data-testid={props["data-testid"]}
        alt={props.alt}
        src={url}
        height={props.height}
        className={props.className}
        style={props.style}
      />
    );
  };

  if (props.imageUrl) {
    return getImageElement(props.imageUrl.toString());
  }

  if (props.file && props.file.file && props.file.fileType) {
    const url: string = ImageFunctions.getImageURL(props.file);
    return getImageElement(url);
  }

  throw new BadDataException("file or imageUrl required for <Image>");
};

export default Image;
