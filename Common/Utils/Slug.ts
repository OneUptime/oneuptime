import Faker from "./Faker";
import slugify from "slugify";

/*
 * The tail every slug carries: a dash plus ten random digits.
 *
 * It is what keeps two objects of the same name apart, so it is the half that
 * survives when a slug has to be cut down to fit its column.
 */
export const SLUG_SUFFIX_LENGTH: number = 11;

export default class Slug {
  /*
   * `maxLength`, when given, is the width of the column the slug is about to
   * be written to.
   *
   * It exists because the create path THROWS on an oversized value rather
   * than truncating it (DatabaseService.checkMaxLengthOfFields), and a slug
   * source is routinely wider than the slug column: Incident.title is
   * varchar(500) against a varchar(100) slug. Without a ceiling, slugifying
   * such a column turns a long title into a failed insert.
   *
   * Only the readable half is trimmed; the random tail is never touched. A
   * `maxLength` narrower than SLUG_SUFFIX_LENGTH therefore cannot be honoured
   * -- the tail wins -- but no column is anywhere near that narrow.
   */
  public static getSlug(name: string | null, maxLength?: number): string {
    if (name === null) {
      name = Faker.generateName();
    }

    name = String(name);
    if (!name || !name.trim()) {
      return "";
    }

    let slug: string = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });

    if (maxLength !== undefined) {
      /*
       * Cut to what the tail leaves, then drop any dash the cut left
       * dangling so the result does not read as `something--0123456789`.
       */
      slug = slug
        .substring(0, Math.max(0, maxLength - SLUG_SUFFIX_LENGTH))
        .replace(/-+$/, "");
    }

    slug = `${slug}-${Faker.getRandomNumbers(10).toString()}`;
    slug = slug.toLowerCase();

    return slug;
  }
}
