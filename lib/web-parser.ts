import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (compatible; GeneraciaBot/1.0; +https://generacia.com)";
const FETCH_TIMEOUT = 30000; // 30s for PDFs
const MAX_PAGES = 20; // Max pages to crawl per website
const CRAWL_DELAY = 500; // Delay between requests in ms

export interface ParsedWebContent {
  title: string;
  content: string;
  tokenCount: number;
  contentType: "html" | "pdf";
  url?: string;
  pageCount?: number;
}

export interface CrawlOptions {
  crawlLinks?: boolean;
  maxPages?: number;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<{ html?: string; buffer?: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const isPdf = contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, contentType: "pdf" };
    } else {
      const html = await response.text();
      return { html, contentType: "html" };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links: Set<string> = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const url = new URL(href, baseUrl);

      // Only follow links on the same domain
      if (url.hostname !== base.hostname) return;

      // Skip anchors, javascript, mailto, etc.
      if (url.protocol !== "http:" && url.protocol !== "https:") return;

      // Skip common non-content paths
      const path = url.pathname.toLowerCase();
      if (
        path.includes("/login") ||
        path.includes("/register") ||
        path.includes("/cart") ||
        path.includes("/checkout") ||
        path.includes("/account") ||
        path.includes("/search")
      ) return;

      // Remove hash and query for deduplication
      url.hash = "";
      url.search = "";

      links.add(url.toString());
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}

function extractContent(html: string, url: string): { title: string; content: string } {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $("script").remove();
  $("style").remove();
  $("nav").remove();
  $("footer").remove();
  $("header").remove();
  $("aside").remove();
  $("noscript").remove();
  $("iframe").remove();
  $("[role='navigation']").remove();
  $("[role='banner']").remove();
  $("[role='contentinfo']").remove();
  $(".nav, .navigation, .menu, .sidebar, .footer, .header").remove();
  $("[class*='cookie']").remove();
  $("[class*='popup']").remove();
  $("[class*='modal']").remove();
  $("[class*='banner']").remove();
  $("[class*='advertisement']").remove();
  $("[class*='ad-']").remove();

  // Extract title
  let title = $("title").first().text().trim();
  if (!title) {
    title = $("h1").first().text().trim();
  }
  if (!title) {
    title = new URL(url).hostname;
  }

  // Extract main content
  let content = "";
  const mainContent = $("article, main, [role='main']").first();

  if (mainContent.length) {
    content = mainContent.text();
  } else {
    content = $("body").text();
  }

  return { title, content: normalizeText(content) };
}

export async function fetchAndParseUrl(
  url: string,
  options: CrawlOptions = {}
): Promise<ParsedWebContent> {
  const { crawlLinks = false, maxPages = MAX_PAGES } = options;

  // Validate URL
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  // Remove hash from URL
  parsedUrl.hash = "";
  const cleanUrl = parsedUrl.toString();

  const page = await fetchPage(cleanUrl);

  // Handle PDF
  if (page.contentType === "pdf" && page.buffer) {
    return parsePdf(page.buffer, cleanUrl);
  }

  if (!page.html) {
    throw new Error("Failed to fetch page content");
  }

  // Single page mode
  if (!crawlLinks) {
    const { title, content } = extractContent(page.html, cleanUrl);
    const tokenCount = Math.ceil(content.length / 4);
    return { title, content, tokenCount, contentType: "html", url: cleanUrl, pageCount: 1 };
  }

  // Crawl mode - follow links
  const visited = new Set<string>([cleanUrl]);
  const toVisit = extractLinks(page.html, cleanUrl);
  const allContent: string[] = [];
  let mainTitle = "";

  // Add first page content
  const firstPage = extractContent(page.html, cleanUrl);
  mainTitle = firstPage.title;
  allContent.push(`## ${firstPage.title}\n${firstPage.content}`);

  // Crawl additional pages
  let crawledCount = 1;
  for (const link of toVisit) {
    if (crawledCount >= maxPages) break;
    if (visited.has(link)) continue;

    visited.add(link);

    try {
      await delay(CRAWL_DELAY);
      const linkedPage = await fetchPage(link);
      crawledCount++;

      if (linkedPage.contentType === "pdf" && linkedPage.buffer) {
        // Parse PDF and add content
        const pdfContent = await parsePdf(linkedPage.buffer, link);
        allContent.push(`## ${pdfContent.title} (PDF)\n${pdfContent.content}`);
      } else if (linkedPage.html) {
        const { title, content } = extractContent(linkedPage.html, link);
        if (content.length > 100) { // Skip pages with very little content
          allContent.push(`## ${title}\n${content}`);
        }

        // Add new links to queue (but don't exceed limit)
        if (crawledCount < maxPages) {
          const newLinks = extractLinks(linkedPage.html, link);
          for (const newLink of newLinks) {
            if (!visited.has(newLink) && !toVisit.includes(newLink)) {
              toVisit.push(newLink);
            }
          }
        }
      }
    } catch (err) {
      // Skip failed pages
      console.error(`Failed to fetch ${link}:`, err);
    }
  }

  const combinedContent = allContent.join("\n\n");
  const tokenCount = Math.ceil(combinedContent.length / 4);

  return {
    title: `${mainTitle} (${crawledCount} сторінок)`,
    content: combinedContent,
    tokenCount,
    contentType: "html",
    url: cleanUrl,
    pageCount: crawledCount,
  };
}

async function parsePdf(buffer: Buffer, url: string): Promise<ParsedWebContent> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);

  const urlPath = new URL(url).pathname;
  const filename = urlPath.split("/").pop() || new URL(url).hostname;
  const title = filename.replace(/\.pdf$/i, "");

  const content = normalizeText(data.text);
  const tokenCount = Math.ceil(content.length / 4);

  return {
    title,
    content,
    tokenCount,
    contentType: "pdf",
    url,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
