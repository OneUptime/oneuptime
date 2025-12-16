// Mock for botbuilder, botbuilder-core, and botframework-connector packages
module.exports = {
  CloudAdapter: class CloudAdapter {},
  ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
  TeamsActivityHandler: class TeamsActivityHandler {},
  TurnContext: class TurnContext {},
  ActivityHandler: class ActivityHandler {},
  MessageFactory: { text: jest.fn() },
  CardFactory: { heroCard: jest.fn() },
};
