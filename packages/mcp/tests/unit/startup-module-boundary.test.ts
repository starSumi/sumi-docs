import assert from "node:assert/strict";
import { posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

test("the CLI startup chunk excludes corpus acquisition and parsing", async () => {
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    metafile: true,
    outdir: "virtual-dist",
    platform: "node",
    splitting: true,
    target: "node25",
    write: false,
  });

  const entry = Object.values(result.metafile.outputs).find(
    (output) => output.entryPoint?.replaceAll("\\", "/") === "src/index.ts",
  );
  assert.ok(entry, "expected an esbuild entry output for src/index.ts");

  const entryPath = Object.entries(result.metafile.outputs).find(
    ([, output]) => output === entry,
  )?.[0];
  assert.ok(entryPath, "expected the entry output path");

  const startupOutputs = new Set<string>();
  const pendingOutputs = [entryPath.replaceAll("\\", "/")];
  while (pendingOutputs.length > 0) {
    const outputPath = pendingOutputs.pop();
    if (!outputPath || startupOutputs.has(outputPath)) continue;
    startupOutputs.add(outputPath);

    const output = result.metafile.outputs[outputPath];
    assert.ok(output, `expected output metadata for ${outputPath}`);
    for (const imported of output.imports) {
      if (imported.external || imported.kind === "dynamic-import") continue;
      const importedPath = imported.path.replaceAll("\\", "/");
      pendingOutputs.push(
        result.metafile.outputs[importedPath]
          ? importedPath
          : posix.normalize(
              posix.join(posix.dirname(outputPath), importedPath),
            ),
      );
    }
  }

  const startupInputs = [...startupOutputs].flatMap((outputPath) =>
    Object.keys(result.metafile.outputs[outputPath]?.inputs ?? {}).map(
      (input) => input.replaceAll("\\", "/"),
    ),
  );
  const forbiddenInputs = startupInputs.filter((input) =>
    [
      "/src/vfs/",
      "/src/parser/",
      "/node_modules/remark",
      "/node_modules/unified/",
      "/node_modules/yaml/",
      "/packages/corpus-contract/",
    ].some((segment) => `/${input}`.includes(segment)),
  );

  assert.deepEqual(forbiddenInputs, []);
});
