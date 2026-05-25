# Hermes Agent WebUI Universal

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) 的實驗性可攜式 Web UI。

狀態：alpha。這個專案目前適合本機測試與自用，但安裝流程、API bridge、UI 行為都還可能調整。在把它開放到自己電腦以外的環境之前，請先閱讀安全提醒。

![Hermes Agent WebUI Universal 視覺圖](image/WebUI_Screenshot.png)

註：此圖為作者使用環境之截圖，並不代表本專案包含 GPT-5.5 或任何需付費模型、provider access、API key 或訂閱內容。

## 這是什麼

Hermes Agent WebUI Universal 會啟動一個本機 Vite frontend，以及一個 FastAPI REST proxy，用來連接你已經安裝好的 Hermes Agent。

它不包含 Hermes Agent 本體，也不應該包含你的 API keys、`.env`、`config.yaml`、session database 或 logs。

目前功能：

- 透過 Web UI 與 Hermes Agent 對話
- 使用使用者既有的 Hermes model/provider 設定
- 顯示 CLI session history，並合併 Web UI overlay sessions
- Recent History / Cron Jobs 側邊欄切換
- 顯示既有 Hermes cron jobs
- File browser 與 upload endpoints
- Tool execution monitor
- 用於 setup/debugging 的 health endpoint

## 需求

- 已安裝並設定 Hermes Agent
- 已完成 `hermes setup`
- 可使用 Node.js/npm
- 可使用 Hermes Agent 的 Python environment

Hermes installer 通常會在 Hermes home 目錄底下提供 Node.js。當 `$HERMES_HOME/node/bin` 存在時，`start.sh` 會自動把它加進 `PATH`。

## 快速開始

Clone 或解壓縮這個專案後，執行：

```bash
./install.sh
```

Installer 會搜尋你的 Hermes home，並把 Web UI 安裝到：

```text
$HERMES_HOME/web-ui
```

如果 `HERMES_HOME` 是自動搜尋出來的，請使用 `install.sh` 輸出中顯示的安裝路徑。

啟動：

```bash
cd "$HERMES_HOME/web-ui"
./start.sh
```

開啟：

```text
http://127.0.0.1:3000
```

停止或重啟：

```bash
./stop.sh
./restart.sh
```

## 路徑自動搜尋

這些 scripts 是為了支援不一定安裝在 `~/.hermes` 的 Hermes 環境而設計。

搜尋順序：

1. `HERMES_HOME` 與 `HERMES_AGENT_DIR` 環境變數
2. Web UI 附近或父層目錄中的 `.hermes`
3. `$HOME/.hermes`
4. `/work/$USER/.hermes`
5. `/workspace/$USER/.hermes`
6. `/mnt/data/.hermes`
7. 在常見 workspace roots 底下做有限深度搜尋

Hermes Agent source 目錄會從以下位置推導：

1. `HERMES_AGENT_DIR`
2. `$HERMES_HOME/hermes-agent`
3. `$(dirname "$HERMES_HOME")/hermes-agent`

如果你的安裝位置比較特殊，可以明確指定：

```bash
HERMES_HOME=/path/to/.hermes HERMES_AGENT_DIR=/path/to/hermes-agent ./start.sh
```

## 設定

`start.sh` 支援以下環境變數：

```bash
HERMES_HOME=/path/to/.hermes
HERMES_AGENT_DIR=/path/to/hermes-agent
HERMES_WEB_HOST=127.0.0.1
HERMES_WEB_PORT=3001
HERMES_WEB_UI_HOST=127.0.0.1
HERMES_WEB_UI_PORT=3000
VITE_HERMES_API_URL=/api
```

`install.sh` 也支援：

```bash
HERMES_WEB_UI_TARGET=/path/to/install/web-ui
```

測試安裝範例：

```bash
HERMES_WEB_UI_TARGET="$HERMES_HOME/hermes-agent-webui-universal" ./install.sh
```

## 重要檔案

Hermes 管理的檔案會放在使用者自己的 Hermes home 底下：

```text
$HERMES_HOME/config.yaml
$HERMES_HOME/.env
$HERMES_HOME/state.db
$HERMES_HOME/web_proxy_sessions.db
$HERMES_HOME/logs/
$HERMES_HOME/sessions/
```

請不要 commit 或分享這些檔案。它們可能包含 credentials、私人 prompts、本機路徑、session data 或其他敏感資訊。

## 安全提醒

預設情況下，frontend 與 backend 都只綁定 localhost：

```text
Frontend: http://127.0.0.1:3000
Backend:  http://127.0.0.1:3001
```

不要把這個 Web UI 直接暴露到公網。連上 Hermes 後，Web UI 可能會觸發讀取檔案、寫入檔案、執行 terminal command、管理 cron jobs，或依照你的 Hermes 設定與其他本機服務互動。

如果你確定要開給區網使用，請明確指定：

```bash
HERMES_WEB_HOST=0.0.0.0 HERMES_WEB_UI_HOST=0.0.0.0 ./start.sh
```

請只在可信任網路中這樣做。

## 手動開發

Terminal 1，啟動 REST proxy：

```bash
cd "$HERMES_HOME/web-ui"
export HERMES_HOME=${HERMES_HOME:-/path/to/.hermes}
export HERMES_AGENT_DIR=${HERMES_AGENT_DIR:-/path/to/hermes-agent}
export PYTHONPATH="$HERMES_AGENT_DIR:$PYTHONPATH"
source "$HERMES_AGENT_DIR/venv/bin/activate"
python backend/hermes_rest_proxy.py --host 127.0.0.1 --port 3001
```

Terminal 2，啟動 Vite：

```bash
cd "$HERMES_HOME/web-ui"
HERMES_PROXY_TARGET=http://127.0.0.1:3001 npm run dev -- --host 127.0.0.1 --port 3000
```

Build frontend：

```bash
npm install
npm run build
```

## Health Check

REST proxy 啟動後：

```bash
curl http://127.0.0.1:3001/api/health
```

回應會包含 setup/debugging 欄位，例如：

- `model`
- `provider`
- `version`
- `hermes_home`
- `hermes_agent_dir`
- `setup_ok`
- feature flags

它不應該回傳 API keys 或 `.env` 內容。

## 疑難排解

### Hermes config not found

執行：

```bash
hermes setup
```

或明確指定 Hermes home：

```bash
HERMES_HOME=/path/to/.hermes ./start.sh
```

### Could not import Hermes Agent modules

Backend 找不到 Hermes Agent source checkout。請試：

```bash
HERMES_AGENT_DIR=/path/to/hermes-agent ./start.sh
```

### npm not found

請安裝 Node.js LTS，或確認 Hermes 提供的 Node.js 目錄已加入 `PATH`：

```bash
export PATH="$HERMES_HOME/node/bin:$PATH"
```

### Ports already in use

更換 ports：

```bash
HERMES_WEB_PORT=3101 HERMES_WEB_UI_PORT=3100 ./start.sh
```

## 公開前檢查清單

在公開 fork 或副本之前，請確認沒有 commit 以下內容：

- `.env`
- `config.yaml`
- `state.db`
- `web_proxy_sessions.db`
- session logs
- OAuth tokens 或 provider credentials
- generated files 裡的本機 workspace paths
- `node_modules`
- `dist`

本 repository 已包含 `.gitignore`，用來阻擋常見的敏感檔案與 runtime 產物。不過在 push 之前，仍然請務必檢查 `git status`。

## 授權

MIT License。請見 [LICENSE](LICENSE)。
