import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Domain from "../../../Models/DatabaseModels/Domain";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DomainType from "../../../Types/Domain";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { SLUG_SUFFIX_LENGTH } from "../../../Utils/Slug";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression tests for the slug sources fixed alongside the baseline in
 * Tests/Models/DatabaseModels/ModelRegistryInvariants.test.ts.
 *
 * generateSlug resolves both halves of @SlugifyColumn BY NAME off the object
 * rather than through the schema, so a source naming no column reads
 * `undefined` and Slug.getSlug(null) answers with a slug built from
 * Faker.generateName(). Nothing throws and nothing is null -- the row simply
 * carries two random words as its public identity. That is why the fix has to
 * be pinned behaviourally here and not only as a declaration in the registry
 * sweep: the sweep proves the column EXISTS, these prove the slug is actually
 * derived from it.
 *
 * Every assertion is on the derivation, never on the whole string: getSlug
 * appends ten random digits to keep slugs unique.
 */

const TEN_DIGIT_TAIL: RegExp = /^[\d]{10}$/;

/*
 * Runs the real private hook the create path calls, and answers with whatever
 * landed on `slug`.
 */
const slugFor: (
  modelType: { new (): BaseModel },
  data: BaseModel,
) => string | undefined = (
  modelType: { new (): BaseModel },
  data: BaseModel,
): string | undefined => {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    modelType,
  );

  const createBy: CreateBy<BaseModel> = {
    data,
    props: { isRoot: true },
  };

  const result: CreateBy<BaseModel> = service["generateSlug"](createBy);

  return (result.data as unknown as Record<string, string | undefined>)["slug"];
};

/*
 * Asserts the slug reads as `<expected>-<ten digits>` without pinning the
 * digits.
 */
const expectSlugDerivedFrom: (
  slug: string | undefined,
  expected: string,
) => void = (slug: string | undefined, expected: string): void => {
  expect(slug).toBeDefined();
  expect(slug!.substring(0, expected.length + 1)).toBe(`${expected}-`);
  expect(slug!.substring(expected.length + 1)).toMatch(TEN_DIGIT_TAIL);
};

describe("DatabaseService.generateSlug — the slug comes from the column the model means", () => {
  /*
   * Incident's slug column documents the example
   * "database-connection-failure-in-production", which is exactly its title
   * column's example slugified. It slugified `name` -- a column Incident does
   * not have -- so every incident URL in the product was a random name.
   */
  test("Incident slugifies its title", () => {
    const incident: Incident = new Incident();
    incident.title = "Database connection failure in production";

    expectSlugDerivedFrom(
      slugFor(Incident, incident),
      "database-connection-failure-in-production",
    );
  });

  test("ScheduledMaintenance slugifies its title", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Database Migration and Server Upgrade";

    expectSlugDerivedFrom(
      slugFor(ScheduledMaintenance, event),
      "database-migration-and-server-upgrade",
    );
  });

  /*
   * The two template models carry BOTH a title and a templateName, so which
   * one they mean is a real choice rather than the only column available.
   * They mean templateName: each documents a slug example that is its
   * TEMPLATE NAME example slugified ("Server Outage Template" ->
   * "server-outage-template"), and StatusPageAnnouncementTemplate -- the one
   * template model whose source column was never mis-copied -- names
   * templateName too. The title is the incident or event the template
   * produces, and is not unique to the template.
   */
  test("IncidentTemplate slugifies its template name, not the incident title it produces", () => {
    const template: IncidentTemplate = new IncidentTemplate();
    template.templateName = "Server Outage Template";
    template.title = "Production Server Outage - Database Connection Issue";

    expectSlugDerivedFrom(
      slugFor(IncidentTemplate, template),
      "server-outage-template",
    );
  });

  test("ScheduledMaintenanceTemplate slugifies its template name, not the event title it produces", () => {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();
    template.templateName = "Database Upgrade Template";
    template.title = "Scheduled Database Maintenance - PostgreSQL Upgrade";

    expectSlugDerivedFrom(
      slugFor(ScheduledMaintenanceTemplate, template),
      "database-upgrade-template",
    );
  });

  /*
   * Domain has neither a name nor a title column; the domain IS its identity.
   * getSlug strips dots along with the rest of [&*+~.,\\/()|'"!:@].
   */
  test("Domain slugifies the domain itself", () => {
    const domain: Domain = new Domain();
    domain.domain = new DomainType("status.example.com");

    expectSlugDerivedFrom(slugFor(Domain, domain), "statusexamplecom");
  });

  /*
   * States the failure mode the five tests above are guarding against, rather
   * than leaving it to be inferred from a prefix that happens to match.
   */
  test("an unset source column falls back to a random name rather than failing", () => {
    const slug: string | undefined = slugFor(Incident, new Incident());

    expect(slug).toBeDefined();
    expect(slug).toMatch(/^[a-z0-9-]+-[\d]{10}$/);
    expect(slug!.startsWith("database-connection-failure")).toBe(false);
  });

  /*
   * Incident.title is varchar(500) against a varchar(100) slug, so pointing
   * the decorator at it is only safe because generateSlug clamps to the
   * DESTINATION column. checkMaxLengthOfFields runs later in the same create
   * and THROWS on overflow rather than truncating, so without the clamp a
   * long incident title would be a failed insert instead of a long slug.
   */
  test("clamps an over-wide source down to the slug column", () => {
    const title: string = "Database connection failure in production ".repeat(
      12,
    );

    expect(title.length).toBeGreaterThan(ColumnLength.Slug);

    const incident: Incident = new Incident();
    incident.title = title;

    const slug: string | undefined = slugFor(Incident, incident);

    expect(slug).toBeDefined();
    expect(slug!.length).toBeLessThanOrEqual(ColumnLength.Slug);

    /* The readable half is what gets cut; the unique tail survives whole. */
    expect(slug!.substring(slug!.length - SLUG_SUFFIX_LENGTH)).toMatch(
      /^-[\d]{10}$/,
    );
    expect(slug!.startsWith("database-connection-failure-in-production")).toBe(
      true,
    );

    /* And never a dash left dangling where the cut fell. */
    expect(slug).not.toMatch(/--[\d]{10}$/);
  });

  /*
   * The other half of the sweep's fourteen: models whose decorator named
   * columns they do not have at all. Their slug was assigned to a property
   * with no column and dropped by TypeORM on insert, so the decorator was
   * dead configuration and was removed rather than backed by a new column and
   * a migration for a value nothing in the product reads.
   */
  test("a model with no slug configuration is left untouched", () => {
    for (const model of [
      new StatusPageResource(),
      new MonitorStatusTimeline(),
    ]) {
      expect(model.getSlugifyColumn()).toBeFalsy();
      expect(model.getSaveSlugToColumn()).toBeFalsy();

      const ownPropertiesBefore: Array<string> = Object.keys(model).sort();

      slugFor(
        model.constructor as { new (): BaseModel },
        model as unknown as BaseModel,
      );

      expect(Object.keys(model).sort()).toEqual(ownPropertiesBefore);
    }
  });
});
