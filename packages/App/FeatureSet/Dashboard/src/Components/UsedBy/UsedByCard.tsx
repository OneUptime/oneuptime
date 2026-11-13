import UsedByDialog from "./UsedByDialog";
import UsedByEmpty from "./UsedByEmpty";
import UsedByError from "./UsedByError";
import UsedByGroups from "./UsedByRows";
import useUsedBySummary, { UseUsedBySummaryResult } from "./useUsedBySummary";
import { LOADING_USED_BY, USED_BY_CARD_WORDS } from "./UsedByWords";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import ObjectID from "Common/Types/ObjectID";
import { getOffProducts } from "Common/Types/Product/ServerProducts";
import { withoutGroupsOfProductsOff } from "Common/Types/UsedBy/UsedByServerProducts";
import {
  UsedByRecordKind,
  UsedByRelation,
  isUsedByNothing,
} from "Common/Types/UsedBy/UsedBy";
import Card, { CardHeaderLayout } from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "USED BY" ON A RECORD'S OVERVIEW (#6813): what refers to this record -
 * the status pages that show a monitor, the on-call policies that page a
 * schedule, the monitors watching a service - one line per kind, with how
 * many the reader may see, the first three as links, how many more they
 * may not see (never named), and "See all" for the rest, a page at a time
 * (UsedByDialog). When nothing refers to it, the card says what to do next.
 *
 * One request (UsedByApi), counts first; read again on `refreshToken`.
 *
 * A line of a product switched off on the server (#6815) is left out: its
 * pages are gone. The Delete and Archive dialogs keep it (UsedByImpact).
 */

export interface ComponentProps {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  refreshToken?: number | string | undefined;
  // "stacked" in a narrow column (the monitor overview's side column).
  headerLayout?: CardHeaderLayout | undefined;
  className?: string | undefined;
}

const UsedByCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const used: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: props.recordKind,
    recordId: props.recordId,
    refreshToken: props.refreshToken,
  });
  const [openRelation, setOpenRelation] = useState<UsedByRelation | null>(null);
  const products: ProjectProductsState = useProjectProducts();

  const getBody: () => ReactElement = (): ReactElement => {
    if (used.state.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText(LOADING_USED_BY)}
          className="space-y-2 animate-pulse"
          data-testid="used-by-loading"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    if (used.state.status === "error") {
      return (
        <UsedByError message={used.state.message} onTryAgain={used.retry} />
      );
    }

    const summary: ReturnType<typeof withoutGroupsOfProductsOff> =
      withoutGroupsOfProductsOff(
        used.state.summary,
        getOffProducts(products.answer.offOnServer || {}),
      );

    if (isUsedByNothing(summary)) {
      return <UsedByEmpty recordKind={props.recordKind} />;
    }

    return (
      <UsedByGroups
        summary={summary}
        onSeeAll={(relation: UsedByRelation) => {
          setOpenRelation(relation);
        }}
      />
    );
  };

  return (
    <>
      <Card
        title={USED_BY_CARD_WORDS[props.recordKind].title}
        description={USED_BY_CARD_WORDS[props.recordKind].description}
        headerLayout={props.headerLayout}
        className={props.className}
        id="used-by"
      >
        <div data-testid="used-by-card" data-record-kind={props.recordKind}>
          {getBody()}
        </div>
      </Card>
      {openRelation ? (
        <UsedByDialog
          recordKind={props.recordKind}
          recordId={props.recordId}
          relation={openRelation}
          onClose={() => {
            setOpenRelation(null);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default UsedByCard;
