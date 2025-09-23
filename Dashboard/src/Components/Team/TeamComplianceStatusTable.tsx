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
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
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

export interface TeamComplianceStatusTableRef {
  refresh: () => void;
}

const TeamComplianceStatusTable: FunctionComponent<ComponentProps> = forwardRef<
  TeamComplianceStatusTableRef,
  ComponentProps
>((props: ComponentProps, ref): ReactElement => {
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

  useImperativeHandle(ref, () => {
    return {
      refresh: fetchComplianceStatus,
    };
  });

  const getRuleTypeLabel: (ruleType: string) => string = (
    ruleType: string,
  ): string => {
    const labels: Record<string, string> = {
      HasNotificationEmailMethod: "Email Notification",
      HasNotificationSMSMethod: "SMS Notification",
      HasNotificationCallMethod: "Call Notification",
      HasNotificationPushMethod: "Push Notification",
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

  if (complianceStatus?.complianceSettings.length === 0) {
    return <></>; // Do not show the table if no compliance rules are configured
  }

  let content: ReactElement;

  if (isLoading || !complianceStatus) {
    content = <Loader />;
  } else if (error) {
    content = <ErrorMessage message={error} />;
  } else if (complianceStatus.userComplianceStatuses.length === 0) {
    content = (
      <div className="text-center text-gray-500 py-8">
        No team members to check compliance for.
      </div>
    );
  } else {
    content = (
      <LocalTable
        data={complianceStatus.userComplianceStatuses}
        columns={columns}
        id="team-compliance-status-table"
        singularLabel="Team Member"
        pluralLabel="Team Members"
      />
    );
  }

  const refreshButton: CardButtonSchema = getRefreshButton();
  refreshButton.onClick = fetchComplianceStatus;
  refreshButton.title = "Refresh";

  return (
    <Card
      title="Team Compliance Status"
      description="Monitor team member compliance with notification and on-call rules"
      buttons={[refreshButton]}
    >
      {content}
    </Card>
  );
});

TeamComplianceStatusTable.displayName = "TeamComplianceStatusTable";

export default TeamComplianceStatusTable;
