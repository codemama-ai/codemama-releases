# CodeMama — выпуски

[CodeMama](https://codemama.ru) — ИИ-агент для разработки. Здесь выпуски его консольной версии `codemama` для Windows, macOS и Linux и расширения для VS Code, заметки о версиях и замеры. Исходники агента закрыты; этот репозиторий — витрина и архив выпусков.

**Сайт выпусков:** https://codemama-ai.github.io/codemama-releases/

| Продукт | Теги выпусков | Где ещё |
|---|---|---|
| CodeMama CLI | `cli-v<версия>` | команды установки ниже, `cdn.codemama.ru` |
| CodeMama для VS Code | `vscode-v<версия>` | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=codemama.codemama), codemama.ru/downloads |

## Установка CLI

Windows, PowerShell, без прав администратора:

```powershell
irm https://codemama.ru/install.ps1 | iex
```

macOS и Linux, без root:

```sh
curl -fsSL https://codemama.ru/install.sh | sh
```

Потом в папке проекта: `codemama` (или коротко `mama`). Новая версия — `codemama update`.

Вручную: архив своей платформы со страницы [Releases](https://github.com/codemama-ai/codemama-releases/releases) — внутри одна программа `codemama` (`codemama.exe`), положите её в папку из `PATH`.

## Расширение для VS Code

Проще всего — из [Marketplace](https://marketplace.visualstudio.com/items?itemName=codemama.codemama): VS Code сам его обновляет. Файлом — пакет своей платформы `codemama-<платформа>-<версия>.vsix` из выпуска `vscode-v<версия>`, в VS Code: Extensions → «…» → Install from VSIX.

## Проверка файлов

- `SHA256SUMS` рядом с архивами: `sha256sum -c SHA256SUMS` (Linux), `shasum -a 256 -c SHA256SUMS` (macOS), `Get-FileHash` (Windows).
- `manifest.json` выпуска подписан ключом CodeMama (Ed25519, подпись — `manifest.json.sig`); `codemama update` ставит только файлы из манифеста с этой подписью.

Сборки пока без подписи Apple и Microsoft: macOS и Windows при первом запуске файла, скачанного браузером, могут переспросить. Команды установки выше этого не вызывают.

## Что здесь лежит

| Путь | Что |
|---|---|
| `notes/<продукт>/<версия>.md` | заметки о выпуске: что изменилось для вас (у расширения — текст его выпуска) |
| `data/bench.json` | замеры для графиков на сайте |
| `site/` | генератор сайта (`node site/build.mjs`), без зависимостей |

Выпуски кладёт сборка CodeMama: архивы CLI — на `cdn.codemama.ru` (оттуда ставят команды выше), пакеты расширения — в Marketplace и на codemama.ru, и всё вместе — сюда, в Releases, где остаются все версии.

## Условия

Пользуясь CodeMama, вы принимаете [условия](https://codemama.ru/terms) и [политику конфиденциальности](https://codemama.ru/privacy).
