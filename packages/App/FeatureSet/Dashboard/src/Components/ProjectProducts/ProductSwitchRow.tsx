import { ProductsSettingsCopy } from "./ProjectProductsCopy";
import { ServerProductOffCopy } from "../ServerProducts/ServerProductsCopy";
import { ServerProductOffReason } from "Common/Types/Product/ServerProducts";
import IconProp from "Common/Types/Icon/IconProp";
import { Yellow } from "Common/Types/BrandColors";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  ICON_COLOR_CLASSES,
  IconColorClasses,
} from "Common/UI/Components/Navbar/NavBarMenuModal";
import Pill from "Common/UI/Components/Pill/Pill";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * One product on Project Settings > Products (issue #6814): its icon and
 * name, what it is for, and the switch that shows it in the project - on
 * means shown. It saves the moment it is flipped, as every switch does: it
 * moves at once, is locked while the change is saved, then says "Saved"
 * beside it, and moves back with the server's reason when it is refused
 * (ProductsSettings keeps that state). Beside it, what it is to this
 * project: in use, not set up yet, or the plan it needs.
 *
 * The layout is ModelSwitchRow's: the status and marks to the right of the
 * text from sm up, under it on a phone, lined up with it.
 *
 * A product switched off on the whole server (#6815) has no switch: the
 * project cannot show it. In the switch's place it says so, and why, and
 * who can switch it on.
 */

export enum ProductSwitchSaveState {
  Idle = "idle",
  Saving = "saving",
  Saved = "saved",
}

export interface ComponentProps {
  // The product's name and what it is for, already in the reader's language.
  title: string;
  description: string;
  icon: IconProp;
  iconColor?: string | undefined;
  isShown: boolean;
  // The project's own settings, which are never hidden: no switch.
  isAlwaysShown: boolean;
  // Locked, saying why (an English sentence): who may not change it.
  lockedReason?: string | undefined;
  saveState: ProductSwitchSaveState;
  error?: string | undefined;
  isInUse: boolean;
  isNotSetUp: boolean;
  neededPlan?: string | undefined;
  // Switched off on the whole server, and why (#6815): no switch.
  offOnServerReason?: ServerProductOffReason | undefined;
  dataTestId: string;
  onChange: (isShown: boolean) => void;
}

const ProductSwitchRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: IconColorClasses =
    ICON_COLOR_CLASSES[props.iconColor || "indigo"] ||
    ICON_COLOR_CLASSES["indigo"]!;

  const title: ReactElement = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-md ring-1 ring-inset ${colors.bg} ${colors.ring}`}
      >
        <Icon icon={props.icon} className={`h-4 w-4 ${colors.text}`} />
      </span>
      <span className="truncate">{props.title}</span>
    </span>
  );

  const marks: Array<ReactNode> = [];

  if (props.offOnServerReason) {
    return (
      <div
        className="flex flex-col py-3 sm:flex-row sm:items-start sm:justify-between"
        data-testid={`${props.dataTestId}-row`}
      >
        <div
          className="flex min-w-0 flex-1 items-start gap-3"
          data-testid={`${props.dataTestId}-off`}
        >
          {/*
           * Where the switch would be, the power sign: the project cannot
           * show it while the server has it off.
           */}
          <span className="mt-0.5 w-11 flex-none text-center text-xs text-gray-400">
            <Icon icon={IconProp.Power} className="mx-auto h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-500">{title}</div>
            <p className="mt-0.5 text-sm text-gray-500">{props.description}</p>
            <p
              className="mt-1 text-sm text-gray-600"
              data-testid={`${props.dataTestId}-off-reason`}
            >
              {translator.translateText(
                props.offOnServerReason ===
                  ServerProductOffReason.TelemetryIngestionStopped
                  ? ServerProductOffCopy.rowIngestionStoppedReason
                  : ServerProductOffCopy.rowSwitchedOffReason,
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center pl-14 text-sm sm:ml-4 sm:pl-0 sm:pt-0.5">
          <span
            className="mt-2 text-xs text-gray-500 sm:mt-0"
            data-testid={`${props.dataTestId}-off-label`}
          >
            {translator.translateText(
              props.offOnServerReason ===
                ServerProductOffReason.TelemetryIngestionStopped
                ? ServerProductOffCopy.rowIngestionStopped
                : ServerProductOffCopy.rowSwitchedOff,
            )}
          </span>
        </div>
      </div>
    );
  }

  if (props.neededPlan) {
    marks.push(
      <span key="plan" data-testid={`${props.dataTestId}-plan`}>
        <Pill
          text={translator.translateTemplate("{{planName}} Plan", {
            planName: props.neededPlan,
          })}
          color={Yellow}
        />
      </span>,
    );
  } else if (props.isInUse) {
    marks.push(
      <span
        key="in-use"
        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
        data-testid={`${props.dataTestId}-in-use`}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-emerald-500"
        />
        {translator.translateText(ProductsSettingsCopy.inUse)}
      </span>,
    );
  } else if (props.isNotSetUp) {
    marks.push(
      <span
        key="not-set-up"
        className="text-xs text-gray-400"
        data-testid={`${props.dataTestId}-not-set-up`}
      >
        {translator.translateText(ProductsSettingsCopy.notSetUp)}
      </span>,
    );
  }

  const status: ReactNode =
    props.saveState === ProductSwitchSaveState.Saving ? (
      <span className="text-gray-500">
        {translator.translateText("Saving…")}
      </span>
    ) : props.saveState === ProductSwitchSaveState.Saved ? (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <Icon icon={IconProp.Check} className="h-4 w-4" />
        {translator.translateText("Saved")}
      </span>
    ) : null;

  return (
    <div
      className="flex flex-col py-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid={`${props.dataTestId}-row`}
    >
      <div className="min-w-0 flex-1">
        {props.isAlwaysShown ? (
          <div className="flex items-start gap-3">
            {/*
             * Where a switch would be, a quiet note that it is always
             * there: hiding Project Settings would hide the page that shows
             * it again.
             */}
            <span className="mt-0.5 w-11 flex-none text-center text-xs text-gray-400">
              <Icon icon={IconProp.Check} className="mx-auto h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{title}</div>
              <p className="mt-0.5 text-sm text-gray-500">
                {props.description}
              </p>
            </div>
          </div>
        ) : (
          <Toggle
            title={title}
            ariaLabel={props.title}
            isAriaLabelTranslated={true}
            description={props.description}
            value={props.isShown}
            disabled={
              Boolean(props.lockedReason) ||
              props.saveState === ProductSwitchSaveState.Saving
            }
            tooltip={props.lockedReason}
            error={props.error}
            dataTestId={props.dataTestId}
            onChange={(value: boolean) => {
              props.onChange(value);
            }}
          />
        )}
      </div>
      <div
        className={`flex flex-shrink-0 flex-wrap items-center gap-x-3 pl-14 text-sm sm:pl-0 sm:pt-0.5 ${
          status || marks.length > 0 || props.isAlwaysShown ? "sm:ml-4" : ""
        }`}
      >
        <span
          role="status"
          className={status ? "mt-2 inline-flex sm:mt-0" : "inline-flex"}
          data-testid={`${props.dataTestId}-status`}
        >
          {status}
        </span>
        {props.isAlwaysShown ? (
          <span className="mt-2 text-xs text-gray-400 sm:mt-0">
            {translator.translateText(ProductsSettingsCopy.alwaysShown)}
          </span>
        ) : (
          <></>
        )}
        {marks.length > 0 ? (
          <span className="mt-2 inline-flex items-center gap-2 sm:mt-0">
            {marks}
          </span>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ProductSwitchRow;
