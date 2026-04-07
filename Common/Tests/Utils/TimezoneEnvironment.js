const JSDOMEnvironment = require("jest-environment-jsdom").default;

class TimezoneEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    const requestedTimezone =
      context?.docblockPragmas?.timezone?.trim() || undefined;

    const previousTimezone = process.env.TZ;

    if (requestedTimezone) {
      process.env.TZ = requestedTimezone;
    }

    super(config, context);

    this.previousTimezone = previousTimezone;
    this.requestedTimezone = requestedTimezone;
  }

  async teardown() {
    await super.teardown();

    if (!this.requestedTimezone) {
      return;
    }

    if (typeof this.previousTimezone === "string") {
      process.env.TZ = this.previousTimezone;
      return;
    }

    delete process.env.TZ;
  }
}

module.exports = TimezoneEnvironment;
