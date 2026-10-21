import React, { FunctionComponent, ReactElement, useState } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProfileTypeActivity } from "Common/Utils/Profiles/ProfileTypes";
import { fetchProfileTypes } from "../../Profiles/ProfilesApi";
import useProfileRequest, {
  ProfileRequestState,
} from "../../Profiles/UseProfileRequest";
import {
  buildProfilesRoute,
  getProfilesWindowAround,
} from "../../../Utils/ProfilesUrlState";
import {
  TRACE_PROFILER_LINK,
  TRACE_PROFILER_LINK_NAMED,
  TRACE_PROFILER_WINDOW_MINUTES,
} from "./TraceProfilerLinkCopy";

/*
 * "SEE WHERE checkout SPENT ITS TIME AROUND THIS TRACE."
 *
 * A slow trace says which span took long; the Profiler says which code. The
 * link opens the Profiler on the trace's root service, in the quarter hour
 * either side of the trace - drawn only when that service was profiled
 * then, so it never leads to an empty page. Continuous profiles cover the
 * service whether or not the profiler linked samples to this trace's spans
 * (the Profile samples tab is for those).
 */

export interface ComponentProps {
  serviceId: string;
  serviceName: string | null;
  traceStart: Date;
}

const TraceProfilerLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [now] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  const aroundWindow: { startTime: Date; endTime: Date } =
    getProfilesWindowAround({
      time: props.traceStart,
      beforeMinutes: TRACE_PROFILER_WINDOW_MINUTES,
      afterMinutes: TRACE_PROFILER_WINDOW_MINUTES,
      now,
    });

  const activity: ProfileRequestState<Array<ProfileTypeActivity>> =
    useProfileRequest<Array<ProfileTypeActivity>>(
      `${props.serviceId}|${aroundWindow.startTime.toISOString()}|${aroundWindow.endTime.toISOString()}`,
      async (): Promise<Array<ProfileTypeActivity>> => {
        try {
          return await fetchProfileTypes({
            window: aroundWindow,
            serviceIds: [props.serviceId],
          });
        } catch {
          // A link is a bonus: none is no error.
          return [];
        }
      },
    );

  if (!activity.data || activity.data.length === 0) {
    return <></>;
  }

  const route: Route = buildProfilesRoute({
    serviceId: props.serviceId,
    startTime: aroundWindow.startTime,
    endTime: aroundWindow.endTime,
  });

  return (
    <Link
      to={route}
      className="mt-1 inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      dataTestId="trace-open-profiler"
    >
      <>
        <Icon icon={IconProp.Fire} className="h-3.5 w-3.5 flex-none" />
        {props.serviceName
          ? translator.translateTemplate(TRACE_PROFILER_LINK_NAMED, {
              service: props.serviceName,
            })
          : translator.translateText(TRACE_PROFILER_LINK)}
      </>
    </Link>
  );
};

export default TraceProfilerLink;
