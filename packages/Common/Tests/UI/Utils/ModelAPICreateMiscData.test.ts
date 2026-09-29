import { afterEach, describe, expect, test } from "@jest/globals";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * A model's form sends extra, non-column values (the note a user writes when
 * they change an incident state, for one) under `miscDataProps`. Anything
 * creating a model outside of a form — the bulk "Change State" action on the
 * event tables — goes through ModelAPI.create, so create has to forward that
 * payload too. It used to hard-code an empty object, which quietly dropped
 * every note a bulk action tried to send.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "019acd20-1111-4111-8111-111111111111",
);

function buildStateTimeline(): IncidentStateTimeline {
  const stateTimeline: IncidentStateTimeline = new IncidentStateTimeline();
  stateTimeline.projectId = PROJECT_ID;

  return stateTimeline;
}

describe("ModelAPI.create miscDataProps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("forwards miscDataProps to the create request", async () => {
    const createOrUpdate: jest.SpyInstance = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({} as never);

    const miscDataProps: JSONObject = {
      publicNote: "Rolled back the bad deploy.",
    };

    await ModelAPI.create<IncidentStateTimeline>({
      model: buildStateTimeline(),
      modelType: IncidentStateTimeline,
      miscDataProps: miscDataProps,
    });

    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    expect(createOrUpdate.mock.calls[0]![0].miscDataProps).toEqual({
      publicNote: "Rolled back the bad deploy.",
    });
    expect(createOrUpdate.mock.calls[0]![0].formType).toBe(FormType.Create);
  });

  test("sends an empty payload when the caller has nothing extra to send", async () => {
    const createOrUpdate: jest.SpyInstance = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({} as never);

    await ModelAPI.create<IncidentStateTimeline>({
      model: buildStateTimeline(),
      modelType: IncidentStateTimeline,
    });

    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    expect(createOrUpdate.mock.calls[0]![0].miscDataProps).toEqual({});
  });

  test("keeps forwarding request options alongside miscDataProps", async () => {
    const createOrUpdate: jest.SpyInstance = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({} as never);

    await ModelAPI.create<IncidentStateTimeline>({
      model: buildStateTimeline(),
      modelType: IncidentStateTimeline,
      miscDataProps: { privateNote: "Internal only." },
      requestOptions: {
        requestHeaders: {
          "x-test": "1",
        },
      },
    });

    expect(createOrUpdate.mock.calls[0]![0].miscDataProps).toEqual({
      privateNote: "Internal only.",
    });
    expect(createOrUpdate.mock.calls[0]![0].requestOptions).toEqual({
      requestHeaders: {
        "x-test": "1",
      },
    });
  });
});
