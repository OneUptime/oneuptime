"use strict";

/**
 * Scripts/Docker/FetchDataSecurityModel.js, which puts Data Security's
 * names-and-addresses model into the App's and the probe's images while they
 * are built: it must fail the build on any byte the manifest does not pin,
 * retry a download that failed, and leave of ONNX Runtime's WebAssembly
 * package exactly what the model's thread loads.
 *
 * The downloads here are a fake fetcher writing chosen bytes: no test
 * reaches the network. IronBankDataSecurityModel.test.js holds the real
 * manifest to the images and to Iron Bank's manifests.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const script = require("../../Scripts/Docker/FetchDataSecurityModel.js");

const REVISION = "8cf72739a75da1de5680ea6c30c381660e740303";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fetch-data-security-model-"));
}

function writeManifest(directory, files) {
  const manifestPath = path.join(directory, "NameAddressModel.json");

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      name: "example/model",
      revision: REVISION,
      directory: path.join(directory, "model"),
      files,
    }),
  );

  return manifestPath;
}

function fileOf(name, bytes) {
  return {
    name,
    url: `https://huggingface.co/example/model/resolve/${REVISION}/${name}`,
    sha256: sha256(bytes),
    bytes: bytes.length,
  };
}

// A fetcher that writes the bytes chosen for each URL, after failing some times.
function fakeFetcher(bytesByUrl, failures = {}) {
  const calls = [];

  const fetcher = async (url, target) => {
    calls.push(url);

    if ((failures[url] || 0) > 0) {
      failures[url]--;
      throw new Error("connection reset");
    }

    fs.writeFileSync(target, bytesByUrl[url]);
  };

  return { fetcher, calls };
}

describe("FetchDataSecurityModel", () => {
  let directory;

  beforeEach(() => {
    directory = temporaryDirectory();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("fetches every file into the manifest's directory when its size and SHA-256 are the pinned ones", async () => {
    const weights = Buffer.from("weights of the model");
    const vocabulary = Buffer.from("[PAD]\n[UNK]\n");
    const files = [
      fileOf("model_quantized.onnx", weights),
      fileOf("vocab.txt", vocabulary),
    ];
    const manifestPath = writeManifest(directory, files);
    const { fetcher, calls } = fakeFetcher({
      [files[0].url]: weights,
      [files[1].url]: vocabulary,
    });

    await script.main(["--manifest", manifestPath], fetcher);

    expect(calls).toEqual([files[0].url, files[1].url]);
    expect(
      fs.readFileSync(path.join(directory, "model", "model_quantized.onnx")),
    ).toEqual(weights);
    expect(fs.readFileSync(path.join(directory, "model", "vocab.txt"))).toEqual(
      vocabulary,
    );
    // No partial file is left behind.
    expect(fs.readdirSync(path.join(directory, "model")).sort()).toEqual([
      "model_quantized.onnx",
      "vocab.txt",
    ]);
  });

  test("fails the build on bytes the manifest does not pin, and keeps none of them", async () => {
    const pinned = Buffer.from("the pinned weights");
    const files = [fileOf("model_quantized.onnx", pinned)];
    const manifestPath = writeManifest(directory, files);
    const { fetcher } = fakeFetcher({
      [files[0].url]: Buffer.from("the pinned weightz"),
    });

    await expect(
      script.main(["--manifest", manifestPath], fetcher),
    ).rejects.toThrow(/is not the pinned file/);
    expect(fs.readdirSync(path.join(directory, "model"))).toEqual([]);
  });

  test("fails on a file of another size even when nothing else is checked first", async () => {
    const pinned = Buffer.from("abc");
    const files = [{ ...fileOf("vocab.txt", pinned), bytes: 4 }];
    const manifestPath = writeManifest(directory, files);
    const { fetcher } = fakeFetcher({ [files[0].url]: pinned });

    await expect(
      script.main(["--manifest", manifestPath], fetcher),
    ).rejects.toThrow(/3 bytes/);
  });

  test("retries a download that failed, and gives up after its attempts with the URL in the error", async () => {
    const bytes = Buffer.from("weights");
    const files = [fileOf("model_quantized.onnx", bytes)];
    const manifestPath = writeManifest(directory, files);
    const flaky = fakeFetcher({ [files[0].url]: bytes }, { [files[0].url]: 1 });

    await script.main(["--manifest", manifestPath], flaky.fetcher, {
      retryDelayInMs: 1,
    });
    expect(flaky.calls).toHaveLength(2);

    const down = fakeFetcher({ [files[0].url]: bytes }, { [files[0].url]: 99 });

    await expect(
      script.main(["--manifest", manifestPath], down.fetcher, {
        retryDelayInMs: 1,
      }),
    ).rejects.toThrow(
      `Could not fetch model_quantized.onnx from ${files[0].url}: connection reset`,
    );
    expect(down.calls).toHaveLength(4);
  });

  test("refuses a manifest whose file is not of the pinned revision, or not over https", () => {
    const bytes = Buffer.from("x");
    const otherRevision = writeManifest(directory, [
      {
        ...fileOf("vocab.txt", bytes),
        url: "https://huggingface.co/example/model/resolve/main/vocab.txt",
      },
    ]);

    expect(() => {
      script.readManifest(otherRevision);
    }).toThrow(/pinned revision/);

    const plainHttp = writeManifest(directory, [
      {
        ...fileOf("vocab.txt", bytes),
        url: `http://huggingface.co/example/model/resolve/${REVISION}/vocab.txt`,
      },
    ]);

    expect(() => {
      script.readManifest(plainHttp);
    }).toThrow(/https URL/);

    const noChecksum = writeManifest(directory, [
      { ...fileOf("vocab.txt", bytes), sha256: "" },
    ]);

    expect(() => {
      script.readManifest(noChecksum);
    }).toThrow(/SHA-256/);
  });

  test("the real manifest reads", () => {
    const manifest = script.readManifest(
      path.join(
        __dirname,
        "../../packages/Common/Server/Utils/DataSecurity/Model/NameAddressModel.json",
      ),
    );

    expect(manifest.files.length).toBeGreaterThan(0);
  });

  test("leaves of onnxruntime-web what the model's thread loads, the package's own files and its node_modules", () => {
    const runtime = path.join(directory, "onnxruntime-web");
    const files = [
      "package.json",
      "README.md",
      "types.d.ts",
      "dist/ort.node.min.js",
      "dist/ort-wasm-simd-threaded.mjs",
      "dist/ort-wasm-simd-threaded.wasm",
      "dist/ort.min.js",
      "dist/ort.all.bundle.min.mjs",
      "dist/ort-wasm-simd-threaded.jsep.wasm",
      "dist/ort-wasm-simd-threaded.asyncify.wasm",
      "dist/ort.node.min.js.map",
      "lib/index.ts",
      "lib/wasm/session-handler.ts",
      "docs/api.md",
      "node_modules/flatbuffers/package.json",
    ];

    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(runtime, file)), { recursive: true });
      fs.writeFileSync(path.join(runtime, file), file);
    }

    const removed = script.slimRuntime(runtime);
    const left = [];
    const walk = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const entryPath = path.join(folder, entry.name);

        if (entry.isDirectory()) {
          walk(entryPath);
        } else {
          left.push(path.relative(runtime, entryPath));
        }
      }
    };

    walk(runtime);

    expect(left.sort()).toEqual(
      [
        "README.md",
        "dist/ort-wasm-simd-threaded.mjs",
        "dist/ort-wasm-simd-threaded.wasm",
        "dist/ort.node.min.js",
        "node_modules/flatbuffers/package.json",
        "package.json",
        "types.d.ts",
      ].sort(),
    );
    expect(removed.sort()).toEqual(
      [
        "dist/ort.min.js",
        "dist/ort.all.bundle.min.mjs",
        "dist/ort-wasm-simd-threaded.jsep.wasm",
        "dist/ort-wasm-simd-threaded.asyncify.wasm",
        "dist/ort.node.min.js.map",
        "lib/index.ts",
        "lib/wasm/session-handler.ts",
        "docs/api.md",
      ].sort(),
    );
    // Emptied folders go.
    expect(fs.existsSync(path.join(runtime, "lib"))).toBe(false);
    expect(fs.existsSync(path.join(runtime, "docs"))).toBe(false);
  });

  test("stops when the runtime lacks a file the model's thread loads", () => {
    const runtime = path.join(directory, "onnxruntime-web");

    fs.mkdirSync(path.join(runtime, "dist"), { recursive: true });
    fs.writeFileSync(path.join(runtime, "dist", "ort.node.min.js"), "");

    expect(() => {
      script.slimRuntime(runtime);
    }).toThrow(/has no dist\/ort-wasm-simd-threaded\.mjs/);
  });

  test("the files it keeps are the ones the model's thread loads", () => {
    const worker = fs.readFileSync(
      path.join(
        __dirname,
        "../../packages/Common/Server/Utils/DataSecurity/Model/NameAddressModelWorker.cjs",
      ),
      "utf8",
    );

    // The runtime by its name (its Node entry, dist/ort.node.min.js), and the binary beside it.
    expect(worker).toContain('require("onnxruntime-web")');
    expect(worker).toContain('"ort-wasm-simd-threaded.wasm"');
    expect(script.RUNTIME_FILES).toEqual([
      "dist/ort.node.min.js",
      "dist/ort-wasm-simd-threaded.mjs",
      "dist/ort-wasm-simd-threaded.wasm",
    ]);
  });
});
