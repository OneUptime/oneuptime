import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../Types/Monitor/MonitorType";
import {
  CardSelectOption,
  cardSelectOptionMatchesSearch,
  getCardSelectOptionSearchScore,
  getCardSelectSearchTokens,
} from "../../../UI/Components/CardSelect/CardSelect";

/*
 * The monitor type picker offers 31 types. Whether someone finds the right one
 * comes down to whether the words they already use - "k8s", "postgres",
 * "heartbeat", "tls" - are attached to the card, because none of them appear
 * in its title or its copy. These are the searches this catalog promises to
 * answer.
 */

const allProps: Array<MonitorTypeProps> =
  MonitorTypeHelper.getAllMonitorTypeProps();

type PropsForFunction = (monitorType: MonitorType) => MonitorTypeProps;

const propsFor: PropsForFunction = (
  monitorType: MonitorType,
): MonitorTypeProps => {
  const found: MonitorTypeProps | undefined = allProps.find(
    (item: MonitorTypeProps) => {
      return item.monitorType === monitorType;
    },
  );

  if (!found) {
    throw new Error(`No props for ${monitorType}`);
  }

  return found;
};

type ToCardOptionFunction = (monitorType: MonitorType) => CardSelectOption;

const toCardOption: ToCardOptionFunction = (
  monitorType: MonitorType,
): CardSelectOption => {
  const props: MonitorTypeProps = propsFor(monitorType);

  return {
    value: props.monitorType,
    title: props.title,
    description: props.description,
    icon: props.icon,
    keywords: props.keywords,
  };
};

/*
 * Runs a search over the whole catalog exactly the way the picker does, and
 * returns the monitor types in the order they would be shown.
 */
type SearchCatalogFunction = (search: string) => Array<MonitorType>;

const searchCatalog: SearchCatalogFunction = (
  search: string,
): Array<MonitorType> => {
  const tokens: Array<string> = getCardSelectSearchTokens(search);
  const categories: Array<MonitorTypeCategory> =
    MonitorTypeHelper.getMonitorTypeCategories();

  const results: Array<{ monitorType: MonitorType; score: number }> = [];

  for (const category of categories) {
    for (const monitorType of category.monitorTypes) {
      const option: CardSelectOption = toCardOption(monitorType);

      if (!cardSelectOptionMatchesSearch(option, tokens, category.label)) {
        continue;
      }

      results.push({
        monitorType: monitorType,
        score: getCardSelectOptionSearchScore(option, tokens, category.label),
      });
    }
  }

  return results
    .sort(
      (
        a: { monitorType: MonitorType; score: number },
        b: { monitorType: MonitorType; score: number },
      ) => {
        const scoreDifference: number = b.score - a.score;

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return propsFor(a.monitorType).title.localeCompare(
          propsFor(b.monitorType).title,
        );
      },
    )
    .map((result: { monitorType: MonitorType; score: number }) => {
      return result.monitorType;
    });
};

describe("MonitorType keywords", () => {
  describe("every monitor type carries usable keywords", () => {
    test("no monitor type is left without any", () => {
      for (const props of allProps) {
        expect(Array.isArray(props.keywords)).toBe(true);
        expect(props.keywords.length).toBeGreaterThan(0);
      }
    });

    test("every enum member has props, so nothing can be searched for and missed", () => {
      const covered: Array<MonitorType> = allProps.map(
        (props: MonitorTypeProps) => {
          return props.monitorType;
        },
      );

      for (const monitorType of Object.values(MonitorType)) {
        expect(covered).toContain(monitorType);
      }
    });

    test("keywords are lower case, so a search never misses on case alone", () => {
      for (const props of allProps) {
        for (const keyword of props.keywords) {
          expect(keyword).toBe(keyword.toLowerCase());
        }
      }
    });

    test("keywords are trimmed and non-empty", () => {
      for (const props of allProps) {
        for (const keyword of props.keywords) {
          expect(keyword).toBe(keyword.trim());
          expect(keyword.length).toBeGreaterThan(0);
        }
      }
    });

    test("a monitor type does not repeat the same keyword", () => {
      for (const props of allProps) {
        expect(new Set(props.keywords).size).toBe(props.keywords.length);
      }
    });

    /*
     * A keyword that only repeats the title earns nothing - the title is
     * already searched. Every type must add at least one word the card does
     * not already say.
     */
    test("each type adds at least one word its title does not already contain", () => {
      for (const props of allProps) {
        const title: string = props.title.toLowerCase();

        const addsSomething: boolean = props.keywords.some(
          (keyword: string) => {
            return !title.includes(keyword);
          },
        );

        expect({
          monitorType: props.monitorType,
          addsSomething: addsSomething,
        }).toEqual({ monitorType: props.monitorType, addsSomething: true });
      }
    });
  });

  describe("getKeywords", () => {
    test("returns the configured keywords", () => {
      expect(MonitorTypeHelper.getKeywords(MonitorType.Kubernetes)).toContain(
        "k8s",
      );
    });

    test("throws BadDataException for a type without props", () => {
      expect(() => {
        MonitorTypeHelper.getKeywords("NonExistent" as MonitorType);
      }).toThrowError(BadDataException);
    });
  });

  describe("card copy is scannable", () => {
    /*
     * Every description used to open with "This monitor type lets you
     * monitor", so the first five words of every card were identical and
     * carried nothing. Reading the grid meant skipping them on every card.
     */
    test("no description opens with the old boilerplate", () => {
      for (const props of allProps) {
        expect({
          monitorType: props.monitorType,
          startsWithBoilerplate: props.description
            .toLowerCase()
            .startsWith("this monitor type"),
        }).toEqual({
          monitorType: props.monitorType,
          startsWithBoilerplate: false,
        });
      }
    });

    test("descriptions stay short enough to keep the cards an even height", () => {
      for (const props of allProps) {
        expect({
          monitorType: props.monitorType,
          tooLong: props.description.length > 100,
        }).toEqual({ monitorType: props.monitorType, tooLong: false });
      }
    });

    test("descriptions are still there and still say something", () => {
      for (const props of allProps) {
        expect(props.description.trim().length).toBeGreaterThan(20);
      }
    });
  });

  describe("the searches the catalog promises to answer", () => {
    test.each([
      ["k8s", MonitorType.Kubernetes],
      ["kubernetes", MonitorType.Kubernetes],
      ["eks", MonitorType.Kubernetes],
      /*
       * Both database cards answer to the engine names. Someone typing an
       * engine into a monitoring product wants its health series, not the
       * escape hatch for a query they have to write themselves - so the
       * engine words rank Database Health first, and SQL Query keeps the
       * searches that describe what only it does.
       */
      ["postgres", MonitorType.Database],
      ["postgresql", MonitorType.Database],
      ["mysql", MonitorType.Database],
      ["database", MonitorType.Database],
      ["query", MonitorType.SQLQuery],
      ["row count", MonitorType.SQLQuery],
      ["heartbeat", MonitorType.IncomingRequest],
      ["cron", MonitorType.IncomingRequest],
      ["webhook", MonitorType.IncomingRequest],
      ["tls", MonitorType.SSLCertificate],
      ["cert", MonitorType.SSLCertificate],
      ["x509", MonitorType.SSLCertificate],
      ["url", MonitorType.Website],
      ["icmp", MonitorType.Ping],
      ["tcp", MonitorType.Port],
      ["udp", MonitorType.Port],
      ["ipv6", MonitorType.IP],
      ["whois", MonitorType.Domain],
      ["aws", MonitorType.ExternalStatusPage],
      ["cloudflare", MonitorType.ExternalStatusPage],
      ["cname", MonitorType.DNS],
      ["dnskey", MonitorType.DNSSEC],
      ["snmp", MonitorType.NetworkDevice],
      ["router", MonitorType.NetworkDevice],
      ["prometheus", MonitorType.Metrics],
      ["apm", MonitorType.Traces],
      ["stack trace", MonitorType.Exceptions],
      ["playwright", MonitorType.SyntheticMonitor],
      ["javascript", MonitorType.CustomJavaScriptCode],
      ["rootless", MonitorType.Podman],
      ["lxc", MonitorType.Proxmox],
      ["osd", MonitorType.Ceph],
      ["sensor", MonitorType.IoTDevice],
      ["imap", MonitorType.IncomingEmail],
    ])(
      "ranks %s first, and it is %s",
      (search: string, expected: MonitorType) => {
        const results: Array<MonitorType> = searchCatalog(search);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]).toBe(expected);
      },
    );

    test("a plain title search still wins over anything that merely mentions it", () => {
      expect(searchCatalog("ping")[0]).toBe(MonitorType.Ping);
      expect(searchCatalog("domain")[0]).toBe(MonitorType.Domain);
      expect(searchCatalog("logs")[0]).toBe(MonitorType.Logs);
    });

    test("words describing the job, in any order, find the type", () => {
      expect(searchCatalog("expiry certificate")).toContain(
        MonitorType.SSLCertificate,
      );
      expect(searchCatalog("certificate expiry")).toContain(
        MonitorType.SSLCertificate,
      );
    });

    test("a category name gathers everything under it", () => {
      const results: Array<MonitorType> = searchCatalog("infrastructure");

      expect(results).toContain(MonitorType.Kubernetes);
      expect(results).toContain(MonitorType.Docker);
      expect(results).toContain(MonitorType.Ceph);
      expect(results).not.toContain(MonitorType.Website);
    });

    test("a word nothing uses returns nothing rather than everything", () => {
      expect(searchCatalog("mainframe")).toEqual([]);
    });

    test("an empty search returns the whole catalog", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      const total: number = categories.reduce(
        (count: number, category: MonitorTypeCategory) => {
          return count + category.monitorTypes.length;
        },
        0,
      );

      expect(searchCatalog("").length).toBe(total);
    });
  });

  describe("the catalog the picker actually offers", () => {
    test("every categorised type has props to render", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      for (const category of categories) {
        for (const monitorType of category.monitorTypes) {
          expect(() => {
            return propsFor(monitorType);
          }).not.toThrow();
        }
      }
    });

    test("no monitor type is listed under two categories, which would render it twice", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      const seen: Array<MonitorType> = [];

      for (const category of categories) {
        for (const monitorType of category.monitorTypes) {
          expect(seen).not.toContain(monitorType);
          seen.push(monitorType);
        }
      }
    });

    /*
     * The first category is the one the picker leaves open, so it has to be
     * the one most people want. Everything else starts closed behind a count.
     */
    test("the category shown open by default is the everyday one", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      expect(categories[0]?.label).toBe("Basic Monitoring");
      expect(categories[0]?.monitorTypes).toContain(MonitorType.Website);
      expect(categories[0]?.monitorTypes).toContain(MonitorType.API);
      expect(categories[0]?.monitorTypes).toContain(MonitorType.Ping);
    });
  });
});
