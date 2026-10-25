import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export enum SecurityCaseNotFoundReason {
  // No case has this id: deleted, or an address that is not a case's.
  NotFound = "not-found",
  // The reader's role cannot read security cases.
  NoAccess = "no-access",
  // The case, or the project's case statuses, could not be read just now.
  LoadFailed = "load-failed",
}

export const SECURITY_CASE_NOT_FOUND_COPY: Record<
  SecurityCaseNotFoundReason,
  { title: string; description: string }
> = {
  [SecurityCaseNotFoundReason.NotFound]: {
    title: translationKey("This case could not be found."),
    description: translationKey(
      "It may have been deleted, or the link may not be a case's. The open cases are in Security Cases.",
    ),
  },
  [SecurityCaseNotFoundReason.NoAccess]: {
    title: translationKey("You cannot open this case."),
    description: translationKey(
      "Reading security cases takes a Security role, or Project Owner or Admin. Ask a project admin for one.",
    ),
  },
  [SecurityCaseNotFoundReason.LoadFailed]: {
    title: translationKey("This case could not be loaded."),
    description: translationKey("Something went wrong. Try again."),
  },
};

export const SECURITY_CASE_NOT_FOUND_TEST_ID: string =
  "security-case-not-found";

export interface ComponentProps {
  reason: SecurityCaseNotFoundReason;
  /*
   * What the server said, for a read that failed, or why the reader's role
   * may not read cases: said in place of the general sentence.
   */
  error?: string | undefined;
  onTryAgain: () => void;
}

/*
 * What a case's address shows when there is no case to show: it is not
 * there, the reader may not read it, or it could not be read. Drawn as a
 * list's empty state is, in a card where the case would be, with the one
 * way forward each time - back to the open cases, or Try again.
 */
const SecurityCaseNotFound: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: { title: string; description: string } =
    SECURITY_CASE_NOT_FOUND_COPY[props.reason];

  const openCases: TableEmptyStateAction = {
    title: "Open Cases",
    icon: IconProp.ShieldExclamation,
    dataTestId: `${SECURITY_CASE_NOT_FOUND_TEST_ID}-open-cases`,
    onClick: () => {
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_CASES] as Route,
        ),
      );
    },
  };

  const actions: Array<TableEmptyStateAction> =
    props.reason === SecurityCaseNotFoundReason.LoadFailed
      ? [
          {
            title: "Try again",
            icon: IconProp.Refresh,
            dataTestId: `${SECURITY_CASE_NOT_FOUND_TEST_ID}-try-again`,
            onClick: props.onTryAgain,
          },
        ]
      : props.reason === SecurityCaseNotFoundReason.NotFound
        ? [openCases]
        : [];

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid={SECURITY_CASE_NOT_FOUND_TEST_ID}
      data-reason={props.reason}
    >
      <TableEmptyState
        kind={
          props.reason === SecurityCaseNotFoundReason.NoAccess
            ? TableEmptyStateKind.NoAccess
            : props.reason === SecurityCaseNotFoundReason.NotFound
              ? TableEmptyStateKind.Empty
              : TableEmptyStateKind.Error
        }
        icon={
          props.reason === SecurityCaseNotFoundReason.NotFound
            ? IconProp.ShieldExclamation
            : undefined
        }
        title={copy.title}
        description={
          props.reason !== SecurityCaseNotFoundReason.NotFound && props.error
            ? props.error
            : copy.description
        }
        actions={actions}
        dataTestId={`${SECURITY_CASE_NOT_FOUND_TEST_ID}-state`}
      />
    </div>
  );
};

export default SecurityCaseNotFound;
