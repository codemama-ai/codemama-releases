#!/usr/bin/env node
/**
 * The Pages site of codemama-ai/codemama-releases: how to install CodeMama CLI, the files of the newest version, the
 * benchmark charts, and every release with its notes. One static page plus releases.json and feed.xml; no packages.
 *
 *   node site/build.mjs [--out _site] [--repo owner/name] [--releases <file.json>] [--bench <file.json>] [--cdn …] [--expect <tag>]
 *
 * Releases come from the GitHub API of --repo (GITHUB_TOKEN or GH_TOKEN if set; the repository is public), or from
 * a file of the shape this script writes as releases.json (--releases: a preview without the network). The notes of a
 * version are notes/cli/<version>.md when the file is there, else the release's text. The charts are data/bench.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)

export const SITE = {
  repo: option("--repo", process.env.GITHUB_REPOSITORY || "codemama-ai/codemama-releases"),
  cdn: option("--cdn", "https://cdn.codemama.ru").replace(/\/+$/, ""),
  home: "https://codemama.ru",
}

export const PLATFORMS = [
  { key: "win32-x64", os: "Windows", arch: "x64" },
  { key: "darwin-arm64", os: "macOS", arch: "Apple Silicon" },
  { key: "darwin-x64", os: "macOS", arch: "Intel" },
  { key: "linux-x64", os: "Linux", arch: "x64" },
  { key: "linux-arm64", os: "Linux", arch: "ARM64" },
]

// ——— text ———

export function escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

/** Inline Markdown of the notes: `code`, **bold**, [text](https://…). Everything else is text. */
function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}">${label}</a>`)
}

/** The notes' Markdown: ## and ### headings, "- " lists, paragraphs. A heading goes two levels down (h3, h4). */
export function markdown(text) {
  const out = []
  let list = false
  let paragraph = []
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`)
    paragraph = []
    if (list) out.push("</ul>")
    list = false
  }
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(heading[1].length + 1, 4)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
    } else if (item) {
      if (paragraph.length) {
        out.push(`<p>${inline(paragraph.join(" "))}</p>`)
        paragraph = []
      }
      if (!list) out.push("<ul>")
      list = true
      out.push(`<li>${inline(item[1])}</li>`)
    } else if (!line.trim()) {
      flush()
    } else {
      if (list) {
        out.push("</ul>")
        list = false
      }
      paragraph.push(line.trim())
    }
  }
  flush()
  return out.join("\n")
}

const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
export function dateText(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return escape(iso)
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export function number(value, digits = 0) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, " ")
}

export function megabytes(bytes) {
  return `${number(bytes / 1024 / 1024, 1)} МБ`
}

/** 1 840 000 → «1,84 млн»; under ten thousand in full. */
export function compact(value) {
  if (value >= 1e6) return `${number(value / 1e6, 2)} млн`
  if (value >= 1e4) return `${number(value / 1e3, 0)} тыс.`
  return number(value, Number.isInteger(value) ? 0 : 1)
}

// ——— releases ———

/** A release of the API, or of releases.json, in the shape the page needs. */
export function normalize(release, sums = {}) {
  const tag = release.tag ?? release.tag_name
  const version = release.version ?? tag.replace(/^cli-v/, "").replace(/-beta$/, "")
  const channel = release.channel ?? (release.prerelease || tag.endsWith("-beta") ? "beta" : "stable")
  const assets = (release.assets ?? []).map((asset) => ({
    name: asset.name,
    size: asset.size,
    url: asset.url?.startsWith("https://github.com/") ? asset.url : asset.browser_download_url ?? asset.url,
    sha256: asset.sha256 ?? (asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : sums[asset.name]),
  }))
  const files = {}
  for (const platform of PLATFORMS) {
    const asset = assets.find((item) => item.name === `codemama-${version}-${platform.key}${platform.key.startsWith("win32") ? ".zip" : ".tar.gz"}`)
    if (asset) files[platform.key] = asset
  }
  const notesFile = join(root, "notes", "cli", `${version}.md`)
  const notes = existsSync(notesFile) ? readFileSync(notesFile, "utf8") : (release.notes ?? release.body ?? "")
  return { tag, version, channel, date: release.date ?? release.published_at ?? release.created_at, url: release.url?.startsWith("https://github.com/") ? release.url : release.html_url, notes, files, assets }
}

async function githubReleases(repo) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const all = []
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers })
    if (!response.ok) throw new Error(`GitHub API ответил ${response.status} на выпуски ${repo}`)
    const list = await response.json()
    all.push(...list)
    if (list.length < 100) break
  }
  const releases = []
  for (const release of all.filter((item) => !item.draft && item.tag_name.startsWith("cli-v"))) {
    // The API gives each asset's digest; an older release without it has SHA256SUMS beside the archives.
    let sums = {}
    const list = release.assets.find((asset) => asset.name === "SHA256SUMS")
    if (list && release.assets.some((asset) => !asset.digest)) {
      const text = await (await fetch(list.browser_download_url)).text()
      sums = Object.fromEntries(text.split("\n").filter(Boolean).map((line) => line.split(/\s+/).reverse()))
    }
    releases.push(normalize(release, sums))
  }
  return releases
}

const byDate = (a, b) => String(b.date).localeCompare(String(a.date))

// ——— charts ———

const RATIO_WORDS = {
  medianSeconds: "быстрее",
  inputTokens: "экономнее по токенам",
  credits: "дешевле",
}

/** «в 4,0 раза дешевле Claude Code», «на 12 % быстрее opencode»: how much better ours is than one other agent. */
export function versus(metric, ours, other, agent) {
  const word = RATIO_WORDS[metric]
  if (!word || other <= ours) return null
  const ratio = other / ours
  const times = Math.round(ratio * 10) / 10
  if (ratio >= 1.5) return `в ${number(times, Number.isInteger(times) ? 0 : 1)} раза ${word}, чем ${agent}`
  return `на ${number(((other - ours) / other) * 100, 0)} % ${word}, чем ${agent}`
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)

function creditsWord(value) {
  if (!Number.isInteger(value)) return "кредита"
  const tens = value % 100
  const last = value % 10
  if (tens >= 11 && tens <= 14) return "кредитов"
  if (last === 1) return "кредит"
  if (last >= 2 && last <= 4) return "кредита"
  return "кредитов"
}

function valueText(metric, value, unit) {
  if (metric === "inputTokens") return `${compact(value)} ${unit}`.trim()
  // A fraction takes the genitive singular: 37,8 кредита, 152 кредита, 150 кредитов.
  if (metric === "credits") return `${number(value, value < 100 ? 1 : 0)} ${unit === "кредитов" ? creditsWord(value < 100 ? Math.round(value * 10) / 10 : Math.round(value)) : unit}`.trim()
  return `${number(value, Number.isInteger(value) ? 0 : 1)} ${unit}`.trim()
}

function shortValue(metric, value, unit) {
  if (metric === "inputTokens") return compact(value)
  if (metric === "medianSeconds") return `${number(value, 0)} с`
  if (metric === "passed") return number(value, 0)
  return number(value, value < 100 ? 1 : 0)
}

/** The headline of a comparison card: ours is best or tied (the export drops the rest). */
export function headline(comparison, tasks) {
  const ours = comparison.rows.find((row) => row.ours)
  const others = comparison.rows.filter((row) => !row.ours)
  if (!ours) return { title: comparison.title, lines: [] }
  if (comparison.metric === "passed") {
    const tied = others.filter((row) => row.value === ours.value).map((row) => row.agent)
    const title = tied.length === others.length ? `Все решили ${ours.value} из ${tasks}` : `${ours.value} из ${tasks} — больше всех`
    return { title, lines: tied.length && tied.length < others.length ? [`наравне с ${tied.join(", ")}`] : [] }
  }
  // The widest lead is the title; our own value and the other leads follow it.
  const leads = others
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((row) => versus(comparison.metric, ours.value, row.value, row.agent))
    .filter(Boolean)
  const value = `CodeMama — ${valueText(comparison.metric, ours.value, comparison.unit)}`
  if (!leads.length) return { title: value, lines: [] }
  return { title: capital(leads[0]), lines: [[value, ...leads.slice(1)].join("; ")] }
}

/** Horizontal bars, best first; ours in the accent, the others gray; the value at each bar's tip. */
export function barChart(comparison, tasks) {
  const rows = comparison.rows.slice().sort((a, b) => (comparison.better === "lower" ? a.value - b.value : b.value - a.value))
  const width = 560
  const labelWidth = 116
  const valueRoom = 76
  const band = 40
  const thick = 20
  const height = rows.length * band + 8
  const max = comparison.metric === "passed" ? tasks : Math.max(...rows.map((row) => row.value))
  const scale = (value) => (max > 0 ? (value / max) * (width - labelWidth - valueRoom) : 0)
  const marks = rows
    .map((row, index) => {
      const y = index * band + 4
      const w = Math.max(scale(row.value), 2)
      const r = Math.min(4, w / 2)
      const top = y + (band - thick) / 2
      const x0 = labelWidth
      const path = `M${x0},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${top + thick - r}Q${x0 + w},${top + thick} ${x0 + w - r},${top + thick}H${x0}Z`
      const value = shortValue(comparison.metric, row.value, comparison.unit)
      const tip = `${valueText(comparison.metric, row.value, comparison.unit)}`
      return `<g class="mark${row.ours ? " ours" : ""}" tabindex="0" data-tip-value="${escape(tip)}" data-tip-label="${escape(row.agent)}">
  <rect class="hit" x="0" y="${y}" width="${width}" height="${band}"/>
  <text class="name" x="${labelWidth - 12}" y="${top + thick / 2}" text-anchor="end" dominant-baseline="central">${escape(row.agent)}</text>
  <path class="bar" d="${path}"/>
  <text class="value" x="${x0 + w + 8}" y="${top + thick / 2}" dominant-baseline="central">${escape(value)}</text>
</g>`
    })
    .join("\n")
  return `<svg class="chart bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`${comparison.title}: ${rows.map((row) => `${row.agent} ${valueText(comparison.metric, row.value, comparison.unit)}`).join(", ")}`)}">
<line class="axis" x1="${labelWidth}" y1="2" x2="${labelWidth}" y2="${height - 2}"/>
${marks}
</svg>`
}

/** Our own history on one model: a 2 px line with end dots, the axis from zero, the last value labelled. */
export function lineChart(points, { title, metric, max, unit }) {
  const width = 560
  const height = 200
  const left = 44
  const right = 64
  const top = 16
  const bottom = 36
  const top_ = max ?? Math.max(...points.map((point) => point.value)) * 1.15
  const ticks = niceTicks(top_)
  const ceiling = ticks[ticks.length - 1]
  const x = (index) => (points.length === 1 ? left + (width - left - right) / 2 : left + (index * (width - left - right)) / (points.length - 1))
  const y = (value) => top + (1 - value / ceiling) * (height - top - bottom)
  const grid = ticks
    .map((tick) => `<line class="grid" x1="${left}" y1="${y(tick)}" x2="${width - right}" y2="${y(tick)}"/><text class="tick" x="${left - 8}" y="${y(tick)}" text-anchor="end" dominant-baseline="central">${escape(shortValue(metric, tick, unit))}</text>`)
    .join("\n")
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join("")
  const step = points.length > 1 ? (width - left - right) / (points.length - 1) : width - left - right
  const marks = points
    .map((point, index) => {
      const tip = valueText(metric, point.value, unit)
      return `<g class="mark ours" tabindex="0" data-tip-value="${escape(tip)}" data-tip-label="${escape(`${point.label} · ${point.date}`)}">
  <rect class="hit" x="${(x(index) - step / 2).toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${height - top - bottom}"/>
  <line class="cross" x1="${x(index).toFixed(1)}" y1="${top}" x2="${x(index).toFixed(1)}" y2="${height - bottom}"/>
  <circle class="dot" cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="4"/>
  <text class="tick" x="${x(index).toFixed(1)}" y="${height - bottom + 18}" text-anchor="middle">${escape(point.label)}</text>
</g>`
    })
    .join("\n")
  const last = points[points.length - 1]
  return `<svg class="chart line" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`${title}: ${points.map((point) => `${point.label} — ${valueText(metric, point.value, unit)}`).join(", ")}`)}">
${grid}
<line class="axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/>
${points.length > 1 ? `<path class="series" d="${line}"/>` : ""}
${marks}
<text class="value" x="${(x(points.length - 1) + 10).toFixed(1)}" y="${y(last.value).toFixed(1)}" dominant-baseline="central">${escape(shortValue(metric, last.value, unit))}</text>
</svg>`
}

/** Round ticks from zero: 0, 5, 10… — five or so, the last one at or above max. */
export function niceTicks(max) {
  const raw = max / 5
  const power = 10 ** Math.floor(Math.log10(raw || 1))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw
  const ticks = []
  for (let tick = 0; tick < max + step * 0.999; tick += step) ticks.push(Number(tick.toPrecision(12)))
  return ticks
}

function table(head, rows) {
  return `<details class="table"><summary>Таблица</summary><table><thead><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></details>`
}

/** What our history may show besides the solved tasks: the export leaves only metrics that did not get worse. */
const TREND_METRICS = [
  { key: "medianSeconds", caption: "Медианное время задачи, с", metric: "medianSeconds", unit: "с", lead: (a, b) => `медианная задача — ${number(b, 0)} с вместо ${number(a, 0)} с` },
  { key: "credits", caption: "Стоимость прогона, кредитов", metric: "credits", unit: "кредитов", lead: (a, b) => `прогон стоит ${number(b, 1)} кредита вместо ${number(a, 1)}` },
  { key: "inputTokens", caption: "Входные токены за прогон", metric: "inputTokens", unit: "токенов", lead: (a, b) => `входных токенов — ${compact(b)} вместо ${compact(a)}` },
]

function trendCard(trend) {
  const series = trend.series ?? []
  if (!series.length) return ""
  const first = series[0]
  const last = series[series.length - 1]
  const point = (pick) => series.map((item) => ({ label: item.label, date: dateText(item.date), value: pick(item) }))
  // Of the metrics the export kept, the one that improved most (first to last); a flat one only when none improved.
  const kept = TREND_METRICS.filter((entry) => series.every((item) => typeof item[entry.key] === "number"))
  const gain = (entry) => (first[entry.key] > 0 ? (first[entry.key] - last[entry.key]) / first[entry.key] : 0)
  const other = kept.slice().sort((a, b) => gain(b) - gain(a))[0]
  const lead = other && series.length > 1 && last[other.key] < first[other.key] ? other.lead(first[other.key], last[other.key]) : ""
  const title = series.length > 1 && last.passed > first.passed ? `${last.passed} из ${last.total} задач — было ${first.passed}` : `${last.passed} из ${last.total} задач`
  const figures = [`<figure><figcaption>Решено задач из ${last.total}</figcaption>${lineChart(point((item) => item.passed), { title: "Решено задач", metric: "passed", max: last.total, unit: "" })}</figure>`]
  if (other) figures.push(`<figure><figcaption>${escape(other.caption)}</figcaption>${lineChart(point((item) => item[other.key]), { title: other.caption, metric: other.metric, unit: other.unit })}</figure>`)
  const head = ["Сборка", "Дата", "Решено", ...(other ? [other.caption] : [])]
  const rows = series.map((item) => [item.label, dateText(item.date), `${item.passed} из ${item.total}`, ...(other ? [valueText(other.metric, item[other.key], other.unit)] : [])])
  return `<article class="card chart-card wide">
  <p class="eyebrow">${escape(trend.title)}</p>
  <h3>${escape(title)}</h3>
  ${lead ? `<p class="lead">${escape(lead)}</p>` : ""}
  <div class="pair">${figures.join("")}</div>
  <p class="meta">${escape(trend.model)}</p>
  ${table(head, rows)}
</article>`
}

function benchSection(bench) {
  if (!bench || (!bench.comparisons?.length && !bench.trend?.length)) return ""
  const tasks = bench.suite?.tasks ?? 0
  const groups = (bench.suite?.groups ?? []).map((group) => `<li><span>${escape(group.title)}</span><b>${group.tasks}</b></li>`).join("")
  const cards = (bench.comparisons ?? [])
    .map((comparison) => {
      const head = headline(comparison, tasks)
      return `<article class="card chart-card">
  <p class="eyebrow">${escape(comparison.title)} · ${escape(comparison.model)}</p>
  <h3>${escape(head.title)}</h3>
  ${head.lines.length ? `<p class="lead">${head.lines.map(escape).join("<br>")}</p>` : ""}
  ${barChart(comparison, tasks)}
  <p class="meta">${escape(dateText(comparison.date))} · ${comparison.better === "lower" ? "меньше — лучше" : "больше — лучше"}</p>
  ${table(["Агент", comparison.title], comparison.rows.map((row) => [row.agent, valueText(comparison.metric, row.value, comparison.unit)]))}
</article>`
    })
    .join("\n")
  const trends = (bench.trend ?? []).map((trend) => trendCard(trend)).join("\n")
  return `<section id="bench" class="section">
  <div class="section-head">
    <h2>Замеры</h2>
    <p>${escape(bench.method ?? "")}</p>
  </div>
  ${groups ? `<ul class="groups" aria-label="Из чего состоит набор: ${tasks} задач">${groups}</ul>` : ""}
  <div class="grid">${cards}${trends}</div>
  <p class="fine">Набор задач наш, не SWE-bench. Цифры — с тех прогонов, что указаны на карточках; на других задачах и моделях они будут другими. Обновлено ${escape(dateText(bench.generated))}.</p>
</section>`
}

// ——— page ———

function installBlock() {
  const windows = "irm https://codemama.ru/install.ps1 | iex"
  const unix = "curl -fsSL https://codemama.ru/install.sh | sh"
  const tab = (id, label, selected) => `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${label}</button>`
  const panel = (id, hint, command, hidden) =>
    `<div role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${hidden ? " hidden" : ""}><p class="hint">${hint}</p><div class="command"><code>${escape(command)}</code><button class="copy" data-copy="${escape(command)}" aria-label="Скопировать команду">Скопировать</button></div></div>`
  return `<div class="install" data-tabs>
  <div role="tablist" aria-label="Система">${tab("windows", "Windows", true)}${tab("unix", "macOS и Linux", false)}</div>
  ${panel("windows", "PowerShell, без прав администратора:", windows, false)}
  ${panel("unix", "Терминал, без root:", unix, true)}
  <p class="after">Потом в папке проекта: <code>codemama</code> или <code>mama</code>. Новая версия — <code>codemama update</code>.</p>
</div>`
}

/** Before the first release the install commands lead nowhere: say so, and where CodeMama is already. */
function soon() {
  return `<div class="card soon"><p><b>Первый выпуск CLI готовится.</b> А пока CodeMama работает в <a href="https://marketplace.visualstudio.com/items?itemName=codemama.codemama">VS Code</a> — тот же агент, в редакторе.</p></div>`
}

function downloads(release) {
  if (!release) return ""
  const cards = PLATFORMS.filter((platform) => release.files[platform.key])
    .map((platform) => {
      const file = release.files[platform.key]
      const cdn = `${SITE.cdn}/cli/${release.channel}/${file.name}`
      return `<li class="card file">
  <p class="os">${escape(platform.os)} <span>${escape(platform.arch)}</span></p>
  <p class="meta">${escape(file.name.endsWith(".zip") ? ".zip" : ".tar.gz")} · ${megabytes(file.size)}</p>
  <div class="actions"><a class="button" href="${escape(cdn)}">Скачать</a><a class="link" href="${escape(file.url)}">с GitHub</a></div>
  ${file.sha256 ? `<button class="sum" data-copy="${escape(file.sha256)}" title="SHA-256: ${escape(file.sha256)}">SHA-256 ${escape(file.sha256.slice(0, 12))}…</button>` : ""}
</li>`
    })
    .join("\n")
  return `<section id="download" class="section">
  <div class="section-head">
    <h2>Файлы версии ${escape(release.version)}</h2>
    <p>Архив с одной программой: <code>codemama</code> или <code>codemama.exe</code>. Распакуйте в папку из <code>PATH</code> — или поставьте командой выше, она сделает это сама и проверит контрольную сумму.</p>
  </div>
  <ul class="files">${cards}</ul>
  <p class="fine">Скачивание идёт с нашего сервера в России; «с GitHub» — то же самое из архива выпусков. Контрольные суммы всех файлов — <a href="${escape(`${SITE.cdn}/cli/${release.channel}/SHA256SUMS`)}">SHA256SUMS</a>; манифест выпуска подписан ключом CodeMama, <code>codemama update</code> проверяет подпись.</p>
</section>`
}

function releaseList(releases) {
  if (!releases.length) {
    return `<section id="releases" class="section"><div class="section-head"><h2>Выпуски</h2><p>Первый выпуск готовится. Следите за <a href="https://github.com/${escape(SITE.repo)}/releases">выпусками на GitHub</a> или подпишитесь на <a href="feed.xml">ленту</a>.</p></div></section>`
  }
  const items = releases
    .map((release) => {
      const links = PLATFORMS.filter((platform) => release.files[platform.key])
        .map((platform) => `<a href="${escape(release.files[platform.key].url)}">${escape(platform.os)} ${escape(platform.arch)}</a>`)
        .join(" · ")
      return `<article class="release" id="v${escape(release.version)}${release.channel === "beta" ? "-beta" : ""}">
  <header><h3><a href="#v${escape(release.version)}${release.channel === "beta" ? "-beta" : ""}">${escape(release.version)}</a>${release.channel === "beta" ? ' <span class="badge">beta</span>' : ""}</h3><time datetime="${escape(release.date)}">${escape(dateText(release.date))}</time></header>
  <div class="notes">${release.notes.trim() ? markdown(release.notes) : "<p>Исправления и улучшения.</p>"}</div>
  ${links ? `<p class="links">${links} · <a href="${escape(release.url)}">на GitHub</a></p>` : ""}
</article>`
    })
    .join("\n")
  return `<section id="releases" class="section"><div class="section-head"><h2>Выпуски</h2><p>Что нового в каждой версии. Все прежние версии остаются на <a href="https://github.com/${escape(SITE.repo)}/releases">GitHub</a>; подписка — <a href="feed.xml">лента Atom</a>.</p></div>${items}</section>`
}

export function page({ releases, bench }) {
  const benchHtml = benchSection(bench)
  const stable = releases.find((release) => release.channel === "stable")
  const latest = stable ?? releases[0]
  const version = latest
    ? `<p class="version">Версия ${escape(latest.version)}${latest.channel === "beta" ? " (beta)" : ""} · ${escape(dateText(latest.date))} · <a href="#v${escape(latest.version)}${latest.channel === "beta" ? "-beta" : ""}">что нового</a></p>`
    : ""
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeMama CLI — агент для разработки в терминале</title>
<meta name="description" content="CodeMama CLI: ИИ-агент для разработки в терминале Windows, macOS и Linux. Установка одной командой, выпуски, заметки о версиях и замеры.">
<meta property="og:title" content="CodeMama CLI">
<meta property="og:description" content="ИИ-агент для разработки в терминале: установка одной командой, выпуски и замеры.">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="Выпуски CodeMama CLI" href="feed.xml">
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#main">К содержанию</a>
<header class="top">
  <a class="brand" href="./"><img src="logo.svg" alt="" width="32" height="32"><span>CodeMama <b>CLI</b></span></a>
  <nav aria-label="Разделы"><a href="#install">Установка</a>${benchHtml ? '<a href="#bench">Замеры</a>' : ""}<a href="#releases">Выпуски</a><a href="${SITE.home}">codemama.ru</a></nav>
</header>
<main id="main">
<section id="install" class="hero">
  <p class="eyebrow">CodeMama в терминале</p>
  <h1>Агент, который доводит задачу до конца — прямо в вашей консоли</h1>
  <p class="lead">Тот же агент, что в VS Code и в приложении CodeMama: читает проект, правит код, запускает проверки. Windows, macOS и Linux, без прав администратора.</p>
  ${latest ? installBlock() : soon()}
  ${version}
</section>
${downloads(latest)}
${benchHtml}
${releaseList(releases)}
</main>
<footer class="bottom">
  <p>© CodeMama · <a href="${SITE.home}">codemama.ru</a> · <a href="${SITE.home}/terms">Условия</a> · <a href="${SITE.home}/privacy">Конфиденциальность</a> · <a href="https://github.com/${escape(SITE.repo)}">GitHub</a></p>
</footer>
<div class="tooltip" role="status" hidden><b></b><span></span></div>
<script src="app.js" defer></script>
</body>
</html>
`
}

export function feed(releases) {
  const updated = releases[0]?.date ?? new Date().toISOString()
  const entries = releases
    .map(
      (release) => `<entry>
<title>CodeMama CLI ${escape(release.version)}${release.channel === "beta" ? " (beta)" : ""}</title>
<id>tag:codemama.ru,2026:cli-${escape(release.version)}${release.channel === "beta" ? "-beta" : ""}</id>
<link href="${escape(release.url)}"/>
<updated>${escape(release.date)}</updated>
<content type="html">${escape(markdown(release.notes))}</content>
</entry>`,
    )
    .join("\n")
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Выпуски CodeMama CLI</title>
<id>https://github.com/${escape(SITE.repo)}</id>
<link href="https://github.com/${escape(SITE.repo)}/releases"/>
<updated>${escape(updated)}</updated>
${entries}
</feed>
`
}

async function main() {
  const out = join(root, option("--out", "_site"))
  const file = option("--releases")
  // On a release's own event the API may not list it yet: --expect <tag> asks again for up to a minute.
  const expect = option("--expect")
  let releases = []
  for (let attempt = 0; attempt < 12; attempt++) {
    releases = (file ? JSON.parse(readFileSync(file, "utf8")).map((release) => normalize(release)) : await githubReleases(SITE.repo)).sort(byDate)
    if (!expect || releases.some((release) => release.tag === expect)) break
    console.log(`${expect}: в списке выпусков ещё нет, жду`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (expect && !releases.some((release) => release.tag === expect)) throw new Error(`${expect} так и не появился в выпусках ${SITE.repo}`)
  const benchFile = option("--bench", join(root, "data", "bench.json"))
  const bench = existsSync(benchFile) ? JSON.parse(readFileSync(benchFile, "utf8")) : null
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "index.html"), page({ releases, bench }))
  writeFileSync(join(out, "feed.xml"), feed(releases))
  const index = releases.map(({ tag, version, channel, date, url, files }) => ({ tag, version, channel, date, url, files }))
  writeFileSync(join(out, "releases.json"), `${JSON.stringify(index, null, 2)}\n`)
  for (const name of ["style.css", "app.js", "logo.svg"]) copyFileSync(join(root, "site", name), join(out, name))
  if (existsSync(join(root, "CNAME"))) copyFileSync(join(root, "CNAME"), join(out, "CNAME"))
  writeFileSync(join(out, ".nojekyll"), "")
  console.log(`${out}: ${releases.length} выпусков, замеры ${bench ? "есть" : "нет"}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
