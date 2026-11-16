import Email from "../Email";

/*
 * WHO AN EMAIL GOES TO BESIDES ITS ONE ADDRESS, AS EVERY TRANSPORT SENDS IT
 * (issue #8893).
 *
 * An email names one mailbox To (EmailMessage.toEmail). Give Feedback also
 * copies the person who wrote it (Cc), and asks that a reply go to them
 * (Reply-To), so the team's answer reaches them rather than the server's
 * no-reply address.
 *
 * SMTP, SendGrid, Amazon SES, Mailgun, Postmark, Resend and Microsoft Graph
 * each take these in words of their own, and each reads them here, so
 * every transport sends the same:
 *
 *   - each address is one mailbox (Email.isValid). A value that is not -
 *     a stored list, a name with an address - is left out, as MailService
 *     refuses such a To (MailServiceOneMailbox);
 *   - each is sent once, and never the To again: SendGrid refuses an email
 *     that names one address twice ("Each email address in the
 *     personalization block should be unique between to, cc, and bcc"),
 *     and a mailbox copied on its own email would get it twice.
 */

// An address as it is sent, lower case, or null when it is not one mailbox.
export const toMailboxAddress: (
  email: Email | string | null | undefined,
) => string | null = (
  email: Email | string | null | undefined,
): string | null => {
  if (!email) {
    return null;
  }

  if (email instanceof Email && email.isMalformed()) {
    return null;
  }

  const address: string = email.toString().trim().toLowerCase();

  return Email.isValid(address) ? address : null;
};

// The addresses copied on the email (Cc), each once, without the To.
export const getCcAddresses: (mail: {
  toEmail: Email;
  ccEmails?: ReadonlyArray<Email> | undefined;
}) => Array<string> = (mail: {
  toEmail: Email;
  ccEmails?: ReadonlyArray<Email> | undefined;
}): Array<string> => {
  const to: string | null = toMailboxAddress(mail.toEmail);
  const seen: Set<string> = new Set<string>(to ? [to] : []);
  const addresses: Array<string> = [];

  for (const email of mail.ccEmails || []) {
    const address: string | null = toMailboxAddress(email);

    if (address && !seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  }

  return addresses;
};

// Where a reply goes, or null when it goes to the sender.
export const getReplyToAddress: (mail: {
  replyToEmail?: Email | undefined;
}) => string | null = (mail: {
  replyToEmail?: Email | undefined;
}): string | null => {
  return toMailboxAddress(mail.replyToEmail);
};

/*
 * The addresses as they cross from a server to the notification service
 * (Server/Services/MailService, then Notification/API/Mail): text, not
 * Email objects, which JSON would turn into objects of their own.
 */
export const readEmailAddresses: (value: unknown) => Array<Email> = (
  value: unknown,
): Array<Email> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const emails: Array<Email> = [];

  for (const item of value) {
    const address: string | null =
      typeof item === "string" ? toMailboxAddress(item) : null;

    if (address) {
      emails.push(new Email(address));
    }
  }

  return emails;
};

export const readEmailAddress: (value: unknown) => Email | undefined = (
  value: unknown,
): Email | undefined => {
  const address: string | null =
    typeof value === "string" ? toMailboxAddress(value) : null;

  return address ? new Email(address) : undefined;
};
