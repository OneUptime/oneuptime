import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { XcpNgPartKind } from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import ResourcePartReadError, {
  RESOURCE_PART_READ_ERROR_CLASS_NAME,
} from "../../ResourcePart/ResourcePartReadError";

export const XCP_NG_PART_READ_ERROR_TEST_ID: string = "xcp-ng-part-read-error";

// The card it is drawn in, with a card's gutter on a phone.
export const XCP_NG_PART_READ_ERROR_CLASS_NAME: string =
  RESOURCE_PART_READ_ERROR_CLASS_NAME;

/*
 * What an XCP-ng host's, VM's or storage repository's page says when the
 * read of its inventory failed: that it could not be loaded, the server's
 * answer, and Try again - drawn as a list that could not be loaded is (the
 * shared ResourcePartReadError). Never "not reported yet", which would send
 * an administrator to an agent and a Xen Orchestra that may be fine while
 * OneUptime could not answer.
 */
export const XCP_NG_PART_READ_ERROR_TITLES: Readonly<
  Record<XcpNgPartKind, string>
> = {
  Host: translationKey("Couldn't load this host"),
  VM: translationKey("Couldn't load this VM"),
  StorageRepository: translationKey("Couldn't load this storage repository"),
};

export interface ComponentProps {
  kind: XcpNgPartKind;
  // The server's answer, as API.getFriendlyMessage words it.
  message: string;
  // Reads the part again.
  onRetry: () => void;
}

const XcpNgPartReadError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourcePartReadError
      testId={XCP_NG_PART_READ_ERROR_TEST_ID}
      title={XCP_NG_PART_READ_ERROR_TITLES[props.kind]}
      message={props.message}
      onRetry={props.onRetry}
    />
  );
};

export default XcpNgPartReadError;
