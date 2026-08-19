import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

test("local preview serves read-only extensionless document URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-preview-"));
  await mkdir(join(root, "guides"), { recursive: true });
  await writeFile(join(root, "guide.md"), "# Guide\n\nLocal preview.");
  await writeFile(join(root, "guides", "api.mdx"), "# API\n\nMDX content.");

  const child = spawn(
    process.execPath,
    ["scripts/preview-docs.js", "--docs", root, "--port", "0"],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
  );
  const stderr: string[] = [];

  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`Preview startup timed out: ${stderr.join("")}`)),
        5_000,
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(
          new Error(
            `Preview exited before startup with code ${code}: ${stderr.join("")}`,
          ),
        ),
      );
      const lines = createInterface({ input: child.stderr });
      lines.on("line", (line) => {
        stderr.push(`${line}\n`);
        const match = line.match(
          /Preview server listening at (http:\/\/127\.0\.0\.1:\d+\/)/,
        );
        if (!match?.[1]) return;
        clearTimeout(timer);
        lines.close();
        resolve(match[1]);
      });
    });

    const index = await fetch(baseUrl);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /guide\n/);
    assert.match(
      index.headers.get("content-security-policy") ?? "",
      /default-src 'none'/,
    );

    const manifest = await fetch(new URL("sumi-docs-manifest.json", baseUrl));
    assert.equal(manifest.status, 200);
    assert.deepEqual(await manifest.json(), {
      version: 1,
      documents: ["guide.md", "guides/api.mdx"],
    });

    const rawMarkdown = await fetch(new URL("guide.md", baseUrl));
    assert.equal(rawMarkdown.status, 200);
    assert.match(await rawMarkdown.text(), /Local preview/);

    const markdown = await fetch(new URL("guide", baseUrl));
    assert.equal(markdown.status, 200);
    assert.equal(
      markdown.headers.get("content-type"),
      "text/markdown; charset=utf-8",
    );
    assert.match(await markdown.text(), /Local preview/);

    const mdx = await fetch(new URL("guides/api", baseUrl), { method: "HEAD" });
    assert.equal(mdx.status, 200);
    assert.equal(await mdx.text(), "");

    const writeAttempt = await fetch(new URL("guide", baseUrl), {
      method: "POST",
    });
    assert.equal(writeAttempt.status, 405);

    const traversal = await fetch(new URL("..%2F..%2Fpackage.json", baseUrl));
    assert.equal(traversal.status, 404);
    assert.doesNotMatch(await traversal.text(), /Zero_Base|sumi-docs/i);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    await rm(root, { recursive: true, force: true });
  }
});
