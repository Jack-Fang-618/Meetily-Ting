# Meetily-Ting 架构检查

日期：2026-10-22。范围：当前分支静态检查。用户已确认基本录音、转录等流程通过；本轮不重复全量测试，不修改运行代码。

## 已有基础与限制

下列路径均相对于仓库根目录，行号为调查时定位。

| 部分 | 源码定位 | 结论 |
| --- | --- | --- |
| 录音入口 | frontend/src-tauri/src/audio/recording_commands.rs:334 | 开始录音前验证转录模型；云端模式需要按 Provider 验证，不能继续强制本地模型已安装 |
| 音频编排 | frontend/src-tauri/src/audio/pipeline.rs:848 | 麦克风和系统音混合后进入 VAD；分段以 16kHz 发送给转录。真正的流式 API 要从合适位置取得连续音频，不能仅替换片段调用 |
| Provider trait | frontend/src-tauri/src/audio/transcription/provider.rs:42 | 只有文本、可选 confidence、partial；方法接收单段 16kHz mono，不覆盖异步文件任务和流式会话 |
| 引擎选择 | frontend/src-tauri/src/audio/transcription/engine.rs:215 | 存在 Provider 枚举分支，但工厂仍以 Whisper／Parakeet 为主；未知 provider 会落入 Whisper 默认分支，扩展时应显式报错 |
| 实时结果 | frontend/src-tauri/src/audio/transcription/worker.rs:194 | 开始／结束时间来自输入片段范围，不是字词对齐；缺失 confidence 被填成 0.85，不能用于高置信自动修订 |
| 文件导入 | frontend/src-tauri/src/audio/import.rs:512 | 仍直接选择 Whisper／Parakeet，没有统一经过 trait |
| 重新转录 | frontend/src-tauri/src/audio/retranscription.rs:437 | 删除会议旧 transcripts 后插入新结果；会后精修前需要非破坏版本保存 |
| 数据结构 | frontend/src-tauri/src/database/models.rs:26 | 已有 audio_start_time、audio_end_time、duration，可复用录音相对时间概念，但要扩展版本、词级锚点和来源 |
| speaker 列 | frontend/src-tauri/migrations/20251110000001_add_speaker_field.sql:1 | 迁移注释定义音频来源，不是声纹聚类的人物；实时 worker 还固定 source 为 Audio |
| 凭据 | frontend/src-tauri/src/database/repositories/setting.rs:175 | 当前转录 API key 写入数据库字段；新增 Provider 建议采用系统凭据存储，以引用替代明文配置 |

## 模型下载不是通用运行接口

Whisper 的模型目录在 frontend/src-tauri/src/config.rs；whisper_engine/whisper_engine.rs 的发现、下载及加载受目录和 whisper.cpp 约束。Parakeet 有自己的 ModelSpec 与多文件下载清单。总结模型走独立的 summary 引擎。

因此 Hugging Face 只解决分发来源。Qwen3-ASR 不能通过新增 Whisper 下载地址就运行；需要对应运行时与适配器。新增下载清单应包含准确 repo/revision、文件、校验、许可证和运行时兼容版本。

## 最小改动边界

保留现有采集、录音保存、播放器和本地引擎。先加入标准结果结构与文件任务适配器，让已有文件导入可以接新 Provider；稳定后再提取实时音频分发接口。不要一次重写整个 pipeline。

录音源、ASR 版本、对齐版本、说话人版本、人工修改应各有来源记录。首次迁移把已有逐字稿作为 legacy run 保留；运行中新结果不能直接覆盖用户编辑。

后续代码实施前还需补查端到端事件订阅与数据库保存路径、暂停后时间基准、崩溃恢复及旧数据迁移。此次结论是接入设计依据，不是完整代码审计。
