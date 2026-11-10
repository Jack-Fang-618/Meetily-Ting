# 百炼接入调查 · 2026-11-10

状态更新：已实现开发预览版文件转写与用户自有 Key 配置。3.1 公开样本 30/30 完成，3.0 四语言场景冒烟通过。详见 [使用与边界](aliyun-file-transcription.md)、[实测结果](aliyun-evaluation-2026-11-10.md)。下文保留接入前的调查记录。

## 本机凭据

旧 Audio 项目的本地 secrets 配置中存在非空 qwen 凭据。本次仅输出存在性，没有输出、迁移或提交密钥。存在不等于有效，账号权限、地域及模型可用性仍需实测。

## 首轮模型与协议

- 文件：优先 qwen-audio-3.1-asr-flash-filetrans，保留 3.0 为显式对比选项。
- 实时：之后接 qwen-audio-3.1-asr-flash-streaming，单独管理 WebSocket 会话。
- 不与本地 Qwen3-ASR 或旧云端 qwen3-asr-flash 系列混淆。

官方选型：[ASR 概览](https://help.aliyun.com/zh/model-studio/asr-model)、[实时识别](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide)。

## 文件接口要点

提交后保存 task_id，轮询并检查每个 subtask_status，再下载结果落盘。句/词时间使用毫秒；任务日期字符串不是音频时间戳。3.1 的 keep_dialect 默认 false；忠实粤语输出应显式设 true。必须提供 parameters，语言提示按官方枚举，不自行猜测 yue 可用。

文件通过 URL 提交；临时上传 URL 有效 48 小时且官方不建议生产使用。开发验证与正式存储方案需区分。排队中的任务可取消，不能将本地停止等待描述为云端一定停止计费。3.1 按 Token 计费，不能套用 3.0 的时长估价。

来源：[Filetrans HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api)。

## 实施顺序

1. 英文设置页：地域、模型、API Key、安全保存及连接状态；支持业务空间专属域名所需 Workspace ID。
2. 文件任务适配器：上传、提交、恢复轮询、结果解析、失败提示，复用现有会议与逐字稿保存路径，保留旧稿。
3. 用公开测试音频验证 3.1 的实际可用性、原话保留、时间戳和耗时。
4. 再接实时会话；说话人分离和 LLM 精修不纳入首轮。

地域对应独立 Key 与端点，不应自动跨地域试密钥。来源：[API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。新凭据沿用系统密钥库设计；日志不记录 Key 或签名 URL。没有上传用户会议录音。
