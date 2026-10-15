import ProjectUserElement from "../../../Components/User/ProjectUserElement";
import {
  USER_OVERRIDE_ROTATION_COVERS_TEXT,
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
} from "./UserOverrideForm";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  USER_OVERRIDE_COVER_ENDS_AT_PARAM,
  USER_OVERRIDE_COVER_STARTS_AT_PARAM,
  UserOverrideCoverWindow,
  hasUserOverrideCoverParams,
  readUserOverrideCoverRequest,
} from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import User from "Common/Models/DatabaseModels/User";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The user overrides of one on-call policy (its User Overrides page), or the
 * project's global ones (On-Call Duty > Advanced > User Overrides), which
 * apply to every policy.
 *
 * Each row reads as the override does: who is away, who covers, from when,
 * until when. Adding one asks the same four things, with you as the person
 * away and now as the start (UserOverrideForm.ts). An override with nobody
 * named to cover is a skip, and its row says the rotation covers: "Next
 * person in the rotation".
 *
 * "Get cover" on an upcoming shift (User Settings > Calendar > Calendar
 * Feed) opens this page with the shift's window in its address: Add User
 * Override opens on that window, with you away, so all that is left is who
 * covers (UserOverrideCoverRequest.ts).
 *
 * Each card's description says where the other one is. Both pages sit in a
 * folded Advanced section - the global one in the On-Call Duty menu, a
 * policy's own in the policy's menu - so the way there names Advanced
 * (OnCallDutyMenuPathsInProductText holds such paths to the menu).
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
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Away",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["overrideUser"]) {
          return <ProjectUserElement user={item["overrideUser"] as User} />;
        }
        return <p>{translator.translateText("No user.")}</p>;
      },
    },
    {
      field: {
        routeAlertsToUser: {
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Covered by",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["routeAlertsToUser"]) {
          // Nobody who has left the project is paged in someone's place.
          return (
            <ProjectUserElement user={item["routeAlertsToUser"] as User} />
          );
        }

        /*
         * Nobody named: the person away is skipped, and the next person in
         * each of their rotations takes the turn. Drawn the way a person is
         * in the cell beside it (UserElement): a round mark where the avatar
         * would be - the rotation's icon - and the words where the name is.
         */
        return (
          <div
            data-testid="user-override-rotation-covers"
            className="flex items-center"
          >
            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200">
              <Icon icon={IconProp.Refresh} className="h-4 w-4" />
            </span>
            <span className="ml-3">
              {translator.translateText(USER_OVERRIDE_ROTATION_COVERS_TEXT)}
            </span>
          </div>
        );
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
  const currentUserId: string = UserUtil.getUserId()?.toString() || "";

  /*
   * The window a "Get cover" link asks to cover, read once as the page
   * opens. Add User Override opens on it once, and is closed for good -
   * saved or cancelled - the next one starts afresh, from now. The address
   * is cleaned at once, so a reload does not open the dialog again.
   */
  const [coverRequest, setCoverRequest] =
    useState<UserOverrideCoverWindow | null>(() => {
      return readUserOverrideCoverRequest({
        getParam: (name: string): string | null => {
          return Navigation.getQueryStringByName(name);
        },
        now: OneUptimeDate.getCurrentDate(),
      });
    });

  /*
   * Whether the dialog has been asked to open on the cover request. Asked
   * only after the table has mounted: the table reports its dialog closed
   * when it mounts, and that report must not be taken for the person
   * closing the dialog they were sent to.
   */
  const [isCoverDialogAsked, setIsCoverDialogAsked] = useState<boolean>(false);

  useEffect(() => {
    if (coverRequest) {
      setIsCoverDialogAsked(true);
    }

    if (
      hasUserOverrideCoverParams((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      })
    ) {
      Navigation.setQueryString({
        [USER_OVERRIDE_COVER_STARTS_AT_PARAM]: null,
        [USER_OVERRIDE_COVER_ENDS_AT_PARAM]: null,
      });
    }
  }, []);

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
        showCreateForm={isCoverDialogAsked}
        createInitialValues={
          coverRequest
            ? {
                startsAt: coverRequest.startsAt,
                endsAt: coverRequest.endsAt,
              }
            : undefined
        }
        onCreateEditModalClose={() => {
          // The cover dialog was saved or cancelled: the next starts afresh.
          if (isCoverDialogAsked) {
            setIsCoverDialogAsked(false);
            setCoverRequest(null);
          }
        }}
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
            ? "While someone is away, their pages from this policy go to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation. To cover someone on every policy at once, add the override under On-Call Duty > Advanced > User Overrides."
            : "While someone is away, their pages from every on-call policy go to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation. To cover someone on one policy only, add the override on that policy's User Overrides page, under Advanced.",
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
