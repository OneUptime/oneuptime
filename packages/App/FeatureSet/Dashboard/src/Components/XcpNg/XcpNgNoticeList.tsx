import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { XcpNgNotice, XcpNgNoticeTone } from "./XcpNgConnectionView";

/*
 * What a connection's API token or XAPI account may do, or when its token
 * runs out - each as a line and the one thing that fixes it. Already in the
 * reader's language (XcpNgConnectionView words them).
 */

export interface ComponentProps {
  notices: Array<XcpNgNotice>;
  className?: string | undefined;
}

const TONE: Record<
  XcpNgNoticeTone,
  { box: string; icon: IconProp; iconClassName: string; title: string }
> = {
  [XcpNgNoticeTone.Info]: {
    box: "border-indigo-200 bg-indigo-50",
    icon: IconProp.Info,
    iconClassName: "text-indigo-600",
    title: "text-indigo-900",
  },
  [XcpNgNoticeTone.Warning]: {
    box: "border-amber-200 bg-amber-50",
    icon: IconProp.Alert,
    iconClassName: "text-amber-600",
    title: "text-amber-900",
  },
  [XcpNgNoticeTone.Danger]: {
    box: "border-red-200 bg-red-50",
    icon: IconProp.Alert,
    iconClassName: "text-red-600",
    title: "text-red-900",
  },
};

const XcpNgNoticeList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.notices.length === 0) {
    return <></>;
  }

  return (
    <ul
      className={`space-y-2 ${props.className || ""}`}
      data-testid="xcp-ng-notices"
    >
      {props.notices.map((notice: XcpNgNotice) => {
        const tone: (typeof TONE)[XcpNgNoticeTone] = TONE[notice.tone];

        return (
          <li
            key={notice.title}
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${tone.box}`}
            data-tone={notice.tone}
          >
            <Icon
              icon={tone.icon}
              className={`mt-0.5 h-4 w-4 flex-none ${tone.iconClassName}`}
            />
            <div className="min-w-0">
              <div className={`font-medium ${tone.title}`}>{notice.title}</div>
              {notice.nextStep ? (
                <p className="mt-1 text-gray-700">{notice.nextStep}</p>
              ) : (
                <></>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default XcpNgNoticeList;
