import assert from "node:assert/strict"
import { test } from "node:test"
import { barChart, compact, escape, feed, headline, markdown, niceTicks, normalize, page, versus } from "./build.mjs"

test("notes: headings, lists, inline code and links; HTML in the text stays text", () => {
  const html = markdown("## Новое\n- Читает **Word** и `PDF`\n- [Сайт](https://codemama.ru)\n\nАбзац <script>x</script>")
  assert.match(html, /<h3>Новое<\/h3>/)
  assert.match(html, /<li>Читает <strong>Word<\/strong> и <code>PDF<\/code><\/li>/)
  assert.match(html, /<a href="https:\/\/codemama.ru">Сайт<\/a>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(markdown("[x](javascript:alert(1))"), /href/)
})

test("leads: a ratio from 1.5, a percent below it, nothing when ours is not ahead", () => {
  assert.equal(versus("credits", 37.75, 151.97, "Claude Code"), "в 4 раза дешевле, чем Claude Code")
  assert.equal(versus("medianSeconds", 37, 46, "Claude Code"), "на 20 % быстрее, чем Claude Code")
  assert.equal(versus("medianSeconds", 37, 37, "opencode"), null)
  assert.equal(versus("passed", 25, 24, "opencode"), null)
  const tie = headline({ metric: "passed", rows: [{ agent: "CodeMama", ours: true, value: 25 }, { agent: "B", value: 25 }] }, 25)
  assert.equal(tie.title, "Все решили 25 из 25")
  const lead = headline({ metric: "credits", unit: "кредитов", rows: [{ agent: "CodeMama", ours: true, value: 37.75 }, { agent: "A", value: 47.06 }, { agent: "B", value: 151.97 }] }, 25)
  assert.equal(lead.title, "В 4 раза дешевле, чем B")
  assert.match(lead.lines[0], /на 20 % дешевле, чем A/)
})

test("bars: ours first and marked, names escaped, every bar labelled", () => {
  const svg = barChart({ title: "Время", metric: "medianSeconds", unit: "с", better: "lower", rows: [{ agent: "<b>", value: 46 }, { agent: "CodeMama", ours: true, value: 37 }] }, 25)
  assert.ok(svg.indexOf("CodeMama") < svg.indexOf("&lt;b&gt;"))
  assert.match(svg, /class="mark ours"/)
  assert.equal(svg.match(/class="value"/g).length, 2)
  assert.doesNotMatch(svg, /<b>/)
})

test("ticks start at zero and reach the top", () => {
  assert.deepEqual(niceTicks(25), [0, 5, 10, 15, 20, 25])
  assert.equal(niceTicks(42.5).at(-1) >= 42.5, true)
  assert.equal(compact(1_840_000), "1,84 млн")
})

test("a release of the API: version, channel, the platform archives and their sums", () => {
  const release = normalize({
    tag_name: "cli-v0.0.55-beta",
    prerelease: true,
    published_at: "2026-11-27T10:00:00Z",
    html_url: "https://github.com/codemama-ai/codemama-releases/releases/tag/cli-v0.0.55-beta",
    body: "## Новое\n- Пробная версия",
    assets: [
      { name: "codemama-0.0.55-win32-x64.zip", size: 10, browser_download_url: "https://github.com/x/win.zip", digest: "sha256:abc" },
      { name: "codemama-0.0.55-linux-x64.tar.gz", size: 11, browser_download_url: "https://github.com/x/linux.tar.gz" },
      { name: "SHA256SUMS", size: 1, browser_download_url: "https://github.com/x/SHA256SUMS" },
    ],
  }, { "codemama-0.0.55-linux-x64.tar.gz": "def" })
  assert.equal(release.version, "0.0.55")
  assert.equal(release.channel, "beta")
  assert.equal(release.files["win32-x64"].sha256, "abc")
  assert.equal(release.files["linux-x64"].sha256, "def")
  assert.equal(Object.keys(release.files).length, 2)
  const html = page({ releases: [release], bench: null })
  assert.match(html, /0\.0\.55 \(beta\)/)
  assert.match(html, /cdn\.codemama\.ru\/cli\/beta\/codemama-0\.0\.55-win32-x64\.zip/)
  assert.doesNotMatch(html, /id="bench"/)
  assert.match(feed([release]), /<entry>/)
})

test("no releases yet: the page says so", () => {
  assert.match(page({ releases: [], bench: null }), /Первый выпуск готовится/)
  assert.equal(escape(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;")
})

test("several products: the extension's packages, Desktop's files, each with its newest release and its section", async () => {
  const { newest } = await import("./build.mjs")
  const vscode = normalize({
    tag_name: "vscode-v0.0.54",
    published_at: "2026-11-25T14:00:00Z",
    html_url: "https://github.com/codemama-ai/codemama-releases/releases/tag/vscode-v0.0.54",
    body: "- Команды `codemama` и `mama` в терминалах VS Code.",
    assets: [
      { name: "codemama-win32-x64-0.0.54.vsix", size: 84, browser_download_url: "https://github.com/x/w.vsix", digest: "sha256:aa" },
      { name: "SHA256SUMS", size: 1, browser_download_url: "https://github.com/x/SHA256SUMS" },
    ],
  })
  assert.equal(vscode.product, "vscode")
  assert.equal(vscode.version, "0.0.54")
  assert.equal(vscode.files["win32-x64"].sha256, "aa")
  const desktop = normalize({ tag_name: "desktop-v0.1.9", published_at: "2026-11-20T10:00:00Z", html_url: "https://github.com/x", body: "", assets: [{ name: "CodeMama-0.1.9-x64-setup.exe", size: 5, browser_download_url: "https://github.com/x/setup.exe" }, { name: "manifest.json", size: 1, browser_download_url: "https://github.com/x/m" }] })
  assert.equal(desktop.product, "desktop")
  assert.deepEqual(desktop.assets.map((asset) => asset.name), ["CodeMama-0.1.9-x64-setup.exe"])
  const latest = newest([vscode, desktop])
  assert.equal(latest.vscode, vscode)
  assert.equal(latest.cli, undefined)
  const html = page({ releases: [vscode, desktop], bench: null })
  assert.match(html, /id="files-vscode"/)
  assert.match(html, /codemama\.ru\/downloads\/codemama-win32-x64\.vsix/)
  assert.match(html, /id="files-desktop"/)
  assert.match(html, /CodeMama-0\.1\.9-x64-setup\.exe/)
  assert.match(html, /id="vscode-v0\.0\.54"/)
  assert.match(html, /Первый выпуск CLI готовится/)
  assert.match(feed([vscode]), /CodeMama для VS Code 0\.0\.54/)
})
