import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  translatableTerm,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  PROFILE_KIND_DESCRIPTIONS,
  PROFILE_KIND_LABELS,
  ProfileKindChoice,
  ProfileKindChoices,
} from "../../Utils/ProfilesView";
import {
  PROFILES_RANGE_MINUTES,
  ProfilesCompareMode,
} from "../../Utils/ProfilesUrlState";
import {
  COMPARE_CHANGES_HEADING,
  COMPARE_LABELS,
  COMPARE_OFF,
  MORE_PROFILE_TYPES,
  RAW_TYPE_LABEL,
} from "./ProfileCopy";

/*
 * WHAT THE PROFILER IS LOOKING AT, IN ONE BAR.
 *
 *   [ Service ▾ ]  [ CPU time | Memory | … | More profile types ▾ ]
 *   ──────────────────────────────────────────────────────────────
 *   [15m 1h 6h 1d 7d] [↻]   Compare with [ Don't compare ▾ ]
 *
 * The service picker lists what sent profiles in the window, busiest first.
 * The kinds are only those the scope has data for: no button leads to an
 * empty page. The raw types a kind leaves out (the eBPF profiler's sample
 * counts beside CPU time in nanoseconds) sit in the kinds' own row, behind
 * More profile types, so the bar keeps two rows. The kinds wrap rather than
 * scroll on a phone, so none hides off the edge. The compare picker offers
 * the period before, the same time a day or a week ago, and - for one
 * service - its recent deploys and other changes, which is how "what got
 * slower after this deploy?" is asked.
 *
 * A page about one resource with no kind to pick (nothing profiled yet)
 * draws no first row, and no rule above the second.
 */

export interface ProfileScopeService {
  id: string;
  name: string;
  // "Host", "Kubernetes cluster" - shown beside a resource that is no service.
  typeLabel?: string | undefined;
  sampleCount: number;
}

export interface ProfileDeployOption {
  time: Date;
  // What the deploy shipped: a version, or the change's title.
  label: string;
  // When, as the reader says it ("3 hours ago").
  whenText: string;
}

export interface ComponentProps {
  // Null when the page is about one resource (a service's own page).
  services: Array<ProfileScopeService> | null;
  selectedServiceId: string | null;
  onSelectService: (serviceId: string | null) => void;

  choices: ProfileKindChoices;
  selectedKind: ProfileKindChoice;
  onSelectKind: (selection: string) => void;

  rangeMinutes: number;
  customWindow: { startTime: Date; endTime: Date } | null;
  onSelectRange: (minutes: number) => void;

  compareMode: ProfilesCompareMode | null;
  changeTime: Date | null;
  deploys: Array<ProfileDeployOption>;
  onCompare: (mode: ProfilesCompareMode | null, changeTime?: Date) => void;

  onRefresh: () => void;
}

const ALL_SERVICES_VALUE: string = "__all__";
const DEPLOY_VALUE_PREFIX: string = "deploy:";

export function getRangeLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  if (minutes < 24 * 60) {
    return `${Math.round(minutes / 60)}h`;
  }

  return `${Math.round(minutes / (24 * 60))}d`;
}

const ProfileScopeBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Group headings are drawn as given: looked up here.
  const heading: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const serviceOptions: Array<DropdownOption> = [
    // English: the Dropdown looks it up.
    { value: ALL_SERVICES_VALUE, label: "All services" },
    ...(props.services || []).map(
      (service: ProfileScopeService): DropdownOption => {
        return {
          value: service.id,
          label: service.typeLabel
            ? `${service.name} · ${heading(service.typeLabel)}`
            : service.name,
          isUserContent: true,
        };
      },
    ),
  ];

  const selectedServiceOption: DropdownOption | undefined = serviceOptions.find(
    (option: DropdownOption): boolean => {
      return option.value === (props.selectedServiceId || ALL_SERVICES_VALUE);
    },
  );

  const compareGroups: Array<DropdownOption | DropdownOptionGroup> = [
    { value: "", label: COMPARE_OFF },
    {
      label: heading(translationKey("Earlier")),
      options: [
        ProfilesCompareMode.Previous,
        ProfilesCompareMode.Day,
        ProfilesCompareMode.Week,
      ].map((mode: ProfilesCompareMode): DropdownOption => {
        return { value: mode, label: COMPARE_LABELS[mode] };
      }),
    },
  ];

  if (props.deploys.length > 0) {
    compareGroups.push({
      label: heading(COMPARE_CHANGES_HEADING),
      options: props.deploys.map(
        (deploy: ProfileDeployOption): DropdownOption => {
          return {
            value: `${DEPLOY_VALUE_PREFIX}${deploy.time.toISOString()}`,
            label: translator.translateTemplate("{{deploy}} · {{when}}", {
              deploy: deploy.label,
              when: deploy.whenText,
            }),
            isUserContent: true,
          };
        },
      ),
    });
  }

  const compareValue: string =
    props.compareMode === ProfilesCompareMode.Change && props.changeTime
      ? `${DEPLOY_VALUE_PREFIX}${props.changeTime.toISOString()}`
      : props.compareMode || "";

  const flatCompareOptions: Array<DropdownOption> = compareGroups.flatMap(
    (item: DropdownOption | DropdownOptionGroup): Array<DropdownOption> => {
      return "options" in item ? item.options : [item];
    },
  );

  let selectedCompareOption: DropdownOption | undefined =
    flatCompareOptions.find((option: DropdownOption): boolean => {
      return option.value === compareValue;
    });

  // A deploy that is no longer listed (older than a week) is still named.
  if (!selectedCompareOption && props.changeTime) {
    selectedCompareOption = {
      value: compareValue,
      label: translator.translateTemplate("The change at {{time}}", {
        time: OneUptimeDate.getDateAsLocalFormattedString(props.changeTime),
      }),
      isUserContent: true,
    };
  }

  const segmentClass: (isActive: boolean) => string = (
    isActive: boolean,
  ): string => {
    return `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      isActive
        ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
        : "text-gray-600 hover:text-gray-900"
    }`;
  };

  /*
   * A raw type by its own name, and the kind it is of: "samples (CPU
   * time)" is the eBPF profiler's CPU samples, counted rather than timed,
   * and a type of no known kind reads "custom (Other)". Composed here, so
   * the menu never looks a raw name up as a word to translate.
   */
  const rawTypeOptions: Array<{ value: string; label: string }> =
    props.choices.rawTypes.map(
      (choice: ProfileKindChoice): { value: string; label: string } => {
        return {
          value: choice.selection,
          label: translator.translateTemplate(RAW_TYPE_LABEL, {
            type: choice.selection,
            kind: translatableTerm(PROFILE_KIND_LABELS[choice.category]),
          }),
        };
      },
    );

  const activeRawType: { value: string; label: string } | undefined = props
    .selectedKind.isRawType
    ? rawTypeOptions.find((option: { value: string; label: string }) => {
        return option.value === props.selectedKind.selection;
      })
    : undefined;

  const hasKindRow: boolean =
    props.choices.kinds.length > 0 || rawTypeOptions.length > 0;
  const hasFirstRow: boolean = Boolean(props.services) || hasKindRow;

  return (
    <div
      className="mb-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"
      data-testid="profiles-scope-bar"
    >
      {hasFirstRow ? (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="profiles-scope-what"
        >
          {props.services ? (
            <div
              className="w-full sm:w-60"
              data-testid="profiles-service-picker"
            >
              <Dropdown
                options={serviceOptions}
                value={selectedServiceOption}
                ariaLabel={translator.translateText("Service")}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const id: string = value ? value.toString() : "";
                  props.onSelectService(
                    !id || id === ALL_SERVICES_VALUE ? null : id,
                  );
                }}
              />
            </div>
          ) : (
            <></>
          )}

          {hasKindRow ? (
            <div
              className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
              role="group"
              aria-label={translator.translateText("What to analyze")}
              data-testid="profiles-kind-picker"
            >
              {props.choices.kinds.map((choice: ProfileKindChoice) => {
                const isActive: boolean =
                  !props.selectedKind.isRawType &&
                  props.selectedKind.selection === choice.selection;

                return (
                  <button
                    key={choice.selection}
                    type="button"
                    aria-pressed={isActive}
                    title={translator.translateText(
                      PROFILE_KIND_DESCRIPTIONS[choice.category],
                    )}
                    className={segmentClass(isActive)}
                    data-testid={`profiles-kind-${choice.selection}`}
                    onClick={() => {
                      props.onSelectKind(choice.selection);
                    }}
                  >
                    {translator.translateText(
                      PROFILE_KIND_LABELS[choice.category],
                    )}
                  </button>
                );
              })}
              {rawTypeOptions.length > 0 ? (
                <MoreMenu
                  ariaLabel={MORE_PROFILE_TYPES}
                  isMenuPortaled={true}
                  elementToBeShownInsteadOfButton={
                    <button
                      type="button"
                      className={`${segmentClass(Boolean(activeRawType))} inline-flex max-w-full items-center gap-1`}
                      data-testid="profiles-raw-type-picker"
                    >
                      <span className="truncate">
                        {activeRawType
                          ? activeRawType.label
                          : translator.translateText(MORE_PROFILE_TYPES)}
                      </span>
                      <Icon
                        icon={IconProp.ChevronDown}
                        className="h-3.5 w-3.5 flex-none text-gray-400"
                      />
                    </button>
                  }
                >
                  {rawTypeOptions.map(
                    (option: { value: string; label: string }) => {
                      const isPicked: boolean =
                        activeRawType?.value === option.value;

                      return (
                        <MoreMenuItem
                          key={option.value}
                          text={option.label}
                          icon={isPicked ? IconProp.Check : undefined}
                          isIconSpaceReserved={true}
                          isChecked={isPicked}
                          dataTestId={`profiles-raw-type-${option.value}`}
                          onClick={() => {
                            props.onSelectKind(option.value);
                          }}
                        />
                      );
                    },
                  )}
                </MoreMenu>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-3 ${
          hasFirstRow ? "mt-3 border-t border-gray-100 pt-3" : ""
        }`}
        data-testid="profiles-scope-when"
      >
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
            role="group"
            aria-label={translator.translateText("Time window")}
            data-testid="profiles-range-picker"
          >
            {PROFILES_RANGE_MINUTES.map((minutes: number) => {
              const isActive: boolean =
                !props.customWindow && props.rangeMinutes === minutes;

              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={isActive}
                  className={`${segmentClass(isActive)} !px-2.5 !text-xs`}
                  data-testid={`profiles-range-${minutes}`}
                  onClick={() => {
                    props.onSelectRange(minutes);
                  }}
                >
                  {getRangeLabel(minutes)}
                </button>
              );
            })}
          </div>
          {props.customWindow ? (
            <span
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200"
              data-testid="profiles-custom-window"
            >
              <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">
                {translator.translateTemplate("{{start}} to {{end}}", {
                  start: OneUptimeDate.getDateAsLocalFormattedString(
                    props.customWindow.startTime,
                  ),
                  end: OneUptimeDate.getDateAsLocalFormattedString(
                    props.customWindow.endTime,
                  ),
                })}
              </span>
            </span>
          ) : (
            <></>
          )}
          <button
            type="button"
            onClick={props.onRefresh}
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title={translator.translateText("Refresh")}
            aria-label={translator.translateText("Refresh")}
            data-testid="profiles-refresh"
          >
            <Icon icon={IconProp.Refresh} className="h-4 w-4" />
          </button>
        </div>

        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <span className="flex-none text-sm text-gray-600">
            {translator.translateText("Compare with")}
          </span>
          <div
            className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            data-testid="profiles-compare-picker"
          >
            <Dropdown
              options={compareGroups}
              value={selectedCompareOption}
              ariaLabel={translator.translateText("Compare with")}
              isClearable={false}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const picked: string = value ? value.toString() : "";

                if (!picked) {
                  props.onCompare(null);
                  return;
                }

                if (picked.startsWith(DEPLOY_VALUE_PREFIX)) {
                  props.onCompare(
                    ProfilesCompareMode.Change,
                    new Date(picked.substring(DEPLOY_VALUE_PREFIX.length)),
                  );
                  return;
                }

                props.onCompare(picked as ProfilesCompareMode);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileScopeBar;
