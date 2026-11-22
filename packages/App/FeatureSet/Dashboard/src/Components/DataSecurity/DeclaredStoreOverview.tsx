import DeclaredStoreFacts from "./DeclaredStoreFacts";
import {
  DECLARED_BY_ONEUPTIME,
  DECLARED_STORE_DESCRIPTION,
} from "./DeclaredStoreCopy";
import { getStoreProviderName } from "./StoreFieldOptions";
import useDeclaredStore, { DeclaredStoreState } from "./UseDeclaredStore";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A STORE ONEUPTIME DECLARES, AT A GLANCE (#10398).
 *
 * Security Events, Network Flows and Security Address Vault are not found
 * by a scan: OneUptime keeps them for the project's security and knows what
 * they hold. So their Overview has no sensitivity found, exposure, checks,
 * issues or scans to show. It says what the store is, what it holds, why,
 * for how long and who can read it - as the record of processing on
 * Compliance says them - and where the team writes its own purpose and
 * retention: the store's Settings.
 */

export interface ComponentProps {
  dataStoreId: ObjectID;
  kind: string;
}

const DeclaredStoreOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { answer, error, readAgain }: DeclaredStoreState = useDeclaredStore(
    props.dataStoreId,
    true,
  );

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS] as Route,
    { modelId: props.dataStoreId },
  );

  // The purpose and retention are written in Settings, by who may edit the store.
  const editButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Edit in Settings",
      icon: IconProp.Edit,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        Navigation.navigate(settingsRoute);
      },
    },
    new DataStore(),
    ModelAction.Update,
  );

  let body: ReactElement;

  if (error) {
    body = <ErrorMessage message={error} onRefreshClick={readAgain} />;
  } else if (!answer) {
    body = <DetailListSkeleton />;
  } else {
    body = (
      <DeclaredStoreFacts
        kind={props.kind}
        declared={answer.declared}
        purpose={answer.purpose}
        retention={answer.retention}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid="declared-store-overview">
      <Card
        title={DECLARED_BY_ONEUPTIME}
        description={DECLARED_STORE_DESCRIPTION}
        buttons={editButton ? [editButton] : []}
      >
        {body}
      </Card>

      <CardModelDetail<DataStore>
        name="About This Store"
        cardProps={{
          title: "About This Store",
        }}
        isEditable={false}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: DataStore,
          id: "declared-data-store-about",
          modelId: props.dataStoreId,
          fields: [
            {
              field: { kind: true },
              title: "Kind",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                return (
                  <span className="text-sm text-gray-900">
                    {item.kind ? (
                      translator.translateText(item.kind) || item.kind
                    ) : (
                      <EmptyValue />
                    )}
                  </span>
                );
              },
            },
            {
              field: { provider: true },
              title: "Provider",
              fieldType: FieldType.Element,
              getElement: (item: DataStore): ReactElement => {
                const name: string = getStoreProviderName(item.provider);

                return (
                  <span className="text-sm text-gray-900">
                    {name ? translator.translateText(name) : <EmptyValue />}
                  </span>
                );
              },
            },
            {
              field: { firstSeenAt: true },
              title: "First Found",
              fieldType: FieldType.DateTime,
            },
            {
              field: { lastSeenAt: true },
              title: "Last Found",
              fieldType: FieldType.DateTime,
            },
          ],
        }}
      />
    </div>
  );
};

export default DeclaredStoreOverview;
