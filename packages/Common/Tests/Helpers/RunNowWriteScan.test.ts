import { RunNowReading, readRunNow } from "./RunNowWriteScan";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SCAN BEHIND THE GUARD ON EVERY RULE'S RUN NOW, ON CODE MADE FOR IT
 * (issues #6323, #6324): which writes a Run now reaches, which of them
 * carry who ran it, which recorders are handed who ran it, and which
 * methods that write are called without the run's props - through `this`,
 * through a helper that writes through another, and through the service's
 * own DatabaseService methods.
 */

const FILE: string = "Common/Server/Services/WidgetRuleEngineService.ts";

function read(text: string, entry: string = "runNow"): RunNowReading {
  return readRunNow({ file: FILE, entry: entry, text: text });
}

describe("readRunNow", () => {
  test("a run whose every write carries who ran it has nothing to report", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.writePage({ props: data.props });
    await WidgetService.deleteOneById({ id: "a", props: RuleRunWriteProps.get(data.props) });
  }

  private async writePage(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(data.props) });
    await MonitorService.create({
      data: {},
      props: RuleRunWriteProps.getInProject(data.props, data.projectId),
    });
  }
}`);

    expect(reading.hasEntry).toBe(true);
    expect(reading.reached).toEqual(["runNow", "writePage"]);
    expect(reading.writes).toHaveLength(3);
    expect(reading.writesWithoutWhoRanIt).toEqual([]);
    expect(reading.recordersWithoutWhoRanIt).toEqual([]);
    expect(reading.callsDroppingProps).toEqual([]);
  });

  test("a write as plain root, or with the request's own props, is reported", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: { isRoot: true } });
    await WidgetService.updateOneById({ id: "a", data: {}, props: data.props });
    await WidgetService.deleteOneById({ id: "a" });
  }
}`);

    expect(reading.writesWithoutWhoRanIt).toEqual([
      `WidgetRuleEngineService.ts:4 WidgetService.create in runNow with { isRoot: true }`,
      `WidgetRuleEngineService.ts:5 WidgetService.updateOneById in runNow with data.props`,
      `WidgetRuleEngineService.ts:6 WidgetService.deleteOneById in runNow with (none)`,
    ]);
  });

  test("RuleRunWriteProps of anything but the run's props is reported", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(undefined) });
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(otherProps) });
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.getInProject(undefined, id) });
  }
}`);

    expect(reading.writesWithoutWhoRanIt).toHaveLength(3);
  });

  test("a helper that writes, called without the run's props, is reported - and so is one that writes through another", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.outer({ id: "a" });
    await this.readOnly({ id: "b" });
  }

  private async outer(data: { props?: Props }): Promise<void> {
    await this.inner({ props: data.props });
  }

  private async inner(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(data.props) });
  }

  private async readOnly(data: { id: string }): Promise<void> {
    await WidgetService.findBy({ query: {}, props: { isRoot: true } });
  }
}`);

    expect(reading.reached).toEqual(["runNow", "outer", "readOnly", "inner"]);
    // A method that only reads need not be handed anything.
    expect(reading.callsDroppingProps).toEqual([
      `WidgetRuleEngineService.ts:4 this.outer in runNow`,
    ]);
  });

  test("the service's own writes through this are writes; its own methods are calls", () => {
    const reading: RunNowReading = read(`
export class Service extends DatabaseService<Model> {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.updateOneById({ id: "a", data: {}, props: { isRoot: true } });
    await this.create({ props: data.props });
  }

  // Declared here, so a call of it is a call of the method, not a write.
  public async create(data: { props?: Props }): Promise<void> {
    await this.createMany({ items: [], props: RuleRunWriteProps.get(data.props) });
  }
}`);

    expect(reading.writes).toEqual([
      `WidgetRuleEngineService.ts:4 this.updateOneById in runNow with { isRoot: true }`,
      `WidgetRuleEngineService.ts:10 this.createMany in create with RuleRunWriteProps.get(data.props)`,
    ]);
    expect(reading.writesWithoutWhoRanIt).toEqual([
      `WidgetRuleEngineService.ts:4 this.updateOneById in runNow with { isRoot: true }`,
    ]);
    expect(reading.callsDroppingProps).toEqual([]);
  });

  test("a write in an arrow function is the method's it is in", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    const attempt: () => Promise<void> = async (): Promise<void> => {
      await WidgetService.create({ data: {}, props: { isRoot: true } });
    };
    await attempt();
  }
}`);

    expect(reading.writesWithoutWhoRanIt).toEqual([
      `WidgetRuleEngineService.ts:5 WidgetService.create in runNow with { isRoot: true }`,
    ]);
  });

  test("a positional write is held to its last argument", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await MonitorService.addOwners(projectId, id, [], [], false, RuleRunWriteProps.get(data.props));
    await MonitorService.addOwners(projectId, id, [], [], false, { isRoot: true });
  }
}`);

    expect(reading.writes).toHaveLength(2);
    expect(reading.writesWithoutWhoRanIt).toEqual([
      `WidgetRuleEngineService.ts:5 MonitorService.addOwners in runNow with { isRoot: true }`,
    ]);
  });

  test("recorders are handed who ran the rule, or reported", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await RuleAddedLabels.add({ service: s, resourceId: id, labelIds: [], props: data.props });
    await RuleAddedLabels.recordInAuditLog({ service: s, changes: [], props: data.props });
    await AuditLogService.recordUpdate({ model: m, props: { isRoot: true } });
    await AuditLogService.recordCreate({ model: m });
  }
}`);

    expect(reading.recorders).toHaveLength(4);
    expect(reading.recordersWithoutWhoRanIt).toEqual([
      `WidgetRuleEngineService.ts:6 AuditLogService.recordUpdate in runNow with { isRoot: true }`,
      `WidgetRuleEngineService.ts:7 AuditLogService.recordCreate in runNow with (none)`,
    ]);
    // A method that only records still has to be handed the props.
    expect(reading.writes).toEqual([]);
  });

  test("a method that only records must be handed the run's props", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.record({ id: "a" });
  }

  private async record(data: { props?: Props }): Promise<void> {
    await AuditLogService.recordUpdate({ model: m, props: data.props });
  }
}`);

    expect(reading.callsDroppingProps).toEqual([
      `WidgetRuleEngineService.ts:4 this.record in runNow`,
    ]);
  });

  test("what the entry does not reach is none of its business: the save path keeps its own props", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.write({ props: data.props });
  }

  public async onSave(): Promise<void> {
    await this.write({});
    await WidgetService.create({ data: {}, props: { isRoot: true } });
  }

  private async write(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(data.props) });
  }
}`);

    expect(reading.reached).toEqual(["runNow", "write"]);
    expect(reading.writesWithoutWhoRanIt).toEqual([]);
    expect(reading.callsDroppingProps).toEqual([]);

    // From the save path, the same reading names what it drops.
    const save: RunNowReading = read(
      `
export class Engine {
  public async onSave(): Promise<void> {
    await this.write({});
  }

  private async write(data: { props?: Props }): Promise<void> {
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(data.props) });
  }
}`,
      "onSave",
    );

    expect(save.callsDroppingProps).toEqual([
      `WidgetRuleEngineService.ts:4 this.write in onSave`,
    ]);
  });

  test("methods that call each other are read once", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    await this.ping({ props: data.props });
  }

  private async ping(data: { props?: Props }): Promise<void> {
    await this.pong({ props: data.props });
  }

  private async pong(data: { props?: Props }): Promise<void> {
    await this.ping({ props: data.props });
    await WidgetService.create({ data: {}, props: RuleRunWriteProps.get(data.props) });
  }
}`);

    expect(reading.reached).toEqual(["runNow", "ping", "pong"]);
    expect(reading.writes).toHaveLength(1);
    expect(reading.callsDroppingProps).toEqual([]);
  });

  test("an entry the file does not declare reaches nothing", () => {
    const reading: RunNowReading = read(
      `export class Engine { public async other(): Promise<void> {} }`,
    );

    expect(reading.hasEntry).toBe(false);
    expect(reading.reached).toEqual([]);
    expect(reading.writes).toEqual([]);
  });

  test("a write named in a comment or a string is none", () => {
    const reading: RunNowReading = read(`
export class Engine {
  public async runNow(data: { props?: Props }): Promise<void> {
    // WidgetService.create({ data: {}, props: { isRoot: true } });
    const text: string = "WidgetService.create({ props: { isRoot: true } })";
    await WidgetService.findOneBy({ query: { text }, props: { isRoot: true } });
  }
}`);

    expect(reading.writes).toEqual([]);
  });
});
