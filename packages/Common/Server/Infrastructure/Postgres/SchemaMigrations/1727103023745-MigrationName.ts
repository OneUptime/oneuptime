import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1727103023745 implements MigrationInterface {
  public name = "MigrationName1727103023745";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT "FK_644c3c0393979f57f71892ff0d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeCertificate" DROP CONSTRAINT "FK_130a8fd12e7505eebfce670b198"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeChallenge" DROP CONSTRAINT "FK_71371b224feb48f1d60e847cf1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" DROP CONSTRAINT "FK_fe790bb94630d701a8ad93287ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" DROP CONSTRAINT "FK_952b3ed48545aaf18033150dc66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" DROP CONSTRAINT "FK_34cdc5e0500513f321f0da35a64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" DROP CONSTRAINT "FK_e756416e4b0983e158f71c47c1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_639312a8ef82cbd5cee77c5b1ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_43989dee7f7af742f6d8ec2664a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" DROP CONSTRAINT "FK_891c55549057af9a0c90c925ebb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" DROP CONSTRAINT "FK_bcbc7d80fb0cfe2cbb5ae7db791"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP CONSTRAINT "FK_84520cbda97d2a9cb9da7ccb18c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP CONSTRAINT "FK_f46caf81c5fd7664ba8da9c99ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_dc8eb846ffbceafbc9c60bbfaa5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_ac42ef4597147c260e89a0f3d3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP CONSTRAINT "FK_15b8130f5378f2079ed5b2fe7d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP CONSTRAINT "FK_0a0a1a9865d157e46b1ecf14873"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" DROP CONSTRAINT "FK_55c3c9a9fc28000262b811cebc8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" DROP CONSTRAINT "FK_93a1554cb316127896f66acddd3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_3e510124d923fe3b994936a7cb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_681f7e53081da05fd0aefcad93f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_c2629643d12e4b8739b8e257310"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_b96813e25e4fecf035232c9a3df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" DROP CONSTRAINT "FK_1619179d46a4411e1bb4af5d342"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" DROP CONSTRAINT "FK_183a8261590c30a27a1b51f4bdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" DROP CONSTRAINT "FK_12e6ebc5c806263d562045e9282"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" DROP CONSTRAINT "FK_9ace4c275b42c057b7581543ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP CONSTRAINT "FK_3b7ed2d3bd1a2ee9638cccef5b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP CONSTRAINT "FK_d5458705e98b89c08c0d960422e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_6d0739da601917d316494fcae3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" DROP CONSTRAINT "FK_9e86ebfdbef16789e9571f22074"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" DROP CONSTRAINT "FK_895b9b802ed002a3804136bacf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" DROP CONSTRAINT "FK_7517f5a285255f031b0f6d9663c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP CONSTRAINT "FK_2677e0a9dbf97ba0f4a7849eac6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP CONSTRAINT "FK_d0d87151a7872a44c3d2457bfdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP CONSTRAINT "FK_eb33bd015e0e57ee96b60f8d773"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP CONSTRAINT "FK_88a0ecd4b1714ac0e2eef9ac27d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP CONSTRAINT "FK_bdda7fecdf44ed43ef2004e7be5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP CONSTRAINT "FK_55a0e488581a0d02bcdd67a4348"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_a84bbba0dbad47918136d4dfb43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_73bdf22259019b90836aac86b28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_c0c63ac58f97fd254bb5c2813dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_0424b49cfcd68cdd1721df53acd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP CONSTRAINT "FK_1963e116be9832b23490cca933f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP CONSTRAINT "FK_272ece82a96099041b93c9141e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_9b101f023b5db6491203d5c9951"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_067855888a3d71803d3a5aeaecf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_7e537806a80e869917ca1d7e2e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP CONSTRAINT "FK_5c1c7369e696f580186a4ff12de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP CONSTRAINT "FK_bc64c76e766b1b880845afbcbf7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP CONSTRAINT "FK_c798e09321f06d8a180916d7a5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP CONSTRAINT "FK_8f23b820cbbed6d96cfedd162a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" DROP CONSTRAINT "FK_515b6970fdd528d4c9f85a5e9a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" DROP CONSTRAINT "FK_3c00f2b005264318a274cd38a94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" DROP CONSTRAINT "FK_4be4aa023ba1c6d6443b81b3b91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" DROP CONSTRAINT "FK_0d4912bf03a7a645ce95142155b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" DROP CONSTRAINT "FK_278f483fc81c21b1bd1311ee289"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" DROP CONSTRAINT "FK_60242ecfcecaa5cb1c5241bed4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" DROP CONSTRAINT "FK_52591665c92658ef82944d63d26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" DROP CONSTRAINT "FK_c473db8745d0ebeb147a72986cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_691a99e582fcddcc892d8573afc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_cf04d778a5502be606f63e01603"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP CONSTRAINT "FK_16d198b59f3416a8ddc630a90d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP CONSTRAINT "FK_6b6b9dbf9ca5448c9297a58ad04"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP CONSTRAINT "FK_b03e46665e4c075ed1398fcc409"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP CONSTRAINT "FK_0e6a4e065ffb22f95ecfc259e9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP CONSTRAINT "FK_3e8a4bd1594da3438d8fb8a6687"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP CONSTRAINT "FK_af037dc245d77c282061fea1b1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP CONSTRAINT "FK_a53f8aab99766a87c73c52b9037"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP CONSTRAINT "FK_026e918a31de467eeb8e30ae8d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP CONSTRAINT "FK_93a4da4182f93ba24ab958c1b73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP CONSTRAINT "FK_817e69522c8d2f1e2fd3f857e91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" DROP CONSTRAINT "FK_abaf236c1877143fe160991cc45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" DROP CONSTRAINT "FK_edd658b85b2ef7ac9b2f0687d8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" DROP CONSTRAINT "FK_7ce36c144e83082213587e19c23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" DROP CONSTRAINT "FK_fdbe93e29e60763a306358cab55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" DROP CONSTRAINT "FK_9267db147738caed0ccfdc3af22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" DROP CONSTRAINT "FK_e9bced91dce29928ebeec834905"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" DROP CONSTRAINT "FK_cf595b683e26e560526404663fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" DROP CONSTRAINT "FK_1a54eaa2d0187d10de84107a09b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" DROP CONSTRAINT "FK_58610249ec4cf593e36210dcb84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" DROP CONSTRAINT "FK_7ebfe3ddcf597fb73ee8eac2ff4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" DROP CONSTRAINT "FK_e2cf60b88171dfe5fdd0e4fe6c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" DROP CONSTRAINT "FK_e1ae2c698e6bde0a98c50162235"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" DROP CONSTRAINT "FK_4399ab64a5c00d55e5ce254deeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" DROP CONSTRAINT "FK_a182ba062c0a216395d0dbdbdee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP CONSTRAINT "FK_a886cd3bbdfd84d01167f92cb65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP CONSTRAINT "FK_e4262f178662aaacdb54d4c4f4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_d7f555ef162fe878e4ed62a3e23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_d293a7e96c5bf427072514f21a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP CONSTRAINT "FK_456bff32fd0428134ef7396385f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP CONSTRAINT "FK_43230e739b31e3f56284407b586"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" DROP CONSTRAINT "FK_ad8097a9359965d02ccbb16358b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" DROP CONSTRAINT "FK_5c0911d261a941b00d41b6e5fda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_ecb5141b27e85674c294a2541b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_01e63400072d0bc6debee836cbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" DROP CONSTRAINT "FK_90700af75cbe8129db898ac8adb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" DROP CONSTRAINT "FK_878e14be4e6366ec646f874347a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" DROP CONSTRAINT "FK_da2e065de293a14b69964fb3233"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" DROP CONSTRAINT "FK_73ae2b2702aef4601c39d4d909a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" DROP CONSTRAINT "FK_f9a45cea88022a9cf5b96c13e65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" DROP CONSTRAINT "FK_d35f668f524cc88f580a7651fe2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_16b426d34ff2c5cbd6ecfd70820"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_e9302e15399b67938e0121a0545"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_43f833a79cf4201b3fa1deed023"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_166f3696b3c70989507dd7e1f2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_1db1083a896b0f77a0e87f26463"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_f22b52355207d2c0d5a13c168e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" DROP CONSTRAINT "FK_b2ccbfcc3964caf3dfd89243f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" DROP CONSTRAINT "FK_49e5a41e1d771fe9e385295bd9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_e72250699a438e22153d9c32ea3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_011c2a132409253ceb1234695c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_248df6f39557f114b03dd815bcf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT "FK_e873aa20a371bd92e220332a992"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT "FK_f5bc0e2b81886b21004e2a5f67b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP CONSTRAINT "FK_28011315533e2d819295d261ee4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP CONSTRAINT "FK_00ea9e456217ffbfff35f1e944f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" DROP CONSTRAINT "FK_90e44f45272c0da256951183086"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" DROP CONSTRAINT "FK_3169f7934171e8f697bb993b010"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP CONSTRAINT "FK_88044fd50006f1897e8c760d136"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP CONSTRAINT "FK_4f803428e0926584d1f7c44a3d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_da54bb2c4997ee1a3b73026d7f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_71f429afb7678d132472b3c87b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP CONSTRAINT "FK_5442fd86c96d45e062d5ee1f093"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP CONSTRAINT "FK_50ddf8bb21e988ea5d419a66cb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP CONSTRAINT "FK_c7cdb245d3d98be14482f092eca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP CONSTRAINT "FK_9094eed77fb6e8f7ecf1502f5e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP CONSTRAINT "FK_69757967d2ee696f487fb8ac37e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP CONSTRAINT "FK_7fb00788b6ac97988dd43e2e1b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" DROP CONSTRAINT "FK_e38c1102001ae0b70c22e046424"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" DROP CONSTRAINT "FK_4c3d6b87bb1e8739cdeb8b92f74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" DROP CONSTRAINT "FK_cc0e8ca9e9065ca0cc24bf6275b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" DROP CONSTRAINT "FK_52a3a932530026bafef87e62177"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" DROP CONSTRAINT "FK_c91d4d420e3faaf15fa928fd214"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" DROP CONSTRAINT "FK_6e6b087ba99fe433f83f87e0a35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_1f67cfb63bd3488b7c5c5b7fac7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_28e179283c409e0751aae713949"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP CONSTRAINT "FK_2392299477cfc4f612ecb73e839"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP CONSTRAINT "FK_aa84fcdf2fef6c2005ebab2c197"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_9afb156569266f66a2301eb09ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_d61607e823057b6516f05e8f1cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ShortLink" DROP CONSTRAINT "FK_11f179cd8e9beee22b89c316972"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_d00778bcfaa735fbb5dc91c1945"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP CONSTRAINT "FK_1491bd0895d515969eee2a08c80"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP CONSTRAINT "FK_7251cbbaa75eb9570830b0cab32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP CONSTRAINT "FK_e0abd7540f860de19607dc25bc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP CONSTRAINT "FK_26b4a892f3b31c5b0b285c4e5cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP CONSTRAINT "FK_106e359f945432d6583bd30ff4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP CONSTRAINT "FK_6c82107f63d1a3186d579a6d9cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" DROP CONSTRAINT "FK_bd6f15ab951095e624ea664d9a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" DROP CONSTRAINT "FK_0328201140b59b4b813f83b06a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP CONSTRAINT "FK_0a63a8ee804658921edf1e870af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP CONSTRAINT "FK_61191c9c00f7279615e13af4bbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP CONSTRAINT "FK_88048566089097605e26fdb2893"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP CONSTRAINT "FK_0d3a63f1c684e78297b213c348e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" DROP CONSTRAINT "FK_5d973aa991ba9f06b642d3fc9d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" DROP CONSTRAINT "FK_8041d41239c4218bf136bf20591"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" DROP CONSTRAINT "FK_7c1168daf53c46678045ff39d31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" DROP CONSTRAINT "FK_e992fcc346afa21a89ba9f75f25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" DROP CONSTRAINT "FK_4ecb38fa1941bb0961641803f21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" DROP CONSTRAINT "FK_8d7351e844adfd5c279fd8e9f3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP CONSTRAINT "FK_e47c85ead36095d040493775a3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP CONSTRAINT "FK_524d2e71f90ef8f78d85d5fdfd1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP CONSTRAINT "FK_51e0fbc6d460394b1cd38959790"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP CONSTRAINT "FK_d2b2f7ffe8f976fda20f4b96c5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP CONSTRAINT "FK_8e2cbcf07eba956fe976ca3d043"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP CONSTRAINT "FK_0bfc26bce8ea92b8b8a9e0400de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP CONSTRAINT "FK_61cecfd27c2d41eb58330df1d8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP CONSTRAINT "FK_35ad85d2f341ebfeaca7ad67af1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP CONSTRAINT "FK_a9e764a6ad587e6e386abe3b9de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP CONSTRAINT "FK_945ca87238e7465782215c25d8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_e2c33d5f98cb42f8c1f76a85095"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_73a2d0db1de4e66582e376098de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" DROP CONSTRAINT "FK_5d0b92dc9ab2bfd71432e9a3536"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" DROP CONSTRAINT "FK_46ea9e637b4454993665a436d56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_d71562eb0c2861797502bd99917"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_510252373d4e5917029308384fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP CONSTRAINT "FK_1b46d8793ef542c059369481d42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP CONSTRAINT "FK_996ab46825df7f3512e735c450c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP CONSTRAINT "FK_06413c119aae9c3f75154c2346c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP CONSTRAINT "FK_a1aa5e10dcfb571521324bbd665"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP CONSTRAINT "FK_99fc3cdf366fd3d266fbf2d657c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP CONSTRAINT "FK_0bae98162ec44540ff85f724daa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_85b73b64802058915df58fa013b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_b1292f2480d0c4985898d7bf33a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "FK_aee7abeffd1c60d49f710fb3749"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "FK_b023f12dc00bcfc50d6d9ad4f71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_91488d7d3341bf1113902f4786c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_ac31bad932e24418ce0bb1bbb14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_03d67a4d7fa9f087327ab0f74a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a93a41d65df4cbe518393695084"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_13c42a014f8c10862f23d02eb49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_367e2e759f520b31d727d22b803"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_a4e2e2861f3ece2b7d6d5e399e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP CONSTRAINT "FK_92fbc4d230accb3d12c098ca4d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP CONSTRAINT "FK_3e414e10cb4927e233ffd32651c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_e8e03c07999471753b9f6093a67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" DROP CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_757f473e68b584bc42fcfbd9373"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_039fd3af73a2c910eee5ed67669"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_01864ec4b8b5f343e484a09128a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_f4c80315f60dcc694fd21777787"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_b49e225394926114327cc3ad7ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_0c26675c50ec4624c10255a85c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_644c3c0393979f57f71892ff0d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeCertificate" ADD CONSTRAINT "FK_130a8fd12e7505eebfce670b198" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeChallenge" ADD CONSTRAINT "FK_71371b224feb48f1d60e847cf1b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" ADD CONSTRAINT "FK_fe790bb94630d701a8ad93287ce" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" ADD CONSTRAINT "FK_952b3ed48545aaf18033150dc66" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" ADD CONSTRAINT "FK_34cdc5e0500513f321f0da35a64" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" ADD CONSTRAINT "FK_e756416e4b0983e158f71c47c1a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_639312a8ef82cbd5cee77c5b1ba" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_43989dee7f7af742f6d8ec2664a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ADD CONSTRAINT "FK_891c55549057af9a0c90c925ebb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ADD CONSTRAINT "FK_bcbc7d80fb0cfe2cbb5ae7db791" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD CONSTRAINT "FK_84520cbda97d2a9cb9da7ccb18c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD CONSTRAINT "FK_f46caf81c5fd7664ba8da9c99ba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_dc8eb846ffbceafbc9c60bbfaa5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_ac42ef4597147c260e89a0f3d3a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD CONSTRAINT "FK_15b8130f5378f2079ed5b2fe7d1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD CONSTRAINT "FK_0a0a1a9865d157e46b1ecf14873" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" ADD CONSTRAINT "FK_55c3c9a9fc28000262b811cebc8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" ADD CONSTRAINT "FK_93a1554cb316127896f66acddd3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_3e510124d923fe3b994936a7cb5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_681f7e53081da05fd0aefcad93f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_c2629643d12e4b8739b8e257310" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_b96813e25e4fecf035232c9a3df" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" ADD CONSTRAINT "FK_1619179d46a4411e1bb4af5d342" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" ADD CONSTRAINT "FK_183a8261590c30a27a1b51f4bdb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" ADD CONSTRAINT "FK_12e6ebc5c806263d562045e9282" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" ADD CONSTRAINT "FK_9ace4c275b42c057b7581543ce3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD CONSTRAINT "FK_3b7ed2d3bd1a2ee9638cccef5b0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD CONSTRAINT "FK_d5458705e98b89c08c0d960422e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_6d0739da601917d316494fcae3b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "FK_9e86ebfdbef16789e9571f22074" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" ADD CONSTRAINT "FK_895b9b802ed002a3804136bacf1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" ADD CONSTRAINT "FK_7517f5a285255f031b0f6d9663c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD CONSTRAINT "FK_2677e0a9dbf97ba0f4a7849eac6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD CONSTRAINT "FK_d0d87151a7872a44c3d2457bfdc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD CONSTRAINT "FK_eb33bd015e0e57ee96b60f8d773" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD CONSTRAINT "FK_88a0ecd4b1714ac0e2eef9ac27d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD CONSTRAINT "FK_bdda7fecdf44ed43ef2004e7be5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD CONSTRAINT "FK_55a0e488581a0d02bcdd67a4348" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_a84bbba0dbad47918136d4dfb43" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_73bdf22259019b90836aac86b28" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_c0c63ac58f97fd254bb5c2813dc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_0424b49cfcd68cdd1721df53acd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_1963e116be9832b23490cca933f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_272ece82a96099041b93c9141e3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_9b101f023b5db6491203d5c9951" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_067855888a3d71803d3a5aeaecf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_7e537806a80e869917ca1d7e2e4" FOREIGN KEY ("createdByProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD CONSTRAINT "FK_5c1c7369e696f580186a4ff12de" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD CONSTRAINT "FK_bc64c76e766b1b880845afbcbf7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD CONSTRAINT "FK_c798e09321f06d8a180916d7a5e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD CONSTRAINT "FK_8f23b820cbbed6d96cfedd162a2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" ADD CONSTRAINT "FK_515b6970fdd528d4c9f85a5e9a4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" ADD CONSTRAINT "FK_3c00f2b005264318a274cd38a94" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" ADD CONSTRAINT "FK_4be4aa023ba1c6d6443b81b3b91" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" ADD CONSTRAINT "FK_0d4912bf03a7a645ce95142155b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" ADD CONSTRAINT "FK_278f483fc81c21b1bd1311ee289" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" ADD CONSTRAINT "FK_60242ecfcecaa5cb1c5241bed4c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" ADD CONSTRAINT "FK_52591665c92658ef82944d63d26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" ADD CONSTRAINT "FK_c473db8745d0ebeb147a72986cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_691a99e582fcddcc892d8573afc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_cf04d778a5502be606f63e01603" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD CONSTRAINT "FK_16d198b59f3416a8ddc630a90d2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD CONSTRAINT "FK_6b6b9dbf9ca5448c9297a58ad04" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "FK_b03e46665e4c075ed1398fcc409" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "FK_0e6a4e065ffb22f95ecfc259e9a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD CONSTRAINT "FK_3e8a4bd1594da3438d8fb8a6687" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD CONSTRAINT "FK_af037dc245d77c282061fea1b1b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD CONSTRAINT "FK_a53f8aab99766a87c73c52b9037" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD CONSTRAINT "FK_026e918a31de467eeb8e30ae8d1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD CONSTRAINT "FK_93a4da4182f93ba24ab958c1b73" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD CONSTRAINT "FK_817e69522c8d2f1e2fd3f857e91" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" ADD CONSTRAINT "FK_abaf236c1877143fe160991cc45" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" ADD CONSTRAINT "FK_edd658b85b2ef7ac9b2f0687d8a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" ADD CONSTRAINT "FK_7ce36c144e83082213587e19c23" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" ADD CONSTRAINT "FK_fdbe93e29e60763a306358cab55" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" ADD CONSTRAINT "FK_9267db147738caed0ccfdc3af22" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" ADD CONSTRAINT "FK_e9bced91dce29928ebeec834905" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" ADD CONSTRAINT "FK_cf595b683e26e560526404663fe" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" ADD CONSTRAINT "FK_1a54eaa2d0187d10de84107a09b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" ADD CONSTRAINT "FK_58610249ec4cf593e36210dcb84" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" ADD CONSTRAINT "FK_7ebfe3ddcf597fb73ee8eac2ff4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" ADD CONSTRAINT "FK_e2cf60b88171dfe5fdd0e4fe6c1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" ADD CONSTRAINT "FK_e1ae2c698e6bde0a98c50162235" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" ADD CONSTRAINT "FK_4399ab64a5c00d55e5ce254deeb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" ADD CONSTRAINT "FK_a182ba062c0a216395d0dbdbdee" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD CONSTRAINT "FK_a886cd3bbdfd84d01167f92cb65" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD CONSTRAINT "FK_e4262f178662aaacdb54d4c4f4e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_d7f555ef162fe878e4ed62a3e23" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_d293a7e96c5bf427072514f21a9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD CONSTRAINT "FK_456bff32fd0428134ef7396385f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD CONSTRAINT "FK_43230e739b31e3f56284407b586" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" ADD CONSTRAINT "FK_ad8097a9359965d02ccbb16358b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" ADD CONSTRAINT "FK_5c0911d261a941b00d41b6e5fda" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_ecb5141b27e85674c294a2541b3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_01e63400072d0bc6debee836cbf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ADD CONSTRAINT "FK_90700af75cbe8129db898ac8adb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ADD CONSTRAINT "FK_878e14be4e6366ec646f874347a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" ADD CONSTRAINT "FK_da2e065de293a14b69964fb3233" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" ADD CONSTRAINT "FK_73ae2b2702aef4601c39d4d909a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" ADD CONSTRAINT "FK_f9a45cea88022a9cf5b96c13e65" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" ADD CONSTRAINT "FK_d35f668f524cc88f580a7651fe2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_16b426d34ff2c5cbd6ecfd70820" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_e9302e15399b67938e0121a0545" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_43f833a79cf4201b3fa1deed023" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_166f3696b3c70989507dd7e1f2e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_1db1083a896b0f77a0e87f26463" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_f22b52355207d2c0d5a13c168e8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" ADD CONSTRAINT "FK_b2ccbfcc3964caf3dfd89243f8f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" ADD CONSTRAINT "FK_49e5a41e1d771fe9e385295bd9a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_e72250699a438e22153d9c32ea3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_011c2a132409253ceb1234695c6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_248df6f39557f114b03dd815bcf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "FK_e873aa20a371bd92e220332a992" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "FK_f5bc0e2b81886b21004e2a5f67b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD CONSTRAINT "FK_28011315533e2d819295d261ee4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD CONSTRAINT "FK_00ea9e456217ffbfff35f1e944f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" ADD CONSTRAINT "FK_90e44f45272c0da256951183086" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" ADD CONSTRAINT "FK_3169f7934171e8f697bb993b010" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD CONSTRAINT "FK_88044fd50006f1897e8c760d136" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD CONSTRAINT "FK_4f803428e0926584d1f7c44a3d4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_da54bb2c4997ee1a3b73026d7f5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_71f429afb7678d132472b3c87b0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD CONSTRAINT "FK_5442fd86c96d45e062d5ee1f093" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD CONSTRAINT "FK_50ddf8bb21e988ea5d419a66cb9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD CONSTRAINT "FK_c7cdb245d3d98be14482f092eca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD CONSTRAINT "FK_9094eed77fb6e8f7ecf1502f5e0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD CONSTRAINT "FK_69757967d2ee696f487fb8ac37e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD CONSTRAINT "FK_7fb00788b6ac97988dd43e2e1b2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" ADD CONSTRAINT "FK_e38c1102001ae0b70c22e046424" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" ADD CONSTRAINT "FK_4c3d6b87bb1e8739cdeb8b92f74" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" ADD CONSTRAINT "FK_cc0e8ca9e9065ca0cc24bf6275b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" ADD CONSTRAINT "FK_52a3a932530026bafef87e62177" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" ADD CONSTRAINT "FK_c91d4d420e3faaf15fa928fd214" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" ADD CONSTRAINT "FK_6e6b087ba99fe433f83f87e0a35" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_1f67cfb63bd3488b7c5c5b7fac7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_28e179283c409e0751aae713949" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD CONSTRAINT "FK_2392299477cfc4f612ecb73e839" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD CONSTRAINT "FK_aa84fcdf2fef6c2005ebab2c197" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_9afb156569266f66a2301eb09ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_d61607e823057b6516f05e8f1cd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ShortLink" ADD CONSTRAINT "FK_11f179cd8e9beee22b89c316972" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_d00778bcfaa735fbb5dc91c1945" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "FK_1491bd0895d515969eee2a08c80" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "FK_7251cbbaa75eb9570830b0cab32" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD CONSTRAINT "FK_e0abd7540f860de19607dc25bc0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD CONSTRAINT "FK_26b4a892f3b31c5b0b285c4e5cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD CONSTRAINT "FK_106e359f945432d6583bd30ff4b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD CONSTRAINT "FK_6c82107f63d1a3186d579a6d9cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" ADD CONSTRAINT "FK_bd6f15ab951095e624ea664d9a6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" ADD CONSTRAINT "FK_0328201140b59b4b813f83b06a9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD CONSTRAINT "FK_0a63a8ee804658921edf1e870af" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD CONSTRAINT "FK_61191c9c00f7279615e13af4bbd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD CONSTRAINT "FK_88048566089097605e26fdb2893" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD CONSTRAINT "FK_0d3a63f1c684e78297b213c348e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" ADD CONSTRAINT "FK_5d973aa991ba9f06b642d3fc9d7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" ADD CONSTRAINT "FK_8041d41239c4218bf136bf20591" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" ADD CONSTRAINT "FK_7c1168daf53c46678045ff39d31" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" ADD CONSTRAINT "FK_e992fcc346afa21a89ba9f75f25" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" ADD CONSTRAINT "FK_4ecb38fa1941bb0961641803f21" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" ADD CONSTRAINT "FK_8d7351e844adfd5c279fd8e9f3b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD CONSTRAINT "FK_e47c85ead36095d040493775a3f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD CONSTRAINT "FK_524d2e71f90ef8f78d85d5fdfd1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD CONSTRAINT "FK_51e0fbc6d460394b1cd38959790" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD CONSTRAINT "FK_d2b2f7ffe8f976fda20f4b96c5b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD CONSTRAINT "FK_8e2cbcf07eba956fe976ca3d043" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD CONSTRAINT "FK_0bfc26bce8ea92b8b8a9e0400de" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "FK_61cecfd27c2d41eb58330df1d8c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "FK_35ad85d2f341ebfeaca7ad67af1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD CONSTRAINT "FK_a9e764a6ad587e6e386abe3b9de" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD CONSTRAINT "FK_945ca87238e7465782215c25d8d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_e2c33d5f98cb42f8c1f76a85095" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_73a2d0db1de4e66582e376098de" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" ADD CONSTRAINT "FK_5d0b92dc9ab2bfd71432e9a3536" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" ADD CONSTRAINT "FK_46ea9e637b4454993665a436d56" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_d71562eb0c2861797502bd99917" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_510252373d4e5917029308384fb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD CONSTRAINT "FK_1b46d8793ef542c059369481d42" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD CONSTRAINT "FK_996ab46825df7f3512e735c450c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD CONSTRAINT "FK_06413c119aae9c3f75154c2346c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD CONSTRAINT "FK_a1aa5e10dcfb571521324bbd665" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD CONSTRAINT "FK_99fc3cdf366fd3d266fbf2d657c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD CONSTRAINT "FK_0bae98162ec44540ff85f724daa" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_85b73b64802058915df58fa013b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_b1292f2480d0c4985898d7bf33a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "FK_aee7abeffd1c60d49f710fb3749" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "FK_b023f12dc00bcfc50d6d9ad4f71" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_91488d7d3341bf1113902f4786c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_ac31bad932e24418ce0bb1bbb14" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_03d67a4d7fa9f087327ab0f74a7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a93a41d65df4cbe518393695084" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_13c42a014f8c10862f23d02eb49" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_367e2e759f520b31d727d22b803" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_a4e2e2861f3ece2b7d6d5e399e2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD CONSTRAINT "FK_92fbc4d230accb3d12c098ca4d2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD CONSTRAINT "FK_3e414e10cb4927e233ffd32651c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_e8e03c07999471753b9f6093a67" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" ADD CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_757f473e68b584bc42fcfbd9373" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_039fd3af73a2c910eee5ed67669" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_01864ec4b8b5f343e484a09128a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_f4c80315f60dcc694fd21777787" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_b49e225394926114327cc3ad7ca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_0c26675c50ec4624c10255a85c9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" DROP CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_0c26675c50ec4624c10255a85c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" DROP CONSTRAINT "FK_b49e225394926114327cc3ad7ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_f4c80315f60dcc694fd21777787"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_01864ec4b8b5f343e484a09128a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" DROP CONSTRAINT "FK_039fd3af73a2c910eee5ed67669"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_757f473e68b584bc42fcfbd9373"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" DROP CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" DROP CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" DROP CONSTRAINT "FK_e8e03c07999471753b9f6093a67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP CONSTRAINT "FK_3e414e10cb4927e233ffd32651c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP CONSTRAINT "FK_92fbc4d230accb3d12c098ca4d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_a4e2e2861f3ece2b7d6d5e399e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_367e2e759f520b31d727d22b803"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_13c42a014f8c10862f23d02eb49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a93a41d65df4cbe518393695084"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_03d67a4d7fa9f087327ab0f74a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_ac31bad932e24418ce0bb1bbb14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_91488d7d3341bf1113902f4786c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "FK_b023f12dc00bcfc50d6d9ad4f71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "FK_aee7abeffd1c60d49f710fb3749"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_b1292f2480d0c4985898d7bf33a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_85b73b64802058915df58fa013b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP CONSTRAINT "FK_0bae98162ec44540ff85f724daa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP CONSTRAINT "FK_99fc3cdf366fd3d266fbf2d657c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP CONSTRAINT "FK_a1aa5e10dcfb571521324bbd665"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP CONSTRAINT "FK_06413c119aae9c3f75154c2346c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP CONSTRAINT "FK_996ab46825df7f3512e735c450c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP CONSTRAINT "FK_1b46d8793ef542c059369481d42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_510252373d4e5917029308384fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_d71562eb0c2861797502bd99917"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" DROP CONSTRAINT "FK_46ea9e637b4454993665a436d56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" DROP CONSTRAINT "FK_5d0b92dc9ab2bfd71432e9a3536"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_73a2d0db1de4e66582e376098de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP CONSTRAINT "FK_e2c33d5f98cb42f8c1f76a85095"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP CONSTRAINT "FK_945ca87238e7465782215c25d8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP CONSTRAINT "FK_a9e764a6ad587e6e386abe3b9de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP CONSTRAINT "FK_35ad85d2f341ebfeaca7ad67af1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP CONSTRAINT "FK_61cecfd27c2d41eb58330df1d8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP CONSTRAINT "FK_0bfc26bce8ea92b8b8a9e0400de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP CONSTRAINT "FK_8e2cbcf07eba956fe976ca3d043"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP CONSTRAINT "FK_d2b2f7ffe8f976fda20f4b96c5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP CONSTRAINT "FK_51e0fbc6d460394b1cd38959790"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP CONSTRAINT "FK_524d2e71f90ef8f78d85d5fdfd1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP CONSTRAINT "FK_e47c85ead36095d040493775a3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" DROP CONSTRAINT "FK_8d7351e844adfd5c279fd8e9f3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" DROP CONSTRAINT "FK_4ecb38fa1941bb0961641803f21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" DROP CONSTRAINT "FK_e992fcc346afa21a89ba9f75f25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" DROP CONSTRAINT "FK_7c1168daf53c46678045ff39d31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" DROP CONSTRAINT "FK_8041d41239c4218bf136bf20591"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" DROP CONSTRAINT "FK_5d973aa991ba9f06b642d3fc9d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP CONSTRAINT "FK_0d3a63f1c684e78297b213c348e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" DROP CONSTRAINT "FK_88048566089097605e26fdb2893"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP CONSTRAINT "FK_61191c9c00f7279615e13af4bbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP CONSTRAINT "FK_0a63a8ee804658921edf1e870af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" DROP CONSTRAINT "FK_0328201140b59b4b813f83b06a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" DROP CONSTRAINT "FK_bd6f15ab951095e624ea664d9a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP CONSTRAINT "FK_6c82107f63d1a3186d579a6d9cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP CONSTRAINT "FK_106e359f945432d6583bd30ff4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP CONSTRAINT "FK_26b4a892f3b31c5b0b285c4e5cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP CONSTRAINT "FK_e0abd7540f860de19607dc25bc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP CONSTRAINT "FK_7251cbbaa75eb9570830b0cab32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP CONSTRAINT "FK_1491bd0895d515969eee2a08c80"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_d00778bcfaa735fbb5dc91c1945"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ShortLink" DROP CONSTRAINT "FK_11f179cd8e9beee22b89c316972"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_d61607e823057b6516f05e8f1cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_9afb156569266f66a2301eb09ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP CONSTRAINT "FK_aa84fcdf2fef6c2005ebab2c197"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP CONSTRAINT "FK_2392299477cfc4f612ecb73e839"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_28e179283c409e0751aae713949"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_1f67cfb63bd3488b7c5c5b7fac7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" DROP CONSTRAINT "FK_6e6b087ba99fe433f83f87e0a35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" DROP CONSTRAINT "FK_c91d4d420e3faaf15fa928fd214"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" DROP CONSTRAINT "FK_52a3a932530026bafef87e62177"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" DROP CONSTRAINT "FK_cc0e8ca9e9065ca0cc24bf6275b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" DROP CONSTRAINT "FK_4c3d6b87bb1e8739cdeb8b92f74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" DROP CONSTRAINT "FK_e38c1102001ae0b70c22e046424"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP CONSTRAINT "FK_7fb00788b6ac97988dd43e2e1b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP CONSTRAINT "FK_69757967d2ee696f487fb8ac37e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP CONSTRAINT "FK_9094eed77fb6e8f7ecf1502f5e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP CONSTRAINT "FK_c7cdb245d3d98be14482f092eca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP CONSTRAINT "FK_50ddf8bb21e988ea5d419a66cb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP CONSTRAINT "FK_5442fd86c96d45e062d5ee1f093"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_71f429afb7678d132472b3c87b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP CONSTRAINT "FK_da54bb2c4997ee1a3b73026d7f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP CONSTRAINT "FK_4f803428e0926584d1f7c44a3d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP CONSTRAINT "FK_88044fd50006f1897e8c760d136"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" DROP CONSTRAINT "FK_3169f7934171e8f697bb993b010"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" DROP CONSTRAINT "FK_90e44f45272c0da256951183086"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP CONSTRAINT "FK_00ea9e456217ffbfff35f1e944f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP CONSTRAINT "FK_28011315533e2d819295d261ee4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT "FK_f5bc0e2b81886b21004e2a5f67b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT "FK_e873aa20a371bd92e220332a992"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_248df6f39557f114b03dd815bcf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" DROP CONSTRAINT "FK_011c2a132409253ceb1234695c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_e72250699a438e22153d9c32ea3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" DROP CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" DROP CONSTRAINT "FK_49e5a41e1d771fe9e385295bd9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" DROP CONSTRAINT "FK_b2ccbfcc3964caf3dfd89243f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_f22b52355207d2c0d5a13c168e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_1db1083a896b0f77a0e87f26463"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_166f3696b3c70989507dd7e1f2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_43f833a79cf4201b3fa1deed023"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_e9302e15399b67938e0121a0545"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_16b426d34ff2c5cbd6ecfd70820"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" DROP CONSTRAINT "FK_d35f668f524cc88f580a7651fe2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" DROP CONSTRAINT "FK_f9a45cea88022a9cf5b96c13e65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" DROP CONSTRAINT "FK_73ae2b2702aef4601c39d4d909a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" DROP CONSTRAINT "FK_da2e065de293a14b69964fb3233"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" DROP CONSTRAINT "FK_878e14be4e6366ec646f874347a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" DROP CONSTRAINT "FK_90700af75cbe8129db898ac8adb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_01e63400072d0bc6debee836cbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_ecb5141b27e85674c294a2541b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" DROP CONSTRAINT "FK_5c0911d261a941b00d41b6e5fda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" DROP CONSTRAINT "FK_ad8097a9359965d02ccbb16358b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP CONSTRAINT "FK_43230e739b31e3f56284407b586"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP CONSTRAINT "FK_456bff32fd0428134ef7396385f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_d293a7e96c5bf427072514f21a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" DROP CONSTRAINT "FK_d7f555ef162fe878e4ed62a3e23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP CONSTRAINT "FK_e4262f178662aaacdb54d4c4f4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP CONSTRAINT "FK_a886cd3bbdfd84d01167f92cb65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" DROP CONSTRAINT "FK_a182ba062c0a216395d0dbdbdee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" DROP CONSTRAINT "FK_4399ab64a5c00d55e5ce254deeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" DROP CONSTRAINT "FK_e1ae2c698e6bde0a98c50162235"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" DROP CONSTRAINT "FK_e2cf60b88171dfe5fdd0e4fe6c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" DROP CONSTRAINT "FK_7ebfe3ddcf597fb73ee8eac2ff4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" DROP CONSTRAINT "FK_58610249ec4cf593e36210dcb84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" DROP CONSTRAINT "FK_1a54eaa2d0187d10de84107a09b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" DROP CONSTRAINT "FK_cf595b683e26e560526404663fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" DROP CONSTRAINT "FK_e9bced91dce29928ebeec834905"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" DROP CONSTRAINT "FK_9267db147738caed0ccfdc3af22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" DROP CONSTRAINT "FK_fdbe93e29e60763a306358cab55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" DROP CONSTRAINT "FK_7ce36c144e83082213587e19c23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" DROP CONSTRAINT "FK_edd658b85b2ef7ac9b2f0687d8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" DROP CONSTRAINT "FK_abaf236c1877143fe160991cc45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP CONSTRAINT "FK_817e69522c8d2f1e2fd3f857e91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP CONSTRAINT "FK_93a4da4182f93ba24ab958c1b73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP CONSTRAINT "FK_026e918a31de467eeb8e30ae8d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP CONSTRAINT "FK_a53f8aab99766a87c73c52b9037"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP CONSTRAINT "FK_af037dc245d77c282061fea1b1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP CONSTRAINT "FK_3e8a4bd1594da3438d8fb8a6687"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP CONSTRAINT "FK_0e6a4e065ffb22f95ecfc259e9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP CONSTRAINT "FK_b03e46665e4c075ed1398fcc409"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP CONSTRAINT "FK_6b6b9dbf9ca5448c9297a58ad04"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP CONSTRAINT "FK_16d198b59f3416a8ddc630a90d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_cf04d778a5502be606f63e01603"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_691a99e582fcddcc892d8573afc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" DROP CONSTRAINT "FK_c473db8745d0ebeb147a72986cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" DROP CONSTRAINT "FK_52591665c92658ef82944d63d26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" DROP CONSTRAINT "FK_60242ecfcecaa5cb1c5241bed4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" DROP CONSTRAINT "FK_278f483fc81c21b1bd1311ee289"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" DROP CONSTRAINT "FK_0d4912bf03a7a645ce95142155b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" DROP CONSTRAINT "FK_4be4aa023ba1c6d6443b81b3b91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" DROP CONSTRAINT "FK_3c00f2b005264318a274cd38a94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" DROP CONSTRAINT "FK_515b6970fdd528d4c9f85a5e9a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP CONSTRAINT "FK_8f23b820cbbed6d96cfedd162a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP CONSTRAINT "FK_c798e09321f06d8a180916d7a5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP CONSTRAINT "FK_bc64c76e766b1b880845afbcbf7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP CONSTRAINT "FK_5c1c7369e696f580186a4ff12de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_7e537806a80e869917ca1d7e2e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_067855888a3d71803d3a5aeaecf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_9b101f023b5db6491203d5c9951"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP CONSTRAINT "FK_272ece82a96099041b93c9141e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP CONSTRAINT "FK_1963e116be9832b23490cca933f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_0424b49cfcd68cdd1721df53acd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "FK_c0c63ac58f97fd254bb5c2813dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_73bdf22259019b90836aac86b28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_a84bbba0dbad47918136d4dfb43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP CONSTRAINT "FK_55a0e488581a0d02bcdd67a4348"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP CONSTRAINT "FK_bdda7fecdf44ed43ef2004e7be5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP CONSTRAINT "FK_88a0ecd4b1714ac0e2eef9ac27d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP CONSTRAINT "FK_eb33bd015e0e57ee96b60f8d773"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP CONSTRAINT "FK_d0d87151a7872a44c3d2457bfdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP CONSTRAINT "FK_2677e0a9dbf97ba0f4a7849eac6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" DROP CONSTRAINT "FK_7517f5a285255f031b0f6d9663c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" DROP CONSTRAINT "FK_895b9b802ed002a3804136bacf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" DROP CONSTRAINT "FK_9e86ebfdbef16789e9571f22074"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_6d0739da601917d316494fcae3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP CONSTRAINT "FK_d5458705e98b89c08c0d960422e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" DROP CONSTRAINT "FK_3b7ed2d3bd1a2ee9638cccef5b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" DROP CONSTRAINT "FK_9ace4c275b42c057b7581543ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" DROP CONSTRAINT "FK_12e6ebc5c806263d562045e9282"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" DROP CONSTRAINT "FK_183a8261590c30a27a1b51f4bdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" DROP CONSTRAINT "FK_1619179d46a4411e1bb4af5d342"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_b96813e25e4fecf035232c9a3df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" DROP CONSTRAINT "FK_c2629643d12e4b8739b8e257310"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_681f7e53081da05fd0aefcad93f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_3e510124d923fe3b994936a7cb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" DROP CONSTRAINT "FK_93a1554cb316127896f66acddd3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" DROP CONSTRAINT "FK_55c3c9a9fc28000262b811cebc8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP CONSTRAINT "FK_0a0a1a9865d157e46b1ecf14873"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP CONSTRAINT "FK_15b8130f5378f2079ed5b2fe7d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_ac42ef4597147c260e89a0f3d3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP CONSTRAINT "FK_dc8eb846ffbceafbc9c60bbfaa5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP CONSTRAINT "FK_f46caf81c5fd7664ba8da9c99ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP CONSTRAINT "FK_84520cbda97d2a9cb9da7ccb18c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" DROP CONSTRAINT "FK_bcbc7d80fb0cfe2cbb5ae7db791"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" DROP CONSTRAINT "FK_891c55549057af9a0c90c925ebb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_43989dee7f7af742f6d8ec2664a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_639312a8ef82cbd5cee77c5b1ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" DROP CONSTRAINT "FK_e756416e4b0983e158f71c47c1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" DROP CONSTRAINT "FK_34cdc5e0500513f321f0da35a64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" DROP CONSTRAINT "FK_952b3ed48545aaf18033150dc66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" DROP CONSTRAINT "FK_fe790bb94630d701a8ad93287ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeChallenge" DROP CONSTRAINT "FK_71371b224feb48f1d60e847cf1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeCertificate" DROP CONSTRAINT "FK_130a8fd12e7505eebfce670b198"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT "FK_644c3c0393979f57f71892ff0d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_64da70a3e70ddc728b6b15659ca" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerUser" ADD CONSTRAINT "FK_1c3750c2c2128cf912fa580a45f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_0c26675c50ec4624c10255a85c9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateOwnerTeam" ADD CONSTRAINT "FK_b49e225394926114327cc3ad7ca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_ee916416bbbc5f73761cbee3d22" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_f4c80315f60dcc694fd21777787" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_01864ec4b8b5f343e484a09128a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotActionTypePriority" ADD CONSTRAINT "FK_039fd3af73a2c910eee5ed67669" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_757f473e68b584bc42fcfbd9373" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_d2e1b4f5dcaebbf14ed6cbd303d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_2874c193beda1ef2e841cbbfba4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD CONSTRAINT "FK_3f05c2120ab58bbd23883a7bc26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" ADD CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_b0419b3b36e6606a404eb97a98a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogTelemetryService" ADD CONSTRAINT "FK_64a7908ff27c562a2d7f5532e2a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_1783ec2972d9cbf2f91fced5be3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogMonitor" ADD CONSTRAINT "FK_e8e03c07999471753b9f6093a67" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD CONSTRAINT "FK_3e414e10cb4927e233ffd32651c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD CONSTRAINT "FK_92fbc4d230accb3d12c098ca4d2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_a4e2e2861f3ece2b7d6d5e399e2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_367e2e759f520b31d727d22b803" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_13c42a014f8c10862f23d02eb49" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a93a41d65df4cbe518393695084" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_03d67a4d7fa9f087327ab0f74a7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_ac31bad932e24418ce0bb1bbb14" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_91488d7d3341bf1113902f4786c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "FK_b023f12dc00bcfc50d6d9ad4f71" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "FK_aee7abeffd1c60d49f710fb3749" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_b1292f2480d0c4985898d7bf33a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_85b73b64802058915df58fa013b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD CONSTRAINT "FK_0bae98162ec44540ff85f724daa" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD CONSTRAINT "FK_99fc3cdf366fd3d266fbf2d657c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD CONSTRAINT "FK_a1aa5e10dcfb571521324bbd665" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD CONSTRAINT "FK_06413c119aae9c3f75154c2346c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD CONSTRAINT "FK_996ab46825df7f3512e735c450c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD CONSTRAINT "FK_1b46d8793ef542c059369481d42" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_510252373d4e5917029308384fb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_d71562eb0c2861797502bd99917" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" ADD CONSTRAINT "FK_46ea9e637b4454993665a436d56" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryService" ADD CONSTRAINT "FK_5d0b92dc9ab2bfd71432e9a3536" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_73a2d0db1de4e66582e376098de" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_e2c33d5f98cb42f8c1f76a85095" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD CONSTRAINT "FK_945ca87238e7465782215c25d8d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD CONSTRAINT "FK_a9e764a6ad587e6e386abe3b9de" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "FK_35ad85d2f341ebfeaca7ad67af1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "FK_61cecfd27c2d41eb58330df1d8c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD CONSTRAINT "FK_0bfc26bce8ea92b8b8a9e0400de" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD CONSTRAINT "FK_8e2cbcf07eba956fe976ca3d043" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD CONSTRAINT "FK_d2b2f7ffe8f976fda20f4b96c5b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD CONSTRAINT "FK_51e0fbc6d460394b1cd38959790" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD CONSTRAINT "FK_524d2e71f90ef8f78d85d5fdfd1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD CONSTRAINT "FK_e47c85ead36095d040493775a3f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" ADD CONSTRAINT "FK_8d7351e844adfd5c279fd8e9f3b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerUser" ADD CONSTRAINT "FK_4ecb38fa1941bb0961641803f21" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" ADD CONSTRAINT "FK_e992fcc346afa21a89ba9f75f25" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerTeam" ADD CONSTRAINT "FK_7c1168daf53c46678045ff39d31" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" ADD CONSTRAINT "FK_8041d41239c4218bf136bf20591" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHistoryChartBarColorRule" ADD CONSTRAINT "FK_5d973aa991ba9f06b642d3fc9d7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD CONSTRAINT "FK_0d3a63f1c684e78297b213c348e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageHeaderLink" ADD CONSTRAINT "FK_88048566089097605e26fdb2893" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD CONSTRAINT "FK_61191c9c00f7279615e13af4bbd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD CONSTRAINT "FK_0a63a8ee804658921edf1e870af" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" ADD CONSTRAINT "FK_0328201140b59b4b813f83b06a9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageFooterLink" ADD CONSTRAINT "FK_bd6f15ab951095e624ea664d9a6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD CONSTRAINT "FK_6c82107f63d1a3186d579a6d9cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD CONSTRAINT "FK_106e359f945432d6583bd30ff4b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD CONSTRAINT "FK_26b4a892f3b31c5b0b285c4e5cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD CONSTRAINT "FK_e0abd7540f860de19607dc25bc0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "FK_7251cbbaa75eb9570830b0cab32" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "FK_1491bd0895d515969eee2a08c80" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_d00778bcfaa735fbb5dc91c1945" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ShortLink" ADD CONSTRAINT "FK_11f179cd8e9beee22b89c316972" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_d61607e823057b6516f05e8f1cd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_9afb156569266f66a2301eb09ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD CONSTRAINT "FK_aa84fcdf2fef6c2005ebab2c197" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD CONSTRAINT "FK_2392299477cfc4f612ecb73e839" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_28e179283c409e0751aae713949" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_1f67cfb63bd3488b7c5c5b7fac7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" ADD CONSTRAINT "FK_6e6b087ba99fe433f83f87e0a35" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerUser" ADD CONSTRAINT "FK_c91d4d420e3faaf15fa928fd214" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" ADD CONSTRAINT "FK_52a3a932530026bafef87e62177" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerTeam" ADD CONSTRAINT "FK_cc0e8ca9e9065ca0cc24bf6275b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" ADD CONSTRAINT "FK_4c3d6b87bb1e8739cdeb8b92f74" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNoteTemplate" ADD CONSTRAINT "FK_e38c1102001ae0b70c22e046424" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD CONSTRAINT "FK_7fb00788b6ac97988dd43e2e1b2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD CONSTRAINT "FK_69757967d2ee696f487fb8ac37e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD CONSTRAINT "FK_9094eed77fb6e8f7ecf1502f5e0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD CONSTRAINT "FK_c7cdb245d3d98be14482f092eca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD CONSTRAINT "FK_50ddf8bb21e988ea5d419a66cb9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD CONSTRAINT "FK_5442fd86c96d45e062d5ee1f093" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_71f429afb7678d132472b3c87b0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD CONSTRAINT "FK_da54bb2c4997ee1a3b73026d7f5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD CONSTRAINT "FK_4f803428e0926584d1f7c44a3d4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD CONSTRAINT "FK_88044fd50006f1897e8c760d136" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" ADD CONSTRAINT "FK_3169f7934171e8f697bb993b010" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PromoCode" ADD CONSTRAINT "FK_90e44f45272c0da256951183086" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD CONSTRAINT "FK_00ea9e456217ffbfff35f1e944f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD CONSTRAINT "FK_28011315533e2d819295d261ee4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "FK_f5bc0e2b81886b21004e2a5f67b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "FK_e873aa20a371bd92e220332a992" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_248df6f39557f114b03dd815bcf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerUser" ADD CONSTRAINT "FK_011c2a132409253ceb1234695c6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_e72250699a438e22153d9c32ea3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProbeOwnerTeam" ADD CONSTRAINT "FK_5f7e1a1dfc8380824e10d83f124" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" ADD CONSTRAINT "FK_49e5a41e1d771fe9e385295bd9a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayerUser" ADD CONSTRAINT "FK_b2ccbfcc3964caf3dfd89243f8f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_f22b52355207d2c0d5a13c168e8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_1db1083a896b0f77a0e87f26463" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_166f3696b3c70989507dd7e1f2e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_43f833a79cf4201b3fa1deed023" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_e9302e15399b67938e0121a0545" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_16b426d34ff2c5cbd6ecfd70820" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" ADD CONSTRAINT "FK_d35f668f524cc88f580a7651fe2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleUser" ADD CONSTRAINT "FK_f9a45cea88022a9cf5b96c13e65" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" ADD CONSTRAINT "FK_73ae2b2702aef4601c39d4d909a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleTeam" ADD CONSTRAINT "FK_da2e065de293a14b69964fb3233" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ADD CONSTRAINT "FK_878e14be4e6366ec646f874347a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ADD CONSTRAINT "FK_90700af75cbe8129db898ac8adb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_01e63400072d0bc6debee836cbf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_ecb5141b27e85674c294a2541b3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" ADD CONSTRAINT "FK_5c0911d261a941b00d41b6e5fda" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRule" ADD CONSTRAINT "FK_ad8097a9359965d02ccbb16358b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD CONSTRAINT "FK_43230e739b31e3f56284407b586" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD CONSTRAINT "FK_456bff32fd0428134ef7396385f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_d293a7e96c5bf427072514f21a9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatusTimeline" ADD CONSTRAINT "FK_d7f555ef162fe878e4ed62a3e23" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD CONSTRAINT "FK_e4262f178662aaacdb54d4c4f4e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD CONSTRAINT "FK_a886cd3bbdfd84d01167f92cb65" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" ADD CONSTRAINT "FK_a182ba062c0a216395d0dbdbdee" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorProbe" ADD CONSTRAINT "FK_4399ab64a5c00d55e5ce254deeb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" ADD CONSTRAINT "FK_e1ae2c698e6bde0a98c50162235" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerUser" ADD CONSTRAINT "FK_e2cf60b88171dfe5fdd0e4fe6c1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" ADD CONSTRAINT "FK_7ebfe3ddcf597fb73ee8eac2ff4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerTeam" ADD CONSTRAINT "FK_58610249ec4cf593e36210dcb84" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" ADD CONSTRAINT "FK_1a54eaa2d0187d10de84107a09b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupResource" ADD CONSTRAINT "FK_cf595b683e26e560526404663fe" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" ADD CONSTRAINT "FK_e9bced91dce29928ebeec834905" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerUser" ADD CONSTRAINT "FK_9267db147738caed0ccfdc3af22" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" ADD CONSTRAINT "FK_fdbe93e29e60763a306358cab55" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroupOwnerTeam" ADD CONSTRAINT "FK_7ce36c144e83082213587e19c23" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" ADD CONSTRAINT "FK_edd658b85b2ef7ac9b2f0687d8a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorGroup" ADD CONSTRAINT "FK_abaf236c1877143fe160991cc45" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD CONSTRAINT "FK_817e69522c8d2f1e2fd3f857e91" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD CONSTRAINT "FK_93a4da4182f93ba24ab958c1b73" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD CONSTRAINT "FK_026e918a31de467eeb8e30ae8d1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD CONSTRAINT "FK_a53f8aab99766a87c73c52b9037" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD CONSTRAINT "FK_af037dc245d77c282061fea1b1b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD CONSTRAINT "FK_3e8a4bd1594da3438d8fb8a6687" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "FK_0e6a4e065ffb22f95ecfc259e9a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "FK_b03e46665e4c075ed1398fcc409" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD CONSTRAINT "FK_6b6b9dbf9ca5448c9297a58ad04" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD CONSTRAINT "FK_16d198b59f3416a8ddc630a90d2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_cf04d778a5502be606f63e01603" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_691a99e582fcddcc892d8573afc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" ADD CONSTRAINT "FK_c473db8745d0ebeb147a72986cb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerUser" ADD CONSTRAINT "FK_52591665c92658ef82944d63d26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" ADD CONSTRAINT "FK_60242ecfcecaa5cb1c5241bed4c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerTeam" ADD CONSTRAINT "FK_278f483fc81c21b1bd1311ee289" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" ADD CONSTRAINT "FK_0d4912bf03a7a645ce95142155b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Team" ADD CONSTRAINT "FK_4be4aa023ba1c6d6443b81b3b91" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" ADD CONSTRAINT "FK_3c00f2b005264318a274cd38a94" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNoteTemplate" ADD CONSTRAINT "FK_515b6970fdd528d4c9f85a5e9a4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD CONSTRAINT "FK_8f23b820cbbed6d96cfedd162a2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD CONSTRAINT "FK_c798e09321f06d8a180916d7a5e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD CONSTRAINT "FK_bc64c76e766b1b880845afbcbf7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD CONSTRAINT "FK_5c1c7369e696f580186a4ff12de" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_7e537806a80e869917ca1d7e2e4" FOREIGN KEY ("createdByProbeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_067855888a3d71803d3a5aeaecf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_9b101f023b5db6491203d5c9951" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_272ece82a96099041b93c9141e3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD CONSTRAINT "FK_1963e116be9832b23490cca933f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_0424b49cfcd68cdd1721df53acd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "FK_c0c63ac58f97fd254bb5c2813dc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_73bdf22259019b90836aac86b28" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_a84bbba0dbad47918136d4dfb43" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD CONSTRAINT "FK_55a0e488581a0d02bcdd67a4348" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD CONSTRAINT "FK_bdda7fecdf44ed43ef2004e7be5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD CONSTRAINT "FK_88a0ecd4b1714ac0e2eef9ac27d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD CONSTRAINT "FK_eb33bd015e0e57ee96b60f8d773" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD CONSTRAINT "FK_d0d87151a7872a44c3d2457bfdc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD CONSTRAINT "FK_2677e0a9dbf97ba0f4a7849eac6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" ADD CONSTRAINT "FK_7517f5a285255f031b0f6d9663c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" ADD CONSTRAINT "FK_895b9b802ed002a3804136bacf1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "FK_9e86ebfdbef16789e9571f22074" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_6d0739da601917d316494fcae3b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD CONSTRAINT "FK_d5458705e98b89c08c0d960422e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ADD CONSTRAINT "FK_3b7ed2d3bd1a2ee9638cccef5b0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" ADD CONSTRAINT "FK_9ace4c275b42c057b7581543ce3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Domain" ADD CONSTRAINT "FK_12e6ebc5c806263d562045e9282" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" ADD CONSTRAINT "FK_183a8261590c30a27a1b51f4bdb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataMigrations" ADD CONSTRAINT "FK_1619179d46a4411e1bb4af5d342" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_0bc946cbe9cc8977246816bd3c6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_b96813e25e4fecf035232c9a3df" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_dc1390d4eb1d065de0c760c964a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCopilotCodeRepository" ADD CONSTRAINT "FK_c2629643d12e4b8739b8e257310" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_681f7e53081da05fd0aefcad93f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD CONSTRAINT "FK_ab1b484839c4c9ed25150d248ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_3e510124d923fe3b994936a7cb5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" ADD CONSTRAINT "FK_93a1554cb316127896f66acddd3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" ADD CONSTRAINT "FK_55c3c9a9fc28000262b811cebc8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD CONSTRAINT "FK_0a0a1a9865d157e46b1ecf14873" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD CONSTRAINT "FK_15b8130f5378f2079ed5b2fe7d1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_ac42ef4597147c260e89a0f3d3a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" ADD CONSTRAINT "FK_dc8eb846ffbceafbc9c60bbfaa5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD CONSTRAINT "FK_f46caf81c5fd7664ba8da9c99ba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD CONSTRAINT "FK_84520cbda97d2a9cb9da7ccb18c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ADD CONSTRAINT "FK_bcbc7d80fb0cfe2cbb5ae7db791" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ADD CONSTRAINT "FK_891c55549057af9a0c90c925ebb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_43989dee7f7af742f6d8ec2664a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_639312a8ef82cbd5cee77c5b1ba" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" ADD CONSTRAINT "FK_e756416e4b0983e158f71c47c1a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResellerPlan" ADD CONSTRAINT "FK_34cdc5e0500513f321f0da35a64" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" ADD CONSTRAINT "FK_952b3ed48545aaf18033150dc66" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Reseller" ADD CONSTRAINT "FK_fe790bb94630d701a8ad93287ce" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeChallenge" ADD CONSTRAINT "FK_71371b224feb48f1d60e847cf1b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AcmeCertificate" ADD CONSTRAINT "FK_130a8fd12e7505eebfce670b198" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_644c3c0393979f57f71892ff0d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
