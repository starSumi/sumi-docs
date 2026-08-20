use anyhow::{Context, Result};
use std::path::PathBuf;
use sumi_docs_mcp_native_probe::corpus::create_parity_snapshot;

fn main() -> Result<()> {
    let fixture_root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("usage: corpus_snapshot <fixture-root>")?;
    let snapshot = create_parity_snapshot(&fixture_root)?;
    println!("{}", serde_json::to_string(&snapshot)?);
    Ok(())
}
