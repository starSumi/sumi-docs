use anyhow::Result;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{
    ServerHandler, ServiceExt, handler::server::wrapper::Parameters, schemars, tool, tool_handler,
    tool_router, transport::stdio,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[schemars(deny_unknown_fields)]
struct EmptyArgs {}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[schemars(deny_unknown_fields)]
struct SearchArgs {
    #[schemars(length(min = 1, max = 200))]
    query: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[schemars(deny_unknown_fields)]
struct FetchArgs {
    #[schemars(pattern(r"^(?:[^./][^/]*/)*[^./][^/]*\.(?:md|mdx)$"))]
    path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[schemars(deny_unknown_fields)]
struct OpenApiArgs {
    endpoint: Option<String>,
}

#[derive(Clone)]
struct ProbeServer;

#[tool_router]
impl ProbeServer {
    #[tool(description = "R1 probe: list the documentation paths in the native runtime.")]
    fn list_docs(&self, Parameters(_args): Parameters<EmptyArgs>) -> String {
        "R1 probe: corpus loading is intentionally not implemented".to_owned()
    }

    #[tool(description = "R1 probe: search the documentation corpus lexically.")]
    fn search_docs(&self, Parameters(args): Parameters<SearchArgs>) -> String {
        format!(
            "R1 probe accepted query of {} characters",
            args.query.chars().count()
        )
    }

    #[tool(description = "R1 probe: fetch one documentation document.")]
    fn fetch_doc(&self, Parameters(args): Parameters<FetchArgs>) -> String {
        format!("R1 probe accepted document path {}", args.path)
    }

    #[tool(description = "R1 probe: return the OpenAPI projection.")]
    fn get_openapi_spec(&self, Parameters(args): Parameters<OpenApiArgs>) -> String {
        match args.endpoint {
            Some(endpoint) => format!("R1 probe accepted OpenAPI endpoint {endpoint}"),
            None => "R1 probe accepted the OpenAPI request".to_owned(),
        }
    }
}

#[tool_handler]
impl ServerHandler for ProbeServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("R1 protocol probe only. It does not load or mutate documentation.")
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter("warn")
        .init();

    let service = ProbeServer.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
