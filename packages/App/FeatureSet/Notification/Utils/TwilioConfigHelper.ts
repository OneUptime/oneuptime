import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { PROJECT_TWILIO_CONFIG_SELECT } from "Common/Server/Utils/TwilioConfigSelect";

/**
 * Helper function to get TwilioConfig from project config
 * Shared between IncomingCall and PhoneNumber APIs
 */
export async function getProjectTwilioConfig(
  projectCallSMSConfigId: ObjectID,
): Promise<TwilioConfig | null> {
  const projectConfig: ProjectCallSMSConfig | null =
    await ProjectCallSMSConfigService.findOneById({
      id: projectCallSMSConfigId,
      select: PROJECT_TWILIO_CONFIG_SELECT,
      props: {
        isRoot: true,
      },
    });

  if (!projectConfig) {
    return null;
  }

  const twilioConfig: TwilioConfig | undefined =
    ProjectCallSMSConfigService.toTwilioConfig(projectConfig);
  return twilioConfig || null;
}
