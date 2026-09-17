import {
  CLOUD_INSTANCE_IDENTITY_ATTRIBUTES,
  CloudInstanceAttributeGetter,
  resolveCloudInstanceName,
  shortenEcsTaskArn,
} from "../../../Utils/Telemetry/CloudInstanceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * resolveCloudInstanceName is what both ingest paths (the resource-attribute
 * walk that registers an instance, and the metric snapshot fold that writes
 * its CPU / memory) use to decide what "one instance" is. If the two ever
 * disagreed the snapshot would land on a row nobody links to, so the chain
 * — its order, its ARN shortening and its blank-skipping — is pinned here
 * once, and the ingest suites only check that they call it.
 */

const TASK_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:task/my-cluster/1a2b3c4d5e6f7a8b9c0d";
const TASK_ID: string = "1a2b3c4d5e6f7a8b9c0d";

/*
 * A getter over a plain record; the record keys are the bare semconv keys
 * because that is what the chain hands the getter.
 */
function getterFor(
  attributes: Record<string, string | null | undefined>,
): CloudInstanceAttributeGetter {
  return (key: string): string | null => {
    const value: string | null | undefined = attributes[key];
    return value === undefined ? null : value;
  };
}

describe("CLOUD_INSTANCE_IDENTITY_ATTRIBUTES", () => {
  test("is ordered platform identity first, then service.instance.id, then the generic fallbacks", () => {
    /*
     * Pinned literally: the docs for every platform name the attribute that
     * identifies a task there, and the descriptor registry mirrors this
     * order. Reordering silently changes which value existing rows key on.
     * The platform ids precede service.instance.id so an SDK-minted
     * per-process id cannot split a task away from the sidecar's metrics.
     */
    expect([...CLOUD_INSTANCE_IDENTITY_ATTRIBUTES]).toEqual([
      "aws.ecs.task.id",
      "aws.ecs.task.arn",
      "faas.instance",
      "azure.container_app.instance.id",
      "service.instance.id",
      "container.id",
      "host.id",
      "host.name",
    ]);
  });

  test("has no duplicates", () => {
    expect(new Set(CLOUD_INSTANCE_IDENTITY_ATTRIBUTES).size).toBe(
      CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.length,
    );
  });
});

describe("resolveCloudInstanceName precedence", () => {
  test("the platform's task id wins over an SDK-minted service.instance.id", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({
          "service.instance.id": "svc-instance-1",
          "faas.instance": "faas-1",
          "aws.ecs.task.id": "task-1",
          "aws.ecs.task.arn": TASK_ARN,
          "container.id": "container-1",
          "host.id": "host-id-1",
          "host.name": "host-name-1",
        }),
      ),
    ).toBe("task-1");
  });

  test("service.instance.id wins when the platform sets no identity of its own", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({
          "service.instance.id": "svc-instance-1",
          "container.id": "container-1",
          "host.id": "host-id-1",
          "host.name": "host-name-1",
        }),
      ),
    ).toBe("svc-instance-1");
  });

  test.each(
    CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.map(
      (key: string, index: number): [string, number] => {
        return [key, index];
      },
    ),
  )(
    "%s is used when every attribute before it is absent",
    (key: string, index: number) => {
      /*
       * Provide this key AND every key after it, so the test proves the
       * earlier keys are what decide, not merely that this key works alone.
       */
      const attributes: Record<string, string> = {};
      for (const later of CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.slice(index)) {
        // A real ARN for the ARN slot, so the shortening is exercised in place.
        attributes[later] =
          later === "aws.ecs.task.arn" ? TASK_ARN : `value-for-${later}`;
      }

      const expected: string =
        key === "aws.ecs.task.arn" ? TASK_ID : `value-for-${key}`;
      expect(resolveCloudInstanceName(getterFor(attributes))).toBe(expected);
    },
  );

  test("asks the getter for bare semconv keys, in chain order, and stops at the first hit", () => {
    const asked: Array<string> = [];
    const name: string | null = resolveCloudInstanceName(
      (key: string): string | null => {
        asked.push(key);
        return key === "faas.instance" ? "faas-1" : null;
      },
    );

    expect(name).toBe("faas-1");
    expect(asked).toEqual([
      "aws.ecs.task.id",
      "aws.ecs.task.arn",
      "faas.instance",
    ]);
  });

  test("faas.instance identifies a Cloud Run instance", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({
          "faas.instance": "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
          "host.name": "localhost",
        }),
      ),
    ).toBe("00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b");
  });

  test("aws.ecs.task.id beats aws.ecs.task.arn and is taken verbatim", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({
          "aws.ecs.task.id": "task-id-from-attr",
          "aws.ecs.task.arn": TASK_ARN,
        }),
      ),
    ).toBe("task-id-from-attr");
  });

  test("an ECS task ARN alone resolves to the task id", () => {
    expect(
      resolveCloudInstanceName(getterFor({ "aws.ecs.task.arn": TASK_ARN })),
    ).toBe(TASK_ID);
  });

  test("returns null when nothing in the chain is present", () => {
    expect(resolveCloudInstanceName(getterFor({}))).toBeNull();
    expect(
      resolveCloudInstanceName(
        getterFor({ "service.name": "checkout", "cloud.platform": "aws_ecs" }),
      ),
    ).toBeNull();
    expect(
      resolveCloudInstanceName((): string | null => {
        return null;
      }),
    ).toBeNull();
  });

  test("skips blank and whitespace-only values and keeps walking", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({
          "service.instance.id": "",
          "faas.instance": "   ",
          "aws.ecs.task.id": "\t\n",
          "aws.ecs.task.arn": TASK_ARN,
        }),
      ),
    ).toBe(TASK_ID);

    expect(
      resolveCloudInstanceName(
        getterFor({ "service.instance.id": "", "host.name": "  " }),
      ),
    ).toBeNull();
  });

  test("trims the value it returns", () => {
    expect(
      resolveCloudInstanceName(
        getterFor({ "service.instance.id": "  svc-instance-1\n" }),
      ),
    ).toBe("svc-instance-1");
    expect(
      resolveCloudInstanceName(getterFor({ "host.name": " replica-0 " })),
    ).toBe("replica-0");
  });

  test("only aws.ecs.task.arn is shortened — an ARN-shaped value under another key is untouched", () => {
    expect(
      resolveCloudInstanceName(getterFor({ "container.id": "arn:x:y/z" })),
    ).toBe("arn:x:y/z");
  });
});

describe("shortenEcsTaskArn", () => {
  test("shortens a task ARN with a cluster path to the task id", () => {
    expect(shortenEcsTaskArn(TASK_ARN)).toBe(TASK_ID);
  });

  test("shortens the legacy task ARN format that has no cluster segment", () => {
    expect(
      shortenEcsTaskArn(
        "arn:aws:ecs:us-east-1:123456789012:task/1a2b3c4d5e6f7a8b9c0d",
      ),
    ).toBe(TASK_ID);
  });

  test("returns an ARN without a slash unchanged", () => {
    expect(shortenEcsTaskArn("arn:aws:ecs:us-east-1:123456789012:task")).toBe(
      "arn:aws:ecs:us-east-1:123456789012:task",
    );
  });

  test("returns an ARN ending in a slash unchanged rather than an empty id", () => {
    expect(
      shortenEcsTaskArn("arn:aws:ecs:us-east-1:123456789012:task/my-cluster/"),
    ).toBe("arn:aws:ecs:us-east-1:123456789012:task/my-cluster/");
  });

  test("leaves a value that is not an ARN untouched, slashes included", () => {
    expect(shortenEcsTaskArn(TASK_ID)).toBe(TASK_ID);
    expect(shortenEcsTaskArn("my-cluster/1a2b3c4d")).toBe(
      "my-cluster/1a2b3c4d",
    );
    expect(shortenEcsTaskArn("ARN:aws:ecs:x:y:task/a/b")).toBe(
      "ARN:aws:ecs:x:y:task/a/b",
    );
  });

  test("trims surrounding whitespace before deciding", () => {
    expect(shortenEcsTaskArn(`  ${TASK_ARN}\n`)).toBe(TASK_ID);
    expect(shortenEcsTaskArn("  plain-id  ")).toBe("plain-id");
    expect(shortenEcsTaskArn("   ")).toBe("");
  });
});
