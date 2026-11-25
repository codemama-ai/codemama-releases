# CodeMama CLI — выпуски

[CodeMama](https://codemama.ru) — ИИ-агент для разработки. Здесь выпуски его консольной версии `codemama` для Windows, macOS и Linux, заметки о версиях и замеры. Исходники агента закрыты; этот репозиторий — витрина и архив выпусков.

**Сайт выпусков:** https://codemama-ai.github.io/codemama-releases/

## Установка

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

## Проверка файлов

- `SHA256SUMS` рядом с архивами: `sha256sum -c SHA256SUMS` (Linux), `shasum -a 256 -c SHA256SUMS` (macOS), `Get-FileHash` (Windows).
- `manifest.json` выпуска подписан ключом CodeMama (Ed25519, подпись — `manifest.json.sig`); `codemama update` ставит только файлы из манифеста с этой подписью.

Сборки пока без подписи Apple и Microsoft: macOS и Windows при первом запуске файла, скачанного браузером, могут переспросить. Команды установки выше этого не вызывают.

## Что здесь лежит

| Путь | Что |
|---|---|
| `notes/cli/<версия>.md` | заметки о выпуске: что изменилось для вас |
| `data/bench.json` | замеры для графиков на сайте |
| `site/` | генератор сайта (`node site/build.mjs`), без зависимостей |

Выпуски кладёт сборка CodeMama: архивы — на `cdn.codemama.ru` (оттуда ставят команды выше) и сюда, в Releases, где остаются все версии.

## Условия

Пользуясь CodeMama, вы принимаете [условия](https://codemama.ru/terms) и [политику конфиденциальности](https://codemama.ru/privacy).
