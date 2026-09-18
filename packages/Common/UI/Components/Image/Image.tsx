// Taiwind
import URLFromProject from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import File from "../../../Models/DatabaseModels/File";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The src of an <img>.
 *
 * Deliberately no Route member. A Route is a same-origin application PATH and
 * rejects scheme-prefixed values by design (Common/Types/API/Route.ts). An
 * image src is routinely scheme-prefixed - esbuild's file-loader inlines every
 * .svg/.png import as a "data:" URL (Common/UI/esbuild-config.js). Wrapping one
 * in a Route to satisfy this type is what threw on every dashboard page once
 * Route started rejecting schemes. Pass a string; `someRoute.toString()` if you
 * are starting from a Route.
 */
export type ImageSource = string | URLFromProject | ReactElement;

export interface ComponentProps {
  onClick?: () => void | undefined;
  imageUrl?: ImageSource | undefined;
  height?: number | undefined;
  file?: File | undefined;
  className?: string | undefined;
  alt?: string | undefined;
  style?: React.CSSProperties | undefined;
  "data-testid"?: string;
}

export class ImageFunctions {
  public static getImageURL(file: File): string {
    const blob: Blob = new Blob([file.file!.buffer as ArrayBuffer], {
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
        /*
         * Always render an alt attribute so the <img> is never missing it
         * (WCAG 1.1.1). Callers should pass a descriptive alt for meaningful
         * images (e.g. avatars); an empty string marks the image decorative.
         */
        alt={props.alt ?? ""}
        src={url}
        height={props.height}
        className={props.className}
        style={props.style}
      />
    );
  };

  if (props.imageUrl !== undefined && props.imageUrl !== null) {
    /*
     * Not `if (props.imageUrl)`: an empty string is falsy and would fall
     * through to the `file` branch below and throw. Render the <img> with an
     * empty src instead, which keeps data-testid and className on the node.
     */
    return getImageElement(props.imageUrl.toString());
  }

  if (props.file && props.file.file && props.file.fileType) {
    const url: string = ImageFunctions.getImageURL(props.file);
    return getImageElement(url);
  }

  throw new BadDataException("file or imageUrl required for <Image>");
};

export default Image;
