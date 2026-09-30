# v4.0.3 本地叙事模型实测（2026-09-30）

测试机为 RTX 4070 Laptop 8 GiB 显存、约 32 GiB 内存。测试脚本 `Source/tests/local-model-playtest.mjs` 使用两个不同 seed 的全新临时世界，每局依次问在场人物“你是谁”“刚才的消息你知道多少”“我来帮你”“具体要我先做什么”。脚本调用本机 llama.cpp 服务与真实 `runWorld`、会话验证和引擎兜底；未读取玩家存档、未调用 Groq 或其他在线模型。原始逐回合 JSON 在工作区 `development/local-ai-eval/`，本报告只记录可复现的观察。

| 模型与同一 v4.0.3 对话提示 | 模型直接回答 | 引擎兜底 | 模型请求平均耗时 | 观察 |
| --- | ---: | ---: | ---: | --- |
| Qwen3 14B Q4_K_M | 6/8 回合 | 2/8 | 6.49 秒 | 中文身份回答较准；仍偶尔把传闻引向未经登记的帮忙方向。 |
| Ministral 3 8B Instruct 2512 Q4_K_M | 8/8 回合 | 0/8 | 5.69 秒 | 回答快，但会凭空给人物加地区、病情和农田病虫害；不能按通过率认定为更可靠。 |

旧版 Qwen 完整长提示与思考模式的 8 回合中只有 4 回合由模型直接回答，13 次请求平均约 59 秒；新版关闭 Qwen3 冗长思考、补入人物职业与身份、压缩本地事实包并将直接对话限于 NPC 对白。该改善只说明本机短场景的响应时间与可用率提高；没有证明长篇剧情、其他 seed 或自选 GGUF 都稳定。严格校验会拦住主角台词重述和第二人称旁白，但自然语言事实虚构仍可能漏过。线上 AI 模式在本次未改动也未测试，不能声称本地已达到线上模型质量。

Qwen3 14B 是用户原有模型，仍为当前选中模型。Ministral 3 8B 从 [Mistral 官方 GGUF](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512-GGUF)下载到工作区的 `development/local-ai-eval/models/` 用于测试；没有替用户切换默认模型。另一个可研究对象是 [Google 官方 Gemma 3 12B QAT GGUF](https://huggingface.co/google/gemma-3-12b-it-qat-q4_0-gguf)，但官方仓库要求接受 Gemma 使用条款，本轮没有下载或实测。推荐继续把在线 AI 作为叙事质量优先的选项；本地模式适合离线、低额度或短对白，世界事实仍由 Engine/SQLite 掌管。
