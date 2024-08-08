import Faker from "./Faker";
import slugify from "slugify";

export default class Slug {
  public static getSlug(name: string | null): string {
    if (name === null) {
      name = Faker.generateName();
    }

    name = String(name);
    if (!name || !name.trim()) {
      return "";
    }

    let slug: string = slugify(name, { remove: /[&*+~.,\\/()|'"!:@]+/g });
    slug = `${slug}-${Faker.getRandomNumbers(10).toString()}`;
    slug = slug.toLowerCase();

    return slug;
  }
}
