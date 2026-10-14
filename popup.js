"use strict";

const textarea = document.querySelector("#url-list");
const status = document.querySelector("#status");
const count = document.querySelector("#count");
const openButton = document.querySelector("#open-tabs");
const LIMIT = 100;
document.querySelector('#encrypted-transfer').addEventListener('click', () => browser.tabs.create({url: browser.runtime.getURL('transfer.html')}));

function parseLinks(raw) {
  const seen = new Set();
  const urls = [];
  // Each line may contain a naked URL, a Markdown link, or surrounding text.
  // Only the first URL from a line is accepted to avoid surprising behavior.
  for (const line of raw.split(/\r?\n/)) {
    const matches = line.match(/https?:\/\/[^\s<>"']+/i);
    if (!matches) continue;
    const candidate = matches[0].replace(/[),.;\]]+$/, "");
    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (!seen.has(url.href)) {
        seen.add(url.href);
        urls.push(url.href);
      }
    } catch (_) {
      // Ignore invalid links, rather than opening a confusing error page.
    }
  }
  return urls;
}

function say(message, isError = false) {
  status.textContent = message;
  status.className = isError ? "error" : "";
}

function updateCount() {
  const urls = parseLinks(textarea.value);
  count.textContent = `${urls.length} valid link${urls.length === 1 ? "" : "s"}`;
  openButton.disabled = urls.length === 0;
  if (urls.length > LIMIT) say(`Only the first ${LIMIT} links will be opened.`, true);
  else say("");
}

async function copyTabs(all) {
  try {
    const tabs = await browser.tabs.query({currentWindow: true, ...(!all && {highlighted: true})});
    const urls = tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => t.url)
      .filter((url) => {
        try { return ["http:", "https:"].includes(new URL(url).protocol); }
        catch (_) { return false; }
      });
    if (!urls.length) return say("No regular website tabs found to copy.", true);
    await navigator.clipboard.writeText(urls.join("\n"));
    say(`Copied ${urls.length} URL${urls.length === 1 ? "" : "s"} to clipboard.`);
  } catch (error) {
    say(`Copy failed: ${error.message}`, true);
  }
}

document.querySelector("#copy-selected").addEventListener("click", () => copyTabs(false));
document.querySelector("#copy-all").addEventListener("click", () => copyTabs(true));
textarea.addEventListener("input", updateCount);

openButton.addEventListener("click", async () => {
  const urls = parseLinks(textarea.value).slice(0, LIMIT);
  if (!urls.length) return;
  openButton.disabled = true;
  let opened = 0;
  try {
    for (const url of urls) {
      await browser.tabs.create({url, active: false});
      opened += 1;
    }
    say(`Opened ${opened} tab${opened === 1 ? "" : "s"}.`);
  } catch (error) {
    say(`Opened ${opened} tabs. Stopped because: ${error.message}`, true);
  } finally {
    openButton.disabled = false;
  }
});

updateCount();
