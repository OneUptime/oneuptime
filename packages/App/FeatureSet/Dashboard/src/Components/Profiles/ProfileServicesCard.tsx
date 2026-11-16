import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatProfileShare } from "Common/Utils/Profiles/ProfileTypes";
import { getShareOfWindow } from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileServiceCategory,
  categorizeProfileService,
} from "../../Utils/ProfileServiceCategory";
import {
  HIDE_KERNEL_THREADS,
  SERVICES_DESCRIPTION,
  SERVICES_TITLE,
  SERVICE_HOT_LEADER,
  SERVICE_HOT_OWN,
  SERVICE_SAMPLES,
  SHOW_KERNEL_THREADS,
} from "./ProfileCopy";
import { ProfileScopeService } from "./ProfileScopeBar";
import { getShortProfileFunctionName } from "Common/Utils/Profiles/ProfileFunctionNames";
import { ProfileServiceHotSpot } from "../../Utils/ProfilesView";

/*
 * WHAT IS BEING PROFILED, BUSIEST FIRST.
 *
 * Every service (and host, cluster, ...) that sent profiles in the window,
 * with its share of the window's samples; a click narrows the page to it.
 * The eBPF profiler profiles every process on a host, kernel threads
 * included - those are folded away unless asked for, so the services a
 * person runs come first.
 *
 * Under each of the busiest services, where its time goes in a line: its
 * own code that takes the most, or the busiest function when none of its
 * own code ran (getProfileServiceHotSpot). With several services and none
 * picked, the overview draws this card first: merged together, different
 * services' stacks answer no one's question.
 */

export interface ComponentProps {
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  services: Array<ProfileScopeService>;
  onSelect: (serviceId: string) => void;
  /*
   * Where each service's time goes, by service id: null when it has none to
   * say, absent while it is read (or for a service it is not read for).
   */
  hotSpots?: Record<string, ProfileServiceHotSpot | null> | undefined;
}

// The most services listed before "Show all".
export const PROFILE_SERVICES_SHOWN: number = 12;

export function isKernelThread(service: ProfileScopeService): boolean {
  return (
    categorizeProfileService(service.name) === ProfileServiceCategory.Kernel
  );
}

const ProfileServicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showKernel, setShowKernel] = useState<boolean>(false);
  const [showAll, setShowAll] = useState<boolean>(false);

  const sorted: Array<ProfileScopeService> = [...props.services].sort(
    (a: ProfileScopeService, b: ProfileScopeService): number => {
      return b.sampleCount - a.sampleCount || a.name.localeCompare(b.name);
    },
  );
  const kernelCount: number = sorted.filter(isKernelThread).length;
  const visible: Array<ProfileScopeService> = sorted.filter(
    (service: ProfileScopeService): boolean => {
      return showKernel || !isKernelThread(service);
    },
  );
  const shown: Array<ProfileScopeService> = showAll
    ? visible
    : visible.slice(0, PROFILE_SERVICES_SHOWN);
  const totalSamples: number = sorted.reduce(
    (sum: number, service: ProfileScopeService): number => {
      return sum + service.sampleCount;
    },
    0,
  );

  const renderHotSpot: (serviceId: string) => ReactElement = (
    serviceId: string,
  ): ReactElement => {
    const hotSpot: ProfileServiceHotSpot | null | undefined =
      props.hotSpots?.[serviceId];

    if (!hotSpot) {
      return <></>;
    }

    return (
      <p
        className="mt-0.5 truncate text-xs text-gray-600"
        title={hotSpot.functionName}
        data-testid="profiles-service-hot-spot"
      >
        <TranslatedSentence
          template={hotSpot.isOwnCode ? SERVICE_HOT_OWN : SERVICE_HOT_LEADER}
          slots={{
            function: (
              <span className="font-mono text-gray-800">
                {getShortProfileFunctionName(hotSpot.functionName)}
              </span>
            ),
            share: (
              <span className="font-mono">
                {formatProfileShare(hotSpot.share)}
              </span>
            ),
          }}
        />
      </p>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.error) {
      return (
        <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
      );
    }

    if (props.isLoading) {
      return (
        <div className="space-y-2">
          {[0, 1, 2].map((index: number) => {
            return (
              <div
                key={index}
                className="h-10 animate-pulse rounded-md border border-gray-100 bg-gray-50"
              />
            );
          })}
        </div>
      );
    }

    return (
      <div>
        <ul
          className="-mx-5 divide-y divide-gray-100 md:-mx-6"
          data-testid="profiles-services"
        >
          {shown.map((service: ProfileScopeService) => {
            const share: number = getShareOfWindow(
              service.sampleCount,
              totalSamples,
            );

            return (
              <li key={service.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-6"
                  data-testid="profiles-service-row"
                  onClick={() => {
                    props.onSelect(service.id);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {service.name}
                      </span>
                      {service.typeLabel ? (
                        <span className="flex-none text-xs text-gray-500">
                          {translator.translateText(service.typeLabel)}
                        </span>
                      ) : (
                        <></>
                      )}
                    </div>
                    {renderHotSpot(service.id)}
                    <div
                      className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-100"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full bg-indigo-400"
                        style={{ width: `${Math.min(100, share)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="font-mono text-sm text-gray-900">
                      {formatProfileShare(share)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {translator.translatePlural(
                        SERVICE_SAMPLES,
                        service.sampleCount,
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {visible.length > PROFILE_SERVICES_SHOWN || kernelCount > 0 ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {visible.length > PROFILE_SERVICES_SHOWN ? (
              <button
                type="button"
                className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="profiles-services-show-all"
                aria-expanded={showAll}
                onClick={() => {
                  setShowAll(!showAll);
                }}
              >
                {showAll
                  ? translator.translateText("Show fewer")
                  : translator.translatePlural(
                      {
                        one: "Show all {{count}} service",
                        other: "Show all {{count}} services",
                      },
                      visible.length,
                    )}
              </button>
            ) : (
              <></>
            )}
            {kernelCount > 0 ? (
              <button
                type="button"
                className="rounded-sm text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="profiles-services-kernel"
                onClick={() => {
                  setShowKernel(!showKernel);
                }}
              >
                {showKernel
                  ? translator.translateText(HIDE_KERNEL_THREADS)
                  : translator.translatePlural(
                      SHOW_KERNEL_THREADS,
                      kernelCount,
                    )}
              </button>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card title={SERVICES_TITLE} description={SERVICES_DESCRIPTION}>
      {renderBody()}
    </Card>
  );
};

export default ProfileServicesCard;
