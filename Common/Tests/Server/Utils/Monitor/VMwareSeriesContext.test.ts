import VMwareSeriesContext, {
  VMwareDisplayContext,
} from "../../../../Server/Utils/Monitor/VMwareSeriesContext";
import VMwareSourceService from "../../../../Server/Services/VMwareSourceService";
import VMwareResourceService from "../../../../Server/Services/VMwareResourceService";
import VMwareSource from "../../../../Models/DatabaseModels/VMwareSource";
import VMwareResource from "../../../../Models/DatabaseModels/VMwareResource";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import ObjectID from "../../../../Types/ObjectID";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";

const PROJECT: ObjectID = ObjectID.generate();
const SOURCE: ObjectID = ObjectID.generate();
const RESOURCE: ObjectID = ObjectID.generate();
const LABELS: JSONObject = {
  "resource.oneuptime.vmware.source.id": "prod-stable-id",
  "resource.oneuptime.vmware.resource.type": "vm",
  "resource.oneuptime.vmware.resource.id": "uuid-stable-id",
};
function setup(): { source: VMwareSource; resource: VMwareResource } {
  const source: VMwareSource = new VMwareSource();
  source._id = SOURCE.toString();
  source.name = "Production vCenter";
  const resource: VMwareResource = new VMwareResource();
  resource._id = RESOURCE.toString();
  resource.name = "Payments API";
  jest.spyOn(VMwareSourceService, "findOneBy").mockResolvedValue(source);
  jest.spyOn(VMwareResourceService, "findOneBy").mockResolvedValue(resource);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  return { source, resource };
}
afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMware notification context", () => {
  it("resolves names and working native links using project/source/type/id scope", async () => {
    setup();
    const context: VMwareDisplayContext | null =
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: LABELS,
      });
    expect(
      context?.displayLabels["resource.oneuptime.vmware.resource.name"],
    ).toBe("Payments API");
    expect(context?.linksMarkdown).toContain(
      `/dashboard/${PROJECT.toString()}/vmware/${SOURCE.toString()}/resources/${RESOURCE.toString()}`,
    );
    expect(VMwareSourceService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT, sourceIdentifier: "prod-stable-id" },
      }),
    );
    expect(VMwareResourceService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT,
          sourceId: SOURCE,
          resourceIdentifier: "uuid-stable-id",
          resourceType: "vm",
        },
      }),
    );
    expect(
      SeriesContextEnricher.enrichTitle({
        title: "VM unavailable",
        seriesLabels: context?.displayLabels,
      }),
    ).toContain("Payments API");
  });
  it("updates display names without changing the stored identity or incident fingerprint", async () => {
    const { resource } = setup();
    const before: string = MetricSeriesFingerprint.computeFingerprint(LABELS);
    const original: string = JSON.stringify(LABELS);
    await VMwareSeriesContext.resolve({
      projectId: PROJECT,
      seriesLabels: LABELS,
    });
    resource.name = "Renamed Payments API";
    const context: VMwareDisplayContext | null =
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: LABELS,
      });
    expect(
      context?.displayLabels["resource.oneuptime.vmware.resource.name"],
    ).toBe("Renamed Payments API");
    expect(JSON.stringify(LABELS)).toBe(original);
    expect(MetricSeriesFingerprint.computeFingerprint(LABELS)).toBe(before);
  });
  it("renders source alerts without a resource lookup", async () => {
    setup();
    const context: VMwareDisplayContext | null =
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: {
          "resource.oneuptime.vmware.source.id": "prod-stable-id",
        },
      });
    expect(context?.displayLabels).toEqual({
      "resource.oneuptime.vmware.source.name": "Production vCenter",
    });
    expect(context?.linksMarkdown).toContain("Open VMware source");
    expect(VMwareResourceService.findOneBy).not.toHaveBeenCalled();
  });
  it("does not expose another tenant's inventory when source resolution returns nothing", async () => {
    setup();
    jest.mocked(VMwareSourceService.findOneBy).mockResolvedValue(null);
    expect(
      await VMwareSeriesContext.resolve({
        projectId: ObjectID.generate(),
        seriesLabels: LABELS,
      }),
    ).toBeNull();
    expect(VMwareResourceService.findOneBy).not.toHaveBeenCalled();
  });
  it("falls back safely when inventory is missing or unavailable", async () => {
    setup();
    jest.mocked(VMwareResourceService.findOneBy).mockResolvedValue(null);
    const context: VMwareDisplayContext | null =
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: LABELS,
      });
    expect(
      context?.displayLabels["resource.oneuptime.vmware.resource.id"],
    ).toBe("uuid-stable-id");
    expect(context?.linksMarkdown).not.toContain("Open VMware resource");
    jest
      .mocked(VMwareSourceService.findOneBy)
      .mockRejectedValue(new Error("Database unavailable"));
    expect(
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: LABELS,
      }),
    ).toBeNull();
  });
  it("adds no database work for other monitor types", async () => {
    setup();
    expect(
      await VMwareSeriesContext.resolve({
        projectId: PROJECT,
        seriesLabels: { "host.name": "web" },
      }),
    ).toBeNull();
    expect(VMwareSourceService.findOneBy).not.toHaveBeenCalled();
  });
});
