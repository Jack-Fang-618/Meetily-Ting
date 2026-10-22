# 说话人与时间对齐：边界和候选

日期：2026-10-22。状态：方案调查，未做说话人实测。

## 三件不同的事

音频来源回答“麦克风还是系统音”；diarization 回答“这一段是哪位匿名说话人”；人物命名回答“Speaker 1 是谁”。现有 speaker 列不能证明已经支持后两者。系统声音中可能有多位远端参会者，麦克风也可能录到多人。

当前 pipeline 混音后转录，worker 输出 source=Audio。因此不能直接用这个来源推断是谁说话。若以后保留独立轨道，可辅助区分来源，但仍需处理回声、串音及多人同麦。

## 候选路线

| 路线 | 适用性 | 待核实 |
| --- | --- | --- |
| 云端 ASR 同时返回说话人 | 接口若支持，可少做一条处理链 | 必须核实具体 Filetrans 型号／参数／响应；本轮没有验证，不列为既有能力 |
| 本地独立 diarization | 能与不同 ASR 组合，适合隐私路线 | 分段、embedding、聚类和重叠语音处理；M1 资源与准确率待测 |
| 人工标注与合并 | 首版可保留匿名标签、允许命名 | 标签按 recording/run 定义，不假设跨会议自动识人 |

FunASR 官方示例有 SenseVoiceSmall + FSMN-VAD + CAM++，说话人标签来自组合流程，不是 SenseVoice 原生识别人的结果。可以作为本地技术候选，但不承诺在 M1 上实时运行。[来源](https://github.com/modelscope/FunASR)

时间对齐与说话人同样应分开：VAD 给语音范围，ASR 给文字，forced alignment 对齐给定文字与音频。Qwen3-ForcedAligner 是可选候选；对齐成功不证明文字听写正确。[来源](https://github.com/QwenLM/Qwen3-ASR)

## 工作台需要的数据

segment 保留原音频锚点，speaker assignment 独立记录来源与版本。支持 unknown、重叠区间与用户纠正。点击疑点时按音频范围前后扩展回听；没有字级对齐就使用段级定位并标明精度，不生成虚假的字级时间戳。

不把“分出几位说话人”作为第一轮粤语 Provider 验证的前置条件。先保证原始录音、逐字稿版本和时间轴可靠，再比较 diarization。
