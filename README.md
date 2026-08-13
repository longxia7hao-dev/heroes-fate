# 英雄命運 Heroes' Fate（Web 原型）

聚會用動畫抽籤原型。完整說明與給 AI Agent 的交接請讀：

👉 **[AGENT_HANDOFF.md](./AGENT_HANDOFF.md)**  
👉 [PROJECT_NOTES.md](./PROJECT_NOTES.md)  
👉 企劃 GDD：`/Users/longxia7hao/Heroes_Fate_GDD/GDD.md`

## 快速啟動

```bash
cd /Users/longxia7hao/Heroes_Fate
python3 -m http.server 8888 --bind 0.0.0.0
```

開：http://127.0.0.1:8888/index.html

手機請用區網 IP 或 Cloudflare 隧道（見 `PHONE_ONLINE.txt`），**不要用 127.0.0.1**。
