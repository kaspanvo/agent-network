import type { PageSource } from "../src/server/tools/reader";

// Cloudflare Browser Run: a real, logged-out browser renders the page (scripts included) and returns it as
// Markdown in one request. Images, media and fonts aren't loaded; the agent only needs the words.
export function browserRunSource(browser: BrowserRun): PageSource {
  return {
    async fetch(url) {
      const response = await browser.quickAction("markdown", {
        url: url.href,
        gotoOptions: { timeout: 20_000, waitUntil: "networkidle2" },
        rejectResourceTypes: ["image", "media", "font"],
      });
      const body = (await response.json()) as BrowserRunMarkdownSuccessResponse | BrowserRunErrorResponse;
      if (!body.success) throw new Error(`The page couldn't be opened: ${body.errors[0]?.message ?? response.status}.`);
      return { url: body.meta.finalUrl ?? url.href, title: body.meta.title || url.hostname, text: markdownToText(body.result) };
    },
  };
}

// The words only: no front matter, link targets, images or heading marks.
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
