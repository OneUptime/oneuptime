import { JSONObject } from "../../../../Types/JSON";

/*
 * AN AZURE RESOURCE'S OWN AUDIT LOG, AS A DIAGNOSTIC SETTING SENDS IT, FOR
 * THE TESTS (#10110). Each record is in the shape its service documents for
 * an event hub or a storage account - the resource ID in capitals, as
 * Azure Monitor writes it there - with every field Microsoft's sample has:
 *
 *   - Key Vault: "Azure Key Vault logging", its AuditEvent sample and field
 *     table (identity.claim, properties.httpStatusCode, resultSignature);
 *   - Storage: "Azure Blob Storage monitoring data reference", its three
 *     samples - the operation, how it was authenticated, the service;
 *   - Azure SQL: "SQL Database audit log format" for the fields, and the
 *     SQLSecurityAuditEvents record a managed instance sends to an event
 *     hub, as IBM QRadar's Azure guide prints one.
 *
 * Not a test file itself.
 */

export const SUBSCRIPTION: string = "aaaa0a0a-bb1b-cc2c-dd3d-eeeeee4e4e4e";

// As Resource Manager, the portal and each Cloud Resource row write them.
export const VAULT_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/ContosoGroup/providers/Microsoft.KeyVault/vaults/ContosoKeyVault`;
export const STORAGE_ACCOUNT_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-Data/providers/Microsoft.Storage/storageAccounts/contosodata`;
export const BLOB_SERVICE_ID: string = `${STORAGE_ACCOUNT_ID}/blobServices/default`;
export const SQL_SERVER_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-Data/providers/Microsoft.Sql/servers/contoso-sql`;
export const SQL_DATABASE_ID: string = `${SQL_SERVER_ID}/databases/Orders`;
export const SQL_MANAGED_INSTANCE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-Data/providers/Microsoft.Sql/managedInstances/contoso-mi`;

export const UPN_CLAIM: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn";
export const OBJECT_ID_CLAIM: string =
  "http://schemas.microsoft.com/identity/claims/objectidentifier";

/*
 * A key vault's AuditEvent: Microsoft's sample, a VaultGet through Resource
 * Manager by a person signed in with Azure PowerShell.
 */
export function keyVaultSample(): JSONObject {
  return {
    time: "2016-01-05T01:32:01.2691226Z",
    resourceId: VAULT_ID.toUpperCase(),
    operationName: "VaultGet",
    operationVersion: "2015-06-01",
    category: "AuditEvent",
    resultType: "Success",
    resultSignature: "OK",
    resultDescription: "",
    durationMs: "78",
    callerIpAddress: "104.40.82.76",
    correlationId: "",
    identity: {
      claim: {
        [OBJECT_ID_CLAIM]: "d9da5048-2737-4770-bd64-XXXXXXXXXXXX",
        [UPN_CLAIM]: "live.com#username@outlook.com",
        appid: "00001111-aaaa-2222-bbbb-3333cccc4444",
      },
    },
    properties: {
      clientInfo: "azure-resource-manager/2.0",
      requestUri: `https://management.azure.com/subscriptions/${SUBSCRIPTION}/resourcegroups/contosogroup/providers/Microsoft.KeyVault/vaults/contosokeyvault?api-version=2015-06-01`,
      id: "https://contosokeyvault.vault.azure.net/",
      httpStatusCode: 200,
    },
  };
}

// A data-plane request to the vault: a secret read by an app's managed identity, by default.
export function keyVaultRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-18T09:12:44.6127743Z",
    resourceId: VAULT_ID.toUpperCase(),
    operationName: "SecretGet",
    operationVersion: "7.4",
    category: "AuditEvent",
    resultType: "Success",
    resultSignature: "OK",
    resultDescription: "",
    durationMs: "18",
    callerIpAddress: "203.0.113.24",
    correlationId: "",
    identity: {
      claim: {
        [OBJECT_ID_CLAIM]: "4f5e6d7c-8b9a-4c0d-9e1f-2a3b4c5d6e7f",
        [UPN_CLAIM]: "alice@contoso.com",
        appid: "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
      },
    },
    properties: {
      clientInfo: "azsdk-net-Security.KeyVault.Secrets/4.6.0",
      requestUri:
        "https://contosokeyvault.vault.azure.net/secrets/db-password/?api-version=7.4",
      id: "https://contosokeyvault.vault.azure.net/secrets/db-password/7c3f9d2a1b4e4f6a8c0d2e4f6a8b0c1d",
      httpStatusCode: 200,
      isAccessPolicyMatch: true,
      isRbacAuthorized: false,
      tlsVersion: "TLS1_2",
    },
    ...overrides,
  };
}

/*
 * The 401 every Azure SDK client gets on its first call: sent without a
 * token, to learn the tenant, and logged under Authentication.
 */
export function keyVaultChallenge(overrides: JSONObject = {}): JSONObject {
  return keyVaultRecord({
    operationName: "Authentication",
    resultType: "Success",
    resultSignature: "Unauthorized",
    durationMs: "0",
    identity: {},
    properties: {
      clientInfo: "azsdk-net-Security.KeyVault.Secrets/4.6.0",
      requestUri:
        "https://contosokeyvault.vault.azure.net/secrets/db-password/?api-version=7.4",
      httpStatusCode: 401,
    },
    ...overrides,
  });
}

/*
 * A storage request: Microsoft's three samples in one record - a PutBlob
 * by a person signed in with Microsoft Entra ID, by default.
 */
export function storageRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2019-02-28T19:10:21.2123117Z",
    resourceId: BLOB_SERVICE_ID.toUpperCase(),
    category: "StorageWrite",
    operationName: "PutBlob",
    operationVersion: "2017-04-17",
    schemaVersion: "1.0",
    statusCode: 201,
    statusText: "Success",
    durationMs: 5,
    callerIpAddress: "192.168.0.1:11111",
    correlationId: "aaaa0000-bb11-2222-33cc-444444dddddd",
    location: "uswestcentral",
    uri: "http://contosodata.blob.core.windows.net/cont1/blobname?timeout=10",
    protocol: "HTTPS",
    identity: {
      authorization: [
        {
          action:
            "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
          principals: [
            {
              id: "aaaaaaaa-bbbb-cccc-1111-222222222222",
              type: "User",
            },
          ],
          reason: "Policy",
          result: "Granted",
          roleAssignmentId: "00aa00aa-bb11-cc22-dd33-44ee44ee44ee",
          roleDefinitionId: "11bb11bb-cc22-dd33-ee44-55ff55ff55ff",
          type: "RBAC",
        },
      ],
      requester: {
        appId: "00001111-aaaa-2222-bbbb-3333cccc4444",
        audience: "https://storage.azure.com/",
        objectId: "aaaaaaaa-0000-1111-2222-bbbbbbbbbbbb",
        tenantId: "aaaabbbb-0000-cccc-1111-dddd2222eeee",
        tokenIssuer:
          "https://sts.windows.net/2c2c2c2c-3333-dddd-4444-5e5e5e5e5e5e",
        uniqueName: "someone@example.com",
      },
      type: "OAuth",
    },
    properties: {
      accountName: "contosodata",
      objectKey: "/contosodata/cont1/blobname",
      userAgentHeader:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/17.17134",
      referrerHeader:
        "blob:https://portal.azure.com/00001111-aaaa-2222-bbbb-3333cccc4444",
      clientRequestId: "",
      etag: "",
      serverLatencyMs: 63,
      serviceType: "blob",
      operationCount: 0,
      requestHeaderSize: 2658,
      requestBodySize: 0,
      responseHeaderSize: 295,
      responseBodySize: 2018,
      contentLengthHeader: 0,
      tlsVersion: "TLS 1.2",
    },
    ...overrides,
  };
}

// The same request with no credential at all.
export function anonymousStorageRecord(overrides: JSONObject = {}): JSONObject {
  return storageRecord({
    category: "StorageRead",
    operationName: "GetBlob",
    statusCode: 200,
    statusText: "AnonymousSuccess",
    callerIpAddress: "198.51.100.23:52314",
    correlationId: "bbbb1111-cc22-3333-44dd-555555eeeeee",
    uri: "https://contosodata.blob.core.windows.net/public/invoices/2026-11.pdf",
    identity: { type: "Anonymous" },
    properties: {
      accountName: "contosodata",
      objectKey: "/contosodata/public/invoices/2026-11.pdf",
      userAgentHeader: "curl/8.5.0",
      serviceType: "blob",
      operationCount: 0,
      responseBodySize: 48213,
    },
    ...overrides,
  });
}

// A request a shared access signature signed: an upload from a browser, by default.
export function sasStorageRecord(overrides: JSONObject = {}): JSONObject {
  return storageRecord({
    category: "StorageWrite",
    operationName: "PutBlob",
    statusCode: 201,
    statusText: "SASSuccess",
    callerIpAddress: "203.0.113.80:61022",
    correlationId: "cccc2222-dd33-4444-55ee-666666ffffff",
    uri: "https://contosodata.blob.core.windows.net/uploads/avatar.png?sv=2022-11-02&sr=b&sig=XXXXX",
    identity: {
      type: "SAS",
      tokenHash:
        "key1(0A0XE8AADA354H19722ED12342443F0DC8FAF3E6GF8C8AD805DE6D563E0E5F8A),SasSignature(04D64C2B3A704145C9F1664F201123467A74D72DA72751A9137DDAA732FA03CF)",
    },
    properties: {
      accountName: "contosodata",
      objectKey: "/contosodata/uploads/avatar.png",
      userAgentHeader: "Mozilla/5.0",
      serviceType: "blob",
      operationCount: 0,
    },
    ...overrides,
  });
}

// A request signed by the account's key.
export function accountKeyStorageRecord(
  overrides: JSONObject = {},
): JSONObject {
  return storageRecord({
    category: "StorageRead",
    operationName: "GetBlob",
    statusCode: 200,
    statusText: "Success",
    correlationId: "dddd3333-ee44-5555-66ff-777777000000",
    identity: {
      type: "AccountKey",
      tokenHash:
        "key1(5RTE343A6FEB12342672AFD40072B70D4A91BGH5CDF797EC56BF82B2C3635CE)",
    },
    ...overrides,
  });
}

/*
 * A managed instance's sign-in, as an event hub carries it: IBM QRadar's
 * sample - a pooled connection's reuse, by default.
 */
export function sqlAuditRecord(
  overrides: JSONObject = {},
  propertyOverrides: JSONObject = {},
): JSONObject {
  return {
    LogicalServerName: "contoso-mi",
    SubscriptionId: SUBSCRIPTION,
    ResourceGroup: "RG-DATA",
    package: "SecAudit",
    event: "audit_event_shoebox",
    sessionName: "audit_session_for_shoebox",
    originalEventTimestamp: "2020-07-19T05:26:01.5293718Z",
    time: "2020-07-19T05:26:01.5260341Z",
    resourceId: SQL_MANAGED_INSTANCE_ID.toUpperCase(),
    category: "SQLSecurityAuditEvents",
    operationName: "AuditEvent",
    properties: {
      audit_schema_version: 1,
      event_time: "2020-07-19T05:26:01.166Z",
      sequence_number: 1,
      action_id: "LGIS",
      action_name: "LOGIN SUCCEEDED",
      succeeded: "true",
      is_column_permission: "false",
      session_id: 184,
      server_principal_id: 286,
      database_principal_id: 0,
      target_server_principal_id: 0,
      target_database_principal_id: 0,
      object_id: 0,
      user_defined_event_id: 0,
      transaction_id: 0,
      class_type: "LX",
      class_type_description: "LOGIN",
      securable_class_type: "LOGIN",
      duration_milliseconds: 0,
      response_rows: 0,
      affected_rows: 0,
      client_ip: "10.242.142.140",
      permission_bitmask: "00000000000000000000000000000000",
      sequence_group_id: "0AB33370-A776-485A-AD98-FBB08D58A684",
      session_server_principal_name: "LoginName",
      server_principal_name: "LoginName",
      server_principal_sid: "782fa7bb4f95374ba7fb6f346ccdafa6",
      database_principal_name: "",
      target_server_principal_name: "",
      target_server_principal_sid: "",
      target_database_principal_name: "",
      server_instance_name: "contoso-mi",
      database_name: "",
      schema_name: "",
      object_name: "",
      statement:
        "-- network protocol: TCP/IP\r\nset quoted_identifier on\r\nset arithabort off\r\nset transaction isolation level read committed",
      additional_information:
        '<action_info xmlns="http://schemas.microsoft.com/sqlserver/2008/sqlaudit_data"><pooled_connection>1</pooled_connection><client_options>0x28000020</client_options><client_options1>0x0001f438</client_options1><connect_options>0x00000001</connect_options><packet_data_size>8000</packet_data_size><address>10.153.63.59</address><is_dac>0</is_dac></action_info>',
      user_defined_information: "",
      application_name: ".Net SqlClient Data Provider",
      connection_id: "284D6271-94AD-4719-BA5A-A2834CA24F82",
      data_sensitivity_information: "",
      host_name: "HOSNAME",
      session_context: "",
      is_server_level_audit: "true",
      event_id: "F4FBD375-7F97-40F7-8C40-833D59CCC3D1",
      ...propertyOverrides,
    },
    ...overrides,
  };
}

// A fresh connection's sign-in: the same record, its connection new.
export function sqlFreshSignIn(propertyOverrides: JSONObject = {}): JSONObject {
  return sqlAuditRecord(
    {},
    {
      additional_information:
        '<action_info xmlns="http://schemas.microsoft.com/sqlserver/2008/sqlaudit_data"><pooled_connection>0</pooled_connection><address>10.153.63.59</address><is_dac>0</is_dac></action_info>',
      event_id: "1D2C3B4A-5E6F-4071-8293-A4B5C6D7E8F9",
      ...propertyOverrides,
    },
  );
}

// An Azure SQL database's record: its own resource ID, a contained user's sign-in refused by default.
export function sqlDatabaseRecord(
  propertyOverrides: JSONObject = {},
): JSONObject {
  return sqlAuditRecord(
    {
      LogicalServerName: "contoso-sql",
      resourceId: SQL_DATABASE_ID.toUpperCase(),
      time: "2026-11-18T09:20:31.4410000Z",
    },
    {
      event_time: "2026-11-18T09:20:30.912Z",
      action_id: "DBAF",
      action_name: "DATABASE AUTHENTICATION FAILED",
      succeeded: "false",
      class_type: "DB",
      class_type_description: "DATABASE",
      securable_class_type: "DATABASE",
      client_ip: "198.51.100.77",
      server_principal_name: "",
      session_server_principal_name: "",
      database_principal_name: "app_reader",
      server_instance_name: "contoso-sql",
      database_name: "Orders",
      statement: "",
      additional_information:
        "<login_information><error_code>18456</error_code><error_state>132</error_state></login_information>",
      application_name: "sqlcmd",
      sequence_group_id: "6C1E9B7A-2D3F-4A5B-8C9D-0E1F2A3B4C5D",
      event_id: "AB12CD34-EF56-4789-90AB-CDEF01234567",
      ...propertyOverrides,
    },
  );
}

// One event of an event hub, or a pipeline's line: Azure's batch.
export function batchOf(records: Array<JSONObject>): string {
  return JSON.stringify({ records });
}
