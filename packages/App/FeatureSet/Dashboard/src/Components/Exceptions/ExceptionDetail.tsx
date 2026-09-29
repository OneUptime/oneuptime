import Service from "Common/Models/DatabaseModels/Service";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import React, { FunctionComponent, ReactElement } from "react";
import {
  formatActiveSpan,
  formatRelativeTime,
} from "../../Utils/ExceptionDetailPresentation";
import ExceptionDetailList, {
  ExceptionDetailListItem,
} from "./ExceptionDetailList";
import ExceptionResource from "./ExceptionResource";

export interface ComponentProps {
  exceptionType?: string | undefined;
  fingerprint?: string | undefined;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  primaryEntityId?: ObjectID | undefined;
  primaryEntityType?: ServiceType | undefined;
  // The group's Service, for resolving a real OpenTelemetry primaryEntityId.
  services?: Array<Service> | undefined;
  firstSeenInRelease?: string | undefined;
  lastSeenInRelease?: string | undefined;
  environment?: string | undefined;
}

const NOT_RECORDED: ReactElement = (
  <span className="text-gray-400">Not recorded</span>
);

function renderTime(date: Date | undefined): ReactElement {
  if (!date) {
    return NOT_RECORDED;
  }

  return (
    <span>
      {OneUptimeDate.getDateAsLocalShortDateTimeString(date)}
      <span className="ml-1.5 text-gray-500">
        ({formatRelativeTime(date) || "unknown"})
      </span>
    </span>
  );
}

function renderText(value: string | undefined, isMono?: boolean): ReactElement {
  if (!value) {
    return NOT_RECORDED;
  }

  return <span className={isMono ? "font-mono text-[13px]" : ""}>{value}</span>;
}

/*
 * The identity of the exception group: what it is, where it runs, which
 * releases it spans and how it is grouped. Shown on the Overview under the
 * occurrence trend.
 */
const ExceptionDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const activeSpan: string | null = formatActiveSpan(
    props.firstSeenAt,
    props.lastSeenAt,
  );

  const items: Array<ExceptionDetailListItem> = [
    {
      label: "Exception type",
      value: renderText(props.exceptionType, true),
      testId: "exception-detail-type",
    },
    {
      label: "Service",
      value: (
        <ExceptionResource
          primaryEntityId={props.primaryEntityId}
          primaryEntityType={props.primaryEntityType}
          services={props.services}
          fallback={NOT_RECORDED}
        />
      ),
      testId: "exception-detail-service",
    },
    {
      label: "Environment",
      value: renderText(props.environment),
      testId: "exception-detail-environment",
    },
    {
      label: "Active for",
      value: activeSpan ? <span>{activeSpan}</span> : NOT_RECORDED,
      testId: "exception-detail-active-for",
    },
    {
      label: "First seen",
      value: renderTime(props.firstSeenAt),
      hint: props.firstSeenInRelease
        ? `Introduced in ${props.firstSeenInRelease}`
        : undefined,
      testId: "exception-detail-first-seen",
    },
    {
      label: "Last seen",
      value: renderTime(props.lastSeenAt),
      hint: props.lastSeenInRelease
        ? `Latest release ${props.lastSeenInRelease}`
        : undefined,
      testId: "exception-detail-last-seen",
    },
    {
      label: "Fingerprint",
      isWide: true,
      value: props.fingerprint ? (
        <span className="flex min-w-0 items-center gap-2">
          <code
            title="Occurrences with this fingerprint are grouped into this exception."
            className="min-w-0 truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
          >
            {props.fingerprint}
          </code>
          <CopyTextButton
            textToBeCopied={props.fingerprint}
            iconOnly={true}
            size="xs"
            title="Copy fingerprint"
          />
        </span>
      ) : (
        NOT_RECORDED
      ),
      testId: "exception-detail-fingerprint",
    },
  ];

  return (
    <Card
      title="Details"
      description="How this exception is identified, where it runs, and which releases it spans."
    >
      <ExceptionDetailList items={items} label="Exception details" />
    </Card>
  );
};

export default ExceptionDetail;
