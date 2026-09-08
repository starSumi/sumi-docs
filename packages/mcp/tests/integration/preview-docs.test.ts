import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

test("local preview renders safe HTML while retaining raw Markdown routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-preview-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "sumi-preview-outside-"));
  await mkdir(join(root, "guides"), { recursive: true });
  await writeFile(
    join(root, "guide.md"),
    [
      "# Guide",
      "",
      "Local preview for OPFS.",
      "",
      "[API](guides/api.mdx)",
      "",
      "<script>window.previewPwned = true</script>",
      "",
      "<Component client:load>MDX must not execute</Component>",
      "",
      "[unsafe](javascript:alert(1))",
    ].join("\n"),
  );
  await writeFile(
    join(root, "guides", "index.md"),
    "# Guides\n\nBrowse guides.",
  );
  await writeFile(
    join(root, "guides", "api.mdx"),
    "# API\n\nMDX content for OPFS.",
  );
  await writeFile(
    join(outsideRoot, "secret.md"),
    "# Private\n\nNever serve me.",
  );

  let externalSymlinkCreated = false;
  try {
    await symlink(join(outsideRoot, "secret.md"), join(root, "outside.md"));
    externalSymlinkCreated = true;
  } catch (error) {
    // Windows development environments can deny unprivileged symlink creation.
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EPERM"
    ) {
      throw error;
    }
  }

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
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    const indexHtml = await index.text();
    assert.match(indexHtml, /<!doctype html>/i);
    assert.match(indexHtml, /<style>/i);
    assert.match(indexHtml, /<form[^>]+role="search"/i);
    assert.match(indexHtml, /Guide/);
    assert.match(indexHtml, /href="\/guide"/);
    assert.match(
      index.headers.get("content-security-policy") ?? "",
      /default-src 'none'.*style-src 'unsafe-inline'/,
    );

    const manifest = await fetch(new URL("sumi-docs-manifest.json", baseUrl));
    assert.equal(manifest.status, 200);
    assert.deepEqual(await manifest.json(), {
      version: 1,
      documents: ["guide.md", "guides/api.mdx", "guides/index.md"],
    });

    const rawMarkdown = await fetch(new URL("guide.md", baseUrl));
    assert.equal(rawMarkdown.status, 200);
    const rawSource = await rawMarkdown.text();
    assert.match(rawSource, /Local preview/);
    assert.match(rawSource, /<script>window\.previewPwned = true<\/script>/);

    const markdown = await fetch(new URL("guide", baseUrl));
    assert.equal(markdown.status, 200);
    assert.equal(
      markdown.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    const markdownHtml = await markdown.text();
    assert.match(markdownHtml, /<article[^>]*>/);
    assert.match(markdownHtml, /Local preview for OPFS/);
    assert.match(markdownHtml, /href="\/guides\/api"/);
    assert.match(
      markdownHtml,
      /&lt;script&gt;window\.previewPwned = true&lt;\/script&gt;/,
    );
    assert.match(markdownHtml, /&lt;Component client:load&gt;/);
    assert.doesNotMatch(markdownHtml, /<script\b/i);
    assert.doesNotMatch(markdownHtml, /href="javascript:/i);
    assert.equal(indexHtml.includes(root), false);
    assert.equal(markdownHtml.includes(root), false);

    const guideIndex = await fetch(new URL("guides/", baseUrl));
    assert.equal(guideIndex.status, 200);
    assert.match(await guideIndex.text(), /Browse guides/);

    const guideIndexAlias = await fetch(new URL("guides/index", baseUrl));
    assert.equal(guideIndexAlias.status, 200);

    const search = await fetch(new URL("?q=OPFS", baseUrl));
    assert.equal(search.status, 200);
    assert.match(await search.text(), /Search results/);

    const escapedSearch = await fetch(
      new URL("?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", baseUrl),
    );
    assert.equal(escapedSearch.status, 200);
    assert.doesNotMatch(await escapedSearch.text(), /<img src=x onerror=/i);

    const mdx = await fetch(new URL("guides/api", baseUrl), { method: "HEAD" });
    assert.equal(mdx.status, 200);
    assert.equal(mdx.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await mdx.text(), "");

    const writeAttempt = await fetch(new URL("guide", baseUrl), {
      method: "POST",
    });
    assert.equal(writeAttempt.status, 405);

    const traversal = await fetch(new URL("..%2F..%2Fpackage.json", baseUrl));
    assert.equal(traversal.status, 404);
    assert.doesNotMatch(
      await traversal.text(),
      new RegExp(root.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")),
    );

    if (externalSymlinkCreated) {
      const symlinkEscape = await fetch(new URL("outside", baseUrl));
      assert.equal(symlinkEscape.status, 404);
      assert.doesNotMatch(await symlinkEscape.text(), /Never serve me/);
    }
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
