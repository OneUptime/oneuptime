import { describe, expect, test } from "@jest/globals";
import {
  EXCHANGE_PERMISSION_CMDLETS,
  MICROSOFT_365_CONTENT_TYPE_ATTRIBUTE,
  MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE,
  MICROSOFT_365_SHARED_OUTSIDE_ATTRIBUTE,
  SHARING_OPERATIONS,
  readClientIp,
  readCreationTime,
  readMicrosoft365Record,
  readNamedValues,
} from "../../../../Utils/SecurityEvent/Connectors/Microsoft365AuditNormalizer";
import { SecurityRecordReading } from "../../../../Utils/SecurityEvent/SecurityRecordReading";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  exchangeCmdlet,
  fileAccessed,
  outlookInboxRule,
  securityAlert,
  sendAs,
  sharing,
  siteCollectionAdminAdded,
  teamsAppInstalled,
  threatMail,
} from "./Microsoft365Fixtures";

/*
 * The Microsoft 365 audit log holds everything everyone does in Exchange,
 * SharePoint, OneDrive and Teams. These pin which records the Microsoft
 * Entra ID connection imports from it - the ones a security team acts
 * on - and how each reads: its class, severity, who and what, and the
 * attributes a rule reads. Fixtures follow the Management Activity API
 * schema.
 */

function read(
  record: Parameters<typeof readMicrosoft365Record>[0],
  contentType: string = "Audit.Exchange",
): SecurityRecordReading {
  const reading: SecurityRecordReading | null = readMicrosoft365Record(
    record,
    contentType,
  );

  expect(reading).not.toBeNull();

  return reading!;
}

describe("Microsoft365AuditNormalizer - Exchange", () => {
  test("a mailbox forwarding its mail is a Medium event naming where to", () => {
    const reading: SecurityRecordReading = read(
      exchangeCmdlet("Set-Mailbox", {
        Identity: "bob",
        ForwardingSmtpAddress: "smtp:collector@fabrikam.example",
        DeliverToMailboxAndForward: "True",
      }),
    );

    expect(reading.classUid).toBe(6003);
    expect(reading.activityName).toBe("Set-Mailbox");
    expect(reading.severity).toBe(OcsfSeverity.Medium);
    expect(reading.message).toBe(
      "alice@contoso.example ran Set-Mailbox on bob in Exchange, sending mail on to smtp:collector@fabrikam.example",
    );
    expect(reading.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE]).toBe(
      "true",
    );
    expect(reading.attributes["Parameters.ForwardingSmtpAddress"]).toBe(
      "smtp:collector@fabrikam.example",
    );
    expect(reading.attributes[MICROSOFT_365_CONTENT_TYPE_ATTRIBUTE]).toBe(
      "Audit.Exchange",
    );
    expect(reading.principalUser).toBe("alice@contoso.example");
    expect(reading.principalIp).toBe("203.0.113.7");
    expect(reading.targetResource).toBe("bob");
    expect(reading.eventUid).toBe("m365:4c8e3e3a-2d4b-4b8e-9d5c-08dcf8a1b001");
    expect(reading.time?.toISOString()).toBe("2026-10-30T09:41:07.000Z");
  });

  test("every way Exchange sends mail on is read as forwarding", () => {
    for (const parameter of [
      "ForwardTo",
      "ForwardAsAttachmentTo",
      "RedirectTo",
      "ForwardingSmtpAddress",
      "ForwardingAddress",
      "RedirectMessageTo",
      "BlindCopyTo",
    ]) {
      const reading: SecurityRecordReading = read(
        exchangeCmdlet("New-InboxRule", {
          Name: "x",
          [parameter]: "collector@fabrikam.example",
        }),
      );

      expect({
        parameter,
        forwards: reading.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE],
      }).toEqual({ parameter, forwards: "true" });
    }
  });

  test("clearing a mailbox's forwarding is not forwarding", () => {
    for (const value of ["", "$null", "$NULL"]) {
      const reading: SecurityRecordReading = read(
        exchangeCmdlet("Set-Mailbox", {
          Identity: "bob",
          ForwardingSmtpAddress: value,
        }),
      );

      expect(
        reading.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE],
      ).toBeUndefined();
      expect(reading.severity).toBe(OcsfSeverity.Informational);
    }
  });

  test("an inbox rule made in Outlook that forwards mail is forwarding; one that files mail is not", () => {
    const forwarding: SecurityRecordReading = read(
      outlookInboxRule(
        '[{"ActionType":"ForwardToRecipientsAction","Recipients":["collector@fabrikam.example"]}]',
      ),
    );
    const filing: SecurityRecordReading = read(
      outlookInboxRule('[{"ActionType":"MoveToFolderAction","Folder":"RSS"}]'),
    );

    expect(forwarding.severity).toBe(OcsfSeverity.Medium);
    expect(forwarding.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE]).toBe(
      "true",
    );
    expect(filing.severity).toBe(OcsfSeverity.Informational);
    expect(
      filing.attributes[MICROSOFT_365_FORWARDS_MAIL_ATTRIBUTE],
    ).toBeUndefined();
    // Outlook names its client by ClientIPAddress.
    expect(forwarding.principalIp).toBe("203.0.113.7");
  });

  test("Exchange's own housekeeping as SYSTEM is left out, unless it forwards mail", () => {
    expect(
      readMicrosoft365Record(
        exchangeCmdlet(
          "Set-ConditionalAccessPolicy",
          { Identity: "x" },
          {
            UserType: 4,
            UserId: "NT AUTHORITY\\SYSTEM (Microsoft.Exchange.ServiceHost)",
          },
        ),
        "Audit.Exchange",
      ),
    ).toBeNull();

    expect(
      readMicrosoft365Record(
        exchangeCmdlet(
          "Set-Mailbox",
          { Identity: "bob", ForwardingSmtpAddress: "smtp:x@fabrikam.example" },
          { UserType: 4 },
        ),
        "Audit.Exchange",
      ),
    ).not.toBeNull();
  });

  test("a cmdlet that gives someone access to another mailbox is a Low privilege change naming them", () => {
    for (const cmdlet of EXCHANGE_PERMISSION_CMDLETS) {
      const reading: SecurityRecordReading = read(
        exchangeCmdlet(cmdlet, {
          Identity: "ceo",
          User: "mallory@contoso.example",
          AccessRights: "FullAccess",
        }),
      );

      expect({
        cmdlet,
        classUid: reading.classUid,
        activityName: reading.activityName,
        severity: reading.severity,
        targetUser: reading.targetUser,
      }).toEqual({
        cmdlet,
        classUid: 3005,
        activityName: "Assign Privileges",
        severity: OcsfSeverity.Low,
        targetUser: "mallory@contoso.example",
      });
    }
  });

  test("a cmdlet that failed is Low and says so", () => {
    const reading: SecurityRecordReading = read(
      exchangeCmdlet(
        "New-TransportRule",
        { Name: "x" },
        { ResultStatus: "False" },
      ),
    );

    expect(reading.statusName).toBe("Failure");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message.endsWith("(failed)")).toBe(true);
  });

  test("mail sent as someone else names whose name it went out under", () => {
    const reading: SecurityRecordReading = read(sendAs());

    expect(reading.message).toBe(
      "alice@contoso.example sent mail as ceo@contoso.example",
    );
    expect(reading.targetUser).toBe("ceo@contoso.example");
    expect(reading.targetResource).toBe("Wire transfer today");
    expect(reading.severity).toBe(OcsfSeverity.Low);

    const onBehalf: SecurityRecordReading = read(
      sendAs({
        Operation: "SendOnBehalf",
        SendAsUserSmtp: undefined as unknown as string,
        SendOnBehalfOfUserSmtp: "cfo@contoso.example",
      }),
    );

    expect(onBehalf.message).toBe(
      "alice@contoso.example sent mail on behalf of cfo@contoso.example",
    );
  });

  test("what people do with their own mail is not read", () => {
    for (const operation of [
      "MailItemsAccessed",
      "MoveToDeletedItems",
      "Create",
    ]) {
      expect(
        readMicrosoft365Record(
          { ...sendAs(), Operation: operation },
          "Audit.Exchange",
        ),
      ).toBeNull();
    }
  });
});

describe("Microsoft365AuditNormalizer - SharePoint and OneDrive", () => {
  test("a file shared with a guest is a Low share outside the organization", () => {
    const reading: SecurityRecordReading = read(
      sharing("SharingInvitationCreated", "Guest"),
      "Audit.SharePoint",
    );

    expect(reading.classUid).toBe(6006);
    expect(reading.activityName).toBe("Share");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "alice@contoso.example shared Budget.xlsx in OneDrive with guest bob@fabrikam.example",
    );
    expect(reading.targetUser).toBe("bob@fabrikam.example");
    expect(reading.targetResource).toBe("Budget.xlsx");
    expect(reading.attributes[MICROSOFT_365_SHARED_OUTSIDE_ATTRIBUTE]).toBe(
      "true",
    );
  });

  test("a file shared with a colleague is Informational", () => {
    const reading: SecurityRecordReading = read(
      sharing("SharingSet", "Member", {
        TargetUserOrGroupName: "carol@contoso.example",
      }),
      "Audit.SharePoint",
    );

    expect(reading.severity).toBe(OcsfSeverity.Informational);
    expect(reading.message).toBe(
      "alice@contoso.example shared Budget.xlsx in OneDrive with carol@contoso.example",
    );
    expect(
      reading.attributes[MICROSOFT_365_SHARED_OUTSIDE_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a link anyone can open names no one it was shared with", () => {
    const reading: SecurityRecordReading = read(
      sharing("AnonymousLinkCreated", "", { TargetUserOrGroupName: "" }),
      "Audit.SharePoint",
    );

    expect(reading.message).toBe(
      "alice@contoso.example made a link anyone can open to Budget.xlsx in OneDrive",
    );
    expect(reading.targetUser).toBe("");
    expect(reading.severity).toBe(OcsfSeverity.Low);
  });

  test("every sharing operation read is a share", () => {
    for (const operation of SHARING_OPERATIONS) {
      expect(
        read(sharing(operation, "Member"), "Audit.SharePoint").activityName,
      ).toBe("Share");
    }
  });

  test("a site collection administrator added is a privilege change", () => {
    const reading: SecurityRecordReading = read(
      siteCollectionAdminAdded(),
      "Audit.SharePoint",
    );

    expect(reading.classUid).toBe(3005);
    expect(reading.activityName).toBe("Assign Privileges");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "alice@contoso.example made mallory@contoso.example a site collection administrator of https://contoso.sharepoint.com/sites/finance",
    );
  });

  test("a file opened is not read", () => {
    expect(
      readMicrosoft365Record(fileAccessed(), "Audit.SharePoint"),
    ).toBeNull();
  });
});

describe("Microsoft365AuditNormalizer - findings and Teams", () => {
  test("Defender for Office 365's malware verdict is a High finding from the sender to the recipients", () => {
    const reading: SecurityRecordReading = read(
      threatMail("Malware"),
      "Audit.General",
    );

    expect(reading.classUid).toBe(2004);
    expect(reading.severity).toBe(OcsfSeverity.High);
    expect(reading.message).toBe(
      "Microsoft Defender for Office 365: malware mail from billing@fabrikam.example to alice@contoso.example and 1 more",
    );
    expect(reading.principalUser).toBe("billing@fabrikam.example");
    expect(reading.principalIp).toBe("198.51.100.23");
    expect(reading.targetUser).toBe("alice@contoso.example");
    expect(reading.targetResource).toBe("Your invoice is overdue");
    expect(reading.ruleName).toBe("Malware mail");
  });

  test("a phish verdict is Medium; a spam verdict is not a finding", () => {
    expect(read(threatMail("Phish"), "Audit.General").severity).toBe(
      OcsfSeverity.Medium,
    );
    expect(
      readMicrosoft365Record(threatMail("Spam"), "Audit.General"),
    ).toBeNull();
  });

  test("an alert Microsoft 365 raised is a finding at its own severity, once", () => {
    const reading: SecurityRecordReading = read(
      securityAlert("AlertTriggered"),
      "Audit.General",
    );

    expect(reading.classUid).toBe(2004);
    expect(reading.severity).toBe(OcsfSeverity.High);
    expect(reading.message).toBe(
      "Microsoft 365 alert: Suspicious email forwarding activity",
    );
    expect(reading.ruleId).toBe("4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d");

    // Its entities and its updates are recorded too; they are not new findings.
    expect(
      readMicrosoft365Record(
        securityAlert("AlertEntityGenerated"),
        "Audit.General",
      ),
    ).toBeNull();
    expect(
      readMicrosoft365Record(securityAlert("AlertUpdated"), "Audit.General"),
    ).toBeNull();
    expect(
      read(
        securityAlert("AlertTriggered", { Severity: "Low" }),
        "Audit.General",
      ).severity,
    ).toBe(OcsfSeverity.Low);
  });

  test("an app added to a team is a Low install naming it and the team", () => {
    const reading: SecurityRecordReading = read(
      teamsAppInstalled(),
      "Audit.General",
    );

    expect(reading.classUid).toBe(6002);
    expect(reading.message).toBe(
      "alice@contoso.example added Files Exporter to the Finance team",
    );
    expect(reading.severity).toBe(OcsfSeverity.Low);
  });

  test("a record without an operation or a record type is not read", () => {
    expect(
      readMicrosoft365Record({ ...teamsAppInstalled(), Operation: "" }, "x"),
    ).toBeNull();
    expect(
      readMicrosoft365Record(
        { ...teamsAppInstalled(), RecordType: "many" },
        "x",
      ),
    ).toBeNull();
  });
});

describe("Microsoft365AuditNormalizer - helpers", () => {
  test("readClientIp reads every way a record writes its client", () => {
    expect(readClientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(readClientIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(readClientIp("[2001:db8::7]:443")).toBe("2001:db8::7");
    expect(readClientIp("2001:db8::7")).toBe("2001:db8::7");
    // An IPv4 address mapped into IPv6 is not taken for one with a port.
    expect(readClientIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(readClientIp("")).toBe("");
    expect(readClientIp("not an address")).toBe("");
  });

  test("readCreationTime reads UTC written without a zone, and with one", () => {
    expect(readCreationTime("2026-10-30T09:41:07")?.toISOString()).toBe(
      "2026-10-30T09:41:07.000Z",
    );
    expect(readCreationTime("2026-10-30T09:41:07Z")?.toISOString()).toBe(
      "2026-10-30T09:41:07.000Z",
    );
    expect(readCreationTime("2026-10-30T11:41:07+02:00")?.toISOString()).toBe(
      "2026-10-30T09:41:07.000Z",
    );
    expect(readCreationTime("")).toBeNull();
  });

  test("readNamedValues reads a name/value list and nothing else", () => {
    expect(
      readNamedValues([
        { Name: "Identity", Value: "bob" },
        { Name: "__proto__", Value: "x" },
        { Value: "no name" },
        "text",
      ]),
    ).toEqual({ Identity: "bob" });
    expect(readNamedValues("Identity=bob")).toEqual({});
    expect(readNamedValues(null)).toEqual({});
  });

  test("a cmdlet's parameters are kept by name, each cut to a thousand characters", () => {
    const reading: SecurityRecordReading = read(
      exchangeCmdlet("Set-Mailbox", {
        Identity: "bob",
        Notes: "x".repeat(5000),
      }),
    );

    expect(String(reading.attributes["Parameters.Notes"]).length).toBe(1000);
  });
});
