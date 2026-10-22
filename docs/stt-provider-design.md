# Ting ASR Provider 接入设计草案

日期：2026-10-22。全部为待实施设计；模型证据见 [生态调查](asr-model-ecosystem.md)，源码依据见 [架构检查](architecture-review.md)。

## 按能力连接，而不是只有一个 transcribe 方法

Provider 描述包含 provider_id、准确 model_id/revision、runtime、部署位置、endpoint/region、credential_ref。能力按具体组合声明：file、live、partial、segment/word timestamps、diarization、语言提示、context/hotwords、取消与恢复。

建议三种操作协议，共用结果结构：

- ChunkTranscriber：兼容现有 Whisper／Parakeet 短段处理。
- FileTranscriptionJob：提交、保存 job_id、查询进度、获取结果、取消（供应商支持时）。本地文件任务也能实现相同上层协议。
- LiveTranscriptionSession：打开、写音频、接收事件、结束和释放。服务端句 ID + 会话 ID 确定更新目标；partial 更新原句，final 确认，不重复追加。

暂不把协议固定为公开 SDK；先做内部适配层。现有同步片段 trait 可以保留兼容适配，不要求所有调用立刻重写。

## 统一结果

建议最小字段：

- run_id、recording_id、provider/model/runtime、参数快照、状态与错误。
- segment_id、provider_segment_id、revision、text、is_final。
- start_ms/end_ms：相对于原始录音；未知可为空。记录 timing_source：chunk / provider / forced_alignment。
- words（可选）：文本与时间锚点；变更文字后标记对齐失效，不能沿用成准确结果。
- audio_source（mic/system/mixed/unknown）与 speaker_id（可空）分开。
- confidence 保留空值，并记录提供者和含义；不同模型分数不可直接比较。
- 原始 ASR 与校订稿分开存；人工意见绑定录音时间和稳定 ID，不只绑定字符位置。

统一使用毫秒，适配边界转换现有秒值。分块／重连使用显式原始音频 offset，不以事件到达时间排序。暂停、恢复与拼接要定义录音时间轴并测试。

## 两条首轮接入路径

本地：以独立进程或仅 loopback 服务验证 MLX Qwen3-ASR，避免将 Python／MLX 依赖直接塞进 Rust 主进程。原型固定依赖版本；最终桌面发行需另做 runtime 打包、启动／退出管理及离线模型缓存，不让普通用户手工装 Python。

云端 Filetrans：准备授权音频 → 上传或提供受限可访问 URL → 提交任务 → 持久化 task_id → 轮询 → 获取／标准化结果 → 保存新 run。无需沿用本地 VAD 将整段录音切成许多付费任务。按实际文件规格决定是否转码／分片。

云端 Streaming：从连续音频入口接独立 session，按服务格式重采样；有界缓冲和背压，掉线明确提示。恢复策略记录已确认音频范围，避免重复字幕与无声丢失；不假定供应商能恢复同一会话。

## 数据和失败处理

- 路线选择先决定允许外发的内容；云端 ASR 需要音频外发。混合隐私路线仅在本地转录并去敏后调用云端总结，不走云端 ASR。
- 自建远程端点也要显示目的地。网络错误不能自动切换到其他云服务。
- 新增凭据放系统密钥库；日志不写 key、带签名 URL 或完整敏感正文。
- URL 有限有效期，成功／失败后按策略清理上传副本；说明供应商端保留政策与本地删除不同。
- 提交超时不盲目重新提交付费任务。已知 task_id 优先恢复；状态不明向用户说明，不能宣称具备供应商未提供的幂等性。
- 鉴权、额度、限流、网络、输入不支持和模型错误分别处理；重试有上限，取消能力如实呈现。

首轮必要测试：适配器响应解析、毫秒／秒转换、partial 替换、缺失 confidence、未知 provider 报错、任务恢复与旧稿保留。真实账号／真实录音验证与这些自动化测试分开。

## 百炼文档补充（2026-10-22）

官方 Filetrans 文档当前注明每次一个 file URL；REST 支持临时 oss:// URL，SDK 不支持该形式。官方临时上传机制注明 48 小时有效期，且不建议用于生产环境；正式产品需要稳定、受控的存储方案，不能让用户填写 API Key 后再手工公开录音。[官方说明](https://www.alibabacloud.com/help/zh/model-studio/fun-asr-recorded-speech-recognition-http-api)

因此设置至少包含供应商、地域、API Key、模型；使用专属域名时还需 workspace ID。密钥输入、保存和测试入口属于首阶段范围，真实转录需明确选定音频。连接测试要说明是否调用计费模型，不能伪装成免费校验。

参考本机 ting-speech 技能的历史经验：北京与国际区配置不可混用；同步 Flash、异步 Filetrans 和 WebSocket 实时模式是不同协议，不只替换 model ID。旧项目曾调用成功不能替代本项目账号验证。此次只借用经验，没有复制 SDK、凭据或录音。
