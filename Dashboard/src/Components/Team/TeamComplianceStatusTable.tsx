import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader from "Common/UI/Components/Loader/Loader";
import { Red, Green } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserElement from "../User/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface UserComplianceStatus {
  userId: string;
  userName: string;
  userEmail: string;
  userProfilePictureId?: string;
  isCompliant: boolean;
  nonCompliantRules: Array<{
    ruleType: string;
    reason: string;
  }>;
}

export interface TeamComplianceStatus {
  teamId: string;
  teamName: string;
  complianceSettings: Array<{
    ruleType: string;
    enabled: boolean;
  }>;
  userComplianceStatuses: Array<UserComplianceStatus>;
}

export interface ComponentProps {
  teamId: ObjectID;
}

const TeamComplianceStatusTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [complianceStatus, setComplianceStatus] =
    useState<TeamComplianceStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchComplianceStatus();
  }, [props.teamId]);

  const fetchComplianceStatus: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        const response: any = await API.get<any>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/team/compliance-status/${props.teamId.toString()}`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setComplianceStatus(response.data as TeamComplianceStatus);
      } catch (err) {
        setError(API.getFriendlyMessage(err as any));
      } finally {
        setIsLoading(false);
      }
    };

  const getRuleTypeLabel: (ruleType: string) => string = (
    ruleType: string,
  ): string => {
    const labels: Record<string, string> = {
      HasNotificationEmail: "Email Notification",
      HasNotificationSMS: "SMS Notification",
      HasNotificationCall: "Call Notification",
      HasNotificationPush: "Push Notification",
      HasIncidentOnCallRules: "Incident On-Call Rules",
      HasAlertOnCallRules: "Alert On-Call Rules",
    };
    return labels[ruleType] || ruleType;
  };

  const columns: Columns<UserComplianceStatus> = [
    {
      title: "User",
      type: FieldType.Text,
      key: "userName",
      getElement: (item: UserComplianceStatus): ReactElement => {
        return (
          <UserElement
            user={{
              name: item.userName,
              email: item.userEmail,
              profilePictureId: item.userProfilePictureId,
            }}
          />
        );
      },
    },
    {
      title: "Compliance Status",
      type: FieldType.Text,
      key: "isCompliant",
      getElement: (item: UserComplianceStatus): ReactElement => {
        return item.isCompliant ? (
          <Pill text="Compliant" color={Green} />
        ) : (
          <Pill text="Non-Compliant" color={Red} />
        );
      },
    },
    {
      title: "Issues",
      type: FieldType.Text,
      key: "nonCompliantRules",
      getElement: (item: UserComplianceStatus): ReactElement => {
        if (item.nonCompliantRules.length > 0) {
          return (
            <ul className="text-sm text-gray-900">
              {item.nonCompliantRules.map(
                (
                  rule: { ruleType: string; reason: string },
                  ruleIndex: number,
                ) => {
                  return (
                    <li key={ruleIndex} className="mb-1">
                      <span className="font-medium">
                        {getRuleTypeLabel(rule.ruleType)}:
                      </span>{" "}
                      {rule.reason}
                    </li>
                  );
                },
              )}
            </ul>
          );
        }
        return <span className="text-sm text-gray-500">No issues</span>;
      },
    },
  ];

  if (isLoading) {
    return <Loader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (
    !complianceStatus ||
    complianceStatus.userComplianceStatuses.length === 0
  ) {
    return (
      <div className="text-center text-gray-500 py-8">
        No team members to check compliance for.
      </div>
    );
  }

  return (
    <LocalTable
      data={complianceStatus.userComplianceStatuses}
      columns={columns}
      id="team-compliance-status-table"
      singularLabel="Team Member"
      pluralLabel="Team Members"
    />
  );
};

export default TeamComplianceStatusTable;
