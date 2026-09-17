import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import DiscordComponents from "../../../Types/Workflow/Components/Discord";
import EmailComponents from "../../../Types/Workflow/Components/Email";
import MicrosoftTeamsComponents from "../../../Types/Workflow/Components/MicrosoftTeams";
import SlackComponents from "../../../Types/Workflow/Components/Slack";
import TelegramComponents from "../../../Types/Workflow/Components/Telegram";
import { describe, expect, test } from "@jest/globals";

function findById<T extends { id: string }>(items: Array<T>, id: string): T {
  const item: T | undefined = items.find((candidate: T) => {
    return candidate.id === id;
  });

  if (!item) {
    throw new Error(`Expected item with id ${id}`);
  }

  return item;
}

function componentById(
  components: Array<ComponentMetadata>,
  id: string,
): ComponentMetadata {
  return findById(components, id);
}

describe("workflow integration credential metadata", () => {
  const credentials: Array<{
    component: ComponentMetadata;
    argumentId: string;
  }> = [
    {
      component: componentById(
        SlackComponents,
        ComponentID.SlackSendMessageToChannel,
      ),
      argumentId: "webhook-url",
    },
    {
      component: componentById(
        MicrosoftTeamsComponents,
        ComponentID.MicrosoftTeamsSendMessageToChannel,
      ),
      argumentId: "webhook-url",
    },
    {
      component: componentById(
        DiscordComponents,
        ComponentID.DiscordSendMessageToChannel,
      ),
      argumentId: "webhook-url",
    },
    {
      component: componentById(
        TelegramComponents,
        ComponentID.TelegramSendMessageToChat,
      ),
      argumentId: "bot-token",
    },
    {
      component: componentById(EmailComponents, ComponentID.SendEmail),
      argumentId: "smtp-password",
    },
  ];

  test.each(credentials)(
    "marks $component.title $argumentId as sensitive",
    ({
      component,
      argumentId,
    }: {
      component: ComponentMetadata;
      argumentId: string;
    }) => {
      const credential: Argument = findById(component.arguments, argumentId);

      expect(credential.isSensitive).toBe(true);
    },
  );

  test("publishes the Email error return value used by its Error branch", () => {
    const email: ComponentMetadata = componentById(
      EmailComponents,
      ComponentID.SendEmail,
    );
    const error: ReturnValue = findById(email.returnValues, "error");

    expect(error).toMatchObject({
      id: "error",
      type: ComponentInputType.Text,
      required: false,
    });
  });
});
