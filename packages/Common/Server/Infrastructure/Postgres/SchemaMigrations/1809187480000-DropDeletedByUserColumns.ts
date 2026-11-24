import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * WHO DELETED A RECORD WAS NEVER KEPT ON IT, SO THE COLUMN THAT SAID SO GOES
 * (#10469).
 *
 * 563 models declared "deletedByUserId", and a relation over it to "User",
 * and nothing ever wrote it: OneUptime deletes a record outright
 * (DatabaseService.deleteBy), so there is no record left to say who deleted
 * it. The audit log's Delete entries do. The column only documented an
 * always-empty "Deleted by User" on every resource, and its foreign key made
 * every user's deletion set it to null in 561 tables, each a scan, since
 * nothing indexes it.
 *
 * Each table's key and column go exactly as `npm run generate-postgres-
 * migration` wrote them, the two in one statement. Dropping a foreign key
 * drops its triggers on the table it references, so each statement takes
 * ACCESS EXCLUSIVE on its own table and on "User"; dropping a column rewrites
 * no row and scans none. In one transaction this would hold every one of
 * those tables, "User" among them, until the last was altered. So it runs
 * outside one (transaction = false), a statement per table, and each table
 * and "User" are held for the instant one statement takes; the runner bounds
 * the wait for each lock and tries again in the gaps (SchemaMigrationRunner).
 *
 * Not in a transaction, a stop part way leaves the tables before it altered,
 * and the runner starts it again from the top: a table that no longer has
 * the column is passed by without asking for its locks, and IF EXISTS makes
 * each statement one a table can be given twice. The drift check
 * (npm run check-postgres-schema-drift) reads the result, so the schema it
 * reads is the generator's.
 *
 * The tables of models that are gone ("GoogleSecOpsConnection",
 * "HuntressConnection" and the others) keep theirs: the generator writes
 * nothing for a table no model has, and each goes with its own move.
 *
 * TypeORM reverts a migration in a transaction whatever its `transaction`
 * says, so down() puts every column and key back in one, as generated.
 */

export const DELETED_BY_USER_ID_COLUMN: string = "deletedByUserId";

export interface DeletedByUserTable {
  table: string;
  // The generated name of its foreign key to "User", or null for none.
  foreignKey: string | null;
}

// Every model's table that had the column, in the order the generator dropped them.
export const DELETED_BY_USER_TABLES: ReadonlyArray<DeletedByUserTable> = [
  { table: "AcmeCertificate", foreignKey: "FK_130a8fd12e7505eebfce670b198" },
  { table: "AcmeChallenge", foreignKey: "FK_71371b224feb48f1d60e847cf1b" },
  { table: "User", foreignKey: "FK_644c3c0393979f57f71892ff0d7" },
  { table: "AlertSeverity", foreignKey: "FK_9b75d7937e702dee283256ad975" },
  { table: "IncidentSeverity", foreignKey: "FK_d0d87151a7872a44c3d2457bfdc" },
  { table: "Reseller", foreignKey: "FK_952b3ed48545aaf18033150dc66" },
  { table: "ResellerPlan", foreignKey: "FK_e756416e4b0983e158f71c47c1a" },
  { table: "Project", foreignKey: "FK_43989dee7f7af742f6d8ec2664a" },
  { table: "Label", foreignKey: "FK_f46caf81c5fd7664ba8da9c99ba" },
  { table: "Runner", foreignKey: "FK_061a38aa6652632acd0baad8652" },
  { table: "KubernetesCluster", foreignKey: "FK_b0f6c98aac521060f8b68fe5c87" },
  { table: "Team", foreignKey: "FK_0d4912bf03a7a645ce95142155b" },
  {
    table: "KubernetesClusterOwnerTeam",
    foreignKey: "FK_47ccc73fd46b91032858e89f9c0",
  },
  {
    table: "KubernetesClusterOwnerUser",
    foreignKey: "FK_abf04cdd9bfc085448061c1249f",
  },
  { table: "KubernetesResource", foreignKey: "FK_1c837345d0112e50866c0b4773e" },
  {
    table: "KubernetesContainer",
    foreignKey: "FK_eadbc98e53bc5788d8313e52c67",
  },
  { table: "DockerHost", foreignKey: "FK_3f59ee567503d580023fd9195be" },
  {
    table: "HostCollectorConfig",
    foreignKey: "FK_15014197ee6332c1fa46c3702b8",
  },
  { table: "CephCluster", foreignKey: "FK_4ed976be4233caef7e2870809bf" },
  { table: "ProxmoxCluster", foreignKey: "FK_5ea525bb98954059807e2d78188" },
  { table: "Probe", foreignKey: "FK_1963e116be9832b23490cca933f" },
  { table: "OpenStackCloud", foreignKey: "FK_c52394b267faf355844fff8154d" },
  { table: "Host", foreignKey: "FK_aa5c88e1babc531c2f494117f2e" },
  { table: "PodmanHost", foreignKey: "FK_d3489b9ce7bbc6d188532380465" },
  { table: "VMwareVCenter", foreignKey: "FK_d131b6ffe4448dbfdab9132a0f3" },
  { table: "StorageArray", foreignKey: "FK_980983fabc9e82cc9ae4f52cc9c" },
  { table: "Service", foreignKey: "FK_bb4eb18e4568cbeacc194c5c977" },
  { table: "CloudConnection", foreignKey: "FK_9992dcd91ef05a794ba983cbcd9" },
  { table: "CloudResource", foreignKey: "FK_44ac71e6f136a8e7be941a059ff" },
  { table: "DockerSwarmCluster", foreignKey: "FK_b0b79b94e54b04805af8215e781" },
  { table: "IoTFleet", foreignKey: "FK_1be95254160cf2b11cb4575f00a" },
  { table: "DatabaseServer", foreignKey: "FK_eb94a05dcea748c2e20bd5764d5" },
  { table: "MonitorStatus", foreignKey: "FK_55a0e488581a0d02bcdd67a4348" },
  { table: "MonitorTemplate", foreignKey: "FK_1ae8af32297ba8e1b9a2c03b38f" },
  { table: "NetworkAlertPolicy", foreignKey: "FK_e7cc6526ed2f1f23a2f24560c65" },
  { table: "Monitor", foreignKey: "FK_73bdf22259019b90836aac86b28" },
  {
    table: "NetworkDeviceOidTemplate",
    foreignKey: "FK_f74ffbb8d3cb49a27055c53697e",
  },
  {
    table: "NetworkSnmpCredentialProfile",
    foreignKey: "FK_66f88d052fc53906511384c1f65",
  },
  { table: "NetworkDeviceRole", foreignKey: "FK_9dc66fa19636ba160af1521f45d" },
  { table: "NetworkSiteType", foreignKey: "FK_219288481a872d2a7333de2e317" },
  { table: "NetworkSite", foreignKey: "FK_732e91b59f88426fb871a111e9b" },
  { table: "NetworkDevice", foreignKey: "FK_4fa51de5ca772c255c845952bc2" },
  {
    table: "NetworkDeviceOwnerTeam",
    foreignKey: "FK_8050ac10da1503ba19f6ba209b4",
  },
  {
    table: "NetworkDeviceOwnerUser",
    foreignKey: "FK_20f98ac43c96c7bfb243640cc3f",
  },
  {
    table: "NetworkDeviceOwnerRule",
    foreignKey: "FK_46ae144cd651021478bb02f5e7f",
  },
  {
    table: "NetworkDeviceLabelRule",
    foreignKey: "FK_eff1c298121aab64fba34115cea",
  },
  {
    table: "NetworkDeviceAutoImportRule",
    foreignKey: "FK_nd_auto_import_rule_deletedByUserId",
  },
  {
    table: "NetworkDeviceDiscoveryScan",
    foreignKey: "FK_9d892856629b6f597ccc60557f4",
  },
  {
    table: "NetworkDeviceDiagnostic",
    foreignKey: "FK_2f81372c0b481cc7c9aa5f90c6d",
  },
  { table: "PacketCapture", foreignKey: "FK_3c8350d5a9f304a9e0096c6aaeb" },
  {
    table: "NetworkSiteOwnerTeam",
    foreignKey: "FK_9f8e2780eb643a06dde92ace3c0",
  },
  {
    table: "NetworkSiteOwnerUser",
    foreignKey: "FK_74e776130d5de726483117e6a54",
  },
  { table: "NetworkEndpoint", foreignKey: "FK_ac25adccac14df0db12c27070b2" },
  {
    table: "NetworkSiteStatusTimeline",
    foreignKey: "FK_32a3194a2fa1a7e070614064bcb",
  },
  { table: "NetworkSiteLink", foreignKey: "FK_5a2cb3c1eefea043877ccbf248e" },
  { table: "NetworkDeviceLink", foreignKey: "FK_60fb427dfafc613acacdbf58125" },
  {
    table: "NetworkDeviceLinkRule",
    foreignKey: "FK_e1309ec901d89b516e8d4289dab",
  },
  {
    table: "NetworkTopologySuppression",
    foreignKey: "FK_12c1cb1eb837b79e2f9f6c067ed",
  },
  {
    table: "NetworkSiteAssignmentRule",
    foreignKey: "FK_2fcbff1ec5859717f2731f37555",
  },
  {
    table: "NetworkDeviceNamingRule",
    foreignKey: "FK_410b2992e27211111f01b61363b",
  },
  {
    table: "NetworkControllerConnection",
    foreignKey: "FK_2032969563f397798164038015b",
  },
  {
    table: "DeviceManagementConnection",
    foreignKey: "FK_3595b00fdd93d36f9dc45f7fb3a",
  },
  { table: "InventoryItem", foreignKey: "FK_c27f19553f14afe37b7658e26f3" },
  { table: "NetworkAddressName", foreignKey: "FK_b5d14bd884f50f2806b6f2d4715" },
  {
    table: "DockerHostOwnerTeam",
    foreignKey: "FK_6d66a84d603aaff4b5ac2c64cc1",
  },
  {
    table: "DockerHostOwnerUser",
    foreignKey: "FK_090e1ea6d6de6945d97e6c104b0",
  },
  { table: "DockerResource", foreignKey: "FK_2fda4244a259a6e28de2df1b479" },
  {
    table: "PodmanHostOwnerTeam",
    foreignKey: "FK_60e39785a25e87094f3c26f1a31",
  },
  {
    table: "PodmanHostOwnerUser",
    foreignKey: "FK_1f25293571ef8e2463395752fd9",
  },
  { table: "PodmanResource", foreignKey: "FK_ee3ba0f5cf06521b69737f557bd" },
  {
    table: "OpenStackCloudConnectionTest",
    foreignKey: "FK_58ada20095cb2252e69b712d736",
  },
  {
    table: "OpenStackCloudCheck",
    foreignKey: "FK_f14a2086bddc129ea19f2f1aa1b",
  },
  {
    table: "ProxmoxClusterOwnerTeam",
    foreignKey: "FK_26cbfc7eba8141ece8c684c770b",
  },
  {
    table: "OpenStackCloudOwnerTeam",
    foreignKey: "FK_3f9ca328b00763132b5e09abd2a",
  },
  {
    table: "DockerSwarmClusterOwnerTeam",
    foreignKey: "FK_3e5dc2c6bde8e7edc53ebd68e1e",
  },
  {
    table: "ProxmoxClusterOwnerUser",
    foreignKey: "FK_6a90d5141b0c9854c32a8ca4c8e",
  },
  {
    table: "OpenStackCloudOwnerUser",
    foreignKey: "FK_e22bff7e0ecc207699226f47240",
  },
  {
    table: "DockerSwarmClusterOwnerUser",
    foreignKey: "FK_fc398d618da640affc0b5bc2067",
  },
  { table: "ProxmoxResource", foreignKey: "FK_9f5b91e77509f790c71888d73af" },
  { table: "OpenStackResource", foreignKey: "FK_9408957796dc10c4f0206d54cab" },
  {
    table: "OpenStackProjectUsage",
    foreignKey: "FK_7766afbc86e056d62a6be019004",
  },
  { table: "OnCallDutyPolicy", foreignKey: "FK_0424b49cfcd68cdd1721df53acd" },
  { table: "OpenStackBudget", foreignKey: "FK_a50dcd1c0917396608a6ad70aa8" },
  {
    table: "ProjectCallSMSConfig",
    foreignKey: "FK_f5bc0e2b81886b21004e2a5f67b",
  },
  { table: "ProjectSMTPConfig", foreignKey: "FK_d5458705e98b89c08c0d960422e" },
  { table: "StatusPage", foreignKey: "FK_71f429afb7678d132472b3c87b0" },
  {
    table: "OpenStackProjectNotice",
    foreignKey: "FK_3e3453e6d6b4987447bbfdba0eb",
  },
  {
    table: "OpenStackProjectNoticeDelivery",
    foreignKey: "FK_215eaa78939d58f5e038f975ade",
  },
  {
    table: "DockerSwarmResource",
    foreignKey: "FK_480af1c3b24d7a06c857460cec3",
  },
  { table: "IoTFleetOwnerTeam", foreignKey: "FK_0ccafe61295a6f62a3f4899c372" },
  { table: "IoTFleetOwnerUser", foreignKey: "FK_f00c122709a8a42f59f89da15b8" },
  { table: "IoTDevice", foreignKey: "FK_0bec7e63da775127f425eeb619f" },
  {
    table: "IoTDeviceCredential",
    foreignKey: "FK_e03efc287e1715f34367081650a",
  },
  {
    table: "CephClusterOwnerTeam",
    foreignKey: "FK_9db7fe4ecea9d899101e1a5c09b",
  },
  {
    table: "CephClusterOwnerUser",
    foreignKey: "FK_1f6621f7b7c6fae18ca69412e31",
  },
  { table: "CephResource", foreignKey: "FK_3ef04d7364c547f9bdc63c84d79" },
  {
    table: "StorageArrayOwnerTeam",
    foreignKey: "FK_711e83e05403f1bafa3aa3ba234",
  },
  {
    table: "StorageArrayOwnerUser",
    foreignKey: "FK_9a06186536dee516853a4578e8e",
  },
  {
    table: "StorageArrayResource",
    foreignKey: "FK_dad5db8e8755eba24d9d482bc84",
  },
  {
    table: "VMwareVCenterOwnerTeam",
    foreignKey: "FK_391feff77ffeb24d2a56c67d94f",
  },
  {
    table: "VMwareVCenterOwnerUser",
    foreignKey: "FK_753270bf2caf7598eee9b883556",
  },
  {
    table: "VMwareVCenterConnectionTest",
    foreignKey: "FK_c52a9d89c13d337aa0b50f80da9",
  },
  { table: "VMwareResource", foreignKey: "FK_9f014fc5335e861cd69d8008201" },
  { table: "HostOwnerTeam", foreignKey: "FK_6d4be0abe0aafe5f92dabe17c39" },
  { table: "HostOwnerUser", foreignKey: "FK_aae3727b2c7f6567667f367996a" },
  { table: "ServerlessFunction", foreignKey: "FK_1bc85c5dbcfc1d8204e6d1ec6dd" },
  {
    table: "ServerlessFunctionOwnerTeam",
    foreignKey: "FK_41aed582e8366e5da5534ca48b2",
  },
  {
    table: "ServerlessFunctionOwnerUser",
    foreignKey: "FK_1b9698f0dcda23603948eae2011",
  },
  {
    table: "ServerlessFunctionLabelRule",
    foreignKey: "FK_5d929df6cf765831b0da9dfc05f",
  },
  {
    table: "ServerlessFunctionOwnerRule",
    foreignKey: "FK_8f004744e44a2cb3ebadfae8680",
  },
  { table: "CloudAccount", foreignKey: "FK_32257fddccb69f15adb3db46a25" },
  { table: "CloudAccountFeed", foreignKey: "FK_108cc3e22602e8d8675c039f38d" },
  { table: "CloudBudget", foreignKey: "FK_714c7eb992ad62e9b9e0379d992" },
  {
    table: "CloudCostRecommendation",
    foreignKey: "FK_8ed3d8d4d9acbeec688c3a9ff55",
  },
  {
    table: "CloudResourceOwnerTeam",
    foreignKey: "FK_a4fe1dbdefbd37ace0c5e5393da",
  },
  {
    table: "CloudResourceOwnerUser",
    foreignKey: "FK_50cf07eb5a5eb5ea2f87785cd8d",
  },
  {
    table: "CloudResourceLabelRule",
    foreignKey: "FK_33bf43a567e200eccf3f0d51bfd",
  },
  {
    table: "CloudResourceOwnerRule",
    foreignKey: "FK_3d30c49af5ad8e0df6674ad3886",
  },
  {
    table: "DatabaseServerEndpoint",
    foreignKey: "FK_9ddde92b69c65f4342415a0e69b",
  },
  { table: "DatabaseServerFeed", foreignKey: "FK_9a15ce20b4003b823a174a75132" },
  {
    table: "DatabaseServerOwnerTeam",
    foreignKey: "FK_3485d4eb03b07d39ef7a6c414d9",
  },
  {
    table: "DatabaseServerOwnerUser",
    foreignKey: "FK_e6ea9fd3cefc6eea34819d4ad63",
  },
  {
    table: "DatabaseServerLabelRule",
    foreignKey: "FK_8cb7d5d9c495497b098c9701543",
  },
  {
    table: "DatabaseServerOwnerRule",
    foreignKey: "FK_2cce4f244875df37236c0e6982f",
  },
  { table: "MessageQueue", foreignKey: "FK_071b13be3db2998d57ec46e1879" },
  {
    table: "MessageQueueOwnerTeam",
    foreignKey: "FK_bb6282db18362c85265a4ca9e0e",
  },
  {
    table: "MessageQueueOwnerUser",
    foreignKey: "FK_23795f3bc45331aaa14573b7318",
  },
  {
    table: "MessageQueueLabelRule",
    foreignKey: "FK_0356f7c46318b6f84e72d529f99",
  },
  {
    table: "MessageQueueOwnerRule",
    foreignKey: "FK_16a8f9a34efdfdd69cd1d3b5288",
  },
  { table: "RumApplication", foreignKey: "FK_6124efe14c3afc9213a76e12377" },
  {
    table: "RumApplicationOwnerTeam",
    foreignKey: "FK_296719dc20a708045708549d009",
  },
  {
    table: "RumApplicationOwnerUser",
    foreignKey: "FK_5342e8e7a9971da2c707f1d97e7",
  },
  {
    table: "RumApplicationLabelRule",
    foreignKey: "FK_6479e0950c80c9e18095a977439",
  },
  {
    table: "RumApplicationOwnerRule",
    foreignKey: "FK_93a410a831bc0ed2700303451a0",
  },
  {
    table: "ServerlessFunctionInstance",
    foreignKey: "FK_98359c94195808b927ae380e507",
  },
  { table: "CloudApp", foreignKey: "FK_a2c20e2834c9e16220eaaf580d5" },
  {
    table: "CloudResourceInstance",
    foreignKey: "FK_0e6004f3ae827f08ea33b39f888",
  },
  { table: "CloudAppRevision", foreignKey: "FK_ed2057c6284a0a0fcda65c2f35c" },
  {
    table: "RumApplicationClient",
    foreignKey: "FK_b3f923b134abc79fbfa784e8330",
  },
  { table: "IncidentRole", foreignKey: "FK_ca13ae495a9a6412995e2e123f7" },
  {
    table: "IncidentGroupingRule",
    foreignKey: "FK_7a0da098649113cb8251f48c0b5",
  },
  { table: "IncidentState", foreignKey: "FK_88a0ecd4b1714ac0e2eef9ac27d" },
  { table: "IncidentEpisode", foreignKey: "FK_503057381f67795efd0fdafff29" },
  {
    table: "IncidentPostmortemStatus",
    foreignKey: "FK_038ba648dd7294c0f4b1c5e52c5",
  },
  {
    table: "ServiceLevelObjective",
    foreignKey: "FK_ff1296ae51710c26f904dfef2fd",
  },
  { table: "Incident", foreignKey: "FK_067855888a3d71803d3a5aeaecf" },
  {
    table: "RumSessionReplayView",
    foreignKey: "FK_4eba05ce7e0de40ca86c7ed691c",
  },
  {
    table: "RumSessionErasureRequest",
    foreignKey: "FK_6c7c6db492bb0ca7ec8c7da5c6c",
  },
  { table: "AlertState", foreignKey: "FK_570b9cc5f95f8a70d0b80ef5739" },
  { table: "AlertGroupingRule", foreignKey: "FK_7a91abf5593435797ac4fe99125" },
  { table: "AlertEpisode", foreignKey: "FK_70fea6d5bce21e224230864acd1" },
  { table: "Alert", foreignKey: "FK_6efa9972d8181f4ea785c0eec47" },
  { table: "RumSessionPin", foreignKey: "FK_b2ead77d56a8e0df5d90749dfb7" },
  {
    table: "RumProductAnalyticsSavedView",
    foreignKey: "FK_0aa61ec1c6534301b840ed96bca",
  },
  { table: "ApiKey", foreignKey: "FK_bcbc7d80fb0cfe2cbb5ae7db791" },
  { table: "CustomRole", foreignKey: "FK_0e8d74a9a7e6aa2f3e9fa52463d" },
  { table: "ApiKeyCustomRole", foreignKey: "FK_c349d6488a55807c4399b296037" },
  {
    table: "CustomRolePermission",
    foreignKey: "FK_87f97c43da0afcbbdd0bc09695b",
  },
  { table: "ApiKeyPermission", foreignKey: "FK_ac42ef4597147c260e89a0f3d3a" },
  { table: "BillingInvoice", foreignKey: "FK_0a0a1a9865d157e46b1ecf14873" },
  {
    table: "BillingPaymentMethod",
    foreignKey: "FK_93a1554cb316127896f66acddd3",
  },
  {
    table: "ScheduledMaintenanceState",
    foreignKey: "FK_4f803428e0926584d1f7c44a3d4",
  },
  {
    table: "ScheduledMaintenance",
    foreignKey: "FK_50ddf8bb21e988ea5d419a66cb9",
  },
  {
    table: "StatusPageAnnouncement",
    foreignKey: "FK_7251cbbaa75eb9570830b0cab32",
  },
  {
    table: "OnCallDutyPolicyEscalationRule",
    foreignKey: "FK_5c0911d261a941b00d41b6e5fda",
  },
  {
    table: "OnCallDutyPolicySchedule",
    foreignKey: "FK_01e63400072d0bc6debee836cbf",
  },
  {
    table: "OnCallDutyPolicyExecutionLog",
    foreignKey: "FK_e9302e15399b67938e0121a0545",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    foreignKey: "FK_166f3696b3c70989507dd7e1f2e",
  },
  { table: "UserCall", foreignKey: "FK_996ab46825df7f3512e735c450c" },
  { table: "UserEmail", foreignKey: "FK_a1aa5e10dcfb571521324bbd665" },
  {
    table: "CustomNotificationChannel",
    foreignKey: "FK_2efee67bb3c3dd9c982f10dd984",
  },
  { table: "UserPush", foreignKey: "FK_964b240ccbb12a9a8c947272540" },
  { table: "UserSMS", foreignKey: "FK_0bae98162ec44540ff85f724daa" },
  { table: "UserTelegram", foreignKey: "FK_a3d125c9c6d49543234415c3f2f" },
  { table: "UserSlack", foreignKey: "FK_2f058862227400121f90925d65e" },
  { table: "UserMicrosoftTeams", foreignKey: "FK_1d7cfdf5a4e314cf4b4cc7873e0" },
  { table: "UserMattermost", foreignKey: "FK_a60fea37fdabb0b046474735183" },
  { table: "UserWebhook", foreignKey: "FK_ef72bea12b483dcf47137aa7d82" },
  { table: "UserWhatsApp", foreignKey: "FK_e90592dde8357dd1afbf19073d8" },
  {
    table: "UserNotificationRule",
    foreignKey: "FK_b1292f2480d0c4985898d7bf33a",
  },
  { table: "UserOnCallLog", foreignKey: "FK_ac31bad932e24418ce0bb1bbb14" },
  {
    table: "UserOnCallLogTimeline",
    foreignKey: "FK_a93a41d65df4cbe518393695084",
  },
  { table: "CallLog", foreignKey: "FK_3e510124d923fe3b994936a7cb5" },
  { table: "DataMigrations", foreignKey: "FK_183a8261590c30a27a1b51f4bdb" },
  { table: "Domain", foreignKey: "FK_9ace4c275b42c057b7581543ce3" },
  { table: "EmailLog", foreignKey: "FK_6d0739da601917d316494fcae3b" },
  {
    table: "EmailVerificationToken",
    foreignKey: "FK_9e86ebfdbef16789e9571f22074",
  },
  { table: "IncidentFeed", foreignKey: "FK_f1ee9faba64e96f91925247aae3" },
  {
    table: "IncidentCustomField",
    foreignKey: "FK_bc64c76e766b1b880845afbcbf7",
  },
  {
    table: "IncidentInternalNote",
    foreignKey: "FK_8f23b820cbbed6d96cfedd162a2",
  },
  {
    table: "IncidentNoteTemplate",
    foreignKey: "FK_3c00f2b005264318a274cd38a94",
  },
  {
    table: "IncidentPostmortemTemplate",
    foreignKey: "FK_2e886387888f1311f361d569b8e",
  },
  {
    table: "IncidentPostmortemActionItem",
    foreignKey: "FK_bbba6603e305832c2d7406f1485",
  },
  { table: "IncidentOwnerTeam", foreignKey: "FK_60242ecfcecaa5cb1c5241bed4c" },
  { table: "IncidentOwnerUser", foreignKey: "FK_c473db8745d0ebeb147a72986cb" },
  { table: "IncidentMember", foreignKey: "FK_d4fa23e478940bab6bbcfd556b8" },
  { table: "IncidentPublicNote", foreignKey: "FK_cf04d778a5502be606f63e01603" },
  {
    table: "IncidentStateTimeline",
    foreignKey: "FK_6b6b9dbf9ca5448c9297a58ad04",
  },
  { table: "Form", foreignKey: "FK_4e8a4b94e1bc1d6bec291cb1b64" },
  { table: "FormDomain", foreignKey: "FK_78b2e2dfcdf116a4e3523f3cdc0" },
  { table: "FormPrivateUser", foreignKey: "FK_a1153f1d2fe779d6968502a0e47" },
  { table: "FormSSO", foreignKey: "FK_7e26ed3c9def2949ee34c9ab4d8" },
  { table: "FormOIDC", foreignKey: "FK_5960b5a68a6ab3bdce70056e854" },
  { table: "IncidentTemplate", foreignKey: "FK_0e6a4e065ffb22f95ecfc259e9a" },
  {
    table: "IncidentTemplateOwnerTeam",
    foreignKey: "FK_af037dc245d77c282061fea1b1b",
  },
  {
    table: "IncidentTemplateOwnerUser",
    foreignKey: "FK_026e918a31de467eeb8e30ae8d1",
  },
  { table: "LogSavedView", foreignKey: "FK_a7817e3946945d28ef65a81e173" },
  { table: "MetricSavedView", foreignKey: "FK_84e306d0d03a2a4721fe767464d" },
  { table: "TraceSavedView", foreignKey: "FK_e98727a618620d359fc766c95fc" },
  { table: "ExceptionSavedView", foreignKey: "FK_25350e9b232c500f4c0cb0c60b2" },
  { table: "LogPipeline", foreignKey: "FK_ffe95c5c8cbcea614d33c255d24" },
  { table: "LogDropFilter", foreignKey: "FK_7702956f8707c3d3525ddb299c9" },
  { table: "DetectionRule", foreignKey: "FK_30f12b8514cc8ebb336988ebf68" },
  {
    table: "DetectionRuleException",
    foreignKey: "FK_2d056e467296c5bd38448739482",
  },
  {
    table: "SecurityEventConnection",
    foreignKey: "FK_760637b50c4a45db4c77f50597b",
  },
  { table: "ThreatIntelFeed", foreignKey: "FK_fa32bd7c42ea2b291e649940c7f" },
  { table: "SecurityWatchlist", foreignKey: "FK_7be7b35047a41d5788f697b1290" },
  {
    table: "SecurityWatchlistItem",
    foreignKey: "FK_8356101c8d85b2193a20b895741",
  },
  { table: "SecurityHunt", foreignKey: "FK_b3189091a5c3c4baed6b649a872" },
  {
    table: "SecurityCasePriority",
    foreignKey: "FK_ddfe33560801cef57c57c7752a4",
  },
  { table: "SecurityCaseStatus", foreignKey: "FK_2849e27ac567081a0ce0337eb35" },
  { table: "SecurityCase", foreignKey: "FK_1213a537d995da221db0e3025fb" },
  { table: "SecurityCaseFeed", foreignKey: "FK_7494ed1931845b9f84d28397db5" },
  { table: "SecurityCaseNote", foreignKey: "FK_70a8069bb41a167809de24f9336" },
  { table: "SecurityCaseTask", foreignKey: "FK_86a5069de9b8174db621d62c9d3" },
  {
    table: "SecurityCaseStepCheck",
    foreignKey: "FK_8976d518bed4c473d40ac1026bb",
  },
  {
    table: "SecurityCaseAiAction",
    foreignKey: "FK_d949d9b2a8c90207b5efd1dc8d9",
  },
  {
    table: "SecurityCaseEvidence",
    foreignKey: "FK_fa8da65136bffcab040fd9c0f47",
  },
  {
    table: "SecurityCaseNoteTemplate",
    foreignKey: "FK_f6dacfc0899f929894b8e71f787",
  },
  {
    table: "SecurityCaseCustomField",
    foreignKey: "FK_600a0302a57c5c8f259854acd18",
  },
  { table: "SecurityDetection", foreignKey: "FK_01804e55ef0b3fc7ff3035b5444" },
  { table: "SecurityPlaybook", foreignKey: "FK_fa9e8ee4cd66bb18595e975c0ed" },
  {
    table: "SecurityPlaybookRun",
    foreignKey: "FK_4a9fc56bd0566682a1c6c455819",
  },
  { table: "DataStore", foreignKey: "FK_83129fdd882360c24ad81d61dfa" },
  { table: "DataStoreFeed", foreignKey: "FK_8c145fde71dbd387fb5c3abfdfc" },
  { table: "DataStoreOwnerUser", foreignKey: "FK_761feae8872872ef1bfc67505cb" },
  { table: "DataStoreOwnerTeam", foreignKey: "FK_efa181757c04914f20808d4a008" },
  { table: "DataStoreOwnerRule", foreignKey: "FK_da350656c17bacd22ca50688a25" },
  { table: "DataStoreLabelRule", foreignKey: "FK_71ccb165f56df859f92c7b62dff" },
  {
    table: "DataSecurityIssueFeed",
    foreignKey: "FK_eef71eaa25762dda92eae4343ad",
  },
  {
    table: "DataSecurityCustomDataType",
    foreignKey: "FK_c33758b3945db42ed687d3e903d",
  },
  {
    table: "DataSecurityCheckSetting",
    foreignKey: "FK_7fdff1303a278b1a526d1558490",
  },
  {
    table: "DataSecurityComplianceSetting",
    foreignKey: "FK_ad80fa8e64544f907487abab43f",
  },
  {
    table: "DataSecurityResidencyRule",
    foreignKey: "FK_12b3f828842cb27c38e0c3042be",
  },
  {
    table: "DataSecuritySetting",
    foreignKey: "FK_311ebfded9ddb579f14a1b43cdb",
  },
  { table: "DataAsset", foreignKey: "FK_0b5fb1a03b2c31ab8460b4247f4" },
  { table: "DataAssetFeed", foreignKey: "FK_be74636aaa7066b77843e6159e1" },
  { table: "DataAssetUsage", foreignKey: "FK_0248ed56e7c732fdd73af6b733b" },
  { table: "DataCheck", foreignKey: "FK_474e76023c97bbcff19e1aa4007" },
  { table: "DataPipeline", foreignKey: "FK_52110bf4f9f264798586ca893bf" },
  { table: "DataPipelineRun", foreignKey: "FK_ae4f478e055b47baa17afb2fc90" },
  { table: "DataProduct", foreignKey: "FK_e8686c929d6582cec5da9c917e6" },
  { table: "DataBiConnection", foreignKey: "FK_5049c6f5affe4d1d0bd582cf4b1" },
  { table: "DataDashboard", foreignKey: "FK_6d8aae1ec5e35555106e2b219c9" },
  { table: "DataWarehouseJob", foreignKey: "FK_623f74224dbfb2fd3dff1000bac" },
  { table: "DataReconciliation", foreignKey: "FK_1d412c00db6987bfc818b5e4c54" },
  { table: "DataAssetOwnerUser", foreignKey: "FK_9e7978b4de8192022fb7604000d" },
  { table: "DataAssetOwnerTeam", foreignKey: "FK_399c9cdde8b479e635a1d990d13" },
  { table: "DataAssetOwnerRule", foreignKey: "FK_3c987f15fb20ff37af4e3f7b51b" },
  {
    table: "DataPipelineOwnerUser",
    foreignKey: "FK_338e3cbc64e03cc597fc00ffa21",
  },
  {
    table: "DataPipelineOwnerTeam",
    foreignKey: "FK_4bd997eca67f5cf145c71f5c541",
  },
  {
    table: "DataPipelineOwnerRule",
    foreignKey: "FK_db78a8ffd37825e7a00c0234a44",
  },
  { table: "DataAssetLabelRule", foreignKey: "FK_64ca26af0890939f02732f01c4d" },
  { table: "DataAssetLineage", foreignKey: "FK_bfb3351cf6698fd14724773f5b5" },
  { table: "DataAlert", foreignKey: "FK_9e25f45882e3fa59125928d783a" },
  {
    table: "SecurityProtectedEntity",
    foreignKey: "FK_5756b5c1ea4171dc2569aa36b75",
  },
  { table: "SecurityEntityRisk", foreignKey: "FK_a81067842fc4466199cd449682a" },
  {
    table: "SecurityEntityCriticality",
    foreignKey: "FK_c84373fd124e70d4f7c20834003",
  },
  {
    table: "SecurityEventDestination",
    foreignKey: "FK_8ff11c9269d71cc36531ad8203b",
  },
  { table: "AuditLogExport", foreignKey: "FK_210bbfdefa3fa470f60ac755de9" },
  { table: "BackupSetting", foreignKey: "FK_dd2390a74a64595753cb142143b" },
  { table: "BackupRun", foreignKey: "FK_64bdabd3ae0432c9cee431e537d" },
  { table: "SecurityLogSource", foreignKey: "FK_befc1f196d1bec30fc2ac69a287" },
  {
    table: "SecurityTelemetrySource",
    foreignKey: "FK_ca3739ab048f25e965cf70658ef",
  },
  { table: "LogScrubRule", foreignKey: "FK_88ad7031d2481dd8142e543ddbd" },
  { table: "MetricPipelineRule", foreignKey: "FK_5a45d3f3917790440570168084b" },
  { table: "LlmCostBudget", foreignKey: "FK_74898628624d84ba6c9a55bb5fc" },
  { table: "LlmModelPrice", foreignKey: "FK_fe6a5aa119cbb45391d3daa4801" },
  {
    table: "LlmObservabilityConnection",
    foreignKey: "FK_581714c14d464060d75bc82bb88",
  },
  {
    table: "MetricRecordingRule",
    foreignKey: "FK_889e2b5640ac7ac63d19d511f9d",
  },
  { table: "TracePipeline", foreignKey: "FK_086f4177abd8340b2af53e000bb" },
  { table: "TraceDropFilter", foreignKey: "FK_fe8fa6a2f0a6e4eb288711a91ce" },
  { table: "TraceScrubRule", foreignKey: "FK_b52baa856c6d83f640d5739d26b" },
  { table: "TraceRecordingRule", foreignKey: "FK_022d2a4bd300c1052cdf6323eb1" },
  { table: "LogRecordingRule", foreignKey: "FK_d1069076b1841e5720b7d6e0df4" },
  { table: "MonitorCustomField", foreignKey: "FK_817e69522c8d2f1e2fd3f857e91" },
  { table: "MonitorGroup", foreignKey: "FK_edd658b85b2ef7ac9b2f0687d8a" },
  {
    table: "MonitorGroupOwnerTeam",
    foreignKey: "FK_fdbe93e29e60763a306358cab55",
  },
  {
    table: "MonitorGroupOwnerUser",
    foreignKey: "FK_e9bced91dce29928ebeec834905",
  },
  {
    table: "MonitorGroupResource",
    foreignKey: "FK_1a54eaa2d0187d10de84107a09b",
  },
  { table: "MonitorOwnerTeam", foreignKey: "FK_7ebfe3ddcf597fb73ee8eac2ff4" },
  { table: "MonitorOwnerUser", foreignKey: "FK_e1ae2c698e6bde0a98c50162235" },
  { table: "MonitorProbe", foreignKey: "FK_a182ba062c0a216395d0dbdbdee" },
  { table: "MonitorSecret", foreignKey: "FK_e4262f178662aaacdb54d4c4f4e" },
  {
    table: "IncomingRequestSecret",
    foreignKey: "FK_039c922008784d430af36f5f960",
  },
  {
    table: "MonitorStatusTimeline",
    foreignKey: "FK_d293a7e96c5bf427072514f21a9",
  },
  {
    table: "OnCallDutyPolicyCustomField",
    foreignKey: "FK_43230e739b31e3f56284407b586",
  },
  {
    table: "OnCallDutyPolicyEscalationRuleSchedule",
    foreignKey: "FK_878e14be4e6366ec646f874347a",
  },
  {
    table: "OnCallDutyPolicyEscalationRuleTeam",
    foreignKey: "FK_73ae2b2702aef4601c39d4d909a",
  },
  {
    table: "OnCallDutyPolicyEscalationRuleUser",
    foreignKey: "FK_d35f668f524cc88f580a7651fe2",
  },
  {
    table: "OnCallDutyPolicyOwnerTeam",
    foreignKey: "FK_4779fb1eee2979cb5f43b3d0596",
  },
  {
    table: "OnCallDutyPolicyOwnerUser",
    foreignKey: "FK_18918751784b7f55ad605f2310b",
  },
  {
    table: "OnCallDutyPolicyFeed",
    foreignKey: "FK_daaf8acf8317e6f8b7beb07b520",
  },
  {
    table: "OnCallDutyPolicyScheduleLayer",
    foreignKey: "FK_f22b52355207d2c0d5a13c168e8",
  },
  {
    table: "OnCallDutyPolicyScheduleLayerUser",
    foreignKey: "FK_49e5a41e1d771fe9e385295bd9a",
  },
  {
    table: "OnCallDutyPolicyScheduleOwnerTeam",
    foreignKey: "FK_4777eabd2b25fd992d96e587aa6",
  },
  {
    table: "OnCallDutyPolicyScheduleOwnerUser",
    foreignKey: "FK_7d4b5fea944b7fded0751a430cf",
  },
  {
    table: "UserOnCallCalendarFeed",
    foreignKey: "FK_c86499821f995e2848d50587734",
  },
  {
    table: "OnCallDutyPolicyScheduleCalendarFeed",
    foreignKey: "FK_98e071d8d4878b32cd13785541e",
  },
  {
    table: "ProjectOnCallCalendarFeed",
    foreignKey: "FK_c116c4230da31bc39fb26ae9ba1",
  },
  {
    table: "ScheduledMaintenanceCalendarFeed",
    foreignKey: "FK_31f05d268b5a9eecdaace1004ad",
  },
  {
    table: "ScheduledMaintenanceExternalCalendar",
    foreignKey: "FK_4e86740b5a1e58507dd8d8384c7",
  },
  {
    table: "UserOnCallShiftReminder",
    foreignKey: "FK_02694a9354a70b887beccabec7f",
  },
  {
    table: "OnCallDutyPolicyLabelRule",
    foreignKey: "FK_3b70c936f3f7455e2b46e9f48c4",
  },
  {
    table: "OnCallDutyPolicyOwnerRule",
    foreignKey: "FK_52e705f1a8378fad04f2602b37c",
  },
  {
    table: "OnCallDutyPolicyScheduleLabelRule",
    foreignKey: "FK_65623d5b6f51da7691c40413c36",
  },
  {
    table: "OnCallDutyPolicyScheduleOwnerRule",
    foreignKey: "FK_d70ddfa8995c7962aace4c94d81",
  },
  { table: "IncomingCallPolicy", foreignKey: "FK_197d35d96152cbaa101afa670bd" },
  {
    table: "IncomingCallPolicyOwnerTeam",
    foreignKey: "FK_26c62a4b3a3b021c16bb591e05a",
  },
  {
    table: "IncomingCallPolicyOwnerUser",
    foreignKey: "FK_a0c5ee02ba551bcaf053be02d96",
  },
  {
    table: "IncomingCallPolicyLabelRule",
    foreignKey: "FK_8913f50c9388167305b9a5475cf",
  },
  {
    table: "IncomingCallPolicyOwnerRule",
    foreignKey: "FK_572565b3e381aded9007e22cae4",
  },
  {
    table: "OnCallDutyPolicyTimeLog",
    foreignKey: "FK_b6476633034478def5e6f435cc7",
  },
  {
    table: "IncomingCallPolicyEscalationRule",
    foreignKey: "FK_c434cfc9ca11de56e1b5a316559",
  },
  { table: "ProbeOwnerTeam", foreignKey: "FK_e72250699a438e22153d9c32ea3" },
  { table: "ProbeOwnerUser", foreignKey: "FK_248df6f39557f114b03dd815bcf" },
  { table: "AIAgent", foreignKey: "FK_d28e33795c84713c421e91f3104" },
  { table: "AIAgentOwnerTeam", foreignKey: "FK_26fd04196dedd19188625cbd847" },
  { table: "AIAgentOwnerUser", foreignKey: "FK_61e11581dbae0cf42967dbe219a" },
  { table: "LlmProvider", foreignKey: "FK_082f150ef63369af3cd022d3720" },
  { table: "CodeRepository", foreignKey: "FK_79d9249eb5f8174a6f6228311f4" },
  {
    table: "AIAgentTaskPullRequest",
    foreignKey: "FK_4d45ffb4c369fa8092d1744850d",
  },
  { table: "AIConversation", foreignKey: "FK_17a3378eefeacaaff1aac421a75" },
  {
    table: "AIConversationMessage",
    foreignKey: "FK_86d4a9000d6505b1df390835582",
  },
  { table: "AIRun", foreignKey: "FK_d43a154faca8c5073d3072b9a14" },
  { table: "AIRunEvent", foreignKey: "FK_23c6b5f0bfd37523850372f7828" },
  { table: "AIInsight", foreignKey: "FK_5d57f7c210c9ec56efec43e2d50" },
  { table: "LlmLog", foreignKey: "FK_bbe2bdcf251d6ef1ea43b666370" },
  { table: "DataSource", foreignKey: "FK_29f0d663494b52c4ed2c0cc8e88" },
  { table: "ProjectUserProfile", foreignKey: "FK_5fe8245962849bde50687e2c707" },
  { table: "ProjectSSO", foreignKey: "FK_00ea9e456217ffbfff35f1e944f" },
  { table: "ProjectOIDC", foreignKey: "FK_3f386ff54e38e36f4c016187648" },
  { table: "GlobalSSO", foreignKey: "FK_4f520827496e355d4bdfda66120" },
  { table: "GlobalOIDC", foreignKey: "FK_0febb2e4c4d8703fce4bc816b36" },
  { table: "GlobalSSOProject", foreignKey: null },
  { table: "GlobalOIDCProject", foreignKey: null },
  { table: "PromoCode", foreignKey: "FK_3169f7934171e8f697bb993b010" },
  {
    table: "RecommendationDismissal",
    foreignKey: "FK_9c62a79e18419e3fba90d38a3db",
  },
  {
    table: "ScheduledMaintenanceCustomField",
    foreignKey: "FK_9094eed77fb6e8f7ecf1502f5e0",
  },
  {
    table: "ScheduledMaintenanceInternalNote",
    foreignKey: "FK_7fb00788b6ac97988dd43e2e1b2",
  },
  {
    table: "ScheduledMaintenanceNoteTemplate",
    foreignKey: "FK_4c3d6b87bb1e8739cdeb8b92f74",
  },
  {
    table: "ScheduledMaintenanceOwnerTeam",
    foreignKey: "FK_52a3a932530026bafef87e62177",
  },
  {
    table: "ScheduledMaintenanceOwnerUser",
    foreignKey: "FK_6e6b087ba99fe433f83f87e0a35",
  },
  {
    table: "ScheduledMaintenancePublicNote",
    foreignKey: "FK_28e179283c409e0751aae713949",
  },
  {
    table: "ScheduledMaintenanceStateTimeline",
    foreignKey: "FK_aa84fcdf2fef6c2005ebab2c197",
  },
  { table: "ServiceOwnerTeam", foreignKey: "FK_f7afc098ab50af09b5264b87ed3" },
  { table: "ServiceOwnerUser", foreignKey: "FK_18d406f83326e42bda4873a58ac" },
  { table: "ShortLink", foreignKey: "FK_11f179cd8e9beee22b89c316972" },
  { table: "SmsLog", foreignKey: "FK_d00778bcfaa735fbb5dc91c1945" },
  { table: "WhatsAppLog", foreignKey: "FK_2f75dca0a039aa9384de646f759" },
  { table: "TelegramLog", foreignKey: "FK_dc36097ea0f6f4ba8e929f3e70a" },
  { table: "WebhookLog", foreignKey: "FK_41d96b5c3cb970753f81acd0142" },
  {
    table: "PushNotificationLog",
    foreignKey: "FK_e891a0077d446c86acee230959d",
  },
  {
    table: "WorkspaceNotificationLog",
    foreignKey: "FK_a99d29c3dfd37e7d2838436f702",
  },
  {
    table: "IncidentEpisodePublicNote",
    foreignKey: "FK_96d88a43c5479b67ddd7c70df16",
  },
  {
    table: "StatusPageAnnouncementTemplate",
    foreignKey: "FK_ced5ce354456a65d71e39cd8e7d",
  },
  {
    table: "StatusPageCustomField",
    foreignKey: "FK_26b4a892f3b31c5b0b285c4e5cb",
  },
  { table: "StatusPageDomain", foreignKey: "FK_6c82107f63d1a3186d579a6d9cb" },
  {
    table: "StatusPageFooterLink",
    foreignKey: "FK_0328201140b59b4b813f83b06a9",
  },
  { table: "StatusPageGroup", foreignKey: "FK_61191c9c00f7279615e13af4bbd" },
  {
    table: "StatusPageHeaderLink",
    foreignKey: "FK_0d3a63f1c684e78297b213c348e",
  },
  {
    table: "StatusPageHistoryChartBarColorRule",
    foreignKey: "FK_8041d41239c4218bf136bf20591",
  },
  {
    table: "StatusPageOwnerTeam",
    foreignKey: "FK_e992fcc346afa21a89ba9f75f25",
  },
  {
    table: "StatusPageOwnerUser",
    foreignKey: "FK_8d7351e844adfd5c279fd8e9f3b",
  },
  {
    table: "StatusPagePrivateUser",
    foreignKey: "FK_524d2e71f90ef8f78d85d5fdfd1",
  },
  {
    table: "StatusPageMonitorRule",
    foreignKey: "FK_3416ec12899c9dde670d8dea290",
  },
  { table: "StatusPageResource", foreignKey: "FK_d2b2f7ffe8f976fda20f4b96c5b" },
  { table: "StatusPageSCIM", foreignKey: "FK_2fded7c784a5c2f56ad2553cb80" },
  { table: "StatusPageSSO", foreignKey: "FK_0bfc26bce8ea92b8b8a9e0400de" },
  { table: "StatusPageOIDC", foreignKey: "FK_47054926e3844c88872599d5d55" },
  {
    table: "StatusPageSubscriber",
    foreignKey: "FK_35ad85d2f341ebfeaca7ad67af1",
  },
  {
    table: "StatusPageSubscriberNotificationTemplate",
    foreignKey: "FK_3816e7182ec941de644cd50f0c6",
  },
  {
    table: "StatusPageSubscriberNotificationTemplateStatusPage",
    foreignKey: "FK_4284edba6904c9f02ce7d85c445",
  },
  { table: "TeamCustomField", foreignKey: "FK_952539a5b3ad11840697481365c" },
  { table: "TeamMember", foreignKey: "FK_945ca87238e7465782215c25d8d" },
  {
    table: "TeamMemberCustomField",
    foreignKey: "FK_35409d7ec1b559d4de58913e522",
  },
  { table: "TeamCustomRole", foreignKey: "FK_9f3c28eb2f358d204b3fabdaa45" },
  { table: "TeamPermission", foreignKey: "FK_73a2d0db1de4e66582e376098de" },
  {
    table: "TeamComplianceSetting",
    foreignKey: "FK_380d3ad2f032b7a77956ef29095",
  },
  {
    table: "TelemetryUsageBilling",
    foreignKey: "FK_510252373d4e5917029308384fb",
  },
  {
    table: "UserNotificationSetting",
    foreignKey: "FK_b023f12dc00bcfc50d6d9ad4f71",
  },
  {
    table: "UserIncomingCallNumber",
    foreignKey: "FK_cab048905c4eb8f87aff75feaa7",
  },
  { table: "Workflow", foreignKey: "FK_367e2e759f520b31d727d22b803" },
  { table: "WorkflowLog", foreignKey: "FK_a4e2e2861f3ece2b7d6d5e399e2" },
  { table: "WorkflowVariable", foreignKey: "FK_3e414e10cb4927e233ffd32651c" },
  { table: "WorkflowOwnerTeam", foreignKey: "FK_6588722ba3dda9854e9ae0bd4f4" },
  { table: "WorkflowOwnerUser", foreignKey: "FK_045276dc23bdd65baeeda958cd0" },
  { table: "Runbook", foreignKey: "FK_ca61c9de42e8ae541e5dc7ab485" },
  { table: "RunbookExecution", foreignKey: "FK_5870f824eba8476cee1a480c327" },
  { table: "RunnerOwnerTeam", foreignKey: "FK_e1487fbd5600dd8f16488388341" },
  { table: "RunnerOwnerUser", foreignKey: "FK_002a65d1dc9c02c705979d8d8c2" },
  { table: "TeamOwnerTeam", foreignKey: "FK_61309b4736f744d844842b27c35" },
  { table: "TeamOwnerUser", foreignKey: "FK_93653d4ff0b783c9ff374d6bcef" },
  { table: "RunbookVariable", foreignKey: "FK_6bc1cbb3031621f088fbc475af9" },
  { table: "RunbookOwnerTeam", foreignKey: "FK_c64b244e1306f1ff5c80b2ad443" },
  { table: "RunbookOwnerUser", foreignKey: "FK_9ec2e96574697b30db0175792d9" },
  { table: "RunbookRule", foreignKey: "FK_444fbc9d451c96124c6e66116e4" },
  { table: "ExternalMcpServer", foreignKey: "FK_637751daf77fe2127e9b92f824b" },
  {
    table: "AutoRemediationRule",
    foreignKey: "FK_75cf58839e0a41f054da5b2f139",
  },
  {
    table: "AutoRemediationSuggestion",
    foreignKey: "FK_aeda2fc77a2d566d9da8ca089ff",
  },
  { table: "AIPostmortemRule", foreignKey: "FK_03f1a3c5cb6493bf12262e95b98" },
  { table: "UserTotpAuth", foreignKey: "FK_b30e0b2bc6a5ccab3f815fa6906" },
  {
    table: "UserTwoFactorBackupCode",
    foreignKey: "FK_b6f9bfb29ab554076a2d8dde717",
  },
  { table: "UserWebAuthn", foreignKey: "FK_e14966d27e4991f5f53ef54cad5" },
  {
    table: "TelemetryIngestionKey",
    foreignKey: "FK_2874c193beda1ef2e841cbbfba4",
  },
  {
    table: "TelemetryIngestionKeyRefusal",
    foreignKey: "FK_f903533fcd5a66149ad26ee64cf",
  },
  {
    table: "TelemetryIngestionTeamLabelBudget",
    foreignKey: "FK_b8de3015ef4dd31a09374dbef50",
  },
  { table: "TelemetryException", foreignKey: "FK_757f473e68b584bc42fcfbd9373" },
  {
    table: "TelemetryExceptionActivity",
    foreignKey: "FK_ac5772f0bf5fbe87e5f74663984",
  },
  { table: "TelemetrySourceMap", foreignKey: "FK_33c4d65e39e1fbd5e98cf117a45" },
  { table: "TelemetryDsym", foreignKey: "FK_6db5c1b4b180249d6194e1e0b3c" },
  {
    table: "InventoryItemCustomField",
    foreignKey: "FK_85f9a41e4ecf947560491917527",
  },
  {
    table: "InventoryItemRelationship",
    foreignKey: "FK_ecb3b77afca41cef653ab8e0e33",
  },
  {
    table: "ScheduledMaintenanceTemplate",
    foreignKey: "FK_ee916416bbbc5f73761cbee3d22",
  },
  {
    table: "ScheduledMaintenanceTemplateOwnerTeam",
    foreignKey: "FK_0c26675c50ec4624c10255a85c9",
  },
  {
    table: "ScheduledMaintenanceTemplateOwnerUser",
    foreignKey: "FK_64da70a3e70ddc728b6b15659ca",
  },
  { table: "AlertCustomField", foreignKey: "FK_8e723a6fa604c897191370f826f" },
  { table: "AlertStateTimeline", foreignKey: "FK_37d090181ab909ec9c07907eddc" },
  { table: "AlertInternalNote", foreignKey: "FK_6aaff72bf94da7e28c6d4a8f415" },
  { table: "AlertOwnerTeam", foreignKey: "FK_c43d8b8fde990031819baf85fb5" },
  { table: "AlertOwnerUser", foreignKey: "FK_bc0d78ab13b336f5dbe1e678009" },
  { table: "AlertNoteTemplate", foreignKey: "FK_d3be3bbe53d9fa76ca5cf12cc0f" },
  { table: "AlertFeed", foreignKey: "FK_f0e72673c38f18ed84f0e94a5a1" },
  { table: "AlertEpisodeMember", foreignKey: "FK_dea2569c6ecb31e997b82bc592e" },
  {
    table: "AlertEpisodeStateTimeline",
    foreignKey: "FK_19cd5959475f1459c24491d4634",
  },
  {
    table: "AlertEpisodeOwnerUser",
    foreignKey: "FK_917f125b25eabb6c5bab802d8fb",
  },
  {
    table: "AlertEpisodeOwnerTeam",
    foreignKey: "FK_47e5937c2b8988ae5f86c33a95a",
  },
  {
    table: "AlertEpisodeInternalNote",
    foreignKey: "FK_345f9ec2dba210d9d7360f26e2a",
  },
  { table: "AlertEpisodeFeed", foreignKey: "FK_e44b2c00fac4093980b1d747c39" },
  { table: "AlertOnCallRule", foreignKey: "FK_1f1fd464c9fc3223ea9fc70c63e" },
  {
    table: "AlertOnCallRuleOwningTeam",
    foreignKey: "FK_9d4dd58f916b7353e3e314da85f",
  },
  { table: "AlertIncidentRule", foreignKey: "FK_f524a5f7df716f6d0f91e0b217e" },
  { table: "AlertOwnerRule", foreignKey: "FK_06e80f78e314285647c7b470ba6" },
  { table: "AlertPrivacyRule", foreignKey: "FK_84b77456084fe3c36b647056a09" },
  { table: "AlertLabelRule", foreignKey: "FK_fe01c0ab41cfccc9f2d05fd79ba" },
  {
    table: "AlertEpisodeOnCallRule",
    foreignKey: "FK_370ee9ed19d6b22f114ace74182",
  },
  {
    table: "AlertEpisodeOnCallRuleOwningTeam",
    foreignKey: "FK_63effa9573d2a3596cf2e264732",
  },
  {
    table: "AlertEpisodeOwnerRule",
    foreignKey: "FK_244bdfd5a941ed1056ccdc01ebd",
  },
  {
    table: "AlertEpisodePrivacyRule",
    foreignKey: "FK_b6a94d2cdb67992b1fee23a1c6f",
  },
  {
    table: "AlertEpisodeLabelRule",
    foreignKey: "FK_32c04380aa74253882e1fc7cac0",
  },
  {
    table: "IncidentEpisodeMember",
    foreignKey: "FK_63e7e1419ed34d59471e09f8f6c",
  },
  { table: "IncidentAlert", foreignKey: "FK_572a63b76f7053f4fd28e666295" },
  {
    table: "IncidentEpisodeRoleMember",
    foreignKey: "FK_6dcab8328cd2f6856845cd5fcbe",
  },
  {
    table: "IncidentEpisodeStateTimeline",
    foreignKey: "FK_4ca3132a61efcbc119a4845b52d",
  },
  {
    table: "IncidentEpisodeOwnerUser",
    foreignKey: "FK_c0eadcf68801054e758fd893ab7",
  },
  {
    table: "IncidentEpisodeOwnerTeam",
    foreignKey: "FK_d848925b97dbdcf715cf32defb6",
  },
  {
    table: "IncidentEpisodeInternalNote",
    foreignKey: "FK_9dfc4d45a1976c7b1b792fb7e3b",
  },
  {
    table: "IncidentEpisodeFeed",
    foreignKey: "FK_59150523d62a43a1f19061c7c06",
  },
  { table: "IncidentOnCallRule", foreignKey: "FK_d467e48bf1bcbfb721dd2a93eba" },
  {
    table: "IncidentOnCallRuleOwningTeam",
    foreignKey: "FK_fa51347a4dc545203c254652358",
  },
  { table: "IncidentOwnerRule", foreignKey: "FK_9870a8adb67709c80174fc2aa5e" },
  {
    table: "IncidentOwnerRuleOwningTeam",
    foreignKey: "FK_3dcda6d829ccc2f7ce7afa36880",
  },
  {
    table: "IncidentPrivacyRule",
    foreignKey: "FK_e84fdea7af14190ce99db4127b6",
  },
  { table: "IncidentLabelRule", foreignKey: "FK_e185259bdb5621eda2fe8c5b5a8" },
  {
    table: "ScheduledMaintenanceOwnerRule",
    foreignKey: "FK_23fcf535a32d5a7052096e3716a",
  },
  {
    table: "ScheduledMaintenanceLabelRule",
    foreignKey: "FK_e6274cc26a01a5545f75a95ad6f",
  },
  {
    table: "IncidentEpisodeOnCallRule",
    foreignKey: "FK_291620246bb9e0b5bb7164da481",
  },
  {
    table: "IncidentEpisodeOnCallRuleOwningTeam",
    foreignKey: "FK_4a2d3af35ee38a5d9c5990051c2",
  },
  {
    table: "IncidentEpisodeOwnerRule",
    foreignKey: "FK_c42e4138898bfbce6666e60a263",
  },
  {
    table: "IncidentEpisodePrivacyRule",
    foreignKey: "FK_ab2d204a044ad51ddc51da818bf",
  },
  {
    table: "IncidentEpisodeLabelRule",
    foreignKey: "FK_950d6f2124429bdd63e45627d6a",
  },
  { table: "IncidentSlaRule", foreignKey: "FK_eb48fce1657c9a1e9245611857f" },
  {
    table: "IncidentMeasurement",
    foreignKey: "FK_5132d6cca9f27d19ef0b5862ca8",
  },
  { table: "AlertMeasurement", foreignKey: "FK_3ad10caaff5f7ad20e9d3b803e9" },
  {
    table: "ScheduledMaintenanceMeasurement",
    foreignKey: "FK_50572dc7759e681975be5888cd9",
  },
  { table: "IncidentSla", foreignKey: "FK_c1cadef60fde93931b5131fbbba" },
  {
    table: "ServiceLevelObjectiveBurnRateRule",
    foreignKey: "FK_e8c5423ee38943417d1b1153939",
  },
  {
    table: "ServiceLevelObjectiveErrorBudgetPolicyTier",
    foreignKey: "FK_112949fd350183e74779ee9619c",
  },
  {
    table: "ServiceLevelObjectiveOwnerUser",
    foreignKey: "FK_dec4db5a0248fb01d7950d78812",
  },
  {
    table: "ServiceLevelObjectiveOwnerTeam",
    foreignKey: "FK_6f988b69e435922b6d721fbd412",
  },
  {
    table: "ServiceLevelObjectiveMonitorRule",
    foreignKey: "FK_eb0531401161a4c0bef96c707d7",
  },
  {
    table: "ServiceLevelObjectiveFeed",
    foreignKey: "FK_1ada39b3bbe17bfbabdd0dc76e2",
  },
  {
    table: "ServiceLevelObjectiveOwnerRule",
    foreignKey: "FK_7a1bb4246c7029fb5eec8dfbc1c",
  },
  {
    table: "ServiceLevelObjectiveLabelRule",
    foreignKey: "FK_72ab545b8be48bcae655b1c83d2",
  },
  {
    table: "IncidentReminderRule",
    foreignKey: "FK_bda9ba3d3ad0d19aa5fa6cf81c7",
  },
  { table: "AlertReminderRule", foreignKey: "FK_e8e0b5c1e660e95d5977751dfba" },
  {
    table: "ScheduledMaintenanceReminderRule",
    foreignKey: "FK_1b79ca9eb4514e73dcdf27b6e9f",
  },
  {
    table: "PublicNoteApprovalStep",
    foreignKey: "FK_d17b19b1a45dfba8f9436a73208",
  },
  { table: "MonitorOwnerRule", foreignKey: "FK_ccccfaf700bd0cd58325aa336df" },
  { table: "MonitorLabelRule", foreignKey: "FK_37eabfde6982f76314740467bb1" },
  {
    table: "StatusPageOwnerRule",
    foreignKey: "FK_81dd3412c65361ac120b41f3452",
  },
  {
    table: "StatusPageLabelRule",
    foreignKey: "FK_98c467998c2183b72e3dd804b8f",
  },
  { table: "HostOwnerRule", foreignKey: "FK_2db1d1a338fd3147f62184eb1c1" },
  { table: "HostLabelRule", foreignKey: "FK_81217cc96df2e1491ff9acd39c3" },
  { table: "ServiceOwnerRule", foreignKey: "FK_b4898c18c90b8870a5a9fa645b6" },
  { table: "ServiceLabelRule", foreignKey: "FK_aaac69cf7c94b0ccb1bf73e7376" },
  {
    table: "DockerHostOwnerRule",
    foreignKey: "FK_676e5fbc60ab5ab52dc849f1dc6",
  },
  {
    table: "DockerHostLabelRule",
    foreignKey: "FK_011be34abf76530014ab3a2f0f1",
  },
  {
    table: "PodmanHostOwnerRule",
    foreignKey: "FK_2f1d57a0a6278c0c10dca051152",
  },
  {
    table: "PodmanHostLabelRule",
    foreignKey: "FK_53fcb8f37ffe0d9a33edec682c2",
  },
  {
    table: "KubernetesClusterOwnerRule",
    foreignKey: "FK_c38097838464fe522aae423b8fb",
  },
  {
    table: "KubernetesClusterLabelRule",
    foreignKey: "FK_91b9d26fb5388ac6db3be48bd6c",
  },
  {
    table: "ProxmoxClusterOwnerRule",
    foreignKey: "FK_dcdd2a2c789fdafe36c877b629b",
  },
  {
    table: "OpenStackCloudOwnerRule",
    foreignKey: "FK_8dcbdfec1dc78dd1eed0c675f8a",
  },
  {
    table: "DockerSwarmClusterOwnerRule",
    foreignKey: "FK_7e805f0febacc2caf7095d38d27",
  },
  {
    table: "ProxmoxClusterLabelRule",
    foreignKey: "FK_e4e7baa610b7616a93afe2c9401",
  },
  {
    table: "OpenStackCloudLabelRule",
    foreignKey: "FK_df55861b97cb75d5e151a0f374b",
  },
  {
    table: "DockerSwarmClusterLabelRule",
    foreignKey: "FK_8a0e7ea04b63d004707fb57a5d9",
  },
  { table: "IoTFleetOwnerRule", foreignKey: "FK_49fa74d67c3068757d076ed49bd" },
  { table: "IoTFleetLabelRule", foreignKey: "FK_f6e3d26ded484089e5efea3042b" },
  {
    table: "CephClusterOwnerRule",
    foreignKey: "FK_f8873726c7b8c24b7b86e61e719",
  },
  {
    table: "CephClusterLabelRule",
    foreignKey: "FK_d6069d9e4e6288a42e2ae591ab4",
  },
  {
    table: "StorageArrayOwnerRule",
    foreignKey: "FK_6450783fd34e22ee215b6a3efff",
  },
  {
    table: "StorageArrayLabelRule",
    foreignKey: "FK_0a68832a07aa0678dd40b4dbca9",
  },
  {
    table: "VMwareVCenterOwnerRule",
    foreignKey: "FK_df0a3a3826c13ed4a346544a901",
  },
  {
    table: "VMwareVCenterLabelRule",
    foreignKey: "FK_020e1c7fc7547a87b60554351f3",
  },
  { table: "RunbookOwnerRule", foreignKey: "FK_cc6d4030c1303b22802622dfd75" },
  { table: "RunbookLabelRule", foreignKey: "FK_dc16a29e697796e15011b88af9c" },
  { table: "WorkflowOwnerRule", foreignKey: "FK_6dacbb20e65a8a0377a30e083ba" },
  { table: "WorkflowLabelRule", foreignKey: "FK_ee907a85eff5856d4ad7e30bd46" },
  { table: "DashboardOwnerRule", foreignKey: "FK_3f73b652811cc2aa06817c3db0f" },
  { table: "DashboardLabelRule", foreignKey: "FK_386981e97b72208e1cff3bdcc81" },
  { table: "TableView", foreignKey: "FK_b36d769f3d3d6fe4f9c35984551" },
  { table: "Dashboard", foreignKey: "FK_0debc7bed011eac37da40e875cb" },
  { table: "DashboardDomain", foreignKey: "FK_de0c87b9c94b5dfeb21f1ce106f" },
  {
    table: "DashboardPrivateUser",
    foreignKey: "FK_fe2dc59a3b209044ab488643053",
  },
  { table: "DashboardSSO", foreignKey: "FK_0877e95c250b1d8a83f52d60541" },
  { table: "DashboardOIDC", foreignKey: "FK_97064c707d5b3d5fded0e561af1" },
  { table: "DashboardPlaylist", foreignKey: "FK_b71d2ee1178a987071c724bfec2" },
  { table: "DashboardOwnerTeam", foreignKey: "FK_49f6e71620ab5ab9cf138ae25a7" },
  { table: "DashboardOwnerUser", foreignKey: "FK_1ec547ff8399c042df80305cb10" },
  { table: "MonitorTest", foreignKey: "FK_b92a71b1f5f6c072455cd242ed6" },
  {
    table: "ScheduledMaintenanceFeed",
    foreignKey: "FK_8374052884c5d75f5018c1dc908",
  },
  {
    table: "WorkspaceUserAuthToken",
    foreignKey: "FK_1b2cb71eaf9e665e4556d1b1263",
  },
  {
    table: "WorkspaceProjectAuthToken",
    foreignKey: "FK_6287095997a16f1cbdd4fb24b61",
  },
  { table: "WorkspaceSetting", foreignKey: "FK_cb3b7931417a4b4ee05d487b614" },
  {
    table: "WorkspaceNotificationRule",
    foreignKey: "FK_65ac673d16286be2dcd5229fe24",
  },
  {
    table: "WorkspaceNotificationRuleOwningTeam",
    foreignKey: "FK_4a30e2c4288a11d8f1915b64deb",
  },
  {
    table: "VideoCallConnection",
    foreignKey: "FK_a2b100a33e23b2623a84298d055",
  },
  { table: "IncidentVideoCall", foreignKey: "FK_c1834725d7cc83babc81ec4ccaf" },
  { table: "AlertVideoCall", foreignKey: "FK_75e770dd8633dc95b98bf5e4217" },
  {
    table: "WorkspaceNotificationSummary",
    foreignKey: "FK_a9f1c0c0d88abf1795d1c93c138",
  },
  { table: "WorkspaceUserGroup", foreignKey: "FK_d90fa3858d451b66fcccf1eb3d8" },
  {
    table: "OnCallDutyPolicyUserOverride",
    foreignKey: "FK_810a8cd7f838a8e141fd750a9d5",
  },
  { table: "MonitorFeed", foreignKey: "FK_175252c1e94dbb49d7a8c921c21" },
  {
    table: "KubernetesClusterFeed",
    foreignKey: "FK_96955d2c6045e7614ea7e32d094",
  },
  { table: "DockerHostFeed", foreignKey: "FK_ea2fec5b67b4793012567f37e42" },
  {
    table: "DockerSwarmClusterFeed",
    foreignKey: "FK_03d94c48846fb0bc5a3c6fb2ce5",
  },
  { table: "CephClusterFeed", foreignKey: "FK_ffb8fc8339ba3f3f464dbe6fed9" },
  { table: "StorageArrayFeed", foreignKey: "FK_c8f59c3191463c05dd9097f0738" },
  { table: "PodmanHostFeed", foreignKey: "FK_97f590a072f99ab8701b61e137e" },
  { table: "ProxmoxClusterFeed", foreignKey: "FK_214df63ee38457195f1e909b4d7" },
  { table: "OpenStackCloudFeed", foreignKey: "FK_e490c35d53d1503ebac75e404ff" },
  { table: "VMwareVCenterFeed", foreignKey: "FK_2f5b4ee977f72fdc819935bebc5" },
  { table: "HostFeed", foreignKey: "FK_53868e9c522cc109a2f5e22f040" },
  { table: "CloudResourceFeed", foreignKey: "FK_1f9d0fef780f87f6de8c8025313" },
  { table: "ServiceFeed", foreignKey: "FK_73fcc4e6dfa23188f0668991916" },
  { table: "ServiceAINote", foreignKey: "FK_ffffcfaae1190276812ab8b8aa9" },
  { table: "MetricType", foreignKey: "FK_154d3b5c6f725d30753ef209666" },
  { table: "ProjectSCIM", foreignKey: "FK_9cadda4fc2af268b5670d02bf76" },
  { table: "ProjectSCIMLog", foreignKey: "FK_3a3dea844d9d75b76a2531294d2" },
  { table: "StatusPageSCIMLog", foreignKey: "FK_004a49a480f499f41c0afda2b01" },
  {
    table: "UserNotificationEmailRollupSetting",
    foreignKey: "FK_4f8b04650019cb0b9e4cee5f561",
  },
];

// One table's key and column, in one statement: its locks, for an instant.
export const getDropDeletedByUserStatement: (
  entry: DeletedByUserTable,
) => string = (entry: DeletedByUserTable): string => {
  return `ALTER TABLE "${entry.table}" ${[
    ...(entry.foreignKey
      ? [`DROP CONSTRAINT IF EXISTS "${entry.foreignKey}"`]
      : []),
    `DROP COLUMN IF EXISTS "${DELETED_BY_USER_ID_COLUMN}"`,
  ].join(", ")}`;
};

export class DropDeletedByUserColumns1809187480000
  implements MigrationInterface
{
  public name: string = "DropDeletedByUserColumns1809187480000";

  // One table and "User" locked at a time, each for its own statement. See above.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const remaining: Set<string> | null =
      await this.getTablesWithTheColumn(queryRunner);

    for (const entry of DELETED_BY_USER_TABLES) {
      if (remaining && !remaining.has(entry.table)) {
        continue;
      }

      await queryRunner.query(getDropDeletedByUserStatement(entry));
    }
  }

  /*
   * As the generator wrote it: every column, last table first, then every
   * key - a nullable column, and a key to "User" that sets it to null.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables: Array<DeletedByUserTable> = [
      ...DELETED_BY_USER_TABLES,
    ].reverse();

    for (const entry of tables) {
      await queryRunner.query(
        `ALTER TABLE "${entry.table}" ADD "${DELETED_BY_USER_ID_COLUMN}" uuid`,
      );
    }

    for (const entry of tables) {
      if (entry.foreignKey) {
        await queryRunner.query(
          `ALTER TABLE "${entry.table}" ADD CONSTRAINT "${entry.foreignKey}" FOREIGN KEY ("${DELETED_BY_USER_ID_COLUMN}") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
      }
    }
  }

  /*
   * The tables that still have the column: a run before this one that
   * stopped part way dropped it from the others. Null from a runner that
   * answers nothing - one that records the statements a migration makes, as
   * the migration tests run every migration that alters a table - and then
   * every table is given its statement.
   */
  private async getTablesWithTheColumn(
    queryRunner: QueryRunner,
  ): Promise<Set<string> | null> {
    const rows: unknown = await queryRunner.query(
      `SELECT "table_name" FROM "information_schema"."columns" WHERE "table_schema" = current_schema() AND "column_name" = $1`,
      [DELETED_BY_USER_ID_COLUMN],
    );

    if (!Array.isArray(rows)) {
      return null;
    }

    return new Set<string>(
      rows.map((row: { table_name: string }): string => {
        return row.table_name;
      }),
    );
  }
}
