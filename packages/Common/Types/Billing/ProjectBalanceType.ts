/*
 * The prepaid balances a project carries. Each one maps to its own column on
 * the project and is drawn down by a different kind of usage, so they are
 * topped up and corrected independently.
 */
enum ProjectBalanceType {
  // Drawn down by SMS, voice calls, WhatsApp messages and incoming numbers.
  SmsOrCall = "SmsOrCall",
  // Drawn down by LLM spend - AI agents, investigations and code fixes.
  AI = "AI",
}

export default ProjectBalanceType;
