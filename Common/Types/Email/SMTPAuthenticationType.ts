// Authentication types for SMTP servers
enum SMTPAuthenticationType {
  UsernamePassword = "Username and Password", // Traditional SMTP authentication
  OAuth = "OAuth", // OAuth 2.0 authentication (for Microsoft 365, etc.)
  None = "None", // No authentication (for relay servers)
}

export default SMTPAuthenticationType;
