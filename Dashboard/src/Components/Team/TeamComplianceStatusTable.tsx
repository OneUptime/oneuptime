import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader from "Common/UI/Components/Loader/Loader";
import { Red, Green } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement, useEffect, useState } from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

export interface UserComplianceStatus {
  userId: string;
  userName: string;
  userEmail: string;
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
  const [complianceStatus, setComplianceStatus] = useState<TeamComplianceStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchComplianceStatus();
  }, [props.teamId]);

  const fetchComplianceStatus = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await API.get<any>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/team/compliance-status/${props.teamId.toString()}`,
        ),
        headers: ModelAPI.getCommonHeaders()
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

  const getRuleTypeLabel = (ruleType: string): string => {
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

  if (isLoading) {
    return <Loader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!complianceStatus || complianceStatus.userComplianceStatuses.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No team members to check compliance for.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              User
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Compliance Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Issues
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {complianceStatus.userComplianceStatuses.map((userStatus, index) => (
            <tr key={index}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="text-sm font-medium text-gray-900">
                    {userStatus.userName}
                  </div>
                  <div className="text-sm text-gray-500 ml-2">
                    {userStatus.userEmail}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {userStatus.isCompliant ? (
                  <Pill text="Compliant" color={Green} />
                ) : (
                  <Pill text="Non-Compliant" color={Red} />
                )}
              </td>
              <td className="px-6 py-4">
                {userStatus.nonCompliantRules.length > 0 ? (
                  <ul className="text-sm text-gray-900">
                    {userStatus.nonCompliantRules.map((rule, ruleIndex) => (
                      <li key={ruleIndex} className="mb-1">
                        <span className="font-medium">
                          {getRuleTypeLabel(rule.ruleType)}:
                        </span>{" "}
                        {rule.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sm text-gray-500">No issues</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TeamComplianceStatusTable;