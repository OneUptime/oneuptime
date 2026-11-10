import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import {
  DeviceNamingApplyResult,
  DeviceNamingOutcome,
  DeviceNamingPlan,
  DeviceNamingPlanItem,
  DeviceNamingRename,
  getInitialPlanSelection,
  getRenamesForPlanItems,
} from "Common/Types/NetworkDevice/DeviceNaming";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { applyDeviceNaming, planDeviceNaming } from "./DeviceNamingApi";
import { describeNamingProblem, isNamingProblem } from "./DeviceNamingCopy";

/*
 * APPLYING THE NAMING RULES TO DEVICES ALREADY IN THE PROJECT (issue #6619:
 * "run the naming workflow against existing devices and identify devices
 * that do not follow the configured standard").
 *
 * Nothing is renamed until the person says so. The dialog asks the server
 * for a plan - every device of the project, or the ones selected on the
 * Devices list - and lays it out in the order a person decides it:
 *
 *   Will be renamed     ticked: devices named by discovery or by an earlier
 *                       rule, whose rules' name has changed or was never
 *                       given.
 *   Named by a person   unticked: a name someone typed is theirs to give up.
 *   Need attention      a rule matched but could not name it - a site with
 *                       no code, no row in a lookup table, a name another
 *                       device has - each with what to do about it.
 *
 * The devices that already follow the rules are counted, not listed, and so
 * are the ones no rule covers. Renaming checks each device again on the
 * server: one renamed meanwhile, or whose rules changed, is left alone, and
 * the summary says so.
 */

// How many devices of a group are drawn before "Show more".
export const PLAN_ROWS_PER_PAGE: number = 100;

export const APPLY_NAMING_RULES_TITLE: string =
  translationKey("Apply Naming Rules");

export interface ApplyNamingRulesModalProps {
  // The devices to check; every device of the project when left out.
  deviceIds?: Array<string> | undefined;
  onClose: () => void;
  // Devices were renamed: read whatever shows them again.
  onRenamed?: (() => void) | undefined;
}

export interface NamingPlanGroups {
  toRename: Array<DeviceNamingPlanItem>;
  namedByPerson: Array<DeviceNamingPlanItem>;
  needAttention: Array<DeviceNamingPlanItem>;
  notCovered: Array<DeviceNamingPlanItem>;
}

// A plan's devices, in the groups the dialog draws.
export function groupPlanItems(
  items: ReadonlyArray<DeviceNamingPlanItem>,
): NamingPlanGroups {
  const groups: NamingPlanGroups = {
    toRename: [],
    namedByPerson: [],
    needAttention: [],
    notCovered: [],
  };

  for (const item of items) {
    if (item.outcome === DeviceNamingOutcome.Named) {
      if (item.isNamedByPerson) {
        groups.namedByPerson.push(item);
      } else {
        groups.toRename.push(item);
      }
    } else if (isNamingProblem(item)) {
      groups.needAttention.push(item);
    } else if (item.outcome === DeviceNamingOutcome.NoMatchingRule) {
      groups.notCovered.push(item);
    }
  }

  return groups;
}

const RenameRow: FunctionComponent<{
  item: DeviceNamingPlanItem;
  isSelected: boolean;
  onToggle: () => void;
}> = (props: {
  item: DeviceNamingPlanItem;
  isSelected: boolean;
  onToggle: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = `naming-plan-${props.item.deviceId}`;

  return (
    <li
      className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50"
      data-testid="naming-plan-rename"
    >
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        checked={props.isSelected}
        onChange={props.onToggle}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            dir="auto"
            className="break-all text-sm text-gray-500 line-through decoration-gray-300"
          >
            {props.item.currentName}
          </span>
          <Icon
            icon={IconProp.ArrowRight}
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 rtl:rotate-180"
          />
          <span
            dir="ltr"
            className="break-all font-mono text-sm font-semibold text-gray-900"
          >
            {props.item.name}
          </span>
        </span>
        {props.item.ruleName && (
          <span className="mt-0.5 block text-xs text-gray-500">
            {translator.translateTemplate("By {{rule}}", {
              rule: props.item.ruleName,
            })}
          </span>
        )}
      </label>
    </li>
  );
};

const AttentionRow: FunctionComponent<{
  item: DeviceNamingPlanItem;
}> = (props: { item: DeviceNamingPlanItem }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li className="px-3 py-2.5" data-testid="naming-plan-attention">
      <span
        dir="auto"
        className="block break-all text-sm font-medium text-gray-900"
      >
        {props.item.currentName}
      </span>
      <span className="mt-0.5 flex items-start gap-1.5 text-xs text-amber-700">
        <Icon
          icon={IconProp.Alert}
          className="mt-px h-3.5 w-3.5 flex-shrink-0"
        />
        <span>
          {describeNamingProblem(props.item, translator)}
          {props.item.ruleName ? (
            <span className="text-gray-500">
              {" "}
              {translator.translateTemplate("({{rule}})", {
                rule: props.item.ruleName,
              })}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
};

const Group: FunctionComponent<{
  title: string | undefined;
  description?: string | undefined;
  count: number;
  testId: string;
  actions?: ReactElement | undefined;
  children: ReactElement | Array<ReactElement>;
  shown: number;
  onShowMore?: (() => void) | undefined;
}> = (props: {
  title: string | undefined;
  description?: string | undefined;
  count: number;
  testId: string;
  actions?: ReactElement | undefined;
  children: ReactElement | Array<ReactElement>;
  shown: number;
  onShowMore?: (() => void) | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      className="overflow-hidden rounded-lg border border-gray-200"
      data-testid={props.testId}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {props.title}{" "}
            <span className="font-normal text-gray-500">
              ({translator.formatNumber(props.count)})
            </span>
          </h3>
          {props.description && (
            <p className="mt-0.5 text-xs text-gray-500">{props.description}</p>
          )}
        </div>
        {props.actions}
      </header>
      <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto bg-white">
        {props.children}
      </ul>
      {props.count > props.shown && props.onShowMore && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-center">
          <button
            type="button"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            onClick={props.onShowMore}
          >
            {translator.translateTemplate(
              "Show more ({{shown}} of {{count}} shown)",
              {
                shown: translator.formatNumber(props.shown),
                count: translator.formatNumber(props.count),
              },
            )}
          </button>
        </div>
      )}
    </section>
  );
};

const ApplyNamingRulesModal: FunctionComponent<ApplyNamingRulesModalProps> = (
  props: ApplyNamingRulesModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [plan, setPlan] = useState<DeviceNamingPlan | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set<string>());
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [result, setResult] = useState<DeviceNamingApplyResult | null>(null);
  const [shownRename, setShownRename] = useState<number>(PLAN_ROWS_PER_PAGE);
  const [shownPerson, setShownPerson] = useState<number>(PLAN_ROWS_PER_PAGE);
  const [shownAttention, setShownAttention] =
    useState<number>(PLAN_ROWS_PER_PAGE);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);

  const loadPlan: () => Promise<void> = async (): Promise<void> => {
    requestRef.current += 1;
    const request: number = requestRef.current;

    setIsLoading(true);
    setError("");

    try {
      const loaded: DeviceNamingPlan = await planDeviceNaming({
        deviceIds: props.deviceIds,
      });

      if (request !== requestRef.current) {
        return;
      }

      setPlan(loaded);
      setSelected(getInitialPlanSelection(loaded.items));
    } catch (err) {
      if (request === requestRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (request === requestRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadPlan();
  }, []);

  const groups: NamingPlanGroups = useMemo(() => {
    return groupPlanItems(plan?.items || []);
  }, [plan]);

  const renames: Array<DeviceNamingRename> = useMemo(() => {
    return getRenamesForPlanItems(plan?.items || [], selected);
  }, [plan, selected]);

  const toggle: (deviceId: string) => void = (deviceId: string): void => {
    setSelected((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }

      return next;
    });
  };

  const setAll: (items: Array<DeviceNamingPlanItem>, on: boolean) => void = (
    items: Array<DeviceNamingPlanItem>,
    on: boolean,
  ): void => {
    setSelected((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      for (const item of items) {
        if (on) {
          next.add(item.deviceId);
        } else {
          next.delete(item.deviceId);
        }
      }

      return next;
    });
  };

  const apply: () => Promise<void> = async (): Promise<void> => {
    if (renames.length === 0 || isApplying) {
      return;
    }

    setIsApplying(true);
    setError("");

    try {
      const applied: DeviceNamingApplyResult = await applyDeviceNaming(renames);

      setResult(applied);

      if (applied.renamed > 0) {
        props.onRenamed?.();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsApplying(false);
    }
  };

  const selectionToggle: (
    items: Array<DeviceNamingPlanItem>,
  ) => ReactElement = (items: Array<DeviceNamingPlanItem>): ReactElement => {
    const allOn: boolean = items.every((item: DeviceNamingPlanItem) => {
      return selected.has(item.deviceId);
    });

    return (
      <button
        type="button"
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
        onClick={(): void => {
          setAll(items, !allOn);
        }}
      >
        {translator.translateText(allOn ? "Untick all" : "Tick all")}
      </button>
    );
  };

  const nameById: Map<string, string> = useMemo(() => {
    return new Map<string, string>(
      (plan?.items || []).map(
        (item: DeviceNamingPlanItem): [string, string] => {
          return [item.deviceId, item.currentName];
        },
      ),
    );
  }, [plan]);

  const namingRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_NAMING_RULES] as Route,
  );

  let body: ReactElement;

  if (result) {
    body = (
      <div className="space-y-4" data-testid="naming-apply-result">
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-green-600"
          />
          <p className="text-sm font-medium text-green-800">
            {translator.translatePlural(
              {
                one: "{{count}} device was renamed.",
                other: "{{count}} devices were renamed.",
              },
              result.renamed,
              { count: translator.formatNumber(result.renamed) },
            )}
          </p>
        </div>
        {result.skipped.length > 0 && (
          <Group
            title={translator.translateText("Left as they were")}
            count={result.skipped.length}
            testId="naming-apply-skipped"
            shown={result.skipped.length}
          >
            {result.skipped.map(
              (skip: { deviceId: string; reason: string }): ReactElement => {
                return (
                  <li key={skip.deviceId} className="px-3 py-2.5">
                    <span
                      dir="auto"
                      className="block break-all text-sm font-medium text-gray-900"
                    >
                      {nameById.get(skip.deviceId) || skip.deviceId}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-600">
                      {translator.translateText(skip.reason)}
                    </span>
                  </li>
                );
              },
            )}
          </Group>
        )}
      </div>
    );
  } else if (plan && !plan.hasRules) {
    body = (
      <div className="py-6 text-center" data-testid="naming-plan-no-rules">
        <Icon
          icon={IconProp.Pencil}
          className="mx-auto h-8 w-8 text-gray-300"
        />
        <p className="mt-3 text-sm font-medium text-gray-900">
          {translator.translateText("No naming rules are enabled yet")}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {translator.translateText(
            "Add a naming rule, such as UN{site.code}{lookup}, then apply it here.",
          )}
        </p>
        <div className="mt-3">
          <Link
            to={namingRulesRoute}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {translator.translateText("Go to Naming Rules")}
          </Link>
        </div>
      </div>
    );
  } else if (plan) {
    const nothingToDo: boolean =
      groups.toRename.length === 0 &&
      groups.namedByPerson.length === 0 &&
      groups.needAttention.length === 0;

    body = (
      <div className="space-y-4" data-testid="naming-plan">
        <p className="text-sm text-gray-600" data-testid="naming-plan-summary">
          {translator.translatePlural(
            {
              one: "{{count}} device checked: {{rename}} to rename, {{following}} already follow your rules, {{attention}} need attention.",
              other:
                "{{count}} devices checked: {{rename}} to rename, {{following}} already follow your rules, {{attention}} need attention.",
            },
            plan.devicesChecked,
            {
              count: translator.formatNumber(plan.devicesChecked),
              rename: translator.formatNumber(
                groups.toRename.length + groups.namedByPerson.length,
              ),
              following: translator.formatNumber(plan.followingCount),
              attention: translator.formatNumber(groups.needAttention.length),
            },
          )}
        </p>

        {plan.isTruncated && (
          <Alert
            type={AlertType.INFO}
            title="Only the first 20,000 devices were checked. Select devices on the Devices list to check the rest."
          />
        )}

        {nothingToDo && (
          <div
            className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3"
            data-testid="naming-plan-all-good"
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="h-5 w-5 flex-shrink-0 text-green-600"
            />
            <p className="text-sm text-green-800">
              {translator.translateText(
                "Every device a rule covers already follows your naming rules.",
              )}
            </p>
          </div>
        )}

        {groups.toRename.length > 0 && (
          <Group
            title={translator.translateText("Will be renamed")}
            count={groups.toRename.length}
            testId="naming-plan-to-rename"
            actions={selectionToggle(groups.toRename)}
            shown={shownRename}
            onShowMore={(): void => {
              setShownRename(shownRename + PLAN_ROWS_PER_PAGE);
            }}
          >
            {groups.toRename
              .slice(0, shownRename)
              .map((item: DeviceNamingPlanItem): ReactElement => {
                return (
                  <RenameRow
                    key={item.deviceId}
                    item={item}
                    isSelected={selected.has(item.deviceId)}
                    onToggle={(): void => {
                      toggle(item.deviceId);
                    }}
                  />
                );
              })}
          </Group>
        )}

        {groups.namedByPerson.length > 0 && (
          <Group
            title={translator.translateText("Named by a person")}
            description={translator.translateText(
              "Someone typed these names, so they are not ticked. Tick the ones to rename.",
            )}
            count={groups.namedByPerson.length}
            testId="naming-plan-named-by-person"
            actions={selectionToggle(groups.namedByPerson)}
            shown={shownPerson}
            onShowMore={(): void => {
              setShownPerson(shownPerson + PLAN_ROWS_PER_PAGE);
            }}
          >
            {groups.namedByPerson
              .slice(0, shownPerson)
              .map((item: DeviceNamingPlanItem): ReactElement => {
                return (
                  <RenameRow
                    key={item.deviceId}
                    item={item}
                    isSelected={selected.has(item.deviceId)}
                    onToggle={(): void => {
                      toggle(item.deviceId);
                    }}
                  />
                );
              })}
          </Group>
        )}

        {groups.needAttention.length > 0 && (
          <Group
            title={translator.translateText("Need attention")}
            description={translator.translateText(
              "A rule matches these devices but cannot name them yet.",
            )}
            count={groups.needAttention.length}
            testId="naming-plan-need-attention"
            shown={shownAttention}
            onShowMore={(): void => {
              setShownAttention(shownAttention + PLAN_ROWS_PER_PAGE);
            }}
          >
            {groups.needAttention
              .slice(0, shownAttention)
              .map((item: DeviceNamingPlanItem): ReactElement => {
                return <AttentionRow key={item.deviceId} item={item} />;
              })}
          </Group>
        )}

        {groups.notCovered.length > 0 && (
          <p
            className="text-xs text-gray-500"
            data-testid="naming-plan-not-covered"
          >
            {translator.translatePlural(
              {
                one: "{{count}} device is not covered by any naming rule and keeps its name.",
                other:
                  "{{count}} devices are not covered by any naming rule and keep their names.",
              },
              groups.notCovered.length,
              { count: translator.formatNumber(groups.notCovered.length) },
            )}
          </p>
        )}
      </div>
    );
  } else {
    body = <></>;
  }

  const isDone: boolean = Boolean(result);

  return (
    <Modal
      title={APPLY_NAMING_RULES_TITLE}
      description={
        (props.deviceIds
          ? translator.translatePlural(
              {
                one: "Rename the selected device to follow your naming rules. Nothing changes until you confirm.",
                other:
                  "Rename the {{count}} selected devices to follow your naming rules. Nothing changes until you confirm.",
              },
              props.deviceIds.length,
              { count: translator.formatNumber(props.deviceIds.length) },
            )
          : translator.translateText(
              "Rename devices to follow your naming rules. Nothing changes until you confirm.",
            )) || ""
      }
      modalWidth={ModalWidth.Large}
      isBodyLoading={isLoading}
      isLoading={isApplying}
      error={error || undefined}
      onClose={props.onClose}
      closeButtonText={
        isDone ? translationKey("Done") : translationKey("Cancel")
      }
      {...(isDone
        ? { closeButtonStyleType: ButtonStyleType.PRIMARY }
        : {
            submitButtonText: translator.translatePlural(
              {
                one: "Rename {{count}} device",
                other: "Rename {{count}} devices",
              },
              renames.length,
              { count: translator.formatNumber(renames.length) },
            ),
            onSubmit: (): void => {
              void apply();
            },
          })}
      disableSubmitButton={renames.length === 0 || isLoading}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
    >
      {body}
    </Modal>
  );
};

export default ApplyNamingRulesModal;
