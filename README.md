# AI VTuber App

一个基于 React + Three.js + VRM 的本地 AI 虚拟人原型项目。
当前一期目标是先把动作链路稳定化，并打通“文本流事件 -> 人物动作”的最小闭环。

## 一期已实现

- 动作调度器（可测试）
- 动作互斥与持续时长统一管理
- 触发限流（避免高频事件导致抖动）
- 模型/骨骼守卫（缺失时记录错误并降级回正）
- 调试状态面板（模型状态、当前动作、最近事件）
- 文本流模拟入口（chunk / sentence_end / idle_timeout）
- 单元测试覆盖调度与流事件映射

## 本地运行

```bash
npm install
npm run dev
```

确保 public 目录下存在 model.vrm。

## 测试与构建

```bash
npm run test
npm run build
```

## 交互说明

页面左侧控制面板：

- 流式事件模拟
- 表情测试
- 动作测试（wave / nod / shake / raiseLeftArm / reset）

页面右侧日志面板：

- 显示最近 20 条事件
- 包括动作开始、结束、拒绝、骨骼缺失、回正等

## AI 调用接口（无需页面按钮）

在运行时可直接通过全局方法调用动作系统：

```js
window.vrmAICommand({ type: 'gesture', gesture: 'wave' });
window.vrmAICommand({ type: 'gesture', gesture: 'nod', durationSec: 1.4 });

window.vrmAICommand({ type: 'locomotion', mode: 'inPlace', speed: 0.9 });
window.vrmAICommand({ type: 'locomotion', mode: 'forward', speed: 1.0, turnRate: 0.4 });

window.vrmAICommand({ type: 'stop' });
```

### 指令说明

- `gesture`：离散手势动作
  - `gesture` 可选：`wave`、`nod`、`shake`、`raiseLeftArm`
  - `durationSec` 可选：该手势持续秒数
- `locomotion`：连续机动层
  - `mode` 可选：`idle`、`inPlace`、`forward`
  - `speed` 可选：速度（内部会做安全夹取）
  - `turnRate` 可选：转向角速度
- `stop`：停止机动并回到待机

当前动作系统采用分层更新（待机层 + 机动层 + 手势层），便于后续 AI 侧根据文本流、TTS、情绪结果做组合触发。

## 核心代码

- src/vrmMotion.ts
  - 动作调度逻辑与流事件映射
- src/vrmActionController.ts
  - 分层动作控制器（待机、手势、机动/走路、AI 指令分发）
- src/VrmViewer.tsx
  - VRM 加载、动作控制器接线、全局 AI 调用接口
- src/App.tsx
  - 控制面板、文本流模拟、日志展示
- src/vrmMotion.test.ts
  - 调度器与映射测试

## 后续建议

- 接入真实 LLM 流式输出事件
- 二期引入 TTS 播放状态，作为更准确的“说话中”信号
- 口型同步和表情融合（与动作并行）
