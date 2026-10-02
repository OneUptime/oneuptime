import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a table (or a list) shows in place of rows: a small illustration, a
 * title that says what is true, a sentence on what the list is for or what
 * to do, and the one or two actions that do it.
 *
 * An empty table used to be a grey line of text and an underlined
 * "Refresh?" - on a project that simply had nothing yet that read like a
 * failed load, and it said nothing about what the list was for. Every model
 * table and list in the product draws this instead (BaseModelTable builds
 * it), and so does any Table given only a sentence.
 */

export enum TableEmptyStateKind {
  // Nothing has been created yet: the way in is to create the first one.
  Empty = "empty",
  // There are rows, but the search or filters hide every one of them.
  Filtered = "filtered",
  // An empty list is the good news here: no active incidents.
  AllClear = "all-clear",
  // The rows could not be loaded.
  Error = "error",
  // The viewer may not read these rows.
  NoAccess = "no-access",
}

export enum TableEmptyStateActionStyle {
  // A plain button, drawn like the card header's create button.
  Button = "button",
  // A quiet text link, for the way to read more.
  Link = "link",
}

export interface TableEmptyStateAction {
  title: string;
  icon?: IconProp | undefined;
  onClick: () => void;
  style?: TableEmptyStateActionStyle | undefined;
  disabled?: boolean | undefined;
  // Why a disabled action is disabled, on hover.
  tooltip?: string | undefined;
  dataTestId?: string | undefined;
}

export type TableEmptyStateProps = ComponentProps;

export interface ComponentProps {
  kind: TableEmptyStateKind;
  title: string | ReactElement;
  description?: string | ReactElement | undefined;
  // Drawn on the illustration. Each kind has its own when this is not set.
  icon?: IconProp | undefined;
  actions?: Array<TableEmptyStateAction> | undefined;
  // Something the caller built itself, drawn after the actions.
  actionElement?: ReactElement | undefined;
  // Small print under the actions - why the create button is locked, say.
  note?: string | ReactElement | undefined;
  /*
   * Less room around it, for a list inside a dialog or a narrow card - not
   * for a table that fills a page.
   */
  isCompact?: boolean | undefined;
  dataTestId?: string | undefined;
}

interface KindStyle {
  icon: IconProp;
  // The tilted card behind the icon, in the kind's colour.
  backCardClassName: string;
  iconClassName: string;
}

/*
 * Every class here has a dark-theme rule in Theme.css; the dark mode guard
 * (TableEmptyStateDarkMode.test.ts) holds the file to that.
 */
export const TABLE_EMPTY_STATE_KIND_STYLES: Record<
  TableEmptyStateKind,
  KindStyle
> = {
  [TableEmptyStateKind.Empty]: {
    icon: IconProp.TableCells,
    backCardClassName: "bg-indigo-100 ring-indigo-200",
    iconClassName: "text-indigo-600",
  },
  [TableEmptyStateKind.Filtered]: {
    icon: IconProp.Search,
    backCardClassName: "bg-gray-200 ring-gray-300",
    iconClassName: "text-gray-500",
  },
  [TableEmptyStateKind.AllClear]: {
    icon: IconProp.CheckCircle,
    backCardClassName: "bg-emerald-100 ring-emerald-200",
    iconClassName: "text-emerald-600",
  },
  [TableEmptyStateKind.Error]: {
    icon: IconProp.Error,
    backCardClassName: "bg-red-100 ring-red-200",
    iconClassName: "text-red-600",
  },
  [TableEmptyStateKind.NoAccess]: {
    icon: IconProp.Lock,
    backCardClassName: "bg-gray-200 ring-gray-300",
    iconClassName: "text-gray-500",
  },
};

export const TABLE_EMPTY_STATE_TEST_ID: string = "table-empty-state";

const TableEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();

  const testId: string = props.dataTestId || TABLE_EMPTY_STATE_TEST_ID;
  const style: KindStyle = TABLE_EMPTY_STATE_KIND_STYLES[props.kind];
  const icon: IconProp = props.icon || style.icon;
  const actions: Array<TableEmptyStateAction> = props.actions || [];
  const hasActions: boolean = actions.length > 0 || Boolean(props.actionElement);

  return (
    <div
      className={`flex flex-col items-center text-center sm:px-6 ${
        props.isCompact ? "py-8" : "py-12"
      }`}
      data-testid={testId}
      data-empty-state-kind={props.kind}
    >
      {/*
       * A light illustration rather than a bare icon: the icon on a card,
       * with a second card tilted behind it - a stack of records, in the
       * kind's colour. Decoration only; the title says it all in words.
       */}
      <div
        className="relative h-14 w-14 shrink-0"
        aria-hidden="true"
        data-testid={`${testId}-illustration`}
      >
        <div
          className={`absolute inset-0 translate-x-1.5 -translate-y-1 rotate-6 rounded-xl ring-1 ring-inset ${style.backCardClassName}`}
        />
        <div
          className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-inset ring-gray-200"
          data-icon={icon}
        >
          <Icon icon={icon} className={`h-6 w-6 ${style.iconClassName}`} />
        </div>
      </div>

      <h3
        className="mt-5 max-w-lg text-base font-semibold leading-6 text-gray-900"
        data-testid={`${testId}-title`}
      >
        {translateValue(props.title)}
      </h3>

      {props.description ? (
        <div
          className="mt-1.5 max-w-lg text-sm leading-6 text-gray-500"
          data-testid={`${testId}-description`}
        >
          {translateValue(props.description)}
        </div>
      ) : (
        <></>
      )}

      {hasActions ? (
        /*
         * A column on a phone, where each button takes the full width and
         * is easy to tap; a row from sm up. The buttons' own left margin is
         * for a header row - here the gap spaces them.
         */
        <div
          className="mt-6 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:flex-wrap [&_button]:md:ml-0"
          data-testid={`${testId}-actions`}
        >
          {actions.map((action: TableEmptyStateAction, index: number) => {
            const isLink: boolean =
              action.style === TableEmptyStateActionStyle.Link;

            return (
              <div
                key={`${action.title}-${index}`}
                className={isLink ? "" : "w-full sm:w-auto"}
              >
                <Button
                  title={action.title}
                  icon={action.icon}
                  buttonStyle={
                    isLink ? ButtonStyleType.LINK : ButtonStyleType.NORMAL
                  }
                  /*
                   * A locked button is dimmed, so it does not read as the
                   * way forward the note under it says it is not.
                   */
                  className={
                    isLink ? "text-sm font-medium" : "disabled:opacity-60"
                  }
                  disabled={action.disabled}
                  tooltip={action.tooltip}
                  dataTestId={action.dataTestId}
                  onClick={() => {
                    if (action.disabled) {
                      return;
                    }

                    action.onClick();
                  }}
                />
              </div>
            );
          })}
          {props.actionElement || <></>}
        </div>
      ) : (
        <></>
      )}

      {props.note ? (
        <p
          className="mt-4 max-w-md text-xs leading-5 text-gray-500"
          data-testid={`${testId}-note`}
        >
          {translateValue(props.note)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TableEmptyState;
