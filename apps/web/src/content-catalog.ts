const DOCUMENT_PATH = /^[a-zA-Z0-9_/-]+\.mdx?$/;
const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SIDEBAR_SLUG = /^[a-zA-Z0-9_/-]+$/;

type TranslationMap = Record<string, string>;

interface CatalogVariant {
  locale: string;
  source: string;
  route: string;
}

interface CatalogSection {
  id: string;
  order: number;
  label: string;
  translations?: TranslationMap;
}

interface CatalogDocument {
  id: string;
  sectionId: string;
  order: number;
  sidebarSlug: string;
  label: string;
  translations?: TranslationMap;
  variants: CatalogVariant[];
}

export interface ContentCatalog {
  defaultLocale: string;
  locales: string[];
  sections: CatalogSection[];
  documents: CatalogDocument[];
}

interface BilingualDocumentInput extends Omit<
  CatalogDocument,
  "translations" | "variants"
> {
  translation: string;
  english: Omit<CatalogVariant, "locale">;
  chinese: Omit<CatalogVariant, "locale">;
}

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field '${unknown}'.`);
}

function assertIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a stable lowercase identifier.`);
  }
}

function assertOrder(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function normalizeTranslations(
  value: TranslationMap | undefined,
  label: string,
): TranslationMap | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a locale-to-label object.`);
  }
  const translations = Object.fromEntries(
    Object.entries(value)
      .map(([locale, translation]) => {
        if (typeof translation !== "string" || translation.length === 0) {
          throw new Error(`${label} values must be non-empty strings.`);
        }
        return [Intl.getCanonicalLocales(locale)[0], translation];
      })
      .sort(([left], [right]) => left.localeCompare(right, "en")),
  );
  return translations;
}

function normalizeRoute(value: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error("Catalog route must be a normalized absolute site path.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeSource(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    !DOCUMENT_PATH.test(value) ||
    value.startsWith("/") ||
    value.includes("//") ||
    value.split("/").includes("..")
  ) {
    throw new Error(
      "Catalog source must be a restricted relative Markdown path.",
    );
  }
  return value;
}

export function defineContentCatalog(input: ContentCatalog): ContentCatalog {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Content catalog must be an object.");
  }
  assertExactKeys(
    input,
    ["defaultLocale", "locales", "sections", "documents"],
    "Content catalog",
  );
  if (!Array.isArray(input.locales) || input.locales.length === 0) {
    throw new Error("Content catalog requires at least one locale.");
  }
  const locales = input.locales.map((locale) => {
    if (typeof locale !== "string") {
      throw new Error("Catalog locales must be strings.");
    }
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (canonical !== locale) {
      throw new Error(`Catalog locale '${locale}' must be canonical.`);
    }
    return canonical;
  });
  if (new Set(locales).size !== locales.length) {
    throw new Error("Content catalog contains duplicate locales.");
  }
  if (!locales.includes(input.defaultLocale)) {
    throw new Error("Catalog defaultLocale must be declared in locales.");
  }

  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new Error("Content catalog requires at least one section.");
  }
  const sectionIds = new Set<string>();
  const sectionOrders = new Set<number>();
  const sections = input.sections.map((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error("Catalog sections must be objects.");
    }
    assertExactKeys(
      section,
      ["id", "order", "label", "translations"],
      "Catalog section",
    );
    assertIdentifier(section.id, "Catalog section id");
    assertOrder(section.order, "Catalog section order");
    if (typeof section.label !== "string" || section.label.length === 0) {
      throw new Error("Catalog section label must be a non-empty string.");
    }
    if (sectionIds.has(section.id) || sectionOrders.has(section.order)) {
      throw new Error("Catalog section ids and orders must be unique.");
    }
    sectionIds.add(section.id);
    sectionOrders.add(section.order);
    return {
      id: section.id,
      order: section.order,
      label: section.label,
      ...(section.translations && {
        translations: normalizeTranslations(
          section.translations,
          "Catalog section translations",
        ),
      }),
    };
  });

  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    throw new Error("Content catalog requires at least one document.");
  }
  const documentIds = new Set<string>();
  const sidebarSlugs = new Set<string>();
  const sources = new Set<string>();
  const routes = new Set<string>();
  const sectionDocumentOrders = new Set<string>();
  const documents = input.documents.map((document) => {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Catalog documents must be objects.");
    }
    assertExactKeys(
      document,
      [
        "id",
        "sectionId",
        "order",
        "sidebarSlug",
        "label",
        "translations",
        "variants",
      ],
      "Catalog document",
    );
    assertIdentifier(document.id, "Catalog document id");
    assertIdentifier(document.sectionId, "Catalog document sectionId");
    assertOrder(document.order, "Catalog document order");
    if (!sectionIds.has(document.sectionId)) {
      throw new Error(`Unknown catalog section '${document.sectionId}'.`);
    }
    if (
      typeof document.sidebarSlug !== "string" ||
      document.sidebarSlug.length === 0 ||
      !SIDEBAR_SLUG.test(document.sidebarSlug) ||
      document.sidebarSlug.startsWith("/") ||
      document.sidebarSlug.includes("//") ||
      document.sidebarSlug.split("/").includes("..")
    ) {
      throw new Error("Catalog sidebarSlug must be a non-empty string.");
    }
    if (typeof document.label !== "string" || document.label.length === 0) {
      throw new Error("Catalog document label must be a non-empty string.");
    }
    const orderKey = `${document.sectionId}\0${document.order}`;
    if (documentIds.has(document.id)) {
      throw new Error(`Duplicate catalog document id '${document.id}'.`);
    }
    if (sidebarSlugs.has(document.sidebarSlug)) {
      throw new Error(
        `Duplicate catalog sidebar slug '${document.sidebarSlug}'.`,
      );
    }
    if (sectionDocumentOrders.has(orderKey)) {
      throw new Error("Document orders must be unique within each section.");
    }
    documentIds.add(document.id);
    sidebarSlugs.add(document.sidebarSlug);
    sectionDocumentOrders.add(orderKey);

    if (!Array.isArray(document.variants)) {
      throw new Error("Catalog document variants must be an array.");
    }
    const variantLocales = new Set<string>();
    const variants = document.variants.map((variant) => {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        throw new Error("Catalog variants must be objects.");
      }
      assertExactKeys(
        variant,
        ["locale", "source", "route"],
        "Catalog variant",
      );
      if (!locales.includes(variant.locale)) {
        throw new Error(`Undeclared catalog locale '${variant.locale}'.`);
      }
      const source = normalizeSource(variant.source);
      const route = normalizeRoute(variant.route);
      if (
        variantLocales.has(variant.locale) ||
        sources.has(source) ||
        routes.has(route)
      ) {
        throw new Error(
          "Catalog variant locales, source paths, and routes must be unique.",
        );
      }
      variantLocales.add(variant.locale);
      sources.add(source);
      routes.add(route);
      return { locale: variant.locale, source, route };
    });
    for (const locale of locales) {
      if (!variantLocales.has(locale)) {
        throw new Error(
          `Catalog document '${document.id}' is missing locale '${locale}'.`,
        );
      }
    }
    return {
      id: document.id,
      sectionId: document.sectionId,
      order: document.order,
      sidebarSlug: document.sidebarSlug,
      label: document.label,
      ...(document.translations && {
        translations: normalizeTranslations(
          document.translations,
          "Catalog document translations",
        ),
      }),
      variants,
    };
  });

  return {
    defaultLocale: input.defaultLocale,
    locales,
    sections: sections.sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id, "en"),
    ),
    documents: documents.sort((left, right) => {
      const leftSection = sections.find(({ id }) => id === left.sectionId);
      const rightSection = sections.find(({ id }) => id === right.sectionId);
      return (
        leftSection!.order - rightSection!.order ||
        left.order - right.order ||
        left.id.localeCompare(right.id, "en")
      );
    }),
  };
}

/**
 * Keep the browser entry point deterministic without adding UI-only metadata
 * to the machine-readable manifest. The default locale owns `/`; each locale
 * must also have one explicit index source so a localized entry cannot drift
 * into a sidebar-only page.
 */
export function assertCatalogAnchors(catalog: ContentCatalog): void {
  const variants = catalog.documents.flatMap(
    ({ variants: entries }) => entries,
  );
  const defaultRoots = variants.filter(
    ({ locale, route }) => locale === catalog.defaultLocale && route === "/",
  );
  if (defaultRoots.length !== 1) {
    throw new Error(
      `Catalog default locale '${catalog.defaultLocale}' must define exactly one root route '/'.`,
    );
  }

  for (const locale of catalog.locales) {
    const indexSources = variants.filter(
      ({ locale: variantLocale, source }) =>
        variantLocale === locale && /(?:^|\/)index\.mdx?$/u.test(source),
    );
    if (indexSources.length !== 1) {
      throw new Error(
        `Catalog locale '${locale}' must define exactly one index source.`,
      );
    }
  }
}

export function catalogSidebar(catalog: ContentCatalog) {
  return catalog.sections.map((section) => ({
    label: section.label,
    ...(section.translations && { translations: section.translations }),
    items: catalog.documents
      .filter(({ sectionId }) => sectionId === section.id)
      .map((document) => ({
        slug: document.sidebarSlug,
        label: document.label,
        ...(document.translations && {
          translations: document.translations,
        }),
      })),
  }));
}

export function catalogPublisherDocuments(catalog: ContentCatalog) {
  return catalog.locales.flatMap((locale) =>
    catalog.documents.map((document) => {
      const variant = document.variants.find(
        (entry) => entry.locale === locale,
      );
      const section = catalog.sections.find(
        ({ id }) => id === document.sectionId,
      );
      return {
        id: document.id,
        locale,
        source: variant!.source,
        page: variant!.route,
        nav: {
          sectionId: document.sectionId,
          sectionOrder: section!.order,
          order: document.order,
        },
      };
    }),
  );
}

function bilingualDocument({
  translation,
  english,
  chinese,
  ...document
}: BilingualDocumentInput): CatalogDocument {
  return {
    ...document,
    translations: { "zh-CN": translation },
    variants: [
      { locale: "en", ...english },
      { locale: "zh-CN", ...chinese },
    ],
  };
}

const documents = [
  bilingualDocument({
    id: "overview",
    sectionId: "start-here",
    order: 10,
    sidebarSlug: "index",
    label: "Overview",
    translation: "概览",
    english: { source: "index.mdx", route: "/" },
    chinese: { source: "zh-cn/index.mdx", route: "/zh-cn/" },
  }),
  bilingualDocument({
    id: "getting-started",
    sectionId: "start-here",
    order: 20,
    sidebarSlug: "getting-started",
    label: "Getting started",
    translation: "开始使用",
    english: { source: "getting-started.md", route: "/getting-started/" },
    chinese: {
      source: "zh-cn/getting-started.md",
      route: "/zh-cn/getting-started/",
    },
  }),
  bilingualDocument({
    id: "configuration",
    sectionId: "start-here",
    order: 30,
    sidebarSlug: "configuration",
    label: "Configuration",
    translation: "配置",
    english: { source: "configuration.md", route: "/configuration/" },
    chinese: {
      source: "zh-cn/configuration.md",
      route: "/zh-cn/configuration/",
    },
  }),
  bilingualDocument({
    id: "tool-reference",
    sectionId: "start-here",
    order: 40,
    sidebarSlug: "tool-reference",
    label: "MCP tool reference",
    translation: "MCP 工具参考",
    english: { source: "tool-reference.md", route: "/tool-reference/" },
    chinese: {
      source: "zh-cn/tool-reference.md",
      route: "/zh-cn/tool-reference/",
    },
  }),
  bilingualDocument({
    id: "agent-hosts",
    sectionId: "start-here",
    order: 45,
    sidebarSlug: "agent-hosts",
    label: "Agent host integration",
    translation: "Agent 宿主集成",
    english: { source: "agent-hosts.md", route: "/agent-hosts/" },
    chinese: {
      source: "zh-cn/agent-hosts.md",
      route: "/zh-cn/agent-hosts/",
    },
  }),
  bilingualDocument({
    id: "troubleshooting",
    sectionId: "start-here",
    order: 50,
    sidebarSlug: "troubleshooting",
    label: "Troubleshooting",
    translation: "故障排查",
    english: { source: "troubleshooting.md", route: "/troubleshooting/" },
    chinese: {
      source: "zh-cn/troubleshooting.md",
      route: "/zh-cn/troubleshooting/",
    },
  }),
  bilingualDocument({
    id: "remote-sources",
    sectionId: "operate",
    order: 10,
    sidebarSlug: "remote-sources",
    label: "Remote sources",
    translation: "远程文档源",
    english: { source: "remote-sources.md", route: "/remote-sources/" },
    chinese: {
      source: "zh-cn/remote-sources.md",
      route: "/zh-cn/remote-sources/",
    },
  }),
  bilingualDocument({
    id: "architecture",
    sectionId: "operate",
    order: 20,
    sidebarSlug: "architecture",
    label: "Architecture",
    translation: "架构",
    english: { source: "architecture.md", route: "/architecture/" },
    chinese: {
      source: "zh-cn/architecture.md",
      route: "/zh-cn/architecture/",
    },
  }),
  bilingualDocument({
    id: "maintainer-handoff",
    sectionId: "operate",
    order: 30,
    sidebarSlug: "operations/handoff",
    label: "Maintainer handoff",
    translation: "维护者交接",
    english: {
      source: "operations/handoff.md",
      route: "/operations/handoff/",
    },
    chinese: {
      source: "zh-cn/operations/handoff.md",
      route: "/zh-cn/operations/handoff/",
    },
  }),
  bilingualDocument({
    id: "observability",
    sectionId: "operate",
    order: 40,
    sidebarSlug: "observability",
    label: "Observability and tracking",
    translation: "可观测性与跟踪",
    english: { source: "observability.md", route: "/observability/" },
    chinese: {
      source: "zh-cn/observability.md",
      route: "/zh-cn/observability/",
    },
  }),
  bilingualDocument({
    id: "product-requirements",
    sectionId: "governance",
    order: 10,
    sidebarSlug: "product/product-requirements",
    label: "Product requirements",
    translation: "产品需求",
    english: {
      source: "product/product-requirements.md",
      route: "/product/product-requirements/",
    },
    chinese: {
      source: "zh-cn/product/product-requirements.md",
      route: "/zh-cn/product/product-requirements/",
    },
  }),
  bilingualDocument({
    id: "engineering-records",
    sectionId: "governance",
    order: 15,
    sidebarSlug: "product/engineering-records",
    label: "Engineering records",
    translation: "工程记录",
    english: {
      source: "product/engineering-records.md",
      route: "/product/engineering-records/",
    },
    chinese: {
      source: "zh-cn/product/engineering-records.md",
      route: "/zh-cn/product/engineering-records/",
    },
  }),
  bilingualDocument({
    id: "security",
    sectionId: "governance",
    order: 18,
    sidebarSlug: "security",
    label: "Security policy",
    translation: "安全策略",
    english: { source: "security.md", route: "/security/" },
    chinese: {
      source: "zh-cn/security.md",
      route: "/zh-cn/security/",
    },
  }),
  bilingualDocument({
    id: "checkpoint-protocol",
    sectionId: "governance",
    order: 20,
    sidebarSlug: "operations/checkpoints",
    label: "Checkpoint protocol",
    translation: "检查点协议",
    english: {
      source: "operations/checkpoints.md",
      route: "/operations/checkpoints/",
    },
    chinese: {
      source: "zh-cn/operations/checkpoints.md",
      route: "/zh-cn/operations/checkpoints/",
    },
  }),
  bilingualDocument({
    id: "changelog",
    sectionId: "governance",
    order: 25,
    sidebarSlug: "changelog",
    label: "Changelog",
    translation: "版本演进",
    english: { source: "changelog.md", route: "/changelog/" },
    chinese: {
      source: "zh-cn/changelog.md",
      route: "/zh-cn/changelog/",
    },
  }),
  bilingualDocument({
    id: "release-readiness",
    sectionId: "governance",
    order: 30,
    sidebarSlug: "operations/release-readiness",
    label: "Release readiness",
    translation: "发布就绪",
    english: {
      source: "operations/release-readiness.md",
      route: "/operations/release-readiness/",
    },
    chinese: {
      source: "zh-cn/operations/release-readiness.md",
      route: "/zh-cn/operations/release-readiness/",
    },
  }),
  bilingualDocument({
    id: "benchmarks",
    sectionId: "governance",
    order: 35,
    sidebarSlug: "benchmarks",
    label: "Benchmarks",
    translation: "性能基准",
    english: { source: "benchmarks.md", route: "/benchmarks/" },
    chinese: {
      source: "zh-cn/benchmarks.md",
      route: "/zh-cn/benchmarks/",
    },
  }),
  bilingualDocument({
    id: "evaluation-matrix",
    sectionId: "governance",
    order: 40,
    sidebarSlug: "operations/evaluation-matrix",
    label: "Evaluation matrix",
    translation: "评估矩阵",
    english: {
      source: "operations/evaluation-matrix.md",
      route: "/operations/evaluation-matrix/",
    },
    chinese: {
      source: "zh-cn/operations/evaluation-matrix.md",
      route: "/zh-cn/operations/evaluation-matrix/",
    },
  }),
  bilingualDocument({
    id: "standards-and-references",
    sectionId: "governance",
    order: 45,
    sidebarSlug: "standards-and-references",
    label: "Standards and references",
    translation: "规范与引用",
    english: {
      source: "standards-and-references.md",
      route: "/standards-and-references/",
    },
    chinese: {
      source: "zh-cn/standards-and-references.md",
      route: "/zh-cn/standards-and-references/",
    },
  }),
  bilingualDocument({
    id: "contributing",
    sectionId: "contribute",
    order: 10,
    sidebarSlug: "contributing",
    label: "Contributing",
    translation: "参与贡献",
    english: { source: "contributing.md", route: "/contributing/" },
    chinese: {
      source: "zh-cn/contributing.md",
      route: "/zh-cn/contributing/",
    },
  }),
  bilingualDocument({
    id: "skills-and-orchestration",
    sectionId: "contribute",
    order: 20,
    sidebarSlug: "skills-and-orchestration",
    label: "Skills and orchestration",
    translation: "Skills 与编排",
    english: {
      source: "skills-and-orchestration.md",
      route: "/skills-and-orchestration/",
    },
    chinese: {
      source: "zh-cn/skills-and-orchestration.md",
      route: "/zh-cn/skills-and-orchestration/",
    },
  }),
  bilingualDocument({
    id: "development",
    sectionId: "contribute",
    order: 30,
    sidebarSlug: "development",
    label: "Development",
    translation: "开发",
    english: { source: "development.md", route: "/development/" },
    chinese: {
      source: "zh-cn/development.md",
      route: "/zh-cn/development/",
    },
  }),
  bilingualDocument({
    id: "releasing",
    sectionId: "contribute",
    order: 40,
    sidebarSlug: "releasing",
    label: "Releasing",
    translation: "发布",
    english: { source: "releasing.md", route: "/releasing/" },
    chinese: { source: "zh-cn/releasing.md", route: "/zh-cn/releasing/" },
  }),
];

export const contentCatalog = defineContentCatalog({
  defaultLocale: "en",
  locales: ["en", "zh-CN"],
  sections: [
    {
      id: "start-here",
      order: 10,
      label: "Start here",
      translations: { "zh-CN": "从这里开始" },
    },
    {
      id: "operate",
      order: 20,
      label: "Operate",
      translations: { "zh-CN": "运行与维护" },
    },
    {
      id: "governance",
      order: 25,
      label: "Product and quality",
      translations: { "zh-CN": "产品与质量" },
    },
    {
      id: "contribute",
      order: 30,
      label: "Contribute",
      translations: { "zh-CN": "参与贡献" },
    },
  ],
  documents,
});

assertCatalogAnchors(contentCatalog);
