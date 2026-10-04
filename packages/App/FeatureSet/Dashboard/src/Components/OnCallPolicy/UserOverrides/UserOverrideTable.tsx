import UserElement from "../../../Components/User/User";
import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
} from "./UserOverrideForm";
import ObjectID from "Common/Types/ObjectID";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import User from "Common/Models/DatabaseModels/User";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The user overrides of one on-call policy (its User Overrides tab), or the
 * project's global ones (On-Call Duty > User Overrides), which apply to
 * every policy.
 *
 * Each row reads as the override does: who is away, who covers, from when,
 * until when. Adding one asks the same four things, with you as the person
 * away and now as the start (UserOverrideForm.ts).
 */

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

const UserOverrideTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const query: Query<OnCallDutyPolicyUserOverride> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  } else {
    query.onCallDutyPolicyId = new IsNull();
  }

  /*
   * Every row of the table belongs to the one policy the page is about, or
   * to none, so there is no policy column or filter: it would say the same
   * thing on every row.
   */
  const filters: Array<Filter<OnCallDutyPolicyUserOverride>> = [
    {
      title: "Starts",
      type: FieldType.Date,
      field: {
        startsAt: true,
      },
    },
    {
      title: "Ends",
      type: FieldType.Date,
      field: {
        endsAt: true,
      },
    },
  ];

  const columns: Columns<OnCallDutyPolicyUserOverride> = [
    {
      field: {
        overrideUser: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Away",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["overrideUser"]) {
          return <UserElement user={item["overrideUser"] as User} />;
        }
        return <p>{translator.translateText("No user.")}</p>;
      },
    },
    {
      field: {
        routeAlertsToUser: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Covered by",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["routeAlertsToUser"]) {
          return <UserElement user={item["routeAlertsToUser"] as User} />;
        }
        return <p>{translator.translateText("No user.")}</p>;
      },
    },
    {
      field: {
        startsAt: true,
      },
      title: "Starts",
      type: FieldType.DateTime,
    },
    {
      field: {
        endsAt: true,
      },
      title: "Ends",
      type: FieldType.DateTime,
    },
  ];

  /*
   * Who is away starts as the person adding the override, read when the
   * page opens: booking your own leave is what this form is most often for.
   */
  const currentUserId: string = UserUtil.getUserId().toString();

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
    useMemo((): Array<ModelField<OnCallDutyPolicyUserOverride>> => {
      return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: currentUserId,
      });
    }, [currentUserId]);

  return (
    <>
      <ModelTable<OnCallDutyPolicyUserOverride>
        modelType={OnCallDutyPolicyUserOverride}
        query={query}
        id="on-call-user-override-table"
        name="On-Call Policy > User Overrides"
        userPreferencesKey="on-call-user-override-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        createVerb="Add"
        onBeforeCreate={async (
          item: OnCallDutyPolicyUserOverride,
        ): Promise<OnCallDutyPolicyUserOverride> => {
          return prepareUserOverrideForCreate(item, {
            projectId: ProjectUtil.getCurrentProjectId()!,
            onCallDutyPolicyId: props.onCallDutyPolicyId,
          });
        }}
        cardProps={{
          title: props.onCallDutyPolicyId
            ? "On-Call Policy User Overrides"
            : "Global User Overrides",
          description: props.onCallDutyPolicyId
            ? "While someone is away, an override sends their pages from this policy to the person who covers. To cover someone on every policy at once, add the override under On-Call Duty > User Overrides."
            : "While someone is away, an override sends their pages from every on-call policy to the person who covers. To cover someone on one policy only, add the override on that policy's User Overrides page.",
        }}
        formFields={formFields}
        noItemsMessage={
          props.onCallDutyPolicyId
            ? "No user overrides have been set for this policy."
            : "No global user overrides have been set."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        columns={columns}
      />
    </>
  );
};

export default UserOverrideTable;
