import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

const IncomingCallPolicyDocs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      {/* How It Works Overview */}
      <Card
        title="How Incoming Call Policy Works"
        description="Understand how callers reach your on-call engineers through this policy"
      >
        <div className="p-6">
          {/* Main Flow Diagram */}
          <div className="flex flex-col items-center space-y-4">
            {/* Step 1: Caller */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Icon icon={IconProp.User} className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">1. Caller Dials Your Number</p>
                <p className="text-sm text-gray-500">External caller dials your dedicated incoming call number</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center">
              <Icon icon={IconProp.ChevronDown} className="h-6 w-6 text-gray-400" />
            </div>

            {/* Step 2: Twilio */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <Icon icon={IconProp.Call} className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">2. Twilio Receives the Call</p>
                <p className="text-sm text-gray-500">Twilio routes the call to OneUptime via webhook</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center">
              <Icon icon={IconProp.ChevronDown} className="h-6 w-6 text-gray-400" />
            </div>

            {/* Step 3: OneUptime */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <Icon icon={IconProp.AltGlobe} className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">3. OneUptime Processes the Call</p>
                <p className="text-sm text-gray-500">Plays greeting message and loads escalation rules</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center">
              <Icon icon={IconProp.ChevronDown} className="h-6 w-6 text-gray-400" />
            </div>

            {/* Step 4: Escalation */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
                <Icon icon={IconProp.BarsArrowDown} className="h-8 w-8 text-yellow-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">4. Escalation Rules Execute</p>
                <p className="text-sm text-gray-500">Tries each rule in order until someone answers</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center">
              <Icon icon={IconProp.ChevronDown} className="h-6 w-6 text-gray-400" />
            </div>

            {/* Step 5: Connected */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                <Icon icon={IconProp.CheckCircle} className="h-8 w-8 text-purple-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">5. Caller Connected to Engineer</p>
                <p className="text-sm text-gray-500">Call is connected when an on-call engineer answers</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Escalation Flow */}
      <div className="mt-5">
        <Card
          title="Escalation Flow"
          description="How calls are routed through your escalation rules"
        >
          <div className="p-6">
            <div className="bg-gray-50 rounded-lg p-6">
              {/* Escalation Chain Visualization */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                {/* Rule 1 */}
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg">
                    <div className="text-center text-white">
                      <p className="text-2xl font-bold">1</p>
                      <p className="text-xs">Rule</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">Primary On-Call</p>
                  <p className="text-xs text-gray-500">Wait 30 seconds</p>
                </div>

                {/* Arrow */}
                <div className="hidden sm:flex items-center">
                  <div className="w-8 h-0.5 bg-gray-300"></div>
                  <Icon icon={IconProp.ChevronRight} className="h-5 w-5 text-gray-400" />
                </div>

                {/* Rule 2 */}
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg">
                    <div className="text-center text-white">
                      <p className="text-2xl font-bold">2</p>
                      <p className="text-xs">Rule</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">Backup Team</p>
                  <p className="text-xs text-gray-500">Wait 30 seconds</p>
                </div>

                {/* Arrow */}
                <div className="hidden sm:flex items-center">
                  <div className="w-8 h-0.5 bg-gray-300"></div>
                  <Icon icon={IconProp.ChevronRight} className="h-5 w-5 text-gray-400" />
                </div>

                {/* Rule 3 */}
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 bg-red-500 rounded-lg flex items-center justify-center shadow-lg">
                    <div className="text-center text-white">
                      <p className="text-2xl font-bold">3</p>
                      <p className="text-xs">Rule</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">Manager</p>
                  <p className="text-xs text-gray-500">Wait 30 seconds</p>
                </div>

                {/* Arrow */}
                <div className="hidden sm:flex items-center">
                  <div className="w-8 h-0.5 bg-gray-300"></div>
                  <Icon icon={IconProp.ChevronRight} className="h-5 w-5 text-gray-400" />
                </div>

                {/* End */}
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 bg-gray-400 rounded-lg flex items-center justify-center shadow-lg">
                    <Icon icon={IconProp.Stop} className="h-8 w-8 text-white" />
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">No Answer</p>
                  <p className="text-xs text-gray-500">Play message</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Setup Steps */}
      <div className="mt-5">
        <Card
          title="Setup Steps"
          description="Follow these steps to configure your incoming call policy"
        >
          <div className="p-6">
            <div className="space-y-6">
              {/* Step 1 */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">1</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">Configure Twilio Account</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    Go to Project Settings &gt; Call &amp; SMS &gt; Custom Call/SMS Config and add your Twilio credentials (Account SID and Auth Token).
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">2</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">Select Twilio Configuration</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    On the Overview page, select which Twilio configuration to use for this incoming call policy.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">3</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">Configure Phone Number</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    Purchase a new phone number from Twilio or use an existing one. The webhook will be automatically configured.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">4</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">Add Escalation Rules</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    Define how calls should be routed. Add on-call schedules, teams, or specific users to handle incoming calls.
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                  <Icon icon={IconProp.CheckCircle} className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">Ready to Receive Calls</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    Your incoming call policy is now active. Share the phone number with your team and customers.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Key Concepts */}
      <div className="mt-5">
        <Card
          title="Key Concepts"
          description="Understanding the components of an incoming call policy"
        >
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Escalation Rules */}
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                    <Icon icon={IconProp.BarsArrowDown} className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-900">Escalation Rules</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Define the order in which on-call users, teams, or schedules are contacted. If one doesn't answer, the call moves to the next rule.
                </p>
              </div>

              {/* On-Call Schedules */}
              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                    <Icon icon={IconProp.Clock} className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-900">On-Call Schedules</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Automatically route calls to whoever is currently on-call based on your rotation schedules.
                </p>
              </div>

              {/* Voice Messages */}
              <div className="bg-yellow-50 rounded-lg p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
                    <Icon icon={IconProp.Microphone} className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-900">Voice Messages</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Customize the greeting message, no-answer message, and other voice prompts callers hear.
                </p>
              </div>

              {/* Call Logs */}
              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center">
                    <Icon icon={IconProp.Logs} className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-900">Call Logs</h4>
                </div>
                <p className="text-sm text-gray-600">
                  View detailed logs of all incoming calls including caller info, status, who answered, and call duration.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </Fragment>
  );
};

export default IncomingCallPolicyDocs;
