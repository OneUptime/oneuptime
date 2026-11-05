import OpenStackProjectNoticeDelivery from "Common/Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
} from "react";
import OpenStackProjectNoticesCard from "../../../Components/OpenStack/OpenStackProjectNoticesCard";
import OpenStackStatusPagePlanCard from "../../../Components/OpenStack/OpenStackStatusPagePlanCard";
import PageComponentProps from "../../PageComponentProps";

/*
 * TELLING PEOPLE ABOUT THIS CLOUD.
 *
 * A status page by region and service, and who hears what about their own project. Each is made here once
 * and then is what it is everywhere else: a status page under Status Pages, an objective under Service Level
 * Objectives. Only who is told about a project lives here.
 */
const OpenStackCloudStatusPages: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <div className="mb-6">
        <OpenStackStatusPagePlanCard openStackCloudId={modelId} />
      </div>
      <div className="mb-6">
        <OpenStackProjectNoticesCard openStackCloudId={modelId} />
      </div>
      <ModelTable<OpenStackProjectNoticeDelivery>
        modelType={OpenStackProjectNoticeDelivery}
        id="openstack-project-notice-deliveries-table"
        userPreferencesKey="openstack-project-notice-deliveries-table"
        name="OpenStack > Project Notices > What Was Sent"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        query={{ openStackCloudId: modelId }}
        cardProps={{
          title: translationKey("What Was Sent"),
          description: translationKey(
            "Every notice told, or why it was not. A repeat of something already told, and anything a notice was turned off before, is not sent.",
          ),
        }}
        noItemsMessage={translationKey("Nothing has been sent yet.")}
        filters={[]}
        columns={[
          {
            field: { createdAt: true },
            title: "When",
            type: FieldType.DateTime,
          },
          {
            field: { openStackProjectId: true },
            title: "Project",
            type: FieldType.Text,
          },
          {
            field: { event: true },
            title: "What",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Text,
          },
          {
            field: { statusMessage: true },
            title: "Why Not",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default OpenStackCloudStatusPages;
