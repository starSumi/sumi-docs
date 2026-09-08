# Examples

`basic/` is a checked-in self-hosting corpus used by the development command and
integration suite. Its operator and architecture guides mirror the active
project documentation, alongside one MDX API guide and one OpenAPI 3.1 document.
This makes the example a real product handbook an Agent can list, search, and
fetch rather than a set of placeholder pages; synchronization is enforced by
tests.

Run the end-to-end stdio check from the repository root:

```powershell
pnpm run example:smoke
```

`clients/launcher-template.json` shows the process command and arguments used by
MCP clients that accept an `mcpServers` object. Client configuration locations
and schemas are product-specific. Replace every placeholder with an absolute
path and consult the documentation for the client you use. The optional
`--base-url` placeholder demonstrates clickable public document URLs; replace it
with the real site prefix or remove that argument pair.

`clients/remote-launcher-template.json` is the corresponding remote-source
launcher. Its positional URL is the machine-readable manifest base; its
`--base-url` is the rendered site people should open.

To exercise remote source mode without deploying a site, run `pnpm run
preview:docs` and then launch the MCP server with
`node dist/index.js serve http://127.0.0.1:4173/`. The preview generates the
remote manifest and serves the checked-in OpenAPI document. Open the root URL
to browse the styled HTML catalog; explicit `.md` and `.mdx` URLs continue to
return raw source for the remote manifest loader.
