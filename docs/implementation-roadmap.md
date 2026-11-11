# Ting 接入路线图

初稿日期：2026-10-22。既有产品决策见 [产品记录](ting-product-backlog.md)。下方原阶段描述保留为设计背景，以最新进度为准。

## 最新进度与优先级 · 2026-11-10

- 本地 Qwen / 粤语微调 / BuzzASR 已接入模型管理；本地模型小样本对比及 Parakeet 漏段修复完成。
- 百炼文件转写开发预览已接通：用户自配 Key、默认关闭云端、上传确认、异步任务恢复。3.1 公开测试样本 30/30 成功，3.0 四类语言冒烟通过。当前优先完成原生前端配置、导入、结果保存和失败路径验收；详见 [云端使用说明](aliyun-file-transcription.md)。
- 云端实时字幕开发预览已接入：独立实时选择、每次录音上传确认、持续 PCM、临时/正式字幕分离、停止收尾与断线提示。六个公开样本真实 Streaming 测试通过；原生麦克风/系统音频端到端验收待做。暂不自动重连重传，见 [实时转写说明](aliyun-live-transcription.md)。说话人分离、上下文校订继续后置。
- **用户确认：上传服务端暂缓实施，仅列入正式发布前规划。** 候选方案为私有 OSS、短期授权上传/读取、完成后删除及异常任务自动清理。Ting 托管方案还需要用户鉴权、额度/防滥用、文件隔离、费用监控和隐私说明；保留用户自配 OSS 作为另一种方案。不能把长期 OSS 凭据放进客户端，也不要求服务端保管用户的百炼 Key。
- 当前临时上传仅作为明确标注的开发预览；正式产品发布前解决存储方案。收费、订阅和完整商业后台继续后置。

- **界面方向：轻量建立 Ting 自身风格，保留 Meetily 成熟组件与交互。** 共享按钮、开关、焦点与弹窗样式同时覆盖原有页面；本轮重整云端设置，不做全面重排。见 [Ting 界面约定](ting-ui-guidelines.md)。

- 可选独立字幕浮窗已接入本地正式字幕及云端临时/正式字幕；支持置顶、拖动、调整字号，关闭不停止录音。原生窗口行为待验收，见 [浮窗说明](floating-captions.md)。

## 当前范围更新（用户确认）

第一阶段只追求本地／云端粤语 ASR 稳定可用。上下文调整、LLM 精修和说话人识别明确后置；下面阶段 4 及说话人方案不作为当前接入的前置条件。

本地计划验证 Qwen3-ASR + MLX 路径，尚未安装或接入；当前应用已有的本地模型不等于已经使用 MLX。

云端聚焦百炼，设置页提供 API Key 输入、地域和模型选择；必要时补业务空间配置，程序负责端点与协议。用户自行输入 key，不要求在聊天中发送。文件长任务的上传／URL 由实现封装，不能只做一个 key 输入框就宣称完成接入。

STT Provider 与文本 LLM Provider 分开。将来总结和逐字稿校订可复用同一套 LLM 连接、凭据和模型配置基础，但任务提示、输出结构与模型选择分别定义。当前不实现校订。

## 阶段 0：本轮已完成

检查音频、Provider、导入／重新转录、时间与 speaker 结构；核实模型官方资料；形成 [架构检查](architecture-review.md)、[模型生态](asr-model-ecosystem.md)、[Provider 草案](stt-provider-design.md)、[说话人方案](diarization-options.md)。没有上传音频、下载模型或改变应用行为。

## 阶段 1：小样本证明效果

固定一组经授权的粤语及混合语言音频和人工参考稿。先验证本机 MLX Qwen3-ASR 0.6B，再视资源比较 1.7B；确认阿里地域、账号、model ID、价格和外发许可后验证一个 Filetrans 型号。比较原始结果，不先加 LLM 美化。

交付：可复现参数、文本／时间结构、耗时／内存／成本记录、错例。通过标准：没有未解释的漏段或截断，能保存全文和来源信息；用实际校订成本决定是否进入应用。短样本后补长录音稳定性；数值阈值以用途和实测协商，不预设“云端必胜”。

## 阶段 2：文件转录最小闭环

新增标准结果和非破坏 run 存储，旧稿迁移成 legacy run。让文件导入通过适配器运行；用户选本地或云端，获得带音频定位的新逐字稿。处理进度、错误、取消和重启恢复。

验收：现有本地路径不退化；未知 Provider 不静默改用 Whisper；云端无需本地模型；旧稿和人工编辑不被覆盖；错误不会导致无限重试付费任务。

## 阶段 3：实时会议

新增 session 和连续音频入口，处理 partial/final、重连、背压、暂停恢复时间轴。根据实际可用性选择阿里 Streaming；本地 MLX 没有验证前只称“分段近实时”，不承诺原生流式。

验收：长会议无重复／丢段，停止后收齐 final，重连后的时间能准确回听；不破坏本地录音保存。

## 阶段 4：会后精修与人工核验

同一录音生成新 ASR run；加入项目 Context Pack、LLM 建议、疑点列表、播放器联动、可撤销修订。原稿、校订稿与摘要分开。去敏路线在任何外发前完成本地处理并让用户查看。

去掉缺失 confidence 填 0.85 的做法。疑点可以来自模型差异、对齐异常、术语等，但不能将 LLM 自信度等同于听清程度。

## 后续

完善说话人、导出、可选教育引导、网站和安装包。BYOK／平台托管与收费留到后期。开发用本地服务只是原型手段，不是最终让用户配置环境的产品方案。

每阶段单独提交并验证；先不批量接全部模型，不做训练，不重写采集系统。当前建议下一步是阶段 1 的本地小样本实验；专项候选同时验证 BuzzASR 的 GGML 转换和 Qwen 粤语 LoRA 的合并／MLX 路线，见 [专项接入调查](cantonese-specialist-integration.md)。

### 2026-11-10: language-model role and live translation

Rename user-facing “Summary Model” settings to “Language Model”: summary, translation, and future context correction share provider infrastructure. Tasks may use different models. Add Bailian LLM using the user's existing Keychain credentials, independent of ASR. Caption English→Chinese / Cantonese→written Chinese implemented as opt-in view-only text translation; provisional cloud default qwen3.8-flash, selectable qwen3.7-plus and legacy aliases; local Qwen3.5 4B experimental. Evaluation and native acceptance checklist: docs/caption-translation.md. Phase 2/3 correction suggestions, confidence evidence and human approval are not implemented by this translation feature.

### 2026-11-10 follow-up
- Added bounded gain for quiet system playback and transparent Popover caption surface with 0–100% tint. Native listening/visual acceptance pending.
- Added opt-in experimental direct Bailian audio translation after English/read Cantonese/mixed Cantonese API smoke tests. Existing sentence translation retained; additional audio upload and billing disclosed. Not a formal benchmark or guarantee of word-for-word accuracy.

### Local live caption latency follow-up
- Live capture VAD now emits six-second segments while continuous speech is still active, retaining 500ms of unsettled audio for VAD end trimming. Final end/stop paths emit only the previously unsubmitted tail. File import/retranscription segmentation remains unchanged.
- This is bounded batch recognition, not token-streaming ASR: approximate delay is 6.5 seconds plus inference and queue time. Natural pauses can produce earlier results. Shorter context can affect word boundaries/accuracy, especially Whisper; real audio comparison remains pending. Large models slower than real time can still accumulate delay.
- Regression compares live and original VAD output sample-for-sample, with and without trailing silence, and confirms delivery before the pause, timestamp ordering, and segment bounds.
- Native fullscreen approach revised to NSPanel after the prior flag-only fix failed user acceptance.
