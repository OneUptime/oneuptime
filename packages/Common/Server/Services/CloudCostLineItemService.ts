import Model from "../../Models/DatabaseModels/CloudCostLineItem";
import {
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
} from "../../Types/Cloud/CloudCostAllocation";
import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Custom line items (CloudCostLineItem): a charge or credit a cloud's bill
 * does not carry, added to an account or a cost group. This guards one as
 * it is written - an amount above zero (its kind says which way it goes), a
 * currency code, a kind and a repeat OneUptime knows, an end no earlier than
 * the start, and exactly one of an account and a group to add it to. The
 * account or group must be the project's (ProjectReferencesService).
 */

export const CLOUD_COST_LINE_ITEM_AMOUNT_ERROR: string =
  "The amount must be a number greater than 0. Choose Credit to take it off the spend.";
export const CLOUD_COST_LINE_ITEM_CURRENCY_ERROR: string =
  "The currency must be a three-letter code such as USD or EUR.";
export const CLOUD_COST_LINE_ITEM_KIND_ERROR: string =
  "Choose whether the line item is a Charge or a Credit.";
export const CLOUD_COST_LINE_ITEM_RECURRENCE_ERROR: string =
  "Choose whether the line item counts Once or Monthly.";
export const CLOUD_COST_LINE_ITEM_START_ERROR: string =
  "Choose the day a line item is for, or the first month it counts in.";
export const CLOUD_COST_LINE_ITEM_END_ERROR: string =
  "A line item's end date must be on or after its start date.";
export const CLOUD_COST_LINE_ITEM_TARGET_ERROR: string =
  "Add the line item to an account or to a cost group, not both.";

const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public normalizeAmount(value: unknown): number {
    const amount: number =
      typeof value === "string"
        ? value.trim() === ""
          ? Number.NaN
          : Number(value.trim())
        : typeof value === "number"
          ? value
          : Number.NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_AMOUNT_ERROR);
    }

    return amount;
  }

  public normalizeCurrency(value: unknown): string {
    const currency: string =
      typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!CURRENCY_CODE.test(currency)) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_CURRENCY_ERROR);
    }

    return currency;
  }

  public normalizeKind(value: unknown): CloudCostLineItemKind {
    if (value === null || value === undefined || value === "") {
      return CloudCostLineItemKind.Charge;
    }

    if (
      !(Object.values(CloudCostLineItemKind) as Array<unknown>).includes(value)
    ) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_KIND_ERROR);
    }

    return value as CloudCostLineItemKind;
  }

  public normalizeRecurrence(value: unknown): CloudCostLineItemRecurrence {
    if (value === null || value === undefined || value === "") {
      return CloudCostLineItemRecurrence.Monthly;
    }

    if (
      !(Object.values(CloudCostLineItemRecurrence) as Array<unknown>).includes(
        value,
      )
    ) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_RECURRENCE_ERROR);
    }

    return value as CloudCostLineItemRecurrence;
  }

  private readDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(String(value));

    return Number.isFinite(date.getTime()) ? date : null;
  }

  // An end no earlier than the start, for an item that has both.
  private checkDates(start: unknown, end: unknown): void {
    const startDate: Date | null = this.readDate(start);
    const endDate: Date | null = this.readDate(end);

    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_END_ERROR);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.amount = this.normalizeAmount(createBy.data.amount);
    createBy.data.kind = this.normalizeKind(createBy.data.kind);
    createBy.data.recurrence = this.normalizeRecurrence(
      createBy.data.recurrence,
    );

    if (createBy.data.currency !== undefined) {
      createBy.data.currency = this.normalizeCurrency(createBy.data.currency);
    }

    if (!this.readDate(createBy.data.startDate)) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_START_ERROR);
    }

    this.checkDates(createBy.data.startDate, createBy.data.endDate);

    if (
      Boolean(createBy.data.cloudAccountId) ===
      Boolean(createBy.data.cloudCostGroupId)
    ) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_TARGET_ERROR);
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.amount !== undefined && updateBy.data.amount !== null) {
      updateBy.data.amount = this.normalizeAmount(updateBy.data.amount);
    }

    if (updateBy.data.kind !== undefined) {
      updateBy.data.kind = this.normalizeKind(updateBy.data.kind);
    }

    if (updateBy.data.recurrence !== undefined) {
      updateBy.data.recurrence = this.normalizeRecurrence(
        updateBy.data.recurrence,
      );
    }

    if (
      updateBy.data.currency !== undefined &&
      updateBy.data.currency !== null
    ) {
      updateBy.data.currency = this.normalizeCurrency(updateBy.data.currency);
    }

    if (
      updateBy.data.startDate !== undefined &&
      !this.readDate(updateBy.data.startDate)
    ) {
      throw new BadDataException(CLOUD_COST_LINE_ITEM_START_ERROR);
    }

    const touchesDates: boolean =
      updateBy.data.startDate !== undefined ||
      updateBy.data.endDate !== undefined;
    const touchesTarget: boolean =
      updateBy.data.cloudAccountId !== undefined ||
      updateBy.data.cloudCostGroupId !== undefined;

    // Read with what the line items hold now, for what the write leaves.
    if (touchesDates || touchesTarget) {
      const items: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          startDate: true,
          endDate: true,
          cloudAccountId: true,
          cloudCostGroupId: true,
        },
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });

      for (const item of items) {
        this.checkDates(
          updateBy.data.startDate !== undefined
            ? updateBy.data.startDate
            : item.startDate,
          updateBy.data.endDate !== undefined
            ? updateBy.data.endDate
            : item.endDate,
        );

        const accountId: unknown =
          updateBy.data.cloudAccountId !== undefined
            ? updateBy.data.cloudAccountId
            : item.cloudAccountId;
        const groupId: unknown =
          updateBy.data.cloudCostGroupId !== undefined
            ? updateBy.data.cloudCostGroupId
            : item.cloudCostGroupId;

        if (Boolean(accountId) === Boolean(groupId)) {
          throw new BadDataException(CLOUD_COST_LINE_ITEM_TARGET_ERROR);
        }
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
