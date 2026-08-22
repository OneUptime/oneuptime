import DatabaseService from "./DatabaseService";
import MarketingTouchpoint from "../../Models/DatabaseModels/MarketingTouchpoint";
import Attribution from "../Utils/Attribution";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

export class Service extends DatabaseService<MarketingTouchpoint> {
  public constructor() {
    super(MarketingTouchpoint);
  }

  public async record(data: {
    eventId: string;
    anonymousVisitorId: string;
    touchpointType: string;
    consentState: string;
    attribution: JSONValue;
    occurredAt: Date;
    externalReferenceId?: string;
  }): Promise<MarketingTouchpoint> {
    const existing: MarketingTouchpoint | null = await this.findOneBy({
      query: { eventId: data.eventId },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      return existing;
    }

    const touchpoint: MarketingTouchpoint = new MarketingTouchpoint();
    touchpoint.eventId = data.eventId;
    touchpoint.anonymousVisitorId = data.anonymousVisitorId;
    touchpoint.touchpointType = data.touchpointType;
    touchpoint.consentState = data.consentState;
    touchpoint.attribution =
      Attribution.sanitizeAcquisitionAttribution(data.attribution) || {};
    touchpoint.occurredAt = data.occurredAt;
    touchpoint.externalReferenceId = data.externalReferenceId;

    try {
      return await this.create({ data: touchpoint, props: { isRoot: true } });
    } catch {
      const raced: MarketingTouchpoint | null = await this.findOneBy({
        query: { eventId: data.eventId },
        select: { _id: true },
        props: { isRoot: true },
      });
      if (raced) {
        return raced;
      }
      throw new Error("Could not persist marketing touchpoint");
    }
  }

  public async linkVisitor(data: {
    anonymousVisitorId: string;
    userId?: ObjectID;
    projectId?: ObjectID;
  }): Promise<void> {
    if (!data.userId && !data.projectId) {
      return;
    }

    await this.updateOneBy({
      query: { anonymousVisitorId: data.anonymousVisitorId },
      data: {
        ...(data.userId ? { userId: data.userId } : {}),
        ...(data.projectId ? { projectId: data.projectId } : {}),
      } as Partial<MarketingTouchpoint>,
      props: { isRoot: true },
    });
  }

  public static getLatestPaidClickIds(
    attribution: JSONObject | undefined,
  ): JSONObject | undefined {
    return Attribution.sanitizeAcquisitionAttribution(attribution)?.[
      "latestPaidTouch"
    ]?.["clickIds"] as JSONObject | undefined;
  }
}

export default new Service();
