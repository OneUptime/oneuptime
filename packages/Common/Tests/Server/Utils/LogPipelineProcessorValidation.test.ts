import { validateLogPipelineProcessor } from "../../../Server/Utils/LogPipelineProcessorValidation";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import LogPipelineProcessorType from "../../../Types/Log/LogPipelineProcessorType";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the save-time gate on log pipeline processors.
 *
 * A processor that cannot run is invisible: it sits in the pipeline list
 * looking configured while every log flows past it untouched. That is
 * exactly the shape of OneUptime/oneuptime#2515, where GrokParser was a
 * valid processor type with no implementation behind it.
 *
 * The grok pattern is where a typo is easy and silent, so it is compiled
 * here — once per human edit, in front of the only person who can fix
 * it. Everything else is left alone: this gate exists to catch what
 * would otherwise fail quietly, not to re-validate the whole form.
 */

function grokProcessor(configuration: JSONObject | string): {
  processorType: string;
  configuration: JSONObject | string;
} {
  return {
    processorType: LogPipelineProcessorType.GrokParser,
    configuration: configuration,
  };
}

describe("log pipeline processor validation — grok patterns", () => {
  it("accepts a valid pattern", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({
          source: "body",
          pattern: "%{IPV4:client_ip} %{WORD:verb} %{NUMBER:status:int}",
        }),
      );
    }).not.toThrow();
  });

  it("accepts a configuration persisted as a JSON string", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor(
          JSON.stringify({ source: "body", pattern: "%{WORD:verb}" }),
        ),
      );
    }).not.toThrow();
  });

  it("rejects a configuration string that is not JSON", () => {
    expect(() => {
      return validateLogPipelineProcessor(grokProcessor("not json at all"));
    }).toThrow(BadDataException);
  });

  it("rejects a missing configuration", () => {
    expect(() => {
      return validateLogPipelineProcessor({
        processorType: LogPipelineProcessorType.GrokParser,
        configuration: null,
      });
    }).toThrow(BadDataException);
  });

  it("rejects a missing or blank pattern", () => {
    for (const pattern of [undefined, "", "   "]) {
      expect(() => {
        return validateLogPipelineProcessor(
          grokProcessor({ source: "body", pattern: pattern as string }),
        );
      }).toThrow(BadDataException);
    }
  });

  it("rejects an unknown pattern name, naming it in the error", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({ source: "body", pattern: "%{NOSUCHTHING:x}" }),
      );
    }).toThrow('Unknown grok pattern "%{NOSUCHTHING}"');
  });

  it("rejects a pattern whose regex does not parse", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({ source: "body", pattern: "%{WORD:verb} ([unclosed" }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects a field name that could not become an attribute key", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({ source: "body", pattern: "%{WORD:client ip}" }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects an unknown capture type", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({ source: "body", pattern: "%{NUMBER:status:decimal}" }),
      );
    }).toThrow(BadDataException);
  });
});

describe("log pipeline processor validation — target prefix", () => {
  it("accepts prefixes that read like attribute-key namespaces", () => {
    for (const targetPrefix of ["http", "http.", "http_", "_private", "a-b"]) {
      expect(() => {
        return validateLogPipelineProcessor(
          grokProcessor({
            source: "body",
            pattern: "%{WORD:verb}",
            targetPrefix,
          }),
        );
      }).not.toThrow();
    }
  });

  it("accepts an absent or blank prefix", () => {
    for (const targetPrefix of [undefined, "", "  "]) {
      expect(() => {
        return validateLogPipelineProcessor(
          grokProcessor({
            source: "body",
            pattern: "%{WORD:verb}",
            targetPrefix: targetPrefix as string,
          }),
        );
      }).not.toThrow();
    }
  });

  it("rejects a prefix with characters an attribute key should not carry", () => {
    for (const targetPrefix of ["my prefix", "1http", "http!", "{x}"]) {
      expect(() => {
        return validateLogPipelineProcessor(
          grokProcessor({
            source: "body",
            pattern: "%{WORD:verb}",
            targetPrefix,
          }),
        );
      }).toThrow(BadDataException);
    }
  });

  it("rejects a non-string prefix or source", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({
          source: "body",
          pattern: "%{WORD:verb}",
          targetPrefix: 12 as unknown as string,
        } as unknown as JSONObject),
      );
    }).toThrow(BadDataException);

    expect(() => {
      return validateLogPipelineProcessor(
        grokProcessor({
          source: 12 as unknown as string,
          pattern: "%{WORD:verb}",
        } as unknown as JSONObject),
      );
    }).toThrow(BadDataException);
  });
});

describe("log pipeline processor validation — other processor types", () => {
  /*
   * The other three processor types were shipped without a save-time
   * gate and are not silently broken the way grok was. Adding one for
   * them is a separate decision; this pins that it did not happen by
   * accident here.
   */
  it("leaves non-grok processors alone", () => {
    for (const processorType of [
      LogPipelineProcessorType.AttributeRemapper,
      LogPipelineProcessorType.SeverityRemapper,
      LogPipelineProcessorType.CategoryProcessor,
      "SomethingElse",
    ]) {
      expect(() => {
        return validateLogPipelineProcessor({
          processorType: processorType,
          configuration: { anything: "goes" },
        });
      }).not.toThrow();
    }
  });
});

/*
 * The key=value parser has no pattern to compile, but its delimiters are
 * the same kind of easy, invisible mistake: a pair delimiter equal to the
 * key-value delimiter - or an empty one - parses every line into nothing.
 */
function keyValueProcessor(configuration: JSONObject | string | null): {
  processorType: string;
  configuration: JSONObject | string | null;
} {
  return {
    processorType: LogPipelineProcessorType.KeyValueParser,
    configuration: configuration,
  };
}

describe("log pipeline processor validation — key=value parser", () => {
  it("accepts the defaults, including a missing configuration", () => {
    for (const configuration of [
      { source: "body" },
      {},
      null,
      JSON.stringify({ source: "body" }),
    ]) {
      expect(() => {
        return validateLogPipelineProcessor(keyValueProcessor(configuration));
      }).not.toThrow();
    }
  });

  it("accepts a fully configured Sophos processor", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({
          source: "body",
          targetPrefix: "sophos",
          keyValueDelimiter: "=",
          overrideOnConflict: false,
        }),
      );
    }).not.toThrow();
  });

  it("accepts custom delimiters that differ", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({
          source: "body",
          pairDelimiter: ";",
          keyValueDelimiter: ":",
        }),
      );
    }).not.toThrow();
  });

  it("rejects empty delimiters", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({ source: "body", pairDelimiter: "" }),
      );
    }).toThrow("Pair delimiter cannot be empty.");

    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({ source: "body", keyValueDelimiter: "" }),
      );
    }).toThrow("Key-value delimiter cannot be empty.");
  });

  it("rejects identical pair and key-value delimiters", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({
          source: "body",
          pairDelimiter: ",",
          keyValueDelimiter: ",",
        }),
      );
    }).toThrow("Pair delimiter and key-value delimiter must be different.");

    // "=" is the default key-value delimiter, so this collides with it.
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({ source: "body", pairDelimiter: "=" }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects delimiters that contain one another", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({
          source: "body",
          pairDelimiter: "==",
          keyValueDelimiter: "=",
        }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects quotes in a delimiter and a whitespace-only key-value delimiter", () => {
    for (const config of [
      { source: "body", pairDelimiter: '"' },
      { source: "body", keyValueDelimiter: " " },
      { source: "body", keyValueDelimiter: 5 },
    ]) {
      expect(() => {
        return validateLogPipelineProcessor(
          keyValueProcessor(config as unknown as JSONObject),
        );
      }).toThrow(BadDataException);
    }
  });

  it("holds the target prefix and source to the grok rules", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({ source: "body", targetPrefix: "my prefix" }),
      );
    }).toThrow(BadDataException);

    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({ source: 12 } as unknown as JSONObject),
      );
    }).toThrow("Source field must be text.");
  });

  it("rejects an override flag that is not a boolean", () => {
    expect(() => {
      return validateLogPipelineProcessor(
        keyValueProcessor({
          source: "body",
          overrideOnConflict: "yes",
        } as unknown as JSONObject),
      );
    }).toThrow("Override on conflict must be true or false.");
  });

  it("rejects a configuration string that is not JSON", () => {
    expect(() => {
      return validateLogPipelineProcessor(keyValueProcessor("{not json"));
    }).toThrow("Processor configuration is not valid JSON.");
  });
});
