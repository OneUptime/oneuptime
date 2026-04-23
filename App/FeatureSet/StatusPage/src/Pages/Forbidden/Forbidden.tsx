import Page from "../../Components/Page/Page";
import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const PageNotFound: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <Page>
      <EmptyState
        id="empty-state-page-not-found"
        title={t("errors.forbidden.title")}
        description={t("errors.forbidden.description")}
        icon={IconProp.NoSignal}
      />
    </Page>
  );
};

export default PageNotFound;
