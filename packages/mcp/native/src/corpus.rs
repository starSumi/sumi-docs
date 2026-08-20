use anyhow::{Context, Result, bail};
use markdown::mdast::Node;
use markdown::{Constructs, ParseOptions, to_mdast};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub path: String,
    pub title: String,
    pub content: String,
    pub headings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub headings: Vec<String>,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParityCases {
    pub queries: Vec<String>,
    pub fetch_paths: Vec<String>,
    pub openapi_endpoints: Vec<Option<String>>,
}

#[derive(Debug, Serialize)]
pub struct ParitySnapshot {
    pub documents: Vec<Document>,
    pub searches: BTreeMap<String, Vec<SearchResult>>,
    pub fetches: BTreeMap<String, Option<Document>>,
    pub openapi: BTreeMap<String, Option<Value>>,
}

#[derive(Debug, Default)]
pub struct Corpus {
    documents: BTreeMap<String, ParsedDocument>,
    openapi: Option<Value>,
}

#[derive(Debug, Clone)]
struct ParsedDocument {
    title: String,
    content: String,
    headings: Vec<Heading>,
    frontmatter: Option<Map<String, Value>>,
}

impl Corpus {
    pub fn load_directory(docs_root: &Path, openapi_path: &Path) -> Result<Self> {
        let mut paths = Vec::new();
        collect_documents(docs_root, docs_root, &mut paths)?;
        paths.sort();

        let mut documents = BTreeMap::new();
        for (key, path) in paths {
            let raw = fs::read_to_string(&path)
                .with_context(|| format!("failed to read document {key}"))?;
            documents.insert(key, parse_markdown(&raw)?);
        }

        let raw_openapi = fs::read_to_string(openapi_path).context("failed to read OpenAPI")?;
        let openapi: Value = serde_json::from_str(&raw_openapi).context("invalid OpenAPI JSON")?;
        validate_openapi(&openapi)?;

        Ok(Self {
            documents,
            openapi: Some(openapi),
        })
    }

    pub fn list_documents(&self) -> Vec<Document> {
        self.documents
            .iter()
            .map(|(path, document)| document.to_public(path))
            .collect()
    }

    pub fn get_document(&self, path: &str) -> Option<Document> {
        self.documents
            .get(path)
            .map(|document| document.to_public(path))
    }

    pub fn search(&self, query: &str, max_results: usize) -> Vec<SearchResult> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Vec::new();
        }

        let mut results = self
            .documents
            .iter()
            .filter_map(|(path, document)| {
                let lower_content = document.content.to_lowercase();
                let lower_title = document.title.to_lowercase();
                if !lower_content.contains(&query) && !lower_title.contains(&query) {
                    return None;
                }

                let score = relevance_score(document, &query);
                Some((
                    score,
                    SearchResult {
                        path: path.clone(),
                        title: document.title.clone(),
                        headings: document
                            .headings
                            .iter()
                            .map(|heading| heading.text.clone())
                            .collect(),
                        snippet: extract_snippet(&document.content, &query, 200),
                    },
                ))
            })
            .collect::<Vec<_>>();

        results.sort_by(|(left_score, left), (right_score, right)| {
            right_score
                .cmp(left_score)
                .then_with(|| left.path.cmp(&right.path))
        });
        results
            .into_iter()
            .take(max_results)
            .map(|(_, result)| result)
            .collect()
    }

    pub fn get_openapi(&self, endpoint: Option<&str>) -> Option<Value> {
        let mut spec = self.openapi.clone()?;
        let Some(endpoint) = endpoint else {
            return Some(spec);
        };
        let paths = spec.get("paths")?.as_object()?;
        let filtered = paths
            .iter()
            .filter(|(path, _)| *path == endpoint || path.starts_with(endpoint))
            .map(|(path, item)| (path.clone(), item.clone()))
            .collect();
        spec.as_object_mut()?
            .insert("paths".to_owned(), Value::Object(filtered));
        Some(spec)
    }
}

impl ParsedDocument {
    fn to_public(&self, path: &str) -> Document {
        Document {
            path: path.to_owned(),
            title: self.title.clone(),
            content: self.content.clone(),
            headings: self
                .headings
                .iter()
                .map(|heading| heading.text.clone())
                .collect(),
            frontmatter: self.frontmatter.clone(),
        }
    }
}

pub fn create_parity_snapshot(fixture_root: &Path) -> Result<ParitySnapshot> {
    let raw_cases = fs::read_to_string(fixture_root.join("cases.json"))
        .context("failed to read parity cases")?;
    let cases: ParityCases = serde_json::from_str(&raw_cases).context("invalid parity cases")?;
    let corpus = Corpus::load_directory(
        &fixture_root.join("docs"),
        &fixture_root.join("openapi.json"),
    )?;

    let searches = cases
        .queries
        .into_iter()
        .map(|query| {
            let results = corpus.search(&query, 10);
            (query, results)
        })
        .collect();
    let fetches = cases
        .fetch_paths
        .into_iter()
        .map(|path| {
            let document = corpus.get_document(&path);
            (path, document)
        })
        .collect();
    let openapi = cases
        .openapi_endpoints
        .into_iter()
        .map(|endpoint| {
            let key = endpoint.clone().unwrap_or_else(|| "<full>".to_owned());
            (key, corpus.get_openapi(endpoint.as_deref()))
        })
        .collect();

    Ok(ParitySnapshot {
        documents: corpus.list_documents(),
        searches,
        fetches,
        openapi,
    })
}

fn collect_documents(
    root: &Path,
    current: &Path,
    output: &mut Vec<(String, PathBuf)>,
) -> Result<()> {
    let mut entries = fs::read_dir(current)
        .with_context(|| format!("failed to read corpus directory {}", current.display()))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_documents(root, &path, output)?;
        } else if file_type.is_file() && is_markdown(&path) {
            let key = path
                .strip_prefix(root)?
                .to_string_lossy()
                .replace('\\', "/");
            output.push((key, path));
        }
    }
    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("mdx")
        })
}

fn parse_markdown(raw: &str) -> Result<ParsedDocument> {
    let mut constructs = Constructs::gfm();
    constructs.frontmatter = true;
    let options = ParseOptions {
        constructs,
        ..ParseOptions::default()
    };
    let tree = to_mdast(raw, &options)
        .map_err(|message| anyhow::anyhow!("failed to parse Markdown: {message}"))?;
    let children = tree.children().map(Vec::as_slice).unwrap_or_default();
    let frontmatter: Option<Map<String, Value>> = children.iter().find_map(parse_frontmatter);
    let mut headings = Vec::new();
    collect_headings(&tree, &mut headings);
    let content = normalize_whitespace(
        &children
            .iter()
            .filter(|node| !matches!(node, Node::Yaml(_) | Node::Toml(_)))
            .map(node_text)
            .collect::<Vec<_>>()
            .join(" "),
    );
    let title = frontmatter
        .as_ref()
        .and_then(|values| values.get("title"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            headings
                .iter()
                .find(|heading| heading.level == 1)
                .or_else(|| headings.first())
                .map(|heading| heading.text.clone())
        })
        .unwrap_or_else(|| "Untitled Document".to_owned());

    Ok(ParsedDocument {
        title,
        content,
        headings,
        frontmatter,
    })
}

fn parse_frontmatter(node: &Node) -> Option<Map<String, Value>> {
    let Node::Yaml(yaml) = node else {
        return None;
    };
    let parsed: Value = serde_yaml_ng::from_str(&yaml.value).ok()?;
    parsed.as_object().cloned()
}

fn collect_headings(node: &Node, output: &mut Vec<Heading>) {
    if let Node::Heading(heading) = node
        && heading.depth <= 3
    {
        output.push(Heading {
            level: heading.depth,
            text: normalize_whitespace(&node_text(node)),
        });
    }
    if let Some(children) = node.children() {
        for child in children {
            collect_headings(child, output);
        }
    }
}

fn node_text(node: &Node) -> String {
    match node {
        Node::Text(text) => text.value.clone(),
        Node::Code(code) => code.value.clone(),
        Node::InlineCode(code) => code.value.clone(),
        Node::Break(_) => "\n".to_owned(),
        Node::Html(html) => strip_html_tags(&html.value),
        Node::Yaml(_)
        | Node::Toml(_)
        | Node::MdxjsEsm(_)
        | Node::MdxFlowExpression(_)
        | Node::MdxTextExpression(_) => String::new(),
        _ => node
            .children()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(node_text)
            .collect(),
    }
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::new();
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    output
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn relevance_score(document: &ParsedDocument, query: &str) -> usize {
    let lower_content = document.content.to_lowercase();
    let mut score = lower_content.match_indices(query).count();
    for (index, heading) in document.headings.iter().enumerate() {
        if heading.text.to_lowercase().contains(query) {
            score += if index == 0 { 10 } else { 5 };
        }
    }
    score
}

fn extract_snippet(text: &str, query: &str, max_length: usize) -> String {
    let lower = text.to_lowercase();
    let Some(byte_index) = lower.find(query) else {
        return truncate_chars(text, max_length);
    };
    let match_index = lower[..byte_index].encode_utf16().count();
    let query_length = query.encode_utf16().count();
    let text_length = text.encode_utf16().count();
    let before = (max_length.saturating_sub(query_length)) / 2;
    let start = match_index.saturating_sub(before);
    let end = (start + max_length).min(text_length);
    let mut snippet = slice_utf16(text, start, end).trim().to_owned();
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < text_length {
        snippet.push_str("...");
    }
    snippet
}

fn truncate_chars(text: &str, max_length: usize) -> String {
    let text_length = text.encode_utf16().count();
    let end = text_length.min(max_length);
    let mut snippet = slice_utf16(text, 0, end).trim().to_owned();
    if end < text_length {
        snippet.push_str("...");
    }
    snippet
}

fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    String::from_utf16_lossy(
        &text
            .encode_utf16()
            .skip(start)
            .take(end.saturating_sub(start))
            .collect::<Vec<_>>(),
    )
}

fn validate_openapi(spec: &Value) -> Result<()> {
    let Some(object) = spec.as_object() else {
        bail!("OpenAPI document must be an object");
    };
    let Some(version) = object.get("openapi").and_then(Value::as_str) else {
        bail!("OpenAPI document is missing openapi");
    };
    if !version.starts_with("3.") {
        bail!("only OpenAPI 3.x is supported");
    }
    if !object.get("info").is_some_and(Value::is_object)
        || !object.get("paths").is_some_and(Value::is_object)
    {
        bail!("OpenAPI document is missing info or paths");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_snippet, normalize_whitespace};

    #[test]
    fn normalizes_unicode_whitespace() {
        assert_eq!(normalize_whitespace(" A\n  安装\tB "), "A 安装 B");
    }

    #[test]
    fn snippets_preserve_utf16_boundaries() {
        assert_eq!(
            extract_snippet("prefix 安装 suffix", "安装", 200),
            "prefix 安装 suffix"
        );
    }
}
