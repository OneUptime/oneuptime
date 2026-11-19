import { JSONObject } from "../../../../Types/JSON";

/*
 * Esper's answers, built from the shapes its API reference documents
 * (api.esper.io, read November 2026) - not from memory:
 *
 *   device_AndroidDeviceV2      GET /v2/devices/ results: id, name, alias,
 *                               os, state, platform, serial, os_version,
 *                               group_id, provisioned_on, tags,
 *                               hardware_info, software_info (with Esper's
 *                               own spelling, security_path_level),
 *                               network_info, memory_info, network_stats,
 *                               location_stats, memory_stats,
 *                               battery_stats, app_mode_meta, dpc_version,
 *                               created_at, updated_at...
 *   device_EsperDeviceHeartbeat GET /v2/heartbeat/ results, and the content
 *                               of GET /device/v0/heartbeat/{id}/:
 *                               device_id, timestamp, status (the legacy
 *                               30-minute flag)
 *   DeviceGroup                 GET /enterprise/{eid}/devicegroup/ results:
 *                               id, name, created_on, enterprise (a URL),
 *                               parent (a URL), device_count, path,
 *                               children_count
 *   DeviceApp                   GET /enterprise/{eid}/device/{id}/app/
 *                               results: id, app_name, state, app_type,
 *                               package_name, whitelisted, version_code,
 *                               version_name, is_kiosk_app,
 *                               is_esper_controlled, device...
 *   user_info                   GET /user_info/: id, username, email,
 *                               profile.enterprise, profile.role...
 *
 * Every value is invented. The tenant is "acme", the enterprise a UUID
 * that names nothing.
 */

export const ESPER_TENANT: string = "acme";
export const ESPER_ENTERPRISE_ID: string =
  "796caaf9-a7de-4817-9ffa-39d04bf83de9";

export interface EsperDeviceFixture {
  id: string;
  name: string;
  alias?: string | undefined;
  serial?: string | undefined;
  state?: number | undefined;
  groupId?: string | undefined;
  model?: string | undefined;
  manufacturer?: string | undefined;
  osVersion?: string | undefined;
  buildNumber?: string | undefined;
  securityPatchLevel?: string | undefined;
  isKiosk?: boolean | undefined;
  batteryLevel?: number | undefined;
  ipAddresses?: Array<string> | undefined;
  wifiMac?: string | undefined;
  imei?: string | undefined;
  platform?: string | undefined;
  provisionedOn?: string | undefined;
}

// A device as GET /v2/devices/ answers it (device_AndroidDeviceV2).
export function buildEsperDevice(fixture: EsperDeviceFixture): JSONObject {
  const isKiosk: boolean = fixture.isKiosk !== false;

  return {
    timezone_string: "America/Chicago",
    id: fixture.id,
    name: fixture.name,
    alias: fixture.alias ?? "",
    os: "Android",
    state: fixture.state ?? 1,
    platform: fixture.platform ?? "ANDROID",
    serial: fixture.serial ?? "",
    os_version: fixture.osVersion ?? "13",
    global_device_id: `GID-${fixture.id.substring(0, 8)}`,
    tenant_id: "5a0b6f4e-1111-4c4c-8888-222233334444",
    group_id: fixture.groupId ?? null,
    provisioned_on: fixture.provisionedOn ?? "2026-03-02T15:04:05Z",
    tags: ["0f8d2a10-2b1c-4e5f-9a7b-6c5d4e3f2a1b"],
    hardware_info: {
      brand: "Elo",
      model: fixture.model ?? "I-Series 4",
      model_number: "E390263",
      serial: fixture.serial ?? "",
      manufacturer: fixture.manufacturer ?? "Elo Touch Solutions",
      hardware: "qcom",
      device_baseband_version: "",
    },
    software_info: {
      os_version: fixture.osVersion ?? "13",
      os_build_number: fixture.buildNumber ?? "TKQ1.221114.001",
      bootloader_version: "unknown",
      // Esper's own spelling, as its schema writes it.
      security_path_level: fixture.securityPatchLevel ?? "2024-09-01",
      device_kernel_version: "5.4.210-qgki",
      eea_version: null,
      esper_agent_info: {
        version_code: "800764",
        version_name: "8.00.0764",
      },
      foundation_info: null,
      airwave_info: null,
    },
    network_info: {
      imei1: fixture.imei ?? "",
      imei2: "",
      wifi_mac_address: fixture.wifiMac ?? "a4:c1:38:00:12:7f",
      ethernet_mac_address: "",
      iccid1: "",
      iccid2: "",
      phone_number_1: "",
      phone_number_2: "",
      network_type: "WI-FI",
    },
    memory_info: {
      total_ram: "3.6",
      total_internal_storage: "32",
      units: "GB",
      internal_storage_binary_prefix: "GiB",
    },
    network_stats: {
      current_active_connection: "WI-FI",
      wifi_network_info: { wifi_ssid: "store-kiosks", wifi_signal_strength: 4 },
      cellular_network_info: { network_type: null },
      ip_address: fixture.ipAddresses ?? ["10.40.12.31"],
    },
    location_stats: { altitude: "", latitude: "", longitude: "" },
    memory_stats: {
      available_ram: 1450,
      available_internal_storage: 18200,
      os_occupied_storage: 6100,
    },
    blueprint_info: null,
    battery_stats: { battery_level: fixture.batteryLevel ?? 100 },
    mqtt_topic: "devices/acme",
    fcm_id: "",
    is_gms: true,
    dpc_version: "8.00.0764",
    eea_version: null,
    policy: null,
    managed_by: "BLUEPRINT",
    provisioned_with: "BLUEPRINT",
    template_name: null,
    is_seamless: false,
    is_esper_managed: true,
    app_mode_meta: isKiosk
      ? {
          is_kiosk: true,
          app_id: "a1b2c3d4-0000-4000-8000-000000000001",
          app_type: "TENANT_ANDROID",
          kiosk_mode_type: "CONFIGURATION",
        }
      : { is_kiosk: false },
    created_by: "admin@example.com",
    updated_by: "admin@example.com",
    created_at: "2026-03-02T15:00:00Z",
    updated_at: "2026-11-18T09:30:00Z",
  };
}

// A group as GET /enterprise/{eid}/devicegroup/ answers it.
export function buildEsperGroup(data: {
  id: string;
  name: string;
  path?: string | undefined;
  deviceCount?: number | undefined;
}): JSONObject {
  return {
    id: data.id,
    name: data.name,
    created_on: "2026-01-12T10:00:00Z",
    enterprise: `https://${ESPER_TENANT}-api.esper.cloud/api/enterprise/${ESPER_ENTERPRISE_ID}/`,
    parent: null,
    device_count: data.deviceCount ?? 0,
    path: data.path ?? data.name,
    children_count: 0,
    thumbnail: null,
    blueprint: null,
  };
}

// An app as GET /enterprise/{eid}/device/{id}/app/ answers it.
export function buildEsperApp(data: {
  deviceId: string;
  packageName: string;
  appName?: string | undefined;
  versionName?: string | undefined;
  versionCode?: string | undefined;
  isKioskApp?: boolean | undefined;
  isEsperControlled?: boolean | undefined;
}): JSONObject {
  return {
    id: `${data.packageName.length.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    app_name: data.appName ?? data.packageName,
    state: "INSTALL",
    app_type: "TENANT_ANDROID",
    package_name: data.packageName,
    whitelisted: true,
    is_data_clearable: true,
    is_uninstallable: true,
    product_id: null,
    version_code: data.versionCode ?? "1",
    version_name: data.versionName ?? "1.0.0",
    created_on: "2026-03-02T15:10:00Z",
    updated_on: "2026-11-18T09:00:00Z",
    is_active: true,
    is_kiosk_app: data.isKioskApp ?? false,
    is_esper_controlled: data.isEsperControlled ?? true,
    device: data.deviceId,
  };
}

// Who an API key belongs to, as GET /user_info/ answers it.
export function buildEsperUserInfo(data: {
  enterpriseId: string;
  role: string;
}): JSONObject {
  return {
    id: 42,
    username: "oneuptime-reader",
    email: "reader@example.com",
    first_name: "OneUptime",
    last_name: "Reader",
    full_name: "OneUptime Reader",
    is_staff: false,
    is_superuser: false,
    is_active: true,
    profile: {
      id: 42,
      enterprise_user_id: "eu-42",
      authn_user_id: "au-42",
      authn_connection_id: "ac-1",
      authz_role_id: "r-viewer",
      role: data.role,
      enterprise: data.enterpriseId,
      is_customer: true,
      is_endpoint_creator: false,
      created_on: "2026-01-12T10:00:00Z",
      updated_on: "2026-01-12T10:00:00Z",
      setup_wizard_complete: true,
      default_password_changed: true,
      is_developer: false,
      can_factory_reset: false,
      groups: [],
    },
    emm: {},
    last_login: "2026-11-18T08:00:00Z",
    token: "",
    has_emm: true,
    is_email_verified: true,
  };
}
